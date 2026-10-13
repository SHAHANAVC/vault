export interface AuthUserPayload {
  userId: string;
  householdId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}
