require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { processBuySnapshot } = require('./jobs/process-buy-snapshot');
const { processBuyEvent } = require('./jobs/process-buy-event');
const { processSellSnapshot } = require('./jobs/process-sell-snapshot');

let supabase = null;
let channel = null;
let server = null;

const crypto = require('crypto');

// Cache mémoire des hash de snapshot par session pour protection anti-boucles Realtime
const sessionSnapshotHashCache = new Map();

function computeSnapshotHash(snapshot) {
  if (!snapshot) return null;
  const str = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Routeur principal
 * Vérifie le champ slot pour router vers le bon job et protège contre les boucles Realtime
 */
async function handleSessionEvent(payload) {
  try {
    const record = payload.new;
    if (!record) return;

    const { session_id, slot, latest_snapshot } = record;
    const eventType = payload.eventType || payload.event || (payload.old ? 'UPDATE' : 'INSERT');

    const snapshotHash = computeSnapshotHash(latest_snapshot);

    // Protection anti-boucle Realtime : si UPDATE avec hash identique, on ignore
    if (eventType === 'UPDATE' && session_id && snapshotHash) {
      const lastHash = sessionSnapshotHashCache.get(session_id);
      if (lastHash && lastHash === snapshotHash) {
        console.log(`[Worker] Snapshot inchangé pour la session ${session_id} (hash: ${snapshotHash.slice(0, 8)}). Événement ignoré (anti-boucle Realtime).`);
        return false;
      }
    }

    // Mémoriser le hash actuel pour cette session
    if (session_id && snapshotHash) {
      sessionSnapshotHashCache.set(session_id, snapshotHash);
      if (sessionSnapshotHashCache.size > 1000) {
        const firstKey = sessionSnapshotHashCache.keys().next().value;
        sessionSnapshotHashCache.delete(firstKey);
      }
    }

    if (slot === 'buy.order' || slot === 'upsert_line' || slot === 'remove_line' || slot === 'update_order' || slot === 'batch') {
      if (latest_snapshot) {
        if (latest_snapshot.event_type === 'batch' && Array.isArray(latest_snapshot.events)) {
          // Batch mode: le portal envoie N events dans un seul snapshot
          console.log(`[Worker] Batch reçu: ${latest_snapshot.events.length} événement(s) (session: ${session_id})`);
          for (const subEvent of latest_snapshot.events) {
            if (subEvent.event_type === 'remove_line' || subEvent.event_type === 'update_order' || subEvent.event_type === 'upsert_line') {
              await processBuyEvent({ ...subEvent }, session_id);
            } else {
              console.warn(`[Worker] Sub-event batch ignoré: ${subEvent.event_type}`);
            }
          }
        } else if (latest_snapshot.event_type) {
          console.log(`[Worker] Événement reçu: buy.order event ${latest_snapshot.event_type} (session: ${session_id})`);
          await processBuyEvent(latest_snapshot, session_id);
        } else {
          console.log(`[Worker] Événement reçu: buy.order full snapshot (session: ${session_id})`);
          await processBuySnapshot(latest_snapshot, session_id);
        }
      } else {
        console.warn(`[Worker] latest_snapshot manquant pour la session ${session_id}`);
      }
    } else if (slot === 'sell.order') {
      console.log(`[Worker] Événement reçu: sell.order (session: ${session_id})`);
      if (latest_snapshot) {
        await processSellSnapshot(latest_snapshot);
      } else {
        console.warn(`[Worker] latest_snapshot manquant pour la session ${session_id}`);
      }
    }
    return true;
  } catch (err) {
    console.error(`[Worker] Erreur lors du traitement de sessionEvent:`, err.message || err);
    return false;
  }
}

if (require.main === module) {
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Worker] Unhandled Rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[Worker] Uncaught Exception:', err.message || err);
  });

  const isHttpUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);
  const supabaseUrl = (isHttpUrl(process.env.SUPABASE_URL) ? process.env.SUPABASE_URL : process.env.PKM_PORTAL_SUPABASE_URL) || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    console.error('[Worker] Supabase credentials manquants. Arrêt du worker.');
    process.exit(1);
  }

  supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`[Worker] Démarrage de PKM Signal Worker...`);
  console.log(`[Worker] Connexion à Supabase: ${supabaseUrl}`);

  function setupSubscription() {
    if (channel) {
      try { supabase.removeChannel(channel); } catch {}
    }

    channel = supabase.channel(`assist_sessions_worker_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'assist_sessions' },
        handleSessionEvent
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'assist_sessions' },
        handleSessionEvent
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Worker] Abonné aux changements de la table assist_sessions.');
        } else {
          console.log(`[Worker] Statut de l'abonnement: ${status}`);
          if (err) console.error('[Worker] Détails de l\'erreur:', err);
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.log('[Worker] Tentative de réabonnement dans 5s...');
            setTimeout(setupSubscription, 5000);
          }
        }
      });
  }

  setupSubscription();

  // --- MINI SERVEUR HTTP POUR LE HEARTBEAT (PORTAL) ---
  const http = require('http');
  const rawPort = process.env.PORT;
  const PORT = (!isNaN(rawPort) && Number(rawPort) > 0) ? Number(rawPort) : 3000;

  server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      return res.end(JSON.stringify({ 
        ok: true, 
        workerAlive: true 
      }));
    }

    if (req.url && req.url.startsWith('/api/cardmarket/quote')) {
      const urlObj = new URL(req.url, 'http://localhost:' + PORT);
      const cardmarketId = urlObj.searchParams.get('cardmarket_id') || urlObj.searchParams.get('idProduct');
      if (!cardmarketId) {
        res.writeHead(400);
        return res.end(JSON.stringify({ ok: false, error: 'missing_cardmarket_id' }));
      }
      try {
        const { scrapeCardmarketFrNm } = require('./connectors/prices/cardmarket-playwright-scraper');
        const result = await scrapeCardmarketFrNm(cardmarketId, { timeoutMs: 25000, keepBrowserAlive: true });
        res.writeHead(result.success ? 200 : 422);
        return res.end(JSON.stringify({ ok: result.success, ...result }));
      } catch (e) {
        res.writeHead(500);
        return res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Heartbeat] Port ${PORT} déjà utilisé, le heartbeat HTTP fonctionnera en mode headless.`);
    } else {
      console.error('[Heartbeat] Erreur serveur HTTP:', err.message);
    }
  });

  try {
    server.listen(PORT, () => {
      console.log(`[Heartbeat] Serveur HTTP d'état actif sur le port ${PORT}`);
    });
  } catch (e) {
    console.warn(`[Heartbeat] Impossible d'écouter sur le port ${PORT}:`, e.message);
  }

  // Gestion propre de l'arrêt
  process.on('SIGINT', () => {
    console.log('[Worker] Arrêt demandé...');
    if (supabase && channel) {
      supabase.removeChannel(channel).then(() => {
        if (server) server.close();
        process.exit(0);
      });
    } else {
      if (server) server.close();
      process.exit(0);
    }
  });
}

module.exports = {
  handleSessionEvent,
  computeSnapshotHash,
  sessionSnapshotHashCache
};

