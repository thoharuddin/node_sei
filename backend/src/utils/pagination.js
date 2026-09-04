'use strict';

const config = require('../config');

function parsePagination(query = {}) {
  const limitRaw = Number(query.limit ?? config.pagination.defaultLimit);
  const pageRaw = Number(query.page ?? 1);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), config.pagination.maxLimit) : config.pagination.defaultLimit;
  const page = Number.isFinite(pageRaw) ? Math.max(Math.trunc(pageRaw), 1) : 1;
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

const meta = (total, { page, limit }) => ({
  total,
  page,
  limit,
  pages: Math.max(Math.ceil(total / limit), 1),
});

module.exports = { parsePagination, meta };
