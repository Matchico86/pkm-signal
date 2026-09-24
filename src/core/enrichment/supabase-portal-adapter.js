function parseSupabaseData(supabaseExport, cardKey) {
  if (!supabaseExport) return null;

  // 1. Format Live / API Supabase (venant de fetchPortalContextByCardId)
  if (supabaseExport.cote_history || supabaseExport.collection || supabaseExport.stock || supabaseExport.purchases_and_sales) {
    const c = supabaseExport.collection?.owners || {};
    const s = supabaseExport.stock?.owners || {};
    const p = supabaseExport.purchases_and_sales?.purchases?.owners || {};
    const sa = supabaseExport.purchases_and_sales?.sales?.owners || {};
    const h = supabaseExport.cote_history || {};
    
    const allOwners = new Set([
      ...Object.keys(c),
      ...Object.keys(s),
      ...Object.keys(p),
      ...Object.keys(sa),
      'mathieu', 'ewan', 'leo'
    ]);

    const ownersData = {};
    allOwners.forEach(owner => {
      const colO = c[owner] || {};
      const stO = s[owner] || {};
      const puO = p[owner] || {};
      const saO = sa[owner] || {};

      ownersData[owner] = {
        collection_owned: colO.owned || false,
        collection_best_condition: colO.best_condition || null,
        stock_quantity: stO.stock_quantity !== undefined ? stO.stock_quantity : (stO.quantity !== undefined ? stO.quantity : 0),
        invest_quantity: 0,
        sold_quantity_12m: saO.sold_quantity_12m || 0,
        last_buy_price: puO.last_buy_price !== undefined ? puO.last_buy_price : null,
        average_buy_price: puO.average_buy_price !== undefined ? puO.average_buy_price : null,
        last_sell_price: saO.last_sell_price !== undefined ? saO.last_sell_price : null,
        average_sell_price: saO.average_sell_price !== undefined ? saO.average_sell_price : null
      };
      
      if (supabaseExport.set_progress && supabaseExport.set_progress[owner]) {
        ownersData[owner].set_progress = supabaseExport.set_progress[owner];
      }
    });

    return {
      owners: ownersData,
      global: {
        portal_cote: h.last_cote || null,
        portal_cote_updated_at: h.last_cote_updated_at || null,
        portal_cote_source: (h.points && h.points[0]?.source) || "cardmarket"
      },
      stock: supabaseExport.stock || null,
      sales: supabaseExport.purchases_and_sales?.sales || null,
      favorites: supabaseExport.favorites || null,
      favorite_owners: supabaseExport.favorite_owners || [],
      card_info: supabaseExport.card_info || null,
      rarity: supabaseExport.rarity || null,
      active_owners: supabaseExport.active_owners || ['mathieu', 'ewan', 'leo'],
      set_progress: supabaseExport.set_progress || {},
      warnings: []
    };
  }

  // 2. Format Mock / Legacy (objet d'objets `cards`)
  if (supabaseExport.cards) {
    const data = supabaseExport.cards[cardKey];
    if (!data) return null;
    
    return {
      owners: {
        mathieu: {
          collection_owned: (data.m_owned !== undefined ? data.m_owned : data.mathieu_owned) || false,
          collection_best_condition: data.m_best_cond || data.mathieu_condition || null,
          stock_quantity: (data.m_stock !== undefined ? data.m_stock : data.mathieu_stock) || 0,
          invest_quantity: (data.m_invest !== undefined ? data.m_invest : data.mathieu_invest) || 0,
          sold_quantity_12m: (data.m_sold_12m !== undefined ? data.m_sold_12m : data.mathieu_sold) || 0,
          last_buy_price: (data.m_last_buy !== undefined ? data.m_last_buy : data.mathieu_last_buy) || null,
          average_buy_price: (data.m_avg_buy !== undefined ? data.m_avg_buy : data.mathieu_avg_buy) || null,
          last_sell_price: (data.m_last_sell !== undefined ? data.m_last_sell : data.mathieu_last_sell) || null,
          average_sell_price: (data.m_avg_sell !== undefined ? data.m_avg_sell : data.mathieu_avg_sell) || null
        },
        ewan: {
          collection_owned: (data.e_owned !== undefined ? data.e_owned : data.ewan_owned) || false,
          collection_best_condition: data.e_best_cond || data.ewan_condition || null,
          stock_quantity: (data.e_stock !== undefined ? data.e_stock : data.ewan_stock) || 0,
          invest_quantity: (data.e_invest !== undefined ? data.e_invest : data.ewan_invest) || 0,
          sold_quantity_12m: (data.e_sold_12m !== undefined ? data.e_sold_12m : data.ewan_sold) || 0,
          last_buy_price: (data.e_last_buy !== undefined ? data.e_last_buy : data.ewan_last_buy) || null,
          average_buy_price: (data.e_avg_buy !== undefined ? data.e_avg_buy : data.ewan_avg_buy) || null,
          last_sell_price: (data.e_last_sell !== undefined ? data.e_last_sell : data.ewan_last_sell) || null,
          average_sell_price: (data.e_avg_sell !== undefined ? data.e_avg_sell : data.ewan_avg_sell) || null
        }
      },
      global: {
        portal_cote: data.cote !== undefined ? data.cote : (data.portal_cote || null),
        portal_cote_updated_at: data.cote_date || data.portal_cote_date || null
      },
      warnings: []
    };
  }

  return null;
}

module.exports = { parseSupabaseData };
