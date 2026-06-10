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

    const normCardKey = cardKey.toUpperCase();
    const isTarget = r => r.CARD_ID && r.CARD_ID.toUpperCase() === normCardKey;

    const stockData = stockRows.find(isTarget);
    if (!stockData) return null;

    const investData = investRows.find(isTarget);
    const cardPurchases = purchRows.filter(isTarget);
    const cardSales = salesRows.filter(isTarget);

    const warnings = [];
    const ownersData = {};

    const getOwnerKey = (rawName) => {
      const low = rawName.toLowerCase();
      if (low === 'mat' || low === 'mathieu') return 'mathieu';
      if (low === 'ewa' || low === 'ewan') return 'ewan';
      return low; // fallback if other owners exist
    };

    const initOwner = () => ({
      collection_owned: false,
      collection_best_condition: null,
      stock_quantity: 0,
      invest_quantity: 0,
      sold_quantity_12m: 0,
      last_buy_price: null,
      average_buy_price: null,
      last_sell_price: null,
      average_sell_price: null
    });

    // Parse Stock
    Object.keys(stockData).forEach(k => {
      if (k.startsWith('Qty_') && k !== 'Qty_collec') {
        const owner = getOwnerKey(k.substring(4));
        if (!ownersData[owner]) ownersData[owner] = initOwner();
        ownersData[owner].stock_quantity = parseNum(stockData[k]);
      }
    });

    // Parse Invest
    if (investData) {
      Object.keys(investData).forEach(k => {
        if (k.startsWith('I_Qty_')) {
          const owner = getOwnerKey(k.substring(6));
          if (!ownersData[owner]) ownersData[owner] = initOwner();
          ownersData[owner].invest_quantity = parseNum(investData[k]);
        }
      });
    }

    // Parse Purchases & Collection
    const purchOwners = [...new Set(cardPurchases.map(r => r.Owner).filter(Boolean))];
    purchOwners.forEach(o => {
      const owner = getOwnerKey(o);
      if (!ownersData[owner]) ownersData[owner] = initOwner();
      
      const collLines = cardPurchases.filter(r => r.Owner === o && parseNum(r.Qty_collec) > 0);
      if (collLines.length > 0) {
        ownersData[owner].collection_owned = true;
        const conditionRank = { "MT": 10, "NM": 9, "EX": 8, "GD": 7, "LP": 6, "PL": 5, "PO": 4 };
        const getRank = (c) => conditionRank[c] || 0;
        ownersData[owner].collection_best_condition = collLines.map(r => r.State).sort((a, b) => getRank(b) - getRank(a))[0] || null;
      }

      const allLines = cardPurchases.filter(r => r.Owner === o);
      if (allLines.length > 0) {
        const totalCost = allLines.reduce((acc, r) => acc + (parseNum(r.P_net_unit) * parseNum(r.P_quantity)), 0);
        const totalQty = allLines.reduce((acc, r) => acc + parseNum(r.P_quantity), 0);
        ownersData[owner].average_buy_price = totalQty > 0 ? totalCost / totalQty : null;

        const sortedLines = [...allLines].sort((a, b) => new Date(b.P_date) - new Date(a.P_date));
        ownersData[owner].last_buy_price = parseNum(sortedLines[0].P_net_unit);
      }
    });

    // Parse Sales
    const salesOwners = [...new Set(cardSales.map(r => r.Owner).filter(Boolean))];
    salesOwners.forEach(o => {
      const owner = getOwnerKey(o);
      if (!ownersData[owner]) ownersData[owner] = initOwner();
      ownersData[owner].sold_quantity_12m = cardSales.filter(r => r.Owner === o).reduce((acc, r) => acc + parseNum(r.S_quantity), 0);
    });

    // Global properties
    let portal_cote = parseNum(stockData.Last_cote);
    let portal_cote_updated_at = stockData.Last_cote_date || null;

    if (!portal_cote && investData && parseNum(investData.Last_cote) > 0) {
      portal_cote = parseNum(investData.Last_cote);
      portal_cote_updated_at = investData.Last_cote_date || null;
      warnings.push("portal_cote: using INVEST_ITEMS fallback");
    }

    return {
      owners: ownersData,
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

  const row = rows.find(r => r.CARD_ID && r.CARD_ID.toUpperCase() === cardKey.toUpperCase());
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
