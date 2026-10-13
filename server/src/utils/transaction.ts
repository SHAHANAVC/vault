import mongoose, { ClientSession } from 'mongoose';

/**
 * Executes a callback within a MongoDB transaction session.
 * 
 * - In Replica Set deployments (Atlas, production, MongoMemoryReplSet in tests):
 *   Executes with strict ACID guarantees inside `session.withTransaction`.
 * - In Standalone local development deployments (where mongod runs without replica set):
 *   Executes operations directly with `undefined` session to allow smooth local development
 *   without crashing on "retryable writes / transactions not supported".
 */
export async function runInTransaction<T>(
  callback: (session: ClientSession | undefined) => Promise<T>
): Promise<T> {
  const client = mongoose.connection.getClient();
  const topology = (client as { topology?: { description?: { setName?: string | null } } })?.topology?.description;
  const isReplicaSet = Boolean(topology?.setName);

  if (!isReplicaSet) {
    return await callback(undefined);
  }

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      return await callback(session);
    });
  } finally {
    await session.endSession();
  }
}
