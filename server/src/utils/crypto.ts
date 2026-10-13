import crypto from 'crypto';

/**
 * Computes a SHA-256 hex digest of a token.
 * Used to securely store invite tokens in the database without saving raw tokens.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Generates a cryptographically strong 32-byte (64 hex characters) random token
 * and its SHA-256 hash.
 */
export function generateInviteToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}
