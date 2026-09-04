'use strict';

const { Queue } = require('bullmq');
const config = require('../config');
const { getConnection } = require('./connection');

const QUEUE_NAME = 'stock-posting';

let queue;

function getQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getConnection(),
      prefix: config.redis.queuePrefix,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }
  return queue;
}

/**
 * Enqueues the reconciliation of one stock adjustment.
 *
 * The job id is derived from the adjustment id, so re-enqueuing the same adjustment (a retried
 * HTTP request, a manual retry) collapses into the single existing job (BullMQ rejects ':' in custom ids, hence the dash) — the first half of the
 * idempotency story. The second half is in the worker: postAdjustment() locks the adjustment
 * row and does nothing when it is already `posted`.
 */
async function enqueueStockPosting(adjustmentId, { reason = 'audit_approval' } = {}) {
  const job = await getQueue().add(
    'post-adjustment',
    { adjustmentId, reason },
    { jobId: `adjustment-${adjustmentId}` },
  );
  return { jobId: job.id, queued: true };
}

async function queueHealth() {
  try {
    const counts = await getQueue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    return { connected: true, counts };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

async function closeQueue() {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

module.exports = { QUEUE_NAME, getQueue, enqueueStockPosting, queueHealth, closeQueue };
