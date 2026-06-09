require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { processBuySnapshot } = require('./jobs/process-buy-snapshot');
const { processSellSnapshot } = require('./jobs/process-sell-snapshot');

// Initialisation de Supabase
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('[Worker] Supabase credentials manquants. Arrêt du worker.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log(`[Worker] Démarrage de PKM Signal Worker...`);
console.log(`[Worker] Connexion à Supabase: ${supabaseUrl}`);

/**
 * Routeur principal
 * Vérifie le champ slot pour router vers le bon job
 */
async function handleSessionEvent(payload) {
  const record = payload.new;
  if (!record) return;

  const { session_id, slot, latest_snapshot } = record;

  if (slot === 'buy.order') {
    console.log(`[Worker] Événement reçu: buy.order (session: ${session_id})`);
    if (latest_snapshot) {
      await processBuySnapshot(latest_snapshot, session_id);
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
  } else {
    // Ignore les autres slots (comme 'validation' par exemple)
    // console.log(`[Worker] Événement ignoré (slot: ${slot})`);
  }
}

// Abonnement aux événements INSERT et UPDATE
const channel = supabase.channel('assist_sessions_worker')
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
    }
  });

// --- MINI SERVEUR HTTP POUR LE HEARTBEAT (PORTAL) ---
const http = require('http');
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // CORS pour autoriser Portal à nous pinguer
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

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[Heartbeat] Serveur HTTP d'état actif sur le port ${PORT}`);
});

// Gestion propre de l'arrêt
process.on('SIGINT', () => {
  console.log('[Worker] Arrêt demandé...');
  supabase.removeChannel(channel).then(() => {
    server.close();
    process.exit(0);
  });
});
