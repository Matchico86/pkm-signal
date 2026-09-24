/**
 * Module Métier Pur : Contrat Méta "Buy Analysis"
 * Produit un payload JSON brut, standardisé et headless pour l'enrichissement
 * d'une carte lors d'un événement d'achat (upsert_line).
 */

const CONDITION_RANKS = {
  "MINT": 10,
  "MT": 10,
  "M": 9,
  "NM": 8,
  "EX": 7,
  "GD": 6,
  "LP": 5,
  "PL": 4,
  "PO": 3
};

const HIGH_RARITY_PATTERNS = [
  'sar',
  'sir',
  'ultra',
  'secret',
  'illustration',
  'alternative',
  'special',
  'rainbow',
  'gold',
  'shiny',
  'rare ultra',
  'rare secrète',
  'illustration rare',
  'illustration spéciale',
  'art rare',
  'vmax',
  'vstar'
];

function normalizeCondition(cond) {
  if (!cond) return null;
  return String(cond).trim().toUpperCase();
}

function getConditionRank(cond) {
  const c = normalizeCondition(cond);
  return CONDITION_RANKS[c] || 0;
}

function isHighRarity(rarity) {
  if (!rarity) return false;
  const lower = String(rarity).toLowerCase().trim();
  // Sigles courts exacts (évite que 'ar' matche 'rare' ou 'uncommon')
  if (['ar', 'sar', 'sir', 'ur', 'hr', 'ex', 'gx'].includes(lower)) return true;
  return HIGH_RARITY_PATTERNS.some(p => lower.includes(p));
}

function getDaysDifference(dateStr, refDate = new Date()) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return Infinity;
  const ref = new Date(refDate);
  const diffMs = ref.getTime() - d.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function isVerifiedCoteSource(source) {
  if (!source) return false;
  const s = String(source).toLowerCase().trim();
  return (
    s.includes('cardmarket') ||
    s.includes('transaction') ||
    s.includes('vente') ||
    s.includes('ebay') ||
    s.includes('reception') ||
    s.includes('réception') ||
    s.includes('tcgplayer') ||
    s.includes('bdd') ||
    s.includes('current_cotes') ||
    s.includes('cote_history')
  );
}

/**
 * Construit le payload standardisé Buy Analysis
 * 
 * @param {Object} rawFacts - Données consolidées de la carte (collection, stock, cote, sales, favorites, etc.)
 * @param {Object} itemInput - Données de la ligne entrante (condition, buy_price_unit, card_id, set_id, rarity, etc.)
 * @param {Object} options - Options contextuelles (activeOwners, referenceDate, etc.)
 * @returns {Object} Payload strict assist_signals.payload
 */
function buildBuyAnalysisPayload(rawFacts = {}, itemInput = {}, options = {}) {
  const referenceDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
  const allActiveOwners = options.activeOwners && options.activeOwners.length > 0 
    ? options.activeOwners 
    : ['mathieu', 'ewan', 'leo'];

  const cardId = itemInput.card_id || rawFacts.card_id || "unknown";
  const incomingCondition = normalizeCondition(itemInput.condition) || "NM";
  const incomingRank = getConditionRank(incomingCondition);
  const incomingBuyPrice = Number(itemInput.buy_price_unit || itemInput.price || 0);

  // --- A. Cotation & Fraîcheur ---
  const coteObj = rawFacts.cote || {};
  const quoteValue = (coteObj.last_value !== null && coteObj.last_value !== undefined && !isNaN(Number(coteObj.last_value)))
    ? Number(Number(coteObj.last_value).toFixed(2))
    : null;
  const quoteDate = coteObj.updated_at || coteObj.date || null;
  const quoteSource = coteObj.source || "cardmarket";

  const quoteAgeDays = quoteDate ? getDaysDifference(quoteDate, referenceDate) : Infinity;
  const isFresh = quoteValue !== null && quoteAgeDays >= 0 && quoteAgeDays <= 7;
  const isReliable = quoteValue !== null && quoteValue > 0 && isVerifiedCoteSource(quoteSource);
  const needsRecot = !isFresh || quoteValue === null || quoteValue <= 0;

  const quote = {
    value: quoteValue,
    date: quoteDate ? String(quoteDate).split('T')[0] : null,
    is_fresh: isFresh,
    is_reliable: isReliable,
    needs_recot: needsRecot
  };

  // --- B. Collection & Possession ---
  const collFacts = rawFacts.collection || {};
  const collOwners = Object.keys(collFacts)
    .filter(o => collFacts[o] && (collFacts[o].owned || collFacts[o].quantity > 0))
    .map(o => o.toLowerCase());

  // --- C. Intention de Recherche & Besoins réels ---
  const searchTargets = [];
  const favoriteOwners = (rawFacts.favorites?.owners || rawFacts.favorite_owners || []).map(o => String(o).toLowerCase());
  favoriteOwners.forEach(owner => {
    searchTargets.push({
      owner: owner,
      reason: "favorite"
    });
  });

  const setProgress = rawFacts.set_progress || {};
  const setId = itemInput.set_id || (cardId.includes('-') ? cardId.split('-')[0] : null);

  // Règle métier stricte : On ne signale la complétion de série QUE si la carte est réellement MANQUANTE pour ce profil !
  Object.keys(setProgress).forEach(rawOwner => {
    const owner = rawOwner.toLowerCase();
    const p = setProgress[rawOwner];
    const pct = p ? Number(p.percent !== undefined ? p.percent : (p.progress_pct || 0)) : 0;
    const isAlreadyOwned = collOwners.includes(owner);
    if (pct >= 15 && !isAlreadyOwned) {
      searchTargets.push({
        owner: owner,
        reason: "set_completion",
        set_id: setId || p.set_id || "unknown_set",
        progress_pct: Number(pct.toFixed(1))
      });
    }
  });

  const searchIntent = {
    is_wanted: searchTargets.length > 0,
    targets: searchTargets
  };

  // Règle métier stricte : Une carte n'est "Manquante" QUE si :
  // 1. Elle est dans les Favoris d'un profil actif (et non possédée par celui-ci)
  // OU
  // 2. Le profil actif collectionne activement la série (>= 15% de complétion du set) et ne la possède pas encore
  const missingForOwners = new Set();

  favoriteOwners.forEach(owner => {
    if (!collOwners.includes(owner)) {
      missingForOwners.add(owner);
    }
  });

  Object.keys(setProgress).forEach(rawOwner => {
    const owner = rawOwner.toLowerCase();
    const p = setProgress[rawOwner];
    const pct = p ? Number(p.percent !== undefined ? p.percent : (p.progress_pct || 0)) : 0;
    const isAlreadyOwned = collOwners.includes(owner);
    if (pct >= 15 && !isAlreadyOwned) {
      missingForOwners.add(owner);
    }
  });

  const missingFor = Array.from(missingForOwners);

  const collection = {
    owned: collOwners.length > 0,
    owners: collOwners,
    missing_for: missingFor
  };

  // --- D. Opportunité d'Upgrade d'État (Collection OU Favori uniquement) ---
  // Règle métier stricte : Ne s'applique JAMAIS si la destination de la carte est Stock ou Investissement (achat pour vente)
  const targetList = String(itemInput.target_list || itemInput.list_id || itemInput.targetListId || '').toLowerCase().trim();
  const isDestinationCollection = !targetList || targetList === 'collection' || targetList === 'collec';

  const upgradeTargets = [];
  if (isDestinationCollection) {
    // Candidats à l'upgrade : toute personne qui a la carte en collection OU en favori
    const upgradeCandidates = new Set([...collOwners, ...favoriteOwners]);

    upgradeCandidates.forEach(owner => {
      const oData = collFacts[owner] || {};
      const bestCond = normalizeCondition(oData.best_condition || oData.best_state);
      if (bestCond) {
        const existingRank = getConditionRank(bestCond);
        if (incomingRank > existingRank) {
          upgradeTargets.push({
            owner: owner,
            current_condition: bestCond,
            incoming_condition: incomingCondition
          });
        }
      }
    });
  }

  const upgrade = {
    is_upgrade: upgradeTargets.length > 0,
    targets: upgradeTargets
  };

  // --- E. Vélocité de Vente & Rotation en Stock ---
  const salesFacts = rawFacts.sales || {};
  let totalSold12m = 0;
  let lastSoldDate = salesFacts.last_sold_date || null;

  if (salesFacts.details) {
    Object.keys(salesFacts.details).forEach(o => {
      const d = salesFacts.details[o];
      if (d && d.sold_quantity_12m) {
        totalSold12m += Number(d.sold_quantity_12m);
      }
    });
  } else if (salesFacts.sold_quantity_12m !== undefined) {
    totalSold12m = Number(salesFacts.sold_quantity_12m || 0);
  }

  // Jours en stock
  const stockFacts = rawFacts.stock || {};
  let currentStockTotal = 0;
  if (rawFacts.total_stock !== undefined) {
    currentStockTotal = Number(rawFacts.total_stock);
  } else if (typeof stockFacts === 'number') {
    currentStockTotal = stockFacts;
  } else if (stockFacts.total_stock !== undefined) {
    currentStockTotal = Number(stockFacts.total_stock || 0);
  } else {
    Object.keys(stockFacts).forEach(o => {
      if (typeof stockFacts[o] === 'number') {
        currentStockTotal += stockFacts[o];
      } else if (stockFacts[o] && stockFacts[o].stock_quantity !== undefined) {
        currentStockTotal += Number(stockFacts[o].stock_quantity);
      }
    });
  }

  const oldestStockDate = rawFacts.oldest_stock_date || stockFacts.oldest_stock_date || null;
  const daysInStock = rawFacts.days_in_stock !== undefined
    ? Number(rawFacts.days_in_stock)
    : (oldestStockDate ? getDaysDifference(oldestStockDate, referenceDate) : 0);

  const daysSinceLastSale = lastSoldDate ? getDaysDifference(lastSoldDate, referenceDate) : null;
  const hasNoRecentSale = totalSold12m === 0 || (daysSinceLastSale !== null && daysSinceLastSale > 60);
  const isHardToSell = currentStockTotal > 0 && daysInStock > 60 && hasNoRecentSale;

  const salesVelocity = {
    sold_count_12m: totalSold12m,
    is_hard_to_sell: isHardToSell,
    last_sold_date: lastSoldDate ? String(lastSoldDate).split('T')[0] : null
  };

  // --- F. Indicateurs de Qualité & Investissement ---
  const rarity = itemInput.rarity || rawFacts.card_info?.rarity || rawFacts.rarity || null;
  const isIncomingMintOrNM = incomingRank >= 8; // NM, M, MT
  const isHighRarityCard = isHighRarity(rarity);
  const coteAbove30 = (quoteValue || 0) > 30;

  const gradingPotential = isIncomingMintOrNM && isHighRarityCard && coteAbove30;

  // Invest candidate si grading potential OU présence en stock invest OU SAR/Secret > 50€
  const investStockTotal = typeof rawFacts.invest === 'number'
    ? rawFacts.invest
    : Object.values(rawFacts.invest || {}).reduce((acc, v) => acc + (typeof v === 'number' ? v : (v?.invest_quantity || 0)), 0);

  const isInvestCandidate = gradingPotential || investStockTotal > 0 || (isHighRarityCard && (quoteValue || 0) >= 50);

  const investment = {
    is_invest_candidate: isInvestCandidate,
    grading_potential: gradingPotential
  };

  // --- G. Pression de Stock ---
  const overstockRisk = currentStockTotal >= 3 && hasNoRecentSale;

  const stockPressure = {
    current_stock_total: currentStockTotal,
    overstock_risk: overstockRisk
  };

  const platforms = options.platforms || rawFacts.platforms || {};

  return {
    card_id: cardId,
    quote: {
      ...quote,
      recoted: options.recoted === true,
      recot_skip_reason: options.recotSkipReason || null,
      ...(options.quota ? {
        quota_display: options.quota.display,
        quota_used: options.quota.day_count,
        quota_max: options.quota.max_day,
        quota_remaining: options.quota.remaining
      } : {})
    },
    ...(options.quotas ? { quotas: options.quotas } : {}),
    platforms,
    search_intent: searchIntent,
    collection,
    upgrade,
    sales_velocity: salesVelocity,
    investment,
    stock_pressure: stockPressure
  };
}

module.exports = {
  buildBuyAnalysisPayload,
  getConditionRank,
  isHighRarity,
  getDaysDifference
};
