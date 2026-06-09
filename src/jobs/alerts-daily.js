const fs = require("node:fs");
const path = require("node:path");
const { openDatabase } = require("../db/client");
const {
  ACTIVE_ALERT_STATUSES,
  ALERT_TYPE_COOLDOWN_DAYS,
  ALERT_TYPE_EXPIRE_MISSED_DAYS,
  DEFAULT_ALERTS_CONFIG,
} = require("../core/alerts/config");
const {
  buildAlertDedupeKey,
  evaluateAlertRules,
} = require("../core/alerts/rules");

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_SCOPE = "all";
const ALLOWED_SCOPES = new Set(["all", "owned", "watchlist"]);

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

function resolveScope(scope) {
  const normalizedScope = normalizeString(scope) || DEFAULT_SCOPE;
  if (!ALLOWED_SCOPES.has(normalizedScope)) {
    throw new Error(`Invalid scope: ${normalizedScope}. Expected all|owned|watchlist.`);
  }

  return normalizedScope;
}

function parsePositiveInteger(value, fieldName) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    throw new Error(`Invalid positive integer for ${fieldName}: ${value}`);
  }
  return numericValue;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(baseConfig, overrideConfig) {
  if (!isPlainObject(overrideConfig)) {
    return baseConfig;
  }

  const output = { ...baseConfig };
  for (const [key, value] of Object.entries(overrideConfig)) {
    if (isPlainObject(value) && isPlainObject(baseConfig[key])) {
      output[key] = mergeConfig(baseConfig[key], value);
      continue;
    }
    output[key] = value;
  }

  return output;
}

function resolveAlertsConfig(options = {}) {
  let resolvedConfig = DEFAULT_ALERTS_CONFIG;

  if (process.env.PKM_ALERTS_CONFIG_JSON) {
    try {
      resolvedConfig = mergeConfig(
        resolvedConfig,
        JSON.parse(process.env.PKM_ALERTS_CONFIG_JSON)
      );
    } catch (error) {
      throw new Error(`Invalid PKM_ALERTS_CONFIG_JSON: ${error.message}`);
    }
  }

  if (options.configJson) {
    try {
      resolvedConfig = mergeConfig(resolvedConfig, JSON.parse(options.configJson));
    } catch (error) {
      throw new Error(`Invalid --config-json payload: ${error.message}`);
    }
  }

  if (Number.isInteger(options.maxNewAlerts) && options.maxNewAlerts > 0) {
    resolvedConfig = {
      ...resolvedConfig,
      maxNewAlertsPerRun: options.maxNewAlerts,
    };
  }

  if (Number.isInteger(options.maxOutputAlerts) && options.maxOutputAlerts > 0) {
    resolvedConfig = {
      ...resolvedConfig,
      maxOutputAlerts: options.maxOutputAlerts,
    };
  }

  return resolvedConfig;
}

function shiftIsoDate(isoDate, deltaDays) {
  const parsedDate = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate)) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  return new Date(parsedDate + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

function parseTimestampMs(value) {
  const normalizedValue = normalizeString(value);
  if (!normalizedValue) {
    return null;
  }

  const dateLikeValue = ISO_DATE_PATTERN.test(normalizedValue)
    ? `${normalizedValue}T00:00:00.000Z`
    : normalizedValue.includes("T")
    ? normalizedValue
    : `${normalizedValue.replace(" ", "T")}Z`;

  const parsed = Date.parse(dateLikeValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractIsoDate(value) {
  const normalizedValue = normalizeString(value);
  if (!normalizedValue) {
    return null;
  }
  return normalizedValue.slice(0, 10);
}

function diffDays(fromIsoDate, toValue) {
  const fromDate = normalizeIsoDate(fromIsoDate, "fromIsoDate");
  const toDate = extractIsoDate(toValue);
  if (!toDate || !ISO_DATE_PATTERN.test(toDate)) {
    return null;
  }

  const fromMs = Date.parse(`${fromDate}T00:00:00.000Z`);
  const toMs = Date.parse(`${toDate}T00:00:00.000Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return null;
  }

  return Math.floor((fromMs - toMs) / 86_400_000);
}

function toFiniteOrNull(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return numericValue;
}

function toJsonString(value, fallbackLiteral) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return fallbackLiteral;
  }
}

function resolveScoreDate(db, explicitScoreDate) {
  if (explicitScoreDate) {
    return normalizeIsoDate(explicitScoreDate, "score_date");
  }

  const row = db.prepare("SELECT MAX(score_date) AS latest_score_date FROM scores_daily;").get();
  if (!row || !row.latest_score_date) {
    throw new Error("No scores found in scores_daily. Run scores-daily before alerts-daily.");
  }

  return normalizeIsoDate(row.latest_score_date, "score_date");
}

function resolveScopeFromTargetSource(targetSource) {
  if (targetSource && targetSource !== "portal_stock") {
    return "watchlist";
  }
  return "owned";
}

function loadScoreRows(db, scoreDate) {
  return db.prepare(`
    SELECT
      s.asset_id,
      a.card_ref,
      a.name,
      COALESCE(s.target_id, t.id) AS target_id,
      t.source AS target_source,
      t.priority AS target_priority,
      s.score_date,
      s.score_value,
      s.price_ref,
      s.portal_ref,
      s.d3,
      s.d7,
      s.d14,
      s.d30,
      s.acceleration_raw,
      s.cross_confirmation,
      s.stock_exposure,
      s.pricing_gap_pct,
      s.confidence_score,
      s.score_tension,
      s.score_hype,
      s.score_reprice,
      s.score_sell_watch,
      s.score_buy_watch,
      s.reason_codes_json
    FROM scores_daily s
    JOIN assets a ON a.id = s.asset_id
    LEFT JOIN targets t ON t.id = COALESCE(
      s.target_id,
      (
        SELECT t2.id
        FROM targets t2
        WHERE t2.asset_id = s.asset_id AND t2.is_active = 1
        ORDER BY t2.priority ASC, t2.id ASC
        LIMIT 1
      )
    )
    WHERE s.score_date = ?
    ORDER BY s.asset_id ASC;
  `).all(scoreDate);
}

function loadPreviousScoreRowsByAsset(db, scoreDate) {
  const rows = db.prepare(`
    SELECT
      s.asset_id,
      s.score_date,
      s.price_ref,
      s.portal_ref,
      s.d3,
      s.d7,
      s.d14,
      s.d30,
      s.acceleration_raw,
      s.cross_confirmation,
      s.pricing_gap_pct,
      s.confidence_score,
      s.score_tension,
      s.score_hype,
      s.score_reprice,
      s.score_sell_watch,
      s.score_buy_watch
    FROM scores_daily s
    JOIN (
      SELECT asset_id, MAX(score_date) AS previous_score_date
      FROM scores_daily
      WHERE score_date < ?
      GROUP BY asset_id
    ) prev
      ON prev.asset_id = s.asset_id
     AND prev.previous_score_date = s.score_date;
  `).all(scoreDate);

  const byAssetId = new Map();
  for (const row of rows) {
    byAssetId.set(row.asset_id, row);
  }

  return byAssetId;
}

function loadActiveAlertsByDedupe(db) {
  const placeholders = ACTIVE_ALERT_STATUSES.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT
      alert_id,
      dedupe_key,
      alert_type,
      status,
      first_seen_at,
      last_seen_at,
      emitted_at,
      cooldown_until,
      occurrence_count
    FROM alerts
    WHERE status IN (${placeholders})
    ORDER BY emitted_at DESC, alert_id DESC;
  `).all(...ACTIVE_ALERT_STATUSES);

  const byDedupeKey = new Map();
  for (const row of rows) {
    if (!byDedupeKey.has(row.dedupe_key)) {
      byDedupeKey.set(row.dedupe_key, row);
    }
  }

  return byDedupeKey;
}

function loadLatestAlertsByDedupe(db) {
  const rows = db.prepare(`
    SELECT
      alert_id,
      dedupe_key,
      alert_type,
      status,
      cooldown_until,
      emitted_at
    FROM alerts
    ORDER BY emitted_at DESC, alert_id DESC;
  `).all();

  const byDedupeKey = new Map();
  for (const row of rows) {
    if (!byDedupeKey.has(row.dedupe_key)) {
      byDedupeKey.set(row.dedupe_key, row);
    }
  }

  return byDedupeKey;
}

function createStatements(db) {
  return {
    getLatestStock: db.prepare(`
      SELECT snapshot_at, quantity, unit_cost_cents, total_cost_cents
      FROM portal_stock_snapshot
      WHERE asset_id = ? AND snapshot_at <= ?
      ORDER BY snapshot_at DESC
      LIMIT 1;
    `),
    getListingAtOrBeforeDate: db.prepare(`
      SELECT market_date, source, listings_count
      FROM market_history_daily
      WHERE asset_id = ? AND market_date <= ? AND listings_count IS NOT NULL
      ORDER BY
        market_date DESC,
        CASE WHEN source = ? THEN 0 ELSE 1 END,
        source ASC
      LIMIT 1;
    `),
    insertAlert: db.prepare(`
      INSERT INTO alerts (
        job_run_id,
        asset_id,
        target_id,
        alert_type,
        scope,
        severity,
        priority_score,
        confidence_score,
        status,
        title,
        message_short,
        action_hint,
        reason_codes_json,
        metrics_json,
        dedupe_key,
        first_seen_at,
        last_seen_at,
        emitted_at,
        cooldown_until,
        occurrence_count,
        resolved_at,
        resolution_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL);
    `),
    updateActiveAlert: db.prepare(`
      UPDATE alerts
      SET
        job_run_id = ?,
        target_id = ?,
        scope = ?,
        severity = ?,
        priority_score = ?,
        confidence_score = ?,
        status = ?,
        title = ?,
        message_short = ?,
        action_hint = ?,
        reason_codes_json = ?,
        metrics_json = ?,
        last_seen_at = ?,
        cooldown_until = ?,
        occurrence_count = ?,
        resolved_at = NULL,
        resolution_reason = NULL
      WHERE alert_id = ?;
    `),
    expireAlert: db.prepare(`
      UPDATE alerts
      SET
        job_run_id = ?,
        status = 'expired',
        resolved_at = ?,
        resolution_reason = ?,
        cooldown_until = ?
      WHERE alert_id = ?;
    `),
  };
}

function resolveSupplySnapshot(statements, assetId, scoreDate, preferredMarketSource) {
  const listingsNowRow = statements.getListingAtOrBeforeDate.get(
    assetId,
    scoreDate,
    preferredMarketSource
  );
  const listings7dRow = statements.getListingAtOrBeforeDate.get(
    assetId,
    shiftIsoDate(scoreDate, -7),
    preferredMarketSource
  );

  const listingsNow = toFiniteOrNull(listingsNowRow?.listings_count);
  const listings7d = toFiniteOrNull(listings7dRow?.listings_count);
  const supplyDelta7d =
    listingsNow !== null && listings7d !== null && listings7d > 0
      ? listingsNow / listings7d - 1
      : null;

  return {
    listingsNow,
    listings7d,
    supplyDelta7d,
    sourceMarketDate: listingsNowRow?.market_date || null,
  };
}

function isCooldownActive(cooldownUntil, nowMs) {
  const cooldownMs = parseTimestampMs(cooldownUntil);
  if (cooldownMs === null) {
    return false;
  }

  return cooldownMs > nowMs;
}

function resolveCooldownUntil(scoreDate, alertType) {
  const cooldownDays = ALERT_TYPE_COOLDOWN_DAYS[alertType] || 0;
  if (cooldownDays <= 0) {
    return null;
  }

  return shiftIsoDate(scoreDate, cooldownDays);
}

function resolveExpireMissedDays(alertType) {
  return ALERT_TYPE_EXPIRE_MISSED_DAYS[alertType] || 2;
}

function formatConsoleLine(alert) {
  return (
    `[${alert.severity}]` +
    `[${alert.alertType}]` +
    `[${alert.scope}] ` +
    `${alert.cardRef} conf=${alert.confidenceScore} prio=${alert.priorityScore} :: ` +
    `${alert.messageShort} | action=${alert.actionHint}`
  );
}

function maybeWriteTsv(outputPath, alerts) {
  if (!outputPath) {
    return null;
  }

  const absolutePath = path.resolve(outputPath);
  const lines = [
    [
      "severity",
      "alert_type",
      "scope",
      "card_ref",
      "confidence_score",
      "priority_score",
      "message_short",
      "action_hint",
      "reason_codes",
    ].join("\t"),
  ];

  for (const alert of alerts) {
    lines.push(
      [
        alert.severity,
        alert.alertType,
        alert.scope,
        alert.cardRef,
        String(alert.confidenceScore),
        String(alert.priorityScore),
        alert.messageShort,
        alert.actionHint,
        (alert.reasonCodes || []).join(","),
      ].join("\t")
    );
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${lines.join("\n")}\n`, "utf8");
  return absolutePath;
}

function runAlertsDaily(options = {}) {
  const scope = resolveScope(options.scope);
  const alertsConfig = resolveAlertsConfig(options);
  const { db, dbPath } = openDatabase({ dbPath: options.dbPath });
  const runRecordedAt = new Date().toISOString();
  const runId = `alerts:${runRecordedAt}`;

  try {
    const scoreDate = resolveScoreDate(db, options.scoreDate);
    const runLogicalTimestamp = `${scoreDate}T00:00:00.000Z`;
    const nowMs = parseTimestampMs(runLogicalTimestamp) || Date.now();

    const statements = createStatements(db);
    const scoreRows = loadScoreRows(db, scoreDate);
    const previousScoreRowsByAsset = loadPreviousScoreRowsByAsset(db, scoreDate);
    const activeAlertsByDedupe = loadActiveAlertsByDedupe(db);
    const latestAlertsByDedupe = loadLatestAlertsByDedupe(db);

    const summary = {
      scoreRowsRead: scoreRows.length,
      scoreRowsScoped: 0,
      candidates: 0,
      inserted: 0,
      updated: 0,
      skippedUnconfirmed: 0,
      skippedCooldown: 0,
      skippedDailyCap: 0,
      skippedLowConfidence: 0,
      expired: 0,
      scope,
    };

    const candidateByDedupe = new Map();
    for (const row of scoreRows) {
      const targetSource = normalizeString(row.target_source) || null;
      const resolvedScope = resolveScopeFromTargetSource(targetSource);
      if (scope !== "all" && resolvedScope !== scope) {
        continue;
      }
      summary.scoreRowsScoped += 1;

      const previousRow = previousScoreRowsByAsset.get(row.asset_id) || null;
      const stockRow = statements.getLatestStock.get(row.asset_id, scoreDate);
      const stockQty = toFiniteOrNull(stockRow?.quantity) || 0;
      const supplyNow = resolveSupplySnapshot(
        statements,
        row.asset_id,
        scoreDate,
        alertsConfig.preferredMarketSource
      );
      const supplyPrev = previousRow
        ? resolveSupplySnapshot(
            statements,
            row.asset_id,
            previousRow.score_date,
            alertsConfig.preferredMarketSource
          )
        : { supplyDelta7d: null };

      const context = {
        ...row,
        scope: resolvedScope,
        is_owned: resolvedScope === "owned",
        stock_qty: stockQty,
        stock_snapshot_at: stockRow?.snapshot_at || null,
        listings_now: supplyNow.listingsNow,
        listings_7d: supplyNow.listings7d,
        supply_delta_7d: supplyNow.supplyDelta7d,
        supply_delta_7d_prev: supplyPrev.supplyDelta7d,
        source_market_date: supplyNow.sourceMarketDate,
        prev: previousRow,
      };

      if ((toFiniteOrNull(context.confidence_score) || 0) < alertsConfig.minConfidenceGlobal) {
        summary.skippedLowConfidence += 1;
        continue;
      }

      const candidates = evaluateAlertRules(context, alertsConfig);
      summary.candidates += candidates.length;

      for (const candidate of candidates) {
        const dedupeKey = buildAlertDedupeKey(row.asset_id, candidate.alertType);
        const payload = {
          ...candidate,
          dedupeKey,
          assetId: row.asset_id,
          targetId: row.target_id,
          cardRef: row.card_ref,
          cardName: row.name,
        };

        const existingCandidate = candidateByDedupe.get(dedupeKey);
        if (!existingCandidate || payload.priorityScore > existingCandidate.priorityScore) {
          candidateByDedupe.set(dedupeKey, payload);
        }
      }
    }

    const allCandidates = Array.from(candidateByDedupe.values()).sort(
      (left, right) => right.priorityScore - left.priorityScore
    );
    const seenDedupeKeys = new Set();
    const outputRows = [];

    const pendingNew = [];
    for (const candidate of allCandidates) {
      const activeAlert = activeAlertsByDedupe.get(candidate.dedupeKey);
      if (activeAlert) {
        const seenToday = extractIsoDate(activeAlert.last_seen_at) === scoreDate;
        const nextOccurrence = seenToday
          ? Number(activeAlert.occurrence_count)
          : Number(activeAlert.occurrence_count) + 1;
        const nextStatus =
          activeAlert.status === "new" && nextOccurrence >= 2 ? "open" : activeAlert.status;

        statements.updateActiveAlert.run(
          runId,
          candidate.targetId,
          candidate.scope,
          candidate.severity,
          candidate.priorityScore,
          candidate.confidenceScore,
          nextStatus,
          candidate.title,
          candidate.messageShort,
          candidate.actionHint,
          toJsonString(candidate.reasonCodes, "[]"),
          toJsonString(candidate.metrics, "{}"),
          runLogicalTimestamp,
          resolveCooldownUntil(scoreDate, candidate.alertType),
          nextOccurrence,
          activeAlert.alert_id
        );

        seenDedupeKeys.add(candidate.dedupeKey);
        summary.updated += 1;
        outputRows.push(candidate);
        continue;
      }

      pendingNew.push(candidate);
    }

    let createdCount = 0;
    for (const candidate of pendingNew) {
      if (candidate.requiresConfirmation && !candidate.confirmed) {
        summary.skippedUnconfirmed += 1;
        continue;
      }

      const latestAlert = latestAlertsByDedupe.get(candidate.dedupeKey);
      if (latestAlert && isCooldownActive(latestAlert.cooldown_until, nowMs)) {
        summary.skippedCooldown += 1;
        continue;
      }

      if (createdCount >= alertsConfig.maxNewAlertsPerRun) {
        summary.skippedDailyCap += 1;
        continue;
      }

      statements.insertAlert.run(
        runId,
        candidate.assetId,
        candidate.targetId,
        candidate.alertType,
        candidate.scope,
        candidate.severity,
        candidate.priorityScore,
        candidate.confidenceScore,
        "new",
        candidate.title,
        candidate.messageShort,
        candidate.actionHint,
        toJsonString(candidate.reasonCodes, "[]"),
        toJsonString(candidate.metrics, "{}"),
        candidate.dedupeKey,
        runLogicalTimestamp,
        runLogicalTimestamp,
        runLogicalTimestamp,
        resolveCooldownUntil(scoreDate, candidate.alertType),
        1
      );

      seenDedupeKeys.add(candidate.dedupeKey);
      summary.inserted += 1;
      createdCount += 1;
      outputRows.push(candidate);
    }

    for (const [dedupeKey, activeAlert] of activeAlertsByDedupe.entries()) {
      if (seenDedupeKeys.has(dedupeKey)) {
        continue;
      }

      const daysWithoutSignal = diffDays(scoreDate, activeAlert.last_seen_at);
      const expireAfterDays = resolveExpireMissedDays(activeAlert.alert_type);
      if (daysWithoutSignal === null || daysWithoutSignal < expireAfterDays) {
        continue;
      }

      statements.expireAlert.run(
        runId,
        runLogicalTimestamp,
        "condition_not_met",
        resolveCooldownUntil(scoreDate, activeAlert.alert_type),
        activeAlert.alert_id
      );
      summary.expired += 1;
    }

    const outputAlerts = outputRows
      .sort((left, right) => right.priorityScore - left.priorityScore)
      .slice(0, alertsConfig.maxOutputAlerts);
    const tsvPath = maybeWriteTsv(options.outputTsvPath, outputAlerts);

    return {
      dbPath,
      scoreDate,
      runId,
      scope,
      summary,
      outputAlerts,
      tsvPath,
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

    if (arg.startsWith("--scope=")) {
      options.scope = arg.slice("--scope=".length);
      continue;
    }

    if (arg.startsWith("--max-new-alerts=")) {
      options.maxNewAlerts = parsePositiveInteger(
        arg.slice("--max-new-alerts=".length),
        "max-new-alerts"
      );
      continue;
    }

    if (arg.startsWith("--max-output=")) {
      options.maxOutputAlerts = parsePositiveInteger(
        arg.slice("--max-output=".length),
        "max-output"
      );
      continue;
    }

    if (arg.startsWith("--out-tsv=")) {
      options.outputTsvPath = arg.slice("--out-tsv=".length);
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
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const result = runAlertsDaily(options);

    console.log("Alerts daily completed:");
    console.log(`- score_date: ${result.scoreDate}`);
    console.log(`- scope: ${result.scope}`);
    console.log(`- score_rows_read: ${result.summary.scoreRowsRead}`);
    console.log(`- score_rows_scoped: ${result.summary.scoreRowsScoped}`);
    console.log(`- candidates: ${result.summary.candidates}`);
    console.log(`- inserted: ${result.summary.inserted}`);
    console.log(`- updated: ${result.summary.updated}`);
    console.log(`- skipped_low_confidence: ${result.summary.skippedLowConfidence}`);
    console.log(`- skipped_unconfirmed: ${result.summary.skippedUnconfirmed}`);
    console.log(`- skipped_cooldown: ${result.summary.skippedCooldown}`);
    console.log(`- skipped_daily_cap: ${result.summary.skippedDailyCap}`);
    console.log(`- expired: ${result.summary.expired}`);
    console.log(`- db: ${result.dbPath}`);
    if (result.tsvPath) {
      console.log(`- out_tsv: ${result.tsvPath}`);
    }

    if (result.outputAlerts.length === 0) {
      console.log("- alerts_output: empty");
    } else {
      console.log("- alerts_output:");
      for (const alert of result.outputAlerts) {
        console.log(`  - ${formatConsoleLine(alert)}`);
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  parseCliArgs,
  runAlertsDaily,
};
