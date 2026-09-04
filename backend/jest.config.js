'use strict';

/** Tests run against stock_opname_sei_test with STOCK_POSTING_MODE=sync (see .env.test). */
module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/global-setup.js',
  globalTeardown: '<rootDir>/tests/global-teardown.js',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  testTimeout: 30000,
  // stock/audit tests share one database: never run them in parallel
  maxWorkers: 1,
  verbose: false,
};
