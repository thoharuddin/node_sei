'use strict';

const service = require('./assignment.service');
const sessionService = require('../sessions/session.service');
const reviewService = require('../sessions/session.review.service');
const { asyncHandler } = require('../../../utils/async-handler');

const list = asyncHandler(async (req, res) => {
  res.json(await service.list(req.validatedQuery || {}, req.user));
});

const listMine = asyncHandler(async (req, res) => {
  res.json(await service.listMine(req.user));
});

const getById = asyncHandler(async (req, res) => {
  res.json({ data: await service.getById(req.params.id, req.user) });
});

const update = asyncHandler(async (req, res) => {
  res.json({ data: await service.update(req.params.id, req.body, req.user) });
});

const start = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await sessionService.start(req.params.id, req.user) });
});

const comparison = asyncHandler(async (req, res) => {
  res.json({ data: await reviewService.comparison(req.params.id, req.user) });
});

module.exports = { list, listMine, getById, update, start, comparison };
