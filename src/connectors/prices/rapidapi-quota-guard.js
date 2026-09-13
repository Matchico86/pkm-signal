const fs = require('fs');
const path = require('path');

const QUOTA_FILE_PATH = path.resolve(__dirname, '../../../data/cache/quotas.json');

/**
 * Lit le fichier de quotas actuel.
 * Réinitialise chaque clé indépendamment si sa date ne correspond plus à aujourd'hui,
 * sans écraser les autres clés.
 */
function readQuotas() {
  const todayStr = new Date().toISOString().split('T')[0];
  const defaults = {
    rapidapi: { date: todayStr, day_count: 0 },
    live_assist: { date: todayStr, day_count: 0 }
  };

  if (!fs.existsSync(QUOTA_FILE_PATH)) {
    return { ...defaults };
  }

  try {
    const raw = fs.readFileSync(QUOTA_FILE_PATH, 'utf-8');
    const data = JSON.parse(raw);

    // Réinitialiser chaque clé indépendamment si sa date est périmée
    if (!data.rapidapi || data.rapidapi.date !== todayStr) {
      data.rapidapi = { date: todayStr, day_count: 0 };
    }
    if (!data.live_assist || data.live_assist.date !== todayStr) {
      data.live_assist = { date: todayStr, day_count: 0 };
    }

    return data;
  } catch (err) {
    console.warn('[QuotaGuard] Erreur lecture quotas.json, fallback à zéro:', err.message);
    return { ...defaults };
  }
}

/**
 * Enregistre les quotas dans le fichier JSON
 */
function writeQuotas(data) {
  try {
    const dir = path.dirname(QUOTA_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(QUOTA_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[QuotaGuard] Erreur écriture quotas.json:', err.message);
  }
}

/**
 * Vérifie si une recotation via API externe (RapidAPI CardMarket) peut être déclenchée
 * sans dépasser les quotas autorisés.
 */
function checkExternalApiQuota() {
  const liveEnabled = (process.env.RAPIDAPI_LIVE_CALLS_ENABLED || 'false').toLowerCase() === 'true';
  const maxDay = parseInt(process.env.RAPIDAPI_MAX_REQUESTS_PER_DAY || '10', 10);
  const apiKey = process.env.CARDMARKET_RAPIDAPI_KEY;
  const apiHost = process.env.CARDMARKET_RAPIDAPI_HOST;

  const quotas = readQuotas();
  const dayCount = quotas.rapidapi?.day_count || 0;

  if (!apiKey || !apiHost) {
    return {
      can_recot: false,
      reason: 'missing_api_credentials',
      day_count: dayCount,
      max_day: maxDay
    };
  }

  if (!liveEnabled) {
    return {
      can_recot: false,
      reason: 'live_calls_disabled',
      day_count: dayCount,
      max_day: maxDay
    };
  }

  if (dayCount >= maxDay) {
    return {
      can_recot: false,
      reason: 'daily_quota_exceeded',
      day_count: dayCount,
      max_day: maxDay
    };
  }

  return {
    can_recot: true,
    reason: 'quota_ok',
    day_count: dayCount,
    max_day: maxDay
  };
}

/**
 * Consomme un appel de quota général (RapidAPI)
 */
function recordExternalApiCall() {
  const todayStr = new Date().toISOString().split('T')[0];
  const quotas = readQuotas();
  const currentCount = quotas.rapidapi?.day_count || 0;
  quotas.rapidapi = {
    date: todayStr,
    day_count: currentCount + 1
  };
  writeQuotas(quotas);
  return quotas.rapidapi;
}

const DEFAULT_LIVE_ASSIST_MAX_PER_DAY = 1000;
const DEFAULT_GLOBAL_RECOT_MAX_PER_DAY = 2000;

/**
 * Vérifie si une recotation interactive en direct (Acheter / Vendre) est autorisée
 * selon le quota journalier dédié au Live Assist (10 req/j par défaut, max global 50 req/j).
 */
function checkLiveAssistQuota() {
  const maxDay = parseInt(process.env.LIVE_ASSIST_MAX_REQUESTS_PER_DAY || String(DEFAULT_LIVE_ASSIST_MAX_PER_DAY), 10);
  const globalMaxDay = parseInt(process.env.RECOT_MAX_REQUESTS_PER_DAY || String(DEFAULT_GLOBAL_RECOT_MAX_PER_DAY), 10);

  const quotas = readQuotas();
  const todayStr = new Date().toISOString().split('T')[0];
  
  if (quotas.live_assist?.date !== todayStr) {
    quotas.live_assist = { date: todayStr, day_count: 0 };
    writeQuotas(quotas);
  }

  const dayCount = quotas.live_assist?.day_count || 0;
  const rapidCount = quotas.rapidapi?.date === todayStr ? (quotas.rapidapi.day_count || 0) : 0;
  const totalCallsToday = dayCount + rapidCount;

  // 1. Vérification du plafond global (50 max par jour)
  if (totalCallsToday >= globalMaxDay) {
    return {
      can_call: false,
      reason: 'global_daily_quota_reached',
      day_count: dayCount,
      max_day: maxDay,
      global_day_count: totalCallsToday,
      global_max_day: globalMaxDay,
      remaining: 0,
      display: `${dayCount}/${maxDay}`
    };
  }

  // 2. Vérification du quota dédié Acheter / Live Assist (10 max par jour)
  if (dayCount >= maxDay) {
    return {
      can_call: false,
      reason: 'live_assist_daily_limit_reached',
      day_count: dayCount,
      max_day: maxDay,
      remaining: 0,
      display: `${dayCount}/${maxDay}`
    };
  }

  return {
    can_call: true,
    reason: 'quota_ok',
    day_count: dayCount,
    max_day: maxDay,
    remaining: Math.max(0, maxDay - dayCount),
    display: `${dayCount}/${maxDay}`
  };
}

/**
 * Enregistre et incrémente un appel dédié Live Assist (Acheter / Vendre)
 */
function recordLiveAssistCall() {
  const maxDay = parseInt(process.env.LIVE_ASSIST_MAX_REQUESTS_PER_DAY || String(DEFAULT_LIVE_ASSIST_MAX_PER_DAY), 10);
  const todayStr = new Date().toISOString().split('T')[0];
  const quotas = readQuotas();
  const currentCount = quotas.live_assist?.date === todayStr ? (quotas.live_assist.day_count || 0) : 0;
  const newCount = currentCount + 1;
  
  quotas.live_assist = {
    date: todayStr,
    day_count: newCount
  };
  writeQuotas(quotas);

  return {
    date: todayStr,
    day_count: newCount,
    max_day: maxDay,
    remaining: Math.max(0, maxDay - newCount),
    display: `${newCount}/${maxDay}`
  };
}

/**
 * Retourne la synthèse des quotas d'appels pour injection dans le contrat analytique
 */
function getQuotasSummary() {
  const quotas = readQuotas();
  const todayStr = new Date().toISOString().split('T')[0];
  const maxDay = parseInt(process.env.LIVE_ASSIST_MAX_REQUESTS_PER_DAY || String(DEFAULT_LIVE_ASSIST_MAX_PER_DAY), 10);
  const globalMaxDay = parseInt(process.env.RECOT_MAX_REQUESTS_PER_DAY || String(DEFAULT_GLOBAL_RECOT_MAX_PER_DAY), 10);

  const dayCount = quotas.live_assist?.date === todayStr ? (quotas.live_assist.day_count || 0) : 0;
  const rapidCount = quotas.rapidapi?.date === todayStr ? (quotas.rapidapi.day_count || 0) : 0;
  const totalCallsToday = dayCount + rapidCount;

  return {
    live_assist: {
      used: dayCount,
      max: maxDay,
      remaining: Math.max(0, maxDay - dayCount),
      display: `${dayCount}/${maxDay}`
    },
    global_daily: {
      used: totalCallsToday,
      max: globalMaxDay,
      remaining: Math.max(0, globalMaxDay - totalCallsToday),
      display: `${totalCallsToday}/${globalMaxDay}`
    }
  };
}

module.exports = {
  checkExternalApiQuota,
  recordExternalApiCall,
  checkLiveAssistQuota,
  recordLiveAssistCall,
  getQuotasSummary,
  readQuotas
};
