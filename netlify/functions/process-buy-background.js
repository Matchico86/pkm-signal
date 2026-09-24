const { validateBuyOrderSnapshot } = require('../../src/core/contracts/buy.order.snapshot');
const { checkMargin } = require('../../src/core/patterns/buy/margin-check');
const { checkOpportunity } = require('../../src/core/patterns/buy/opportunity-check');
const { checkCollection } = require('../../src/core/patterns/buy/collection-check');
const { checkStock } = require('../../src/core/patterns/buy/stock-check');
const { checkLiquidity } = require('../../src/core/patterns/buy/liquidity-check');
const supabaseConnector = require('../../src/connectors/supabase');

const API_KEY = process.env.SIGNAL_API_KEY;

/**
 * Netlify Background Function
 * Nommée avec le suffixe `-background`, Netlify renvoie immédiatement un `202 Accepted`
 * à l'appelant (Portal) et exécute ce code en arrière-plan (jusqu'à 15 minutes).
 */
exports.handler = async function (event, context) {
  // 1. Vérification basique de la méthode
  if (event.httpMethod !== 'POST') {
    console.error('[Erreur] Seul le POST est accepté.');
    return; // Dans une Background Function, le return ne fait que terminer l'exécution silencieusement.
  }

  // 2. Vérification de sécurité (Fail-closed : aucune clé par défaut permise)
  if (!API_KEY) {
    console.error('[Erreur Critique] SIGNAL_API_KEY non configurée dans l\'environnement. Exécution refusée (fail-closed).');
    return;
  }

  const reqKey = event.headers['x-api-key'] || event.headers['X-Api-Key'];
  if (!reqKey || reqKey !== API_KEY) {
    console.error('[Erreur] Unauthorized. Invalid or missing x-api-key.');
    return;
  }

  let rawData;
  try {
    rawData = JSON.parse(event.body);
  } catch (err) {
    console.error('[Erreur] Body JSON invalide:', err.message);
    return;
  }

  const domain = 'buy';
  const slot = 'validation';

  try {
    // 3. Validation du contrat
    const snapshot = validateBuyOrderSnapshot(rawData);
    const externalRef = snapshot.draft_order_id;
    console.log(`[Job] Traitement en arrière-plan démarré pour: ${externalRef}`);

    const startTime = Date.now();
    let runId = null;

    try {
      // 4. Initialisation Supabase (Session + Run)
      const session = await supabaseConnector.upsertSession(domain, slot, externalRef, snapshot);
      const run = await supabaseConnector.createRun(session.session_id, domain, slot, snapshot);
      runId = run.run_id;

      // 5. Exécution des patterns
      const allSignals = [];
      allSignals.push(...checkMargin(snapshot));
      allSignals.push(...checkOpportunity(snapshot));
      allSignals.push(...checkCollection(snapshot));
      allSignals.push(...checkStock(snapshot));
      allSignals.push(...checkLiquidity(snapshot));

      console.log(`[Job] ${allSignals.length} signaux générés pour la commande ${externalRef}`);

      // 6. Écriture des signaux dans Supabase
      if (allSignals.length > 0) {
        await supabaseConnector.insertSignals(session.session_id, runId, domain, slot, allSignals);
      }

      // 7. Clôture du Run
      const duration = Date.now() - startTime;
      await supabaseConnector.updateRunStatus(runId, 'success', duration);
      console.log(`[Job] Traitement terminé avec succès en ${duration}ms.`);

    } catch (asyncErr) {
      console.error('[Erreur Asynchrone] Échec pendant le traitement métier ou Supabase:', asyncErr);
      if (runId) {
        const duration = Date.now() - startTime;
        await supabaseConnector.updateRunStatus(runId, 'failed', duration, asyncErr.message);
      }
    }

  } catch (validationErr) {
    console.error('[Erreur de Validation] Le payload ne respecte pas le contrat.', validationErr.errors || validationErr.message);
    // Comme on est en background, on ne peut plus répondre 400. On logge juste l'erreur.
  }
};
