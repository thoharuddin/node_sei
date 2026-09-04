'use strict';

const service = require('./session.service');
const reviewService = require('./session.review.service');
const { asyncHandler } = require('../../../utils/async-handler');

const list = asyncHandler(async (req, res) => {
  res.json(await service.list(req.validatedQuery || {}, req.user));
});

const getById = asyncHandler(async (req, res) => {
  res.json({ data: await service.getById(req.params.id, req.user) });
});

const listItems = asyncHandler(async (req, res) => {
  res.json({ data: await service.listItems(req.params.id, req.user) });
});

const saveItems = asyncHandler(async (req, res) => {
  res.json({ data: await service.saveItems(req.params.id, req.body, req.user) });
});

const addItem = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await service.addItem(req.params.id, req.body, req.user) });
});

const submit = asyncHandler(async (req, res) => {
  res.json({ data: await service.submit(req.params.id, req.body, req.user) });
});

const approve = asyncHandler(async (req, res) => {
  res.json({ data: await reviewService.approve(req.params.id, req.body, req.user) });
});

const reject = asyncHandler(async (req, res) => {
  res.json({ data: await reviewService.reject(req.params.id, req.body, req.user) });
});

const reopen = asyncHandler(async (req, res) => {
  res.json({ data: await reviewService.reopen(req.params.id, req.user) });
});

module.exports = { list, getById, listItems, saveItems, addItem, submit, approve, reject, reopen };
