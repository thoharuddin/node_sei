'use strict';

const { z } = require('zod');

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'cancelled']).optional(),
  assignmentId: z.coerce.number().int().positive().optional(),
  programId: z.coerce.number().int().positive().optional(),
  staffId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const saveItemsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().positive(),
        countedQuantity: z.number().min(0).finite().optional(),
        note: z.string().trim().max(1000).nullable().optional(),
      }),
    )
    .min(1)
    .max(1000),
  notes: z.string().trim().max(2000).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

const addItemSchema = z.object({
  productId: z.number().int().positive(),
  locationId: z.number().int().positive(),
  countedQuantity: z.number().min(0).finite().optional(),
  note: z.string().trim().max(1000).optional(),
});

const submitSchema = z.object({ notes: z.string().trim().max(2000).optional() }).optional();

module.exports = { idParam, listQuery, saveItemsSchema, addItemSchema, submitSchema };
