/**
 * Module Métier : Garde-fous pour la Recotation en Direct (Panier Acheter / Vendre)
 * 
 * Filtres stricts pour le premier test contrôlé :
 * 1. Prix d'achat > 10€ (saisi avant déclenchement)
 * 2. État NM (Near Mint / MT)
 * 3. Langue FR
 * 4. Non gradé (pas de boîtier ni d'état gradé GRA / GR9 / PSA / PCA...)
 * 5. Variante N (Normale / Standard) par défaut pour ce test (puis R sera ajouté ultérieurement)
 * 6. Quota dédié Acheter (max 10 requêtes / jour, plafond global 50 req / jour)
 * 7. Fraîcheur : dernière cote > 7 jours ou absente (si cote <= 7j, cote encore fraîche -> pas de recot)
 */

const { checkLiveAssistQuota } = require('../../connectors/prices/rapidapi-quota-guard');
const { getDaysDifference } = require('./buy-analysis-meta');

const DEFAULT_MIN_BUY_PRICE = 10.0;
const DEFAULT_STALE_DAYS_THRESHOLD = 7;

const GRADED_STATES = Object.freeze([
  "GRA", "GR5", "GR55", "GR6", "GR65", "GR7", "GR75", "GR8", "GR85", "GR9", "GR95", "GR10",
  "PSA", "PCA", "BGS", "CGC"
]);

function normalizeVariant(variant) {
  const v = String(variant || 'N').trim().toUpperCase();
  if (v === 'REVERSE' || v === 'REV') return 'R';
  if (v === 'HOLO' || v === 'HOLOGRAPHIQUE') return 'H';
  if (v === 'STANDARD' || v === 'NORMAL' || v === '') return 'N';
  return v;
}

function resolveAllowedVariants(options = {}) {
  if (Array.isArray(options.allowedVariants)) {
    return options.allowedVariants.map(v => normalizeVariant(v));
  }
  if (process.env.LIVE_RECOT_ALLOWED_VARIANTS) {
    return process.env.LIVE_RECOT_ALLOWED_VARIANTS.split(',').map(v => normalizeVariant(v));
  }
  return ['N'];
}

function isGradedCard(itemInput = {}) {
  if (itemInput.is_graded === true || itemInput.isGraded === true || itemInput.state_mode === 'graded') {
    return true;
  }
  const cond = String(itemInput.condition || itemInput.state || '').trim().toUpperCase();
  return GRADED_STATES.includes(cond);
}

function isNearMintCondition(condition) {
  const c = String(condition || '').trim().toUpperCase();
  return c === 'NM' || c === 'NEAR MINT' || c === 'MT' || c === 'MINT';
}

function isFrenchLanguage(language) {
  const l = String(language || 'FR').trim().toUpperCase();
  return l === 'FR' || l === 'FRENCH';
}

/**
 * Évalue si une ligne du panier est éligible à un appel de recotation en direct.
 * 
 * @param {Object} itemInput - Ligne panier (buy_price_unit, condition, language, variant, is_graded, etc.)
 * @param {Object} rawFacts - Données de la carte en base (cote, etc.)
 * @param {Object} options - Options (allowedVariants, minPriceThreshold, staleDaysThreshold, referenceDate, skipQuotaCheck)
 * @returns {Object} { eligible: boolean, reason: string, details: Object }
 */
function evaluateLiveRecotEligibility(itemInput = {}, rawFacts = {}, options = {}) {
  const minPrice = Number(options.minPriceThreshold ?? process.env.LIVE_RECOT_MIN_PRICE ?? DEFAULT_MIN_BUY_PRICE);
  const staleDaysThreshold = Number(options.staleDaysThreshold ?? DEFAULT_STALE_DAYS_THRESHOLD);
  const referenceDate = options.referenceDate ? new Date(options.referenceDate) : new Date();

  // 1. Filtre Prix d'achat strict (> 10€ requis pour déclencher un appel API payant à crédit)
  // Règle absolue : si aucun prix d'achat n'est saisi ou si prix <= 10€, AUCUN appel API payant ne doit être émis.
  const buyPrice = Number(itemInput.buy_price_unit ?? itemInput.unit_price ?? itemInput.price ?? 0);
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) {
    return {
      eligible: false,
      reason: 'no_buy_price_entered',
      details: {
        buy_price: 0,
        min_threshold: minPrice
      }
    };
  }

  if (buyPrice <= minPrice) {
    return {
      eligible: false,
      reason: 'buy_price_must_exceed_10',
      details: {
        buy_price: buyPrice,
        min_threshold: minPrice
      }
    };
  }

  // 2. Filtre Langue FR
  const rawLang = itemInput.language || itemInput.lang || 'FR';
  if (!isFrenchLanguage(rawLang)) {
    return {
      eligible: false,
      reason: 'not_french_language',
      details: {
        language: String(rawLang)
      }
    };
  }

  const rawCond = itemInput.condition || itemInput.etat || 'NM';

  // 3. Filtre Non gradé (les cartes sous boîtier relèvent d'un marché spécifique)
  if (isGradedCard(itemInput)) {
    return {
      eligible: false,
      reason: 'card_is_graded',
      details: {
        condition: String(rawCond),
        is_graded: true
      }
    };
  }

  // 4. Filtre État Near Mint strict obligatoire (aucun appel API pour EX, GD, LP, etc.)
  if (!isNearMintCondition(rawCond)) {
    return {
      eligible: false,
      reason: 'condition_not_nm',
      details: {
        condition: String(rawCond)
      }
    };
  }

  // 5. Filtre Variante (Variant R pour ce premier test ou variantes autorisées)
  const allowedVariants = resolveAllowedVariants(options);
  const currentVariant = normalizeVariant(itemInput.variant || itemInput.variante);
  if (!allowedVariants.includes(currentVariant)) {
    return {
      eligible: false,
      reason: 'variant_not_eligible',
      details: {
        variant: currentVariant,
        allowed_variants: allowedVariants
      }
    };
  }

  // 6. Garde-fou Quota Journalier Dédié Acheter / Live Assist (10 req/j max, 50 req/j global)
  let quotaCheck = null;
  if (!options.skipQuotaCheck) {
    quotaCheck = checkLiveAssistQuota();
    if (!quotaCheck.can_call) {
      return {
        eligible: false,
        reason: quotaCheck.reason,
        details: {
          day_count: quotaCheck.day_count,
          max_day: quotaCheck.max_day,
          remaining: quotaCheck.remaining,
          display: quotaCheck.display
        }
      };
    }
  }

  // 7. Garde-fou Fraîcheur de la Cote (> 7 jours ou absente)
  const knownCote = Number(rawFacts?.cote?.last_value ?? 0);
  const coteDate = rawFacts?.cote?.updated_at || rawFacts?.cote?.date || null;
  const quoteAgeDays = coteDate ? getDaysDifference(coteDate, referenceDate) : Infinity;
  const quoteSource = String(rawFacts?.cote?.source || '').toLowerCase();
  const isInternalBddCote = quoteSource === 'bdd' || quoteSource.includes('collection bdd') || quoteSource === 'internal';

  // Une cote interne BDD ne doit JAMAIS bloquer la recherche de la vraie cote CardMarket en direct
  if (!isInternalBddCote && knownCote > 0 && quoteAgeDays <= staleDaysThreshold) {
    return {
      eligible: false,
      reason: 'recent_quote_fresh',
      details: {
        known_cote: knownCote,
        cote_date: coteDate ? String(coteDate).split('T')[0] : null,
        age_days: quoteAgeDays,
        max_fresh_days: staleDaysThreshold,
        source: quoteSource
      }
    };
  }

  return {
    eligible: true,
    reason: 'eligible',
    details: {
      buy_price: buyPrice,
      language: rawLang,
      condition: rawCond,
      variant: currentVariant,
      age_days: quoteAgeDays,
      is_missing_quote: knownCote <= 0,
      quota: quotaCheck
    }
  };
}

module.exports = {
  evaluateLiveRecotEligibility,
  normalizeVariant,
  isGradedCard,
  isNearMintCondition,
  isFrenchLanguage,
  GRADED_STATES,
  DEFAULT_MIN_BUY_PRICE,
  DEFAULT_STALE_DAYS_THRESHOLD
};
