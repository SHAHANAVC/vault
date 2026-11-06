import mongoose from 'mongoose';

export async function connectDB(uri?: string): Promise<typeof mongoose> {
  let mongoUri =
    uri ||
    process.env['MONGO_URI'] ||
    process.env['MONGODB_URI'] ||
    'mongodb://localhost:27017/vault?retryWrites=false';

  // Standalone local MongoDB instances (without replica sets) do not support retryable writes.
  // Ensure retryWrites=false is present for local connections unless explicitly configured.
  if ((mongoUri.includes('localhost') || mongoUri.includes('127.0.0.1')) && !mongoUri.includes('retryWrites=')) {
    const separator = mongoUri.includes('?') ? '&' : '?';
    mongoUri = `${mongoUri}${separator}retryWrites=false`;
  }

  try {
    const conn = await mongoose.connect(mongoUri);
    console.log(`[MongoDB] Connected successfully to ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error('[MongoDB] Connection error:', error);
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}
