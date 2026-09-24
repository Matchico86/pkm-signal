const assert = require('assert');
const { buildBuyAnalysisPayload, getConditionRank, isHighRarity, getDaysDifference } = require('../src/core/enrichment/buy-analysis-meta');

console.log("=== Lancement des tests Contrat Méta Buy Analysis ===\n");

const REFERENCE_DATE = "2026-09-11T12:00:00Z";

// -------------------------------------------------------------
// Test 1 : Cotation & Fraîcheur (Règle A)
// -------------------------------------------------------------
console.log("--- Test 1 : Cotation & Fraîcheur ---");
{
  // 1.1 Cote fraîche (3 jours <= 7j)
  const factsFresh = {
    card_id: "swsh7-215",
    cote: {
      last_value: 45.0,
      updated_at: "2026-09-08",
      source: "cardmarket"
    }
  };
  const resFresh = buildBuyAnalysisPayload(factsFresh, { card_id: "swsh7-215" }, { referenceDate: REFERENCE_DATE });
  assert.strictEqual(resFresh.quote.value, 45.0, "1.1 Value doit être 45.0");
  assert.strictEqual(resFresh.quote.is_fresh, true, "1.1 Cote de 3 jours doit être fresh");
  assert.strictEqual(resFresh.quote.is_reliable, true, "1.1 Cote CardMarket > 0 doit être reliable");
  assert.strictEqual(resFresh.quote.needs_recot, false, "1.1 Cote fraîche ne nécessite pas de recot");
  console.log("  ✅ 1.1 Cote fraîche (<= 7j) validée.");

  // 1.2 Cote périmée (15 jours > 7j)
  const factsStale = {
    card_id: "swsh7-215",
    cote: {
      last_value: 45.0,
      updated_at: "2026-08-27",
      source: "cardmarket"
    }
  };
  const resStale = buildBuyAnalysisPayload(factsStale, { card_id: "swsh7-215" }, { referenceDate: REFERENCE_DATE });
  assert.strictEqual(resStale.quote.is_fresh, false, "1.2 Cote de 15 jours ne doit pas être fresh");
  assert.strictEqual(resStale.quote.needs_recot, true, "1.2 Cote périmée nécessite une recot");
  console.log("  ✅ 1.2 Cote périmée (> 7j) validée.");

  // 1.3 Cote absente
  const factsMissing = { card_id: "swsh7-215", cote: {} };
  const resMissing = buildBuyAnalysisPayload(factsMissing, { card_id: "swsh7-215" }, { referenceDate: REFERENCE_DATE });
  assert.strictEqual(resMissing.quote.value, null, "1.3 Value doit être null");
  assert.strictEqual(resMissing.quote.is_fresh, false, "1.3 Cote absente n'est pas fresh");
  assert.strictEqual(resMissing.quote.needs_recot, true, "1.3 Cote absente nécessite une recot");
  console.log("  ✅ 1.3 Cote absente validée.");
}

// -------------------------------------------------------------
// Test 2 : Intention de recherche (Favoris & Complétion) (Règle B)
// -------------------------------------------------------------
console.log("\n--- Test 2 : Intention de recherche ---");
{
  const factsWanted = {
    card_id: "swsh7-215",
    favorite_owners: ["mathieu"],
    set_progress: {
      leo: { percent: 24.5, set_id: "swsh7" },
      ewan: { percent: 10.0, set_id: "swsh7" } // < 15% ne doit pas déclencher set_completion
    }
  };
  const resWanted = buildBuyAnalysisPayload(factsWanted, { card_id: "swsh7-215", set_id: "swsh7" }, { referenceDate: REFERENCE_DATE });
  
  assert.strictEqual(resWanted.search_intent.is_wanted, true, "2.1 is_wanted doit être true");
  assert.strictEqual(resWanted.search_intent.targets.length, 2, "2.1 Doit avoir 2 cibles d'intention");
  
  const favTarget = resWanted.search_intent.targets.find(t => t.owner === "mathieu");
  assert.ok(favTarget, "2.1 Target Mathieu favorite doit exister");
  assert.strictEqual(favTarget.reason, "favorite");

  const setTarget = resWanted.search_intent.targets.find(t => t.owner === "leo");
  assert.ok(setTarget, "2.1 Target Léo set_completion doit exister");
  assert.strictEqual(setTarget.reason, "set_completion");
  assert.strictEqual(setTarget.set_id, "swsh7");
  assert.strictEqual(setTarget.progress_pct, 24.5);

  const ewanTarget = resWanted.search_intent.targets.find(t => t.owner === "ewan");
  assert.strictEqual(ewanTarget, undefined, "2.1 Ewan < 15% ne doit pas être ciblé");
  console.log("  ✅ 2.1 Intention favori + complétion de série (>= 15%) validée.");
}

// -------------------------------------------------------------
// Test 3 : Collection & Missing For (Règle C)
// -------------------------------------------------------------
console.log("\n--- Test 3 : Collection & Missing For ---");
{
  // Cas 3.1 : Progression < 15% sans favori -> non manquant (aucun besoin réel)
  const factsBelow15 = {
    card_id: "swsh7-215",
    collection: {
      mathieu: { owned: true, best_condition: "EX" },
      ewan: { owned: false },
      leo: { owned: false }
    },
    set_progress: {
      ewan: { owned: 5, total: 200, percent: 2.5 },
      leo: { owned: 12, total: 200, percent: 6.0 }
    }
  };
  const resBelow15 = buildBuyAnalysisPayload(factsBelow15, { card_id: "swsh7-215" }, {
    referenceDate: REFERENCE_DATE,
    activeOwners: ["mathieu", "ewan", "leo"]
  });

  assert.strictEqual(resBelow15.collection.owned, true, "3.1 owned doit être true");
  assert.deepStrictEqual(resBelow15.collection.owners, ["mathieu"], "3.1 owners doit être ['mathieu']");
  assert.deepStrictEqual(resBelow15.collection.missing_for, [], "3.1 missing_for doit être vide car < 15% et pas de favori");

  // Cas 3.2 : Ewan >= 15% et Léo en favori -> manquants pour Ewan et Léo
  const factsEligible = {
    card_id: "swsh7-215",
    collection: {
      mathieu: { owned: true, best_condition: "EX" },
      ewan: { owned: false },
      leo: { owned: false }
    },
    favorite_owners: ["leo"],
    set_progress: {
      ewan: { owned: 40, total: 200, percent: 20.0 }
    }
  };
  const resEligible = buildBuyAnalysisPayload(factsEligible, { card_id: "swsh7-215" }, {
    referenceDate: REFERENCE_DATE,
    activeOwners: ["mathieu", "ewan", "leo"]
  });

  assert.deepStrictEqual(resEligible.collection.missing_for.sort(), ["ewan", "leo"].sort(), "3.2 missing_for doit contenir ewan (>=15%) et leo (favori)");
  console.log("  ✅ 3.1 Collection possédée et manquant filtré strictement (>= 15% ou favori) validés.");
}

// -------------------------------------------------------------
// Test 4 : Opportunité d'Upgrade d'État (Règle D)
// -------------------------------------------------------------
console.log("\n--- Test 4 : Opportunité d'Upgrade d'État ---");
{
  const factsUpgrade = {
    card_id: "swsh7-215",
    collection: {
      mathieu: { owned: true, best_condition: "EX" }
    }
  };

  // Entrante en NM (strictement supérieur à EX)
  const resUpgrade = buildBuyAnalysisPayload(factsUpgrade, { card_id: "swsh7-215", condition: "NM" }, { referenceDate: REFERENCE_DATE });
  assert.strictEqual(resUpgrade.upgrade.is_upgrade, true, "4.1 EX -> NM doit être un upgrade");
  assert.strictEqual(resUpgrade.upgrade.targets.length, 1);
  assert.strictEqual(resUpgrade.upgrade.targets[0].owner, "mathieu");
  assert.strictEqual(resUpgrade.upgrade.targets[0].current_condition, "EX");
  assert.strictEqual(resUpgrade.upgrade.targets[0].incoming_condition, "NM");
  console.log("  ✅ 4.1 Détection d'upgrade EX -> NM validée.");

  // Entrante en EX (identique -> pas d'upgrade)
  const resNoUpgrade = buildBuyAnalysisPayload(factsUpgrade, { card_id: "swsh7-215", condition: "EX" }, { referenceDate: REFERENCE_DATE });
  assert.strictEqual(resNoUpgrade.upgrade.is_upgrade, false, "4.2 EX -> EX ne doit pas être un upgrade");
  assert.strictEqual(resNoUpgrade.upgrade.targets.length, 0);
  console.log("  ✅ 4.2 Non-upgrade sur état identique validé.");
}

// -------------------------------------------------------------
// Test 5 : Vélocité de Vente & Rotation en Stock (Règle C/E)
// -------------------------------------------------------------
console.log("\n--- Test 5 : Vélocité de Vente & Rotation en Stock ---");
{
  // Carte en stock depuis 90 jours (> 60j) sans aucune vente
  const factsSlow = {
    card_id: "swsh7-215",
    total_stock: 1,
    oldest_stock_date: "2026-06-01", // ~102 jours
    sales: {
      sold_quantity_12m: 0,
      last_sold_date: null
    }
  };
  const resSlow = buildBuyAnalysisPayload(factsSlow, { card_id: "swsh7-215" }, { referenceDate: REFERENCE_DATE });
  assert.strictEqual(resSlow.sales_velocity.is_hard_to_sell, true, "5.1 Stock > 60j sans vente doit lever is_hard_to_sell");
  assert.strictEqual(resSlow.sales_velocity.sold_count_12m, 0);
  console.log("  ✅ 5.1 Détection is_hard_to_sell (rotation lente) validée.");

  // Carte avec ventes récentes
  const factsFluid = {
    card_id: "swsh7-215",
    total_stock: 1,
    oldest_stock_date: "2026-06-01",
    sales: {
      sold_quantity_12m: 3,
      last_sold_date: "2026-08-15"
    }
  };
  const resFluid = buildBuyAnalysisPayload(factsFluid, { card_id: "swsh7-215" }, { referenceDate: REFERENCE_DATE });
  assert.strictEqual(resFluid.sales_velocity.is_hard_to_sell, false, "5.2 Carte avec vente récente ne doit pas être hard_to_sell");
  assert.strictEqual(resFluid.sales_velocity.sold_count_12m, 3);
  assert.strictEqual(resFluid.sales_velocity.last_sold_date, "2026-08-15");
  console.log("  ✅ 5.2 Vélocité normale avec vente récente validée.");

  // 5.3 Carte vendue mais sans date précise connue -> pas de rotation lente injustifiée
  const factsSalesNoDate = {
    card_id: "swsh7-215",
    total_stock: 1,
    oldest_stock_date: "2026-06-01",
    sales: {
      sold_quantity_12m: 5,
      last_sold_date: null
    }
  };
  const resSalesNoDate = buildBuyAnalysisPayload(factsSalesNoDate, { card_id: "swsh7-215" }, { referenceDate: REFERENCE_DATE });
  assert.strictEqual(resSalesNoDate.sales_velocity.is_hard_to_sell, false, "5.3 Ventes > 0 sans date ne doit pas être hard_to_sell");
  console.log("  ✅ 5.3 Pas de fausse rotation lente quand des ventes existent sans date.");
}

// -------------------------------------------------------------
// Test 6 : Indicateurs de Qualité & Investissement (Règle E)
// -------------------------------------------------------------
console.log("\n--- Test 6 : Qualité & Investissement ---");
{
  // 6.1 Condition NM + Rareté SAR + Cote 45€ (> 30€) => grading_potential = true
  const factsSAR = {
    card_id: "swsh7-215",
    rarity: "Special Art Rare",
    cote: { last_value: 45.0, updated_at: "2026-09-08", source: "cardmarket" }
  };
  const resSAR = buildBuyAnalysisPayload(factsSAR, { card_id: "swsh7-215", condition: "NM" }, { referenceDate: REFERENCE_DATE });
  assert.strictEqual(resSAR.investment.grading_potential, true, "6.1 NM + SAR + 45€ doit avoir grading_potential = true");
  assert.strictEqual(resSAR.investment.is_invest_candidate, true, "6.1 Doit être candidat invest");
  console.log("  ✅ 6.1 Grading potential validé sur NM + SAR + 45€.");

  // 6.2 Condition EX (< NM) => pas de grading potential
  const resEX = buildBuyAnalysisPayload(factsSAR, { card_id: "swsh7-215", condition: "EX" }, { referenceDate: REFERENCE_DATE });
  assert.strictEqual(resEX.investment.grading_potential, false, "6.2 EX ne doit pas avoir grading potential");
  console.log("  ✅ 6.2 Pas de grading potential sur EX validé.");

  // 6.3 Surstock commercial (stock >= 3 sans vente)
  const factsOverstock = {
    card_id: "swsh7-215",
    total_stock: 3,
    sales: { sold_quantity_12m: 0 }
  };
  const resOverstock = buildBuyAnalysisPayload(factsOverstock, { card_id: "swsh7-215" }, { referenceDate: REFERENCE_DATE });
  assert.strictEqual(resOverstock.stock_pressure.current_stock_total, 3);
  assert.strictEqual(resOverstock.stock_pressure.overstock_risk, true, "6.3 Stock >= 3 sans vente doit lever overstock_risk");
  console.log("  ✅ 6.3 Détection de risque de surstock validée.");

  // 6.4 Rareté ordinaire 'Rare' / 'Rare Holo' ne doit PAS être qualifies de high rarity (pas de faux positif via 'ar')
  assert.strictEqual(isHighRarity('Rare'), false, "6.4 Rare ne doit pas matcher isHighRarity");
  assert.strictEqual(isHighRarity('Rare Holo'), false, "6.4 Rare Holo ne doit pas matcher isHighRarity");
  assert.strictEqual(isHighRarity('Double Rare'), false, "6.4 Double Rare ne doit pas matcher isHighRarity");
  assert.strictEqual(isHighRarity('AR'), true, "6.4 AR doit matcher isHighRarity");
  assert.strictEqual(isHighRarity('Art Rare'), true, "6.4 Art Rare doit matcher isHighRarity");
  console.log("  ✅ 6.4 Rareté 'Rare' ordinaire correctement distinguée des High Rarities (AR/SAR).");
}

// -------------------------------------------------------------
// Test 7 : Robustesse Tolérance Prix = 0 € (Règle F)
// -------------------------------------------------------------
console.log("\n--- Test 7 : Tolérance Prix = 0 € ---");
{
  const factsZero = {
    card_id: "swsh7-215",
    cote: { last_value: 45.0, updated_at: "2026-09-08", source: "cardmarket" }
  };
  // Carte tout juste ajoutée sans saisie de prix financier
  const resZero = buildBuyAnalysisPayload(factsZero, { card_id: "swsh7-215", buy_price_unit: 0, condition: "NM" }, { referenceDate: REFERENCE_DATE });
  assert.strictEqual(typeof resZero, 'object', "7.1 Analyse exécutée avec succès");
  assert.strictEqual(resZero.quote.value, 45.0);
  console.log("  ✅ 7.1 Exécution robuste avec buy_price_unit = 0 sans division par zéro.");
}

// -------------------------------------------------------------
// Test 8 : Conformité Stricte au Schéma JSON Spécifié
// -------------------------------------------------------------
console.log("\n--- Test 8 : Conformité Stricte au Schéma JSON ---");
{
  const mockFacts = {
    card_id: "swsh7-215",
    cote: {
      last_value: 45.0,
      updated_at: "2026-09-08",
      source: "cardmarket"
    },
    favorite_owners: ["mathieu"],
    set_progress: {
      leo: { percent: 24.5, set_id: "swsh7" }
    },
    collection: {
      mathieu: { owned: true, best_condition: "EX" }
    },
    sales: {
      sold_quantity_12m: 3,
      last_sold_date: "2026-08-15"
    },
    total_stock: 1,
    rarity: "Special Art Rare"
  };

  const output = buildBuyAnalysisPayload(mockFacts, {
    card_id: "swsh7-215",
    condition: "NM",
    set_id: "swsh7",
    buy_price_unit: 25.0
  }, {
    referenceDate: REFERENCE_DATE,
    activeOwners: ["mathieu", "ewan", "leo"]
  });

  const expectedShape = {
    card_id: "swsh7-215",
    quote: {
      value: 45.0,
      date: "2026-09-08",
      is_fresh: true,
      is_reliable: true,
      needs_recot: false,
      recoted: false,
      recot_skip_reason: null
    },
    platforms: {},
    search_intent: {
      is_wanted: true,
      targets: [
        { owner: "mathieu", reason: "favorite" },
        { owner: "leo", reason: "set_completion", set_id: "swsh7", progress_pct: 24.5 }
      ]
    },
    collection: {
      owned: true,
      owners: ["mathieu"],
      missing_for: ["leo"]
    },
    upgrade: {
      is_upgrade: true,
      targets: [
        { owner: "mathieu", current_condition: "EX", incoming_condition: "NM" }
      ]
    },
    sales_velocity: {
      sold_count_12m: 3,
      is_hard_to_sell: false,
      last_sold_date: "2026-08-15"
    },
    investment: {
      is_invest_candidate: true,
      grading_potential: true
    },
    stock_pressure: {
      current_stock_total: 1,
      overstock_risk: false
    }
  };

  assert.deepStrictEqual(output, expectedShape, "8.1 Le payload produit doit être strictement identique au schéma attendu !");
  console.log("  ✅ 8.1 Correspondance 100% exacte avec le schéma JSON spécifié.");
}

console.log("\n🎉 TOUS LES TESTS DU CONTRAT MÉTA BUY ANALYSIS ONT RÉUSSI AVEC SUCCÈS !");
