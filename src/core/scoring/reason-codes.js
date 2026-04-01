function roundImportance(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  return numericValue;
}

function pickTopCodes(candidates, maxCodes = 3) {
  const deduped = new Map();

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const code = candidate.code;
    const importance = roundImportance(candidate.importance);
    if (!code || importance <= 0) {
      continue;
    }

    const existingImportance = deduped.get(code);
    if (existingImportance === undefined || importance > existingImportance) {
      deduped.set(code, importance);
    }
  }

  return Array.from(deduped.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCodes)
    .map(([code]) => code);
}

function addDataQualityCandidates(candidates, metrics) {
  if (metrics.freshness_score !== null) {
    if (metrics.freshness_score >= 0.67) {
      candidates.push({ code: "DATA_FRESH", importance: metrics.freshness_score * 0.7 });
    } else if (metrics.freshness_score <= 0.34) {
      candidates.push({ code: "DATA_STALE", importance: (1 - metrics.freshness_score) * 0.9 });
    }
  }

  if (metrics.cross_confirmation !== null) {
    if (metrics.cross_confirmation >= 0.67) {
      candidates.push({ code: "CONFIRM_STRONG", importance: metrics.cross_confirmation });
    } else if (metrics.cross_confirmation <= 0.4) {
      candidates.push({
        code: "CONFIRM_WEAK",
        importance: (1 - metrics.cross_confirmation) * 1.1,
      });
    }
  }

  if (metrics.history_depth !== null && metrics.history_depth < 0.5) {
    candidates.push({ code: "MISSING_HISTORY", importance: (1 - metrics.history_depth) * 1.2 });
  }

  if (metrics.spread_quality !== null) {
    if (metrics.spread_quality >= 0.65) {
      candidates.push({ code: "SPREAD_TIGHT", importance: metrics.spread_quality * 0.8 });
    } else if (metrics.spread_quality <= 0.4) {
      candidates.push({ code: "SPREAD_WIDE", importance: (1 - metrics.spread_quality) * 0.9 });
    }
  }
}

function buildReasonCodes(metrics) {
  const tensionCandidates = [];
  if (metrics.ms_up > 0) {
    tensionCandidates.push({ code: "MOM_SHORT_UP", importance: metrics.ms_up * 1.2 });
  }
  if (metrics.ms_dn > 0) {
    tensionCandidates.push({ code: "MOM_SHORT_DOWN", importance: metrics.ms_dn * 1.2 });
  }
  if (metrics.mm_up > 0) {
    tensionCandidates.push({ code: "MOM_MID_UP", importance: metrics.mm_up });
  }
  if (metrics.mm_dn > 0) {
    tensionCandidates.push({ code: "MOM_MID_DOWN", importance: metrics.mm_dn });
  }
  if (metrics.acc_up > 0) {
    tensionCandidates.push({ code: "ACC_UP", importance: metrics.acc_up });
  }
  if (metrics.acc_dn > 0) {
    tensionCandidates.push({ code: "ACC_DOWN", importance: metrics.acc_dn });
  }
  addDataQualityCandidates(tensionCandidates, metrics);

  const hypeCandidates = [];
  if (metrics.ms_up > 0) {
    hypeCandidates.push({ code: "MOM_SHORT_UP", importance: metrics.ms_up * 1.4 });
  }
  if (metrics.acc_up > 0) {
    hypeCandidates.push({ code: "ACC_UP", importance: metrics.acc_up * 1.3 });
  }
  if (metrics.mm_up > 0) {
    hypeCandidates.push({ code: "MOM_MID_UP", importance: metrics.mm_up * 0.8 });
  }
  if (metrics.acc_dn > 0) {
    hypeCandidates.push({ code: "ACC_DOWN", importance: metrics.acc_dn });
  }
  addDataQualityCandidates(hypeCandidates, metrics);

  const repriceCandidates = [];
  if (!metrics.has_portal_ref) {
    repriceCandidates.push({ code: "MISSING_PORTAL_REF", importance: 2.0 });
  }

  if (metrics.reprice_direction === "UP") {
    repriceCandidates.push({ code: "GAP_UP_TO_MARKET", importance: metrics.gap_up * 1.4 });
    repriceCandidates.push({ code: "MOM_SHORT_UP", importance: metrics.ms_up });
    repriceCandidates.push({ code: "MOM_MID_UP", importance: metrics.mm_up });
  } else if (metrics.reprice_direction === "DOWN") {
    repriceCandidates.push({ code: "GAP_DOWN_TO_MARKET", importance: metrics.gap_dn * 1.4 });
    repriceCandidates.push({ code: "MOM_SHORT_DOWN", importance: metrics.ms_dn });
    repriceCandidates.push({ code: "MOM_MID_DOWN", importance: metrics.mm_dn });
  } else {
    if (metrics.gap_up > 0) {
      repriceCandidates.push({ code: "GAP_UP_TO_MARKET", importance: metrics.gap_up });
    }
    if (metrics.gap_dn > 0) {
      repriceCandidates.push({ code: "GAP_DOWN_TO_MARKET", importance: metrics.gap_dn });
    }
  }
  if (metrics.stock_exposure > 0.7) {
    repriceCandidates.push({
      code: "STOCK_EXPOSED_HIGH",
      importance: metrics.stock_exposure * 0.8,
    });
  }
  addDataQualityCandidates(repriceCandidates, metrics);

  const sellWatchCandidates = [];
  if (metrics.stock_exposure > 0.25) {
    sellWatchCandidates.push({
      code: "STOCK_EXPOSED_HIGH",
      importance: metrics.stock_exposure * 1.5,
    });
  }
  if (metrics.gap_up > 0) {
    sellWatchCandidates.push({ code: "GAP_UP_TO_MARKET", importance: metrics.gap_up });
  }
  if (metrics.ms_up > 0) {
    sellWatchCandidates.push({ code: "MOM_SHORT_UP", importance: metrics.ms_up });
  }
  if (metrics.mm_up > 0) {
    sellWatchCandidates.push({ code: "MOM_MID_UP", importance: metrics.mm_up * 0.9 });
  }
  addDataQualityCandidates(sellWatchCandidates, metrics);

  const buyWatchCandidates = [];
  if (metrics.ms_up > 0) {
    buyWatchCandidates.push({ code: "MOM_SHORT_UP", importance: metrics.ms_up * 1.2 });
  }
  if (metrics.acc_up > 0) {
    buyWatchCandidates.push({ code: "ACC_UP", importance: metrics.acc_up * 1.2 });
  }
  if (metrics.mm_up > 0) {
    buyWatchCandidates.push({ code: "MOM_MID_UP", importance: metrics.mm_up * 0.8 });
  }
  if (metrics.overextended > 0) {
    buyWatchCandidates.push({
      code: "OVEREXTENDED_30D",
      importance: metrics.overextended * 1.6,
    });
  }
  if (metrics.stock_exposure > 0.7) {
    buyWatchCandidates.push({
      code: "STOCK_EXPOSED_HIGH",
      importance: metrics.stock_exposure * 0.8,
    });
  }
  addDataQualityCandidates(buyWatchCandidates, metrics);

  return {
    score_tension: pickTopCodes(tensionCandidates),
    score_hype: pickTopCodes(hypeCandidates),
    score_reprice: pickTopCodes(repriceCandidates),
    score_sell_watch: pickTopCodes(sellWatchCandidates),
    score_buy_watch: pickTopCodes(buyWatchCandidates),
  };
}

module.exports = {
  buildReasonCodes,
};
