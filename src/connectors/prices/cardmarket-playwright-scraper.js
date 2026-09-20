/**
 * Scraper Playwright pour Cardmarket (marché FR - Near Mint)
 * Utilise un profil Chrome persistant (Human-in-the-loop & gestion Cloudflare Turnstile).
 * Récupère en direct les offres disponibles et calcule floor, avg3, avg5, median5.
 */

const { spawn } = require('child_process');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

let chromeProcess = null;
let sharedBrowser = null;
let sharedContext = null;
let contextLock = Promise.resolve();

const CDP_PORT = 9222;
const DEFAULT_PROFILE_DIR = path.resolve(__dirname, '../../../data/chrome_cdp');

function isPortOpen(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Obtient ou initialise Google Chrome natif via connectOverCDP (évite le WAF Cloudflare de Playwright)
 */
async function getPersistentContext(options = {}) {
  if (sharedBrowser && sharedBrowser.isConnected()) {
    try {
      const contexts = sharedBrowser.contexts();
      if (contexts.length > 0) {
        sharedContext = contexts[0];
        return sharedContext;
      }
    } catch (_) {
      sharedBrowser = null;
      sharedContext = null;
    }
  }

  const profileDir = options.profileDir || DEFAULT_PROFILE_DIR;
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  // 1. Vérifier si un Chrome natif écoute déjà sur le port 9222
  const alreadyRunning = await isPortOpen(CDP_PORT);
  if (!alreadyRunning) {
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    console.log(`[Scraper CM] Démarrage de Google Chrome natif (GPU réel) sur le port ${CDP_PORT}...`);
    chromeProcess = spawn(chromePath, [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=-32000,-32000',
      '--window-size=1280,800'
    ], { detached: true, stdio: 'ignore' });
    chromeProcess.unref();

    // Attendre que Chrome réponde sur le port CDP
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await isPortOpen(CDP_PORT)) break;
    }
  }

  // 2. Se connecter via connectOverCDP
  try {
    sharedBrowser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
    const contexts = sharedBrowser.contexts();
    sharedContext = contexts[0];
    return sharedContext;
  } catch (err) {
    console.error('[Scraper CM] Erreur de connexion CDP :', err.message);
    throw err;
  }
}

/**
 * Ferme proprement le contexte de navigation persistant
 */
async function closeBrowserInstance() {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch (_) {}
    sharedBrowser = null;
    sharedContext = null;
  }
  if (chromeProcess) {
    try {
      chromeProcess.kill();
    } catch (_) {}
    chromeProcess = null;
  }
}

let currentScraperStatus = {
  state: 'idle', // 'idle' | 'scraping' | 'waiting_for_cf' | 'blocked'
  cardmarketId: null,
  timestamp: Date.now()
};

function getScraperStatus() {
  return { ...currentScraperStatus };
}

function setScraperStatus(patch) {
  currentScraperStatus = { ...currentScraperStatus, ...patch, timestamp: Date.now() };
}

/**
 * Affiche la fenêtre Chrome au premier plan sur l'écran pour validation humaine (HITL)
 */
async function moveWindowOnScreen(page) {
  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    if (windowId) {
      console.log(`[Scraper CM] 🖥️ Affichage de Chrome à l'écran pour validation humaine (Window ID: ${windowId})...`);
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { left: 100, top: 100, width: 1100, height: 750, windowState: 'normal' }
      });
      await page.bringToFront().catch(() => {});
      try { await session.detach(); } catch (_) {}
      return true;
    }
  } catch (err) {
    console.warn('[Scraper CM] Déplacement fenêtre on-screen :', err.message);
  }
  return false;
}

/**
 * Masque la fenêtre Chrome en dehors des écrans (-32000, -32000)
 */
async function moveWindowOffscreen(page) {
  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    if (windowId) {
      console.log(`[Scraper CM] 🥷 Masquage de Chrome en arrière-plan (Window ID: ${windowId})...`);
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { left: -32000, top: -32000, width: 1280, height: 800, windowState: 'normal' }
      });
      try { await session.detach(); } catch (_) {}
      return true;
    }
  } catch (err) {
    console.warn('[Scraper CM] Déplacement fenêtre off-screen :', err.message);
  }
  return false;
}

/**
 * Détecte et gère Cloudflare Turnstile de façon hybride :
 * - Reste 100% invisible tant qu'aucun challenge n'est posé.
 * - Si un challenge apparaît : fait jaillir Chrome à l'écran et émet un bip pour laisser l'humain cliquer.
 * - Dès validation : re-masque instantanément Chrome en arrière-plan.
 */
async function handleCloudflareIfNeeded(page, timeoutMs = 60000) {
  const start = Date.now();
  let alerted = false;
  let isWindowOnScreen = false;

  try {
    while (Date.now() - start < timeoutMs) {
      const title = (await page.title().catch(() => '')) || '';
      const isChallengeTitle = /un instant|just a moment|attention required|vérification|cloudflare/i.test(title);
      const isBlocked = /sorry|blocked|bloqu|access denied/i.test(title);

      if (isBlocked) {
        console.warn(`[Scraper CM] Blocage WAF Cloudflare détecté (Titre : "${title}")`);
        setScraperStatus({ state: 'blocked' });
        if (isWindowOnScreen) {
          await moveWindowOffscreen(page).catch(() => {});
        }
        return false;
      }

      // 1. Si déjà sur Cardmarket et hors page de challenge
      if (!isChallengeTitle && (title.includes('Cardmarket') || title.includes('|'))) {
        if (isWindowOnScreen) {
          console.log('\n=============================================================');
          console.log(`🎉 [Scraper CM] Défi Cloudflare résolu avec succès !`);
          console.log(`🥷 Masquage automatique de Chrome en arrière-plan...`);
          console.log('=============================================================\n');
          await moveWindowOffscreen(page).catch(() => {});
          isWindowOnScreen = false;
        }
        setScraperStatus({ state: 'scraping' });
        return true;
      }

      const hasArticleContent = await page.$('.article-row, .article-table, .noResults').catch(() => null);
      if (hasArticleContent) {
        if (isWindowOnScreen) {
          await moveWindowOffscreen(page).catch(() => {});
          isWindowOnScreen = false;
        }
        setScraperStatus({ state: 'scraping' });
        return true;
      }

      // 2. Détection d'un iframe Turnstile ou challenge Cloudflare actif
      const hasTurnstile = await page.$('iframe[src*="cloudflare"], iframe[src*="turnstile"], #challenge-stage, #challenge-form').catch(() => null);

      if (isChallengeTitle || hasTurnstile) {
        if (!alerted) {
          console.log('\n=============================================================');
          console.log('⚠️ [Scraper CM] Défi Cloudflare Turnstile détecté !');
          console.log('👉 Affichage de la fenêtre Chrome pour validation humaine...');
          console.log('👉 Veuillez cocher la case dans la fenêtre Chrome.');
          console.log('=============================================================\n');
          try { process.stdout.write('\x07'); } catch (_) {}
          setScraperStatus({ state: 'waiting_for_cf' });
          await moveWindowOnScreen(page);
          isWindowOnScreen = true;
          alerted = true;
        }
      }

      await page.waitForTimeout(1000).catch(() => {});
    }
  } finally {
    if (isWindowOnScreen) {
      await moveWindowOffscreen(page).catch(() => {});
    }
  }

  setScraperStatus({ state: 'timeout' });
  return false;
}

/**
 * Accepte la bannière de cookies Cardmarket si elle apparaît
 */
async function acceptCookiesIfPresent(page) {
  try {
    const acceptBtn = await page.$(
      'button[aria-label="Accepter tous les cookies"], button:has-text("Accepter tous les cookies"), button:has-text("ACCEPTER TOUS LES COOKIES"), input[value="Accepter tous les cookies"]'
    );
    if (acceptBtn) {
      await acceptBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(400).catch(() => {});
    }
  } catch (_) {}
}

/**
 * Scrape les offres FR NM pour un idProduct Cardmarket
 * @param {number|string} cardmarketId - ID produit Cardmarket (ex: 691879)
 * @param {Object} options - { timeoutMs, keepBrowserAlive, headless, profileDir }
 * @returns {Promise<Object>}
 */
async function scrapeCardmarketFrNm(cardmarketId, options = {}) {
  // Verrou pour sérialiser les accès au profil Chrome persistant
  let releaseLock;
  const previousLock = contextLock;
  contextLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  await previousLock;

  const timeoutMs = options.timeoutMs || 30000;
  const keepBrowserAlive = options.keepBrowserAlive !== false;
  const startTime = Date.now();

  let context = null;
  let page = null;

  try {
    if (!cardmarketId) {
      return { success: false, reason: 'missing_cardmarket_id' };
    }

    const input = String(cardmarketId).trim();
    let targetUrl = '';

    if (input.startsWith('http://') || input.startsWith('https://')) {
      const matchId = input.match(/idProduct=(\d+)/i);
      if (matchId) {
        targetUrl = `https://www.cardmarket.com/fr/Pokemon/Products?idProduct=${matchId[1]}&language=2&minCondition=2&sellerCountry=12`;
      } else {
        try {
          const urlObj = new URL(input);
          urlObj.searchParams.set('language', '2');
          urlObj.searchParams.set('minCondition', '2');
          urlObj.searchParams.set('sellerCountry', '12');
          targetUrl = urlObj.toString();
        } catch (_) {
          targetUrl = input;
        }
      }
    } else {
      const digitsOnly = input.replace(/\D/g, '');
      if (digitsOnly && digitsOnly.length >= 4) {
        targetUrl = `https://www.cardmarket.com/fr/Pokemon/Products?idProduct=${digitsOnly}&language=2&minCondition=2&sellerCountry=12`;
      } else {
        targetUrl = `https://www.cardmarket.com/fr/Pokemon/Products/Singles?searchString=${encodeURIComponent(input)}&language=2&minCondition=2&sellerCountry=12`;
      }
    }

    context = await getPersistentContext(options);
    const existingPages = context.pages();
    page = existingPages.length > 0 ? existingPages[0] : await context.newPage();

    console.log(`[Scraper CM] Navigation vers : ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });

    // Gestion Cloudflare avec auto-résolution et Human-in-the-loop
    await handleCloudflareIfNeeded(page, 40000);

    // Accepter cookies si nécessaire
    await acceptCookiesIfPresent(page);

    // Si on a atterri sur une page de recherche de singles, cliquer sur le premier résultat
    if (page.url().includes('searchString=')) {
      try {
        const firstLink = await page.$('.table-body .row a[href*="/Products/Singles/"], a[href*="/fr/Pokemon/Products/Singles/"]');
        if (firstLink) {
          const href = await firstLink.getAttribute('href');
          if (href) {
            const productUrl = href.startsWith('http') ? href : `https://www.cardmarket.com${href}`;
            const targetProductUrl = new URL(productUrl);
            targetProductUrl.searchParams.set('language', '2');
            targetProductUrl.searchParams.set('minCondition', '2');
            targetProductUrl.searchParams.set('sellerCountry', '12');
            console.log(`[Scraper CM] Redirection depuis la recherche vers : ${targetProductUrl.toString()}`);
            await page.goto(targetProductUrl.toString(), {
              waitUntil: 'domcontentloaded',
              timeout: timeoutMs
            });
            await handleCloudflareIfNeeded(page, 15000);
            await acceptCookiesIfPresent(page);
          }
        }
      } catch (searchErr) {
        console.warn('[Scraper CM] Recherche produit :', searchErr.message);
      }
    }

    // Attendre que la table d'articles ou le message d'absence d'offres soit chargé
    try {
      await page.waitForSelector('.article-row, .noResults, .article-table', { timeout: 8000 });
    } catch (_) {}

    // Vérifier l'URL finale pour s'assurer qu'on n'est pas bloqué sur une page de challenge
    const finalTitle = await page.title();
    if (/un instant|just a moment|attention required|cloudflare/i.test(finalTitle)) {
      const debugScreenshotPath = path.resolve(__dirname, '../../../scratch/last_error.png');
      await page.screenshot({ path: debugScreenshotPath }).catch(() => {});
      console.warn(`[Scraper CM] Blocage Cloudflare persistant, capture sauvegardée dans : ${debugScreenshotPath}`);
      return {
        success: false,
        reason: 'cloudflare_challenge_unresolved',
        cardmarket_id: cardmarketId,
        url: page.url(),
        duration_ms: Date.now() - startTime
      };
    }

    // Extraction des offres depuis le DOM
    const rawOffers = await page.evaluate(() => {
      function parseCardmarketPrice(text) {
        if (!text) return NaN;
        let cleaned = String(text).replace(/[€\s\u00a0\u202f]/g, '').trim();
        if (!cleaned) return NaN;

        // Format européen standard: point = séparateur de milliers, virgule = décimale
        // Ex: "1.200,50" -> "1200.50", "1.200,00" -> "1200.00"
        if (cleaned.includes('.') && cleaned.includes(',')) {
          if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
            // Point avant virgule → point = milliers, virgule = décimale
            cleaned = cleaned.replace(/\./g, '').replace(',', '.');
          } else {
            // Virgule avant point → virgule = milliers, point = décimale (format UK)
            cleaned = cleaned.replace(/,/g, '');
          }
        } else if (cleaned.includes(',')) {
          // Seulement virgule → décimale (ex: "12,50")
          cleaned = cleaned.replace(',', '.');
        } else if (cleaned.includes('.')) {
          // Seulement point : distinguer milliers (1.200) de décimale (12.50)
          // Un point de milliers a exactement 3 chiffres après le point et pas de décimale
          // On considère toute séquence de \d+.\d{3} sans autre décimale comme milliers
          const parts = cleaned.split('.');
          if (parts.length === 2 && parts[1].length === 3 && /^\d+$/.test(parts[0]) && /^\d{3}$/.test(parts[1])) {
            // Ex: "1.200", "10.000" → supprimer le point
            cleaned = parts[0] + parts[1];
          }
          // Sinon garder tel quel pour parseFloat (ex: "12.50" reste "12.50")
        }
        return parseFloat(cleaned);
      }

      const rows = Array.from(document.querySelectorAll('.article-row'));
      const list = [];

      for (const r of rows) {
        // 1. Vendeur
        const sellerElem = r.querySelector('.seller-name a') || r.querySelector('.seller-name');
        const seller = sellerElem ? sellerElem.innerText.trim().split('\n').pop().trim() : 'Inconnu';

        // 2. Prix
        const priceElem =
          r.querySelector('.price-container .color-primary') ||
          r.querySelector('.mobile-offer-container .color-primary') ||
          r.querySelector('.color-primary');
        if (!priceElem) continue;

        const price = parseCardmarketPrice(priceElem.innerText);
        if (isNaN(price) || price <= 0) continue;

        // 3. Quantité
        const countElem = r.querySelector('.item-count') || r.querySelector('.amount-container');
        const count = countElem ? parseInt(countElem.innerText.trim(), 10) || 1 : 1;

        // 4. État (Condition) : NM ou MT uniquement (exclusion stricte de EX, GD, LP, PL, PO)
        const conditionBadge = r.querySelector('.article-condition') || r.querySelector('.badge');
        const condition = conditionBadge ? conditionBadge.innerText.trim().toUpperCase() : 'NM';
        const isNearMintOrMint =
          condition === 'NM' ||
          condition === 'MT' ||
          condition === 'M' ||
          condition.includes('NEAR MINT') ||
          condition.includes('MINT');

        if (!isNearMintOrMint || condition.includes('EX') || condition.includes('GOOD') || condition.includes('PLAYED')) {
          continue;
        }

        // 5. Langue : Français uniquement
        const langElem = r.querySelector('.product-attributes span.icon, [aria-label*="rançais"], [data-bs-original-title*="rançais"], [title*="rançais"]');
        const langTitle = langElem
          ? (langElem.getAttribute('data-bs-original-title') || langElem.getAttribute('aria-label') || langElem.getAttribute('title') || '').toLowerCase()
          : '';
        const isFrench = langTitle.includes('fran') || langTitle.includes('fr');
        if (!isFrench) continue;

        // 6. Localisation vendeur : France uniquement
        const locElem = r.querySelector('[aria-label*="Localisation"], [data-bs-original-title*="Localisation"], [title*="Localisation"]');
        const locTitle = locElem
          ? (locElem.getAttribute('data-bs-original-title') || locElem.getAttribute('aria-label') || locElem.getAttribute('title') || '').toLowerCase()
          : '';
        const isFrance = locTitle.includes('france');
        if (!isFrance) continue;

        // 7. Commentaire vendeur éventuel
        const commentElem = r.querySelector('.product-comments span.d-block');
        const comment = commentElem ? commentElem.innerText.trim() : '';

        list.push({
          seller,
          price,
          count,
          condition: 'NM',
          comment
        });
      }

      return list;
    });

    // Extraction de l'idProduct officiel depuis le DOM de la page
    const extractedProductId = await page.evaluate(() => {
      const inp = document.querySelector('input[name="idProduct"], input[name="productId"], [data-product-id], [data-id-product]');
      if (inp) {
        const v = inp.value || inp.getAttribute('data-product-id') || inp.getAttribute('data-id-product');
        if (v && /^\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
      }
      const links = Array.from(document.querySelectorAll('form[action*="idProduct="], a[href*="idProduct="]'));
      for (const el of links) {
        const str = el.action || el.href || '';
        const m = str.match(/idProduct=(\d+)/i);
        if (m) return parseInt(m[1], 10);
      }
      const urlM = (window.location.href + ' ' + (document.querySelector('link[rel="canonical"]')?.href || '')).match(/idProduct=(\d+)/i);
      if (urlM) return parseInt(urlM[1], 10);
      return null;
    }).catch(() => null);

    const detectedIdNum = extractedProductId || (Number(cardmarketId) > 0 ? Number(cardmarketId) : null);
    const durationMs = Date.now() - startTime;

    if (!rawOffers || rawOffers.length === 0) {
      return {
        success: false,
        reason: 'no_offers_found',
        cardmarket_id: detectedIdNum || cardmarketId,
        product_id: detectedIdNum,
        url: page.url(),
        duration_ms: durationMs
      };
    }

    // Calculs statistiques
    const prices = rawOffers.map((o) => o.price);
    const floor = prices[0];

    // Moyenne 3 offres
    const top3 = prices.slice(0, Math.min(3, prices.length));
    const avg3 = Number((top3.reduce((acc, p) => acc + p, 0) / top3.length).toFixed(2));

    // Moyenne 5 offres
    const top5 = prices.slice(0, Math.min(5, prices.length));
    const avg5 = Number((top5.reduce((acc, p) => acc + p, 0) / top5.length).toFixed(2));

    // Médiane 5 offres
    const sortedTop5 = [...top5].sort((a, b) => a - b);
    const mid = Math.floor(sortedTop5.length / 2);
    const median5 =
      sortedTop5.length % 2 !== 0
        ? sortedTop5[mid]
        : Number(((sortedTop5[mid - 1] + sortedTop5[mid]) / 2).toFixed(2));

    // 4 valeurs triées par ordre croissant de prix
    const suggestedMetrics = [
      { id: 'floor', label: 'Plus basse', price: floor, desc: '1ère offre FR' },
      { id: 'avg3', label: 'Moyenne 3', price: avg3, desc: 'Moy. 3 offres', is_recommended: true },
      { id: 'median5', label: 'Médiane 5', price: median5, desc: 'Médiane 5 offres' },
      { id: 'avg5', label: 'Moyenne 5', price: avg5, desc: 'Moy. 5 offres' }
    ].filter((m) => m.price > 0);

    suggestedMetrics.sort((a, b) => a.price - b.price);

    return {
      success: true,
      cardmarket_id: detectedIdNum || cardmarketId,
      product_id: detectedIdNum,
      floor,
      avg3,
      avg5,
      median5,
      suggested_metrics: suggestedMetrics,
      offers_count: rawOffers.length,
      top_offers: rawOffers.slice(0, 5),
      duration_ms: durationMs,
      url: page.url()
    };
  } catch (err) {
    if (err.message && (err.message.includes('closed') || err.message.includes('Target page') || err.message.includes('Crash'))) {
      sharedContext = null;
    }
    return {
      success: false,
      reason: err.message,
      cardmarket_id: cardmarketId,
      duration_ms: Date.now() - startTime
    };
  } finally {
    setScraperStatus({ state: 'idle', cardmarketId: null });
    if (page && !keepBrowserAlive) {
      try {
        await page.close();
      } catch (_) {}
    }
    if (!keepBrowserAlive) {
      await closeBrowserInstance();
    }
    releaseLock();
  }
}

module.exports = {
  scrapeCardmarketFrNm,
  getPersistentContext,
  closeBrowserInstance,
  getScraperStatus,
  moveWindowOnScreen,
  moveWindowOffscreen
};
