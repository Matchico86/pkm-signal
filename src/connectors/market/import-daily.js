const fs = require("node:fs");
const path = require("node:path");
const { openDatabase } = require("../../db/client");
const { transaction } = require("../../db/queries");

const DEFAULT_MARKET_EXPORT_PATH = path.resolve(
  __dirname,
  "../../../data/export/market-daily.json"
);

const DEFAULT_MARKET_SOURCE = "local_market";
const DEFAULT_TARGET_SOURCE = "portal_stock";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function parseNonNegativeInteger(value, fieldName, rowLabel, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) {
      throw new Error(`${rowLabel} missing required field: ${fieldName}`);
    }
    return null;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`${rowLabel} invalid non-negative integer for ${fieldName}: ${value}`);
  }

  return parsedValue;
}

function parsePositiveInteger(value, fieldName, rowLabel, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) {
      throw new Error(`${rowLabel} missing required field: ${fieldName}`);
    }
    return null;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${rowLabel} invalid positive integer for ${fieldName}: ${value}`);
  }

  return parsedValue;
}

function parseMarketPayload(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Market file not found: ${filePath}`);
  }

  let parsedPayload;
  try {
    parsedPayload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }

  if (Array.isArray(parsedPayload)) {
    return {
      items: parsedPayload,
      marketDate: null,
      source: null,
      targetSource: null,
    };
  }

  if (!parsedPayload || typeof parsedPayload !== "object") {
    throw new Error("Invalid market payload: expected an array or an object.");
  }

  const items =
    (Array.isArray(parsedPayload.items) && parsedPayload.items) ||
    (Array.isArray(parsedPayload.rows) && parsedPayload.rows) ||
    (Array.isArray(parsedPayload.data) && parsedPayload.data);

  if (!items) {
    throw new Error("Invalid market payload: expected `items`, `rows` or `data` array.");
  }

  return {
    items,
    marketDate: normalizeString(parsedPayload.market_date ?? parsedPayload.marketDate),
    source: normalizeString(parsedPayload.source ?? parsedPayload.market_source),
    targetSource: normalizeString(parsedPayload.target_source ?? parsedPayload.targetSource),
  };
}

function normalizeMarketDate(value, rowLabel) {
  if (!value) {
    throw new Error(`${rowLabel} missing required field: market_date`);
  }

  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(`${rowLabel} invalid date for market_date (expected YYYY-MM-DD): ${value}`);
  }

  return value;
}

function assertMarketRowConsistency(row, rowLabel) {
  if (
    row.priceLowCents !== null &&
    row.priceMidCents !== null &&
    row.priceLowCents > row.priceMidCents
  ) {
    throw new Error(
      `${rowLabel} inconsistent prices: price_low_cents > price_mid_cents (${row.priceLowCents} > ${row.priceMidCents})`
    );
  }

  if (
    row.priceMidCents !== null &&
    row.priceHighCents !== null &&
    row.priceMidCents > row.priceHighCents
  ) {
    throw new Error(
      `${rowLabel} inconsistent prices: price_mid_cents > price_high_cents (${row.priceMidCents} > ${row.priceHighCents})`
    );
  }

  if (
    row.priceLowCents !== null &&
    row.priceHighCents !== null &&
    row.priceLowCents > row.priceHighCents
  ) {
    throw new Error(
      `${rowLabel} inconsistent prices: price_low_cents > price_high_cents (${row.priceLowCents} > ${row.priceHighCents})`
    );
  }
}

function normalizeMarketRow(rawRow, rowIndex, defaults, options) {
  const rowLabel = `Row ${rowIndex + 1}:`;
  if (!rawRow || typeof rawRow !== "object") {
    throw new Error(`${rowLabel} expected an object.`);
  }

  const targetId = parsePositiveInteger(rawRow.target_id ?? rawRow.targetId, "target_id", rowLabel);
  const cardRef = normalizeString(rawRow.card_ref ?? rawRow.cardRef);

  if (targetId === null && !cardRef) {
    throw new Error(`${rowLabel} missing target_id or card_ref.`);
  }

  const marketDate = normalizeMarketDate(
    normalizeString(
      rawRow.market_date ??
        rawRow.marketDate ??
        options.marketDate ??
        defaults.marketDate
    ),
    rowLabel
  );

  const source =
    normalizeString(
      rawRow.source ??
        rawRow.market_source ??
        rawRow.marketSource ??
        options.source ??
        defaults.source
    ) || DEFAULT_MARKET_SOURCE;

  const explicitTargetSource = normalizeString(
    rawRow.target_source ??
      rawRow.targetSource ??
      options.targetSource ??
      defaults.targetSource
  );

  const row = {
    targetId,
    cardRef,
    targetSource: targetId === null ? explicitTargetSource || DEFAULT_TARGET_SOURCE : explicitTargetSource,
    marketDate,
    source,
    priceLowCents: parseNonNegativeInteger(
      rawRow.price_low_cents ?? rawRow.priceLowCents,
      "price_low_cents",
      rowLabel
    ),
    priceMidCents: parseNonNegativeInteger(
      rawRow.price_mid_cents ?? rawRow.priceMidCents,
      "price_mid_cents",
      rowLabel
    ),
    priceHighCents: parseNonNegativeInteger(
      rawRow.price_high_cents ?? rawRow.priceHighCents,
      "price_high_cents",
      rowLabel
    ),
    listingsCount: parseNonNegativeInteger(
      rawRow.listings_count ?? rawRow.listingsCount,
      "listings_count",
      rowLabel
    ),
    salesCount: parseNonNegativeInteger(
      rawRow.sales_count ?? rawRow.salesCount,
      "sales_count",
      rowLabel
    ),
  };

  assertMarketRowConsistency(row, rowLabel);
  return row;
}

function resolveTargetForRow(row, rowIndex, statements) {
  const rowLabel = `Row ${rowIndex + 1}:`;

  if (row.targetId !== null) {
    const target = statements.findTargetById.get(row.targetId);
    if (!target) {
      throw new Error(`${rowLabel} target not found for target_id=${row.targetId}`);
    }

    if (row.cardRef && row.cardRef !== target.card_ref) {
      throw new Error(
        `${rowLabel} target_id/card_ref mismatch (target_id=${row.targetId}, card_ref=${row.cardRef})`
      );
    }

    if (row.targetSource && row.targetSource !== target.target_source) {
      throw new Error(
        `${rowLabel} target_id/target_source mismatch (target_id=${row.targetId}, target_source=${row.targetSource})`
      );
    }

    return target;
  }

  const asset = statements.findAssetByCardRef.get(row.cardRef);
  if (!asset) {
    throw new Error(`${rowLabel} asset not found for card_ref=${row.cardRef}`);
  }

  const target = statements.findTargetByCardRefAndSource.get(row.cardRef, row.targetSource);
  if (!target) {
    throw new Error(
      `${rowLabel} target not found for card_ref=${row.cardRef} and target_source=${row.targetSource}`
    );
  }

  return target;
}

function importMarketDaily(options = {}) {
  const filePath = path.resolve(
    options.filePath || process.env.PKM_MARKET_DAILY_FILE || DEFAULT_MARKET_EXPORT_PATH
  );

  const payload = parseMarketPayload(filePath);
  const normalizedRows = payload.items.map((rawRow, rowIndex) =>
    normalizeMarketRow(rawRow, rowIndex, payload, options)
  );

  const { db, dbPath } = openDatabase({ dbPath: options.dbPath });
  const touchedAssetIds = new Set();
  const touchedTargetIds = new Set();

  try {
    const statements = {
      findAssetByCardRef: db.prepare("SELECT id FROM assets WHERE card_ref = ?"),
      findTargetById: db.prepare(`
        SELECT
          t.id AS target_id,
          t.asset_id,
          t.source AS target_source,
          a.card_ref
        FROM targets t
        JOIN assets a ON a.id = t.asset_id
        WHERE t.id = ?
      `),
      findTargetByCardRefAndSource: db.prepare(`
        SELECT
          t.id AS target_id,
          t.asset_id,
          t.source AS target_source,
          a.card_ref
        FROM assets a
        JOIN targets t ON t.asset_id = a.id
        WHERE a.card_ref = ? AND t.source = ?
      `),
      upsertMarketDaily: db.prepare(`
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
          price_low_cents = COALESCE(excluded.price_low_cents, market_history_daily.price_low_cents),
          price_mid_cents = COALESCE(excluded.price_mid_cents, market_history_daily.price_mid_cents),
          price_high_cents = COALESCE(excluded.price_high_cents, market_history_daily.price_high_cents),
          listings_count = COALESCE(excluded.listings_count, market_history_daily.listings_count),
          sales_count = COALESCE(excluded.sales_count, market_history_daily.sales_count);
      `),
    };

    transaction(db, () => {
      normalizedRows.forEach((row, rowIndex) => {
        const target = resolveTargetForRow(row, rowIndex, statements);

        statements.upsertMarketDaily.run(
          target.asset_id,
          row.marketDate,
          row.source,
          row.priceLowCents,
          row.priceMidCents,
          row.priceHighCents,
          row.listingsCount,
          row.salesCount
        );

        touchedAssetIds.add(target.asset_id);
        touchedTargetIds.add(target.target_id);
      });
    });

    return {
      dbPath,
      filePath,
      rowsRead: payload.items.length,
      rowsImported: normalizedRows.length,
      assetsTouched: touchedAssetIds.size,
      targetsResolved: touchedTargetIds.size,
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

    if (arg.startsWith("--source=")) {
      options.source = arg.slice("--source=".length);
      continue;
    }

    if (arg.startsWith("--target-source=")) {
      options.targetSource = arg.slice("--target-source=".length);
      continue;
    }

    if (arg.startsWith("--file=")) {
      options.filePath = arg.slice("--file=".length);
      continue;
    }

    if (arg.startsWith("--db=")) {
      options.dbPath = arg.slice("--db=".length);
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!options.filePath) {
      options.filePath = arg;
      continue;
    }

    throw new Error(`Unexpected positional argument: ${arg}`);
  }

  return options;
}

if (require.main === module) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const result = importMarketDaily(options);
    console.log("Market daily import completed:");
    console.log(`- file: ${result.filePath}`);
    console.log(`- rows_read: ${result.rowsRead}`);
    console.log(`- rows_imported: ${result.rowsImported}`);
    console.log(`- targets_resolved: ${result.targetsResolved}`);
    console.log(`- assets_touched: ${result.assetsTouched}`);
    console.log(`- db: ${result.dbPath}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_MARKET_EXPORT_PATH,
  importMarketDaily,
  normalizeMarketRow,
  parseMarketPayload,
};
