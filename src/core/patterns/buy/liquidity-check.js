/**
 * Vérifie si l'article acheté a une faible vélocité de vente (risque d'invendu).
 *
 * @param {object} snapshot - Le payload validé `buy.order.snapshot`.
 * @returns {Array<object>} Une liste de signaux générés.
 */
function checkLiquidity(snapshot) {
  const signals = [];
  const MIN_SALES_VELOCITY = 1.0; // Par exemple, moins de 1 vente par mois = illiquide

  snapshot.items.forEach(item => {
    if (item.sales_velocity !== undefined) {
      if (item.sales_velocity < MIN_SALES_VELOCITY) {
        signals.push({
          type: 'risk_illiquid',
          level: 'warning',
          message: `Attention : Liquidité très faible sur ${item.card_name} (Vélocité: ${item.sales_velocity}). Risque d'invendu.`,
          context: {
            draft_order_id: snapshot.draft_order_id,
            draft_item_id: item.draft_item_id,
            card_name: item.card_name,
            sales_velocity: item.sales_velocity
          }
        });
      }
    }
  });

  return signals;
}

module.exports = { checkLiquidity };
