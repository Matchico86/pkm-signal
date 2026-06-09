const fs = require('fs');
const path = require('path');
const { validateSellOrderSnapshot } = require('../core/contracts/sell.order.snapshot');
const { checkSellPrice } = require('../core/patterns/sell/price-check');
const { checkStockShortage } = require('../core/patterns/sell/stock-check');
const { writeAssistantResults } = require('../connectors/supabase-writer');

/**
 * Traite un payload de type sell.order.snapshot :
 * 1. Validation Zod du contrat de données.
 * 2. Exécution des patterns métier (règles de gestion).
 * 3. Génération et affichage des signaux.
 * 
 * @param {string} payloadPath - Chemin vers le fichier JSON contenant le snapshot.
 */
async function processSellSnapshot(input) {
  console.log(`[Job] Démarrage du traitement de la vente...`);

  // 1. Lecture ou récupération des données
  let rawData;
  if (typeof input === 'string') {
    try {
      const fileContent = fs.readFileSync(path.resolve(__dirname, input), 'utf-8');
      rawData = JSON.parse(fileContent);
    } catch (error) {
      console.error(`[Erreur] Impossible de lire ou parser le fichier JSON :`, error.message);
      process.exit(1);
    }
  } else {
    rawData = input;
  }

  // 2. Validation Zod
  let validatedSnapshot;
  try {
    validatedSnapshot = validateSellOrderSnapshot(rawData);
    console.log(`[Contrat] Payload valide selon le schéma "sell.order.snapshot".`);
  } catch (error) {
    console.error(`[Erreur de Validation] Le payload ne respecte pas le contrat :`);
    console.error(error.errors);
    if (typeof input === 'string') process.exit(1);
    return; // Stop processing but don't crash worker
  }

  // 3. Exécution des patterns
  console.log(`[Patterns] Exécution des règles métier...`);
  const allSignals = [];
  
  // Pattern 1: Vérification du prix de vente (trop bas)
  const priceSignals = checkSellPrice(validatedSnapshot);
  allSignals.push(...priceSignals);

  // Pattern 2: Vérification du stock (risque de rupture)
  const stockSignals = checkStockShortage(validatedSnapshot);
  allSignals.push(...stockSignals);

  // 4. Affichage des signaux
  console.log(`\n=== RÉSULTATS : SIGNAUX GÉNÉRÉS (${allSignals.length}) ===`);
  if (allSignals.length === 0) {
    console.log(`Aucun signal détecté. La vente semble optimale.`);
  } else {
    allSignals.forEach((signal, index) => {
      console.log(`\n[Signal #${index + 1}] - ${signal.type.toUpperCase()}`);
      console.log(`  Niveau  : ${signal.level}`);
      console.log(`  Message : ${signal.message}`);
      console.log(`  Contexte:`, signal.context);
    });
  }

  // 5. Enregistrement dans Supabase
  console.log(`\n[Supabase] Connexion et sauvegarde des résultats...`);
  const sessionInfo = {
    domain: 'sell',
    slot: 'validation',
    external_ref: validatedSnapshot.draft_order_id,
    snapshot: validatedSnapshot
  };
  
  await writeAssistantResults(sessionInfo, allSignals);

  console.log(`\n[Job] Terminé avec succès.`);
}

// Point d'entrée pour tester localement avec le mock
if (require.main === module) {
  const mockPath = '../core/contracts/sell.order.mock.json';
  processSellSnapshot(mockPath);
}

module.exports = {
  processSellSnapshot
};
