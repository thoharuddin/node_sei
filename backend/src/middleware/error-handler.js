'use strict';

const { Prisma } = require('@prisma/client');
const config = require('../config');
const { AppError } = require('../utils/errors');

const PG_MESSAGES = {
  audit_assignment_type_scope:
    'Assignment scope is invalid: a product assignment needs product ids only, a location assignment needs location ids only',
  audit_session_item_unique: 'Duplicate product/location combination inside the audit session',
  audit_session_one_approved_per_assignment:
    'Another session of this assignment has already been approved',
  audit_session_one_draft_per_staff:
    'This staff member already has an open audit session for this assignment',
  stock_adjustment_audit_session_key: 'This audit session already has a stock adjustment',
  stock_balance_product_location_key: 'Stock balance already exists for this product/location',
  products_sku_key: 'SKU already exists',
  locations_code_key: 'Location code already exists',
  users_username_key: 'Username already exists',
  users_email_key: 'Email already exists',
  stock_quant_quantity_not_zero: 'A stock movement cannot have quantity zero',
};

function describePrisma(err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const target = Array.isArray(err.meta?.target) ? err.meta.target.join(',') : err.meta?.target;
    switch (err.code) {
      case 'P2002':
        return { status: 409, code: 'CONFLICT', message: PG_MESSAGES[target] || `Unique constraint violated${target ? ` on ${target}` : ''}` };
      case 'P2003':
        return { status: 409, code: 'CONFLICT', message: 'Referenced record does not exist' };
      case 'P2025':
        return { status: 404, code: 'NOT_FOUND', message: 'Record not found' };
      case 'P2014':
        return { status: 409, code: 'CONFLICT', message: 'Operation would break a required relation' };
      default:
        return null;
    }
  }
  return null;
}

/** Surfaces database CHECK / trigger violations as meaningful API errors. */
function describeRaw(err) {
  const message = String(err?.message || '');
  for (const [name, friendly] of Object.entries(PG_MESSAGES)) {
    if (message.includes(name)) return { status: 409, code: 'CONFLICT', message: friendly };
  }
  if (message.includes('append-only ledger')) {
    return { status: 409, code: 'LEDGER_IMMUTABLE', message: 'stock_quant is append-only: post a compensating movement instead' };
  }
  if (message.includes('is not an active staff user')) {
    return { status: 422, code: 'UNPROCESSABLE', message: 'assigned_user_ids must reference active staff users' };
  }
  if (message.includes('is not an active product')) {
    return { status: 422, code: 'UNPROCESSABLE', message: 'product_ids must reference active products' };
  }
  if (message.includes('is not an active location')) {
    return { status: 422, code: 'UNPROCESSABLE', message: 'location_ids must reference active locations' };
  }
  if (message.includes('location hierarchy cycle')) {
    return { status: 409, code: 'CONFLICT', message: 'Location hierarchy would become cyclic' };
  }
  if (message.includes('could not serialize access') || message.includes('deadlock detected')) {
    return { status: 409, code: 'CONCURRENT_UPDATE', message: 'Concurrent update detected, please retry' };
  }
  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else {
    const mapped = describePrisma(err) || describeRaw(err);
    if (mapped) ({ status, code, message } = mapped);
  }

  if (status >= 500 && !config.isTest) {
    // eslint-disable-next-line no-console
    console.error('[error]', req.method, req.originalUrl, err);
  }

  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      ...(config.env === 'development' && status >= 500 ? { cause: String(err?.message || err) } : {}),
    },
  });
}

const notFoundHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` } });
};

module.exports = { errorHandler, notFoundHandler };
