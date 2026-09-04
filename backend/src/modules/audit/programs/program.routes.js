'use strict';

const { Router } = require('express');
const controller = require('./program.controller');
const schema = require('./program.schema');
const assignmentSchema = require('../assignments/assignment.schema');
const { validate } = require('../../../middleware/validate');
const { requireAuth, requireManager } = require('../../../middleware/auth');

const router = Router();

router.use(requireAuth);

router.get('/', validate({ query: schema.listQuery }), controller.list);
router.get('/:id', validate({ params: schema.idParam }), controller.getById);
router.get('/:id/dashboard', validate({ params: schema.idParam }), controller.dashboard);
router.get(
  '/:id/assignments',
  validate({ params: schema.idParam, query: assignmentSchema.listQuery }),
  controller.listAssignments,
);

// Only managers create or change audit programs and assignments (§34.2, §34.3).
router.post('/', requireManager, validate({ body: schema.createSchema }), controller.create);
router.put('/:id', requireManager, validate({ params: schema.idParam, body: schema.updateSchema }), controller.update);
router.post(
  '/:id/assignments',
  requireManager,
  validate({ params: schema.idParam, body: assignmentSchema.createSchema }),
  controller.createAssignment,
);

module.exports = router;
