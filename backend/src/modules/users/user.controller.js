'use strict';

const service = require('./user.service');
const { asyncHandler } = require('../../utils/async-handler');

const list = asyncHandler(async (req, res) => {
  res.json(await service.list(req.validatedQuery || {}));
});

const getById = asyncHandler(async (req, res) => {
  res.json({ data: await service.getById(req.params.id) });
});

const create = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await service.create(req.body) });
});

const update = asyncHandler(async (req, res) => {
  res.json({ data: await service.update(req.params.id, req.body, req.user) });
});

const remove = asyncHandler(async (req, res) => {
  res.json({ data: await service.deactivate(req.params.id, req.user) });
});

module.exports = { list, getById, create, update, remove };
