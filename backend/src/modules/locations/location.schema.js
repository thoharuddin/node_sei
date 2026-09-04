'use strict';

const { z } = require('zod');

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  search: z.string().trim().max(120).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  parentId: z.coerce.number().int().positive().optional(),
  tree: z.enum(['true', 'false', '1', '0']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const createSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  parentId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = z
  .object({
    code: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    parentId: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

const deleteQuery = z.object({ hard: z.enum(['true', 'false', '1', '0']).optional() });

module.exports = { idParam, listQuery, createSchema, updateSchema, deleteQuery };
