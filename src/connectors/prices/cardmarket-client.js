require('dotenv').config();
/**
 * Connecteur Cardmarket pour PKM Market Engine
 * Récupère les données marché officielles (idProduct, prix tendance, low, avg, historique 30j)
 * et persiste la cotation dans Supabase (RPC pkm_record_cote_v3).
 */

const { createClient } = require('@supabase/supabase-js');
const { recordLiveAssistCall } = require('./rapidapi-quota-guard');

const TCGDEX_BASE_URL = 'https://api.tcgdex.net/v2/fr';

let supabaseClient = null;

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.PKM_PORTAL_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PKM_PORTAL_SUPABASE_READ_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  supabaseClient = createClient(url, key, { auth: { persistSession: false } });
  return supabaseClient;
}

/**
 * Construit l'URL officielle Cardmarket
 */
function buildOfficialCardmarketUrl(idProduct, isReverse = false) {
  if (!idProduct) return null;
  const base = `https://www.cardmarket.com/fr/Pokemon/Products?idProduct=${idProduct}&language=2`;
  return isReverse ? `${base}&isReverseHolo=Y` : base;
}

/**
 * Recherche les métadonnées de la carte en base (id UUID, tcgdex_id, cardmarket_id)
 */
async function resolveCardCatalogInfo(cardId, variant = null) {
  const client = getSupabaseClient();
  if (!client || !cardId) return null;

  try {
    const cleanId = String(cardId).trim().toUpperCase();
    const cleanTcgdex = String(cardId).trim().toLowerCase();
    let query = client
      .from('cards')
      .select('id, card_id, tcgdex_id, cardmarket_id, name, set_id, number, variant')
      .or(`card_id.eq.${cleanId},tcgdex_id.eq.${cleanTcgdex}`);

    if (variant) {
      const v = String(variant).trim().toUpperCase();
      const normV = (v === 'REVERSE' || v === 'REV') ? 'R' : (v === 'STANDARD' || v === 'NORMAL' ? 'N' : v);
      query = query.eq('variant', normV);
    }

    const { data, error } = await query.limit(1);
    if (!error && Array.isArray(data) && data.length > 0) {
      return data[0];
    }

    // Si non trouvé avec la variante exacte, chercher sans filtre de variante
    const { data: fallbackData } = await client
      .from('cards')
      .select('id, card_id, tcgdex_id, cardmarket_id, name, set_id, number, variant')
      .or(`card_id.eq.${cleanId},tcgdex_id.eq.${cleanTcgdex}`)
      .limit(1);
    if (fallbackData && fallbackData.length > 0) return fallbackData[0];

    return null;
  } catch (e) {
    return null;
  }
}

function normalizeVariant(variant) {
  const v = String(variant || 'N').trim().toUpperCase();
  if (v === 'REVERSE' || v === 'REV') return 'R';
  if (v === 'HOLO' || v === 'HOLOGRAPHIQUE') return 'H';
  if (v === 'STANDARD' || v === 'NORMAL' || v === '') return 'N';
  return v;
}

/**
 * Interroge l'API CardMarket (via TCGdex)
 * 
 * @param {Object} cardIdent - { card_id, tcgdex_id, cardmarket_id, isReverse, variant }
 * @param {Object} options - { timeoutMs }
 * @returns {Promise<Object|null>}
 */
async function fetchCardmarketData(cardIdent = {}, options = {}) {
  const timeoutMs = options.timeoutMs || 8000;
  let tcgdexId = cardIdent.tcgdex_id || cardIdent.tcgdexId;
  let cardmarketId = cardIdent.cardmarket_id || cardIdent.cardmarketId;
  const normV = normalizeVariant(cardIdent.variant);
  const isReverse = cardIdent.isReverse === true || normV === 'R';

  // Si tcgdex_id n'est pas fourni, résolution en base
  if (!tcgdexId && cardIdent.card_id) {
    const catalogInfo = await resolveCardCatalogInfo(cardIdent.card_id, cardIdent.variant);
    if (catalogInfo) {
      tcgdexId = catalogInfo.tcgdex_id;
      if (!cardmarketId) cardmarketId = catalogInfo.cardmarket_id;
    }
  }

  // Fallback si pas de tcgdex_id : essayer avec card_id en minuscule
  if (!tcgdexId && cardIdent.card_id) {
    tcgdexId = String(cardIdent.card_id).toLowerCase().trim();
  }

  if (!tcgdexId) {
    return {
      success: false,
      reason: 'card_identifier_unresolved',
      card_id: cardIdent.card_id
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${TCGDEX_BASE_URL}/cards/${encodeURIComponent(tcgdexId)}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (!res.ok) {
      return {
        success: false,
        reason: `api_http_${res.status}`,
        card_id: cardIdent.card_id
      };
    }

    const data = await res.json();
    const cmPricing = data?.pricing?.cardmarket;

    if (!cmPricing) {
      return {
        success: false,
        reason: 'no_cardmarket_pricing',
        card_id: cardIdent.card_id
      };
    }

    const idProduct = cmPricing.idProduct || cardmarketId || null;
    const trendPrice = isReverse && cmPricing['trend-holo'] ? cmPricing['trend-holo'] : cmPricing.trend;
    const lowPrice = isReverse && cmPricing['low-holo'] ? cmPricing['low-holo'] : cmPricing.low;
    const avgPrice = isReverse && cmPricing['avg-holo'] ? cmPricing['avg-holo'] : cmPricing.avg;
    const avg7 = isReverse && cmPricing['avg7-holo'] ? cmPricing['avg7-holo'] : cmPricing.avg7;
    const avg30 = isReverse && cmPricing['avg30-holo'] ? cmPricing['avg30-holo'] : cmPricing.avg30;
    const chosenPrice = trendPrice || avgPrice || lowPrice || 0;

    const tcgPricing = data?.pricing?.tcgplayer;
    let tcgplayer = null;
    if (tcgPricing && typeof tcgPricing === 'object') {
      const usdToEurRate = Number(process.env.PKM_USD_TO_EUR_RATE || 0.92);
      const block = isReverse
        ? (tcgPricing['reverse-holofoil'] || tcgPricing.holofoil || tcgPricing.normal)
        : (tcgPricing.normal || tcgPricing.holofoil || tcgPricing['reverse-holofoil']);

      if (block) {
        const marketUsd = block.marketPrice ? Number(block.marketPrice.toFixed(2)) : null;
        const lowUsd = block.lowPrice ? Number(block.lowPrice.toFixed(2)) : null;
        const midUsd = block.midPrice ? Number(block.midPrice.toFixed(2)) : null;
        const marketEur = marketUsd !== null ? Number((marketUsd * usdToEurRate).toFixed(2)) : null;
        const productId = block.productId || null;

        tcgplayer = {
          source: 'tcgplayer',
          product_id: productId,
          market_price_usd: marketUsd,
          market_price_eur: marketEur,
          low_price_usd: lowUsd,
          mid_price_usd: midUsd,
          url: productId ? `https://www.tcgplayer.com/product/${productId}` : null,
          updated_at: tcgPricing.updated || new Date().toISOString(),
          unit: 'USD'
        };
      }
    }

    const cmDetails = {
      source: 'cardmarket',
      id_product: idProduct,
      price: Number(chosenPrice.toFixed(2)),
      trend_price: trendPrice ? Number(trendPrice.toFixed(2)) : null,
      low_price: lowPrice ? Number(lowPrice.toFixed(2)) : null,
      avg_price: avgPrice ? Number(avgPrice.toFixed(2)) : null,
      avg7: avg7 ? Number(avg7.toFixed(2)) : null,
      avg30: avg30 ? Number(avg30.toFixed(2)) : null,
      updated_at: cmPricing.updated || new Date().toISOString(),
      url: buildOfficialCardmarketUrl(idProduct, isReverse),
      unit: cmPricing.unit || 'EUR'
    };

    return {
      success: true,
      cardmarket: cmDetails,
      tcgplayer,
      ...cmDetails
    };
  } catch (err) {
    return {
      success: false,
      reason: err.name === 'AbortError' ? 'timeout' : err.message,
      card_id: cardIdent.card_id
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Enregistre une cote fraîche dans Supabase (catalog.price_history via RPC pkm_record_cote_v3)
 * et comptabilise l'appel dans le quota dédié Live Assist.
 * 
 * @param {Object} params - { cardUuid, cardId, language, state, price, sourceRef }
 * @returns {Promise<Object>}
 */
async function recordLiveCoteInSupabase({ cardUuid, cardId, variant = null, language = 'FR', state = 'NM', price, sourceRef = 'live_assist' }) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: 'supabase_client_not_available' };
  }

  let targetCardUuid = cardUuid;
  if (!targetCardUuid && cardId) {
    const catalogInfo = await resolveCardCatalogInfo(cardId, variant);
    if (catalogInfo) {
      targetCardUuid = catalogInfo.id;
    }
  }

  if (!targetCardUuid) {
    return { ok: false, error: 'target_card_uuid_missing' };
  }

  const todayIso = new Date().toISOString().split('T')[0];

  try {
    const { data, error } = await client.rpc('pkm_record_cote_v3', {
      p_card_id: targetCardUuid,
      p_language: language,
      p_state: state,
      p_cote: price,
      p_cote_date: todayIso,
      p_source: 'cardmarket',
      p_source_ref: sourceRef
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return {
      ok: true,
      card_uuid: targetCardUuid,
      cote: price,
      cote_date: todayIso,
      record: data?.record
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  fetchCardmarketData,
  recordLiveCoteInSupabase,
  buildOfficialCardmarketUrl,
  resolveCardCatalogInfo,
  normalizeVariant
};

