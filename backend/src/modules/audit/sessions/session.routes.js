'use strict';

const { Router } = require('express');
const controller = require('./session.controller');
const schema = require('./session.schema');
const { validate } = require('../../../middleware/validate');
const { requireAuth, requireStaff } = require('../../../middleware/auth');

const router = Router();

router.use(requireAuth);

// Ownership is enforced inside the service: staff only ever reach their own sessions.
router.get('/', validate({ query: schema.listQuery }), controller.list);
router.get('/:id', validate({ params: schema.idParam }), controller.getById);
router.get('/:id/items', validate({ params: schema.idParam }), controller.listItems);

router.put('/:id/items', validate({ params: schema.idParam, body: schema.saveItemsSchema }), controller.saveItems);
router.post('/:id/items', validate({ params: schema.idParam, body: schema.addItemSchema }), controller.addItem);

// §18: only the counting staff member submits.
router.post('/:id/submit', requireStaff, validate({ params: schema.idParam }), controller.submit);

module.exports = router;
