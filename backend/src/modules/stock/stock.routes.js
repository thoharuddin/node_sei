'use strict';

const { Router } = require('express');
const controller = require('./stock.controller');
const schema = require('./stock.schema');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireManager } = require('../../middleware/auth');

const router = Router();

router.use(requireAuth);

// Reads: both roles. Writes: manager only — staff never create stock movements (§34).
router.get('/', validate({ query: schema.stockQuery }), controller.listBalances);
router.get('/movements', validate({ query: schema.movementQuery }), controller.listMovements);
router.get('/movements/:id', validate({ params: schema.idParam }), controller.getMovement);
router.get('/consistency', requireManager, controller.consistency);
router.get('/:productId/:locationId', validate({ params: schema.balanceParams }), controller.getBalance);

router.post('/movements', requireManager, validate({ body: schema.createMovementSchema }), controller.createMovement);
router.post('/transfers', requireManager, validate({ body: schema.createTransferSchema }), controller.createTransfer);

module.exports = router;
