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

  const c = facts.collection;
  if (c.mathieu.owned) {
    let msg = "Déjà en collection Mathieu";
    if (c.mathieu.best_condition) msg += ` (${c.mathieu.best_condition})`;
    signals.push({ type: "collection_owned", owner: "mathieu", severity: "info", message: msg });
  }
  
  if (c.ewan.owned) {
    let msg = "Déjà en collection Ewan";
    if (c.ewan.best_condition) msg += ` (${c.ewan.best_condition})`;
    signals.push({ type: "collection_owned", owner: "ewan", severity: "info", message: msg });
  }

  const totalStock = facts.stock.mathieu + facts.stock.ewan;
  if (totalStock > 0) {
    signals.push({
      type: "already_in_stock",
      owner: "global",
      severity: "info",
      message: `Déjà en stock (M:${facts.stock.mathieu}, E:${facts.stock.ewan})`
    });
  }

  if (facts.sales.already_sold) {
    signals.push({
      type: "already_sold",
      owner: "global",
      severity: "info",
      message: "Déjà vendu historiquement"
    });
  }

  if (facts.cote.last_value) {
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
      sales: enrichment.sales,
      cote: enrichment.cote
    };

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
