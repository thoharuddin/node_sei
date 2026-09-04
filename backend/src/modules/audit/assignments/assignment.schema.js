'use strict';

const { z } = require('zod');

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  status: z.enum(['pending', 'in_progress', 'done', 'cancelled']).optional(),
  assignmentType: z.enum(['product', 'location']).optional(),
  assignedUserId: z.coerce.number().int().positive().optional(),
  programId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const ids = z.array(z.number().int().positive()).max(500);

/**
 * §10: the type decides which target list is required. The database CHECK constraint
 * enforces the same rule; this gives a 400 with a readable message first.
 */
const createSchema = z
  .object({
    assignedUserIds: z.array(z.number().int().positive()).min(1).max(50),
    assignmentType: z.enum(['product', 'location']),
    productIds: ids.optional(),
    locationIds: ids.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    const products = v.productIds ?? [];
    const locations = v.locationIds ?? [];
    if (v.assignmentType === 'product') {
      if (products.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['productIds'], message: 'A product assignment requires at least one product' });
      }
      if (locations.length > 0) {
        ctx.addIssue({ code: 'custom', path: ['locationIds'], message: 'A product assignment must not carry location ids' });
      }
    } else {
      if (locations.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['locationIds'], message: 'A location assignment requires at least one location' });
      }
      if (products.length > 0) {
        ctx.addIssue({ code: 'custom', path: ['productIds'], message: 'A location assignment must not carry product ids' });
      }
    }
    if (new Set(v.assignedUserIds).size !== v.assignedUserIds.length) {
      ctx.addIssue({ code: 'custom', path: ['assignedUserIds'], message: 'Duplicate staff ids' });
    }
  });

const updateSchema = z
  .object({
    assignedUserIds: z.array(z.number().int().positive()).min(1).max(50).optional(),
    productIds: ids.optional(),
    locationIds: ids.optional(),
    status: z.enum(['pending', 'in_progress', 'done', 'cancelled']).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

module.exports = { idParam, listQuery, createSchema, updateSchema };
