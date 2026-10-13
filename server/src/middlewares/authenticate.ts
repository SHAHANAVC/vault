import { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt';
import { AUTH_COOKIE_NAME } from '../utils/cookies';

/**
 * Authentication Middleware
 * Strictly verifies the HTTP-only JWT cookie (or Bearer auth header fallback).
 * Attaches the strongly-typed { userId, householdId } payload to `req.user`.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token =
    req.cookies?.[AUTH_COOKIE_NAME] ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : undefined);

  if (!token) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }

  try {
    const payload = verifyJwt(token);
    req.user = payload;
    next();
  } catch (_err) {
    res.status(401).json({ message: 'Invalid or expired authentication session' });
  }
}
