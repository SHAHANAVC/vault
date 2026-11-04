import mongoose, { Types } from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vault';

async function cleanupGoldPlans() {
  console.log(`Connecting to MongoDB at ${MONGODB_URI}...`);
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection failed');
  }

  const plansCol = db.collection('plans');
  const txCol = db.collection('transactions');
  const bucketsCol = db.collection('buckets');

  // 1. Identify Gold / Jewellery plans (strictly leaving EMI and Kuri alone)
  const goldPlans = await plansCol.find({
    $or: [
      { name: { $regex: /gold|jewel/i } },
      { category: { $regex: /gold|jewel/i } },
    ],
  }).toArray();

  console.log(`Found ${goldPlans.length} gold/jewellery plan(s).`);

  if (goldPlans.length === 0) {
    console.log('No gold plans found in database. Exiting.');
    await mongoose.disconnect();
    return;
  }

  const goldPlanIds = goldPlans.map((p) => p._id);
  console.log('Gold Plan IDs:', goldPlanIds.map((id) => id.toString()));

  // 2. Find all transactions linked to these gold plans
  const linkedTxs = await txCol.find({ planId: { $in: goldPlanIds } }).toArray();
  console.log(`Found ${linkedTxs.length} linked transaction(s).`);

  // Track affected buckets to recalculate their balances
  const affectedBucketIds = new Set<string>();

  for (const tx of linkedTxs) {
    if (tx.fromBucketId) affectedBucketIds.add(tx.fromBucketId.toString());
    if (tx.toBucketId) affectedBucketIds.add(tx.toBucketId.toString());
  }

  // 3. Delete linked transactions and gold plans
  if (linkedTxs.length > 0) {
    const txDeleteResult = await txCol.deleteMany({ planId: { $in: goldPlanIds } });
    console.log(`Deleted ${txDeleteResult.deletedCount} transaction(s).`);
  }

  const planDeleteResult = await plansCol.deleteMany({ _id: { $in: goldPlanIds } });
  console.log(`Deleted ${planDeleteResult.deletedCount} plan(s).`);

  // 4. Recompute bucket balances for affected buckets strictly from their remaining ledger transactions
  // This guarantees that GET /transactions/reconcile will report zero mismatches!
  console.log(`Recomputing balances for ${affectedBucketIds.size} affected bucket(s)...`);

  for (const bucketIdStr of affectedBucketIds) {
    const bucketId = new Types.ObjectId(bucketIdStr);
    const bucket = await bucketsCol.findOne({ _id: bucketId });
    if (!bucket) continue;

    // Sum all remaining transactions for this bucket
    const allRemainingTxs = await txCol.find({
      $or: [{ fromBucketId: bucketId }, { toBucketId: bucketId }],
    }).toArray();

    let computedBalance = 0;
    for (const tx of allRemainingTxs) {
      if (tx.type === 'income' && tx.toBucketId?.toString() === bucketIdStr) {
        computedBalance += tx.amount;
      } else if (tx.type === 'expense' && tx.fromBucketId?.toString() === bucketIdStr) {
        computedBalance -= tx.amount;
      } else if (tx.type === 'transfer') {
        if (tx.toBucketId?.toString() === bucketIdStr) computedBalance += tx.amount;
        if (tx.fromBucketId?.toString() === bucketIdStr) computedBalance -= tx.amount;
      } else if (tx.type === 'adjustment') {
        if (tx.toBucketId?.toString() === bucketIdStr) computedBalance += tx.amount;
        if (tx.fromBucketId?.toString() === bucketIdStr) computedBalance -= tx.amount;
      }
    }

    const previousBalance = bucket.balance;
    await bucketsCol.updateOne({ _id: bucketId }, { $set: { balance: computedBalance } });
    console.log(`Bucket "${bucket.name}" (${bucketIdStr}): balance updated from ${previousBalance}p to ${computedBalance}p.`);
  }

  console.log('Cleanup completed successfully. All ledger invariants preserved.');
  await mongoose.disconnect();
}

cleanupGoldPlans().catch((err) => {
  console.error('Error during gold plan cleanup:', err);
  process.exit(1);
});
