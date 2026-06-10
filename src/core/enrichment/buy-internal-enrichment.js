const { getInternalEnrichment, isBetterCondition } = require('./portal-data-adapter');

function normalizeCardKey(item) {
  // Priorité au format TCGDex (ex: TWM-188-FR) car c'est ce que Sheets et Supabase attendent
  if (item.set_id && item.number) {
    const lang = item.language || "FR";
    return `${item.set_id}-${item.number}-${lang}`.toUpperCase();
  }

  if (item.card_id) {
    return item.card_id.toUpperCase();
  }

  const name = item.name || item.card_name || "unknown";
  const set = item.set_name || item.set_id || "unknown";
  const num = item.number || "unknown";
  return `${name}_${set}_${num}`.toUpperCase().replace(/[^A-Z0-9-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function generateSimpleSignals(facts, confidence, item = {}) {
  const signals = [];

  if (confidence < 0.5) {
    signals.push({
      type: "missing_data",
      owner: "global",
      severity: "warning",
      message: "Données internes insuffisantes ou absentes"
    });
    return signals;
  }

  const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

  const c = facts.collection || {};
  const ownersWithCollection = Object.keys(c).filter(o => c[o].owned);
  
  if (ownersWithCollection.length > 0) {
    const upgradeOwners = ownersWithCollection.filter(o => {
      const existingCond = c[o].best_condition;
      // On vérifie si la condition de la carte entrante est STRICTEMENT meilleure
      // On s'assure aussi que l'utilisateur a vraiment fourni une condition entrante
      return item.condition && existingCond && isBetterCondition(existingCond, item.condition) && existingCond.toUpperCase() !== item.condition.toUpperCase();
    });

    if (upgradeOwners.length > 0) {
      const names = upgradeOwners.map(capitalize).join(' & ');
      const existingConds = upgradeOwners.map(o => c[o].best_condition).join(', ');
      signals.push({ type: "collection_status", owner: upgradeOwners.length === 1 ? upgradeOwners[0] : "global", severity: "info", message: `Opportunité d'upgrade (${names} a ${existingConds} -> ${item.condition})` });
    } else {
      const names = ownersWithCollection.map(capitalize).join(' & ');
      signals.push({ type: "collection_status", owner: ownersWithCollection.length === 1 ? ownersWithCollection[0] : "global", severity: "info", message: `Déjà en collection (${names})` });
    }
  } else {
    // Determine set progress if available
    let progressStr = "";
    // We check if the global owner or mathieu has set_progress.
    // If not, we just show Absente des collections
    let bestProgress = null;
    Object.keys(c).forEach(o => {
      if (c[o].set_progress && (!bestProgress || c[o].set_progress.percent > bestProgress.percent)) {
        bestProgress = c[o].set_progress;
      }
    });

    if (bestProgress && bestProgress.total > 0 && item.set_id) {
      progressStr = ` (Set ${item.set_id}: ${bestProgress.owned}/${bestProgress.total} - ${bestProgress.percent}%)`;
    }

    signals.push({ type: "collection_status", owner: "global", severity: "info", message: `Absente des collections${progressStr}` });
  }

  const s = facts.stock || {};
  const ownersWithStock = Object.keys(s).filter(o => s[o] > 0);
  if (ownersWithStock.length > 0) {
    const details = ownersWithStock.map(o => `${capitalize(o).substring(0,1)}:${s[o]}`).join(', ');
    signals.push({ type: "stock_status", owner: ownersWithStock.length === 1 ? ownersWithStock[0] : "global", severity: "info", message: `En stock (${details})` });
  } else {
    signals.push({ type: "stock_status", owner: "global", severity: "info", message: "Aucun stock" });
  }

  const i = facts.invest || {};
  const ownersWithInvest = Object.keys(i).filter(o => i[o] > 0);
  if (ownersWithInvest.length > 0) {
    const details = ownersWithInvest.map(o => `${capitalize(o).substring(0,1)}:${i[o]}`).join(', ');
    signals.push({ type: "invest_status", owner: ownersWithInvest.length === 1 ? ownersWithInvest[0] : "global", severity: "info", message: `En invest (${details})` });
  } else {
    signals.push({ type: "invest_status", owner: "global", severity: "info", message: "Aucun stock invest" });
  }

  const p = facts.purchases || {};
  const ownersWithPurchases = Object.keys(p).filter(o => p[o].last_buy_price !== null || p[o].average_buy_price !== null);
  if (ownersWithPurchases.length > 0) {
    const details = ownersWithPurchases.map(o => {
      const avg = p[o].average_buy_price;
      const val = (avg !== null && !isNaN(avg)) ? Math.round(avg) : '-';
      return `${capitalize(o).substring(0,1)}:${val}€`;
    }).join(', ');
    signals.push({ type: "buy_status", owner: ownersWithPurchases.length === 1 ? ownersWithPurchases[0] : "global", severity: "info", message: `Achat moyen (${details})` });
  } else {
    signals.push({ type: "buy_status", owner: "global", severity: "info", message: "Aucun achat connu" });
  }

  if (facts.cote && facts.cote.last_value) {
    signals.push({
      type: "cote_known",
      owner: "global",
      severity: "info",
      message: `Cote connue: ${facts.cote.last_value}€`
    });
  } else {
    signals.push({
      type: "cote_missing",
      owner: "global",
      severity: "warning",
      message: "Aucune cote connue"
    });
  }

  return signals;
}

async function enrichBuySnapshotWithInternalData(snapshot, context) {
  const items = snapshot.items || [];
  const enrichedItems = [];
  let warningsCount = 0;

  for (const item of items) {
    const primaryKey = normalizeCardKey(item);
    const altKey = item.card_id ? item.card_id.toLowerCase() : null;
    const cardKeys = [...new Set([primaryKey, altKey, item.card_id].filter(Boolean))];
    
    const enrichment = await getInternalEnrichment(cardKeys, item.condition, item.variant, item.set_id, context);
    
    const facts = {
      collection: enrichment.collection,
      stock: enrichment.stock,
      invest: enrichment.invest,
      purchases: enrichment.purchases,
      sales: enrichment.sales,
      cote: enrichment.cote
    };

    if (item.internal_market_price_unit !== undefined && item.internal_market_price_unit !== null) {
      facts.cote.last_value = item.internal_market_price_unit;
    }

    const confidence = enrichment.internal_confidence;
    const signals = generateSimpleSignals(facts, confidence, item);

    const enrichedItem = {
      line_id: item.line_id || "unknown",
      card_id: item.card_id || "unknown",
      facts: facts,
      simple_signals: signals,
      warnings: enrichment.warnings,
      confidence: confidence
    };

    if (enrichment.warnings.length > 0) {
      warningsCount++;
    }

    enrichedItems.push(enrichedItem);
  }

  const sources = [];
  if (context.sheets_export) sources.push("sheets_export");
  if (context.supabase_portal) sources.push("supabase_portal");
  if (context.fetch_sheets_api) sources.push("sheets_api");
  if (context.fetch_supabase_portal) sources.push("supabase_portal_api");

  return {
    snapshot_ref: snapshot.snapshot_ref || "unknown",
    items: enrichedItems,
    summary: {
      items_enriched: enrichedItems.length,
      items_with_warnings: warningsCount,
      sources_used: sources
    }
  };
}

module.exports = { enrichBuySnapshotWithInternalData, normalizeCardKey, generateSimpleSignals };
