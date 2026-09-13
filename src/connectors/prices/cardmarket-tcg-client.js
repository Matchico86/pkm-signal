const fs = require('fs');
const path = require('path');
const { checkQuota, recordCall } = require('./multi-api-quota-guard');

const CACHE_DIR = path.resolve(__dirname, '../../../data/cache/cardmarket_tcg');
const RAPIDAPI_HOST = process.env.CARDMARKET_RAPIDAPI_HOST || 'cardmarket-api-tcg.p.rapidapi.com';

function getCachePath(cardId) {
  const safeId = String(cardId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CACHE_DIR, `${safeId}.json`);
}

function readCache(cardId) {
  try {
    const filePath = getCachePath(cardId);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const entry = JSON.parse(raw);
    const ageHours = (Date.now() - new Date(entry.cached_at).getTime()) / (1000 * 60 * 60);
    if (ageHours < 24) {
      return entry.data;
    }
    return null;
  } catch (err) {
    return null;
  }
}

function writeCache(cardId, data) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const filePath = getCachePath(cardId);
    fs.writeFileSync(filePath, JSON.stringify({
      cached_at: new Date().toISOString(),
      data
    }, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[CardMarketTCG] Erreur écriture cache:', err.message);
  }
}

function normalize(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function extractDigits(str) {
  const m = String(str || '').match(/\d+/);
  return m ? m[0] : '';
}

function isSetMatch(candidateEpisode, setId, setName) {
  if (!candidateEpisode) return false;
  const epCode = (candidateEpisode.code || '').toUpperCase();
  const epName = normalize(candidateEpisode.name || '');
  const sId = (setId || '').toUpperCase();
  const sName = normalize(setName || '');

  // Match exact du code (ex: CEL == CEL, EVS == EVS, CRZ == CRZ)
  if (sId && epCode && sId === epCode) return true;

  // Mapping promos SWSH
  if ((sId === 'SWSH' || sName.includes('swsh') || sName.includes('promo')) && (epCode === 'PR-SW' || epName.includes('black star promo'))) {
    return true;
  }
  // Mapping promos SV
  if ((sId === 'SVP' || sName.includes('sv') || sName.includes('promo')) && (epCode === 'PR-SV' || epName.includes('scarlet & violet promo'))) {
    return true;
  }

  // Match par nom de série (ex: "Celebrations" == "Célébrations")
  if (sName && epName && (epName.includes(sName) || sName.includes(epName))) return true;

  return false;
}

function isNumberMatch(candidateNumber, candidateCodeNumber, targetNumber) {
  if (!targetNumber) return false;
  const cNum = String(candidateNumber || '').toUpperCase().trim();
  const cCode = String(candidateCodeNumber || '').toUpperCase().trim();
  const tNum = String(targetNumber || '').toUpperCase().trim();

  // Match textuel exact
  if (cNum === tNum || cCode.endsWith(` ${tNum}`)) return true;

  // Match numérique sans lettres (ex: CC022 vs 22, SWSH134 vs 134, etc.)
  const cDigits = extractDigits(cNum);
  const tDigits = extractDigits(tNum);
  if (cDigits && tDigits && parseInt(cDigits, 10) === parseInt(tDigits, 10)) {
    return true;
  }

  return false;
}

function findPerfectCandidate(candidates, target) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const validCandidates = [];

  for (const c of candidates) {
    // 1. Règle FR stricte absolue : la carte DOIT avoir une cotation FR NM > 0
    const frPrice = Number(c.prices?.cardmarket?.lowest_near_mint_FR || 0);
    if (!frPrice || frPrice <= 0) continue;

    // 2. Exclure les cartes géantes / jumbo
    const cName = String(c.name || '').toLowerCase();
    if (cName.includes('oversized') || c.type === 'oversized' || (c.supertype === null && c.cardmarket_id === 576907)) {
      continue;
    }

    let score = 0;

    // A. Match direct par cardmarket_id (confiance absolue 100%)
    if (target.cardmarket_id && Number(c.cardmarket_id) === Number(target.cardmarket_id)) {
      score += 100;
    }

    // B. Match Série
    const setMatches = isSetMatch(c.episode, target.set_id, target.set_name);
    if (setMatches) {
      score += 40;
    }

    // C. Match Numéro
    const numberMatches = isNumberMatch(c.card_number, c.card_code_number, target.number);
    if (numberMatches) {
      score += 40;
    }

    // D. Match Nom (au moins un mot clé du nom doit correspondre)
    const normTargetName = normalize(target.name);
    const normCandidateName = normalize(c.name);
    const targetWords = normTargetName.split(/[\s-]+/).filter(w => w.length > 2 && w !== 'obscur' && w !== 'dark' && w !== 'the');
    const hasNameWord = targetWords.some(w => normCandidateName.includes(w)) || 
      (normTargetName.includes('nymphali') && normCandidateName.includes('sylveon')) ||
      (normTargetName.includes('dracaufeu') && normCandidateName.includes('charizard')) ||
      (normTargetName.includes('tortank') && normCandidateName.includes('blastoise')) ||
      (normTargetName.includes('florizarre') && normCandidateName.includes('venusaur'));

    if (hasNameWord) {
      score += 20;
    }

    // Cas particulier Célébrations Classic Collection :
    if (setMatches && (c.episode?.code === 'CEL' || normalize(c.episode?.name).includes('celebrations')) && hasNameWord) {
      score += 30;
    }

    // Règle stricte "parfait ou rien" : score minimal >= 70
    if (score >= 70) {
      validCandidates.push({ candidate: c, score, frPrice });
    }
  }

  if (validCandidates.length === 0) return null;

  validCandidates.sort((a, b) => b.score - a.score);
  return validCandidates[0];
}

/**
 * Recherche et extrait la cotation de CardMarket API TCG via RapidAPI.
 * Règle stricte 100% FR Near Mint, matching parfait ou rien.
 * 
 * @param {Object} cardIdent - { card_id, cardmarket_id, name, number, set_id, set_name }
 * @param {Object} options - { timeoutMs }
 */
async function fetchCardmarketTcgPrice(cardIdent = {}, options = {}) {
  const apiKey = process.env.CARDMARKET_RAPIDAPI_KEY || process.env.RAPIDAPI_KEY;
  const timeoutMs = options.timeoutMs || 8000;
  const cardId = cardIdent.card_id || `${cardIdent.set_id || ''}-${cardIdent.number || ''}` || cardIdent.name;

  if (!apiKey) {
    return {
      success: false,
      reason: 'missing_api_key',
      source: 'cardmarket_tcg',
      label: 'CM'
    };
  }

  // 1. Cache local 24h
  const cached = readCache(cardId);
  if (cached) {
    const quotaInfo = checkQuota('cardmarket_tcg');
    return {
      ...cached,
      cached: true,
      remaining: quotaInfo.remaining,
      quota_display: quotaInfo.display
    };
  }

  // 2. Garde-fou de quota (Pre-call)
  const quotaCheck = checkQuota('cardmarket_tcg');
  if (!quotaCheck.can_call) {
    return {
      success: false,
      reason: 'quota_reached',
      source: 'cardmarket_tcg',
      label: 'CM',
      quota: quotaCheck
    };
  }

  // 3. Appel réseau multi-niveaux
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let candidates = [];
    let lastHeaders = null;

    // Niveau 1 : Requête par cardmarket_id direct si connu
    if (cardIdent.cardmarket_id && Number(cardIdent.cardmarket_id) > 0) {
      const url = `https://${RAPIDAPI_HOST}/pokemon/cards?cardmarket_id=${encodeURIComponent(cardIdent.cardmarket_id)}`;
      const res = await fetch(url, {
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': RAPIDAPI_HOST,
          'Accept': 'application/json'
        },
        signal: controller.signal
      });
      if (res.ok) {
        lastHeaders = res.headers;
        const json = await res.json();
        const list = Array.isArray(json) ? json : (json.data || json.cards || [json]);
        if (Array.isArray(list) && list.length > 0) {
          candidates.push(...list);
        }
      }
    }

    // Niveau 2 : Recherche ciblée search + card_number
    if (candidates.length === 0 && cardIdent.number) {
      let searchName = String(cardIdent.name || '').split(/[\s-]+/)[0];
      const normName = normalize(searchName);
      if (normName === 'nymphali') searchName = 'Sylveon';
      if (normName === 'dracaufeu') searchName = 'Charizard';

      const url = `https://${RAPIDAPI_HOST}/pokemon/cards?search=${encodeURIComponent(searchName)}&card_number=${encodeURIComponent(cardIdent.number)}`;
      const res = await fetch(url, {
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': RAPIDAPI_HOST,
          'Accept': 'application/json'
        },
        signal: controller.signal
      });
      if (res.ok) {
        lastHeaders = res.headers;
        const json = await res.json();
        const list = Array.isArray(json) ? json : (json.data || json.cards || [json]);
        if (Array.isArray(list) && list.length > 0) {
          candidates.push(...list);
        }
      }
    }

    // Niveau 3 : Fallback search par nom + série si toujours aucun candidat
    if (candidates.length === 0) {
      let searchName = String(cardIdent.name || '').split(/[\s-]+/)[0];
      const normName = normalize(searchName);
      if (normName === 'nymphali') searchName = 'Sylveon';
      if (normName === 'dracaufeu') searchName = 'Charizard';

      const setTerm = cardIdent.set_name || cardIdent.set_id || '';
      const query = `${searchName} ${setTerm}`.trim();
      const url = `https://${RAPIDAPI_HOST}/pokemon/cards?search=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': RAPIDAPI_HOST,
          'Accept': 'application/json'
        },
        signal: controller.signal
      });
      if (res.ok) {
        lastHeaders = res.headers;
        const json = await res.json();
        const list = Array.isArray(json) ? json : (json.data || json.cards || [json]);
        if (Array.isArray(list) && list.length > 0) {
          candidates.push(...list);
        }
      }
    }

    // 4. Enregistrement quota
    const quotaInfo = lastHeaders ? recordCall('cardmarket_tcg', lastHeaders) : checkQuota('cardmarket_tcg');

    // 5. Matching strict "parfait ou rien"
    const match = findPerfectCandidate(candidates, cardIdent);
    if (!match) {
      return {
        success: false,
        reason: 'no_exact_match',
        source: 'cardmarket_tcg',
        label: 'CM',
        quota: quotaInfo
      };
    }

    const result = {
      success: true,
      source: 'cardmarket_tcg',
      label: 'CM',
      price: Number(match.frPrice.toFixed(2)),
      lang: 'FR',
      condition: 'NM',
      remaining: quotaInfo.remaining,
      quota_display: quotaInfo.display,
      url: match.candidate.url || match.candidate.links?.cardmarket || null,
      updated_at: new Date().toISOString()
    };

    writeCache(cardId, result);
    return result;
  } catch (err) {
    return {
      success: false,
      reason: err.name === 'AbortError' ? 'timeout' : err.message,
      source: 'cardmarket_tcg',
      label: 'CM'
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  fetchCardmarketTcgPrice,
  readCardmarketTcgCache: readCache,
  findPerfectCandidate
};
