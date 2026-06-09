const { z } = require('zod');

/**
 * Schéma Zod pour valider le payload "sell.order.snapshot" en provenance de Portal.
 */
const OwnerTotalSchema = z.object({
  owner_key: z.string(),
  total_net_price: z.number(),
  total_gross_price: z.number(),
  total_quote_price: z.number(),
  realized_margin: z.number() // ou theoretical_margin si la vente n'est pas finalisée
});

const SellItemSchema = z.object({
  draft_item_id: z.string(),
  owner_key: z.string(),
  set_code: z.string(),
  card_number: z.string(),
  card_name: z.string(),
  quantity: z.number().int().positive(),
  language: z.string(),
  state_raw: z.string(),
  variant: z.string(),
  sell_unit_price: z.number(),
  quote_unit_price: z.number(),
  delta_unit: z.number(),
  // Champs de contexte pour les patterns de vente
  owned_quantity: z.number().int().nonnegative().optional(),
  buy_unit_price: z.number().optional() // Prix d'achat initial pour calculer la vraie marge
});

const SellOrderSnapshotSchema = z.object({
  type: z.literal('sell.order.snapshot'),
  version: z.number().int().positive(),
  draft_order_id: z.string(),
  platform: z.string(),
  buyer: z.string(),
  
  line_count: z.number().int().nonnegative(),
  total_quantity: z.number().int().nonnegative(),
  
  total_net_price: z.number(),
  fees_total: z.number(),
  total_gross_price: z.number(),
  
  total_quote_price: z.number(),
  total_realized_margin: z.number(),
  
  owner_totals: z.array(OwnerTotalSchema),
  items: z.array(SellItemSchema)
});

/**
 * Valide un payload JSON par rapport au schéma SellOrderSnapshot.
 * @param {unknown} data - Le payload brut.
 * @returns {z.infer<typeof SellOrderSnapshotSchema>} Le payload typé et validé.
 * @throws {z.ZodError} Si la validation échoue.
 */
function validateSellOrderSnapshot(data) {
  return SellOrderSnapshotSchema.parse(data);
}

module.exports = {
  SellOrderSnapshotSchema,
  validateSellOrderSnapshot
};
