'use strict';

const { z } = require('zod');

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  search: z.string().trim().max(120).optional(),
  role: z.enum(['manager', 'staff']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const createSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'Only letters, digits, dot, dash and underscore'),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  role: z.enum(['manager', 'staff']),
  isActive: z.boolean().optional(),
});

const updateSchema = z
  .object({
    password: z.string().min(8).max(200).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    email: z.string().trim().email().max(200).optional(),
    role: z.enum(['manager', 'staff']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

module.exports = { idParam, listQuery, createSchema, updateSchema };
