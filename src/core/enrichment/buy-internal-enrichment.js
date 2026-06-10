const { getInternalEnrichment } = require('./portal-data-adapter');

function normalizeCardKey(item) {
  if (item.card_id) {
    return item.card_id.toLowerCase();
  }
  
  if (item.set_id && item.number) {
    const lang = item.language || "fr";
    return `${item.set_id}_${item.number}_${lang}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }

  const name = item.name || "unknown";
  const set = item.set_name || "unknown";
  const num = item.number || "unknown";
  return `${name}_${set}_${num}`.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function generateSimpleSignals(facts, confidence) {
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
    const names = ownersWithCollection.map(capitalize).join(' & ');
    signals.push({ type: "collection_status", owner: ownersWithCollection.length === 1 ? ownersWithCollection[0] : "global", severity: "info", message: `Déjà en collection (${names})` });
  } else {
    signals.push({ type: "collection_status", owner: "global", severity: "info", message: "Absente des collections" });
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
    const cardKey = normalizeCardKey(item);
    const enrichment = await getInternalEnrichment(cardKey, item.condition, context);
    
    const facts = {
      collection: enrichment.collection,
      stock: enrichment.stock,
      invest: enrichment.invest,
      sales: enrichment.sales,
      cote: enrichment.cote
    };

    if (item.internal_market_price_unit !== undefined && item.internal_market_price_unit !== null) {
      facts.cote.last_value = item.internal_market_price_unit;
    }

    const confidence = enrichment.internal_confidence;
    const signals = generateSimpleSignals(facts, confidence);

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
