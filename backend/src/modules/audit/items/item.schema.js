'use strict';

const { z } = require('zod');

const idParam = z.object({ id: z.coerce.number().int().positive() });

const updateSchema = z
  .object({
    countedQuantity: z.number().min(0).finite().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.countedQuantity !== undefined || v.note !== undefined, {
    message: 'Provide countedQuantity and/or note',
  });

module.exports = { idParam, updateSchema };
