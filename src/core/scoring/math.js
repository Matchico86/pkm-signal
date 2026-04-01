function clamp01(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

function pos(value, cap) {
  if (!Number.isFinite(value) || !Number.isFinite(cap) || cap <= 0) {
    return null;
  }

  return clamp01(Math.max(value, 0) / cap);
}

function neg(value, cap) {
  if (!Number.isFinite(value) || !Number.isFinite(cap) || cap <= 0) {
    return null;
  }

  return clamp01(Math.max(-value, 0) / cap);
}

function weightedMean(valuesWithWeights) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const item of valuesWithWeights) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const value = Number(item.value);
    const weight = Number(item.weight);
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) {
      continue;
    }

    weightedSum += value * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    return null;
  }

  return weightedSum / totalWeight;
}

function sign(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value > 0) {
    return 1;
  }

  if (value < 0) {
    return -1;
  }

  return 0;
}

function safeRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

module.exports = {
  clamp01,
  neg,
  pos,
  safeRatio,
  sign,
  weightedMean,
};
