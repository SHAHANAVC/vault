import mongoose, { ClientSession } from 'mongoose';

/**
 * Transaction Runner Helper
 * Wraps MongoDB's session.withTransaction with lifecycle management and
 * automatic retry handling for transient transaction errors.
 * 
 * In MongoDB, multi-document ACID transactions execute inside a ClientSession.
 * withTransaction() automatically retries transient commit and execution errors.
 * If any uncaught error or invariant violation occurs inside the callback,
 * withTransaction() immediately aborts the transaction, rolling back all pending writes.
 */
export async function runInTransaction<T>(
  callback: (session: ClientSession) => Promise<T>
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await callback(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}
