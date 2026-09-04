'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Tests get their own database / posting mode.
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: path.resolve(__dirname, '../../', envFile) });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT || 4000),
  databaseUrl: required('DATABASE_URL'),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map((s) => s.trim()),
  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
  stock: {
    // 'sync'  -> movements posted inside the approval transaction (Phase 6 behaviour)
    // 'async' -> movements posted by the BullMQ reconciliation worker (Phase 7)
    postingMode: (process.env.STOCK_POSTING_MODE || 'sync').toLowerCase(),
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    queuePrefix: process.env.QUEUE_PREFIX || 'stock-opname',
  },
  pagination: { defaultLimit: 25, maxLimit: 200 },
};

module.exports = config;
