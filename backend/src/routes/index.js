'use strict';

const { Router } = require('express');
const authRoutes = require('../modules/auth/auth.routes');
const userRoutes = require('../modules/users/user.routes');
const productRoutes = require('../modules/products/product.routes');
const locationRoutes = require('../modules/locations/location.routes');
const stockRoutes = require('../modules/stock/stock.routes');
const programRoutes = require('../modules/audit/programs/program.routes');
const assignmentRoutes = require('../modules/audit/assignments/assignment.routes');
const sessionRoutes = require('../modules/audit/sessions/session.routes');
const itemRoutes = require('../modules/audit/items/item.routes');
const adjustmentRoutes = require('../modules/audit/adjustments/adjustment.routes');

const config = require('../config');
const { queueHealth } = require('../queue/stock-posting.queue');
const { asyncHandler } = require('../utils/async-handler');

const router = Router();

router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const queue = config.stock.postingMode === 'async' ? await queueHealth() : { enabled: false };
    res.json({
      data: { status: 'ok', uptime: process.uptime(), stockPostingMode: config.stock.postingMode, queue },
    });
  }),
);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/products', productRoutes);
router.use('/locations', locationRoutes);
router.use('/stock', stockRoutes);
router.use('/audit-programs', programRoutes);
router.use('/audit-assignments', assignmentRoutes);
router.use('/audit-sessions', sessionRoutes);
router.use('/audit-session-items', itemRoutes);
router.use('/stock-adjustments', adjustmentRoutes);

module.exports = router;
