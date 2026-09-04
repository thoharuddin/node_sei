'use strict';

const authService = require('./auth.service');
const { asyncHandler } = require('../../utils/async-handler');
const { userPublic } = require('../../utils/serialize');

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  res.json({ data: result });
});

const me = asyncHandler(async (req, res) => {
  res.json({ data: userPublic(req.user) });
});

module.exports = { login, me };
