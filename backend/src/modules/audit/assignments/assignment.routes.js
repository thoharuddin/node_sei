'use strict';

const { Router } = require('express');
const controller = require('./assignment.controller');
const schema = require('./assignment.schema');
const { validate } = require('../../../middleware/validate');
const { requireAuth, requireManager, requireStaff } = require('../../../middleware/auth');

const router = Router();

router.use(requireAuth);

router.get('/', validate({ query: schema.listQuery }), controller.list);
router.get('/my', requireStaff, controller.listMine);
router.get('/:id', validate({ params: schema.idParam }), controller.getById);

// §14/§19: side-by-side comparison of every session of one assignment — manager only.
router.get('/:id/comparison', requireManager, validate({ params: schema.idParam }), controller.comparison);

// §31: starting an audit is a staff action, and only for their own assignment.
router.post('/:id/start', requireStaff, validate({ params: schema.idParam }), controller.start);

router.put('/:id', requireManager, validate({ params: schema.idParam, body: schema.updateSchema }), controller.update);

module.exports = router;
