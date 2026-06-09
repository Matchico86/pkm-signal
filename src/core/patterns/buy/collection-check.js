/**
 * Vérifie si l'article acheté est manquant dans la collection ou représente une amélioration (Upgrade).
 *
 * @param {object} snapshot - Le payload validé `buy.order.snapshot`.
 * @returns {Array<object>} Une liste de signaux générés.
 */
function checkCollection(snapshot) {
  const signals = [];

  snapshot.items.forEach(item => {
    if (item.collection_status === 'missing') {
      signals.push({
        type: 'collection_missing',
        level: 'info',
        message: `Carte manquante pour la collection : ${item.card_name} (${item.set_code} ${item.card_number}).`,
        context: {
          draft_order_id: snapshot.draft_order_id,
          draft_item_id: item.draft_item_id,
          card_name: item.card_name,
          owner_key: item.owner_key
        }
      });
    } else if (item.collection_status === 'upgrade') {
      signals.push({
        type: 'collection_upgrade',
        level: 'info',
        message: `Potentiel Upgrade de collection pour : ${item.card_name} (État: ${item.state_raw}).`,
        context: {
          draft_order_id: snapshot.draft_order_id,
          draft_item_id: item.draft_item_id,
          card_name: item.card_name,
          state_raw: item.state_raw,
          owner_key: item.owner_key
        }
      });
    }
  });

  return signals;
}

module.exports = { checkCollection };
