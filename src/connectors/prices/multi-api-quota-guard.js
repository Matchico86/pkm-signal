const fs = require('fs');
const path = require('path');

const QUOTA_FILE_PATH = path.resolve(__dirname, '../../../data/cache/quotas.json');

// Plafonds officiels des tiers gratuits des fournisseurs :
// - CardMarket API TCG (RapidAPI) : 100 req / jour
// - RareBit / pokemontcgapi.com (RapidAPI) : 250 req / jour
// - Live Assist global : 100 req / jour
const SUPPLIER_MAX_LIMITS = {
  cardmarket_tcg: 100,
  rarebit: 250,
  live_assist: 100
};

// Règle stricte de verrou global : Fournisseur Max - 30% pour sécurité absolue anti-dépassement
const DEFAULT_LIMITS = {
  cardmarket_tcg: parseInt(process.env.CARDMARKET_TCG_MAX_DAY || String(Math.floor(SUPPLIER_MAX_LIMITS.cardmarket_tcg * 0.70)), 10), // 70
  rarebit: parseInt(process.env.RAREBIT_MAX_DAY || String(Math.floor(SUPPLIER_MAX_LIMITS.rarebit * 0.70)), 10),                     // 175
  live_assist: parseInt(process.env.LIVE_ASSIST_MAX_REQUESTS_PER_DAY || String(Math.floor(SUPPLIER_MAX_LIMITS.live_assist * 0.70)), 10) // 70
};

/**
 * Lit les quotas actuels.
 * Conserve strictement les compteurs et les limites configurées.
 * Réinitialise automatiquement les compteurs dont la date est antérieure à aujourd'hui.
 */
function readQuotas() {
  const todayStr = new Date().toISOString().split('T')[0];
  const defaults = {
    cardmarket_tcg: { date: todayStr, day_count: 0, max_day: DEFAULT_LIMITS.cardmarket_tcg },
    rarebit: { date: todayStr, day_count: 0, max_day: DEFAULT_LIMITS.rarebit },
    live_assist: { date: todayStr, day_count: 0, max_day: DEFAULT_LIMITS.live_assist }
  };

  if (!fs.existsSync(QUOTA_FILE_PATH)) {
    return { ...defaults };
  }

  try {
    const raw = fs.readFileSync(QUOTA_FILE_PATH, 'utf-8');
    const data = JSON.parse(raw);

    for (const key of Object.keys(defaults)) {
      if (!data[key]) {
        data[key] = { ...defaults[key] };
      } else {
        // Conserver la limite max_day existante ou appliquer la limite par défaut sécurisée
        data[key].max_day = data[key].max_day || DEFAULT_LIMITS[key] || defaults[key].max_day;
        if (data[key].date !== todayStr) {
          data[key].date = todayStr;
          data[key].day_count = 0;
        }
      }
    }

    return data;
  } catch (err) {
    console.warn('[MultiQuotaGuard] Erreur lecture quotas.json, réinitialisation à zéro:', err.message);
    return { ...defaults };
  }
}

/**
 * Enregistre atomiquement les quotas dans quotas.json
 */
function writeQuotas(data) {
  try {
    const dir = path.dirname(QUOTA_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempFile = QUOTA_FILE_PATH + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, QUOTA_FILE_PATH);
  } catch (err) {
    console.warn('[MultiQuotaGuard] Erreur écriture quotas.json:', err.message);
  }
}

/**
 * Vérifie si un provider externe peut être appelé sans dépasser son plafond de sécurité.
 * @param {string} provider - 'cardmarket_tcg' | 'rarebit' | 'live_assist'
 * @returns {Object} { can_call: boolean, reason: string, day_count: number, max_day: number, remaining: number, display: string }
 */
function checkQuota(provider) {
  const quotas = readQuotas();
  const maxDay = DEFAULT_LIMITS[provider] || 20;
  const currentCount = quotas[provider]?.day_count || 0;
  const remaining = Math.max(0, maxDay - currentCount);

  if (currentCount >= maxDay) {
    return {
      can_call: false,
      reason: 'daily_limit_reached',
      day_count: currentCount,
      max_day: maxDay,
      remaining: 0,
      display: `${currentCount}/${maxDay}`
    };
  }

  return {
    can_call: true,
    reason: 'ok',
    day_count: currentCount,
    max_day: maxDay,
    remaining: remaining,
    display: `${currentCount}/${maxDay}`
  };
}

/**
 * Consomme un appel pour un provider et synchronise le solde avec les headers de réponse HTTP.
 * @param {string} provider - 'cardmarket_tcg' | 'rarebit'
 * @param {Headers|Object} responseHeaders - Headers retournés par l'API (pour x-ratelimit-requests-remaining)
 */
function recordCall(provider, responseHeaders = null) {
  const todayStr = new Date().toISOString().split('T')[0];
  const quotas = readQuotas();
  const maxDay = quotas[provider]?.max_day || DEFAULT_LIMITS[provider] || 20;

  const currentCount = quotas[provider]?.day_count || 0;
  const newCount = currentCount + 1;

  let remaining = Math.max(0, maxDay - newCount);

  // Vérifier si l'API renvoie un solde restant officiel (ex: RapidAPI x-ratelimit-requests-remaining)
  if (responseHeaders) {
    const headerRemaining = typeof responseHeaders.get === 'function'
      ? responseHeaders.get('x-ratelimit-requests-remaining')
      : responseHeaders['x-ratelimit-requests-remaining'];

    if (headerRemaining !== undefined && headerRemaining !== null) {
      const parsed = parseInt(headerRemaining, 10);
      if (!isNaN(parsed) && parsed < remaining) {
        remaining = parsed;
      }
    }
  }

  quotas[provider] = {
    ...(quotas[provider] || {}),
    date: todayStr,
    day_count: newCount,
    max_day: maxDay,
    last_call_at: new Date().toISOString()
  };

  writeQuotas(quotas);

  return {
    date: todayStr,
    day_count: newCount,
    max_day: maxDay,
    remaining: remaining,
    display: `${newCount}/${maxDay}`
  };
}

/**
 * Marque immédiatement un provider comme ayant épuisé son quota auprès du fournisseur (ex: HTTP 429).
 * Évite les requêtes inutiles suivantes pour la journée.
 * @param {string} provider - 'cardmarket_tcg' | 'rarebit'
 */
function recordQuotaExceeded(provider) {
  const todayStr = new Date().toISOString().split('T')[0];
  const quotas = readQuotas();
  const maxDay = quotas[provider]?.max_day || DEFAULT_LIMITS[provider] || 20;

  quotas[provider] = {
    ...(quotas[provider] || {}),
    date: todayStr,
    day_count: maxDay,
    max_day: maxDay,
    last_call_at: new Date().toISOString()
  };

  writeQuotas(quotas);

  return {
    date: todayStr,
    day_count: maxDay,
    max_day: maxDay,
    remaining: 0,
    display: `${maxDay}/${maxDay}`
  };
}

/**
 * Retourne le résumé des quotas pour tous les providers
 */
function getAllQuotasSummary() {
  const summary = {};
  for (const provider of Object.keys(DEFAULT_LIMITS)) {
    summary[provider] = checkQuota(provider);
  }
  return summary;
}

module.exports = {
  checkQuota,
  recordCall,
  recordQuotaExceeded,
  getAllQuotasSummary,
  readQuotas
};
