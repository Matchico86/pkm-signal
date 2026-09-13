require('dotenv').config();
const http = require('http');
const url = require('url');
const { scrapeCardmarketFrNm, closeBrowserInstance, getScraperStatus } = require('./connectors/prices/cardmarket-playwright-scraper');

const rawPort = process.env.PORT;
const PORT = (!isNaN(rawPort) && Number(rawPort) > 0) ? Number(rawPort) : 3000;

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. Healthcheck
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true, service: 'pkm-signal', timestamp: new Date().toISOString() }));
  }

  // 1b. Statut en direct du scraper (détection Cloudflare / attente utilisateur)
  if (pathname === '/api/cardmarket/status' && req.method === 'GET') {
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true, ...getScraperStatus() }));
  }

  // 2. Cotation Cardmarket en direct (GET ou POST)
  if (pathname === '/api/cardmarket/quote') {
    let cardmarketId = parsedUrl.query.cardmarket_id || parsedUrl.query.idProduct || parsedUrl.query.id || parsedUrl.query.url;

    if (req.method === 'POST') {
      let bodyStr = '';
      req.on('data', (chunk) => {
        bodyStr += chunk;
      });
      await new Promise((resolve) => req.on('end', resolve));

      try {
        const body = JSON.parse(bodyStr || '{}');
        cardmarketId = body.cardmarket_id || body.idProduct || body.id || body.url || cardmarketId;
      } catch (err) {
        res.writeHead(400);
        return res.end(JSON.stringify({ ok: false, error: 'invalid_json_body' }));
      }
    }

    if (!cardmarketId) {
      res.writeHead(400);
      return res.end(JSON.stringify({ ok: false, error: 'missing_cardmarket_id' }));
    }

    console.log(`[Server] Demande de cotation reçue pour Cardmarket ID : ${cardmarketId}`);

    try {
      const result = await scrapeCardmarketFrNm(cardmarketId, {
        timeoutMs: 45000,
        keepBrowserAlive: true
      });

      if (result.success) {
        res.writeHead(200);
        return res.end(JSON.stringify({
          ok: true,
          ...result
        }));
      } else {
        res.writeHead(422);
        return res.end(JSON.stringify({
          ok: false,
          ...result
        }));
      }
    } catch (err) {
      console.error('[Server] Erreur interne lors du scraping :', err);
      res.writeHead(500);
      return res.end(JSON.stringify({
        ok: false,
        error: err.message || 'internal_server_error'
      }));
    }
  }

  // 404
  res.writeHead(404);
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[PKM Signal] ⚠️ Le port ${PORT} est déjà utilisé par une autre instance.`);
    console.error(`Si le serveur tourne déjà en arrière-plan, il est opérationnel !`);
    console.error(`Pour le redémarrer, fermez l'autre terminal ou tuez le processus sur le port ${PORT}.\n`);
  } else {
    console.error('[PKM Signal] Erreur serveur :', err.message);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`[PKM Signal] Serveur de cotation actif sur http://localhost:${PORT}`);
  console.log(`[PKM Signal] Endpoint : GET/POST http://localhost:${PORT}/api/cardmarket/quote?cardmarket_id=<ID>`);
});

// Arrêt propre
async function cleanup() {
  console.log('\n[PKM Signal] Fermeture du serveur et libération des ressources navigateur...');
  server.close();
  await closeBrowserInstance();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
