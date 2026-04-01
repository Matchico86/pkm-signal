const DEFAULT_MARKET_SOURCE = "pokemon_tcg_api";
const DEFAULT_STALE_AFTER_DAYS = 7;

const TCGPLAYER_VARIANT_PRIORITY = [
  "normal",
  "holofoil",
  "1stEditionNormal",
  "1stEditionHolofoil",
  "unlimited",
  "unlimitedHolofoil",
  "reverseHolofoil",
];

function normalizeString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function parsePositiveNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

function parseNonNegativeInteger(value, fieldName, defaultValue) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`Invalid non-negative integer for ${fieldName}: ${value}`);
  }

  return parsedValue;
}

function toCents(value, conversionRate = 1) {
  const amount = parsePositiveNumber(value);
  const rate = parsePositiveNumber(conversionRate);
  if (amount === null || rate === null) {
    return null;
  }

  const cents = Math.round(amount * rate * 100);
  return cents > 0 ? cents : null;
}

function pickTcgplayerPriceBlock(card) {
  const priceBlocks = card?.tcgplayer?.prices;
  if (!priceBlocks || typeof priceBlocks !== "object" || Array.isArray(priceBlocks)) {
    return {
      variant: null,
      prices: null,
    };
  }

  for (const variant of TCGPLAYER_VARIANT_PRIORITY) {
    if (
      Object.prototype.hasOwnProperty.call(priceBlocks, variant) &&
      priceBlocks[variant] &&
      typeof priceBlocks[variant] === "object" &&
      !Array.isArray(priceBlocks[variant])
    ) {
      return {
        variant,
        prices: priceBlocks[variant],
      };
    }
  }

  const fallbackEntry = Object.entries(priceBlocks).find(
    ([, value]) => value && typeof value === "object" && !Array.isArray(value)
  );

  if (!fallbackEntry) {
    return {
      variant: null,
      prices: null,
    };
  }

  return {
    variant: fallbackEntry[0],
    prices: fallbackEntry[1],
  };
}

function extractCardmarketMetrics(card) {
  const prices = card?.cardmarket?.prices || {};
  return {
    updatedAt: normalizeString(card?.cardmarket?.updatedAt),
    averageSellPrice: parsePositiveNumber(prices.averageSellPrice),
    lowPrice: parsePositiveNumber(prices.lowPrice),
    trendPrice: parsePositiveNumber(prices.trendPrice),
    avg1: parsePositiveNumber(prices.avg1),
    avg7: parsePositiveNumber(prices.avg7),
    avg30: parsePositiveNumber(prices.avg30),
    reverseHoloSell: parsePositiveNumber(prices.reverseHoloSell),
    reverseHoloLow: parsePositiveNumber(prices.reverseHoloLow),
    reverseHoloTrend: parsePositiveNumber(prices.reverseHoloTrend),
    reverseHoloAvg1: parsePositiveNumber(prices.reverseHoloAvg1),
    reverseHoloAvg7: parsePositiveNumber(prices.reverseHoloAvg7),
    reverseHoloAvg30: parsePositiveNumber(prices.reverseHoloAvg30),
  };
}

function extractTcgplayerMetrics(card) {
  const selectedBlock = pickTcgplayerPriceBlock(card);
  const prices = selectedBlock.prices || {};

  return {
    updatedAt: normalizeString(card?.tcgplayer?.updatedAt),
    variant: selectedBlock.variant,
    market: parsePositiveNumber(prices.market),
    mid: parsePositiveNumber(prices.mid),
    low: parsePositiveNumber(prices.low),
    high: parsePositiveNumber(prices.high),
    directLow: parsePositiveNumber(prices.directLow),
  };
}

function resolveReferencePrice(cardmarket, tcgplayer, usdToEurRate) {
  const candidates = [
    {
      path: "cardmarket.trendPrice",
      provider: "cardmarket",
      amount: cardmarket.trendPrice,
      toCents: () => toCents(cardmarket.trendPrice, 1),
    },
    {
      path: "cardmarket.averageSellPrice",
      provider: "cardmarket",
      amount: cardmarket.averageSellPrice,
      toCents: () => toCents(cardmarket.averageSellPrice, 1),
    },
    {
      path: "cardmarket.lowPrice",
      provider: "cardmarket",
      amount: cardmarket.lowPrice,
      toCents: () => toCents(cardmarket.lowPrice, 1),
    },
    {
      path: "tcgplayer.market",
      provider: "tcgplayer",
      amount: tcgplayer.market,
      toCents: () => toCents(tcgplayer.market, usdToEurRate),
    },
    {
      path: "tcgplayer.mid",
      provider: "tcgplayer",
      amount: tcgplayer.mid,
      toCents: () => toCents(tcgplayer.mid, usdToEurRate),
    },
    {
      path: "tcgplayer.low",
      provider: "tcgplayer",
      amount: tcgplayer.low,
      toCents: () => toCents(tcgplayer.low, usdToEurRate),
    },
  ];

  let skippedUsdCandidates = 0;

  for (const candidate of candidates) {
    if (candidate.amount === null) {
      continue;
    }

    const cents = candidate.toCents();
    if (cents === null) {
      if (candidate.provider === "tcgplayer") {
        skippedUsdCandidates += 1;
      }
      continue;
    }

    return {
      provider: candidate.provider,
      path: candidate.path,
      cents,
      skippedUsdCandidates,
    };
  }

  return {
    provider: null,
    path: null,
    cents: null,
    skippedUsdCandidates,
  };
}

function isStaleSource(updatedAt, marketDate, staleAfterDays) {
  const normalizedUpdatedAt = normalizeString(updatedAt);
  if (!normalizedUpdatedAt) {
    return false;
  }

  const updatedAtMs = Date.parse(normalizedUpdatedAt);
  const marketDateMs = Date.parse(`${marketDate}T00:00:00.000Z`);
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(marketDateMs)) {
    return false;
  }

  const ageMs = marketDateMs - updatedAtMs;
  return ageMs > staleAfterDays * 24 * 60 * 60 * 1000;
}

function normalizePokemonTcgMarketCard(card, options = {}) {
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    throw new Error("normalizePokemonTcgMarketCard expected a card object.");
  }

  const marketDate = normalizeString(options.marketDate);
  if (!marketDate) {
    throw new Error("normalizePokemonTcgMarketCard missing required option: marketDate.");
  }

  const usdToEurRate = parsePositiveNumber(
    options.usdToEurRate ?? process.env.PKM_USD_TO_EUR_RATE
  );
  const staleAfterDays = parseNonNegativeInteger(
    options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS,
    "staleAfterDays",
    DEFAULT_STALE_AFTER_DAYS
  );

  const cardmarket = extractCardmarketMetrics(card);
  const tcgplayer = extractTcgplayerMetrics(card);
  const referencePrice = resolveReferencePrice(cardmarket, tcgplayer, usdToEurRate);

  const provider = referencePrice.provider;
  const sourceUpdatedAt =
    provider === "cardmarket"
      ? cardmarket.updatedAt
      : provider === "tcgplayer"
      ? tcgplayer.updatedAt
      : null;

  let priceLowCents = null;
  let priceHighCents = null;
  if (provider === "cardmarket") {
    priceLowCents = toCents(cardmarket.lowPrice, 1);
  }

  if (provider === "tcgplayer") {
    priceLowCents = toCents(tcgplayer.low, usdToEurRate);
    priceHighCents = toCents(tcgplayer.high, usdToEurRate);
  }

  let status = "missing";
  const reasons = [];
  if (referencePrice.cents !== null) {
    status = "ok";

    if (referencePrice.path !== "cardmarket.trendPrice") {
      status = "partial";
      reasons.push(`fallback:${referencePrice.path}`);
    }

    if (provider === "tcgplayer") {
      status = "partial";
      reasons.push("provider:tcgplayer_fallback");
    }

    if (priceLowCents === null) {
      status = "partial";
      reasons.push("low_price_missing");
    }
  }

  if (referencePrice.cents === null) {
    reasons.push("reference_price_missing");
    if (
      referencePrice.skippedUsdCandidates > 0 &&
      parsePositiveNumber(usdToEurRate) === null
    ) {
      reasons.push("usd_to_eur_rate_missing");
    }
  }

  const stale = referencePrice.cents !== null && isStaleSource(sourceUpdatedAt, marketDate, staleAfterDays);
  if (stale) {
    status = "stale";
    reasons.push("source_data_stale");
  }

  return {
    externalCardId: normalizeString(card.id),
    cardName: normalizeString(card.name),
    cardNumber: normalizeString(card.number),
    rarity: normalizeString(card.rarity),
    setId: normalizeString(card?.set?.id),
    setName: normalizeString(card?.set?.name),
    series: normalizeString(card?.set?.series),
    releaseDate: normalizeString(card?.set?.releaseDate),
    sourceUpdatedAt,
    provider,
    tcgplayerVariant: tcgplayer.variant,
    referencePricePath: referencePrice.path,
    fallbackUsed: referencePrice.path !== null && referencePrice.path !== "cardmarket.trendPrice",
    status,
    reasons,
    metrics: {
      cardmarket,
      tcgplayer,
    },
    dbRow: {
      source: DEFAULT_MARKET_SOURCE,
      priceLowCents,
      priceMidCents: referencePrice.cents,
      priceHighCents,
      listingsCount: null,
      salesCount: null,
    },
  };
}

module.exports = {
  DEFAULT_MARKET_SOURCE,
  DEFAULT_STALE_AFTER_DAYS,
  normalizePokemonTcgMarketCard,
};
