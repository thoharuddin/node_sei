'use strict';

const config = require('./config');
const { prisma } = require('./database/prisma');
const { createWorker } = require('./queue/stock-posting.worker');
const { closeConnection } = require('./queue/connection');

const worker = createWorker();

// eslint-disable-next-line no-console
console.log(
  `[worker] stock reconciliation worker started (queue prefix: ${config.redis.queuePrefix}, redis: ${config.redis.url})`,
);

async function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`\n[worker] ${signal} received, draining`);
  await worker.close();
  await closeConnection();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
