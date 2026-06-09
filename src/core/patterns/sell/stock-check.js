/**
 * Vérifie si la quantité vendue excède le stock disponible possédé.
 *
 * @param {object} snapshot - Le payload validé `sell.order.snapshot`.
 * @returns {Array<object>} Une liste de signaux générés.
 */
function checkStockShortage(snapshot) {
  const signals = [];

  snapshot.items.forEach(item => {
    if (item.owned_quantity !== undefined && item.quantity > item.owned_quantity) {
      signals.push({
        type: 'stock_shortage_risk',
        level: 'critical',
        message: `Risque de rupture sur ${item.card_name} : quantité vendue (${item.quantity}) supérieure au stock disponible (${item.owned_quantity})`,
        context: {
          draft_order_id: snapshot.draft_order_id,
          draft_item_id: item.draft_item_id,
          card_name: item.card_name,
          quantity_sold: item.quantity,
          owned_quantity: item.owned_quantity
        }
      });
    }
  });

  return signals;
}

module.exports = {
  checkStockShortage
};
