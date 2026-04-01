const { openDatabase } = require("../db/client");
const { all } = require("../db/queries");
const {
  fetchMarketCardForAsset,
  resolvePokemonTcgConfig,
} = require("../connectors/market/pokemontcg-source");
const {
  DEFAULT_MARKET_SOURCE,
  normalizePokemonTcgMarketCard,
} = require("../connectors/market/normalize-market");

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_SCOPE = "all";
const HOT_SCOPE = "hot";
const HOT_PRIORITY_MAX = 2;

function normalizeString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function parsePositiveNumber(value, fieldName, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) {
      throw new Error(`Missing required field: ${fieldName}`);
    }

    return null;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`Invalid positive number for ${fieldName}: ${value}`);
  }

  return parsedValue;
}

function resolveMarketDate(value) {
  const explicitMarketDate = normalizeString(value);
  const marketDate = explicitMarketDate || new Date().toISOString().slice(0, 10);
  if (!ISO_DATE_PATTERN.test(marketDate)) {
    throw new Error(`Invalid market date (expected YYYY-MM-DD): ${marketDate}`);
  }

  return marketDate;
}

function resolveScope(value) {
  const normalizedScope = normalizeString(value) || DEFAULT_SCOPE;
  if (normalizedScope !== DEFAULT_SCOPE && normalizedScope !== HOT_SCOPE) {
    throw new Error(`Invalid scope: ${normalizedScope}. Expected all|hot.`);
  }

  return normalizedScope;
}

function loadTargets(db, options) {
  let sql = `
    SELECT
      t.id AS target_id,
      t.asset_id,
      t.source AS target_source,
      t.priority,
      a.card_ref,
      a.name,
      a.set_code,
      a.card_number,
      a.rarity
    FROM targets t
    JOIN assets a ON a.id = t.asset_id
    WHERE t.is_active = 1
  `;
  const params = [];

  if (options.targetSource) {
    sql += " AND t.source = ?";
    params.push(options.targetSource);
  }

  if (options.scope === HOT_SCOPE) {
    sql += " AND t.priority <= ?";
    params.push(HOT_PRIORITY_MAX);
  }

  sql += " ORDER BY t.priority ASC, t.id ASC";

  return all(db, sql, params);
}

function createUpsertStatement(db) {
  return db.prepare(`
    INSERT INTO market_history_daily (
      asset_id,
      market_date,
      source,
      price_low_cents,
      price_mid_cents,
      price_high_cents,
      listings_count,
      sales_count
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, market_date, source) DO UPDATE SET
      price_low_cents = excluded.price_low_cents,
      price_mid_cents = excluded.price_mid_cents,
      price_high_cents = excluded.price_high_cents,
      listings_count = excluded.listings_count,
      sales_count = excluded.sales_count;
  `);
}

function formatReasons(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    return "none";
  }

  return reasons.join(",");
}

async function runMarketSnapshot(options = {}) {
  const marketDate = resolveMarketDate(options.marketDate);
  const targetSource = normalizeString(options.targetSource);
  const scope = resolveScope(options.scope);
  const usdToEurRate = parsePositiveNumber(
    options.usdEurRate ?? process.env.PKM_USD_TO_EUR_RATE,
    "usdToEurRate",
    { required: false }
  );

  const apiConfig = resolvePokemonTcgConfig(options);
  const { db, dbPath } = openDatabase({ dbPath: options.dbPath });

  try {
    const targets = loadTargets(db, {
      targetSource,
      scope,
    });

    const upsertMarketDaily = createUpsertStatement(db);
    const summary = {
      targetsRead: targets.length,
      found: 0,
      notFound: 0,
      insertedOrUpdated: 0,
      missingPrice: 0,
      fallbackUsed: 0,
      stale: 0,
      sourceErrors: 0,
    };

    for (const target of targets) {
      const targetLabel = `target_id=${target.target_id} card_ref=${target.card_ref}`;

      try {
        const sourceResult = await fetchMarketCardForAsset(
          {
            cardRef: target.card_ref,
            setCode: target.set_code,
            cardNumber: target.card_number,
          },
          {
            config: apiConfig,
          }
        );

        if (!sourceResult.card) {
          summary.notFound += 1;
          console.log(
            `[not_found] ${targetLabel} lookup=${sourceResult.lookup.method} value=${sourceResult.lookup.value}`
          );
          continue;
        }

        summary.found += 1;

        const normalized = normalizePokemonTcgMarketCard(sourceResult.card, {
          marketDate,
          usdToEurRate,
        });

        if (normalized.dbRow.priceMidCents === null) {
          summary.missingPrice += 1;
          console.log(
            `[missing_price] ${targetLabel} status=${normalized.status} reasons=${formatReasons(
              normalized.reasons
            )}`
          );
          continue;
        }

        upsertMarketDaily.run(
          target.asset_id,
          marketDate,
          DEFAULT_MARKET_SOURCE,
          normalized.dbRow.priceLowCents,
          normalized.dbRow.priceMidCents,
          normalized.dbRow.priceHighCents,
          normalized.dbRow.listingsCount,
          normalized.dbRow.salesCount
        );

        summary.insertedOrUpdated += 1;

        if (normalized.fallbackUsed) {
          summary.fallbackUsed += 1;
          console.log(
            `[fallback_used] ${targetLabel} provider=${normalized.provider} path=${normalized.referencePricePath}`
          );
        }

        if (normalized.status === "stale") {
          summary.stale += 1;
          console.log(
            `[stale] ${targetLabel} provider=${normalized.provider} source_updated_at=${normalized.sourceUpdatedAt}`
          );
        }

        console.log(
          `[found] ${targetLabel} provider=${normalized.provider || "unknown"} ` +
            `price_mid_cents=${normalized.dbRow.priceMidCents} status=${normalized.status}`
        );
      } catch (error) {
        summary.sourceErrors += 1;
        console.log(`[source_error] ${targetLabel} message=${error.message}`);
      }
    }

    return {
      dbPath,
      marketDate,
      scope,
      targetSource,
      usdToEurRate,
      summary,
    };
  } finally {
    db.close();
  }
}

function parseCliArgs(argv) {
  const options = {};

  for (const arg of argv) {
    if (arg.startsWith("--market-date=")) {
      options.marketDate = arg.slice("--market-date=".length);
      continue;
    }

    if (arg.startsWith("--target-source=")) {
      options.targetSource = arg.slice("--target-source=".length);
      continue;
    }

    if (arg.startsWith("--scope=")) {
      options.scope = arg.slice("--scope=".length);
      continue;
    }

    if (arg.startsWith("--usd-eur-rate=")) {
      options.usdEurRate = arg.slice("--usd-eur-rate=".length);
      continue;
    }

    if (arg.startsWith("--db=")) {
      options.dbPath = arg.slice("--db=".length);
      continue;
    }

    if (arg.startsWith("--fetch-timeout-ms=")) {
      options.timeoutMs = arg.slice("--fetch-timeout-ms=".length);
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    throw new Error(`Unexpected positional argument: ${arg}`);
  }

  return options;
}

if (require.main === module) {
  (async () => {
    try {
      const options = parseCliArgs(process.argv.slice(2));
      const result = await runMarketSnapshot(options);

      console.log("Market snapshot completed:");
      console.log(`- market_date: ${result.marketDate}`);
      console.log(`- scope: ${result.scope}`);
      if (result.targetSource) {
        console.log(`- target_source: ${result.targetSource}`);
      }
      if (result.usdToEurRate) {
        console.log(`- usd_to_eur_rate: ${result.usdToEurRate}`);
      }
      console.log(`- targets_read: ${result.summary.targetsRead}`);
      console.log(`- found: ${result.summary.found}`);
      console.log(`- not_found: ${result.summary.notFound}`);
      console.log(`- inserted_or_updated: ${result.summary.insertedOrUpdated}`);
      console.log(`- missing_price: ${result.summary.missingPrice}`);
      console.log(`- fallback_used: ${result.summary.fallbackUsed}`);
      console.log(`- stale: ${result.summary.stale}`);
      console.log(`- source_errors: ${result.summary.sourceErrors}`);
      console.log(`- db: ${result.dbPath}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  parseCliArgs,
  runMarketSnapshot,
};
