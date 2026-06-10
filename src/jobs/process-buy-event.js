const { enrichBuySnapshotWithInternalData } = require('../core/enrichment/buy-internal-enrichment');
const { writeAssistantResults, resolveAssistantSignals } = require('../connectors/supabase-writer');

/**
 * Mappe un simple_signal (du nouvel enrichisseur) vers le format historique attendu par writeAssistantResults
 */
function mapSimpleSignalToAssistantSignal(signal, item) {
  // severity attendu : "warning" | "info"
  // level attendu par writeAssistantResults : "warning" | "info" (via insertSignals)
  return {
    type: signal.type,
    level: signal.severity,
    message: signal.message,
    context: {
      draft_item_id: item.line_id,
      card_id: item.card_id,
      owner: signal.owner || "global"
    }
  };
}

/**
 * Traite un event asynchrone unitaire (nouveau format).
 */
async function processBuyEvent(eventPayload, existingSessionId = null) {
  console.log(`[Job Event] Traitement de l'événement : ${eventPayload.event_type}`);

  if (eventPayload.event_type === 'remove_line') {
    if (!eventPayload.line_id) {
      console.warn(`[Job Event] remove_line ignoré: line_id manquant.`);
      return;
    }
    await resolveAssistantSignals(existingSessionId, eventPayload.line_id);
    return;
  }

  if (eventPayload.event_type === 'update_order') {
    // Le recalcul global de l'ordre viendra plus tard. On logue juste pour le moment.
    console.log(`[Job Event] update_order reçu. Mise à jour de contexte de session (non implémenté analytiquement).`);
    return;
  }

  if (eventPayload.event_type === 'upsert_line') {
    const line = eventPayload.item || eventPayload;
    
    if (!line.line_id) {
      console.warn(`[Job Event] upsert_line ignoré: line_id manquant.`);
      return;
    }

    if (!line.card_id || line.card_id === "undefined") {
      console.warn(`[Job Event] upsert_line ignoré pour line_id=${line.line_id}: card_id absent ou invalide.`);
      return;
    }

    // On crée un mini-snapshot pour l'enrichisseur
    const miniSnapshot = {
      snapshot_ref: existingSessionId || "event-snapshot",
      items: [line]
    };

    // Contexte avec fetch actif pour appeler les connecteurs
    const context = {
      fetch_supabase_portal: true,
      fetch_sheets_api: true
    };

    console.log(`[Job Event] Enrichissement interne pour la ligne ${line.line_id} (card_id=${line.card_id})...`);
    const enrichedData = await enrichBuySnapshotWithInternalData(miniSnapshot, context);

    if (enrichedData.items.length === 0) {
      console.warn(`[Job Event] Aucun résultat d'enrichissement pour la ligne ${line.line_id}.`);
      return;
    }

    const enrichedItem = enrichedData.items[0];
    
    // Mapping des simple_signals vers des signaux compatibles Supabase Writer
    const mappedSignals = (enrichedItem.simple_signals || []).map(sig => 
      mapSimpleSignalToAssistantSignal(sig, enrichedItem)
    );

    // On loggue les résultats
    console.log(`\n=== RÉSULTATS : SIGNAUX ÉVÉNEMENTIELS (${mappedSignals.length}) ===`);
    mappedSignals.forEach((signal, index) => {
      console.log(`\n[Signal #${index + 1}] - ${signal.type.toUpperCase()}`);
      console.log(`  Severity: ${signal.level}`);
      console.log(`  Message : ${signal.message}`);
      console.log(`  Owner   : ${signal.context.owner}`);
    });

    // Enregistrement dans Supabase
    const sessionInfo = {
      session_id: existingSessionId,
      domain: 'buy',
      slot: 'buy.order',
      external_ref: eventPayload.draft_order_id || 'unknown_order',
      snapshot: miniSnapshot // ou juste eventPayload
    };

    console.log(`\n[Supabase] Connexion et sauvegarde des résultats événementiels...`);
    await writeAssistantResults(sessionInfo, mappedSignals);
    console.log(`\n[Job Event] Terminé avec succès.`);
    return;
  }

  console.warn(`[Job Event] Type d'événement non reconnu : ${eventPayload.event_type}`);
}

module.exports = {
  processBuyEvent,
  mapSimpleSignalToAssistantSignal
};
