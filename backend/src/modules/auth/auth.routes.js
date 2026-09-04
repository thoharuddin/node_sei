'use strict';

const { Router } = require('express');
const controller = require('./auth.controller');
const { loginSchema } = require('./auth.schema');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');

const router = Router();

router.post('/login', validate({ body: loginSchema }), controller.login);
router.get('/me', requireAuth, controller.me);

module.exports = router;
