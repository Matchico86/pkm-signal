/**
 * Vérifie si le prix de vente d'un objet est significativement inférieur à la cote du marché.
 * Un signal est généré si le prix de vente est inférieur de 20% (ou plus) par rapport à la cote.
 *
 * @param {object} snapshot - Le payload validé `sell.order.snapshot`.
 * @returns {Array<object>} Une liste de signaux générés.
 */
function checkSellPrice(snapshot) {
  const signals = [];
  const MIN_PRICE_RATIO = 0.8; // Alerte si le prix de vente est inférieur à 80% de la cote

  snapshot.items.forEach(item => {
    if (item.quote_unit_price > 0) {
      const priceRatio = item.sell_unit_price / item.quote_unit_price;
      
      if (priceRatio < MIN_PRICE_RATIO) {
        const discountPct = (1 - priceRatio) * 100;
        signals.push({
          type: 'low_sell_price',
          level: 'warning',
          message: `Prix de vente bas sur ${item.card_name} : vendu à ${item.sell_unit_price}€, soit ${discountPct.toFixed(0)}% sous la cote de ${item.quote_unit_price}€`,
          context: {
            draft_order_id: snapshot.draft_order_id,
            draft_item_id: item.draft_item_id,
            card_name: item.card_name,
            sell_unit_price: item.sell_unit_price,
            quote_unit_price: item.quote_unit_price,
            discount_percentage: discountPct
          }
        });
      }
    }
  });

  return signals;
}

module.exports = {
  checkSellPrice
};
