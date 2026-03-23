function run(db, sql, params = []) {
  return db.prepare(sql).run(...params);
}

function get(db, sql, params = []) {
  return db.prepare(sql).get(...params) || null;
}

function all(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

function transaction(db, work) {
  db.exec("BEGIN;");
  try {
    const result = work();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

module.exports = {
  all,
  get,
  run,
  transaction,
};
