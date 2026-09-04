'use strict';

const { Router } = require('express');
const controller = require('./location.controller');
const schema = require('./location.schema');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireManager } = require('../../middleware/auth');

const router = Router();

router.use(requireAuth);

router.get('/', validate({ query: schema.listQuery }), controller.list);
router.get('/:id', validate({ params: schema.idParam }), controller.getById);

router.post('/', requireManager, validate({ body: schema.createSchema }), controller.create);
router.put('/:id', requireManager, validate({ params: schema.idParam, body: schema.updateSchema }), controller.update);
router.delete('/:id', requireManager, validate({ params: schema.idParam, query: schema.deleteQuery }), controller.remove);

module.exports = router;
