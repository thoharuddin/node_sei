'use strict';

const service = require('./adjustment.service');
const { asyncHandler } = require('../../../utils/async-handler');

const list = asyncHandler(async (req, res) => {
  res.json(await service.list(req.validatedQuery || {}));
});

const getById = asyncHandler(async (req, res) => {
  res.json({ data: await service.getById(req.params.id, req.user) });
});

const retry = asyncHandler(async (req, res) => {
  res.json({ data: await service.retryPosting(req.params.id, req.user) });
});

module.exports = { list, getById, retry };
