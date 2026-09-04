'use strict';

const service = require('./stock.service');
const { asyncHandler } = require('../../utils/async-handler');

const listBalances = asyncHandler(async (req, res) => {
  res.json(await service.listBalances(req.validatedQuery || {}));
});

const listMovements = asyncHandler(async (req, res) => {
  res.json(await service.listMovements(req.validatedQuery || {}));
});

const getMovement = asyncHandler(async (req, res) => {
  res.json({ data: await service.getMovement(req.params.id) });
});

const consistency = asyncHandler(async (req, res) => {
  res.json({ data: await service.consistency() });
});

const getBalance = asyncHandler(async (req, res) => {
  res.json({ data: await service.getBalance(req.params.productId, req.params.locationId) });
});

const createMovement = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await service.createMovement(req.body, req.user) });
});

const createTransfer = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await service.createTransfer(req.body, req.user) });
});

module.exports = {
  listBalances,
  listMovements,
  getMovement,
  consistency,
  getBalance,
  createMovement,
  createTransfer,
};
