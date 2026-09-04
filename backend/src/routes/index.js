'use strict';

const { Router } = require('express');
const authRoutes = require('../modules/auth/auth.routes');
const userRoutes = require('../modules/users/user.routes');
const productRoutes = require('../modules/products/product.routes');
const locationRoutes = require('../modules/locations/location.routes');

const router = Router();

router.get('/health', (req, res) => res.json({ data: { status: 'ok', uptime: process.uptime() } }));
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/products', productRoutes);
router.use('/locations', locationRoutes);

module.exports = router;
