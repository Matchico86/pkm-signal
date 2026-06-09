/**
 * Vérifie si le prix d'achat présente une forte décote par rapport au prix marché (Opportunité).
 *
 * @param {object} snapshot - Le payload validé `buy.order.snapshot`.
 * @returns {Array<object>} Une liste de signaux générés.
 */
function checkOpportunity(snapshot) {
  const signals = [];
  const MIN_DISCOUNT_PCT = 30; // 30% de décote requise pour être une opportunité

  snapshot.items.forEach(item => {
    if (item.quote_unit_price > 0 && item.buy_unit_price > 0) {
      const discountPct = ((item.quote_unit_price - item.buy_unit_price) / item.quote_unit_price) * 100;
      
      if (discountPct >= MIN_DISCOUNT_PCT) {
        signals.push({
          type: 'opportunity_high_discount',
          level: 'info',
          message: `Opportunité ! Décote importante sur ${item.card_name} : ${discountPct.toFixed(1)}% moins cher que la cote (${item.buy_unit_price} vs ${item.quote_unit_price}).`,
          context: {
            draft_order_id: snapshot.draft_order_id,
            draft_item_id: item.draft_item_id,
            card_name: item.card_name,
            buy_unit_price: item.buy_unit_price,
            quote_unit_price: item.quote_unit_price,
            discount_pct: discountPct
          }
        });
      }
    }
  });

  return signals;
}

module.exports = { checkOpportunity };
