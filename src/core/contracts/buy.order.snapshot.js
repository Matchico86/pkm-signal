const { z } = require('zod');

const OwnerBreakdownSchema = z.record(z.string(), z.number());

const BuyOrderMetadataSchema = z.object({
  vendor: z.string().optional(),
  platform: z.string().optional(),
  total_cards: z.number().int().nonnegative().optional(),
  total_lines: z.number().int().nonnegative().optional(),
  total_buy_price: z.number(),
  fees_total: z.number().optional(),
  total_market_value: z.number().optional(),
  theoretical_margin: z.number().optional(),
  owner_breakdown: OwnerBreakdownSchema.optional()
});

const BuyItemSchema = z.object({
  line_id: z.string(),
  card_id: z.string().optional(),
  card_name: z.string(),
  set_id: z.string().optional(),
  set_name: z.string().optional(),
  number: z.string().optional(),
  language: z.string().optional(),
  condition: z.string().optional(),
  variant: z.string().optional(),
  owner: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  buy_price_unit: z.number(),
  buy_price_total: z.number().optional(),
  internal_market_price_unit: z.number(),
  internal_market_price_total: z.number().optional(),
  delta_unit: z.number().optional(),
  delta_total: z.number().optional()
});

const BuyOrderSnapshotSchema = z.object({
  view: z.literal('buy'),
  owner_scope: z.array(z.string()).optional(),
  order: BuyOrderMetadataSchema,
  items: z.array(BuyItemSchema)
});

/**
 * Valide un payload JSON par rapport au schéma BuyOrderSnapshot (V1.1 QG).
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
