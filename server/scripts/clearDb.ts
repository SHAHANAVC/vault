import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const mongoUri = process.env['MONGO_URI'] || process.env['MONGODB_URI'];

if (!mongoUri) {
  console.error('❌ MONGO_URI or MONGODB_URI is required in server/.env');
  process.exit(1);
}

async function clearDatabase() {
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(mongoUri);
  console.log('Connected to database:', mongoose.connection.name);

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection failed.');
  }

  const collections = await db.listCollections().toArray();
  console.log(`Found ${collections.length} collections.`);

  for (const col of collections) {
    const count = await db.collection(col.name).countDocuments();
    console.log(`Clearing collection "${col.name}" (${count} documents)...`);
    await db.collection(col.name).deleteMany({});
  }

  console.log('✅ All collections cleared successfully. Database is now clean and fresh!');
  await mongoose.disconnect();
}

clearDatabase().catch((err) => {
  console.error('❌ Error clearing database:', err);
  process.exit(1);
});

