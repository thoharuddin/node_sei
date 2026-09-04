'use strict';

const IORedis = require('ioredis');
const config = require('../config');

let connection;

/**
 * Shared Redis connection for BullMQ. `maxRetriesPerRequest: null` is required by BullMQ so
 * blocking commands are not aborted while waiting for jobs.
 */
function getConnection() {
  if (!connection) {
    connection = new IORedis(config.redis.url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    connection.on('error', (err) => {
      if (!config.isTest) {
        // eslint-disable-next-line no-console
        console.error('[queue] redis error:', err.message);
      }
    });
  }
  return connection;
}

async function closeConnection() {
  if (connection) {
    await connection.quit().catch(() => connection.disconnect());
    connection = undefined;
  }
}

module.exports = { getConnection, closeConnection };
