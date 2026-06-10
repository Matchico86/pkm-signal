function parseSupabaseData(supabaseExport, cardKey) {
  if (!supabaseExport) return null;

  // 1. Format Live / API Supabase (venant de fetchPortalContextByCardId)
  if (supabaseExport.cote_history || supabaseExport.collection) {
    const c = supabaseExport.collection?.owners || {};
    const h = supabaseExport.cote_history || {};
    
    const ownersData = {};
    Object.keys(c).forEach(owner => {
      ownersData[owner] = {
        collection_owned: c[owner].owned || false,
        collection_best_condition: c[owner].best_condition || null,
        stock_quantity: c[owner].quantity || 0,
        invest_quantity: 0,
        sold_quantity_12m: 0,
        last_buy_price: null,
        average_buy_price: null,
        last_sell_price: null,
        average_sell_price: null
      };
    });

    return {
      owners: ownersData,
      global: {
        portal_cote: h.last_cote || null,
        portal_cote_updated_at: h.last_cote_updated_at || null
      }
    };
  }

  // 2. Format Mock / Legacy (objet d'objets `cards`)
  if (supabaseExport.cards) {
    const data = supabaseExport.cards[cardKey];
    if (!data) return null;
    
    return {
      owners: {
        mathieu: {
          collection_owned: data.m_owned || false,
          collection_best_condition: data.m_best_cond || null,
          stock_quantity: data.m_stock || 0,
          invest_quantity: data.m_invest || 0,
          sold_quantity_12m: data.m_sold_12m || 0,
          last_buy_price: data.m_last_buy || null,
          average_buy_price: data.m_avg_buy || null,
          last_sell_price: data.m_last_sell || null,
          average_sell_price: data.m_avg_sell || null
        },
        ewan: {
          collection_owned: data.e_owned || false,
          collection_best_condition: data.e_best_cond || null,
          stock_quantity: data.e_stock || 0,
          invest_quantity: data.e_invest || 0,
          sold_quantity_12m: data.e_sold_12m || 0,
          last_buy_price: data.e_last_buy || null,
          average_buy_price: data.e_avg_buy || null,
          last_sell_price: data.e_last_sell || null,
          average_sell_price: data.e_avg_sell || null
        }
      },
      global: {
        portal_cote: data.cote || null,
        portal_cote_updated_at: data.cote_date || null
      }
    };
  }

  return null;
}

module.exports = { parseSupabaseData };
