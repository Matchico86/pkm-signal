const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PORTAL_SNAPSHOT_PATH = path.resolve(
  __dirname,
  "../../../data/export/portal-snapshot.json"
);

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

function normalizeString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

function resolvePayloadSource(options = {}) {
  const url = normalizeString(options.url || process.env.PKM_PORTAL_SNAPSHOT_URL);
  const filePath = path.resolve(
    options.filePath ||
      process.env.PKM_PORTAL_SNAPSHOT_FILE ||
      DEFAULT_PORTAL_SNAPSHOT_PATH
  );

  return {
    url,
    filePath,
  };
}

function readSnapshotFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Portal snapshot file not found: ${filePath}`);
  }

  return {
    payloadText: fs.readFileSync(filePath, "utf8"),
    payloadOrigin: filePath,
    transport: "file",
  };
}

async function fetchSnapshotFromUrl(url, options = {}) {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available in this Node runtime.");
  }

  const timeoutMs = Number(options.fetchTimeoutMs) || DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    Accept: "application/json",
  };

  const explicitToken = normalizeString(options.token || process.env.PKM_PORTAL_SNAPSHOT_TOKEN);
  if (explicitToken) {
    headers.Authorization = `Bearer ${explicitToken}`;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Portal snapshot fetch failed (${response.status} ${response.statusText}): ${responseText.slice(
          0,
          300
        )}`
      );
    }

    return {
      payloadText: responseText,
      payloadOrigin: url,
      transport: "url",
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Portal snapshot fetch timed out after ${timeoutMs}ms: ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readPortalSnapshotSource(options = {}) {
  const source = resolvePayloadSource(options);
  if (source.url) {
    return fetchSnapshotFromUrl(source.url, options);
  }

  return readSnapshotFromFile(source.filePath);
}

module.exports = {
  DEFAULT_PORTAL_SNAPSHOT_PATH,
  readPortalSnapshotSource,
  resolvePayloadSource,
};
