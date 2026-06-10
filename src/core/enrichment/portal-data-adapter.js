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
  let finalData = null;

  if (!sheetsData && !supabaseData) {
    return {
      card_key: cardKey,
      collection: {
        mathieu: { owned: false, best_condition: null },
        ewan: { owned: false, best_condition: null }
      },
      stock: { mathieu: 0, ewan: 0 },
      sales: { already_sold: false },
      cote: { last_value: null, updated_at: null },
      internal_confidence: 0.1,
      warnings: ["No internal data found"]
    };
  }

  if (supabaseData && sheetsData) {
    internal_confidence = 1.0;
    finalData = JSON.parse(JSON.stringify(supabaseData));
    
    if (sheetsData.owners.mathieu.stock_quantity !== supabaseData.owners.mathieu.stock_quantity) {
      warnings.push("conflict_sheets_supabase: mathieu stock differs");
    }
    if (sheetsData.global.portal_cote && supabaseData.global.portal_cote && sheetsData.global.portal_cote !== supabaseData.global.portal_cote) {
      warnings.push("conflict_sheets_supabase: portal cote differs");
    }
    if (sheetsData.warnings && sheetsData.warnings.length > 0) {
      warnings.push(...sheetsData.warnings);
    }
  } else if (supabaseData) {
    internal_confidence = 0.9;
    finalData = JSON.parse(JSON.stringify(supabaseData));
  } else if (sheetsData) {
    internal_confidence = 0.7;
    finalData = JSON.parse(JSON.stringify(sheetsData));
    if (sheetsData.warnings && sheetsData.warnings.length > 0) {
      warnings.push(...sheetsData.warnings);
    }
  }

  let totalSold = finalData.owners.mathieu.sold_quantity_12m + finalData.owners.ewan.sold_quantity_12m;
  let alreadySold = totalSold > 0;

  return {
    card_key: cardKey,
    collection: {
      mathieu: {
        owned: finalData.owners.mathieu.collection_owned,
        best_condition: finalData.owners.mathieu.collection_best_condition
      },
      ewan: {
        owned: finalData.owners.ewan.collection_owned,
        best_condition: finalData.owners.ewan.collection_best_condition
      }
    },
    stock: {
      mathieu: finalData.owners.mathieu.stock_quantity,
      ewan: finalData.owners.ewan.stock_quantity
    },
    invest: {
      mathieu: finalData.owners.mathieu.invest_quantity || 0,
      ewan: finalData.owners.ewan.invest_quantity || 0
    },
    sales: {
      already_sold: alreadySold
    },
    cote: {
      last_value: finalData.global.portal_cote,
      updated_at: finalData.global.portal_cote_updated_at
    },
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
