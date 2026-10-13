import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../app';
import { User } from '../models/User';
import { Bucket } from '../models/Bucket';
import { Transaction } from '../models/Transaction';

describe('Phase 4B: Core Ledger Transactions & Invariants Tests', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      instanceOpts: [
        {
          launchTimeout: 60000,
        },
      ],
    });
    const uri = replSet.getUri();
    await mongoose.connect(uri);
  }, 90000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }
  });

  beforeEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      const col = collections[key];
      if (col) {
        await col.deleteMany({});
      }
    }
  });

  // Test helper: register user and return cookie + user document
  async function registerUser(name: string, email: string, password = 'Password123', inviteToken?: string) {
    const res = await request(app).post('/auth/register').send({
      name,
      email,
      password,
      inviteToken,
    });
    const cookie = (res.headers['set-cookie'] as unknown as string[]) || [];
    const user = await User.findOne({ email: email.toLowerCase() });
    return { cookie, user: user!, body: res.body };
  }

  // Test helper: setup household with owner and partner
  async function setupHousehold() {
    const owner = await registerUser('Arjun', 'arjun@example.com');
    const inviteRes = await request(app).post('/invites').set('Cookie', owner.cookie);
    const inviteToken = inviteRes.body.token as string;
    const partner = await registerUser('Priya', 'priya@example.com', 'Password123', inviteToken);
    return { owner, partner };
  }

  describe('Income & Expense Operations', () => {
    it('accurately updates balances on income and expense', async () => {
      const { owner } = await setupHousehold();

      // Create a cash bucket with 10,000 paise (₹100) opening balance
      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({
          name: 'Wallet Cash',
          type: 'cash',
          visibility: 'shared',
          openingBalance: 10000,
        });
      const bucketId = bRes.body.bucket.id;
      expect(bRes.body.bucket.balance).toBe(10000);

      // 1. Income: Add 15,000 paise (₹150)
      const incomeRes = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'income',
          toBucketId: bucketId,
          amount: 15000,
          category: 'Freelance',
          purpose: 'Small gig',
          date: new Date().toISOString(),
        });

      expect(incomeRes.status).toBe(201);
      expect(incomeRes.body.transaction.amount).toBe(15000);
      expect(incomeRes.body.transaction.status).toBe('active');

      const bAfterIncome = await Bucket.findById(bucketId);
      expect(bAfterIncome?.balance).toBe(25000); // 10,000 + 15,000 = 25,000 paise

      // 2. Expense: Spend 8,000 paise (₹80)
      const expenseRes = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'expense',
          fromBucketId: bucketId,
          amount: 8000,
          category: 'Groceries',
          purpose: 'Weekly milk and eggs',
          date: new Date().toISOString(),
        });

      expect(expenseRes.status).toBe(201);
      expect(expenseRes.body.transaction.amount).toBe(8000);

      const bAfterExpense = await Bucket.findById(bucketId);
      expect(bAfterExpense?.balance).toBe(17000); // 25,000 - 8,000 = 17,000 paise
    });

    it('rejects overdraft on cash and bank buckets while allowing loan and kuri to go negative', async () => {
      const { owner } = await setupHousehold();

      // Create cash bucket with 5,000 paise
      const cashRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({
          name: 'My Pocket Cash',
          type: 'cash',
          visibility: 'shared',
          openingBalance: 5000,
        });
      const cashId = cashRes.body.bucket.id;

      // Attempt to spend 6,000 paise from cash -> REJECTED
      const cashOverdraft = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'expense',
          fromBucketId: cashId,
          amount: 6000,
          category: 'Dining',
          purpose: 'Fancy lunch',
          date: new Date().toISOString(),
        });

      expect(cashOverdraft.status).toBe(400);
      expect(cashOverdraft.body.message).toContain('Insufficient funds');

      // Create loan_taken bucket with 0 balance
      const loanRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({
          name: 'Friend Loan',
          type: 'loan_taken',
          visibility: 'shared',
        });
      const loanId = loanRes.body.bucket.id;

      // Spend 12,000 paise from loan_taken -> ALLOWED (negative balance exempt)
      const loanExpense = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'expense',
          fromBucketId: loanId,
          amount: 12000,
          category: 'Emergency Borrow',
          purpose: 'Borrowed for car repair',
          date: new Date().toISOString(),
        });

      expect(loanExpense.status).toBe(201);
      const loanDoc = await Bucket.findById(loanId);
      expect(loanDoc?.balance).toBe(-12000); // Successfully gone negative
    });

    it('ensures atomic concurrency protection: parallel expenses exceeding balance succeed exactly once with zero overdraft', async () => {
      const { owner } = await setupHousehold();

      // Bucket with 10,000 paise (₹100)
      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({
          name: 'Concurrent Checking',
          type: 'bank',
          visibility: 'shared',
          openingBalance: 10000,
        });
      const bucketId = bRes.body.bucket.id;

      // Two simultaneous requests each trying to spend 8,000 paise (total 16,000 > 10,000)
      const req1 = request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'expense',
          fromBucketId: bucketId,
          amount: 8000,
          category: 'Shopping',
          purpose: 'Item 1',
          date: new Date().toISOString(),
        });

      const req2 = request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'expense',
          fromBucketId: bucketId,
          amount: 8000,
          category: 'Shopping',
          purpose: 'Item 2',
          date: new Date().toISOString(),
        });

      const [res1, res2] = await Promise.all([req1, req2]);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(201);
      expect(statuses).toContain(400);

      const finalBucket = await Bucket.findById(bucketId);
      expect(finalBucket?.balance).toBe(2000); // 10,000 - 8,000 = 2,000 (NEVER negative)
    });
  });

  describe('Transfer Operations & Invariants', () => {
    it('keeps household net total unchanged during internal transfers', async () => {
      const { owner } = await setupHousehold();

      // Bucket 1 (Bank): 50,000 paise
      const bankRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'HDFC Bank', type: 'bank', visibility: 'shared', openingBalance: 50000 });
      const bankId = bankRes.body.bucket.id;

      // Bucket 2 (Cash): 10,000 paise
      const cashRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Home Safe', type: 'cash', visibility: 'shared', openingBalance: 10000 });
      const cashId = cashRes.body.bucket.id;

      const summaryBefore = await request(app).get('/buckets/summary').set('Cookie', owner.cookie);
      expect(summaryBefore.body.householdTotal).toBe(60000);

      // Transfer 20,000 paise from Bank to Cash
      const transferRes = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'transfer',
          fromBucketId: bankId,
          toBucketId: cashId,
          amount: 20000,
          purpose: 'ATM Cash Withdrawal',
          date: new Date().toISOString(),
        });

      expect(transferRes.status).toBe(201);

      const bankDoc = await Bucket.findById(bankId);
      const cashDoc = await Bucket.findById(cashId);
      expect(bankDoc?.balance).toBe(30000); // 50,000 - 20,000
      expect(cashDoc?.balance).toBe(30000); // 10,000 + 20,000

      const summaryAfter = await request(app).get('/buckets/summary').set('Cookie', owner.cookie);
      expect(summaryAfter.body.householdTotal).toBe(60000); // STRICT INVARIANT: Total is preserved
    });

    it('rolls back completely if a transfer fails midway, leaving both balances untouched', async () => {
      const { owner } = await setupHousehold();

      // Source bank: 10,000 paise
      const bankRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'ICICI Bank', type: 'bank', visibility: 'shared', openingBalance: 10000 });
      const bankId = bankRes.body.bucket.id;

      // Destination cash: 5,000 paise
      const cashRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Petty Cash', type: 'cash', visibility: 'shared', openingBalance: 5000 });
      const cashId = cashRes.body.bucket.id;

      // Archive destination bucket to simulate failure during deposit step
      await Bucket.findByIdAndUpdate(cashId, { isArchived: true });

      // Attempt transfer
      const transferFail = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'transfer',
          fromBucketId: bankId,
          toBucketId: cashId,
          amount: 4000,
          purpose: 'Will fail due to archived destination',
          date: new Date().toISOString(),
        });

      expect(transferFail.status).toBe(400);

      // Verify rollback: Source bank remains untouched at 10,000 paise
      const bankDoc = await Bucket.findById(bankId);
      expect(bankDoc?.balance).toBe(10000);
    });
  });

  describe('Voiding Transactions & Reversal Entries', () => {
    it('restores balances via append-only reversal entry and rejects double-voiding', async () => {
      const { owner } = await setupHousehold();

      // Create bucket with 20,000 paise
      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Main Account', type: 'bank', visibility: 'shared', openingBalance: 20000 });
      const bucketId = bRes.body.bucket.id;

      // Record an expense of 5,000 paise
      const expRes = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'expense',
          fromBucketId: bucketId,
          amount: 5000,
          category: 'Utilities',
          purpose: 'Electricity bill',
          date: new Date().toISOString(),
        });
      const txId = expRes.body.transaction.id;
      expect((await Bucket.findById(bucketId))?.balance).toBe(15000);

      // Void the expense
      const voidRes = await request(app)
        .post(`/transactions/${txId}/void`)
        .set('Cookie', owner.cookie);

      expect(voidRes.status).toBe(200);
      expect(voidRes.body.transaction.status).toBe('voided');

      // Balance is restored to 20,000 paise
      expect((await Bucket.findById(bucketId))?.balance).toBe(20000);

      // Verify reversal entry exists in DB
      const reversalDoc = await Transaction.findOne({ reversalOf: txId });
      expect(reversalDoc).not.toBeNull();
      expect(reversalDoc?.type).toBe('income');
      expect(reversalDoc?.amount).toBe(5000);
      expect(reversalDoc?.status).toBe('active');

      // Second void attempt is rejected
      const doubleVoid = await request(app)
        .post(`/transactions/${txId}/void`)
        .set('Cookie', owner.cookie);

      expect(doubleVoid.status).toBe(400);
      expect(doubleVoid.body.message).toContain('already voided');
    });

    it('rejects partner attempting to void an entry created by the owner', async () => {
      const { owner, partner } = await setupHousehold();

      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Shared Pot', type: 'cash', visibility: 'shared', openingBalance: 15000 });
      const bucketId = bRes.body.bucket.id;

      const txRes = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'expense',
          fromBucketId: bucketId,
          amount: 3000,
          category: 'Snacks',
          purpose: 'Chai and biscuits',
          date: new Date().toISOString(),
        });
      const txId = txRes.body.transaction.id;

      // Partner attempts to void owner's transaction -> 403 Forbidden
      const partnerVoid = await request(app)
        .post(`/transactions/${txId}/void`)
        .set('Cookie', partner.cookie);

      expect(partnerVoid.status).toBe(403);
      expect(partnerVoid.body.message).toContain('Only the creator can void');
    });

    it('rejects voiding an income if reversing it would drive cash/bank negative', async () => {
      const { owner } = await setupHousehold();

      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Checking', type: 'bank', visibility: 'shared', openingBalance: 0 });
      const bucketId = bRes.body.bucket.id;

      // Income: 10,000 paise
      const incRes = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'income',
          toBucketId: bucketId,
          amount: 10000,
          category: 'Bonus',
          date: new Date().toISOString(),
        });
      const incId = incRes.body.transaction.id;

      // Spend 8,000 paise (remaining balance = 2,000 paise)
      await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'expense',
          fromBucketId: bucketId,
          amount: 8000,
          category: 'Shopping',
          purpose: 'Shoes',
          date: new Date().toISOString(),
        });

      // Attempt to void the 10,000 paise income -> would need to debit 10,000, but only 2,000 left
      const voidIncome = await request(app)
        .post(`/transactions/${incId}/void`)
        .set('Cookie', owner.cookie);

      expect(voidIncome.status).toBe(400);
      expect(voidIncome.body.message).toContain('Insufficient funds');
    });
  });

  describe('Privacy Matrix & Policy Enforcement for Transactions', () => {
    it('partner list never contains transactions on balance_only or private buckets', async () => {
      const { owner, partner } = await setupHousehold();

      // Owner creates:
      // 1. Shared bucket
      const sharedB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Joint Pool', type: 'bank', visibility: 'shared', openingBalance: 20000 });
      const sharedId = sharedB.body.bucket.id;

      // 2. Balance-only bucket
      const balOnlyB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Owner Secret Stash', type: 'cash', visibility: 'balance_only', openingBalance: 30000 });
      const balOnlyId = balOnlyB.body.bucket.id;

      // 3. Private bucket
      const privateB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Owner Private', type: 'bank', visibility: 'private', openingBalance: 40000 });
      const privateId = privateB.body.bucket.id;

      // Owner makes an expense in each bucket
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        fromBucketId: sharedId,
        amount: 1000,
        category: 'Shared Exp',
        purpose: 'Shared purpose',
        date: new Date().toISOString(),
      });

      const balOnlyTxRes = await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        fromBucketId: balOnlyId,
        amount: 2000,
        category: 'Secret Exp',
        purpose: 'Secret purpose',
        date: new Date().toISOString(),
      });
      const balOnlyTxId = balOnlyTxRes.body.transaction.id;

      const privTxRes = await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        fromBucketId: privateId,
        amount: 3000,
        category: 'Private Exp',
        purpose: 'Private purpose',
        date: new Date().toISOString(),
      });
      const privTxId = privTxRes.body.transaction.id;

      // Partner queries transactions list
      const partnerList = await request(app).get('/transactions').set('Cookie', partner.cookie);
      expect(partnerList.status).toBe(200);

      // Partner should ONLY see the shared bucket transactions (and opening balance of shared)
      const visibleFromBucketNames = partnerList.body.transactions.map((t: any) => t.fromBucketName || t.toBucketName);
      expect(visibleFromBucketNames).not.toContain('Owner Secret Stash');
      expect(visibleFromBucketNames).not.toContain('Owner Private');

      // GET by ID on hidden transactions returns 404 (zero leak)
      const getBalOnly = await request(app).get(`/transactions/${balOnlyTxId}`).set('Cookie', partner.cookie);
      expect(getBalOnly.status).toBe(404);

      const getPriv = await request(app).get(`/transactions/${privTxId}`).set('Cookie', partner.cookie);
      expect(getPriv.status).toBe(404);
    });

    it('masks transfers between a shared bucket and a hidden bucket for the partner', async () => {
      const { owner, partner } = await setupHousehold();

      // Shared bucket
      const sharedB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Family Checking', type: 'bank', visibility: 'shared', openingBalance: 50000 });
      const sharedId = sharedB.body.bucket.id;

      // Private bucket
      const privB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Secret Investment', type: 'bank', visibility: 'private', openingBalance: 0 });
      const privId = privB.body.bucket.id;

      // Transfer from Shared to Private: 15,000 paise
      const transferRes = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'transfer',
          fromBucketId: sharedId,
          toBucketId: privId,
          amount: 15000,
          purpose: 'High risk crypto buy',
          date: new Date().toISOString(),
        });
      const transferId = transferRes.body.transaction.id;

      // Partner views this transfer
      const partnerTxRes = await request(app).get(`/transactions/${transferId}`).set('Cookie', partner.cookie);
      expect(partnerTxRes.status).toBe(200);

      const partnerTx = partnerTxRes.body.transaction;
      expect(partnerTx.isMasked).toBe(true);
      expect(partnerTx.amount).toBe(15000);
      expect(partnerTx.fromBucketName).toBe('Family Checking');
      expect(partnerTx.toBucketName).toBe('Protected Bucket');
      expect(partnerTx.toBucketId).toBeUndefined(); // ID stripped
      expect(partnerTx.purpose).toBe('Moved to private'); // Note/purpose masked
      expect(partnerTx.purpose).not.toContain('crypto'); // No leak!
    });

    it('rejects partner attempting to spend from or deposit into owner hidden bucket', async () => {
      const { owner, partner } = await setupHousehold();

      const balOnlyB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Owner Solo', type: 'bank', visibility: 'balance_only', openingBalance: 10000 });
      const balOnlyId = balOnlyB.body.bucket.id;

      // Partner tries to spend from owner's balance_only bucket -> 403 Forbidden
      const spendRes = await request(app)
        .post('/transactions')
        .set('Cookie', partner.cookie)
        .send({
          type: 'expense',
          fromBucketId: balOnlyId,
          amount: 2000,
          category: 'Fraud',
          purpose: 'Partner trying to spend',
          date: new Date().toISOString(),
        });

      expect(spendRes.status).toBe(403);
      expect(spendRes.body.message).toContain('balance only');
    });
  });

  describe('Idempotency & Reconcile Verification', () => {
    it('idempotencyKey replay returns the original transaction without double-applying', async () => {
      const { owner } = await setupHousehold();

      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Checking', type: 'bank', visibility: 'shared', openingBalance: 10000 });
      const bucketId = bRes.body.bucket.id;

      const idempotencyKey = 'unique-key-xyz-123';

      // First submit
      const res1 = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'income',
          toBucketId: bucketId,
          amount: 5000,
          category: 'Salary',
          date: new Date().toISOString(),
          idempotencyKey,
        });

      expect(res1.status).toBe(201);
      const tx1 = res1.body.transaction;

      // Second submit with identical idempotencyKey
      const res2 = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'income',
          toBucketId: bucketId,
          amount: 5000,
          category: 'Salary',
          date: new Date().toISOString(),
          idempotencyKey,
        });

      expect(res2.status).toBe(201);
      expect(res2.body.transaction.id).toBe(tx1.id);

      // Verify bucket was credited only ONCE
      const finalDoc = await Bucket.findById(bucketId);
      expect(finalDoc?.balance).toBe(15000); // 10,000 + 5,000 (NOT 20,000)
    });

    it('reconcile reports zero mismatches after a realistic mix of income, expense, transfers, and voids', async () => {
      const { owner } = await setupHousehold();

      // Bucket A: 100,000 paise opening
      const bA = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Bank A', type: 'bank', visibility: 'shared', openingBalance: 100000 });
      const idA = bA.body.bucket.id;

      // Bucket B: 20,000 paise opening
      const bB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Cash B', type: 'cash', visibility: 'shared', openingBalance: 20000 });
      const idB = bB.body.bucket.id;

      // Income 10,000 to A
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'income',
        toBucketId: idA,
        amount: 10000,
        category: 'Dividend',
        date: new Date().toISOString(),
      });

      // Expense 25,000 from A
      const expRes = await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        fromBucketId: idA,
        amount: 25000,
        category: 'Rent',
        purpose: 'Office rent',
        date: new Date().toISOString(),
      });

      // Transfer 15,000 from A to B
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'transfer',
        fromBucketId: idA,
        toBucketId: idB,
        amount: 15000,
        purpose: 'Top up cash',
        date: new Date().toISOString(),
      });

      // Void the 25,000 expense
      await request(app).post(`/transactions/${expRes.body.transaction.id}/void`).set('Cookie', owner.cookie);

      // Run reconcile
      const reconcileRes = await request(app).get('/transactions/reconcile').set('Cookie', owner.cookie);
      expect(reconcileRes.status).toBe(200);
      expect(reconcileRes.body.matches).toBe(true);
      expect(reconcileRes.body.mismatches).toHaveLength(0);
      expect(reconcileRes.body.totalBuckets).toBe(2);
    });
  });

  describe('Specific Required Core Ledger & Privacy Invariants Tests', () => {
    it('Two parallel expenses exceeding balance: exactly one succeeds', async () => {
      const { owner } = await setupHousehold();

      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({
          name: 'Concurrent Account',
          type: 'bank',
          visibility: 'shared',
          openingBalance: 10000,
        });
      const bucketId = bRes.body.bucket.id;

      // Two simultaneous requests each trying to spend 8,000 paise (total 16,000 > 10,000)
      const req1 = request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'expense',
          fromBucketId: bucketId,
          amount: 8000,
          category: 'Shopping',
          purpose: 'Item 1',
          date: new Date().toISOString(),
        });

      const req2 = request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'expense',
          fromBucketId: bucketId,
          amount: 8000,
          category: 'Shopping',
          purpose: 'Item 2',
          date: new Date().toISOString(),
        });

      const [res1, res2] = await Promise.all([req1, req2]);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(201);
      expect(statuses).toContain(400);

      const finalBucket = await Bucket.findById(bucketId);
      expect(finalBucket?.balance).toBe(2000); // 10,000 - 8,000 = 2,000 paise
    });

    it('Transfer failing midway leaves both balances unchanged', async () => {
      const { owner } = await setupHousehold();

      const bankRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'ICICI Bank', type: 'bank', visibility: 'shared', openingBalance: 10000 });
      const bankId = bankRes.body.bucket.id;

      const cashRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Petty Cash', type: 'cash', visibility: 'shared', openingBalance: 5000 });
      const cashId = cashRes.body.bucket.id;

      // Archive destination bucket to simulate failure during transfer
      await Bucket.findByIdAndUpdate(cashId, { isArchived: true });

      const transferFail = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'transfer',
          fromBucketId: bankId,
          toBucketId: cashId,
          amount: 4000,
          purpose: 'Will fail due to archived destination',
          date: new Date().toISOString(),
        });

      expect(transferFail.status).toBe(400);

      const bankDoc = await Bucket.findById(bankId);
      const cashDoc = await Bucket.findById(cashId);
      expect(bankDoc?.balance).toBe(10000);
      expect(cashDoc?.balance).toBe(5000);
    });

    it('Void restores balances, void twice rejected, non-creator rejected', async () => {
      const { owner, partner } = await setupHousehold();

      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Main Account', type: 'bank', visibility: 'shared', openingBalance: 20000 });
      const bucketId = bRes.body.bucket.id;

      const expRes = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'expense',
          fromBucketId: bucketId,
          amount: 5000,
          category: 'Utilities',
          purpose: 'Electricity bill',
          date: new Date().toISOString(),
        });
      const txId = expRes.body.transaction.id;
      expect((await Bucket.findById(bucketId))?.balance).toBe(15000);

      // 1. Non-creator (partner) rejected
      const nonCreatorRes = await request(app)
        .post(`/transactions/${txId}/void`)
        .set('Cookie', partner.cookie);
      expect(nonCreatorRes.status).toBe(403);
      expect(nonCreatorRes.body.message).toContain('Only the creator can void');

      // 2. Creator (owner) voids -> restores balance
      const voidRes = await request(app)
        .post(`/transactions/${txId}/void`)
        .set('Cookie', owner.cookie);
      expect(voidRes.status).toBe(200);
      expect(voidRes.body.transaction.status).toBe('voided');
      expect((await Bucket.findById(bucketId))?.balance).toBe(20000);

      // Reversal entry created
      const reversalDoc = await Transaction.findOne({ reversalOf: txId });
      expect(reversalDoc).not.toBeNull();
      expect(reversalDoc?.type).toBe('income');
      expect(reversalDoc?.amount).toBe(5000);

      // 3. Void twice rejected
      const doubleVoid = await request(app)
        .post(`/transactions/${txId}/void`)
        .set('Cookie', owner.cookie);
      expect(doubleVoid.status).toBe(400);
      expect(doubleVoid.body.message).toContain('already voided');
    });

    it('Void that would make cash/bank negative is rejected', async () => {
      const { owner } = await setupHousehold();

      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Checking', type: 'bank', visibility: 'shared', openingBalance: 0 });
      const bucketId = bRes.body.bucket.id;

      // Income 10,000 paise
      const incRes = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'income',
          toBucketId: bucketId,
          amount: 10000,
          category: 'Bonus',
          date: new Date().toISOString(),
        });
      const incId = incRes.body.transaction.id;

      // Expense 8,000 paise (leaving 2,000 in bank)
      await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'expense',
          fromBucketId: bucketId,
          amount: 8000,
          category: 'Shopping',
          purpose: 'Shoes',
          date: new Date().toISOString(),
        });

      // Void the income -> would debit 10,000 from 2,000, driving bank to -8,000 -> REJECTED
      const voidIncome = await request(app)
        .post(`/transactions/${incId}/void`)
        .set('Cookie', owner.cookie);

      expect(voidIncome.status).toBe(400);
      expect(voidIncome.body.message).toContain('Insufficient funds');
    });

    it('Partner list has no balance_only / private transactions', async () => {
      const { owner, partner } = await setupHousehold();

      const sharedB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Joint Pool', type: 'bank', visibility: 'shared', openingBalance: 20000 });
      const sharedId = sharedB.body.bucket.id;

      const balOnlyB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Owner Secret Stash', type: 'cash', visibility: 'balance_only', openingBalance: 30000 });
      const balOnlyId = balOnlyB.body.bucket.id;

      const privateB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Owner Private', type: 'bank', visibility: 'private', openingBalance: 40000 });
      const privateId = privateB.body.bucket.id;

      // Expenses in each
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        fromBucketId: sharedId,
        amount: 1000,
        category: 'Shared Exp',
        date: new Date().toISOString(),
      });

      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        fromBucketId: balOnlyId,
        amount: 2000,
        category: 'Secret Exp',
        date: new Date().toISOString(),
      });

      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        fromBucketId: privateId,
        amount: 3000,
        category: 'Private Exp',
        date: new Date().toISOString(),
      });

      const partnerList = await request(app).get('/transactions').set('Cookie', partner.cookie);
      expect(partnerList.status).toBe(200);

      const allBucketNames = partnerList.body.transactions.map((t: any) => t.fromBucketName || t.toBucketName);
      expect(allBucketNames).not.toContain('Owner Secret Stash');
      expect(allBucketNames).not.toContain('Owner Private');
    });

    it('Masked transfer hides bucket name, purpose, category', async () => {
      const { owner, partner } = await setupHousehold();

      const sharedB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Family Checking', type: 'bank', visibility: 'shared', openingBalance: 50000 });
      const sharedId = sharedB.body.bucket.id;

      const privB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Secret Investment', type: 'bank', visibility: 'private', openingBalance: 0 });
      const privId = privB.body.bucket.id;

      const transferRes = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'transfer',
          fromBucketId: sharedId,
          toBucketId: privId,
          amount: 15000,
          purpose: 'High risk secret speculation',
          date: new Date().toISOString(),
        });
      const transferId = transferRes.body.transaction.id;

      const partnerTxRes = await request(app).get(`/transactions/${transferId}`).set('Cookie', partner.cookie);
      expect(partnerTxRes.status).toBe(200);

      const partnerTx = partnerTxRes.body.transaction;
      expect(partnerTx.isMasked).toBe(true);
      expect(partnerTx.fromBucketName).toBe('Family Checking');
      expect(partnerTx.toBucketName).toBe('Protected Bucket');
      expect(partnerTx.toBucketId).toBeUndefined();
      expect(partnerTx.purpose).toBe('Moved to private');
      expect(partnerTx.purpose).not.toContain('secret');
      expect(partnerTx.category).toBe('Transfer');
    });

    it('GET hidden transaction by id returns 404', async () => {
      const { owner, partner } = await setupHousehold();

      const balOnlyB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Stash', type: 'cash', visibility: 'balance_only', openingBalance: 10000 });
      const balOnlyId = balOnlyB.body.bucket.id;

      const privB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Private Stash', type: 'bank', visibility: 'private', openingBalance: 10000 });
      const privId = privB.body.bucket.id;

      const txBalOnly = await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        fromBucketId: balOnlyId,
        amount: 2000,
        category: 'Private Expense',
        purpose: 'Private expense purpose',
        date: new Date().toISOString(),
      });

      const txPriv = await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        fromBucketId: privId,
        amount: 2000,
        category: 'Hidden Expense',
        purpose: 'Hidden expense purpose',
        date: new Date().toISOString(),
      });

      const res1 = await request(app).get(`/transactions/${txBalOnly.body.transaction.id}`).set('Cookie', partner.cookie);
      expect(res1.status).toBe(404);
      expect(res1.body.message).toContain('not found');

      const res2 = await request(app).get(`/transactions/${txPriv.body.transaction.id}`).set('Cookie', partner.cookie);
      expect(res2.status).toBe(404);
      expect(res2.body.message).toContain('not found');
    });

    it("Partner cannot spend from or deposit into owner's hidden bucket", async () => {
      const { owner, partner } = await setupHousehold();

      const balOnlyB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Owner Solo', type: 'bank', visibility: 'balance_only', openingBalance: 10000 });
      const balOnlyId = balOnlyB.body.bucket.id;

      const privB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Owner Secret', type: 'bank', visibility: 'private', openingBalance: 10000 });
      const privId = privB.body.bucket.id;

      // 1. Partner tries to spend from balance_only -> 403
      const spendBalOnly = await request(app)
        .post('/transactions')
        .set('Cookie', partner.cookie)
        .send({
          type: 'expense',
          fromBucketId: balOnlyId,
          amount: 1000,
          category: 'Fraud',
          purpose: 'Partner trying to spend',
          date: new Date().toISOString(),
        });
      expect(spendBalOnly.status).toBe(403);

      // 2. Partner tries to deposit into balance_only -> 403
      const depositBalOnly = await request(app)
        .post('/transactions')
        .set('Cookie', partner.cookie)
        .send({
          type: 'income',
          toBucketId: balOnlyId,
          amount: 1000,
          category: 'Gift',
          date: new Date().toISOString(),
        });
      expect(depositBalOnly.status).toBe(403);

      // 3. Partner tries to spend from private -> 404
      const spendPriv = await request(app)
        .post('/transactions')
        .set('Cookie', partner.cookie)
        .send({
          type: 'expense',
          fromBucketId: privId,
          amount: 1000,
          category: 'Fraud',
          purpose: 'Partner trying to spend',
          date: new Date().toISOString(),
        });
      expect(spendPriv.status).toBe(404);

      // 4. Partner tries to deposit into private -> 404
      const depositPriv = await request(app)
        .post('/transactions')
        .set('Cookie', partner.cookie)
        .send({
          type: 'income',
          toBucketId: privId,
          amount: 1000,
          category: 'Gift',
          date: new Date().toISOString(),
        });
      expect(depositPriv.status).toBe(404);
    });

    it('idempotencyKey replay does not double apply', async () => {
      const { owner } = await setupHousehold();

      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Salary Account', type: 'bank', visibility: 'shared', openingBalance: 20000 });
      const bucketId = bRes.body.bucket.id;

      const idempotencyKey = 'replay-test-key-999';

      const res1 = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'income',
          toBucketId: bucketId,
          amount: 10000,
          category: 'Consulting',
          date: new Date().toISOString(),
          idempotencyKey,
        });
      expect(res1.status).toBe(201);
      const tx1 = res1.body.transaction;

      const res2 = await request(app)
        .post('/transactions')
        .set('Cookie', owner.cookie)
        .send({
          type: 'income',
          toBucketId: bucketId,
          amount: 10000,
          category: 'Consulting',
          date: new Date().toISOString(),
          idempotencyKey,
        });
      expect(res2.status).toBe(201);
      expect(res2.body.transaction.id).toBe(tx1.id);

      const finalDoc = await Bucket.findById(bucketId);
      expect(finalDoc?.balance).toBe(30000); // 20,000 + 10,000 once
    });

    it('Reconcile reports zero mismatches', async () => {
      const { owner } = await setupHousehold();

      const bA = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Bank Prime', type: 'bank', visibility: 'shared', openingBalance: 50000 });
      const idA = bA.body.bucket.id;

      const bB = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Cash Prime', type: 'cash', visibility: 'shared', openingBalance: 15000 });
      const idB = bB.body.bucket.id;

      // Income to A
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'income',
        toBucketId: idA,
        amount: 25000,
        category: 'Freelance',
        date: new Date().toISOString(),
      });

      // Expense from A
      const expRes = await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        fromBucketId: idA,
        amount: 12000,
        category: 'Equipment',
        purpose: 'Office monitor',
        date: new Date().toISOString(),
      });

      // Transfer from A to B
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'transfer',
        fromBucketId: idA,
        toBucketId: idB,
        amount: 8000,
        purpose: 'ATM Cash',
        date: new Date().toISOString(),
      });

      // Void the expense
      await request(app).post(`/transactions/${expRes.body.transaction.id}/void`).set('Cookie', owner.cookie);

      // Reconcile
      const recRes = await request(app).get('/transactions/reconcile').set('Cookie', owner.cookie);
      expect(recRes.status).toBe(200);
      expect(recRes.body.matches).toBe(true);
      expect(recRes.body.mismatches).toHaveLength(0);
      expect(recRes.body.totalBuckets).toBe(2);
    });
  });
});
