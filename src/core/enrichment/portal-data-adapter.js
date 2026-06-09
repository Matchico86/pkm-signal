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
      owners: {
        mathieu: { collection_owned: false, collection_best_condition: null, stock_quantity: 0, invest_quantity: 0, sold_quantity_12m: 0, last_buy_price: null, average_buy_price: null, last_sell_price: null, average_sell_price: null },
        ewan: { collection_owned: false, collection_best_condition: null, stock_quantity: 0, invest_quantity: 0, sold_quantity_12m: 0, last_buy_price: null, average_buy_price: null, last_sell_price: null, average_sell_price: null }
      },
      global: {
        total_owned_quantity: 0,
        total_sold_quantity: 0,
        sale_velocity: "unknown",
        portal_cote: null,
        portal_cote_updated_at: null,
        already_owned_better_condition: false,
        internal_confidence: 0.1
      },
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

  let totalOwned = 0;
  let totalSold = 0;
  let mathieuBest = finalData.owners.mathieu.collection_best_condition;
  let ewanBest = finalData.owners.ewan.collection_best_condition;

  totalOwned += finalData.owners.mathieu.stock_quantity + finalData.owners.mathieu.invest_quantity;
  totalOwned += finalData.owners.ewan.stock_quantity + finalData.owners.ewan.invest_quantity;
  if (finalData.owners.mathieu.collection_owned) totalOwned++;
  if (finalData.owners.ewan.collection_owned) totalOwned++;

  totalSold += finalData.owners.mathieu.sold_quantity_12m + finalData.owners.ewan.sold_quantity_12m;

  let alreadyBetter = false;
  if (inputCondition) {
    if (
      (finalData.owners.mathieu.collection_owned && isBetterCondition(mathieuBest, inputCondition)) || 
      (finalData.owners.ewan.collection_owned && isBetterCondition(ewanBest, inputCondition))
    ) {
      alreadyBetter = true;
    }
  }

  return {
    card_key: cardKey,
    owners: finalData.owners,
    global: {
      total_owned_quantity: totalOwned,
      total_sold_quantity: totalSold,
      sale_velocity: getSaleVelocity(totalSold),
      portal_cote: finalData.global.portal_cote,
      portal_cote_updated_at: finalData.global.portal_cote_updated_at,
      already_owned_better_condition: alreadyBetter,
      internal_confidence
    },
    warnings
  };
}

const { fetchSheetsBundle } = require('../../connectors/portal/sheets-api-client');

const internalCache = new Map();

async function getInternalEnrichment(cardKey, inputCondition, context) {
  let sheetsExport = context.sheets_export;
  let fetchWarning = null;
  
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

  const sheetsData = parseSheetsData(sheetsExport, cardKey);
  const supabaseData = parseSupabaseData(context.supabase_portal, cardKey);
  
  const merged = mergeData(sheetsData, supabaseData, cardKey, inputCondition);
  if (fetchWarning) {
    merged.warnings.push(fetchWarning);
  }
  return merged;
}

module.exports = { getInternalEnrichment };
