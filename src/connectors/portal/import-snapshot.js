const crypto = require("node:crypto");
const { openDatabase } = require("../../db/client");
const { readPortalSnapshotSource } = require("./snapshot-source");
const { ValidationError, parsePayloadJson, validatePortalSnapshot } = require("./snapshot-validate");
const { persistPortalSnapshotRun } = require("./snapshot-store");

function computePayloadHash(payloadText) {
  return crypto.createHash("sha256").update(payloadText, "utf8").digest("hex");
}

function parseBooleanFlagValue(rawValue, optionName) {
  if (rawValue === "1" || rawValue === "true") {
    return true;
  }

  if (rawValue === "0" || rawValue === "false") {
    return false;
  }

  throw new Error(`Invalid value for ${optionName}: ${rawValue}. Expected true|false|1|0.`);
}

async function importPortalSnapshot(options = {}) {
  const sourcePayload = await readPortalSnapshotSource(options);
  const payloadHash = computePayloadHash(sourcePayload.payloadText);
  const snapshotPayload = parsePayloadJson(
    sourcePayload.payloadText,
    sourcePayload.payloadOrigin
  );
  const normalizedSnapshot = validatePortalSnapshot(snapshotPayload);

  const { db, dbPath } = openDatabase({ dbPath: options.dbPath });
  try {
    const persistedRun = persistPortalSnapshotRun(db, {
      normalizedSnapshot,
      payloadText: sourcePayload.payloadText,
      payloadHash,
      payloadOrigin: sourcePayload.payloadOrigin,
      allowDuplicate: Boolean(options.allowDuplicate),
      storeRawPayload: options.storeRawPayload !== false,
    });

    return {
      ...persistedRun,
      dbPath,
      payloadOrigin: sourcePayload.payloadOrigin,
      payloadHash,
      schemaVersion: normalizedSnapshot.schemaVersion,
      exportedAt: normalizedSnapshot.exportedAt,
      sourceName: normalizedSnapshot.sourceName,
    };
  } finally {
    db.close();
  }
}

function parseCliArgs(argv) {
  const options = {};

  for (const arg of argv) {
    if (arg.startsWith("--file=")) {
      options.filePath = arg.slice("--file=".length);
      continue;
    }

    if (arg.startsWith("--url=")) {
      options.url = arg.slice("--url=".length);
      continue;
    }

    if (arg.startsWith("--db=")) {
      options.dbPath = arg.slice("--db=".length);
      continue;
    }

    if (arg === "--allow-duplicate") {
      options.allowDuplicate = true;
      continue;
    }

    if (arg.startsWith("--store-raw=")) {
      options.storeRawPayload = parseBooleanFlagValue(
        arg.slice("--store-raw=".length),
        "--store-raw"
      );
      continue;
    }

    if (arg.startsWith("--token=")) {
      options.token = arg.slice("--token=".length);
      continue;
    }

    if (arg.startsWith("--fetch-timeout-ms=")) {
      const value = Number(arg.slice("--fetch-timeout-ms=".length));
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid value for --fetch-timeout-ms: ${arg}`);
      }
      options.fetchTimeoutMs = value;
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

  if (options.filePath && options.url) {
    throw new Error("Use either --file or --url, not both.");
  }

  return options;
}

function printWarningSummary(warnings) {
  if (!warnings || warnings.length === 0) {
    console.log("- warnings: 0");
    return;
  }

  console.log(`- warnings: ${warnings.length} grouped`);
  for (const warning of warnings) {
    console.log(
      `  - [${warning.code}] block=${warning.block} count=${warning.count} message=${warning.message}`
    );
    if (warning.samples.length > 0) {
      console.log(`    samples: ${warning.samples.join(" | ")}`);
    }
  }
}

if (require.main === module) {
  (async () => {
    try {
      const options = parseCliArgs(process.argv.slice(2));
      const result = await importPortalSnapshot(options);

      console.log("Portal snapshot import completed:");
      console.log(`- status: ${result.status}`);
      console.log(`- run_id: ${result.runId}`);
      if (result.duplicateOfRunId) {
        console.log(`- duplicate_of_run_id: ${result.duplicateOfRunId}`);
      }
      console.log(`- source: ${result.sourceName}`);
      console.log(`- schema_version: ${result.schemaVersion}`);
      console.log(`- exported_at: ${result.exportedAt}`);
      console.log(`- payload_origin: ${result.payloadOrigin}`);
      console.log(`- payload_hash: ${result.payloadHash}`);
      console.log(`- db: ${result.dbPath}`);

      console.log("- summary:");
      for (const [blockName, stats] of Object.entries(result.summary.blocks)) {
        console.log(
          `  - ${blockName}: read=${stats.rows_read}, valid=${stats.rows_valid}, invalid=${stats.rows_invalid}`
        );
      }
      console.log(
        `  - totals: read=${result.summary.totals.rows_read}, valid=${result.summary.totals.rows_valid}, invalid=${result.summary.totals.rows_invalid}`
      );

      printWarningSummary(result.warnings);
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(`Validation error: ${error.message}`);
      } else {
        console.error(error.message);
      }
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  computePayloadHash,
  importPortalSnapshot,
  parseCliArgs,
};
