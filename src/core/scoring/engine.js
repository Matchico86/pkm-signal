const { clamp01, neg, pos, safeRatio, sign, weightedMean } = require("./math");
const { buildReasonCodes } = require("./reason-codes");

const SCORE_VERSION = "v1";
const LOOKBACK_DAYS = [3, 7, 14, 30];

const DEFAULT_SCORING_CONFIG = {
  caps: {
    short: 0.2,
    mid: 0.35,
    accel: 0.15,
    pricingGap: 0.2,
    stockQty: 4,
    stockValue: 150,
    overextendedBase: 0.25,
    overextendedCap: 0.2,
  },
  thresholds: {
    shortSignificant: 0.02,
    midSignificant: 0.03,
    repriceDirectionDelta: 0.05,
    freshnessDaysCap: 3,
    spreadLowerBound: 0.08,
    spreadUpperBound: 0.35,
  },
  weights: {
    confidence: {
      freshness: 0.35,
      historyDepth: 0.25,
      spreadQuality: 0.2,
      crossConfirmation: 0.2,
    },
    tension: {
      msUp: 0.3,
      mmUp: 0.25,
      accUp: 0.2,
      crossConfirmation: 0.15,
      spreadQuality: 0.1,
    },
    hype: {
      msUp: 0.4,
      accUp: 0.3,
      crossConfirmation: 0.15,
      spreadQuality: 0.05,
      mmUp: 0.1,
    },
    reprice: {
      gap: 0.45,
      ms: 0.2,
      mm: 0.15,
      crossConfirmation: 0.1,
      stockExposure: 0.1,
    },
    sellWatch: {
      stockExposure: 0.4,
      tension: 0.35,
      hype: 0.15,
      gapUp: 0.1,
    },
    buyWatch: {
      msUp: 0.28,
      accUp: 0.27,
      mmUp: 0.15,
      crossConfirmation: 0.15,
      spreadQuality: 0.1,
      stockInverse: 0.05,
      overextendedPenalty: 0.2,
    },
  },
};

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(baseConfig, overrideConfig) {
  if (!isPlainObject(overrideConfig)) {
    return baseConfig;
  }

  const output = { ...baseConfig };
  for (const [key, value] of Object.entries(overrideConfig)) {
    if (isPlainObject(value) && isPlainObject(baseConfig[key])) {
      output[key] = mergeConfig(baseConfig[key], value);
      continue;
    }

    output[key] = value;
  }

  return output;
}

function resolveScoringConfig(options = {}) {
  let resolvedConfig = DEFAULT_SCORING_CONFIG;

  const rawEnvConfig = process.env.PKM_SCORING_CONFIG_JSON;
  if (rawEnvConfig) {
    try {
      const envConfig = JSON.parse(rawEnvConfig);
      resolvedConfig = mergeConfig(resolvedConfig, envConfig);
    } catch (error) {
      throw new Error(`Invalid PKM_SCORING_CONFIG_JSON: ${error.message}`);
    }
  }

  if (options.configJson) {
    try {
      const cliConfig = JSON.parse(options.configJson);
      resolvedConfig = mergeConfig(resolvedConfig, cliConfig);
    } catch (error) {
      throw new Error(`Invalid --config-json payload: ${error.message}`);
    }
  }

  return resolvedConfig;
}

function toFiniteOrNull(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return numericValue;
}

function safeVariation(currentValue, pastValue) {
  if (!Number.isFinite(currentValue) || !Number.isFinite(pastValue) || pastValue <= 0) {
    return null;
  }

  return currentValue / pastValue - 1;
}

function diffDays(isoDateA, isoDateB) {
  const msA = Date.parse(`${isoDateA}T00:00:00.000Z`);
  const msB = Date.parse(`${isoDateB}T00:00:00.000Z`);
  if (!Number.isFinite(msA) || !Number.isFinite(msB)) {
    return null;
  }

  return Math.max(0, Math.floor((msA - msB) / 86_400_000));
}

function computeCrossConfirmation(features, config) {
  const checks = [];
  const shortThreshold = config.thresholds.shortSignificant;
  const midThreshold = config.thresholds.midSignificant;

  if (
    Number.isFinite(features.d3) &&
    Number.isFinite(features.d7) &&
    Math.abs(features.d3) >= shortThreshold &&
    Math.abs(features.d7) >= shortThreshold
  ) {
    checks.push(sign(features.d3) !== 0 && sign(features.d3) === sign(features.d7));
  }

  if (
    Number.isFinite(features.d7) &&
    Number.isFinite(features.d30) &&
    Math.abs(features.d7) >= midThreshold &&
    Math.abs(features.d30) >= midThreshold
  ) {
    checks.push(sign(features.d7) !== 0 && sign(features.d7) === sign(features.d30));
  }

  if (
    Number.isFinite(features.acceleration_raw) &&
    Number.isFinite(features.momentum_short_raw)
  ) {
    checks.push(
      sign(features.acceleration_raw) !== 0 &&
        sign(features.acceleration_raw) === sign(features.momentum_short_raw)
    );
  }

  if (
    Number.isFinite(features.d3) &&
    Math.abs(features.d3) >= shortThreshold &&
    Number.isFinite(features.p0ListingsCount) &&
    Number.isFinite(features.p3ListingsCount)
  ) {
    const priceUpOfferDown = features.d3 > 0 && features.p0ListingsCount < features.p3ListingsCount;
    const priceDownOfferUp = features.d3 < 0 && features.p0ListingsCount > features.p3ListingsCount;
    checks.push(priceUpOfferDown || priceDownOfferUp);
  }

  if (
    Number.isFinite(features.d3) &&
    Math.abs(features.d3) >= shortThreshold &&
    Array.isArray(features.sameDayRefs) &&
    features.sameDayRefs.length >= 2 &&
    Number.isFinite(features.p3)
  ) {
    const recentSigns = features.sameDayRefs
      .map((ref) => safeVariation(ref, features.p3))
      .filter((variation) => Number.isFinite(variation) && Math.abs(variation) >= shortThreshold)
      .map((variation) => sign(variation))
      .filter((direction) => direction !== 0);

    if (recentSigns.length >= 2) {
      const expectedDirection = sign(features.d3);
      checks.push(recentSigns.every((direction) => direction === expectedDirection));
    }
  }

  if (checks.length === 0) {
    return {
      value: null,
      checksAvailable: 0,
      checksPassed: 0,
    };
  }

  const checksPassed = checks.filter(Boolean).length;
  return {
    value: checksPassed / checks.length,
    checksAvailable: checks.length,
    checksPassed,
  };
}

function finalizeScore(scoreRaw, confidenceRaw) {
  const safeScoreRaw = clamp01(Number(scoreRaw));
  const safeConfidenceRaw = clamp01(Number(confidenceRaw));

  if (safeScoreRaw === null || safeConfidenceRaw === null) {
    return 0;
  }

  const damping = 0.6 + 0.4 * safeConfidenceRaw;
  return Math.round(100 * safeScoreRaw * damping);
}

function computeScoringSnapshot(input, config = DEFAULT_SCORING_CONFIG) {
  const p0 = toFiniteOrNull(input.p0);
  if (p0 === null || p0 <= 0) {
    return null;
  }

  const p3 = toFiniteOrNull(input.p3);
  const p7 = toFiniteOrNull(input.p7);
  const p14 = toFiniteOrNull(input.p14);
  const p30 = toFiniteOrNull(input.p30);

  const d3 = safeVariation(p0, p3);
  const d7 = safeVariation(p0, p7);
  const d14 = safeVariation(p0, p14);
  const d30 = safeVariation(p0, p30);

  const momentumShortRaw = weightedMean([
    { value: d3, weight: 0.6 },
    { value: d7, weight: 0.4 },
  ]);
  const momentumMidRaw = weightedMean([
    { value: d14, weight: 0.6 },
    { value: d30, weight: 0.4 },
  ]);
  const accelerationRaw =
    Number.isFinite(momentumShortRaw) && Number.isFinite(momentumMidRaw)
      ? momentumShortRaw - momentumMidRaw
      : null;

  const p0Low = toFiniteOrNull(input.p0Low);
  const p0High = toFiniteOrNull(input.p0High);
  let spreadRaw = null;
  if (Number.isFinite(p0Low) && Number.isFinite(p0High) && p0High >= p0Low && p0 > 0) {
    spreadRaw = safeRatio(p0High - p0Low, p0);
  } else if (Array.isArray(input.sameDayRefs) && input.sameDayRefs.length >= 2) {
    const refs = input.sameDayRefs.filter((value) => Number.isFinite(value) && value > 0);
    if (refs.length >= 2) {
      const maxRef = Math.max(...refs);
      const minRef = Math.min(...refs);
      const avgRef = refs.reduce((sum, value) => sum + value, 0) / refs.length;
      spreadRaw = safeRatio(maxRef - minRef, avgRef);
    }
  }

  let spreadQuality = null;
  if (Number.isFinite(spreadRaw) && spreadRaw >= 0) {
    const normalizedSpread = clamp01(
      (spreadRaw - config.thresholds.spreadLowerBound) /
        (config.thresholds.spreadUpperBound - config.thresholds.spreadLowerBound)
    );
    spreadQuality = normalizedSpread === null ? null : 1 - normalizedSpread;
  }

  const daysSinceLastMarketSnapshot = diffDays(input.scoreDate, input.latestMarketDate);
  const freshnessScore =
    Number.isFinite(daysSinceLastMarketSnapshot)
      ? 1 - clamp01(daysSinceLastMarketSnapshot / config.thresholds.freshnessDaysCap)
      : null;

  const historyDepth =
    [p3, p7, p14, p30].filter((value) => Number.isFinite(value) && value > 0).length /
    LOOKBACK_DAYS.length;

  const cross = computeCrossConfirmation(
    {
      d3,
      d7,
      d30,
      acceleration_raw: accelerationRaw,
      momentum_short_raw: momentumShortRaw,
      p0ListingsCount: toFiniteOrNull(input.p0ListingsCount),
      p3ListingsCount: toFiniteOrNull(input.p3ListingsCount),
      sameDayRefs: input.sameDayRefs || [],
      p3,
    },
    config
  );

  const stockQty = Math.max(0, Number.isFinite(input.stockQty) ? Number(input.stockQty) : 0);
  const stockMarketValue = stockQty * p0;
  const qtyExposure = clamp01(stockQty / config.caps.stockQty);
  const valueExposure = clamp01(stockMarketValue / config.caps.stockValue);
  const stockExposure = weightedMean([
    { value: qtyExposure, weight: 0.35 },
    { value: valueExposure, weight: 0.65 },
  ]);
  const safeStockExposure = Number.isFinite(stockExposure) ? stockExposure : 0;

  const portalRef = toFiniteOrNull(input.portalRef);
  const hasPortalRef = Number.isFinite(portalRef) && portalRef > 0;
  const pricingGapPct =
    hasPortalRef ? safeVariation(p0, portalRef) : null;

  const msUp = pos(momentumShortRaw, config.caps.short);
  const msDn = neg(momentumShortRaw, config.caps.short);
  const mmUp = pos(momentumMidRaw, config.caps.mid);
  const mmDn = neg(momentumMidRaw, config.caps.mid);
  const accUp = pos(accelerationRaw, config.caps.accel);
  const accDn = neg(accelerationRaw, config.caps.accel);
  const gapUp = pos(pricingGapPct, config.caps.pricingGap);
  const gapDn = neg(pricingGapPct, config.caps.pricingGap);

  const confidenceRaw =
    weightedMean([
      { value: freshnessScore, weight: config.weights.confidence.freshness },
      { value: historyDepth, weight: config.weights.confidence.historyDepth },
      { value: spreadQuality, weight: config.weights.confidence.spreadQuality },
      { value: cross.value, weight: config.weights.confidence.crossConfirmation },
    ]) || 0;

  const scoreTensionRaw =
    weightedMean([
      { value: msUp, weight: config.weights.tension.msUp },
      { value: mmUp, weight: config.weights.tension.mmUp },
      { value: accUp, weight: config.weights.tension.accUp },
      { value: cross.value, weight: config.weights.tension.crossConfirmation },
      { value: spreadQuality, weight: config.weights.tension.spreadQuality },
    ]) || 0;

  const scoreHypeRaw =
    weightedMean([
      { value: msUp, weight: config.weights.hype.msUp },
      { value: accUp, weight: config.weights.hype.accUp },
      { value: cross.value, weight: config.weights.hype.crossConfirmation },
      { value: spreadQuality, weight: config.weights.hype.spreadQuality },
      { value: mmUp, weight: config.weights.hype.mmUp },
    ]) || 0;

  let repriceUpRaw = 0;
  let repriceDownRaw = 0;
  let repriceDirection = "NONE";
  let scoreRepriceRaw = 0;
  if (hasPortalRef) {
    repriceUpRaw =
      weightedMean([
        { value: gapUp, weight: config.weights.reprice.gap },
        { value: msUp, weight: config.weights.reprice.ms },
        { value: mmUp, weight: config.weights.reprice.mm },
        { value: cross.value, weight: config.weights.reprice.crossConfirmation },
        { value: safeStockExposure, weight: config.weights.reprice.stockExposure },
      ]) || 0;

    repriceDownRaw =
      weightedMean([
        { value: gapDn, weight: config.weights.reprice.gap },
        { value: msDn, weight: config.weights.reprice.ms },
        { value: mmDn, weight: config.weights.reprice.mm },
        { value: cross.value, weight: config.weights.reprice.crossConfirmation },
        { value: safeStockExposure, weight: config.weights.reprice.stockExposure },
      ]) || 0;

    const directionDelta = config.thresholds.repriceDirectionDelta;
    if (repriceUpRaw > repriceDownRaw + directionDelta) {
      repriceDirection = "UP";
    } else if (repriceDownRaw > repriceUpRaw + directionDelta) {
      repriceDirection = "DOWN";
    }

    scoreRepriceRaw = Math.max(repriceUpRaw, repriceDownRaw);
  }

  const scoreSellWatchRaw =
    clamp01(
      weightedMean([
        { value: safeStockExposure, weight: config.weights.sellWatch.stockExposure },
        { value: scoreTensionRaw, weight: config.weights.sellWatch.tension },
        { value: scoreHypeRaw, weight: config.weights.sellWatch.hype },
        { value: gapUp, weight: config.weights.sellWatch.gapUp },
      ]) || 0
    ) || 0;

  const overextended =
    pos(
      Number.isFinite(momentumMidRaw)
        ? momentumMidRaw - config.caps.overextendedBase
        : null,
      config.caps.overextendedCap
    ) || 0;
  const buyWatchPositiveBase =
    weightedMean([
      { value: msUp, weight: config.weights.buyWatch.msUp },
      { value: accUp, weight: config.weights.buyWatch.accUp },
      { value: mmUp, weight: config.weights.buyWatch.mmUp },
      { value: cross.value, weight: config.weights.buyWatch.crossConfirmation },
      { value: spreadQuality, weight: config.weights.buyWatch.spreadQuality },
      { value: 1 - safeStockExposure, weight: config.weights.buyWatch.stockInverse },
    ]) || 0;

  const scoreBuyWatchRaw =
    clamp01(
      buyWatchPositiveBase - config.weights.buyWatch.overextendedPenalty * overextended
    ) || 0;

  const confidenceScore = Math.round(100 * confidenceRaw);
  const scoreTension = finalizeScore(scoreTensionRaw, confidenceRaw);
  const scoreHype = finalizeScore(scoreHypeRaw, confidenceRaw);
  const scoreReprice = finalizeScore(scoreRepriceRaw, confidenceRaw);
  const scoreSellWatch = finalizeScore(scoreSellWatchRaw, confidenceRaw);
  const scoreBuyWatch = finalizeScore(scoreBuyWatchRaw, confidenceRaw);

  const reasonCodes = buildReasonCodes({
    ms_up: msUp || 0,
    ms_dn: msDn || 0,
    mm_up: mmUp || 0,
    mm_dn: mmDn || 0,
    acc_up: accUp || 0,
    acc_dn: accDn || 0,
    gap_up: gapUp || 0,
    gap_dn: gapDn || 0,
    spread_quality: spreadQuality,
    freshness_score: freshnessScore,
    cross_confirmation: cross.value,
    history_depth: historyDepth,
    stock_exposure: stockExposure || 0,
    overextended,
    reprice_direction: repriceDirection,
    has_portal_ref: hasPortalRef,
  });

  const legacyScores = {
    score_tension: scoreTension,
    score_hype: scoreHype,
    score_reprice: scoreReprice,
    score_sell_watch: scoreSellWatch,
    score_buy_watch: scoreBuyWatch,
  };
  const [topScoreLabel, topScoreValue] = Object.entries(legacyScores).sort(
    (a, b) => b[1] - a[1]
  )[0];

  return {
    score_version: SCORE_VERSION,
    price_ref: p0,
    portal_ref: portalRef,
    d3,
    d7,
    d14,
    d30,
    momentum_short_raw: momentumShortRaw,
    momentum_mid_raw: momentumMidRaw,
    acceleration_raw: accelerationRaw,
    spread_raw: spreadRaw,
    spread_quality: spreadQuality,
    freshness_score: freshnessScore,
    history_depth: historyDepth,
    cross_confirmation: cross.value,
    stock_exposure: stockExposure,
    pricing_gap_pct: pricingGapPct,
    confidence_score: confidenceScore,
    score_tension: scoreTension,
    score_hype: scoreHype,
    score_reprice: scoreReprice,
    reprice_direction: repriceDirection,
    score_sell_watch: scoreSellWatch,
    score_buy_watch: scoreBuyWatch,
    reason_codes: reasonCodes,
    legacy_score_value: topScoreValue,
    legacy_score_label: topScoreLabel,
    overextended,
    diagnostics: {
      score_tension_raw: scoreTensionRaw,
      score_hype_raw: scoreHypeRaw,
      score_reprice_raw: scoreRepriceRaw,
      score_sell_watch_raw: scoreSellWatchRaw,
      score_buy_watch_raw: scoreBuyWatchRaw,
      confidence_score_raw: confidenceRaw,
      checks_available: cross.checksAvailable,
      checks_passed: cross.checksPassed,
      reprice_up_raw: repriceUpRaw,
      reprice_down_raw: repriceDownRaw,
    },
  };
}

module.exports = {
  DEFAULT_SCORING_CONFIG,
  LOOKBACK_DAYS,
  SCORE_VERSION,
  computeScoringSnapshot,
  resolveScoringConfig,
};
