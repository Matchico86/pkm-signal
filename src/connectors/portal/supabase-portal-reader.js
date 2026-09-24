require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

let supabaseClient = null;
let profilesCache = null;

const CONDITION_RANKS = {
  "MT": 10, "M": 9, "NM": 8, "EX": 7, "GD": 6, "LP": 5, "PL": 4, "PO": 3
};

function getConditionRank(condition) {
  if (!condition) return 0;
  return CONDITION_RANKS[String(condition).trim().toUpperCase()] || 0;
}

function normalizeOwnerKey(rawName) {
  if (!rawName) return 'unknown';
  const low = String(rawName).trim().toLowerCase();
  if (low === 'mat' || low === 'mathieu') return 'mathieu';
  if (low === 'ewa' || low === 'ewan') return 'ewan';
  return low;
}

function matchesVariant(rowVariant, inputVariant) {
  if (!inputVariant) return true;
  const inVar = String(inputVariant).trim().toUpperCase();
  const rVar = rowVariant ? String(rowVariant).trim().toUpperCase() : null;

  if (inVar && rVar) {
    if (inVar === rVar) return true;
    if ((inVar === 'N' || inVar === 'NORMAL') && (rVar === 'N' || rVar === 'NORMAL')) return true;
    return false;
  }
  if (inVar && !rVar) {
    return inVar === 'N' || inVar === 'NORMAL';
  }
  if (!inVar && rVar) {
    return rVar === 'N' || rVar === 'NORMAL';
  }
  return true;
}

function createPortalSupabaseClientFromEnv() {
  if (supabaseClient) return supabaseClient;

  const url = process.env.PKM_PORTAL_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PKM_PORTAL_SUPABASE_READ_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  supabaseClient = createClient(url, key, { auth: { persistSession: false } });
  return supabaseClient;
}

async function checkPortalSupabaseConnection() {
  const client = createPortalSupabaseClientFromEnv();
  if (!client) return { connected: false, reason: "missing_env" };
  
  try {
    const { error } = await client.from('profiles').select('id').limit(1);
    if (!error) {
      return { connected: true };
    }
    return { connected: false, reason: error.message };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

/**
 * Cache mémoire des profils pour résoudre owner_id (UUID) -> owner_key ('mathieu', 'ewan')
 */
async function getProfilesMap(client) {
  if (profilesCache) return profilesCache;

  const map = new Map();
  if (!client) return map;

  try {
    const { data, error } = await client.from('profiles').select('id, owner_key, display_name');
    if (!error && Array.isArray(data)) {
      data.forEach(p => {
        if (p.id) {
          const key = normalizeOwnerKey(p.owner_key || p.display_name);
          map.set(p.id, key);
        }
      });
      profilesCache = map;
    }
  } catch (e) {
    // Tolérance d'échec si la table n'est pas accessible
  }

  return profilesCache || map;
}

/**
 * Retourne la liste de tous les propriétaires actifs
 */
async function getAllActiveOwners(client) {
  const map = await getProfilesMap(client);
  const owners = Array.from(new Set(map.values())).filter(o => o && o !== 'unknown');
  return owners.length > 0 ? owners : ['mathieu', 'ewan', 'leo'];
}

/**
 * 1. Collection par Card ID
 * Vue cible : public.inventory_cards
 * Colonnes : card_id (texte), owner_key, quantity, state (= condition), variant, list_kind
 * Filtrage : list_kind = 'collection'
 */
async function fetchPortalCollectionByCardId(cardId, options = {}) {
  const client = createPortalSupabaseClientFromEnv();
  
  const baseResult = {
    owners: {},
    warning: null
  };

  if (!client) {
    baseResult.warning = "portal_supabase_missing_env";
    return { collection: baseResult };
  }

  const keys = Array.isArray(cardId) ? cardId : [cardId];
  const targetTable = process.env.PKM_PORTAL_SUPABASE_INVENTORY_VIEW || 'inventory_cards';

  try {
    let query = client
      .from(targetTable)
      .select('card_id, owner_key, quantity, state, variant, list_kind')
      .in('card_id', keys)
      .eq('list_kind', 'collection');

    const { data, error } = await query;

    if (error) {
      baseResult.warning = `portal_supabase_collection_error: ${error.message}`;
      return { collection: baseResult };
    }

    if (!data || data.length === 0) {
      baseResult.warning = "portal_supabase_collection_missing";
      return { collection: baseResult };
    }

    const initOwner = () => ({ owned: false, quantity: 0, best_condition: null });

    data.forEach(row => {
      if (!matchesVariant(row.variant, options.variant)) {
        return;
      }

      const ownerKey = normalizeOwnerKey(row.owner_key);
      if (!baseResult.owners[ownerKey]) {
        baseResult.owners[ownerKey] = initOwner();
      }

      const target = baseResult.owners[ownerKey];
      target.owned = true;
      target.quantity += Number(row.quantity || 1);

      const cond = row.state || row.condition || null;
      if (cond) {
        if (!target.best_condition || getConditionRank(cond) > getConditionRank(target.best_condition)) {
          target.best_condition = cond;
        }
      }
    });

    return { collection: baseResult };
  } catch (err) {
    baseResult.warning = `portal_supabase_collection_exception: ${err.message}`;
    return { collection: baseResult };
  }
}

/**
 * 2. Stock par Card ID
 * Vue cible : public.inventory_cards
 * Colonnes : card_id (texte), owner_key, quantity, variant, list_kind
 * Filtrage : list_kind = 'stock'
 */
async function fetchPortalStockByCardId(cardId, options = {}) {
  const client = createPortalSupabaseClientFromEnv();

  const baseResult = {
    owners: {},
    total_stock: 0,
    oldest_stock_date: null,
    days_in_stock: 0,
    warning: null
  };

  if (!client) {
    baseResult.warning = "portal_supabase_missing_env";
    return { stock: baseResult };
  }

  const keys = Array.isArray(cardId) ? cardId : [cardId];
  const targetTable = process.env.PKM_PORTAL_SUPABASE_INVENTORY_VIEW || 'inventory_cards';

  try {
    const { data, error } = await client
      .from(targetTable)
      .select('card_id, owner_key, quantity, variant, list_kind, created_at')
      .in('card_id', keys)
      .eq('list_kind', 'stock');

    if (error) {
      baseResult.warning = `portal_supabase_stock_error: ${error.message}`;
      return { stock: baseResult };
    }

    if (!data || data.length === 0) {
      return { stock: baseResult };
    }

    data.forEach(row => {
      if (!matchesVariant(row.variant, options.variant)) {
        return;
      }

      const ownerKey = normalizeOwnerKey(row.owner_key);
      if (!baseResult.owners[ownerKey]) {
        baseResult.owners[ownerKey] = { stock_quantity: 0 };
      }

      const qty = Number(row.quantity || 0);
      baseResult.owners[ownerKey].stock_quantity += qty;
      baseResult.total_stock += qty;

      if (row.created_at) {
        if (!baseResult.oldest_stock_date || new Date(row.created_at) < new Date(baseResult.oldest_stock_date)) {
          baseResult.oldest_stock_date = row.created_at;
        }
      }
    });

    if (baseResult.oldest_stock_date) {
      const diffMs = Date.now() - new Date(baseResult.oldest_stock_date).getTime();
      baseResult.days_in_stock = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }

    return { stock: baseResult };
  } catch (err) {
    baseResult.warning = `portal_supabase_stock_exception: ${err.message}`;
    return { stock: baseResult };
  }
}

/**
 * 3. Cotes par Card ID
 * Vue principale : public.current_cotes (colonne business_card_id texte)
 * Fallback historique : public.cote_history avec jointure cards
 */
async function fetchPortalCoteHistoryByCardId(cardId, options = {}) {
  const client = createPortalSupabaseClientFromEnv();
  if (!client) {
    return { available: false, points: [], last_cote: null, last_cote_updated_at: null, warning: "portal_supabase_missing_env" };
  }

  const keys = Array.isArray(cardId) ? cardId : [cardId];

  // 1. Essai sur public.current_cotes
  try {
    const { data, error } = await client
      .from('current_cotes')
      .select('business_card_id, last_cote, last_cote_date, last_cote_source')
      .in('business_card_id', keys)
      .limit(10);

    if (!error && data && data.length > 0) {
      const points = data
        .filter(r => r.last_cote !== null && r.last_cote !== undefined)
        .map(r => ({
          date: r.last_cote_date || null,
          value: Number(r.last_cote),
          source: r.last_cote_source || "portal_current_cotes"
        }));

      points.sort((a, b) => new Date(b.date) - new Date(a.date));
      const latest = points[0] || null;

      if (latest) {
        return {
          available: true,
          points,
          last_cote: latest.value,
          last_cote_updated_at: latest.date,
          trend_30d: null,
          warning: null
        };
      }
    }
  } catch (e) {
    // Poursuite vers le fallback historique
  }

  // 2. Fallback sur public.cote_history (si jointure cards accessible)
  try {
    const { data: histData, error: histError } = await client
      .from('cote_history')
      .select('cote, cote_date, date, created_at, cards!inner(card_id)')
      .in('cards.card_id', keys)
      .order('date', { ascending: false, nullsFirst: false })
      .limit(100);

    if (!histError && histData && histData.length > 0) {
      const points = histData.map(r => ({
        date: r.date || r.cote_date || r.created_at || null,
        value: Number(r.cote || 0),
        source: "portal_cote_history"
      }));

      points.sort((a, b) => new Date(b.date) - new Date(a.date));
      const latest = points[0];

      return {
        available: true,
        points,
        last_cote: latest ? latest.value : null,
        last_cote_updated_at: latest ? latest.date : null,
        trend_30d: null,
        warning: null
      };
    }
  } catch (e) {
    // Erreur de jointure silencieuse
  }

  return {
    available: false,
    points: [],
    last_cote: null,
    last_cote_updated_at: null,
    warning: "portal_supabase_cote_history_missing"
  };
}

/**
 * 4. Achats et Ventes par Card ID
 * Vues : public.purchase_items et public.sale_items (colonne card_key texte)
 * Résolution des propriétaires : via public.profiles (owner_id UUID -> owner_key)
 */
async function fetchPortalPurchasesAndSales(cardId, options = {}) {
  const client = createPortalSupabaseClientFromEnv();

  const emptyResult = {
    purchases: { owners: {}, last_buy_price: null, average_buy_price: null, total_quantity: 0 },
    sales: { owners: {}, last_sell_price: null, average_sell_price: null, sold_quantity_12m: 0 },
    warning: null
  };

  if (!client) {
    emptyResult.warning = "portal_supabase_missing_env";
    return emptyResult;
  }

  const keys = Array.isArray(cardId) ? cardId : [cardId];

  try {
    const [profilesMap, purchRes, salesRes] = await Promise.all([
      getProfilesMap(client),
      client
        .from('purchase_items')
        .select('card_key, net_unit_price, quantity, owner_id, created_at')
        .in('card_key', keys),
      client
        .from('sale_items')
        .select('card_key, net_unit_price, quantity, owner_id, created_at')
        .in('card_key', keys)
    ]);

    const purchData = purchRes.data || [];
    const salesData = salesRes.data || [];

    // Traitement Achats
    let totalSpentGlobal = 0;
    let totalQtyPurchGlobal = 0;
    let latestPurchDate = null;
    let latestBuyPriceGlobal = null;

    const purchByOwner = {};

    purchData.forEach(row => {
      const ownerKey = profilesMap.get(row.owner_id) || normalizeOwnerKey(row.owner_id);
      if (!purchByOwner[ownerKey]) {
        purchByOwner[ownerKey] = { total_spent: 0, quantity: 0, last_buy_price: null, latest_date: null };
      }

      const price = Number(row.net_unit_price || 0);
      const qty = Number(row.quantity || 1);
      const rawDate = row.created_at || row.purchase_date;
      const date = rawDate ? new Date(rawDate) : null;

      purchByOwner[ownerKey].total_spent += price * qty;
      purchByOwner[ownerKey].quantity += qty;
      totalSpentGlobal += price * qty;
      totalQtyPurchGlobal += qty;

      if (date && (!purchByOwner[ownerKey].latest_date || date > purchByOwner[ownerKey].latest_date)) {
        purchByOwner[ownerKey].latest_date = date;
        purchByOwner[ownerKey].last_buy_price = price;
      }

      if (date && (!latestPurchDate || date > latestPurchDate)) {
        latestPurchDate = date;
        latestBuyPriceGlobal = price;
      }
    });

    const purchasesOwners = {};
    Object.keys(purchByOwner).forEach(o => {
      const p = purchByOwner[o];
      purchasesOwners[o] = {
        last_buy_price: p.last_buy_price !== null ? p.last_buy_price : (p.quantity > 0 ? p.total_spent / p.quantity : null),
        average_buy_price: p.quantity > 0 ? Number((p.total_spent / p.quantity).toFixed(2)) : null,
        total_quantity: p.quantity
      };
    });

    // Traitement Ventes
    let totalRevenueGlobal = 0;
    let totalSoldGlobal = 0;
    let latestSaleDate = null;
    let latestSellPriceGlobal = null;

    const salesByOwner = {};

    salesData.forEach(row => {
      const ownerKey = profilesMap.get(row.owner_id) || normalizeOwnerKey(row.owner_id);
      if (!salesByOwner[ownerKey]) {
        salesByOwner[ownerKey] = { total_revenue: 0, quantity: 0, last_sell_price: null, latest_date: null };
      }

      const price = Number(row.net_unit_price || 0);
      const qty = Number(row.quantity || 1);
      const rawDate = row.created_at || row.sale_date;
      const date = rawDate ? new Date(rawDate) : null;

      salesByOwner[ownerKey].total_revenue += price * qty;
      salesByOwner[ownerKey].quantity += qty;
      totalRevenueGlobal += price * qty;
      totalSoldGlobal += qty;

      if (date && (!salesByOwner[ownerKey].latest_date || date > salesByOwner[ownerKey].latest_date)) {
        salesByOwner[ownerKey].latest_date = date;
        salesByOwner[ownerKey].last_sell_price = price;
      }

      if (date && (!latestSaleDate || date > latestSaleDate)) {
        latestSaleDate = date;
        latestSellPriceGlobal = price;
      }
    });

    const salesOwners = {};
    Object.keys(salesByOwner).forEach(o => {
      const s = salesByOwner[o];
      salesOwners[o] = {
        last_sell_price: s.last_sell_price !== null ? s.last_sell_price : (s.quantity > 0 ? s.total_revenue / s.quantity : null),
        average_sell_price: s.quantity > 0 ? Number((s.total_revenue / s.quantity).toFixed(2)) : null,
        sold_quantity_12m: s.quantity
      };
    });

    return {
      purchases: {
        owners: purchasesOwners,
        last_buy_price: latestBuyPriceGlobal,
        average_buy_price: totalQtyPurchGlobal > 0 ? Number((totalSpentGlobal / totalQtyPurchGlobal).toFixed(2)) : null,
        total_quantity: totalQtyPurchGlobal
      },
      sales: {
        owners: salesOwners,
        last_sell_price: latestSellPriceGlobal,
        average_sell_price: totalSoldGlobal > 0 ? Number((totalRevenueGlobal / totalSoldGlobal).toFixed(2)) : null,
        sold_quantity_12m: totalSoldGlobal,
        last_sold_date: latestSaleDate ? latestSaleDate.toISOString().split('T')[0] : null
      },
      warning: (purchRes.error ? `purchases_error: ${purchRes.error.message} ` : '') + (salesRes.error ? `sales_error: ${salesRes.error.message}` : '').trim() || null
    };
  } catch (err) {
    emptyResult.warning = `purchases_sales_exception: ${err.message}`;
    return emptyResult;
  }
}

// Cache mémoire court pour les contextes de carte
const contextCache = new Map();

/**
 * 5. Favoris par Card ID / UUIDs
 */
async function fetchPortalFavoritesByCard(cardId, cardUuids = []) {
  const client = createPortalSupabaseClientFromEnv();
  if (!client) return { favorite_owners: [], warning: "portal_supabase_missing_env" };

  const keys = Array.isArray(cardId) ? cardId : [cardId];
  const allIdentifiers = [...new Set([...keys, ...cardUuids].filter(Boolean))];

  try {
    const profilesMap = await getProfilesMap(client);
    const { data, error } = await client
      .from('favorites')
      .select('card_id, owner_id')
      .in('card_id', allIdentifiers);

    if (error) {
      return { favorite_owners: [], warning: error.message };
    }

    const owners = (data || []).map(row => {
      return profilesMap.get(row.owner_id) || normalizeOwnerKey(row.owner_id);
    }).filter(Boolean);

    return { favorite_owners: [...new Set(owners)], warning: null };
  } catch (err) {
    return { favorite_owners: [], warning: err.message };
  }
}

/**
 * 6. Métadonnées de carte (rarity, name, set_id) depuis la table cards
 */
async function fetchCardMetadata(cardId) {
  const client = createPortalSupabaseClientFromEnv();
  if (!client) return { card: null, warning: "portal_supabase_missing_env" };

  const keys = Array.isArray(cardId) ? cardId : [cardId];

  try {
    const { data, error } = await client
      .from('cards')
      .select('id, card_id, tcgdex_id, set_id, number, name, rarity')
      .in('card_id', keys)
      .limit(1);

    if (!error && data && data.length > 0) {
      return { card: data[0], warning: null };
    }

    const { data: dataTcg, error: errTcg } = await client
      .from('cards')
      .select('id, card_id, tcgdex_id, set_id, number, name, rarity')
      .in('tcgdex_id', keys)
      .limit(1);

    if (!errTcg && dataTcg && dataTcg.length > 0) {
      return { card: dataTcg[0], warning: null };
    }

    return { card: null, warning: error ? error.message : null };
  } catch (err) {
    return { card: null, warning: err.message };
  }
}

/**
 * Orchestrateur complet pour une carte
 */
async function fetchPortalContextByCardId(cardId, options = {}) {
  const cacheKey = Array.isArray(cardId) ? cardId.join('|') : String(cardId);
  if (contextCache.has(cacheKey)) {
    return contextCache.get(cacheKey);
  }

  const keys = Array.isArray(cardId) ? cardId : [cardId];
  const metaRes = await fetchCardMetadata(keys);
  const cardUuid = metaRes.card?.id || null;
  const cardUuids = cardUuid ? [cardUuid] : [];

  const [cote_history, collectionRes, stockRes, purchSalesRes, favRes, activeOwners] = await Promise.all([
    fetchPortalCoteHistoryByCardId(cardId, options),
    fetchPortalCollectionByCardId(cardId, options),
    fetchPortalStockByCardId(cardId, options),
    fetchPortalPurchasesAndSales(cardId, options),
    fetchPortalFavoritesByCard(cardId, cardUuids),
    getAllActiveOwners(createPortalSupabaseClientFromEnv())
  ]);

  const result = {
    card_id: Array.isArray(cardId) ? cardId[0] : cardId,
    card_info: metaRes.card || null,
    rarity: metaRes.card?.rarity || null,
    cote_history,
    collection: collectionRes.collection,
    stock: stockRes.stock,
    purchases_and_sales: purchSalesRes,
    favorites: favRes,
    favorite_owners: favRes.favorite_owners || [],
    active_owners: activeOwners
  };

  contextCache.set(cacheKey, result);
  return result;
}

/**
 * Progression du set dans la collection
 * Vue : public.inventory_cards avec list_kind = 'collection'
 * Table sets : public.pokemon_sets
 */
async function fetchSetProgress(setId) {
  const client = createPortalSupabaseClientFromEnv();
  if (!setId || !client) return null;

  try {
    // 1. Total des cartes du set
    const { data: setData, error: setError } = await client
      .from('pokemon_sets')
      .select('qt_total')
      .or(`set_id.eq.${setId},tcgdex_id.eq.${setId},set_id_2.eq.${setId}`)
      .limit(1)
      .single();

    if (setError || !setData || !setData.qt_total) {
      return null;
    }

    const total = setData.qt_total;

    // 2. Cartes distinctes possédées en collection
    const targetTable = process.env.PKM_PORTAL_SUPABASE_INVENTORY_VIEW || 'inventory_cards';
    const { data: collData, error: collError } = await client
      .from(targetTable)
      .select('card_id, owner_key, list_kind')
      .ilike('card_id', `${setId}-%`)
      .eq('list_kind', 'collection');

    if (collError || !collData) return null;

    const ownersCount = {};
    collData.forEach(row => {
      const ownerKey = normalizeOwnerKey(row.owner_key);
      if (!ownersCount[ownerKey]) {
        ownersCount[ownerKey] = new Set();
      }
      if (row.card_id) {
        ownersCount[ownerKey].add(String(row.card_id).toUpperCase());
      }
    });

    const result = {};
    Object.keys(ownersCount).forEach(o => {
      const owned = ownersCount[o].size;
      result[o] = {
        owned,
        total,
        percent: Math.round((owned / total) * 100)
      };
    });

    return result;
  } catch (e) {
    return null;
  }
}

module.exports = {
  createPortalSupabaseClientFromEnv,
  checkPortalSupabaseConnection,
  fetchPortalCoteHistoryByCardId,
  fetchPortalCollectionByCardId,
  fetchPortalStockByCardId,
  fetchPortalPurchasesAndSales,
  fetchPortalContextByCardId,
  fetchSetProgress,
  fetchPortalFavoritesByCard,
  fetchCardMetadata,
  getAllActiveOwners
};

