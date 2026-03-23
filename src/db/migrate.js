const fs = require("node:fs");
const path = require("node:path");
const { openDatabase } = require("./client");

const MIGRATIONS_DIR = path.resolve(__dirname, "../../db/migrations");

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

function applyMigration(db, migrationName, sql) {
  db.exec("BEGIN;");

  try {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(migrationName);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw new Error(`Migration failed (${migrationName}): ${error.message}`);
  }
}

function migrate(options = {}) {
  const { db, dbPath } = openDatabase(options);

  try {
    ensureMigrationsTable(db);
    const appliedMigrations = getAppliedMigrations(db);
    const allMigrations = listMigrations();
    const newlyApplied = [];

    for (const migrationName of allMigrations) {
      if (appliedMigrations.has(migrationName)) {
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
      totalKnown: allMigrations.length,
    };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    const result = migrate();
    if (result.applied.length === 0) {
      console.log(`No migration to apply (db: ${result.dbPath}).`);
    } else {
      console.log(`Applied migrations (${result.applied.length}):`);
      for (const migrationName of result.applied) {
        console.log(`- ${migrationName}`);
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
};
