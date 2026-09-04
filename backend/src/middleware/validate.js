'use strict';

const { badRequest } = require('../utils/errors');

/**
 * Validates and *replaces* req.body / req.query / req.params with the parsed result,
 * so controllers only ever see coerced, whitelisted data.
 */
const validate = (schemas) => (req, res, next) => {
  for (const key of ['body', 'query', 'params']) {
    const schema = schemas[key];
    if (!schema) continue;
    const result = schema.safeParse(req[key]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: [key, ...i.path].join('.'),
        message: i.message,
      }));
      return next(badRequest('Validation failed', details));
    }
    if (key === 'query') req.validatedQuery = result.data;
    else req[key] = result.data;
  }
  return next();
};

module.exports = { validate };
