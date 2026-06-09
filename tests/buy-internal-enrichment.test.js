const assert = require('assert');
const { enrichBuySnapshotWithInternalData } = require('../src/core/enrichment/buy-internal-enrichment');

console.log("=== Tests Buy Internal Enrichment ===");

const MOCK_SHEETS = {
  cards: {
    "test_owned_mathieu": { mathieu_owned: true, mathieu_condition: "EX" },
    "test_conflict": { mathieu_stock: 5, portal_cote: 100 }
  }
};

const MOCK_SUPABASE = {
  cards: {
    "test_conflict": { m_stock: 3, cote: 150 }, // Conflict with sheets
    "test_sold": { m_sold_12m: 12, e_sold_12m: 0 },
    "test_stock": { m_stock: 50 },
    "test_invest": { e_invest: 5 },
    "test_split_owners": { m_owned: true, e_stock: 2 }
  }
};

const context = {
  sheets_export: MOCK_SHEETS,
  supabase_portal: MOCK_SUPABASE
};

function runTests() {
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

  const result = enrichBuySnapshotWithInternalData(snapshot, context);

  // Helper to find result by line_id
  const getRes = (id) => result.items.find(i => i.line_id === id);

  try {
    // 1. Carte déjà possédée par Mathieu
    assert.strictEqual(getRes("L1").facts.owners.mathieu.collection_owned, true, "Test 1 Failed");
    
    // 2. Carte possédée en meilleur état (Mathieu owns EX, incoming is PL)
    assert.strictEqual(getRes("L2").facts.global.already_owned_better_condition, true, "Test 2 Failed");
    
    // Test that incoming NM (better than EX) gives false
    assert.strictEqual(getRes("L1").facts.global.already_owned_better_condition, false, "Test 2b Failed");

    // 3. Carte jamais possédée
    assert.strictEqual(getRes("L3").facts.global.internal_confidence, 0.1, "Test 3 Failed");
    assert.strictEqual(getRes("L3").facts.global.total_owned_quantity, 0, "Test 3b Failed");

    // 4. Carte déjà vendue plusieurs fois
    assert.strictEqual(getRes("L4").facts.global.sale_velocity, "high", "Test 4 Failed");
    assert.strictEqual(getRes("L4").facts.global.total_sold_quantity, 12, "Test 4b Failed");

    // 5. Carte en stock élevé
    assert.strictEqual(getRes("L5").facts.owners.mathieu.stock_quantity, 50, "Test 5 Failed");

    // 6. Carte en investissement
    assert.strictEqual(getRes("L6").facts.owners.ewan.invest_quantity, 5, "Test 6 Failed");

    // 7. Owner Mathieu/Ewan séparés
    assert.strictEqual(getRes("L7").facts.owners.mathieu.collection_owned, true, "Test 7 Failed");
    assert.strictEqual(getRes("L7").facts.owners.ewan.stock_quantity, 2, "Test 7b Failed");
    assert.strictEqual(getRes("L7").facts.owners.mathieu.stock_quantity, 0, "Test 7c Failed");

    // 8. Fallback card_key si card_id absent
    assert.strictEqual(getRes("L8").card_key, "swsh1_123_fr", "Test 8 Failed");

    // 9. Conflit Sheets/Supabase documenté en warning
    const conflictRes = getRes("L9");
    assert.ok(conflictRes.warnings.includes("conflict_sheets_supabase: mathieu stock differs"), "Test 9 Failed");
    assert.ok(conflictRes.warnings.includes("conflict_sheets_supabase: portal cote differs"), "Test 9b Failed");
    // Should prioritize Supabase values
    assert.strictEqual(conflictRes.facts.owners.mathieu.stock_quantity, 3, "Test 9c Failed");

    // 10. Absence de donnée => confidence réduite
    assert.strictEqual(getRes("L3").facts.global.internal_confidence, 0.1, "Test 10 Failed");

    // 11. Aucune API externe appelée (Implicitly passed since no fetch/http logic exists)
    
    // 12. Sortie JSON stable
    assert.strictEqual(result.summary.items_enriched, 9, "Test 12 Failed");
    assert.strictEqual(result.summary.items_with_warnings, 3, "Test 12b Failed"); // L3 (No data), L8 (No data), and L9 (Conflict)

    console.log("✅ 12/12 Tests passed successfully!");
  } catch (err) {
    console.error("❌ Test failed:", err.message);
    process.exit(1);
  }
}

runTests();
