'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { prisma } = require('../database/prisma');
const { unauthorized, forbidden } = require('../utils/errors');
const { asyncHandler } = require('../utils/async-handler');

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}

/**
 * Verifies the bearer token and loads the user from the database on every request, so a
 * deactivated account loses access immediately instead of at token expiry (§31).
 */
const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized('Missing bearer token');

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    throw unauthorized(err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw unauthorized('User no longer exists');
  if (!user.isActive) throw forbidden('User account is deactivated');

  req.user = user;
  next();
});

/** Role gate. Authorization is always enforced here in the backend, never in the UI alone. */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) {
    return next(forbidden(`This action requires role: ${roles.join(' or ')}`));
  }
  return next();
};

const requireManager = requireRole('manager');
const requireStaff = requireRole('staff');

module.exports = { signToken, requireAuth, requireRole, requireManager, requireStaff };
