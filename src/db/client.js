const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_DB_PATH = path.resolve(__dirname, "../../db/pkm-market-engine.db");

function resolveDbPath(customPath = process.env.PKM_DB_PATH) {
  return path.resolve(customPath || DEFAULT_DB_PATH);
}

function openDatabase(options = {}) {
  const dbPath = resolveDbPath(options.dbPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");

  return { db, dbPath };
}

module.exports = {
  DEFAULT_DB_PATH,
  openDatabase,
  resolveDbPath,
};
