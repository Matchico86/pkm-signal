const fs = require('fs');
const path = require('path');
const { enrichBuySnapshotWithInternalData } = require('../src/core/enrichment/buy-internal-enrichment');

// 1. Load snapshot fixture
const fixturePath = path.join(__dirname, '../data/raw/portal-snapshot-test.json');
let snapshotRaw;
try {
  snapshotRaw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
} catch (err) {
  console.error("Failed to load fixture:", err.message);
  process.exit(1);
}

// 2. Extract items
const items = (snapshotRaw.purchase_items || []).map((p, index) => ({
  line_id: p.P_ITEM_ID || `line-${index}`,
  card_id: p.CARD_ID,
  condition: p.Condition || "NM",
  name: p.Name || "Unknown",
  price: p.P_price_item
}));

// Add a dummy item without card_id to test fallback key generation
items.push({
  line_id: "line-fallback",
  set_id: "sv4",
  number: "123",
  language: "fr"
});

// Add a dummy item with missing data in mocks to test confidence drop
items.push({
  line_id: "line-missing",
  card_id: "unknown-card-999"
});

const snapshot = {
  snapshot_ref: (snapshotRaw.meta?.env || "test") + "-" + (snapshotRaw.exported_at || Date.now()),
  items
};

// 3. Mocks for internal sources
const mockSheets = {
  cards: {
    "sv4-001": { mathieu_owned: true, mathieu_condition: "EX", mathieu_stock: 1, ewan_stock: 0 },
    "sv4_123_fr": { mathieu_owned: false, ewan_owned: true, ewan_condition: "NM" },
    "sv4-002": { mathieu_stock: 0, portal_cote: 1400 } // from sales_items
  }
};

const mockSupabase = {
  cards: {
    // Conflict on stock with sheets, to trigger warning
    "sv4-001": { m_stock: 2, m_sold_12m: 5, e_sold_12m: 0, cote: 1500 },
    "sv4_123_fr": { e_stock: 1, e_invest: 2, m_owned: false },
    "sv4-002": { m_stock: 0, e_sold_12m: 1 }
  }
};

// Enable disabling sources for test
const disableSheets = process.argv.includes('--no-sheets');
const disableSupabase = process.argv.includes('--no-supabase');

const context = {
  sheets_export: disableSheets ? null : mockSheets,
  supabase_portal: disableSupabase ? null : mockSupabase
};

// 4. Run enrichment
const startTime = Date.now();
const result = enrichBuySnapshotWithInternalData(snapshot, context);
const duration = Date.now() - startTime;

// 5. Construct required stable JSON output
const probeOutput = {
  snapshot_ref: result.snapshot_ref,
  sources_loaded: result.summary.sources_used,
  source_modes: {
    sheets_export: context.sheets_export ? "mock" : "missing",
    supabase_portal: context.supabase_portal ? "mock" : "missing"
  },
  summary: {
    items_total: items.length,
    items_enriched: result.summary.items_enriched,
    items_with_warnings: result.summary.items_with_warnings,
    confidence_average: Number((result.items.reduce((acc, item) => acc + item.internal_context.global.internal_confidence, 0) / result.items.length).toFixed(2))
  },
  duration_ms: duration,
  details: result.items.map(item => ({
    line_id: item.line_id,
    card_key: item.card_key,
    input_card_id: item.input.card_id || "missing",
    fields_retrieved: [
      "owners.mathieu.stock_quantity",
      "global.portal_cote",
      "global.sale_velocity"
      // Simplification for the probe output display
    ],
    fields_missing: item.internal_context.global.internal_confidence < 1.0 ? ["some_internal_data"] : [],
    owners: item.internal_context.owners,
    global: item.internal_context.global,
    warnings: item.warnings
  }))
};

console.log(JSON.stringify(probeOutput, null, 2));
