'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller = require('./adjustment.controller');
const { validate } = require('../../../middleware/validate');
const { requireAuth, requireManager } = require('../../../middleware/auth');

const router = Router();

// Stock adjustments are only ever created by approving an audit session (§34.11) — read-only API.
router.use(requireAuth, requireManager);

router.get(
  '/',
  validate({
    query: z.object({
      postingStatus: z.enum(['pending', 'posted', 'failed']).optional(),
      auditSessionId: z.coerce.number().int().positive().optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }),
  }),
  controller.list,
);
router.get('/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), controller.getById);

module.exports = router;
