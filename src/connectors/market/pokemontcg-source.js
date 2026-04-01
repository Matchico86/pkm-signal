const DEFAULT_POKEMONTCG_API_BASE_URL = "https://api.pokemontcg.io/v2/";
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;

const CARD_SELECT_FIELDS = [
  "id",
  "name",
  "number",
  "rarity",
  "set.id",
  "set.name",
  "set.series",
  "set.releaseDate",
  "cardmarket.updatedAt",
  "cardmarket.prices",
  "tcgplayer.updatedAt",
  "tcgplayer.prices",
].join(",");

function normalizeString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function parsePositiveInteger(value, fieldName, defaultValue) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`Invalid positive integer for ${fieldName}: ${value}`);
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

function escapeQueryValue(value) {
  const normalizedValue = normalizeString(value);
  if (!normalizedValue) {
    return null;
  }

  if (/^[a-zA-Z0-9._-]+$/.test(normalizedValue)) {
    return normalizedValue;
  }

  return `"${normalizedValue.replace(/"/g, '\\"')}"`;
}

function resolvePokemonTcgConfig(options = {}) {
  const baseUrl =
    normalizeString(options.baseUrl || process.env.PKM_POKEMONTCG_API_BASE_URL) ||
    DEFAULT_POKEMONTCG_API_BASE_URL;

  const apiKey = normalizeString(options.apiKey || process.env.PKM_POKEMONTCG_API_KEY);
  const timeoutMs = parsePositiveInteger(
    options.timeoutMs ?? process.env.PKM_POKEMONTCG_TIMEOUT_MS,
    "timeoutMs",
    DEFAULT_FETCH_TIMEOUT_MS
  );
  const maxRetries = parseNonNegativeInteger(
    options.maxRetries ?? process.env.PKM_POKEMONTCG_MAX_RETRIES,
    "maxRetries",
    DEFAULT_MAX_RETRIES
  );

  return {
    baseUrl,
    apiKey,
    timeoutMs,
    maxRetries,
  };
}

function buildRequestHeaders(config) {
  const headers = {
    Accept: "application/json",
  };

  if (config.apiKey) {
    headers["X-Api-Key"] = config.apiKey;
  }

  return headers;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRetryDelayMs(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(Math.round(retryAfterSeconds * 1000), 5_000);
  }

  return Math.min(400 * Math.max(attempt, 1), 3_000);
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

async function requestPokemonTcgJson(pathnameWithQuery, options = {}) {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available in this Node runtime.");
  }

  const config = options.config || resolvePokemonTcgConfig(options);
  const headers = buildRequestHeaders(config);
  const url = new URL(pathnameWithQuery, config.baseUrl);
  const totalAttempts = config.maxRetries + 1;
  let lastError = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (response.status === 404) {
        return {
          found: false,
          status: 404,
          payload: null,
        };
      }

      if (!response.ok) {
        const responseText = await response.text();
        if (isRetryableStatus(response.status) && attempt < totalAttempts) {
          const retryDelayMs = resolveRetryDelayMs(response, attempt);
          await delay(retryDelayMs);
          continue;
        }

        throw new Error(
          `Pokemon TCG API request failed (${response.status} ${response.statusText}) ` +
            `for ${url.toString()}: ${responseText.slice(0, 300)}`
        );
      }

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new Error(
          `Pokemon TCG API response is not valid JSON for ${url.toString()}: ${error.message}`
        );
      }

      return {
        found: true,
        status: response.status,
        payload,
      };
    } catch (error) {
      if (error.name === "AbortError") {
        lastError = new Error(
          `Pokemon TCG API request timed out after ${config.timeoutMs}ms for ${url.toString()}`
        );
      } else {
        lastError = error;
      }

      if (attempt >= totalAttempts) {
        throw lastError;
      }

      await delay(400 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("Unknown Pokemon TCG API error.");
}

function parseCardFromPayload(payload, requestLabel) {
  if (!payload || typeof payload !== "object") {
    throw new Error(`Invalid Pokemon TCG API payload for ${requestLabel}: expected object.`);
  }

  if (!Object.prototype.hasOwnProperty.call(payload, "data")) {
    throw new Error(`Invalid Pokemon TCG API payload for ${requestLabel}: missing data field.`);
  }

  return payload.data;
}

async function fetchCardById(externalCardId, options = {}) {
  const normalizedCardId = normalizeString(externalCardId);
  if (!normalizedCardId) {
    return null;
  }

  const query = new URLSearchParams({
    select: CARD_SELECT_FIELDS,
  });

  const response = await requestPokemonTcgJson(
    `cards/${encodeURIComponent(normalizedCardId)}?${query.toString()}`,
    options
  );

  if (!response.found) {
    return null;
  }

  const card = parseCardFromPayload(response.payload, `cards/${normalizedCardId}`);
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    throw new Error(
      `Invalid Pokemon TCG API payload for cards/${normalizedCardId}: expected card object.`
    );
  }

  return card;
}

async function searchCardBySetAndNumber(setCode, cardNumber, options = {}) {
  const normalizedSetCode = normalizeString(setCode);
  const normalizedCardNumber = normalizeString(cardNumber);
  if (!normalizedSetCode || !normalizedCardNumber) {
    return null;
  }

  const escapedSetCode = escapeQueryValue(normalizedSetCode);
  const escapedCardNumber = escapeQueryValue(normalizedCardNumber);
  if (!escapedSetCode || !escapedCardNumber) {
    return null;
  }

  const query = new URLSearchParams({
    q: `set.id:${escapedSetCode} number:${escapedCardNumber}`,
    pageSize: "1",
    select: CARD_SELECT_FIELDS,
  });

  const response = await requestPokemonTcgJson(`cards?${query.toString()}`, options);
  if (!response.found) {
    return null;
  }

  const cards = parseCardFromPayload(
    response.payload,
    `cards?q=set.id:${normalizedSetCode} number:${normalizedCardNumber}`
  );

  if (!Array.isArray(cards)) {
    throw new Error(
      "Invalid Pokemon TCG API payload for cards search: expected data array."
    );
  }

  return cards[0] || null;
}

async function fetchMarketCardForAsset(asset, options = {}) {
  if (!asset || typeof asset !== "object") {
    throw new Error("fetchMarketCardForAsset expected an asset object.");
  }

  const cardRef = normalizeString(asset.cardRef ?? asset.card_ref);
  const setCode = normalizeString(asset.setCode ?? asset.set_code);
  const cardNumber = normalizeString(asset.cardNumber ?? asset.card_number);

  if (cardRef) {
    const cardById = await fetchCardById(cardRef, options);
    if (cardById) {
      return {
        card: cardById,
        lookup: {
          method: "external_id",
          value: cardRef,
        },
      };
    }
  }

  if (setCode && cardNumber) {
    const cardBySetAndNumber = await searchCardBySetAndNumber(setCode, cardNumber, options);
    if (cardBySetAndNumber) {
      return {
        card: cardBySetAndNumber,
        lookup: {
          method: "set_and_number",
          value: `${setCode}:${cardNumber}`,
        },
      };
    }
  }

  return {
    card: null,
    lookup: {
      method: cardRef ? "external_id_then_set_and_number" : "set_and_number",
      value: cardRef || `${setCode || "unknown"}:${cardNumber || "unknown"}`,
    },
  };
}

module.exports = {
  CARD_SELECT_FIELDS,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_POKEMONTCG_API_BASE_URL,
  fetchCardById,
  fetchMarketCardForAsset,
  resolvePokemonTcgConfig,
  searchCardBySetAndNumber,
};
