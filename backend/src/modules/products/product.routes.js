'use strict';

const { Router } = require('express');
const controller = require('./product.controller');
const schema = require('./product.schema');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireManager } = require('../../middleware/auth');

const router = Router();

router.use(requireAuth);

// Reading master data is allowed for both roles; writing is manager-only (§34.1).
router.get('/', validate({ query: schema.listQuery }), controller.list);
router.get('/:id', validate({ params: schema.idParam }), controller.getById);
router.get('/:id/stock', validate({ params: schema.idParam }), controller.getBalances);

router.post('/', requireManager, validate({ body: schema.createSchema }), controller.create);
router.put('/:id', requireManager, validate({ params: schema.idParam, body: schema.updateSchema }), controller.update);
router.delete('/:id', requireManager, validate({ params: schema.idParam, query: schema.deleteQuery }), controller.remove);

module.exports = router;
