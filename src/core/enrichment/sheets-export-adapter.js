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
      }
    };
  }

  // Si vrai export sheets (tableau d'objets)
  const rows = Array.isArray(sheetsExport) ? sheetsExport : (sheetsExport.data || []);
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const row = rows.find(r => r.CARD_ID && r.CARD_ID.toLowerCase() === cardKey.toLowerCase());
  if (!row) return null;

  const isTrue = val => String(val).toUpperCase() === 'VRAI' || String(val).toUpperCase() === 'TRUE' || val === true || val === 1;
  const parseNum = val => val ? Number(val) : 0;

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
    }
  };
}

module.exports = { parseSheetsData };
