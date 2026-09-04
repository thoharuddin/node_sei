'use strict';

const { Router } = require('express');
const controller = require('./item.controller');
const schema = require('./item.schema');
const { validate } = require('../../../middleware/validate');
const { requireAuth } = require('../../../middleware/auth');

const router = Router();

router.use(requireAuth);

// Staff may edit their own draft items, managers may edit any item before approval (§20).
router.put('/:id', validate({ params: schema.idParam, body: schema.updateSchema }), controller.update);
router.get('/:id/logs', validate({ params: schema.idParam }), controller.logs);

module.exports = router;
