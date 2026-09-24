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

  let runId = null;

  try {
    let finalSessionId = session_id;
    const isUuid = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    
    // Si pas de session_id fourni ou si c'est une référence externe textuelle
    if (!finalSessionId || !isUuid(finalSessionId)) {
      const session = await supabaseConnector.upsertSession(domain, slot, external_ref || session_id || 'unknown_order', snapshot);
      finalSessionId = session.session_id;
    }

    const run = await supabaseConnector.createRun(finalSessionId, domain, slot, snapshot);
    runId = run?.run_id;

    if (signals && signals.length > 0) {
      // Neutraliser les signaux précédents pour les entités concernées afin d'éviter les doublons/zombies
      for (const sig of signals) {
        if (sig.entity_ref) {
          try {
            await supabaseConnector.updateSignalsStatusByEntity(finalSessionId, sig.entity_ref, 'superseded');
          } catch (e) {
            // Fallback silencieux si la neutralisation échoue
          }
        }
      }
      await supabaseConnector.insertSignals(finalSessionId, runId, domain, slot, signals);
    }

    const duration = Date.now() - startTime;
    if (runId) {
      await supabaseConnector.updateRunStatus(runId, 'success', duration);
    }
    console.log(`[Supabase] Sauvegarde terminée avec succès en ${duration}ms.`);
    return { success: true, runId, duration };
  } catch (err) {
    const duration = Date.now() - startTime;
    if (runId) {
      try {
        await supabaseConnector.updateRunStatus(runId, 'failed', duration);
      } catch (statusErr) {
        // ignore secondary error
      }
    }
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
