'use strict';

const sessionService = require('../sessions/session.service');
const { asyncHandler } = require('../../../utils/async-handler');

const update = asyncHandler(async (req, res) => {
  res.json({ data: await sessionService.updateItem(req.params.id, req.body, req.user) });
});

const logs = asyncHandler(async (req, res) => {
  res.json({ data: await sessionService.itemLogs(req.params.id, req.user) });
});

module.exports = { update, logs };
