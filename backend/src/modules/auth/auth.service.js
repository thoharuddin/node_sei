'use strict';

const bcrypt = require('bcryptjs');
const config = require('../../config');
const { prisma } = require('../../database/prisma');
const { signToken } = require('../../middleware/auth');
const { unauthorized, forbidden } = require('../../utils/errors');
const { userPublic } = require('../../utils/serialize');

// Comparing against a real-shaped hash keeps the response time of "unknown user" and
// "wrong password" indistinguishable (no user enumeration through timing).
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.C5pAyeMWzHY6E1M2VU4EPBw6Xxxx';

async function login({ username, password }) {
  const user = await prisma.user.findUnique({ where: { username } });
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

  if (!user || !ok) throw unauthorized('Invalid username or password');
  if (!user.isActive) throw forbidden('User account is deactivated');

  return { token: signToken(user), expiresIn: config.jwt.expiresIn, user: userPublic(user) };
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, config.bcryptRounds);
}

module.exports = { login, hashPassword };
