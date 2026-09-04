'use strict';

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
const forbidden = (message = 'You are not allowed to perform this action') => new AppError(403, 'FORBIDDEN', message);
const notFound = (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message);
const conflict = (message, details) => new AppError(409, 'CONFLICT', message, details);
const unprocessable = (message, details) => new AppError(422, 'UNPROCESSABLE', message, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable };
