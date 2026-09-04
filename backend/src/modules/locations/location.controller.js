'use strict';

const service = require('./location.service');
const { asyncHandler } = require('../../utils/async-handler');

const list = asyncHandler(async (req, res) => {
  res.json(await service.list(req.validatedQuery || {}));
});

const getById = asyncHandler(async (req, res) => {
  res.json({ data: await service.getById(req.params.id) });
});

const create = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await service.create(req.body, req.user) });
});

const update = asyncHandler(async (req, res) => {
  res.json({ data: await service.update(req.params.id, req.body, req.user) });
});

const remove = asyncHandler(async (req, res) => {
  const hard = ['true', '1'].includes(String((req.validatedQuery || {}).hard));
  res.json({ data: await service.remove(req.params.id, { hard }, req.user) });
});

module.exports = { list, getById, create, update, remove };
