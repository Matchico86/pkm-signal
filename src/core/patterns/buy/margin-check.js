/**
 * Vérifie si les marges théoriques d'une commande d'achat sont insuffisantes.
 * Un signal est généré si la marge d'un objet (delta_unit / buy_unit_price) 
 * ou la marge globale de la commande est inférieure au seuil défini.
 *
 * @param {object} snapshot - Le payload validé `buy.order.snapshot`.
 * @returns {Array<object>} Une liste de signaux générés.
 */
function checkMargin(snapshot) {
  const signals = [];
  const MIN_MARGIN_PCT = 10; // 10%

  // 1. Vérification sur la marge globale de la commande
  if (snapshot.total_net_price > 0) {
    const globalMarginPct = (snapshot.theoretical_margin / snapshot.total_net_price) * 100;
    if (globalMarginPct < MIN_MARGIN_PCT) {
      signals.push({
        type: 'low_global_margin',
        level: 'warning',
        message: `Marge globale théorique trop faible : ${globalMarginPct.toFixed(2)}% (attendu >= ${MIN_MARGIN_PCT}%)`,
        context: {
          draft_order_id: snapshot.draft_order_id,
          theoretical_margin: snapshot.theoretical_margin,
          total_net_price: snapshot.total_net_price
        }
      });
    }
  }

  // 2. Vérification sur la marge de chaque ligne
  snapshot.items.forEach(item => {
    if (item.buy_unit_price > 0) {
      const itemMarginPct = (item.delta_unit / item.buy_unit_price) * 100;
      if (itemMarginPct < MIN_MARGIN_PCT) {
        signals.push({
          type: 'low_item_margin',
          level: 'warning',
          message: `Marge théorique trop faible sur l'article ${item.card_name} : ${itemMarginPct.toFixed(2)}% (attendu >= ${MIN_MARGIN_PCT}%)`,
          context: {
            draft_order_id: snapshot.draft_order_id,
            draft_item_id: item.draft_item_id,
            card_name: item.card_name,
            buy_unit_price: item.buy_unit_price,
            delta_unit: item.delta_unit
          }
        });
      }
    }
  });

  return signals;
}

module.exports = {
  checkMargin
};
