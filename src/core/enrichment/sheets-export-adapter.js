function parseSheetsData(sheetsExport, cardKey) {
  if (!sheetsExport) return null;
  
  // Si format legacy mock (objet indexé)
  if (sheetsExport.cards && sheetsExport.cards[cardKey]) {
    const data = sheetsExport.cards[cardKey];
    return {
      owners: {
        mathieu: {
          collection_owned: data.mathieu_owned || false,
          collection_best_condition: data.mathieu_condition || null,
          stock_quantity: data.mathieu_stock || 0,
          invest_quantity: data.mathieu_invest || 0,
          sold_quantity_12m: data.mathieu_sold || 0,
          last_buy_price: data.mathieu_last_buy || null,
          average_buy_price: data.mathieu_avg_buy || null,
          last_sell_price: data.mathieu_last_sell || null,
          average_sell_price: data.mathieu_avg_sell || null
        },
        ewan: {
          collection_owned: data.ewan_owned || false,
          collection_best_condition: data.ewan_condition || null,
          stock_quantity: data.ewan_stock || 0,
          invest_quantity: data.ewan_invest || 0,
          sold_quantity_12m: data.ewan_sold || 0,
          last_buy_price: data.ewan_last_buy || null,
          average_buy_price: data.ewan_avg_buy || null,
          last_sell_price: data.ewan_last_sell || null,
          average_sell_price: data.ewan_avg_sell || null
        }
      },
      global: {
        portal_cote: data.portal_cote || null,
        portal_cote_updated_at: data.portal_cote_date || null
      },
      warnings: []
    };
  }

  const parseNum = val => val ? Number(val) : 0;
  const isTrue = val => String(val).toUpperCase() === 'VRAI' || String(val).toUpperCase() === 'TRUE' || val === true || val === 1;

  // Si format "Bundle" (API Google Apps Script v1)
  if (sheetsExport.data && sheetsExport.data.STOCK) {
    const d = sheetsExport.data;
    const stockRows = d.STOCK.rows || [];
    const purchRows = d.PURCH_ITEMS.rows || [];
    const investRows = d.INVEST_ITEMS.rows || [];
    const salesRows = d.SALES_ITEMS.rows || [];

    const normCardKey = cardKey.toLowerCase();
    const isTarget = r => r.CARD_ID && r.CARD_ID.toLowerCase() === normCardKey;

    const stockData = stockRows.find(isTarget);
    if (!stockData) return null; // Si la carte n'est pas dans le stock/catalogue, pas de données fiables

    const investData = investRows.find(isTarget);
    const cardPurchases = purchRows.filter(isTarget);
    const cardSales = salesRows.filter(isTarget);

    const warnings = [];

    // Helper functions for collection logic
    const getCollectionBestCondition = (owner) => {
      const conditionRank = { "MT": 10, "NM": 9, "EX": 8, "GD": 7, "LP": 6, "PL": 5, "PO": 4 };
      const getRank = (c) => conditionRank[c] || 0;
      
      const collLines = cardPurchases.filter(r => r.Owner === owner && parseNum(r.Qty_collec) > 0);
      if (collLines.length === 0) return null;
      return collLines.map(r => r.State).sort((a, b) => getRank(b) - getRank(a))[0] || null;
    };

    const hasCollection = (owner) => cardPurchases.some(r => r.Owner === owner && parseNum(r.Qty_collec) > 0);
    const getAvgBuyPrice = (owner) => {
      const lines = cardPurchases.filter(r => r.Owner === owner);
      if (lines.length === 0) return null;
      const totalCost = lines.reduce((acc, r) => acc + (parseNum(r.P_net_unit) * parseNum(r.P_quantity)), 0);
      const totalQty = lines.reduce((acc, r) => acc + parseNum(r.P_quantity), 0);
      return totalQty > 0 ? totalCost / totalQty : null;
    };
    
    const getLastBuyPrice = (owner) => {
      const lines = cardPurchases.filter(r => r.Owner === owner).sort((a, b) => new Date(b.P_date) - new Date(a.P_date));
      return lines.length > 0 ? parseNum(lines[0].P_net_unit) : null;
    };

    const getSold12m = (owner) => {
      // Pour l'instant on fait juste la somme globale (pas de filtre 12m exact sans P_date précis)
      return cardSales.filter(r => r.Owner === owner).reduce((acc, r) => acc + parseNum(r.S_quantity), 0);
    };

    // Global properties
    let portal_cote = parseNum(stockData.Last_cote);
    let portal_cote_updated_at = stockData.Last_cote_date || null;

    if (!portal_cote && investData && parseNum(investData.Last_cote) > 0) {
      portal_cote = parseNum(investData.Last_cote);
      portal_cote_updated_at = investData.Last_cote_date || null;
      warnings.push("portal_cote: using INVEST_ITEMS fallback");
    } else if (portal_cote && investData && parseNum(investData.Last_cote) > 0) {
      const investCote = parseNum(investData.Last_cote);
      if (Math.abs(portal_cote - investCote) / portal_cote > 0.1) {
        warnings.push("conflict_cotes: STOCK and INVEST_ITEMS diverge significantly");
      }
      // Simple logic check for newer date could be implemented here if dates were standard ISO
    }

    return {
      owners: {
        mathieu: {
          collection_owned: hasCollection("MAT"),
          collection_best_condition: getCollectionBestCondition("MAT"),
          stock_quantity: parseNum(stockData.Qty_Mathieu),
          invest_quantity: investData ? parseNum(investData.I_Qty_Mathieu) : 0,
          sold_quantity_12m: getSold12m("MAT"),
          last_buy_price: getLastBuyPrice("MAT"),
          average_buy_price: getAvgBuyPrice("MAT"),
          last_sell_price: null, // Hard to reliably extract from aggregated sales without date sort
          average_sell_price: null
        },
        ewan: {
          collection_owned: hasCollection("EWA"),
          collection_best_condition: getCollectionBestCondition("EWA"),
          stock_quantity: parseNum(stockData.Qty_Ewan),
          invest_quantity: investData ? parseNum(investData.I_Qty_Ewan) : 0,
          sold_quantity_12m: getSold12m("EWA"),
          last_buy_price: getLastBuyPrice("EWA"),
          average_buy_price: getAvgBuyPrice("EWA"),
          last_sell_price: null,
          average_sell_price: null
        }
      },
      global: {
        portal_cote: portal_cote || null,
        portal_cote_updated_at: portal_cote_updated_at
      },
      warnings
    };
  }

  // Si vrai export sheets PLAT legacy (tableau d'objets)
  const rows = Array.isArray(sheetsExport) ? sheetsExport : (sheetsExport.data || []);
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const row = rows.find(r => r.CARD_ID && r.CARD_ID.toLowerCase() === cardKey.toLowerCase());
  if (!row) return null;

  return {
    owners: {
      mathieu: {
        collection_owned: isTrue(row.Collection_Mathieu),
        collection_best_condition: row.Etat_Mathieu || null,
        stock_quantity: parseNum(row.Stock_Mathieu),
        invest_quantity: parseNum(row.Invest_Mathieu),
        sold_quantity_12m: parseNum(row.Sold_Mathieu),
        last_buy_price: parseNum(row.Last_Buy_Price_Mathieu) || null,
        average_buy_price: parseNum(row.Avg_Buy_Price_Mathieu) || null,
        last_sell_price: parseNum(row.Last_Sell_Price_Mathieu) || null,
        average_sell_price: parseNum(row.Avg_Sell_Price_Mathieu) || null
      },
      ewan: {
        collection_owned: isTrue(row.Collection_Ewan),
        collection_best_condition: row.Etat_Ewan || null,
        stock_quantity: parseNum(row.Stock_Ewan),
        invest_quantity: parseNum(row.Invest_Ewan),
        sold_quantity_12m: parseNum(row.Sold_Ewan),
        last_buy_price: parseNum(row.Last_Buy_Price_Ewan) || null,
        average_buy_price: parseNum(row.Avg_Buy_Price_Ewan) || null,
        last_sell_price: parseNum(row.Last_Sell_Price_Ewan) || null,
        average_sell_price: parseNum(row.Avg_Sell_Price_Ewan) || null
      }
    },
    global: {
      portal_cote: parseNum(row.Portal_Cote) || null,
      portal_cote_updated_at: row.Portal_Cote_Date || null
    },
    warnings: []
  };
}

module.exports = { parseSheetsData };
