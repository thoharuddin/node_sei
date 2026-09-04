'use strict';

const { Worker } = require('bullmq');
const config = require('../config');
const { prisma, withTransaction } = require('../database/prisma');
const { getConnection } = require('./connection');
const { QUEUE_NAME } = require('./stock-posting.queue');
const adjustmentService = require('../modules/audit/adjustments/adjustment.service');

/**
 * Reconciles one approved audit session into stock movements, asynchronously (Phase 7).
 *
 * The whole posting runs in ONE transaction, and postAdjustment() is idempotent:
 *   - it locks the stock_adjustment row (FOR UPDATE), so two workers cannot post together;
 *   - it returns immediately when posting_status is already 'posted', so a redelivered or
 *     manually retried job cannot double-post the movements.
 * On failure the adjustment is marked `failed` with the error, and BullMQ retries with backoff.
 */
async function processAdjustmentJob(job) {
  const { adjustmentId } = job.data;

  try {
    const result = await withTransaction(prisma, async (tx) =>
      adjustmentService.postAdjustment(tx, adjustmentId),
    );
    return { adjustmentId, ...result };
  } catch (err) {
    await prisma.stockAdjustment
      .update({
        where: { id: adjustmentId },
        data: { postingStatus: 'failed', postingError: String(err.message).slice(0, 2000) },
      })
      .catch(() => {});
    throw err;
  }
}

function createWorker() {
  const worker = new Worker(QUEUE_NAME, processAdjustmentJob, {
    connection: getConnection(),
    prefix: config.redis.queuePrefix,
    concurrency: 4,
  });

  worker.on('completed', (job, result) => {
    // eslint-disable-next-line no-console
    console.log(
      `[worker] adjustment ${result.adjustmentId} posted (${result.movements} movement(s)${result.alreadyPosted ? ', was already posted' : ''})`,
    );
  });
  worker.on('failed', (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[worker] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
  });

  return worker;
}

module.exports = { processAdjustmentJob, createWorker };
