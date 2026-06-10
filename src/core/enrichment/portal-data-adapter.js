const { parseSheetsData } = require('./sheets-export-adapter');
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

function mergeData(sheetsData, supabaseData, cardKey, inputCondition) {
  const warnings = [];
  let internal_confidence = 0.0;

  if (!sheetsData && !supabaseData) {
    return {
      card_key: cardKey,
      collection: {},
      stock: {},
      invest: {},
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
  if (sheetsData && supabaseData && sheetsData.global.portal_cote && supabaseData.global.portal_cote && sheetsData.global.portal_cote !== supabaseData.global.portal_cote) {
    warnings.push("conflict_sheets_supabase: portal cote differs");
  }

  const ownersSet = new Set();
  if (sheetsData && sheetsData.owners) Object.keys(sheetsData.owners).forEach(o => ownersSet.add(o));
  if (supabaseData && supabaseData.owners) Object.keys(supabaseData.owners).forEach(o => ownersSet.add(o));
  
  const collection = {};
  const stock = {};
  const invest = {};
  let totalSold = 0;

  ownersSet.forEach(owner => {
    // Supabase has priority for collection
    const supaO = (supabaseData && supabaseData.owners) ? supabaseData.owners[owner] || {} : {};
    const sheetO = (sheetsData && sheetsData.owners) ? sheetsData.owners[owner] || {} : {};
    
    // Sheets fallback for collection if missing in Supabase
    const supaOwned = supaO.collection_owned;
    const owned = supaOwned !== undefined && supaOwned !== false ? supaOwned : (sheetO.collection_owned || false);
    const bestCond = supaO.collection_best_condition || sheetO.collection_best_condition || null;
    
    collection[owner] = { owned, best_condition: bestCond };
    
    // Sheets has priority for stock and invest
    stock[owner] = sheetO.stock_quantity !== undefined ? sheetO.stock_quantity : (supaO.stock_quantity || 0);
    invest[owner] = sheetO.invest_quantity !== undefined ? sheetO.invest_quantity : (supaO.invest_quantity || 0);

    totalSold += (sheetO.sold_quantity_12m || 0);
  });

  const coteData = (supabaseData && supabaseData.global && supabaseData.global.portal_cote) ? supabaseData.global : (sheetsData ? sheetsData.global : { portal_cote: null, portal_cote_updated_at: null });

  return {
    card_key: cardKey,
    collection,
    stock,
    invest,
    sales: { already_sold: totalSold > 0 },
    cote: { last_value: coteData.portal_cote, updated_at: coteData.portal_cote_updated_at },
    internal_confidence,
    warnings
  };
}

const { fetchSheetsBundle } = require('../../connectors/portal/sheets-api-client');
const { fetchPortalContextByCardId } = require('../../connectors/portal/supabase-portal-reader');

const internalCache = new Map();

async function getInternalEnrichment(cardKey, inputCondition, context) {
  let sheetsExport = context.sheets_export;
  let supabasePortal = context.supabase_portal;
  let fetchWarning = null;
  let supabaseWarning = null;
  
  // 1. Fetch Sheets API if requested
  if (context.fetch_sheets_api && !sheetsExport) {
    if (internalCache.has(cardKey)) {
      const cached = internalCache.get(cardKey);
      if (cached && cached.ok) {
        sheetsExport = cached;
      } else if (cached && !cached.ok) {
        fetchWarning = `sheets_api_error: ${cached.error || 'Unknown error'} (cached)`;
      }
    } else {
      const bundle = await fetchSheetsBundle("STOCK,PURCH_ITEMS,SALES_ITEMS,INVEST_ITEMS", cardKey);
      internalCache.set(cardKey, bundle); // Cache success OR failure to prevent spam
      if (bundle && bundle.ok) {
        sheetsExport = bundle;
      } else {
        fetchWarning = `sheets_api_error: ${bundle?.error || 'Unknown error'}`;
      }
    }
  }

  // 2. Fetch Supabase Portal API if requested
  if (context.fetch_supabase_portal && !supabasePortal) {
    const supaCacheKey = `supa_${cardKey}`;
    if (internalCache.has(supaCacheKey)) {
      supabasePortal = internalCache.get(supaCacheKey);
      if (supabasePortal) {
        const w = supabasePortal.cote_history?.warning || supabasePortal.collection?.warning;
        if (w) supabaseWarning = w + " (cached)";
      }
    } else {
      const supaResult = await fetchPortalContextByCardId(cardKey);
      internalCache.set(supaCacheKey, supaResult);
      supabasePortal = supaResult;
      if (supaResult) {
        const w = supaResult.cote_history?.warning || supaResult.collection?.warning;
        if (w) supabaseWarning = w;
      }
    }
  }

  const sheetsData = parseSheetsData(sheetsExport, cardKey);
  const supabaseData = parseSupabaseData(supabasePortal, cardKey);
  
  const merged = mergeData(sheetsData, supabaseData, cardKey, inputCondition);
  if (fetchWarning) {
    merged.warnings.push(fetchWarning);
  }
  if (supabaseWarning) {
    merged.warnings.push(supabaseWarning);
  }
  return merged;
}

module.exports = { getInternalEnrichment };
