import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for sensitive authentication operations (login, register).
 * Thwarts credential stuffing, brute-force dictionary attacks, and resource exhaustion.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env['NODE_ENV'] === 'test' ? 1000 : 15, // 15 requests per 15 minutes in prod/dev
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many authentication attempts. Please try again after 15 minutes.',
  },
});

/**
 * Rate limiter for partner invitation creation and acceptance.
 */
export const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: process.env['NODE_ENV'] === 'test' ? 1000 : 20, // 20 requests per hour in prod/dev
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many invite requests. Please try again later.',
  },
});

/**
 * Dedicated strict test rate limiter to verify rate limiting behavior in automated tests
 */
export const strictRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Rate limit exceeded: too many requests',
  },
});
