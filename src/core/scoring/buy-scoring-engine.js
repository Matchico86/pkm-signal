/**
 * Moteur de Scoring Acheter V1.1 (Corrections QG)
 * Analyse un payload enrichi (snapshot + internal_data) et génère la décision structurée finale.
 */

const THRESHOLDS = {
  EXPENSIVE: 30.00,
  VERY_EXPENSIVE: 50.00,
  STALE_QUOTE_DAYS: 14,
  VERY_STALE_QUOTE_DAYS: 30,
  OVERSTOCK: 5,
  LOW_LIQUIDITY: 1.0,
  OPPORTUNITY_DISCOUNT: 30 // pourcentage
};

// Ordre de priorité des états de cartes pour comparer l'upgrade
const STATE_HIERARCHY = ['PO', 'PL', 'LP', 'GD', 'EX', 'NM', 'MT', 'GM', 'GR9', 'GR10'];

function isBetterState(newState, oldState) {
  if (!newState || !oldState) return false;
  return STATE_HIERARCHY.indexOf(newState) > STATE_HIERARCHY.indexOf(oldState);
}

function analyzeItem(item) {
  const { internal_data = {} } = item;
  const badges = [];
  const debug_reasons = [];
  let decision = 'buy'; // Valeurs permises: buy, buy_more, negotiate, verify_before_buy, avoid
  let confidence = 0.50;
  let primary_reason = 'financial_opportunity'; 
  let risk_level = 'low';
  let external_check_needed = false;
  let external_check_reason = null;
  let recommended_destination = 'stock';
  let message = '';
  let actions = [];

  // Vérification de la présence des données d'enrichissement
  if (internal_data.enrichment_status === 'missing' || internal_data.enrichment_status === 'partial') {
    confidence = 0.30;
    badges.push('Données internes indisponibles');
    message = 'Analyse partielle : les données de collection, stock ou historique sont inaccessibles.';
    debug_reasons.push('missing_enrichment_data');
    
    // Fallback: On évalue juste financièrement si possible
    let fallbackDiscount = 0;
    if (item.internal_market_price_unit > 0 && item.buy_price_unit > 0) {
      fallbackDiscount = ((item.internal_market_price_unit - item.buy_price_unit) / item.internal_market_price_unit) * 100;
    }
    
    if (fallbackDiscount >= THRESHOLDS.OPPORTUNITY_DISCOUNT) {
      decision = 'buy_more';
      primary_reason = 'cheap_vs_market';
      badges.push(`Décote ${Math.round(fallbackDiscount)}%`);
      debug_reasons.push('fallback_discount_rule');
    } else if (item.buy_price_unit > THRESHOLDS.EXPENSIVE) {
      decision = 'verify_before_buy';
      primary_reason = 'expensive_card';
      badges.push('Carte chère');
      risk_level = 'medium';
    } else {
      decision = 'buy';
    }
    
    return {
      line_id: item.line_id,
      decision,
      confidence,
      primary_reason,
      badges,
      message,
      recommended_destination,
      actions,
      risk_level,
      external_check_needed,
      external_check_reason,
      debug_reasons
    };
  }

  // --- Données d'enrichissement présentes --- //
  
  const isExpensive = item.buy_price_unit >= THRESHOLDS.EXPENSIVE;
  const isVeryExpensive = item.buy_price_unit >= THRESHOLDS.VERY_EXPENSIVE;
  
  const isStaleQuote = internal_data.quote_age_days >= THRESHOLDS.STALE_QUOTE_DAYS;
  const isVeryStaleQuote = internal_data.quote_age_days >= THRESHOLDS.VERY_STALE_QUOTE_DAYS;

  const isOverstocked = internal_data.current_stock >= THRESHOLDS.OVERSTOCK;
  const isIlliquid = internal_data.sales_velocity < THRESHOLDS.LOW_LIQUIDITY;
  
  let discountPct = 0;
  if (item.internal_market_price_unit > 0 && item.buy_price_unit > 0) {
    discountPct = ((item.internal_market_price_unit - item.buy_price_unit) / item.internal_market_price_unit) * 100;
  }
  const isHighDiscount = discountPct >= THRESHOLDS.OPPORTUNITY_DISCOUNT;

  const missingMathieu = internal_data.mathieu_collection && internal_data.mathieu_collection.owned === false;
  const missingEwan = internal_data.ewan_collection && internal_data.ewan_collection.owned === false;

  const ownedBetterMathieu = internal_data.mathieu_collection && internal_data.mathieu_collection.owned && !isBetterState(item.condition, internal_data.mathieu_collection.best_state);
  const ownedBetterEwan = internal_data.ewan_collection && internal_data.ewan_collection.owned && !isBetterState(item.condition, internal_data.ewan_collection.best_state);

  // 1. Règle Modérée : verify_before_buy
  if (isVeryExpensive && isVeryStaleQuote) {
    decision = 'verify_before_buy';
    confidence = 0.40;
    primary_reason = 'very_stale_internal_quote';
    badges.push('Très chère', 'Cote très ancienne');
    external_check_needed = true;
    external_check_reason = 'very_expensive_and_stale';
    actions.push('verify_market_price');
    risk_level = 'high';
    message = `Vigilance Absolue : Carte très chère (${item.buy_price_unit}€) et cote interne obsolète (>30 jours). Ne pas acheter sans vérification.`;
    debug_reasons.push('rule_very_expensive_very_stale');
  } else if (isExpensive && isStaleQuote) {
    decision = 'verify_before_buy';
    confidence = 0.60;
    primary_reason = 'stale_internal_quote';
    badges.push('Carte chère', 'Cote ancienne');
    external_check_needed = true;
    external_check_reason = 'expensive_and_stale';
    actions.push('verify_market_price');
    risk_level = 'medium';
    message = `Vérification requise : Carte chère (${item.buy_price_unit}€) avec une cote ancienne (>14 jours).`;
    debug_reasons.push('rule_expensive_stale');
  } else {
    // Badges simples sans forcer la vérification
    if (isExpensive) badges.push('Carte chère');
    if (isStaleQuote) badges.push('Cote ancienne');
  }

  // Si on a pas déjà forcé verify_before_buy, on évalue les autres règles
  if (decision !== 'verify_before_buy') {
    // 2. Règle : Surstock + Faible liquidité
    if (isOverstocked && isIlliquid) {
      decision = 'avoid';
      confidence = 0.85;
      primary_reason = 'overstocked_set';
      badges.push('Surstock', 'Illiquide');
      risk_level = 'high';
      message = `Déjà ${internal_data.current_stock} exemplaires en stock et vélocité de vente faible (${internal_data.sales_velocity}/mois). Achat risqué.`;
      debug_reasons.push('rule_overstock_illiquid');
    }
    // 3. Règle : Manque collection
    else if (missingMathieu || missingEwan) {
      decision = 'buy';
      confidence = 0.88;
      primary_reason = 'missing_collection';
      if (missingMathieu) {
        badges.push('Manque Mathieu');
        recommended_destination = 'collection_mathieu';
      } else {
        badges.push('Manque Ewan');
        recommended_destination = 'collection_ewan';
      }
      risk_level = 'low';
      message = `Absente de la collection ${missingMathieu ? 'Mathieu' : 'Ewan'}.`;
      debug_reasons.push('rule_missing_collection');
    }
    // 4. Règle : Forte décote + Bonne liquidité
    else if (isHighDiscount && !isIlliquid) {
      decision = 'buy_more';
      confidence = 0.90;
      primary_reason = 'cheap_vs_market';
      badges.push(`Décote ${Math.round(discountPct)}%`, 'Forte liquidité');
      risk_level = 'low';
      message = `Excellente opportunité d'achat (décote importante et bonne liquidité).`;
      debug_reasons.push('rule_high_discount_liquid');
    }
    // 5. Règle : Déjà possédée en meilleur état
    else if ((ownedBetterMathieu || ownedBetterEwan) && !isHighDiscount) {
      decision = 'avoid';
      confidence = 0.80;
      primary_reason = 'already_owned_better';
      badges.push('Déjà possédée');
      risk_level = 'medium';
      message = `Vous possédez déjà cette carte en meilleur état ou équivalent.`;
      debug_reasons.push('rule_already_owned_better');
    }
    // Par défaut
    else {
      decision = 'buy';
      confidence = 0.70;
      primary_reason = 'good_resale_history';
      badges.push('Achat Standard');
      message = 'Prix correct, paramètres standard. Peut être acheté pour le stock.';
      debug_reasons.push('rule_default_buy');
    }

    // Ajustement Upgrade État (n'écrase pas la décision, change juste la reason/badge/destination)
    if ((internal_data.mathieu_collection && internal_data.mathieu_collection.owned && isBetterState(item.condition, internal_data.mathieu_collection.best_state)) ||
        (internal_data.ewan_collection && internal_data.ewan_collection.owned && isBetterState(item.condition, internal_data.ewan_collection.best_state))) {
      if (decision === 'buy') {
        primary_reason = 'condition_upgrade';
        badges.push('Upgrade État');
        message = `Cette carte améliorera l'état de la collection existante.`;
        debug_reasons.push('rule_condition_upgrade');
      }
    }
  }

  return {
    line_id: item.line_id,
    decision,
    confidence,
    primary_reason,
    badges,
    message,
    recommended_destination,
    actions,
    risk_level,
    external_check_needed,
    external_check_reason,
    debug_reasons
  };
}

function buildSummary(scoredItems, orderContext) {
  const decisions = scoredItems.map(i => i.decision);
  const confidences = scoredItems.map(i => i.confidence);
  
  const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
  
  const hasAvoid = decisions.includes('avoid');
  const hasVerify = decisions.includes('verify_before_buy');

  let overallDecision = 'buy';
  if (hasAvoid) overallDecision = 'negotiate'; 
  if (hasVerify) overallDecision = 'verify_before_buy'; 

  let title = "Commande standard, prête pour l'achat.";
  if (hasAvoid && hasVerify) title = "Commande complexe : des cartes à éviter et d'autres à vérifier.";
  else if (hasAvoid) title = "Attention : plusieurs cartes ne valent pas le coup.";
  else if (hasVerify) title = "Commande intéressante mais des vérifications de prix sont requises.";

  const priority_alerts = [];
  
  // Alertes pour High Risk (Très chère + Très Ancienne)
  const highRiskCount = scoredItems.filter(i => i.risk_level === 'high' && i.decision === 'verify_before_buy').length;
  if (highRiskCount > 0) priority_alerts.push(`🚨 VIGILANCE ABSOLUE : ${highRiskCount} carte(s) très chère(s) (>50€) avec cote obsolète (>30j).`);

  const verifyCount = scoredItems.filter(i => i.decision === 'verify_before_buy' && i.risk_level === 'medium').length;
  if (verifyCount > 0) priority_alerts.push(`${verifyCount} carte(s) chère(s) avec une ancienne cote à vérifier manuellement.`);
  
  const avoidCount = scoredItems.filter(i => i.decision === 'avoid').length;
  if (avoidCount > 0) priority_alerts.push(`${avoidCount} carte(s) à éviter (surstock, doublon ou manque de liquidité).`);

  const missingCount = scoredItems.filter(i => i.primary_reason === 'missing_collection').length;
  if (missingCount > 0) priority_alerts.push(`${missingCount} carte(s) manquante(s) identifiée(s) pour la collection.`);

  const partialCount = scoredItems.filter(i => i.debug_reasons.includes('missing_enrichment_data')).length;
  if (partialCount > 0) priority_alerts.push(`⚠️ ${partialCount} carte(s) analysée(s) partiellement (données internes manquantes).`);

  return {
    decision: overallDecision,
    confidence: Number(avgConfidence.toFixed(2)),
    title,
    message: "Analyse automatisée basée sur les collections et cotes internes actuelles.",
    priority_alerts,
    order_context: orderContext // Conservation des frais et totaux
  };
}

function analyzeOrder(snapshot, enrichedItems) {
  const scoredItems = enrichedItems.map(analyzeItem);
  const summary = buildSummary(scoredItems, snapshot.order);

  return {
    summary,
    items: scoredItems
  };
}

module.exports = {
  analyzeOrder,
  analyzeItem,
  buildSummary,
  THRESHOLDS
};
