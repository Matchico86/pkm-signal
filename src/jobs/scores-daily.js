const { openDatabase } = require("../db/client");
const { all, get } = require("../db/queries");
const {
  computeScoringSnapshot,
  LOOKBACK_DAYS,
  resolveScoringConfig,
} = require("../core/scoring/engine");

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_SCOPE = "all";
const HOT_SCOPE = "hot";
const HOT_PRIORITY_MAX = 2;
const PREFERRED_MARKET_SOURCE = "pokemon_tcg_api";

function normalizeString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function normalizeIsoDate(value, fieldName) {
  const normalizedValue = normalizeString(value);
  if (!normalizedValue) {
    throw new Error(`Missing required field: ${fieldName}`);
  }

  if (!ISO_DATE_PATTERN.test(normalizedValue)) {
    throw new Error(`Invalid date format for ${fieldName} (expected YYYY-MM-DD): ${normalizedValue}`);
  }

  return normalizedValue;
}

function resolveScope(value) {
  const normalizedScope = normalizeString(value) || DEFAULT_SCOPE;
  if (normalizedScope !== DEFAULT_SCOPE && normalizedScope !== HOT_SCOPE) {
    throw new Error(`Invalid scope: ${normalizedScope}. Expected all|hot.`);
  }

  return normalizedScope;
}

function shiftIsoDate(isoDate, deltaDays) {
  const parsedDate = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate)) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }

  return new Date(parsedDate + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

function centsToPrice(valueInCents) {
  const numericValue = Number(valueInCents);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return numericValue / 100;
}

function resolveRowPriceRef(row) {
  const midPrice = centsToPrice(row.price_mid_cents);
  if (midPrice !== null) {
    return midPrice;
  }

  const lowPrice = centsToPrice(row.price_low_cents);
  const highPrice = centsToPrice(row.price_high_cents);
  if (lowPrice !== null && highPrice !== null) {
    return (lowPrice + highPrice) / 2;
  }

  return lowPrice !== null ? lowPrice : highPrice;
}

function choosePrimaryRow(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const preferredWithRef = rows.find(
    (row) => row.source === PREFERRED_MARKET_SOURCE && resolveRowPriceRef(row) !== null
  );
  if (preferredWithRef) {
    return preferredWithRef;
  }

  const withRef = rows.find((row) => resolveRowPriceRef(row) !== null);
  if (withRef) {
    return withRef;
  }

  return rows[0];
}

function resolveLowHighFromRows(primaryRow, rows) {
  const primaryLow = centsToPrice(primaryRow?.price_low_cents);
  const primaryHigh = centsToPrice(primaryRow?.price_high_cents);
  if (primaryLow !== null || primaryHigh !== null) {
    return {
      low: primaryLow,
      high: primaryHigh,
    };
  }

  const lows = rows.map((row) => centsToPrice(row.price_low_cents)).filter((value) => value !== null);
  const highs = rows.map((row) => centsToPrice(row.price_high_cents)).filter((value) => value !== null);

  return {
    low: lows.length > 0 ? Math.min(...lows) : null,
    high: highs.length > 0 ? Math.max(...highs) : null,
  };
}

function buildMarketPoints(rows) {
  const rowsByDate = new Map();
  for (const row of rows) {
    if (!rowsByDate.has(row.market_date)) {
      rowsByDate.set(row.market_date, []);
    }
    rowsByDate.get(row.market_date).push(row);
  }

  const points = [];
  for (const [marketDate, dateRows] of rowsByDate.entries()) {
    const refs = dateRows.map(resolveRowPriceRef).filter((value) => value !== null);
    const primaryRow = choosePrimaryRow(dateRows);
    const lowHigh = resolveLowHighFromRows(primaryRow, dateRows);

    points.push({
      marketDate,
      priceRef: primaryRow ? resolveRowPriceRef(primaryRow) : null,
      refs,
      lowPrice: lowHigh.low,
      highPrice: lowHigh.high,
      listingsCount:
        primaryRow && Number.isFinite(Number(primaryRow.listings_count))
          ? Number(primaryRow.listings_count)
          : null,
    });
  }

  return points.sort((a, b) => b.marketDate.localeCompare(a.marketDate));
}

function pickLookbackPoint(points, thresholdDate) {
  return (
    points.find(
      (point) => point.marketDate <= thresholdDate && Number.isFinite(point.priceRef) && point.priceRef > 0
    ) || null
  );
}

function buildMarketSnapshot(points, scoreDate) {
  const p0Point = points.find((point) => point.marketDate === scoreDate) || null;
  if (!p0Point || !Number.isFinite(p0Point.priceRef) || p0Point.priceRef <= 0) {
    return null;
  }

  const latestPoint =
    points.find((point) => Number.isFinite(point.priceRef) && point.priceRef > 0) || null;

  const lookbackPoints = {};
  for (const lookbackDay of LOOKBACK_DAYS) {
    const thresholdDate = shiftIsoDate(scoreDate, -lookbackDay);
    lookbackPoints[lookbackDay] = pickLookbackPoint(points, thresholdDate);
  }

  return {
    p0: p0Point.priceRef,
    p0Low: p0Point.lowPrice,
    p0High: p0Point.highPrice,
    p0ListingsCount: p0Point.listingsCount,
    p3: lookbackPoints[3]?.priceRef ?? null,
    p7: lookbackPoints[7]?.priceRef ?? null,
    p14: lookbackPoints[14]?.priceRef ?? null,
    p30: lookbackPoints[30]?.priceRef ?? null,
    p3ListingsCount: lookbackPoints[3]?.listingsCount ?? null,
    sameDayRefs: p0Point.refs,
    latestMarketDate: latestPoint ? latestPoint.marketDate : scoreDate,
  };
}

function loadTargets(db, options) {
  let sql = `
    SELECT
      t.id AS target_id,
      t.asset_id,
      t.source AS target_source,
      t.priority,
      a.card_ref,
      a.name
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

function resolveScoreDate(db, explicitScoreDate) {
  if (explicitScoreDate) {
    return normalizeIsoDate(explicitScoreDate, "score_date");
  }

  const row = get(db, "SELECT MAX(market_date) AS latest_market_date FROM market_history_daily;");
  if (!row || !row.latest_market_date) {
    throw new Error("No market data found in market_history_daily. Provide --score-date after ingestion.");
  }

  return normalizeIsoDate(row.latest_market_date, "score_date");
}

function createStatements(db) {
  return {
    getMarketRows: db.prepare(`
      SELECT
        market_date,
        source,
        price_low_cents,
        price_mid_cents,
        price_high_cents,
        listings_count,
        sales_count
      FROM market_history_daily
      WHERE asset_id = ? AND market_date <= ?
      ORDER BY market_date DESC, source ASC;
    `),
    getLatestPortalStock: db.prepare(`
      SELECT
        snapshot_at,
        quantity
      FROM portal_stock_snapshot
      WHERE asset_id = ? AND snapshot_at <= ?
      ORDER BY snapshot_at DESC
      LIMIT 1;
    `),
    upsertScore: db.prepare(`
      INSERT INTO scores_daily (
        asset_id,
        target_id,
        score_date,
        score_value,
        price_ref,
        portal_ref,
        d3,
        d7,
        d14,
        d30,
        momentum_short_raw,
        momentum_mid_raw,
        acceleration_raw,
        spread_raw,
        spread_quality,
        freshness_score,
        history_depth,
        cross_confirmation,
        stock_exposure,
        pricing_gap_pct,
        confidence_score,
        score_tension,
        score_hype,
        score_reprice,
        reprice_direction,
        score_sell_watch,
        score_buy_watch,
        reason_codes_json,
        score_version,
        score_label,
        note
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id, score_date) DO UPDATE SET
        target_id = excluded.target_id,
        score_value = excluded.score_value,
        price_ref = excluded.price_ref,
        portal_ref = excluded.portal_ref,
        d3 = excluded.d3,
        d7 = excluded.d7,
        d14 = excluded.d14,
        d30 = excluded.d30,
        momentum_short_raw = excluded.momentum_short_raw,
        momentum_mid_raw = excluded.momentum_mid_raw,
        acceleration_raw = excluded.acceleration_raw,
        spread_raw = excluded.spread_raw,
        spread_quality = excluded.spread_quality,
        freshness_score = excluded.freshness_score,
        history_depth = excluded.history_depth,
        cross_confirmation = excluded.cross_confirmation,
        stock_exposure = excluded.stock_exposure,
        pricing_gap_pct = excluded.pricing_gap_pct,
        confidence_score = excluded.confidence_score,
        score_tension = excluded.score_tension,
        score_hype = excluded.score_hype,
        score_reprice = excluded.score_reprice,
        reprice_direction = excluded.reprice_direction,
        score_sell_watch = excluded.score_sell_watch,
        score_buy_watch = excluded.score_buy_watch,
        reason_codes_json = excluded.reason_codes_json,
        score_version = excluded.score_version,
        score_label = excluded.score_label,
        note = excluded.note;
    `),
  };
}

async function runScoresDaily(options = {}) {
  const scope = resolveScope(options.scope);
  const targetSource = normalizeString(options.targetSource);
  const { db, dbPath } = openDatabase({ dbPath: options.dbPath });

  try {
    const scoringConfig = resolveScoringConfig(options);
    const scoreDate = resolveScoreDate(db, options.scoreDate);
    const targets = loadTargets(db, {
      scope,
      targetSource,
    });
    const statements = createStatements(db);

    const summary = {
      targetsRead: targets.length,
      scored: 0,
      incomplete: 0,
      withoutHistory: 0,
      withoutStock: 0,
      withoutPortalRef: 0,
      withoutMarketToday: 0,
      sourceErrors: 0,
    };

    for (const target of targets) {
      const targetLabel = `target_id=${target.target_id} card_ref=${target.card_ref}`;

      try {
        const marketRows = statements.getMarketRows.all(target.asset_id, scoreDate);
        const marketPoints = buildMarketPoints(marketRows);
        const marketSnapshot = buildMarketSnapshot(marketPoints, scoreDate);

        if (!marketSnapshot) {
          summary.incomplete += 1;
          summary.withoutMarketToday += 1;
          console.log(`[incomplete] ${targetLabel} reason=no_market_snapshot_for_score_date`);
          continue;
        }

        const stockRow = statements.getLatestPortalStock.get(target.asset_id, scoreDate);
        const stockQty =
          stockRow && Number.isFinite(Number(stockRow.quantity)) ? Number(stockRow.quantity) : 0;
        // V1 guardrail: repricing requires a true internal Portal price reference (cote/prix interne),
        // not inventory cost. Current imported payloads do not provide that reference.
        const portalRef = null;

        if (stockQty <= 0) {
          summary.withoutStock += 1;
        }

        if (portalRef === null) {
          summary.withoutPortalRef += 1;
        }

        const scoreRow = computeScoringSnapshot(
          {
            scoreDate,
            ...marketSnapshot,
            stockQty,
            portalRef,
          },
          scoringConfig
        );

        if (!scoreRow) {
          summary.incomplete += 1;
          console.log(`[incomplete] ${targetLabel} reason=invalid_market_snapshot`);
          continue;
        }

        if ((scoreRow.history_depth || 0) < 0.5) {
          summary.withoutHistory += 1;
        }

        const reasonCodesJson = JSON.stringify(scoreRow.reason_codes);
        const note = `version=${scoreRow.score_version}; confidence=${scoreRow.confidence_score}; reprice_direction=${scoreRow.reprice_direction}`;

        statements.upsertScore.run(
          target.asset_id,
          target.target_id,
          scoreDate,
          scoreRow.legacy_score_value,
          scoreRow.price_ref,
          scoreRow.portal_ref,
          scoreRow.d3,
          scoreRow.d7,
          scoreRow.d14,
          scoreRow.d30,
          scoreRow.momentum_short_raw,
          scoreRow.momentum_mid_raw,
          scoreRow.acceleration_raw,
          scoreRow.spread_raw,
          scoreRow.spread_quality,
          scoreRow.freshness_score,
          scoreRow.history_depth,
          scoreRow.cross_confirmation,
          scoreRow.stock_exposure,
          scoreRow.pricing_gap_pct,
          scoreRow.confidence_score,
          scoreRow.score_tension,
          scoreRow.score_hype,
          scoreRow.score_reprice,
          scoreRow.reprice_direction,
          scoreRow.score_sell_watch,
          scoreRow.score_buy_watch,
          reasonCodesJson,
          scoreRow.score_version,
          scoreRow.legacy_score_label,
          note
        );

        summary.scored += 1;

        console.log(
          `[scored] ${targetLabel} confidence=${scoreRow.confidence_score} ` +
            `tension=${scoreRow.score_tension} hype=${scoreRow.score_hype} ` +
            `reprice=${scoreRow.score_reprice} sell_watch=${scoreRow.score_sell_watch} ` +
            `buy_watch=${scoreRow.score_buy_watch} reprice_direction=${scoreRow.reprice_direction}`
        );
      } catch (error) {
        summary.sourceErrors += 1;
        console.log(`[source_error] ${targetLabel} message=${error.message}`);
      }
    }

    return {
      dbPath,
      scoreDate,
      scope,
      targetSource,
      summary,
    };
  } finally {
    db.close();
  }
}

function parseCliArgs(argv) {
  const options = {};

  for (const arg of argv) {
    if (arg.startsWith("--score-date=")) {
      options.scoreDate = arg.slice("--score-date=".length);
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

    if (arg.startsWith("--config-json=")) {
      options.configJson = arg.slice("--config-json=".length);
      continue;
    }

    if (arg.startsWith("--db=")) {
      options.dbPath = arg.slice("--db=".length);
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
      const result = await runScoresDaily(options);

      console.log("Scores daily completed:");
      console.log(`- score_date: ${result.scoreDate}`);
      console.log(`- scope: ${result.scope}`);
      if (result.targetSource) {
        console.log(`- target_source: ${result.targetSource}`);
      }
      console.log(`- targets_read: ${result.summary.targetsRead}`);
      console.log(`- scored: ${result.summary.scored}`);
      console.log(`- incomplete: ${result.summary.incomplete}`);
      console.log(`- without_history: ${result.summary.withoutHistory}`);
      console.log(`- without_stock: ${result.summary.withoutStock}`);
      console.log(`- without_portal_ref: ${result.summary.withoutPortalRef}`);
      console.log(`- without_market_today: ${result.summary.withoutMarketToday}`);
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
  runScoresDaily,
};
