/**
 * Vérifie si l'achat risque de créer un sur-stockage.
 *
 * @param {object} snapshot - Le payload validé `buy.order.snapshot`.
 * @returns {Array<object>} Une liste de signaux générés.
 */
function checkStock(snapshot) {
  const signals = [];
  const MAX_STOCK_WARNING = 5; // Seuil d'alerte arbitraire pour l'exemple

  snapshot.items.forEach(item => {
    if (item.owned_quantity !== undefined) {
      const newTotal = item.owned_quantity + item.quantity;
      if (newTotal > MAX_STOCK_WARNING) {
        signals.push({
          type: 'risk_overstock',
          level: 'warning',
          message: `Risque de sur-stockage sur ${item.card_name}. Vous possédez déjà ${item.owned_quantity} ex. (Nouveau total: ${newTotal}).`,
          context: {
            draft_order_id: snapshot.draft_order_id,
            draft_item_id: item.draft_item_id,
            card_name: item.card_name,
            owned_quantity: item.owned_quantity,
            added_quantity: item.quantity,
            new_total: newTotal
          }
        });
      }
    }
  });

  return signals;
}

module.exports = { checkStock };
