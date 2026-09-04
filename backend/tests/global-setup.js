'use strict';

const { execSync } = require('child_process');
const path = require('path');

process.env.NODE_ENV = 'test';

module.exports = async () => {
  const config = require('../src/config');
  // Apply the hand-written SQL migrations to the dedicated test database.
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: config.databaseUrl },
    stdio: 'ignore',
  });
};
