const fs = require("node:fs");
const path = require("node:path");
const { openDatabase } = require("./client");

const MIGRATIONS_DIR = path.resolve(__dirname, "../../db/migrations");
const BASELINE_TABLES_BY_MIGRATION = {
  "001_init.sql": [
    "assets",
    "targets",
    "portal_stock_snapshot",
    "market_history_daily",
    "scores_daily",
    "alerts",
  ],
  "002_portal_snapshot_import.sql": [
    "portal_snapshot_runs",
    "portal_snapshot_run_payloads",
    "portal_purchase_items",
    "portal_sales_items",
    "portal_stock_live_snapshots",
    "portal_purchase_orders",
    "portal_sales_orders",
    "portal_orders_status",
  ],
};
const SCORES_V1_COLUMNS = [
  "target_id",
  "price_ref",
  "portal_ref",
  "d3",
  "d7",
  "d14",
  "d30",
  "momentum_short_raw",
  "momentum_mid_raw",
  "acceleration_raw",
  "spread_raw",
  "spread_quality",
  "freshness_score",
  "history_depth",
  "cross_confirmation",
  "stock_exposure",
  "pricing_gap_pct",
  "confidence_score",
  "score_tension",
  "score_hype",
  "score_reprice",
  "reprice_direction",
  "score_sell_watch",
  "score_buy_watch",
  "reason_codes_json",
  "score_version",
];

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getAppliedMigrations(db) {
  const rows = db.prepare("SELECT name FROM schema_migrations ORDER BY name ASC").all();
  return new Set(rows.map((row) => row.name));
}

function tableExists(db, tableName) {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1;"
    )
    .get(tableName);
  return Boolean(row);
}

function listTableColumns(db, tableName) {
  if (!tableExists(db, tableName)) {
    return new Set();
  }

  const rows = db.prepare(`PRAGMA table_info(${tableName});`).all();
  return new Set(rows.map((row) => row.name));
}

function hasAllTables(db, tableNames) {
  return tableNames.every((tableName) => tableExists(db, tableName));
}

function hasAllColumns(db, tableName, columnNames) {
  const existingColumns = listTableColumns(db, tableName);
  return columnNames.every((columnName) => existingColumns.has(columnName));
}

function isMigrationAlreadyReflected(db, migrationName) {
  if (Object.prototype.hasOwnProperty.call(BASELINE_TABLES_BY_MIGRATION, migrationName)) {
    return hasAllTables(db, BASELINE_TABLES_BY_MIGRATION[migrationName]);
  }

  if (migrationName === "003_scores_v1.sql") {
    return hasAllColumns(db, "scores_daily", SCORES_V1_COLUMNS);
  }

  return false;
}

function markMigrationAsApplied(db, migrationName) {
  db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(migrationName);
}

function applyMigration(db, migrationName, sql) {
  db.exec("BEGIN;");

  try {
    db.exec(sql);
    markMigrationAsApplied(db, migrationName);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw new Error(`Migration failed (${migrationName}): ${error.message}`);
  }
}

function parseCliArgs(argv) {
  const options = {};

  for (const arg of argv) {
    if (arg === "--status") {
      options.statusOnly = true;
      continue;
    }

    if (arg.startsWith("--db=")) {
      options.dbPath = arg.slice("--db=".length);
      continue;
    }

    if (arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!options.dbPath) {
      options.dbPath = arg;
      continue;
    }

    throw new Error(`Unexpected positional argument: ${arg}`);
  }

  return options;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node src/db/migrate.js [--db=<path>]");
  console.log("  node src/db/migrate.js --status [--db=<path>]");
}

function migrate(options = {}) {
  const { db, dbPath } = openDatabase(options);

  try {
    ensureMigrationsTable(db);
    const appliedMigrations = getAppliedMigrations(db);
    const allMigrations = listMigrations();
    const pendingMigrations = allMigrations.filter((name) => !appliedMigrations.has(name));

    if (options.statusOnly) {
      return {
        dbPath,
        totalKnown: allMigrations.length,
        applied: Array.from(appliedMigrations).sort(),
        pending: pendingMigrations,
      };
    }

    const newlyApplied = [];
    const baselined = [];

    for (const migrationName of allMigrations) {
      if (appliedMigrations.has(migrationName)) {
        continue;
      }

      if (isMigrationAlreadyReflected(db, migrationName)) {
        markMigrationAsApplied(db, migrationName);
        baselined.push(migrationName);
        continue;
      }

      const migrationPath = path.join(MIGRATIONS_DIR, migrationName);
      const sql = fs.readFileSync(migrationPath, "utf8");
      applyMigration(db, migrationName, sql);
      newlyApplied.push(migrationName);
    }

    return {
      dbPath,
      applied: newlyApplied,
      baselined,
      totalKnown: allMigrations.length,
      pending: allMigrations.filter(
        (name) => !newlyApplied.includes(name) && !baselined.includes(name) && !appliedMigrations.has(name)
      ),
    };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.help) {
      printUsage();
      process.exitCode = 0;
      return;
    }

    const result = migrate(options);
    if (options.statusOnly) {
      console.log(`Migration status (db: ${result.dbPath}):`);
      console.log(`- known: ${result.totalKnown}`);
      console.log(`- applied: ${result.applied.length}`);
      console.log(`- pending: ${result.pending.length}`);
      if (result.pending.length > 0) {
        console.log("- pending_names:");
        for (const migrationName of result.pending) {
          console.log(`  - ${migrationName}`);
        }
      }
    } else if (result.applied.length === 0 && result.baselined.length === 0) {
      console.log(`No migration to apply (db: ${result.dbPath}).`);
    } else {
      if (result.applied.length > 0) {
        console.log(`Applied migrations (${result.applied.length}):`);
        for (const migrationName of result.applied) {
          console.log(`- ${migrationName}`);
        }
      }
      if (result.baselined.length > 0) {
        console.log(`Baselined migrations (${result.baselined.length}):`);
        for (const migrationName of result.baselined) {
          console.log(`- ${migrationName}`);
        }
      }
      console.log(`Database ready: ${result.dbPath}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  MIGRATIONS_DIR,
  listMigrations,
  migrate,
  parseCliArgs,
};
