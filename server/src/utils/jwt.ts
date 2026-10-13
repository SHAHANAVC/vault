import jwt from 'jsonwebtoken';
import { AuthUserPayload } from '../types/express';

const JWT_SECRET =
  process.env['JWT_SECRET'] || 'vault_default_secret_for_development_and_tests_32chars';
const JWT_EXPIRES_IN = process.env['JWT_EXPIRES_IN'] || '7d';

export function signJwt(payload: AuthUserPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyJwt(token: string): AuthUserPayload {
  const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
  if (
    !decoded ||
    typeof decoded !== 'object' ||
    !decoded['userId'] ||
    !decoded['householdId']
  ) {
    throw new Error('Invalid token payload structure');
  }
  return {
    userId: String(decoded['userId']),
    householdId: String(decoded['householdId']),
  };
}
