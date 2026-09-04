'use strict';

const { PrismaClient, Prisma } = require('@prisma/client');
const config = require('../config');

const prisma = new PrismaClient({
  // Expected constraint violations are part of the tests: don't let Prisma log them as errors.
  log: config.isTest ? [] : ['warn', 'error'],
});

/**
 * Runs `fn` inside a transaction. If the caller already holds a transaction client
 * (`tx`), the work joins that transaction instead of opening a nested one — this keeps
 * "one business operation = one transaction" true even when services compose.
 */
function withTransaction(client, fn, options = {}) {
  if (client && typeof client.$transaction !== 'function') return fn(client); // already a tx client
  const root = client || prisma;
  return root.$transaction(fn, { timeout: 20000, ...options });
}

module.exports = { prisma, Prisma, withTransaction };
