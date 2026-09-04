'use strict';

const { Router } = require('express');
const controller = require('./user.controller');
const schema = require('./user.schema');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireManager } = require('../../middleware/auth');

const router = Router();

// User management is manager-only in its entirety (§34.1).
router.use(requireAuth, requireManager);

router.get('/', validate({ query: schema.listQuery }), controller.list);
router.get('/:id', validate({ params: schema.idParam }), controller.getById);
router.post('/', validate({ body: schema.createSchema }), controller.create);
router.put('/:id', validate({ params: schema.idParam, body: schema.updateSchema }), controller.update);
router.delete('/:id', validate({ params: schema.idParam }), controller.remove);

module.exports = router;
