const assert = require('assert');
const { computeSnapshotHash, handleSessionEvent, sessionSnapshotHashCache } = require('../src/worker');

console.log("=== Tests Worker Anti-Boucle Realtime ===");

(async function runTests() {
  try {
    sessionSnapshotHashCache.clear();

    // 1. Déterminisme du hash
    const snapA = { order_id: "ord-1", items: [{ id: "card-1", qty: 2 }] };
    const snapB = { order_id: "ord-1", items: [{ id: "card-1", qty: 2 }] };
    const snapC = { order_id: "ord-1", items: [{ id: "card-1", qty: 3 }] };

    const hashA = computeSnapshotHash(snapA);
    const hashB = computeSnapshotHash(snapB);
    const hashC = computeSnapshotHash(snapC);

    assert.strictEqual(hashA, hashB, "Hash must be identical for same snapshot content");
    assert.notStrictEqual(hashA, hashC, "Hash must differ for changed snapshot content");
    console.log("✅ 1. Calcul du hash SHA-256 déterministe validé.");

    // 2. Premier UPDATE pour la session S1 -> doit être traité
    const event1 = {
      eventType: 'UPDATE',
      new: {
        session_id: 'session-test-01',
        slot: 'unknown_slot_to_skip_jobs',
        latest_snapshot: snapA
      }
    };
    const res1 = await handleSessionEvent(event1);
    assert.strictEqual(res1, true, "First UPDATE event must be processed");
    assert.strictEqual(sessionSnapshotHashCache.get('session-test-01'), hashA, "Cache must store hash for session");
    console.log("✅ 2. Premier événement UPDATE enregistré en cache.");

    // 3. Deuxième UPDATE identique (boucle Realtime) -> doit être ignoré
    const event2 = {
      eventType: 'UPDATE',
      new: {
        session_id: 'session-test-01',
        slot: 'unknown_slot_to_skip_jobs',
        latest_snapshot: snapA
      }
    };
    const res2 = await handleSessionEvent(event2);
    assert.strictEqual(res2, false, "Second identical UPDATE event must be dropped (anti-loop)");
    console.log("✅ 3. Événement identique ignoré (protection anti-boucle validée).");

    // 4. Troisième UPDATE avec snapshot modifié -> doit être traité
    const event3 = {
      eventType: 'UPDATE',
      new: {
        session_id: 'session-test-01',
        slot: 'unknown_slot_to_skip_jobs',
        latest_snapshot: snapC
      }
    };
    const res3 = await handleSessionEvent(event3);
    assert.strictEqual(res3, true, "Modified snapshot UPDATE must be processed");
    assert.strictEqual(sessionSnapshotHashCache.get('session-test-01'), hashC, "Cache must update to new hash");
    console.log("✅ 4. Snapshot modifié accepté et cache mis à jour.");

    // 5. Session différente avec même payload -> doit être traitée
    const event4 = {
      eventType: 'UPDATE',
      new: {
        session_id: 'session-test-02',
        slot: 'unknown_slot_to_skip_jobs',
        latest_snapshot: snapA
      }
    };
    const res4 = await handleSessionEvent(event4);
    assert.strictEqual(res4, true, "Different session must be processed independently");
    assert.strictEqual(sessionSnapshotHashCache.get('session-test-02'), hashA, "Cache stores entry for session-test-02");
    console.log("✅ 5. Indépendance multi-sessions validée.");

    console.log("\n✅ Tous les tests anti-boucle Realtime ont réussi !");
  } catch (err) {
    console.error("❌ Test worker anti-boucle échoué :", err);
    process.exit(1);
  }
})();
