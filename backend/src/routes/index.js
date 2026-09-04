'use strict';

const { Router } = require('express');
const authRoutes = require('../modules/auth/auth.routes');

const router = Router();

router.get('/health', (req, res) => res.json({ data: { status: 'ok', uptime: process.uptime() } }));
router.use('/auth', authRoutes);

module.exports = router;
