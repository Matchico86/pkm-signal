const fs = require("node:fs");
const path = require("node:path");
const { openDatabase } = require("../../db/client");
const { transaction } = require("../../db/queries");

const DEFAULT_PORTAL_EXPORT_PATH = path.resolve(
  __dirname,
  "../../../data/export/portal-stock.json"
);

const DEFAULT_TARGET_SOURCE = "portal_stock";
const DEFAULT_TARGET_PRIORITY = 3;
const DEFAULT_TARGET_NOTE = "Auto-created from portal stock import";

function normalizeString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function parseNonNegativeInteger(value, fieldName, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) {
      throw new Error(`Missing required field: ${fieldName}`);
    }
    return null;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`Invalid non-negative integer for ${fieldName}: ${value}`);
  }

  return parsedValue;
}

function parsePortalStockPayload(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Portal export file not found: ${filePath}`);
  }

  let parsedPayload;
  try {
    parsedPayload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }

  if (Array.isArray(parsedPayload)) {
    return { items: parsedPayload, snapshotAt: null };
  }

  if (!parsedPayload || typeof parsedPayload !== "object") {
    throw new Error("Invalid portal payload: expected an array or an object.");
  }

  const items =
    (Array.isArray(parsedPayload.items) && parsedPayload.items) ||
    (Array.isArray(parsedPayload.rows) && parsedPayload.rows) ||
    (Array.isArray(parsedPayload.stock) && parsedPayload.stock);

  if (!items) {
    throw new Error(
      "Invalid portal payload: expected `items`, `rows` or `stock` array."
    );
  }

  return {
    items,
    snapshotAt: normalizeString(parsedPayload.snapshot_at ?? parsedPayload.snapshotAt),
  };
}

function normalizePortalStockRow(rawRow, rowIndex) {
  if (!rawRow || typeof rawRow !== "object") {
    throw new Error(`Row ${rowIndex + 1}: expected an object.`);
  }

  const cardRef = normalizeString(rawRow.card_ref ?? rawRow.cardRef ?? rawRow.asset_ref);
  if (!cardRef) {
    throw new Error(`Row ${rowIndex + 1}: missing card_ref.`);
  }

  const name =
    normalizeString(rawRow.name ?? rawRow.card_name ?? rawRow.cardName) || cardRef;
  const setCode = normalizeString(rawRow.set_code ?? rawRow.setCode);
  const cardNumber = normalizeString(rawRow.card_number ?? rawRow.cardNumber);
  const rarity = normalizeString(rawRow.rarity);

  const quantity = parseNonNegativeInteger(rawRow.quantity, "quantity", { required: true });
  const unitCostCents = parseNonNegativeInteger(
    rawRow.unit_cost_cents ?? rawRow.unitCostCents,
    "unit_cost_cents"
  );
  const providedTotalCostCents = parseNonNegativeInteger(
    rawRow.total_cost_cents ?? rawRow.totalCostCents,
    "total_cost_cents"
  );

  const totalCostCents =
    providedTotalCostCents !== null
      ? providedTotalCostCents
      : unitCostCents !== null
      ? unitCostCents * quantity
      : null;

  return {
    cardRef,
    name,
    setCode,
    cardNumber,
    rarity,
    quantity,
    unitCostCents,
    totalCostCents,
  };
}

function hasNonNullConflict(existingValue, incomingValue) {
  return existingValue !== null && incomingValue !== null && existingValue !== incomingValue;
}

function assertAssetMetadataCompatibility(existingAsset, row) {
  const conflicts = [];

  if (hasNonNullConflict(existingAsset.set_code, row.setCode)) {
    conflicts.push(`set_code existing=${existingAsset.set_code} incoming=${row.setCode}`);
  }

  if (hasNonNullConflict(existingAsset.card_number, row.cardNumber)) {
    conflicts.push(
      `card_number existing=${existingAsset.card_number} incoming=${row.cardNumber}`
    );
  }

  if (hasNonNullConflict(existingAsset.rarity, row.rarity)) {
    conflicts.push(`rarity existing=${existingAsset.rarity} incoming=${row.rarity}`);
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Conflicting asset metadata for card_ref=${row.cardRef}. ` +
        `Refusing silent merge: ${conflicts.join(", ")}`
    );
  }
}

function resolveSnapshotAt(optionsSnapshotAt, payloadSnapshotAt) {
  const explicitValue = normalizeString(optionsSnapshotAt) || normalizeString(payloadSnapshotAt);
  if (explicitValue) {
    return explicitValue;
  }

  // Default snapshot is UTC date. Manual jobs should prefer --snapshot-at=YYYY-MM-DD.
  return new Date().toISOString().slice(0, 10);
}

function importPortalStock(options = {}) {
  const filePath = path.resolve(
    options.filePath || process.env.PKM_PORTAL_STOCK_FILE || DEFAULT_PORTAL_EXPORT_PATH
  );

  const payload = parsePortalStockPayload(filePath);
  const normalizedRows = payload.items.map((row, index) =>
    normalizePortalStockRow(row, index)
  );

  const snapshotAt = resolveSnapshotAt(options.snapshotAt, payload.snapshotAt);
  const { db, dbPath } = openDatabase({ dbPath: options.dbPath });

  const touchedAssetIds = new Set();
  try {
    const upsertAsset = db.prepare(`
      INSERT INTO assets (card_ref, name, set_code, card_number, rarity, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(card_ref) DO UPDATE SET
        name = excluded.name,
        set_code = COALESCE(excluded.set_code, assets.set_code),
        card_number = COALESCE(excluded.card_number, assets.card_number),
        rarity = COALESCE(excluded.rarity, assets.rarity),
        updated_at = CURRENT_TIMESTAMP;
    `);

    const findAssetByCardRef = db.prepare(
      "SELECT id, set_code, card_number, rarity FROM assets WHERE card_ref = ?"
    );

    const upsertTarget = db.prepare(`
      INSERT INTO targets (asset_id, source, priority, is_active, note, updated_at)
      VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(asset_id, source) DO UPDATE SET
        priority = excluded.priority,
        is_active = 1,
        note = excluded.note,
        updated_at = CURRENT_TIMESTAMP;
    `);

    const upsertPortalStockSnapshot = db.prepare(`
      INSERT INTO portal_stock_snapshot (
        snapshot_at,
        asset_id,
        quantity,
        unit_cost_cents,
        total_cost_cents
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_at, asset_id) DO UPDATE SET
        quantity = excluded.quantity,
        unit_cost_cents = excluded.unit_cost_cents,
        total_cost_cents = excluded.total_cost_cents;
    `);

    transaction(db, () => {
      for (const row of normalizedRows) {
        const existingAsset = findAssetByCardRef.get(row.cardRef);
        if (existingAsset) {
          assertAssetMetadataCompatibility(existingAsset, row);
        }

        upsertAsset.run(row.cardRef, row.name, row.setCode, row.cardNumber, row.rarity);

        const asset = existingAsset || findAssetByCardRef.get(row.cardRef);
        if (!asset) {
          throw new Error(`Asset not found after upsert for card_ref=${row.cardRef}`);
        }

        upsertTarget.run(
          asset.id,
          DEFAULT_TARGET_SOURCE,
          DEFAULT_TARGET_PRIORITY,
          DEFAULT_TARGET_NOTE
        );

        upsertPortalStockSnapshot.run(
          snapshotAt,
          asset.id,
          row.quantity,
          row.unitCostCents,
          row.totalCostCents
        );

        touchedAssetIds.add(asset.id);
      }
    });

    return {
      dbPath,
      filePath,
      snapshotAt,
      rowsRead: payload.items.length,
      rowsImported: normalizedRows.length,
      assetsTouched: touchedAssetIds.size,
    };
  } finally {
    db.close();
  }
}

function parseCliArgs(argv) {
  const options = {};

  for (const arg of argv) {
    if (arg.startsWith("--snapshot-at=")) {
      options.snapshotAt = arg.slice("--snapshot-at=".length);
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
    const result = importPortalStock(options);
    console.log("Portal stock import completed:");
    console.log(`- file: ${result.filePath}`);
    console.log(`- snapshot_at: ${result.snapshotAt}`);
    console.log(`- rows_read: ${result.rowsRead}`);
    console.log(`- rows_imported: ${result.rowsImported}`);
    console.log(`- assets_touched: ${result.assetsTouched}`);
    console.log("- note: default snapshot_at is UTC. For manual jobs, use --snapshot-at=YYYY-MM-DD");
    console.log(`- db: ${result.dbPath}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_PORTAL_EXPORT_PATH,
  importPortalStock,
  normalizePortalStockRow,
  parsePortalStockPayload,
  resolveSnapshotAt,
};
