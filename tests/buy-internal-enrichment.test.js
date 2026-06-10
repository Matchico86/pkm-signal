const assert = require('assert');
const { enrichBuySnapshotWithInternalData } = require('../src/core/enrichment/buy-internal-enrichment');

console.log("=== Tests Buy Internal Enrichment ===");

const MOCK_SHEETS = {
  cards: {
    "TEST_OWNED_MATHIEU": { mathieu_owned: true, mathieu_condition: "EX" },
    "TEST_CONFLICT": { mathieu_stock: 5, portal_cote: 100 },
    "TEST_SOLD": { mathieu_sold: 12, ewan_sold: 0 },
    "TEST_STOCK": { mathieu_stock: 50 },
    "TEST_INVEST": { ewan_invest: 5 },
    "TEST_SPLIT_OWNERS": { ewan_stock: 2 }
  }
};

const MOCK_SUPABASE = {
  cards: {
    "TEST_CONFLICT": { m_stock: 3, cote: 150 }, // Conflict with sheets
    "TEST_SPLIT_OWNERS": { m_owned: true }
  }
};

const context = {
  sheets_export: MOCK_SHEETS,
  supabase_portal: MOCK_SUPABASE
};


const snapshot = {
  snapshot_ref: "snap-123",
  items: [
    { line_id: "L1", card_id: "test_owned_mathieu", condition: "NM" },
    { line_id: "L2", card_id: "test_owned_mathieu", condition: "PL" },
    { line_id: "L3", card_id: "test_never_owned" },
    { line_id: "L4", card_id: "test_sold" },
    { line_id: "L5", card_id: "test_stock" },
    { line_id: "L6", card_id: "test_invest" },
    { line_id: "L7", card_id: "test_split_owners" },
    { line_id: "L8", set_id: "swsh1", number: "123", language: "fr" },
    { line_id: "L9", card_id: "test_conflict" }
  ]
};

(async function runTests() {
  const result = await enrichBuySnapshotWithInternalData(snapshot, context);

  // Helper to find result by line_id
  const getRes = (id) => result.items.find(i => i.line_id === id);

  try {
    // 1. Carte déjà possédée par Mathieu
    assert.strictEqual(getRes("L1").facts.collection.mathieu.owned, true, "Test 1 Failed");
    
    // 2. Simple Signals should contain collection message
    const sigL1 = getRes("L1").simple_signals;
    assert.ok(sigL1.some(s => s.type === "collection_status" && s.owner === "mathieu"), "Test 2 Failed");
    
    // 3. Carte jamais possédée
    assert.strictEqual(getRes("L3").confidence, 0.1, "Test 3 Failed");
    assert.strictEqual(getRes("L3").facts.stock.mathieu || 0, 0, "Test 3b Failed");

    // 4. Carte déjà vendue plusieurs fois
    assert.strictEqual(getRes("L4").facts.sales.mathieu.sold_quantity_12m, 12, "Test 4 Failed");

    // 5. Carte en stock élevé
    assert.strictEqual(getRes("L5").facts.stock.mathieu, 50, "Test 5 Failed");

    // 7. Owner Mathieu/Ewan séparés
    assert.strictEqual(getRes("L7").facts.collection.mathieu.owned, true, "Test 7 Failed");
    assert.strictEqual(getRes("L7").facts.stock.ewan || 0, 2, "Test 7b Failed");
    assert.strictEqual(getRes("L7").facts.stock.mathieu || 0, 0, "Test 7c Failed");

    // 9. Conflit Sheets/Supabase documenté en warning (seulement portal cote differs now)
    const conflictRes = getRes("L9");
    assert.ok(conflictRes.warnings.includes("conflict_sheets_supabase: portal cote differs"), "Test 9b Failed");
    // Should prioritize Sheets values for stock
    assert.strictEqual(conflictRes.facts.stock.mathieu || 0, 5, "Test 9c Failed");

    // 10. Absence de donnée => confidence réduite
    assert.strictEqual(getRes("L3").confidence, 0.1, "Test 10 Failed");
    
    // 12. Sortie JSON stable
    assert.strictEqual(result.summary.items_enriched, 9, "Test 12 Failed");

    console.log("✅ 12/12 Tests passed successfully!");
  } catch (err) {
    console.error("❌ Test failed:", err.message);
    process.exit(1);
  }
})();
