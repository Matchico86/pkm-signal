const supabaseConnector = require('./supabase');

/**
 * Enregistre les résultats de l'assistant dans Supabase de manière générique.
 * 
 * @param {Object} sessionInfo - Informations de la session
 * @param {string} sessionInfo.domain - Domaine (ex: 'buy', 'sell')
 * @param {string} sessionInfo.slot - Slot (ex: 'validation')
 * @param {string} sessionInfo.external_ref - Référence externe (ex: order ID)
 * @param {Object} sessionInfo.snapshot - Snapshot complet analysé
 * @param {Array} signals - Liste des signaux générés
 */
async function writeAssistantResults(sessionInfo, signals) {
  const { session_id, domain, slot, external_ref, snapshot } = sessionInfo;
  const startTime = Date.now();

  try {
    let finalSessionId = session_id;
    
    // Si pas de session_id fourni (ex: appel local sans passer par le worker)
    if (!finalSessionId) {
      const session = await supabaseConnector.upsertSession(domain, slot, external_ref, snapshot);
      finalSessionId = session.session_id;
    }

    const run = await supabaseConnector.createRun(finalSessionId, domain, slot, snapshot);
    const runId = run.run_id;

    if (signals && signals.length > 0) {
      await supabaseConnector.insertSignals(finalSessionId, runId, domain, slot, signals);
    }

    const duration = Date.now() - startTime;
    await supabaseConnector.updateRunStatus(runId, 'success', duration);
    console.log(`[Supabase] Sauvegarde terminée avec succès en ${duration}ms.`);
    return { success: true, runId, duration };
  } catch (err) {
    console.error(`[Supabase-Writer] Erreur lors de l'enregistrement :`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Marque tous les signaux liés à une entité comme 'resolved'.
 */
async function resolveAssistantSignals(sessionId, entityRef) {
  try {
    await supabaseConnector.updateSignalsStatusByEntity(sessionId, entityRef, 'resolved');
    console.log(`[Supabase-Writer] Signaux neutralisés (resolved) pour l'entité ${entityRef}.`);
    return { success: true };
  } catch (err) {
    console.error(`[Supabase-Writer] Erreur lors de la neutralisation :`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  writeAssistantResults,
  resolveAssistantSignals
};
