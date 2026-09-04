'use strict';

const config = require('./config');
const { createApp } = require('./app');
const { prisma } = require('./database/prisma');

const app = createApp();

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] stock-opname backend on http://localhost:${config.port} (${config.env}, stock posting: ${config.stock.postingMode})`);
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`\n[api] ${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
