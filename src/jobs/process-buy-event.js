const { enrichBuySnapshotWithInternalData } = require('../core/enrichment/buy-internal-enrichment');
const { writeAssistantResults, resolveAssistantSignals } = require('../connectors/supabase-writer');
const { buildBuyAnalysisPayload } = require('../core/enrichment/buy-analysis-meta');
const { recordLiveAssistCall, getQuotasSummary } = require('../connectors/prices/rapidapi-quota-guard');
const { evaluateLiveRecotEligibility } = require('../core/enrichment/recot-guard');
const { fetchCardmarketData, recordLiveCoteInSupabase } = require('../connectors/prices/cardmarket-client');
const { fetchCardmarketTcgPrice, readCardmarketTcgCache } = require('../connectors/prices/cardmarket-tcg-client');
const { fetchRarebitPrice } = require('../connectors/prices/pokemontcg-rarebit-client');
const { getAllQuotasSummary } = require('../connectors/prices/multi-api-quota-guard');

/**
 * Traite un event asynchrone unitaire (nouveau format).
 */
async function processBuyEvent(eventPayload, existingSessionId = null) {
  try {
    console.log(`[Job Event] Traitement de l'événement : ${eventPayload.event_type}`);

    if (eventPayload.event_type === 'remove_line') {
      if (!eventPayload.line_id) {
        console.warn(`[Job Event] remove_line ignoré: line_id manquant.`);
        return;
      }
      const targetSessionId = existingSessionId || eventPayload.session_id;
      if (targetSessionId) {
        await resolveAssistantSignals(targetSessionId, eventPayload.line_id);
      } else {
        console.log(`[Job Event] remove_line traité (aucun session_id spécifié pour la neutralisation en base).`);
      }
      return;
    }

    if (eventPayload.event_type === 'update_order') {
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

      console.log(`\n--- DEBUG PAYLOAD COMPLET ---`);
      console.log(JSON.stringify(eventPayload, null, 2));

      // Adapter vers le format attendu par le moteur interne
      const miniSnapshot = {
        domain: 'buy',
        items: [line]
      };

      console.log(`\n[Enrichissement] Récupération du contexte interne pour ${line.card_id}...`);
      const enrichedSnapshot = await enrichBuySnapshotWithInternalData(miniSnapshot, {
        fetch_supabase_portal: true
      });

      const enrichedItem = (enrichedSnapshot.items && enrichedSnapshot.items[0]) || {};
      const facts = enrichedItem.facts || enrichedItem.raw_facts || {};

      const recotEligibility = evaluateLiveRecotEligibility(line, facts);
      let recoted = false;
      let recotSkipReason = recotEligibility.eligible ? null : recotEligibility.reason;

      const platforms = {};

      if (facts.cote && facts.cote.last_value > 0) {
        platforms.bdd = {
          source: 'bdd',
          label: 'BDD',
          price: Number(facts.cote.last_value),
          updated_at: facts.cote.updated_at
        };
      }

      // Vérifier si une cotation CardMarket récente est déjà en cache local 24h
      const cachedCm = readCardmarketTcgCache(line.card_id);
      if (cachedCm && cachedCm.price > 0) {
        platforms.cardmarket_tcg = cachedCm;
        recoted = true;
        console.log(`[Job Event] [CM TCG] Cotation trouvée en cache pour ${line.card_id}: ${cachedCm.price}€ (${cachedCm.lang} ${cachedCm.condition})`);
      }

      if (recotEligibility.eligible) {
        const fetchTasks = [];

        // Appeler CardMarket si pas déjà en cache local
        if (!platforms.cardmarket_tcg) {
          fetchTasks.push(
            fetchCardmarketTcgPrice({
              card_id: line.card_id,
              cardmarket_id: line.cardmarket_id || (facts.cardmarket_id || facts.cardmarketId),
              name: line.card_name,
              number: line.number,
              set_id: line.set_id,
              set_name: line.set_name || facts.set_name
            }).then(res => ({ type: 'cm', ...res }))
          );
        }

        // Appeler RareBit en parallèle
        fetchTasks.push(
          fetchRarebitPrice({
            card_id: line.card_id,
            tcgdex_id: line.tcgdex_id,
            name: line.card_name,
            number: line.number,
            set_id: line.set_id
          }).then(res => ({ type: 'rarebit', ...res }))
        );

        if (fetchTasks.length > 0) {
          console.log(`[Job Event] Requêtes multi-API pour ${line.card_id}...`);
          const results = await Promise.allSettled(fetchTasks);
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value?.success) {
              if (r.value.type === 'cm') {
                platforms.cardmarket_tcg = r.value;
                recoted = true;
                console.log(`[Job Event] [CM TCG] Cotation reçue pour ${line.card_id}: ${r.value.price}€ (${r.value.lang} ${r.value.condition}). Quota: ${r.value.quota_display}`);
              } else if (r.value.type === 'rarebit') {
                platforms.rarebit = r.value;
                recoted = true;
                console.log(`[Job Event] [RareBit] Cotation reçue pour ${line.card_id}: ${r.value.price}€ (${r.value.lang} ${r.value.condition}). Quota: ${r.value.quota_display}`);
              }
            }
          }
        }
      } else {
        console.log(`[Job Event] Recotation externe réseau non requise pour ${line.card_id} (${recotSkipReason}).`);
      }

      const quotasSummary = getQuotasSummary();
      const multiQuotas = getAllQuotasSummary();

      const analysisPayload = buildBuyAnalysisPayload(facts, line, {
        activeOwners: facts.active_owners || ['mathieu', 'ewan', 'leo'],
        recoted,
        recotSkipReason,
        platforms,
        quota: quotasSummary.live_assist,
        quotas: { ...quotasSummary, ...multiQuotas }
      });

      // Construire le message lisible (pour l'UI de PKM Portal)
      const messages = [];

      // Affichage spécifique multi-plateformes et du compteur de quota
      for (const [key, pData] of Object.entries(platforms)) {
        if (pData && pData.price > 0) {
          const formattedPrice = String(pData.price.toFixed(2)).replace('.', ',');
          const langStr = (pData.lang && pData.lang !== 'FR') ? ` ${pData.lang}` : '';
          const condStr = (pData.condition && pData.condition !== 'NM') ? ` ${pData.condition}` : '';
          const label = pData.label || key.toUpperCase();
          let msg = `${label}${langStr}${condStr} : ${formattedPrice}€`;
          if (pData.remaining !== undefined) {
            msg += ` (reste ${pData.remaining})`;
          }
          messages.push(msg);
        } else if (pData && pData.quota_exceeded) {
          const label = pData.label || key.toUpperCase();
          messages.push(`/!\\ ${label}`);
        }
      }

      if (enrichedItem.simple_signals && enrichedItem.simple_signals.length > 0) {
        enrichedItem.simple_signals.forEach(sig => {
          if (sig.type !== 'cote_missing' && sig.type !== 'missing_data') {
            messages.push(sig.message);
          }
        });
      }

      const combinedMessage = messages.length > 0 ? messages.join(' • ') : "Analyse terminée.";

      const mappedSignals = [{
        signal_type: 'card_analysis',
        severity: 'info',
        title: 'card_analysis',
        card_id: line.card_id,
        message: combinedMessage,
        entity_type: 'line',
        entity_ref: line.line_id,
        payload: analysisPayload,
        status: 'active'
      }];

      // On loggue les résultats
      console.log(`\n=== RÉSULTATS : SIGNAUX ÉVÉNEMENTIELS (card_analysis) ===`);
      console.log(`Message affiché : "${combinedMessage}"`);
      console.log(JSON.stringify(analysisPayload, null, 2));

      if (enrichedItem.warnings && enrichedItem.warnings.length > 0) {
        console.warn(`[Job Event] Warnings de l'enrichissement :`, enrichedItem.warnings);
      }

      // Enregistrement dans Supabase
      const sessionInfo = {
        session_id: existingSessionId || eventPayload.session_id,
        domain: 'buy',
        slot: 'buy.order',
        external_ref: eventPayload.draft_order_id || eventPayload.session_id || 'unknown_order',
        snapshot: miniSnapshot
      };

      console.log(`\n[Supabase] Connexion et sauvegarde des résultats événementiels...`);
      await writeAssistantResults(sessionInfo, mappedSignals);
      console.log(`\n[Job Event] Terminé avec succès.`);
      return;
    }

    console.warn(`[Job Event] Type d'événement non reconnu : ${eventPayload.event_type}`);
  } catch (err) {
    console.error(`[Job Event] Erreur lors du traitement de l'événement:`, err.message || err);
  }
}

module.exports = {
  processBuyEvent
};
