const ALERT_REASON_CODES = {
  PX_ABOVE_LIST: "PX_ABOVE_LIST",
  PX_BELOW_LIST: "PX_BELOW_LIST",
  PX_7D_UP: "PX_7D_UP",
  PX_7D_DOWN: "PX_7D_DOWN",
  PX_30D_UP: "PX_30D_UP",
  SUPPLY_7D_DOWN: "SUPPLY_7D_DOWN",
  SUPPLY_7D_UP: "SUPPLY_7D_UP",
  LIQ_OK: "LIQ_OK",
  ROI_TARGET_HIT: "ROI_TARGET_HIT",
  MOMENTUM_SLOWING: "MOMENTUM_SLOWING",
  WATCHLIST_ENTRY: "WATCHLIST_ENTRY",
  EARLY_SIGNAL: "EARLY_SIGNAL",
  MISSING_PORTAL_REF: "MISSING_PORTAL_REF",
  LOW_CONFIDENCE: "LOW_CONFIDENCE",
};

function parseScoreReasonCodes(reasonCodesJson) {
  if (!reasonCodesJson || typeof reasonCodesJson !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(reasonCodesJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (_error) {
    return {};
  }
}

function pickScoreReasonCodes(scoreReasonCodes, scoreKey, maxCodes = 2) {
  const codes = scoreReasonCodes?.[scoreKey];
  if (!Array.isArray(codes)) {
    return [];
  }

  return codes
    .filter((code) => typeof code === "string" && code.trim() !== "")
    .slice(0, maxCodes);
}

function dedupeReasonCodes(codes) {
  const deduped = [];
  const seen = new Set();

  for (const code of codes) {
    if (!code || seen.has(code)) {
      continue;
    }
    seen.add(code);
    deduped.push(code);
  }

  return deduped;
}

function buildAlertReasonCodes(alertType, metrics, scoreReasonCodes) {
  const codes = [];
  const hasPortalRef = Number.isFinite(metrics.portal_ref) && metrics.portal_ref > 0;
  const pricingGapPct = Number(metrics.pricing_gap_pct);
  const d7 = Number(metrics.d7);
  const d30 = Number(metrics.d30);
  const accelerationRaw = Number(metrics.acceleration_raw);
  const listingsNow = Number(metrics.listings_now);
  const supplyDelta7d = Number(metrics.supply_delta_7d);

  if (alertType === "reprice_up") {
    codes.push(ALERT_REASON_CODES.PX_ABOVE_LIST);
    if (pricingGapPct >= 0.12) {
      codes.push(ALERT_REASON_CODES.ROI_TARGET_HIT);
    }
    if (Number.isFinite(d7) && d7 >= 0.06) {
      codes.push(ALERT_REASON_CODES.PX_7D_UP);
    }
    if (listingsNow >= 8) {
      codes.push(ALERT_REASON_CODES.LIQ_OK);
    }
    if (!hasPortalRef) {
      codes.push(ALERT_REASON_CODES.MISSING_PORTAL_REF);
    }
    return dedupeReasonCodes([
      ...codes,
      ...pickScoreReasonCodes(scoreReasonCodes, "score_reprice", 2),
    ]).slice(0, 5);
  }

  if (alertType === "reprice_down") {
    codes.push(ALERT_REASON_CODES.PX_BELOW_LIST);
    if (Number.isFinite(d7) && d7 <= -0.05) {
      codes.push(ALERT_REASON_CODES.PX_7D_DOWN);
    }
    if (Number.isFinite(accelerationRaw) && accelerationRaw < -0.01) {
      codes.push(ALERT_REASON_CODES.MOMENTUM_SLOWING);
    }
    if (listingsNow >= 8) {
      codes.push(ALERT_REASON_CODES.LIQ_OK);
    }
    if (!hasPortalRef) {
      codes.push(ALERT_REASON_CODES.MISSING_PORTAL_REF);
    }
    return dedupeReasonCodes([
      ...codes,
      ...pickScoreReasonCodes(scoreReasonCodes, "score_reprice", 2),
    ]).slice(0, 5);
  }

  if (alertType === "hype_start") {
    codes.push(ALERT_REASON_CODES.EARLY_SIGNAL);
    if (Number.isFinite(d7) && d7 > 0.05) {
      codes.push(ALERT_REASON_CODES.PX_7D_UP);
    }
    if (Number.isFinite(d30) && d30 > 0.08) {
      codes.push(ALERT_REASON_CODES.PX_30D_UP);
    }
    if (listingsNow >= 8) {
      codes.push(ALERT_REASON_CODES.LIQ_OK);
    }
    return dedupeReasonCodes([
      ...codes,
      ...pickScoreReasonCodes(scoreReasonCodes, "score_hype", 2),
    ]).slice(0, 5);
  }

  if (alertType === "supply_tightening") {
    codes.push(ALERT_REASON_CODES.SUPPLY_7D_DOWN);
    if (Number.isFinite(supplyDelta7d) && supplyDelta7d > 0) {
      codes.push(ALERT_REASON_CODES.SUPPLY_7D_UP);
    }
    if (Number.isFinite(d7) && d7 >= 0.03) {
      codes.push(ALERT_REASON_CODES.PX_7D_UP);
    }
    codes.push(ALERT_REASON_CODES.EARLY_SIGNAL);
    return dedupeReasonCodes([
      ...codes,
      ...pickScoreReasonCodes(scoreReasonCodes, "score_tension", 2),
    ]).slice(0, 5);
  }

  if (alertType === "sell_window_watch") {
    if (Number.isFinite(pricingGapPct) && pricingGapPct >= 0.1) {
      codes.push(ALERT_REASON_CODES.ROI_TARGET_HIT);
    }
    if (Number.isFinite(d7) && d7 > 0.05) {
      codes.push(ALERT_REASON_CODES.PX_7D_UP);
    }
    if (listingsNow >= 8) {
      codes.push(ALERT_REASON_CODES.LIQ_OK);
    }
    return dedupeReasonCodes([
      ...codes,
      ...pickScoreReasonCodes(scoreReasonCodes, "score_sell_watch", 2),
    ]).slice(0, 5);
  }

  if (alertType === "watchlist_opportunity") {
    codes.push(ALERT_REASON_CODES.WATCHLIST_ENTRY);
    if (Number.isFinite(d7) && d7 <= -0.03) {
      codes.push(ALERT_REASON_CODES.PX_7D_DOWN);
    }
    if (Number.isFinite(accelerationRaw) && accelerationRaw < 0) {
      codes.push(ALERT_REASON_CODES.MOMENTUM_SLOWING);
    }
    if (listingsNow >= 8) {
      codes.push(ALERT_REASON_CODES.LIQ_OK);
    }
    return dedupeReasonCodes([
      ...codes,
      ...pickScoreReasonCodes(scoreReasonCodes, "score_buy_watch", 2),
    ]).slice(0, 5);
  }

  return [];
}

module.exports = {
  ALERT_REASON_CODES,
  buildAlertReasonCodes,
  parseScoreReasonCodes,
};
