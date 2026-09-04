'use strict';

const { z } = require('zod');

const stockQuery = z.object({
  productId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(120).optional(),
  nonZero: z.enum(['true', 'false', '1', '0']).optional(),
  includeChildren: z.enum(['true', 'false', '1', '0']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const balanceParams = z.object({
  productId: z.coerce.number().int().positive(),
  locationId: z.coerce.number().int().positive(),
});

const movementQuery = z.object({
  productId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
  movementType: z
    .enum(['opening', 'receipt', 'delivery', 'transfer_in', 'transfer_out', 'adjustment', 'audit_adjustment'])
    .optional(),
  adjustmentId: z.coerce.number().int().positive().optional(),
  referenceType: z.string().trim().max(60).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

const line = z.object({
  productId: z.number().int().positive(),
  locationId: z.number().int().positive(),
  quantity: z.number().finite(),
});

/**
 * Sign convention (§7.1): the client always sends a positive magnitude except for
 * `adjustment`, which is explicitly signed. The service applies the ledger sign.
 */
const createMovementSchema = z
  .object({
    movementType: z.enum(['opening', 'receipt', 'delivery', 'adjustment']),
    lines: z.array(line).min(1).max(500),
    referenceType: z.string().trim().max(60).optional(),
    referenceId: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    value.lines.forEach((l, index) => {
      if (value.movementType === 'adjustment') {
        if (l.quantity === 0) {
          ctx.addIssue({ code: 'custom', path: ['lines', index, 'quantity'], message: 'Adjustment quantity cannot be zero' });
        }
      } else if (l.quantity <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'quantity'],
          message: `${value.movementType} quantity must be a positive magnitude`,
        });
      }
    });
  });

const createTransferSchema = z
  .object({
    productId: z.number().int().positive(),
    fromLocationId: z.number().int().positive(),
    toLocationId: z.number().int().positive(),
    quantity: z.number().positive(),
    referenceType: z.string().trim().max(60).optional(),
    referenceId: z.number().int().positive().optional(),
  })
  .refine((v) => v.fromLocationId !== v.toLocationId, {
    message: 'Source and destination locations must differ',
    path: ['toLocationId'],
  });

module.exports = {
  stockQuery,
  balanceParams,
  movementQuery,
  idParam,
  createMovementSchema,
  createTransferSchema,
};
