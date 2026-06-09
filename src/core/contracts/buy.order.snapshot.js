const { z } = require('zod');

/**
 * Schéma Zod pour valider le payload "buy.order.snapshot" en provenance de Portal.
 */
const OwnerTotalSchema = z.object({
  owner_key: z.string(),
  total_net_price: z.number(),
  total_gross_price: z.number(),
  total_quote_price: z.number(),
  theoretical_margin: z.number()
});

const BuyItemSchema = z.object({
  draft_item_id: z.string(),
  owner_key: z.string().optional(),
  set_code: z.string().optional(),
  card_number: z.string().optional(),
  card_name: z.string(),
  quantity: z.number().int().positive().optional(),
  language: z.string().optional(),
  state_raw: z.string().optional(),
  variant: z.string().optional(),
  buy_unit_price: z.number(),
  quote_unit_price: z.number(),
  delta_unit: z.number().optional(),
  // Champs de contexte optionnels pour les nouveaux patterns
  owned_quantity: z.number().int().nonnegative().optional(),
  sales_velocity: z.number().nonnegative().optional(), // ex: nb ventes/mois
  collection_status: z.enum(['missing', 'upgrade', 'owned']).optional()
});

const BuyOrderSnapshotSchema = z.object({
  type: z.literal('buy.order.snapshot'),
  version: z.number().int().positive().optional(),
  draft_order_id: z.string(),
  platform: z.string().optional(),
  seller: z.string().optional(),
  
  line_count: z.number().int().nonnegative().optional(),
  total_quantity: z.number().int().nonnegative().optional(),
  
  total_net_price: z.number(),
  fees_total: z.number().optional(),
  total_gross_price: z.number().optional(),
  
  total_quote_price: z.number(),
  theoretical_margin: z.number(),
  
  owner_totals: z.array(OwnerTotalSchema).optional(),
  items: z.array(BuyItemSchema)
});

/**
 * Valide un payload JSON par rapport au schéma BuyOrderSnapshot.
 * @param {unknown} data - Le payload brut.
 * @returns {z.infer<typeof BuyOrderSnapshotSchema>} Le payload typé et validé.
 * @throws {z.ZodError} Si la validation échoue.
 */
function validateBuyOrderSnapshot(data) {
  return BuyOrderSnapshotSchema.parse(data);
}

module.exports = {
  BuyOrderSnapshotSchema,
  validateBuyOrderSnapshot
};
