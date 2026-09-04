'use strict';

const { z } = require('zod');

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['draft', 'in_progress', 'completed', 'cancelled']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    auditDateFrom: dateOnly,
    auditDateTo: dateOnly,
    status: z.enum(['draft', 'in_progress']).optional(),
  })
  .refine((v) => v.auditDateTo >= v.auditDateFrom, {
    message: 'auditDateTo must not be earlier than auditDateFrom',
    path: ['auditDateTo'],
  });

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    auditDateFrom: dateOnly.optional(),
    auditDateTo: dateOnly.optional(),
    status: z.enum(['draft', 'in_progress', 'completed', 'cancelled']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

module.exports = { idParam, listQuery, createSchema, updateSchema };
