'use strict';

const { z } = require('zod');

const loginSchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(6).max(200),
});

module.exports = { loginSchema };
