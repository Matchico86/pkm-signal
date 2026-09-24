const { parseSupabaseData } = require('./supabase-portal-adapter');

const CONDITION_RANKS = {
  "MT": 10, "M": 9, "NM": 8, "EX": 7, "GD": 6, "LP": 5, "PL": 4, "PO": 3
};

function isBetterCondition(existingCond, incomingCond) {
  if (!existingCond) return false;
  if (!incomingCond) return true;
  const rankExisting = CONDITION_RANKS[existingCond.toUpperCase()] || 0;
  const rankIncoming = CONDITION_RANKS[incomingCond.toUpperCase()] || 0;
  return rankExisting >= rankIncoming; 
}

function getSaleVelocity(totalSold) {
  if (totalSold >= 10) return "high";
  if (totalSold >= 3) return "medium";
  if (totalSold > 0) return "low";
  return "unknown";
}

/**
 * Parseur de secours pour la rétrocompatibilité des mocks de tests unitaires legacy
 */
function parseLegacyMockSheets(sheetsExport, cardKey) {
  if (!sheetsExport || !sheetsExport.cards) return null;
  const data = sheetsExport.cards[cardKey];
  if (!data) return null;

  return {
    owners: {
      mathieu: {
        collection_owned: data.mathieu_owned || false,
        collection_best_condition: data.mathieu_condition || null,
        stock_quantity: data.mathieu_stock !== undefined ? data.mathieu_stock : 0,
        invest_quantity: data.mathieu_invest !== undefined ? data.mathieu_invest : 0,
        sold_quantity_12m: data.mathieu_sold !== undefined ? data.mathieu_sold : 0,
        last_buy_price: data.mathieu_last_buy || null,
        average_buy_price: data.mathieu_avg_buy || null,
        last_sell_price: data.mathieu_last_sell || null,
        average_sell_price: data.mathieu_avg_sell || null
      },
      ewan: {
        collection_owned: data.ewan_owned || false,
        collection_best_condition: data.ewan_condition || null,
        stock_quantity: data.ewan_stock !== undefined ? data.ewan_stock : 0,
        invest_quantity: data.ewan_invest !== undefined ? data.ewan_invest : 0,
        sold_quantity_12m: data.ewan_sold !== undefined ? data.ewan_sold : 0,
        last_buy_price: data.ewan_last_buy || null,
        average_buy_price: data.ewan_avg_buy || null,
        last_sell_price: data.ewan_last_sell || null,
        average_sell_price: data.ewan_avg_sell || null
      }
    },
    global: {
      portal_cote: data.portal_cote || null,
      portal_cote_updated_at: data.portal_cote_date || null
    },
    warnings: []
  };
}

function mergeData(sheetsData, supabaseData, cardKey, inputCondition) {
  const warnings = [];
  let internal_confidence = 0.0;

  if (!sheetsData && !supabaseData) {
    return {
      card_key: cardKey,
      collection: {},
      stock: {},
      invest: {},
      purchases: {},
      sales: { already_sold: false },
      cote: { last_value: null, updated_at: null },
      internal_confidence: 0.1,
      warnings: ["No internal data found"]
    };
  }

  internal_confidence = (sheetsData && supabaseData) ? 1.0 : (supabaseData ? 0.9 : 0.7);

  if (sheetsData && sheetsData.warnings && sheetsData.warnings.length > 0) {
    warnings.push(...sheetsData.warnings);
  }
  if (sheetsData && supabaseData && sheetsData.global?.portal_cote && supabaseData.global?.portal_cote && sheetsData.global.portal_cote !== supabaseData.global.portal_cote) {
    warnings.push("conflict_sheets_supabase: portal cote differs");
  }

  const ownersSet = new Set();
  if (sheetsData && sheetsData.owners) Object.keys(sheetsData.owners).forEach(o => ownersSet.add(o));
  if (supabaseData && supabaseData.owners) Object.keys(supabaseData.owners).forEach(o => ownersSet.add(o));
  
  const collection = {};
  const stock = {};
  const invest = {};
  const purchases = {};
  const sales = {};
  let totalSold = 0;

  ownersSet.forEach(owner => {
    const supaO = (supabaseData && supabaseData.owners) ? supabaseData.owners[owner] || {} : {};
    const sheetO = (sheetsData && sheetsData.owners) ? sheetsData.owners[owner] || {} : {};
    
    // Supabase has priority for collection
    const supaOwned = supaO.collection_owned;
    const owned = supaOwned !== undefined && supaOwned !== false ? supaOwned : (sheetO.collection_owned || false);
    const bestCond = supaO.collection_best_condition || sheetO.collection_best_condition || null;
    
    collection[owner] = { 
      owned: owned, 
      best_condition: bestCond,
      set_progress: supaO.set_progress || null 
    };
    
    // Stock & Invest : Supabase en priorité, fallback mock si présent
    stock[owner] = sheetO.stock_quantity !== undefined ? sheetO.stock_quantity : (supaO.stock_quantity || 0);
    invest[owner] = sheetO.invest_quantity !== undefined ? sheetO.invest_quantity : (supaO.invest_quantity || 0);

    // Purchases
    purchases[owner] = {
      last_buy_price: supaO.last_buy_price !== undefined ? supaO.last_buy_price : (sheetO.last_buy_price || null),
      average_buy_price: supaO.average_buy_price !== undefined ? supaO.average_buy_price : (sheetO.average_buy_price || null)
    };

    // Sales
    const soldQty = supaO.sold_quantity_12m !== undefined && supaO.sold_quantity_12m > 0 ? supaO.sold_quantity_12m : (sheetO.sold_quantity_12m || 0);
    sales[owner] = {
      sold_quantity_12m: soldQty,
      last_sell_price: supaO.last_sell_price !== undefined ? supaO.last_sell_price : (sheetO.last_sell_price || null),
      average_sell_price: supaO.average_sell_price !== undefined ? supaO.average_sell_price : (sheetO.average_sell_price || null)
    };

    totalSold += soldQty;
  });

  const coteData = (supabaseData && supabaseData.global && supabaseData.global.portal_cote) 
    ? supabaseData.global 
    : (sheetsData ? sheetsData.global : { portal_cote: null, portal_cote_updated_at: null, portal_cote_source: "cardmarket" });

  const totalStockNum = (supabaseData && supabaseData.stock && supabaseData.stock.total_stock !== undefined)
    ? Number(supabaseData.stock.total_stock)
    : Object.values(stock).reduce((acc, v) => acc + (Number(v) || 0), 0);

  const lastSoldDate = (supabaseData && supabaseData.sales && supabaseData.sales.last_sold_date) || null;

  return {
    card_key: cardKey,
    collection,
    stock,
    total_stock: totalStockNum,
    oldest_stock_date: (supabaseData && supabaseData.stock && supabaseData.stock.oldest_stock_date) || null,
    days_in_stock: (supabaseData && supabaseData.stock && supabaseData.stock.days_in_stock) || 0,
    invest,
    purchases,
    sales: {
      ...sales,
      sold_quantity_12m: (supabaseData && supabaseData.sales && supabaseData.sales.sold_quantity_12m !== undefined) ? supabaseData.sales.sold_quantity_12m : totalSold,
      last_sold_date: lastSoldDate
    },
    cote: { 
      last_value: coteData.portal_cote, 
      updated_at: coteData.portal_cote_updated_at,
      source: coteData.portal_cote_source || "cardmarket"
    },
    favorites: (supabaseData && supabaseData.favorites) || { owners: [] },
    favorite_owners: (supabaseData && supabaseData.favorite_owners) || [],
    set_progress: (supabaseData && supabaseData.set_progress) || {},
    card_info: (supabaseData && supabaseData.card_info) || null,
    rarity: (supabaseData && (supabaseData.rarity || supabaseData.card_info?.rarity)) || null,
    active_owners: (supabaseData && supabaseData.active_owners) || ['mathieu', 'ewan', 'leo'],
    internal_confidence,
    warnings
  };
}

const internalCache = new Map();

async function getInternalEnrichment(cardKeysInput, condition, inputVariant, setId, context = {}) {
  const cardKeys = Array.isArray(cardKeysInput) ? cardKeysInput : [cardKeysInput];
  const primaryKey = cardKeys[0];

  let supabasePortal = context.supabase_portal || null;
  let supabaseWarning = null;

  // Supabase Portal API
  if (context.fetch_supabase_portal) {
    const supaCacheKeys = cardKeys.map(k => `supa_${k}`);
    for (const ck of supaCacheKeys) {
      if (internalCache.has(ck)) {
        const cached = internalCache.get(ck);
        if (cached && !cached.error) {
          supabasePortal = cached;
          const w = supabasePortal.cote_history?.warning || supabasePortal.collection?.warning;
          if (w) supabaseWarning = w + " (cached)";
          break;
        }
      }
    }

    if (!supabasePortal) {
      try {
        const sbReader = require('../../connectors/portal/supabase-portal-reader');
        const supabaseDataLive = await sbReader.fetchPortalContextByCardId(cardKeys, { variant: inputVariant });
        supabasePortal = supabaseDataLive;
        if (supabasePortal.warning) {
          supabaseWarning = supabasePortal.warning;
        }
        
        if (setId) {
          const setProgress = await sbReader.fetchSetProgress(setId);
          if (setProgress) {
            supabasePortal.set_progress = setProgress;
          }
        }
        cardKeys.forEach(k => internalCache.set(`supa_${k}`, supabasePortal));
      } catch (e) {
        supabaseWarning = `portal_supabase_error: ${e.message}`;
      }
    }
  }

  // Parse Supabase data (100% source of truth)
  const supabaseData = parseSupabaseData(supabasePortal, primaryKey);

  // Rétrocompatibilité unitaire : support des mocks context.sheets_export sans import réseau
  const sheetsData = parseLegacyMockSheets(context.sheets_export, primaryKey);

  const merged = mergeData(sheetsData, supabaseData, primaryKey, condition);
  if (supabaseWarning) {
    merged.warnings.push(supabaseWarning);
  }
  return merged;
}

module.exports = { getInternalEnrichment, isBetterCondition };

