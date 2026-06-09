const {
  ALERT_TYPE_BASE_PRIORITY,
  DEFAULT_ALERTS_CONFIG,
} = require("./config");
const {
  buildAlertReasonCodes,
  parseScoreReasonCodes,
} = require("./reason-codes");

function toFiniteOrNull(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return numericValue;
}

function clampNumber(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function pctToDisplay(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 1000) / 10;
}

function moneyToDisplay(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function hasPortalRef(row) {
  const portalRef = toFiniteOrNull(row?.portal_ref);
  return portalRef !== null && portalRef > 0;
}

function resolveGapEur(row) {
  const priceRef = toFiniteOrNull(row?.price_ref);
  const portalRef = toFiniteOrNull(row?.portal_ref);
  if (priceRef === null || portalRef === null || portalRef <= 0) {
    return null;
  }
  return priceRef - portalRef;
}

function resolveSeverity(alertType, confidenceScore, primaryScore, strongMove) {
  if (
    strongMove ||
    confidenceScore >= 85 ||
    (alertType === "reprice_down" && primaryScore >= 75)
  ) {
    return "P1";
  }

  if (confidenceScore >= 68 || primaryScore >= 70) {
    return "P2";
  }

  return "P3";
}

function resolvePriorityScore(input) {
  const basePriority = ALERT_TYPE_BASE_PRIORITY[input.alertType] || 100;
  const severityBonus = input.severity === "P1" ? 220 : input.severity === "P2" ? 120 : 40;
  const confidenceBonus = clampNumber(Math.round(input.confidenceScore * 1.6), 0, 160);

  const stockQty = Math.max(0, toFiniteOrNull(input.stockQty) || 0);
  const stockExposure = clampNumber(toFiniteOrNull(input.stockExposure) || 0, 0, 1);
  const stockBonus = input.scope === "owned"
    ? Math.min(120, Math.round(stockQty * 18 + stockExposure * 60))
    : 0;

  let movementBonus = 0;
  if (input.alertType === "reprice_down" || input.alertType === "reprice_up") {
    const gapPct = Math.abs(toFiniteOrNull(input.pricingGapPct) || 0);
    const gapEur = Math.abs(toFiniteOrNull(input.gapEur) || 0);
    movementBonus = Math.round(gapPct * 320 + gapEur * 9);
  } else if (input.alertType === "sell_window_watch") {
    movementBonus =
      Math.round(
        Math.max(0, (toFiniteOrNull(input.d7) || 0)) * 180 +
          Math.max(0, input.primaryScore - 60) * 2
      );
  } else if (input.alertType === "hype_start") {
    movementBonus =
      Math.round(
        Math.max(toFiniteOrNull(input.d3) || 0, toFiniteOrNull(input.d7) || 0, 0) * 280 +
          Math.max(0, toFiniteOrNull(input.accelerationRaw) || 0) * 200
      );
  } else if (input.alertType === "watchlist_opportunity") {
    movementBonus =
      Math.round(
        Math.max(0, input.primaryScore - 55) * 2 +
          Math.max(0, -(toFiniteOrNull(input.d3) || 0)) * 80
      );
  } else if (input.alertType === "supply_tightening") {
    movementBonus =
      Math.round(Math.max(0, -(toFiniteOrNull(input.supplyDelta7d) || 0)) * 260);
  }

  const strongMoveBonus = input.strongMove ? 60 : 0;
  const rawPriority =
    basePriority + severityBonus + confidenceBonus + stockBonus + movementBonus + strongMoveBonus;

  return clampNumber(Math.round(rawPriority), 0, 1000);
}

function buildCommonMetrics(context, primaryScore, strongMove) {
  return {
    score_date: context.score_date,
    score_value: toFiniteOrNull(context.score_value),
    score_tension: toFiniteOrNull(context.score_tension),
    score_hype: toFiniteOrNull(context.score_hype),
    score_reprice: toFiniteOrNull(context.score_reprice),
    score_sell_watch: toFiniteOrNull(context.score_sell_watch),
    score_buy_watch: toFiniteOrNull(context.score_buy_watch),
    confidence_score: toFiniteOrNull(context.confidence_score) || 0,
    stock_qty: toFiniteOrNull(context.stock_qty) || 0,
    stock_snapshot_at: context.stock_snapshot_at || null,
    stock_exposure: toFiniteOrNull(context.stock_exposure) || 0,
    price_ref: toFiniteOrNull(context.price_ref),
    portal_ref: toFiniteOrNull(context.portal_ref),
    pricing_gap_pct: toFiniteOrNull(context.pricing_gap_pct),
    gap_eur: resolveGapEur(context),
    d3: toFiniteOrNull(context.d3),
    d7: toFiniteOrNull(context.d7),
    d14: toFiniteOrNull(context.d14),
    d30: toFiniteOrNull(context.d30),
    acceleration_raw: toFiniteOrNull(context.acceleration_raw),
    cross_confirmation: toFiniteOrNull(context.cross_confirmation),
    listings_now: toFiniteOrNull(context.listings_now),
    listings_7d: toFiniteOrNull(context.listings_7d),
    supply_delta_7d: toFiniteOrNull(context.supply_delta_7d),
    supply_delta_7d_prev: toFiniteOrNull(context.supply_delta_7d_prev),
    source_market_date: context.source_market_date || null,
    target_source: context.target_source || null,
    target_priority: toFiniteOrNull(context.target_priority),
    primary_score: primaryScore,
    strong_move: Boolean(strongMove),
  };
}

function buildCandidate(context, alertType, payload, config) {
  const confidenceScore = toFiniteOrNull(context.confidence_score) || 0;
  const primaryScore = toFiniteOrNull(payload.primaryScore) || 0;
  const strongMove = Boolean(payload.strongMove);
  const severity = resolveSeverity(alertType, confidenceScore, primaryScore, strongMove);
  const metrics = buildCommonMetrics(context, primaryScore, strongMove);
  const scoreReasonCodes = parseScoreReasonCodes(context.reason_codes_json);
  const reasonCodes = buildAlertReasonCodes(alertType, metrics, scoreReasonCodes);
  const priorityScore = resolvePriorityScore({
    alertType,
    severity,
    confidenceScore,
    primaryScore,
    strongMove,
    scope: context.scope,
    stockQty: metrics.stock_qty,
    stockExposure: metrics.stock_exposure,
    pricingGapPct: metrics.pricing_gap_pct,
    gapEur: metrics.gap_eur,
    d3: metrics.d3,
    d7: metrics.d7,
    accelerationRaw: metrics.acceleration_raw,
    supplyDelta7d: metrics.supply_delta_7d,
  });

  return {
    alertType,
    scope: context.scope,
    severity,
    confidenceScore,
    primaryScore,
    priorityScore,
    title: payload.title,
    messageShort: payload.messageShort,
    actionHint: payload.actionHint,
    reasonCodes,
    metrics,
    strongMove,
    confirmed: Boolean(payload.confirmed),
    requiresConfirmation:
      payload.requiresConfirmation !== false && config.confirmationSnapshotsRequired >= 2,
  };
}

function evaluateRepriceUp(context, config) {
  const thresholds = config.thresholds.repriceUp;
  const confidenceScore = toFiniteOrNull(context.confidence_score) || 0;
  const scoreReprice = toFiniteOrNull(context.score_reprice) || 0;
  const pricingGapPct = toFiniteOrNull(context.pricing_gap_pct);
  const gapEur = resolveGapEur(context);

  if (!context.is_owned || !hasPortalRef(context)) {
    return null;
  }

  const baseTriggered =
    confidenceScore >= thresholds.minConfidence &&
    scoreReprice >= thresholds.minScoreReprice &&
    pricingGapPct !== null &&
    pricingGapPct >= thresholds.minGapPct &&
    gapEur !== null &&
    gapEur >= thresholds.minGapEur;
  if (!baseTriggered) {
    return null;
  }

  const strongMove =
    pricingGapPct >= thresholds.strongGapPct || gapEur >= thresholds.strongGapEur;
  const previousGapPct = toFiniteOrNull(context.prev?.pricing_gap_pct);
  const previousTriggered =
    hasPortalRef(context.prev) &&
    (toFiniteOrNull(context.prev?.score_reprice) || 0) >= thresholds.minScoreReprice * 0.9 &&
    previousGapPct !== null &&
    previousGapPct >= thresholds.minGapPct * 0.8;

  const pctValue = pctToDisplay(pricingGapPct);
  const eurValue = moneyToDisplay(gapEur);
  return buildCandidate(
    context,
    "reprice_up",
    {
      primaryScore: scoreReprice,
      strongMove,
      confirmed: previousTriggered || strongMove,
      title: `Reprice up ${context.card_ref}`,
      messageShort: `Marche +${pctValue}% vs ref interne (${eurValue} EUR), conf ${confidenceScore}%.`,
      actionHint: "Tester une hausse moderee du prix de vente.",
    },
    config
  );
}

function evaluateRepriceDown(context, config) {
  const thresholds = config.thresholds.repriceDown;
  const confidenceScore = toFiniteOrNull(context.confidence_score) || 0;
  const scoreReprice = toFiniteOrNull(context.score_reprice) || 0;
  const pricingGapPct = toFiniteOrNull(context.pricing_gap_pct);
  const gapEur = resolveGapEur(context);

  if (!context.is_owned || !hasPortalRef(context)) {
    return null;
  }

  const baseTriggered =
    confidenceScore >= thresholds.minConfidence &&
    scoreReprice >= thresholds.minScoreReprice &&
    pricingGapPct !== null &&
    pricingGapPct <= thresholds.minGapPct &&
    gapEur !== null &&
    gapEur <= thresholds.minGapEur;
  if (!baseTriggered) {
    return null;
  }

  const strongMove =
    pricingGapPct <= thresholds.strongGapPct || gapEur <= thresholds.strongGapEur;
  const previousGapPct = toFiniteOrNull(context.prev?.pricing_gap_pct);
  const previousTriggered =
    hasPortalRef(context.prev) &&
    (toFiniteOrNull(context.prev?.score_reprice) || 0) >= thresholds.minScoreReprice * 0.9 &&
    previousGapPct !== null &&
    previousGapPct <= thresholds.minGapPct * 0.8;

  const pctValue = pctToDisplay(pricingGapPct);
  const eurValue = moneyToDisplay(gapEur);
  return buildCandidate(
    context,
    "reprice_down",
    {
      primaryScore: scoreReprice,
      strongMove,
      confirmed: previousTriggered || strongMove,
      title: `Reprice down ${context.card_ref}`,
      messageShort: `Marche ${pctValue}% vs ref interne (${eurValue} EUR), conf ${confidenceScore}%.`,
      actionHint: "Verifier rapidement une baisse du prix de vente.",
    },
    config
  );
}

function evaluateHypeStart(context, config) {
  const thresholds = config.thresholds.hypeStart;
  const confidenceScore = toFiniteOrNull(context.confidence_score) || 0;
  const scoreHype = toFiniteOrNull(context.score_hype) || 0;
  const d3 = toFiniteOrNull(context.d3);
  const d7 = toFiniteOrNull(context.d7);
  const acceleration = toFiniteOrNull(context.acceleration_raw);
  const cross = toFiniteOrNull(context.cross_confirmation);

  const baseTriggered =
    confidenceScore >= thresholds.minConfidence &&
    scoreHype >= thresholds.minScoreHype &&
    d3 !== null &&
    d3 >= thresholds.minD3 &&
    d7 !== null &&
    d7 >= thresholds.minD7 &&
    acceleration !== null &&
    acceleration >= thresholds.minAcceleration &&
    cross !== null &&
    cross >= thresholds.minCrossConfirmation &&
    Math.max(d3, d7) >= config.minMovePctGlobal;
  if (!baseTriggered) {
    return null;
  }

  const strongMove = scoreHype >= thresholds.strongScoreHype && d3 >= thresholds.strongD3;
  const previousTriggered =
    (toFiniteOrNull(context.prev?.confidence_score) || 0) >= thresholds.minConfidence - 5 &&
    (toFiniteOrNull(context.prev?.score_hype) || 0) >= thresholds.minScoreHype * 0.88 &&
    (toFiniteOrNull(context.prev?.d3) || 0) >= thresholds.minD3 * 0.7;

  const d7Pct = pctToDisplay(d7);
  return buildCandidate(
    context,
    "hype_start",
    {
      primaryScore: scoreHype,
      strongMove,
      confirmed: previousTriggered || strongMove,
      title: `Hype start ${context.card_ref}`,
      messageShort: `Traction en acceleration (hype ${scoreHype}, d7 ${d7Pct}%), conf ${confidenceScore}%.`,
      actionHint: context.is_owned
        ? "Surveiller le prix de vente et le rythme de sortie."
        : "Passer en surveillance renforcee sur watchlist.",
    },
    config
  );
}

function evaluateSupplyTightening(context, config) {
  const thresholds = config.thresholds.supplyTightening;
  const confidenceScore = toFiniteOrNull(context.confidence_score) || 0;
  const supplyDelta7d = toFiniteOrNull(context.supply_delta_7d);
  const listings7d = toFiniteOrNull(context.listings_7d);
  const d7 = toFiniteOrNull(context.d7);

  const baseTriggered =
    confidenceScore >= thresholds.minConfidence &&
    supplyDelta7d !== null &&
    supplyDelta7d <= thresholds.maxSupplyDelta7d &&
    listings7d !== null &&
    listings7d >= thresholds.minListings7d &&
    (d7 === null || d7 >= thresholds.maxPriceDropD7);
  if (!baseTriggered) {
    return null;
  }

  const strongMove = supplyDelta7d <= thresholds.strongSupplyDelta7d;
  const previousSupplyDelta = toFiniteOrNull(context.supply_delta_7d_prev);
  const previousTriggered =
    previousSupplyDelta !== null &&
    previousSupplyDelta <= thresholds.maxSupplyDelta7d * 0.8;

  const supplyPct = pctToDisplay(supplyDelta7d);
  return buildCandidate(
    context,
    "supply_tightening",
    {
      primaryScore: toFiniteOrNull(context.score_tension) || 0,
      strongMove,
      confirmed: previousTriggered || strongMove,
      title: `Supply tightening ${context.card_ref}`,
      messageShort: `Offre -${Math.abs(supplyPct)}% sur 7j avec signal prix stable, conf ${confidenceScore}%.`,
      actionHint: "Verifier la profondeur de marche et preparer une hausse prudente.",
    },
    config
  );
}

function evaluateSellWindowWatch(context, config) {
  const thresholds = config.thresholds.sellWindowWatch;
  const confidenceScore = toFiniteOrNull(context.confidence_score) || 0;
  const scoreSellWatch = toFiniteOrNull(context.score_sell_watch) || 0;
  const scoreTension = toFiniteOrNull(context.score_tension) || 0;
  const d7 = toFiniteOrNull(context.d7);
  const d3 = toFiniteOrNull(context.d3);

  if (!context.is_owned || (toFiniteOrNull(context.stock_qty) || 0) <= 0) {
    return null;
  }

  const baseTriggered =
    confidenceScore >= thresholds.minConfidence &&
    scoreSellWatch >= thresholds.minScoreSellWatch &&
    scoreTension >= thresholds.minScoreTension &&
    d7 !== null &&
    d7 >= thresholds.minD7;
  if (!baseTriggered) {
    return null;
  }

  const strongMove = scoreSellWatch >= thresholds.strongScoreSellWatch && d3 >= thresholds.strongD3;
  const previousTriggered =
    (toFiniteOrNull(context.prev?.score_sell_watch) || 0) >= thresholds.minScoreSellWatch * 0.9 &&
    (toFiniteOrNull(context.prev?.d7) || 0) >= thresholds.minD7 * 0.7;

  const d7Pct = pctToDisplay(d7);
  return buildCandidate(
    context,
    "sell_window_watch",
    {
      primaryScore: scoreSellWatch,
      strongMove,
      confirmed: previousTriggered || strongMove,
      title: `Sell window ${context.card_ref}`,
      messageShort: `Fenetre de vente plausible (sell ${scoreSellWatch}, d7 ${d7Pct}%), conf ${confidenceScore}%.`,
      actionHint: "Verifier prix de sortie et disponibilite stock.",
    },
    config
  );
}

function evaluateWatchlistOpportunity(context, config) {
  const thresholds = config.thresholds.watchlistOpportunity;
  const confidenceScore = toFiniteOrNull(context.confidence_score) || 0;
  const scoreBuyWatch = toFiniteOrNull(context.score_buy_watch) || 0;
  const d3 = toFiniteOrNull(context.d3);
  const d7 = toFiniteOrNull(context.d7);
  const acceleration = toFiniteOrNull(context.acceleration_raw);
  const d30 = toFiniteOrNull(context.d30);

  if (context.scope !== "watchlist") {
    return null;
  }

  const baseTriggered =
    confidenceScore >= thresholds.minConfidence &&
    scoreBuyWatch >= thresholds.minScoreBuyWatch &&
    d3 !== null &&
    d3 >= thresholds.maxD3Drop &&
    d7 !== null &&
    d7 >= thresholds.maxD7Drop &&
    acceleration !== null &&
    acceleration >= thresholds.minAcceleration &&
    (d30 === null || d30 <= 0.35);
  if (!baseTriggered) {
    return null;
  }

  const strongMove =
    scoreBuyWatch >= thresholds.strongScoreBuyWatch && confidenceScore >= 75;
  const previousTriggered =
    (toFiniteOrNull(context.prev?.score_buy_watch) || 0) >= thresholds.minScoreBuyWatch * 0.9 &&
    (toFiniteOrNull(context.prev?.d7) || 0) >= thresholds.maxD7Drop * 1.1;

  const d3Pct = pctToDisplay(d3);
  return buildCandidate(
    context,
    "watchlist_opportunity",
    {
      primaryScore: scoreBuyWatch,
      strongMove,
      confirmed: previousTriggered || strongMove,
      title: `Watchlist opportunity ${context.card_ref}`,
      messageShort: `Point d'entree a verifier (buy ${scoreBuyWatch}, d3 ${d3Pct}%), conf ${confidenceScore}%.`,
      actionHint: "Verifier spread/liquidite avant ajout ou achat.",
    },
    config
  );
}

function evaluateAlertRules(context, config = DEFAULT_ALERTS_CONFIG) {
  const effectiveConfig = { ...DEFAULT_ALERTS_CONFIG, ...config };
  const confidenceScore = toFiniteOrNull(context.confidence_score) || 0;
  if (confidenceScore < effectiveConfig.minConfidenceGlobal) {
    return [];
  }

  const evaluators = [
    evaluateRepriceDown,
    evaluateRepriceUp,
    evaluateSellWindowWatch,
    evaluateHypeStart,
    evaluateWatchlistOpportunity,
    evaluateSupplyTightening,
  ];

  const candidates = [];
  for (const evaluate of evaluators) {
    const candidate = evaluate(context, effectiveConfig);
    if (!candidate) {
      continue;
    }

    candidates.push(candidate);
  }

  return candidates;
}

function buildAlertDedupeKey(assetId, alertType) {
  return `${assetId}:${alertType}`;
}

module.exports = {
  buildAlertDedupeKey,
  evaluateAlertRules,
  hasPortalRef,
  resolveGapEur,
};
