import mongoose from 'mongoose';

export async function connectDB(uri?: string): Promise<typeof mongoose> {
  const mongoUri = uri || process.env['MONGO_URI'] || 'mongodb://localhost:27017/vault';
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
