/**
 * Mock Provider Déterministe pour la couche d'enrichissement Acheter.
 * NE DOIT JAMAIS simuler aléatoirement des données sur une commande réelle.
 * Limité à un usage strict pour les tests via les "line_id" de test,
 * ou renvoie "missing" pour les items réels en attendant la V2 (Supabase).
 */

async function enrichBuyItems(items) {
  // Simule une latence réseau
  await new Promise(resolve => setTimeout(resolve, 20));

  return items.map(item => {
    // ---- BASES DE TESTS DETERMINISTES ---- //
    
    // Test 1: Carte chère + Ancienne
    if (item.line_id === "test-1") {
      return {
        ...item,
        internal_data: {
          enrichment_status: 'complete',
          mathieu_collection: { owned: true, best_state: "NM" },
          ewan_collection: { owned: true, best_state: "NM" },
          current_stock: 0,
          quote_age_days: 40,
          sales_velocity: 2.0
        }
      };
    }
    
    // Test 2: Manque collection
    if (item.line_id === "test-2") {
      return {
        ...item,
        internal_data: {
          enrichment_status: 'complete',
          mathieu_collection: { owned: false },
          ewan_collection: { owned: true, best_state: "NM" },
          current_stock: 0,
          quote_age_days: 2,
          sales_velocity: 1.5
        }
      };
    }

    // Test 3: Déjà possédé meilleur état
    if (item.line_id === "test-3") {
      return {
        ...item,
        internal_data: {
          enrichment_status: 'complete',
          mathieu_collection: { owned: true, best_state: "NM" },
          ewan_collection: { owned: true, best_state: "PL" },
          current_stock: 0,
          quote_age_days: 5,
          sales_velocity: 1.0
        }
      };
    }

    // Test 4: Surstock + Illiquide
    if (item.line_id === "test-4") {
      return {
        ...item,
        internal_data: {
          enrichment_status: 'complete',
          mathieu_collection: { owned: true, best_state: "NM" },
          ewan_collection: { owned: true, best_state: "NM" },
          current_stock: 12,
          quote_age_days: 5,
          sales_velocity: 0.1
        }
      };
    }

    // Test 5: Opportunité forte décote
    if (item.line_id === "test-5") {
      return {
        ...item,
        internal_data: {
          enrichment_status: 'complete',
          mathieu_collection: { owned: true, best_state: "NM" },
          ewan_collection: { owned: true, best_state: "NM" },
          current_stock: 1,
          quote_age_days: 2,
          sales_velocity: 5.0
        }
      };
    }

    // Test 6: Données inconnues (Comportement en Production V1)
    return {
      ...item,
      internal_data: {
        enrichment_status: 'missing', // On ne simule rien
        mathieu_collection: null,
        ewan_collection: null,
        current_stock: null,
        quote_age_days: null,
        sales_velocity: null
      }
    };
  });
}

module.exports = {
  enrichBuyItems
};
