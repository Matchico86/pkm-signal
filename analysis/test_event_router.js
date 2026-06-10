require('dotenv').config();
const { processBuyEvent } = require('../src/jobs/process-buy-event');
const { processBuySnapshot } = require('../src/jobs/process-buy-snapshot');

const sessionId = "mock-session-event-router";

// Mock des anciens événements (fallback)
const mockFullSnapshot = require('../src/core/contracts/buy.order.mock.json');

// 1. Evénement Valide (upsert_line avec card_id valide)
const eventUpsertValid = {
  event_type: "upsert_line",
  draft_order_id: "order_123",
  item: {
    line_id: "line_101",
    card_id: "card_valid_001",
    condition: "NM"
  }
};

// 2. Evénement Invalide (upsert_line sans card_id)
const eventUpsertInvalid = {
  event_type: "upsert_line",
  draft_order_id: "order_123",
  item: {
    line_id: "line_102"
    // pas de card_id
  }
};

const eventUpsertUndefinedString = {
  event_type: "upsert_line",
  draft_order_id: "order_123",
  item: {
    line_id: "line_103",
    card_id: "undefined"
  }
};

// 3. Evénement remove_line
const eventRemoveLine = {
  event_type: "remove_line",
  draft_order_id: "order_123",
  line_id: "line_101"
};

// 4. Evénement update_order
const eventUpdateOrder = {
  event_type: "update_order",
  draft_order_id: "order_123",
  payload: {
    total_buy_price: 150
  }
};

async function runTests() {
  console.log("=== TESTS EVENT ROUTER ===");

  console.log("\n>>> Test 1: upsert_line valide");
  await processBuyEvent(eventUpsertValid, sessionId);

  console.log("\n>>> Test 2: upsert_line invalide (sans card_id)");
  await processBuyEvent(eventUpsertInvalid, sessionId);

  console.log("\n>>> Test 3: upsert_line invalide (card_id='undefined')");
  await processBuyEvent(eventUpsertUndefinedString, sessionId);

  console.log("\n>>> Test 4: remove_line");
  await processBuyEvent(eventRemoveLine, sessionId);

  console.log("\n>>> Test 5: update_order");
  await processBuyEvent(eventUpdateOrder, sessionId);

  console.log("\n>>> Test 6: Fallback Ancien Snapshot (passe par l'ancien Zod)");
  // Simulation de la condition "else" du worker
  await processBuySnapshot(mockFullSnapshot, sessionId);

  console.log("\n=== FIN DES TESTS ===");
}

runTests().catch(console.error);
