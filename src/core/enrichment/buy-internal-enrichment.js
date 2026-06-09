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

function generatePortalHints(facts, condition) {
  const hints = {
    priority: "low",
    decision_hint: "info_only",
    headline: "Analyse interne terminée",
    badges: [],
    recommended_destination: "unknown",
    actions: [],
    warnings: []
  };

  if (facts.global.internal_confidence < 0.5) {
    hints.warnings.push("Données internes insuffisantes ou absentes");
  }

  const mat = facts.owners.mathieu;
  const ewan = facts.owners.ewan;
  
  if (facts.global.already_owned_better_condition) {
    hints.priority = "medium";
    hints.decision_hint = "verify_before_buy";
    hints.headline = "Déjà possédée en meilleur état";
    hints.badges.push("Déjà possédée", "Meilleur état existant");
    hints.recommended_destination = "avoid_duplicate";
    hints.actions.push("Vérifier si l'achat améliore vraiment la collection", "Éviter achat collection sauf très bonne décote");
  } else if (!mat.collection_owned && facts.global.internal_confidence > 0.5) {
    hints.priority = "high";
    hints.decision_hint = "buy";
    hints.headline = "Manque dans la collection Mathieu";
    hints.badges.push("Manque Collection M");
    hints.recommended_destination = "collection_mathieu";
    hints.actions.push("Prioriser pour la collection personnelle");
  } else if (!ewan.collection_owned && facts.global.internal_confidence > 0.5) {
    hints.priority = "medium";
    hints.decision_hint = "buy";
    hints.headline = "Manque dans la collection Ewan";
    hints.badges.push("Manque Collection E");
    hints.recommended_destination = "collection_ewan";
    hints.actions.push("Compléter la collection Ewan");
  } else if (facts.global.sale_velocity === "high") {
    hints.priority = "high";
    hints.decision_hint = "buy_more";
    hints.headline = "Forte rotation des ventes";
    hints.badges.push("Vente rapide");
    hints.recommended_destination = "quick_resale";
    hints.actions.push("Bon potentiel d'achat revente");
  } else if (mat.stock_quantity > 3 || ewan.stock_quantity > 3) {
    hints.priority = "low";
    hints.decision_hint = "avoid";
    hints.headline = "Surstock détecté";
    hints.badges.push("Surstock");
    hints.recommended_destination = "avoid_duplicate";
    hints.actions.push("Ne pas acheter, écoulage de stock prioritaire");
  } else {
    hints.priority = "low";
    hints.decision_hint = "info_only";
    hints.headline = "Pas d'opportunité évidente détectée";
    hints.recommended_destination = "stock";
  }

  return hints;
}

async function enrichBuySnapshotWithInternalData(snapshot, context) {
  const items = snapshot.items || [];
  const enrichedItems = [];
  let warningsCount = 0;

  for (const item of items) {
    const cardKey = normalizeCardKey(item);
    const enrichment = await getInternalEnrichment(cardKey, item.condition, context);
    
    const facts = {
      owners: enrichment.owners,
      global: enrichment.global
    };

    const hints = generatePortalHints(facts, item.condition);

    const enrichedItem = {
      line_id: item.line_id || "unknown",
      card_key: cardKey,
      input: item,
      facts: facts,
      portal_hints: hints,
      warnings: enrichment.warnings
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

module.exports = { enrichBuySnapshotWithInternalData, normalizeCardKey, generatePortalHints };
