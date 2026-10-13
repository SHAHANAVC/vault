import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../app';
import { User } from '../models/User';
import { Bucket } from '../models/Bucket';
import { Transaction } from '../models/Transaction';

describe('Phase 5: Split Income, Split Transfer & Adjustment Integration Tests', () => {
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
    const cookie = res.headers['set-cookie'];
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

  describe('POST /transactions/split-income', () => {
    it('saves all lines with one groupId and updates destination bucket balances atomically', async () => {
      const { owner } = await setupHousehold();

      // Create 3 buckets
      const b1 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Bank Account',
        type: 'bank',
        visibility: 'shared',
      });
      const b2 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Wallet Cash',
        type: 'cash',
        visibility: 'shared',
      });

      const res = await request(app)
        .post('/transactions/split-income')
        .set('Cookie', owner.cookie)
        .send({
          totalAmount: 100000, // ₹1,000.00
          source: 'Freelance Gig',
          purpose: 'Web Design Project',
          date: new Date().toISOString(),
          allocations: [
            { bucketId: b1.body.bucket.id, amount: 70000, note: '70% bank' },
            { bucketId: b2.body.bucket.id, amount: 30000, note: '30% cash' },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.group.linesCount).toBe(2);
      expect(res.body.group.totalAmount).toBe(100000);
      expect(res.body.group.groupId).toBeDefined();

      const b1After = await Bucket.findById(b1.body.bucket.id);
      const b2After = await Bucket.findById(b2.body.bucket.id);
      expect(b1After?.balance).toBe(70000);
      expect(b2After?.balance).toBe(30000);

      // Verify all lines share identical groupId in DB
      const dbTxs = await Transaction.find({ groupId: res.body.group.groupId });
      expect(dbTxs).toHaveLength(2);
      expect(dbTxs.every((t) => t.status === 'active')).toBe(true);
    });

    it('rejects split income when allocations sum does not match totalAmount', async () => {
      const { owner } = await setupHousehold();

      const b1 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Bank Account',
        type: 'bank',
        visibility: 'shared',
      });

      const res = await request(app)
        .post('/transactions/split-income')
        .set('Cookie', owner.cookie)
        .send({
          totalAmount: 100000,
          source: 'Salary',
          date: new Date().toISOString(),
          allocations: [{ bucketId: b1.body.bucket.id, amount: 90000 }], // 90000 != 100000
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid split income input');
    });

    it('rejects split income with duplicate bucketId in allocations', async () => {
      const { owner } = await setupHousehold();

      const b1 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Bank Account',
        type: 'bank',
        visibility: 'shared',
      });

      const res = await request(app)
        .post('/transactions/split-income')
        .set('Cookie', owner.cookie)
        .send({
          totalAmount: 100000,
          source: 'Salary',
          date: new Date().toISOString(),
          allocations: [
            { bucketId: b1.body.bucket.id, amount: 50000 },
            { bucketId: b1.body.bucket.id, amount: 50000 }, // Duplicate!
          ],
        });

      expect(res.status).toBe(400);
    });

    it('rolls back completely if one destination bucket fails (e.g. archived bucket)', async () => {
      const { owner } = await setupHousehold();

      const bActive = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Active Bank',
        type: 'bank',
        visibility: 'shared',
      });
      const bArchived = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Archived Bank',
        type: 'bank',
        visibility: 'shared',
      });

      // Archive bArchived
      await request(app).post(`/buckets/${bArchived.body.bucket.id}/archive`).set('Cookie', owner.cookie);

      const res = await request(app)
        .post('/transactions/split-income')
        .set('Cookie', owner.cookie)
        .send({
          totalAmount: 50000,
          source: 'Bonus',
          date: new Date().toISOString(),
          allocations: [
            { bucketId: bActive.body.bucket.id, amount: 30000 },
            { bucketId: bArchived.body.bucket.id, amount: 20000 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('archived');

      // Atomic check: Active bucket balance remains 0
      const bActiveDoc = await Bucket.findById(bActive.body.bucket.id);
      expect(bActiveDoc?.balance).toBe(0);

      const txCount = await Transaction.countDocuments({});
      expect(txCount).toBe(0);
    });

    it('partner querying GET /transactions and groups masks split income into private/balance_only bucket', async () => {
      const { owner, partner } = await setupHousehold();

      const bShared = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Household Shared Fund',
        type: 'bank',
        visibility: 'shared',
      });
      const bPrivate = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Arjun Secret Stash',
        type: 'cash',
        visibility: 'private',
      });

      const splitRes = await request(app)
        .post('/transactions/split-income')
        .set('Cookie', owner.cookie)
        .send({
          totalAmount: 100000,
          source: 'Monthly Bonus',
          purpose: 'Bonus distribution',
          date: new Date().toISOString(),
          allocations: [
            { bucketId: bShared.body.bucket.id, amount: 60000, note: 'For household' },
            { bucketId: bPrivate.body.bucket.id, amount: 40000, note: 'For personal hobbies' },
          ],
        });
      expect(splitRes.status).toBe(201);
      const groupId = splitRes.body.group.groupId;

      // Partner checks group endpoint
      const partnerGroupRes = await request(app)
        .get(`/transactions/groups/${groupId}`)
        .set('Cookie', partner.cookie);

      expect(partnerGroupRes.status).toBe(200);
      expect(partnerGroupRes.body.group.linesCount).toBe(2);
      expect(partnerGroupRes.body.group.visibleLinesCount).toBe(1);
      // Partner sees visible lines total only
      expect(partnerGroupRes.body.group.totalAmount).toBe(60000);

      // Line 1 is visible (Shared)
      const visibleLine = partnerGroupRes.body.group.lines.find((l: any) => !l.isMasked);
      expect(visibleLine).toBeDefined();
      expect(visibleLine.amount).toBe(60000);
      expect(visibleLine.toBucketName).toBe('Household Shared Fund');

      // Line 2 is masked (Private)
      const maskedLine = partnerGroupRes.body.group.lines.find((l: any) => l.isMasked);
      expect(maskedLine).toBeDefined();
      expect(maskedLine.amount).toBe(0);
      expect(maskedLine.toBucketName).toBeUndefined();
      expect(maskedLine.purpose).toBe('Another allocation (private)');

      // Partner checks transactions list: does NOT see the private line
      const partnerListRes = await request(app).get('/transactions').set('Cookie', partner.cookie);
      expect(partnerListRes.body.transactions).toHaveLength(1);
      expect(partnerListRes.body.transactions[0].amount).toBe(60000);
    });

    it('rejects partner attempting to allocate income into owner private or balance_only bucket', async () => {
      const { owner, partner } = await setupHousehold();

      const bOwnerBalOnly = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Arjun Personal Bank',
        type: 'bank',
        visibility: 'balance_only',
      });
      const bPartnerCash = await request(app).post('/buckets').set('Cookie', partner.cookie).send({
        name: 'Priya Cash',
        type: 'cash',
        visibility: 'shared',
      });

      const res = await request(app)
        .post('/transactions/split-income')
        .set('Cookie', partner.cookie)
        .send({
          totalAmount: 20000,
          source: 'Consulting',
          date: new Date().toISOString(),
          allocations: [
            { bucketId: bPartnerCash.body.bucket.id, amount: 10000 },
            { bucketId: bOwnerBalOnly.body.bucket.id, amount: 10000 },
          ],
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('balance only');
    });
  });

  describe('POST /transactions/split-transfer', () => {
    it('debits source bucket by the exact total and credits all destinations atomically', async () => {
      const { owner } = await setupHousehold();

      const src = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Salary Master Account',
        type: 'bank',
        visibility: 'shared',
        openingBalance: 100000, // ₹1,000.00
      });
      const dst1 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Groceries Cash',
        type: 'cash',
        visibility: 'shared',
      });
      const dst2 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Emergency Fund',
        type: 'bank',
        visibility: 'shared',
      });

      const res = await request(app)
        .post('/transactions/split-transfer')
        .set('Cookie', owner.cookie)
        .send({
          fromBucketId: src.body.bucket.id,
          totalAmount: 60000, // ₹600.00
          purpose: 'Biweekly allocation',
          date: new Date().toISOString(),
          destinations: [
            { bucketId: dst1.body.bucket.id, amount: 40000, note: 'Grocery allowance' },
            { bucketId: dst2.body.bucket.id, amount: 20000, note: 'Emergency savings' },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.group.linesCount).toBe(2);
      expect(res.body.group.totalAmount).toBe(60000);

      const srcAfter = await Bucket.findById(src.body.bucket.id);
      const dst1After = await Bucket.findById(dst1.body.bucket.id);
      const dst2After = await Bucket.findById(dst2.body.bucket.id);

      expect(srcAfter?.balance).toBe(40000); // 100,000 - 60,000 = 40,000
      expect(dst1After?.balance).toBe(40000);
      expect(dst2After?.balance).toBe(20000);

      // Household net total remains conserved: 40,000 + 40,000 + 20,000 = 100,000
      const summary = await request(app).get('/buckets/summary').set('Cookie', owner.cookie);
      expect(summary.body.householdTotal).toBe(100000);
    });

    it('rejects split transfer when source cash/bank bucket has insufficient balance (zero float overdraft)', async () => {
      const { owner } = await setupHousehold();

      const src = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Small Cash Pocket',
        type: 'cash',
        visibility: 'shared',
        openingBalance: 30000, // ₹300.00
      });
      const dst = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Savings',
        type: 'bank',
        visibility: 'shared',
      });

      const res = await request(app)
        .post('/transactions/split-transfer')
        .set('Cookie', owner.cookie)
        .send({
          fromBucketId: src.body.bucket.id,
          totalAmount: 50000, // exceeds 30,000!
          date: new Date().toISOString(),
          destinations: [{ bucketId: dst.body.bucket.id, amount: 50000 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Insufficient funds');

      const srcAfter = await Bucket.findById(src.body.bucket.id);
      expect(srcAfter?.balance).toBe(30000); // Intact
    });

    it('handles concurrent parallel split transfers safely with zero overdraft', async () => {
      const { owner } = await setupHousehold();

      const src = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Limited Bank',
        type: 'bank',
        visibility: 'shared',
        openingBalance: 100000, // ₹1,000.00
      });
      const dst = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Cash Vault',
        type: 'cash',
        visibility: 'shared',
      });

      // Submit 3 parallel transfers of 40,000 each (Total requested: 120,000 > 100,000)
      const results = await Promise.all([
        request(app).post('/transactions/split-transfer').set('Cookie', owner.cookie).send({
          fromBucketId: src.body.bucket.id,
          totalAmount: 40000,
          date: new Date().toISOString(),
          destinations: [{ bucketId: dst.body.bucket.id, amount: 40000 }],
        }),
        request(app).post('/transactions/split-transfer').set('Cookie', owner.cookie).send({
          fromBucketId: src.body.bucket.id,
          totalAmount: 40000,
          date: new Date().toISOString(),
          destinations: [{ bucketId: dst.body.bucket.id, amount: 40000 }],
        }),
        request(app).post('/transactions/split-transfer').set('Cookie', owner.cookie).send({
          fromBucketId: src.body.bucket.id,
          totalAmount: 40000,
          date: new Date().toISOString(),
          destinations: [{ bucketId: dst.body.bucket.id, amount: 40000 }],
        }),
      ]);

      const successCount = results.filter((r) => r.status === 201).length;
      const failCount = results.filter((r) => r.status === 400).length;

      // Exactly 2 transfers of 40,000 can succeed (80,000 consumed), and 1 must fail due to insufficient funds (remaining 20,000 < 40,000)
      expect(successCount).toBe(2);
      expect(failCount).toBe(1);

      const srcAfter = await Bucket.findById(src.body.bucket.id);
      expect(srcAfter?.balance).toBe(20000); // 100,000 - 80,000 = 20,000 paise (never negative!)
    });
  });

  describe('POST /transactions/adjustment', () => {
    it('creates adjustment with required reason, increasing balance on positive and decreasing on negative', async () => {
      const { owner } = await setupHousehold();

      const bucket = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'HDFC Bank',
        type: 'bank',
        visibility: 'shared',
        openingBalance: 50000, // ₹500.00
      });
      const bId = bucket.body.bucket.id;

      // 1. Positive adjustment: +₹50.00 (5,000 paise interest)
      const adjPos = await request(app).post('/transactions/adjustment').set('Cookie', owner.cookie).send({
        bucketId: bId,
        amount: 5000,
        reason: 'Quarterly bank interest credited per passbook',
        date: new Date().toISOString(),
      });
      expect(adjPos.status).toBe(201);
      expect(adjPos.body.transaction.type).toBe('adjustment');
      expect(adjPos.body.transaction.amount).toBe(5000);
      expect(adjPos.body.transaction.reason).toBe('Quarterly bank interest credited per passbook');

      const bAfterPos = await Bucket.findById(bId);
      expect(bAfterPos?.balance).toBe(55000);

      // 2. Negative adjustment: -₹20.00 (2,000 paise SMS charges)
      const adjNeg = await request(app).post('/transactions/adjustment').set('Cookie', owner.cookie).send({
        bucketId: bId,
        amount: -2000,
        reason: 'Annual SMS maintenance charges deducted',
        date: new Date().toISOString(),
      });
      expect(adjNeg.status).toBe(201);
      expect(adjNeg.body.transaction.amount).toBe(2000);

      const bAfterNeg = await Bucket.findById(bId);
      expect(bAfterNeg?.balance).toBe(53000);
    });

    it('rejects adjustment missing a reason or with short reason', async () => {
      const { owner } = await setupHousehold();
      const b = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Cash',
        type: 'cash',
        visibility: 'shared',
      });

      const res = await request(app).post('/transactions/adjustment').set('Cookie', owner.cookie).send({
        bucketId: b.body.bucket.id,
        amount: 1000,
        reason: '  ',
        date: new Date().toISOString(),
      });
      expect(res.status).toBe(400);
    });

    it('rejects negative adjustment driving cash or bank below zero', async () => {
      const { owner } = await setupHousehold();
      const b = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Cash Pocket',
        type: 'cash',
        visibility: 'shared',
        openingBalance: 1000, // ₹10.00
      });

      const res = await request(app).post('/transactions/adjustment').set('Cookie', owner.cookie).send({
        bucketId: b.body.bucket.id,
        amount: -5000, // -₹50.00 > 1,000 balance!
        reason: 'Unrecorded purchase adjustment',
        date: new Date().toISOString(),
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Insufficient funds');
    });

    it('rejects partner adjusting a bucket owned by the other user', async () => {
      const { owner, partner } = await setupHousehold();
      const b = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Arjun Bank',
        type: 'bank',
        visibility: 'shared',
      });

      const res = await request(app).post('/transactions/adjustment').set('Cookie', partner.cookie).send({
        bucketId: b.body.bucket.id,
        amount: 1000,
        reason: 'Partner attempt',
        date: new Date().toISOString(),
      });
      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Only the bucket owner can adjust');
    });
  });

  describe('Group Voiding & Consistency Rules', () => {
    it('voids all lines in a group and creates reversals in one session', async () => {
      const { owner } = await setupHousehold();

      const b1 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Savings A',
        type: 'bank',
        visibility: 'shared',
      });
      const b2 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Savings B',
        type: 'bank',
        visibility: 'shared',
      });

      const splitRes = await request(app).post('/transactions/split-income').set('Cookie', owner.cookie).send({
        totalAmount: 100000,
        source: 'Client Retainer',
        date: new Date().toISOString(),
        allocations: [
          { bucketId: b1.body.bucket.id, amount: 60000 },
          { bucketId: b2.body.bucket.id, amount: 40000 },
        ],
      });
      const groupId = splitRes.body.group.groupId;

      // Void the group
      const voidRes = await request(app)
        .post(`/transactions/groups/${groupId}/void`)
        .set('Cookie', owner.cookie);

      expect(voidRes.status).toBe(200);
      expect(voidRes.body.group.status).toBe('voided');

      // Balances restored to 0
      const b1After = await Bucket.findById(b1.body.bucket.id);
      const b2After = await Bucket.findById(b2.body.bucket.id);
      expect(b1After?.balance).toBe(0);
      expect(b2After?.balance).toBe(0);

      // Reversal entries recorded
      const reversals = await Transaction.find({ groupId: `reversal_${groupId}` });
      expect(reversals).toHaveLength(2);
      expect(reversals.every((r) => r.type === 'expense' && r.status === 'active')).toBe(true);
    });

    it('rejects voiding an individual line of a split group (must void group as a whole)', async () => {
      const { owner } = await setupHousehold();

      const b1 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Wallet A',
        type: 'cash',
        visibility: 'shared',
      });
      const b2 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Wallet B',
        type: 'cash',
        visibility: 'shared',
      });

      const splitRes = await request(app).post('/transactions/split-income').set('Cookie', owner.cookie).send({
        totalAmount: 20000,
        source: 'Gift',
        date: new Date().toISOString(),
        allocations: [
          { bucketId: b1.body.bucket.id, amount: 10000 },
          { bucketId: b2.body.bucket.id, amount: 10000 },
        ],
      });

      const lineId = splitRes.body.group.lines[0].id;

      // Attempt to void single line
      const singleVoidRes = await request(app)
        .post(`/transactions/${lineId}/void`)
        .set('Cookie', owner.cookie);

      expect(singleVoidRes.status).toBe(400);
      expect(singleVoidRes.body.message).toContain('part of a split group');
      expect(singleVoidRes.body.message).toContain('must be voided as a whole');
    });

    it('rejects group void if any reversal would push cash/bank negative, rolling back everything', async () => {
      const { owner } = await setupHousehold();

      const bCash = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Daily Cash',
        type: 'cash',
        visibility: 'shared',
      });
      const bBank = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Main Bank',
        type: 'bank',
        visibility: 'shared',
      });

      const splitRes = await request(app).post('/transactions/split-income').set('Cookie', owner.cookie).send({
        totalAmount: 50000,
        source: 'Gig',
        date: new Date().toISOString(),
        allocations: [
          { bucketId: bCash.body.bucket.id, amount: 20000 },
          { bucketId: bBank.body.bucket.id, amount: 30000 },
        ],
      });
      const groupId = splitRes.body.group.groupId;

      // Spend 15,000 from cash (leaving 5,000 in cash)
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        fromBucketId: bCash.body.bucket.id,
        amount: 15000,
        category: 'Food',
        purpose: 'Dinner',
        date: new Date().toISOString(),
      });

      // Attempt to void the split income group: Reversing bCash requires debiting 20,000, but only 5,000 is available!
      const voidRes = await request(app)
        .post(`/transactions/groups/${groupId}/void`)
        .set('Cookie', owner.cookie);

      expect(voidRes.status).toBe(400);
      expect(voidRes.body.message).toContain('Insufficient funds');

      // Check atomic rollback: Bank balance remains 30,000, cash remains 5,000
      const bCashDoc = await Bucket.findById(bCash.body.bucket.id);
      const bBankDoc = await Bucket.findById(bBank.body.bucket.id);
      expect(bCashDoc?.balance).toBe(5000);
      expect(bBankDoc?.balance).toBe(30000);
    });

    it('rejects partner attempting to void group created by owner and rejects double void', async () => {
      const { owner, partner } = await setupHousehold();

      const b = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Shared Pot',
        type: 'bank',
        visibility: 'shared',
      });

      const splitRes = await request(app).post('/transactions/split-income').set('Cookie', owner.cookie).send({
        totalAmount: 10000,
        source: 'Gift',
        date: new Date().toISOString(),
        allocations: [{ bucketId: b.body.bucket.id, amount: 10000 }],
      });
      const groupId = splitRes.body.group.groupId;

      // 1. Partner void attempt -> 403
      const partnerVoid = await request(app)
        .post(`/transactions/groups/${groupId}/void`)
        .set('Cookie', partner.cookie);
      expect(partnerVoid.status).toBe(403);

      // 2. Owner voids -> 200
      const ownerVoid = await request(app)
        .post(`/transactions/groups/${groupId}/void`)
        .set('Cookie', owner.cookie);
      expect(ownerVoid.status).toBe(200);

      // 3. Second void attempt -> 400
      const secondVoid = await request(app)
        .post(`/transactions/groups/${groupId}/void`)
        .set('Cookie', owner.cookie);
      expect(secondVoid.status).toBe(400);
      expect(secondVoid.body.message).toContain('already voided');
    });
  });

  describe('Idempotency & Reconcile Verification', () => {
    it('replays split income, split transfer, and adjustment with idempotencyKey without double applying', async () => {
      const { owner } = await setupHousehold();

      const b1 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Bank 1',
        type: 'bank',
        visibility: 'shared',
      });
      const b2 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Bank 2',
        type: 'bank',
        visibility: 'shared',
      });

      // 1. Split Income Idempotency
      const key1 = 'income-key-abc';
      const inc1 = await request(app).post('/transactions/split-income').set('Cookie', owner.cookie).send({
        totalAmount: 50000,
        source: 'Salary',
        date: new Date().toISOString(),
        allocations: [{ bucketId: b1.body.bucket.id, amount: 50000 }],
        idempotencyKey: key1,
      });
      expect(inc1.status).toBe(201);

      const inc2 = await request(app).post('/transactions/split-income').set('Cookie', owner.cookie).send({
        totalAmount: 50000,
        source: 'Salary',
        date: new Date().toISOString(),
        allocations: [{ bucketId: b1.body.bucket.id, amount: 50000 }],
        idempotencyKey: key1,
      });
      expect(inc2.status).toBe(201);
      expect(inc2.body.group.groupId).toBe(inc1.body.group.groupId);

      const b1Doc = await Bucket.findById(b1.body.bucket.id);
      expect(b1Doc?.balance).toBe(50000); // Only applied once!

      // 2. Split Transfer Idempotency
      const key2 = 'transfer-key-xyz';
      const trf1 = await request(app).post('/transactions/split-transfer').set('Cookie', owner.cookie).send({
        fromBucketId: b1.body.bucket.id,
        totalAmount: 20000,
        date: new Date().toISOString(),
        destinations: [{ bucketId: b2.body.bucket.id, amount: 20000 }],
        idempotencyKey: key2,
      });
      expect(trf1.status).toBe(201);

      const trf2 = await request(app).post('/transactions/split-transfer').set('Cookie', owner.cookie).send({
        fromBucketId: b1.body.bucket.id,
        totalAmount: 20000,
        date: new Date().toISOString(),
        destinations: [{ bucketId: b2.body.bucket.id, amount: 20000 }],
        idempotencyKey: key2,
      });
      expect(trf2.status).toBe(201);

      const b2Doc = await Bucket.findById(b2.body.bucket.id);
      expect(b2Doc?.balance).toBe(20000); // Only applied once!

      // 3. Adjustment Idempotency
      const key3 = 'adj-key-123';
      const adj1 = await request(app).post('/transactions/adjustment').set('Cookie', owner.cookie).send({
        bucketId: b2.body.bucket.id,
        amount: 5000,
        reason: 'Monthly interest',
        date: new Date().toISOString(),
        idempotencyKey: key3,
      });
      expect(adj1.status).toBe(201);

      const adj2 = await request(app).post('/transactions/adjustment').set('Cookie', owner.cookie).send({
        bucketId: b2.body.bucket.id,
        amount: 5000,
        reason: 'Monthly interest',
        date: new Date().toISOString(),
        idempotencyKey: key3,
      });
      expect(adj2.status).toBe(201);
      expect(adj2.body.transaction.id).toBe(adj1.body.transaction.id);

      const b2DocFinal = await Bucket.findById(b2.body.bucket.id);
      expect(b2DocFinal?.balance).toBe(25000); // 20,000 + 5,000 = 25,000
    });

    it('realistic scenario test: Salary ₹20,000 split into Kuri ₹5,000, Loan ₹3,000, Pocket (balance_only) ₹2,000, and Cash ₹10,000', async () => {
      const { owner, partner } = await setupHousehold();

      // Create buckets
      const bKuri = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Kuri Fund',
        type: 'kuri',
        visibility: 'shared',
      });
      const bLoan = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Loan to Ramu',
        type: 'loan_given',
        visibility: 'shared',
      });
      const bPocket = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'My Pocket Cash',
        type: 'cash',
        visibility: 'balance_only',
      });
      const bCash = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'House Cash Vault',
        type: 'cash',
        visibility: 'shared',
      });

      // Split income of 2,000,000 paise (₹20,000)
      const splitRes = await request(app)
        .post('/transactions/split-income')
        .set('Cookie', owner.cookie)
        .send({
          totalAmount: 2000000, // ₹20,000.00
          source: 'Monthly Company Salary',
          purpose: 'Salary Distribution',
          date: new Date().toISOString(),
          allocations: [
            { bucketId: bKuri.body.bucket.id, amount: 500000, note: 'Kuri installment' },
            { bucketId: bLoan.body.bucket.id, amount: 300000, note: 'Ramu loan repayment' },
            { bucketId: bPocket.body.bucket.id, amount: 200000, note: 'Personal pocket money' },
            { bucketId: bCash.body.bucket.id, amount: 1000000, note: 'Household cash' },
          ],
        });

      expect(splitRes.status).toBe(201);
      const groupId = splitRes.body.group.groupId;

      // 1. Verify exact bucket balances
      const kuriDoc = await Bucket.findById(bKuri.body.bucket.id);
      const loanDoc = await Bucket.findById(bLoan.body.bucket.id);
      const pocketDoc = await Bucket.findById(bPocket.body.bucket.id);
      const cashDoc = await Bucket.findById(bCash.body.bucket.id);

      expect(kuriDoc?.balance).toBe(500000);
      expect(loanDoc?.balance).toBe(300000);
      expect(pocketDoc?.balance).toBe(200000);
      expect(cashDoc?.balance).toBe(1000000);

      // 2. Verify household summaries for both owner and partner
      const ownerSummary = await request(app).get('/buckets/summary').set('Cookie', owner.cookie);
      expect(ownerSummary.body.householdTotal).toBe(2000000);

      const partnerSummary = await request(app).get('/buckets/summary').set('Cookie', partner.cookie);
      // Both see 20,000 total (since balance_only is counted in householdTotal)
      expect(partnerSummary.body.householdTotal).toBe(2000000);

      // 3. Partner Group View verification
      const partnerGroupRes = await request(app)
        .get(`/transactions/groups/${groupId}`)
        .set('Cookie', partner.cookie);

      expect(partnerGroupRes.status).toBe(200);
      expect(partnerGroupRes.body.group.linesCount).toBe(4);
      expect(partnerGroupRes.body.group.visibleLinesCount).toBe(3);
      // Visible lines total = 5,000 + 3,000 + 10,000 = 18,000
      expect(partnerGroupRes.body.group.totalAmount).toBe(1800000);

      const partnerLines = partnerGroupRes.body.group.lines;
      const maskedCount = partnerLines.filter((l: any) => l.isMasked).length;
      expect(maskedCount).toBe(1); // Exactly the balance_only pocket money line is masked

      // 4. Run ledger reconciliation across the household
      const reconcileRes = await request(app).get('/transactions/reconcile').set('Cookie', owner.cookie);
      expect(reconcileRes.status).toBe(200);
      expect(reconcileRes.body.matches).toBe(true);
      expect(reconcileRes.body.mismatches).toHaveLength(0);
      expect(reconcileRes.body.totalBuckets).toBe(4);
    });
  });
});
