'use strict';

const service = require('./program.service');
const assignmentService = require('../assignments/assignment.service');
const { asyncHandler } = require('../../../utils/async-handler');

const list = asyncHandler(async (req, res) => {
  res.json(await service.list(req.validatedQuery || {}, req.user));
});

const getById = asyncHandler(async (req, res) => {
  res.json({ data: await service.getById(req.params.id, req.user) });
});

const dashboard = asyncHandler(async (req, res) => {
  res.json({ data: await service.dashboard(req.params.id, req.user) });
});

const create = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await service.create(req.body, req.user) });
});

const update = asyncHandler(async (req, res) => {
  res.json({ data: await service.update(req.params.id, req.body, req.user) });
});

// Nested assignment routes (§30: /audit-programs/:id/assignments)
const listAssignments = asyncHandler(async (req, res) => {
  res.json(await assignmentService.listForProgram(req.params.id, req.validatedQuery || {}, req.user));
});

const createAssignment = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await assignmentService.create(req.params.id, req.body, req.user) });
});

module.exports = { list, getById, dashboard, create, update, listAssignments, createAssignment };
