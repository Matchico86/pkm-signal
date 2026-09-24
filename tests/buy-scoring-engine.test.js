const { analyzeOrder } = require('../src/core/scoring/buy-scoring-engine');

const fakeSnapshot = {
  order: {
    total_buy_price: 150.00,
    fees_total: 5.00,
    theoretical_margin: 30.00
  }
};

const testCases = [
  // Cas 1 : Très Chère + Très Ancienne => verify_before_buy (High risk)
  {
    line_id: "test-1",
    card_name: "Dracaufeu Gold",
    buy_price_unit: 60.00,
    internal_market_price_unit: 65.00,
    condition: "NM",
    internal_data: {
      enrichment_status: 'complete',
      quote_age_days: 35,
      current_stock: 0,
      sales_velocity: 2.0,
      mathieu_collection: { owned: true, best_state: "NM" },
      ewan_collection: { owned: true, best_state: "NM" }
    }
  },
  // Cas 2 : Chère seule => buy (Badge carte chère)
  {
    line_id: "test-2",
    card_name: "Mew Gold",
    buy_price_unit: 40.00,
    internal_market_price_unit: 45.00,
    condition: "EX",
    internal_data: {
      enrichment_status: 'complete',
      quote_age_days: 5, // Pas ancienne
      current_stock: 0,
      sales_velocity: 1.5,
      mathieu_collection: { owned: true, best_state: "PL" },
      ewan_collection: { owned: true, best_state: "PL" }
    }
  },
  // Cas 3 : Ancienne seule => buy (Badge cote ancienne)
  {
    line_id: "test-3",
    card_name: "Pikachu Promo",
    buy_price_unit: 10.00, // Pas chère
    internal_market_price_unit: 12.00,
    condition: "EX",
    internal_data: {
      enrichment_status: 'complete',
      quote_age_days: 20,
      current_stock: 0,
      sales_velocity: 1.0,
      mathieu_collection: { owned: true, best_state: "PL" },
      ewan_collection: { owned: true, best_state: "PL" }
    }
  },
  // Cas 4 : Manque collection => decision: buy, reason: missing_collection
  {
    line_id: "test-4",
    card_name: "Chenipan",
    buy_price_unit: 2.00,
    internal_market_price_unit: 2.00,
    condition: "NM",
    internal_data: {
      enrichment_status: 'complete',
      quote_age_days: 5,
      current_stock: 0,
      sales_velocity: 0.1, 
      mathieu_collection: { owned: false }, // Manque Mathieu
      ewan_collection: { owned: true, best_state: "NM" }
    }
  },
  // Cas 5 : Données Inconnues + Forte Décote => buy_more (fallback rule)
  {
    line_id: "test-5",
    card_name: "Lugias",
    buy_price_unit: 20.00,
    internal_market_price_unit: 40.00, // décote de 50%
    condition: "NM",
    internal_data: {
      enrichment_status: 'missing'
    }
  }
];

function runTests() {
  console.log("=== Lancement des tests Scoring V1.1 (Corrections QG) ===\n");
  const result = analyzeOrder(fakeSnapshot, testCases);

  console.log("Résumé global de la commande :");
  console.log(JSON.stringify(result.summary, null, 2));
  console.log("\nDétail par item :");

  result.items.forEach((item, index) => {
    console.log(`\n[Test ${index + 1}] ${testCases[index].card_name}`);
    console.log(`Décision : ${item.decision}`);
    console.log(`Raison Principale : ${item.primary_reason}`);
    console.log(`Message : ${item.message}`);
    console.log(`Badges : ${item.badges.join(', ')}`);
    console.log(`Debug : ${item.debug_reasons.join(', ')}`);
    console.log(`Risk : ${item.risk_level}`);
    
    // Assertions
    let passed = false;
    if (index === 0 && item.decision === 'verify_before_buy' && item.risk_level === 'high') passed = true;
    if (index === 1 && item.decision === 'buy' && item.badges.includes('Carte chère') && !item.badges.includes('Cote ancienne')) passed = true;
    if (index === 2 && item.decision === 'buy' && item.badges.includes('Cote ancienne') && !item.badges.includes('Carte chère')) passed = true;
    if (index === 3 && item.decision === 'buy' && item.primary_reason === 'missing_collection') passed = true;
    if (index === 4 && item.decision === 'buy_more' && item.debug_reasons.includes('missing_enrichment_data') && item.debug_reasons.includes('fallback_discount_rule')) passed = true;

    if (passed) {
      console.log('✅ TEST PASSED');
    } else {
      console.log('❌ TEST FAILED');
    }
  });
}

runTests();
