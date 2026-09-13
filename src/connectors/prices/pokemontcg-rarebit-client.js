const fs = require('fs');
const path = require('path');
const { checkQuota, recordCall, recordQuotaExceeded } = require('./multi-api-quota-guard');

const CACHE_DIR = path.resolve(__dirname, '../../../data/cache/rarebit');
const DEFAULT_API_KEY = process.env.POKEMONTCG_RAREBIT_API_KEY || process.env.RAREBIT_API_KEY || 'ptcg_live_XBDXzy5TKnUY6JheSUAj8ph7lXaBK6rirhmB04i0';

function getCachePath(cardId) {
  const safeId = String(cardId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CACHE_DIR, `${safeId}.json`);
}

function readCache(cardId) {
  try {
    const filePath = getCachePath(cardId);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const entry = JSON.parse(raw);
    const ageHours = (Date.now() - new Date(entry.cached_at).getTime()) / (1000 * 60 * 60);
    if (ageHours < 24) {
      return entry.data;
    }
    return null;
  } catch (err) {
    return null;
  }
}

function writeCache(cardId, data) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const filePath = getCachePath(cardId);
    fs.writeFileSync(filePath, JSON.stringify({
      cached_at: new Date().toISOString(),
      data
    }, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[RareBit] Erreur écriture cache:', err.message);
  }
}

/**
 * Normalise l'ID de la carte pour l'API RareBit (ex: swsh7-189)
 */
function getRareBitCardIdCandidates(cardIdent = {}) {
  const candidates = [];
  const cardId = String(cardIdent.card_id || '').toLowerCase().trim();
  const tcgdexId = String(cardIdent.tcgdex_id || '').toLowerCase().trim();
  const cleanNum = String(cardIdent.number || '').trim().split('/')[0].replace(/^0+/, '') || String(cardIdent.number || '').trim();
  const setCode = String(cardIdent.set_id || '').toLowerCase().trim();

  const setMap = {
    evs: 'swsh7',
    me: 'me1',
    sv3: 'sv3',
    sv4: 'sv4',
    sv5: 'sv5',
    sv6: 'sv6',
    sv7: 'sv7',
    sv8: 'sv8'
  };

  // 1. Direct card_id (ex: crz-gg69)
  if (cardId) candidates.push(cardId);

  // 2. set_id + cleanNum (ex: crz-gg69)
  if (setCode && cleanNum) {
    candidates.push(`${setCode}-${cleanNum.toLowerCase()}`);
  }

  // 3. tcgdex_id (ex: swsh7-189)
  if (tcgdexId) candidates.push(tcgdexId);

  // 4. Mapped set code (ex: swsh7-189)
  if (setCode && cleanNum && setMap[setCode]) {
    candidates.push(`${setMap[setCode]}-${cleanNum.toLowerCase()}`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function normalizeRareBitCardId(cardIdent = {}) {
  const candidates = getRareBitCardIdCandidates(cardIdent);
  return candidates[0] || '';
}

/**
 * Récupère les cotations depuis Pokémon TCG Cards & Prices (RareBit)
 * 
 * @param {Object} cardIdent - { card_id, tcgdex_id, set_id, number, name }
 * @param {Object} options - { timeoutMs }
 */
async function fetchRarebitPrice(cardIdent = {}, options = {}) {
  const apiKey = process.env.POKEMONTCG_RAREBIT_API_KEY || process.env.RAPIDAPI_KEY || DEFAULT_API_KEY;
  const timeoutMs = options.timeoutMs || 8000;
  const cardId = normalizeRareBitCardId(cardIdent);

  if (!cardId) {
    return {
      success: false,
      reason: 'missing_card_id',
      source: 'rarebit',
      label: 'RareBit'
    };
  }

  // 1. Cache local 24h
  const cached = readCache(cardId);
  if (cached) {
    const quotaInfo = checkQuota('rarebit');
    return {
      ...cached,
      cached: true,
      remaining: quotaInfo.remaining,
      quota_display: quotaInfo.display
    };
  }

  // 2. Garde-fou Quota Pre-call
  const quotaCheck = checkQuota('rarebit');
  if (!quotaCheck.can_call) {
    return {
      success: false,
      reason: 'quota_reached',
      source: 'rarebit',
      label: 'RareBit',
      quota: quotaCheck
    };
  }

  // 3. Appel réseau
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://api.pokemontcgapi.com/v1/cards/${encodeURIComponent(cardId)}/prices`;
    const res = await fetch(url, {
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });

    if (!res.ok) {
      if (res.status === 429) {
        recordQuotaExceeded('rarebit');
        return {
          success: false,
          reason: 'quota_reached',
          source: 'rarebit',
          label: 'RareBit',
          quota_exceeded: true
        };
      }
      return {
        success: false,
        reason: `http_${res.status}`,
        source: 'rarebit',
        label: 'RareBit'
      };
    }

    const quotaInfo = recordCall('rarebit', res.headers);
    const json = await res.json();
    const data = json.data;

    if (!data) {
      return {
        success: false,
        reason: 'no_data',
        source: 'rarebit',
        label: 'RareBit',
        quota: quotaInfo
      };
    }

    const quotes = Array.isArray(data.quotes) ? data.quotes : [];
    
    // Règle projet stricte : cotations FR exclusivement
    const selectedQuote = quotes.find(q => (q.locale || '').toUpperCase() === 'FR' && Number(q.amount) > 0) || null;

    if (!selectedQuote) {
      return {
        success: false,
        reason: 'no_fr_price',
        source: 'rarebit',
        label: 'RareBit',
        quota: quotaInfo
      };
    }

    let price = Number(selectedQuote.amount || 0);
    const lang = 'FR';
    let condition = 'NM';
    const condRaw = String(selectedQuote.condition || '').toUpperCase();
    if (condRaw.includes('NEAR_MINT') || condRaw === 'NM') condition = 'NM';
    else if (condRaw.includes('EXCELLENT') || condRaw === 'EX') condition = 'EX';
    else if (condRaw.includes('PLAYED')) condition = 'PL';
    else condition = condRaw || 'NM';

    if (price <= 0) {
      return {
        success: false,
        reason: 'zero_price',
        source: 'rarebit',
        label: 'RareBit',
        quota: quotaInfo
      };
    }

    const result = {
      success: true,
      source: 'rarebit',
      label: 'RareBit',
      price: Number(price.toFixed(2)),
      lang,
      condition,
      remaining: quotaInfo.remaining,
      quota_display: quotaInfo.display,
      provenance: selectedQuote?.provenance || 'RareBit Index',
      updated_at: selectedQuote?.as_of || new Date().toISOString()
    };

    writeCache(cardId, result);
    return result;
  } catch (err) {
    return {
      success: false,
      reason: err.name === 'AbortError' ? 'timeout' : err.message,
      source: 'rarebit',
      label: 'RareBit'
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  fetchRarebitPrice,
  normalizeRareBitCardId
};
