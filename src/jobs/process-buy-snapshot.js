const fs = require('fs');
const path = require('path');
const { validateBuyOrderSnapshot } = require('../core/contracts/buy.order.snapshot');
const { checkMargin } = require('../core/patterns/buy/margin-check');
const { checkOpportunity } = require('../core/patterns/buy/opportunity-check');
const { checkCollection } = require('../core/patterns/buy/collection-check');
const { checkStock } = require('../core/patterns/buy/stock-check');
const { checkLiquidity } = require('../core/patterns/buy/liquidity-check');
const { writeAssistantResults } = require('../connectors/supabase-writer');

/**
 * Traite un payload de type buy.order.snapshot :
 * 1. Validation Zod du contrat de données.
 * 2. Exécution des patterns métier (règles de gestion).
 * 3. Génération et affichage des signaux.
 * 
 * @param {string} payloadPath - Chemin vers le fichier JSON contenant le snapshot.
 */
async function processBuySnapshot(input, existingSessionId = null) {
  console.log(`[Job] Démarrage du traitement de l'achat...`);

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
    validatedSnapshot = validateBuyOrderSnapshot(rawData);
    console.log(`[Contrat] Payload valide selon le schéma "buy.order.snapshot".`);
  } catch (error) {
    console.error(`[Erreur de Validation] Le payload ne respecte pas le contrat :`);
    console.error(error.errors);
    if (typeof input === 'string') process.exit(1);
    return; // Stop processing but don't crash worker
  }

  // 3. Exécution des patterns
  console.log(`[Patterns] Exécution des règles métier...`);
  const allSignals = [];
  
  allSignals.push(...checkMargin(validatedSnapshot));
  allSignals.push(...checkOpportunity(validatedSnapshot));
  allSignals.push(...checkCollection(validatedSnapshot));
  allSignals.push(...checkStock(validatedSnapshot));
  allSignals.push(...checkLiquidity(validatedSnapshot));

  // 4. Affichage des signaux (Étape 1 avant envoi vers Supabase)
  console.log(`\n=== RÉSULTATS : SIGNAUX GÉNÉRÉS (${allSignals.length}) ===`);
  if (allSignals.length === 0) {
    console.log(`Aucun signal détecté. L'achat semble optimal.`);
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
    session_id: existingSessionId,
    domain: 'buy',
    slot: 'buy.order',
    external_ref: validatedSnapshot.draft_order_id,
    snapshot: validatedSnapshot
  };
  
  await writeAssistantResults(sessionInfo, allSignals);

  console.log(`\n[Job] Terminé avec succès.`);
}

// Point d'entrée pour tester localement avec le mock
if (require.main === module) {
  const mockPath = '../core/contracts/buy.order.mock.json';
  processBuySnapshot(mockPath);
}

module.exports = {
  processBuySnapshot
};
