import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../app';
import { User } from '../models/User';
import { Household } from '../models/Household';
import { Invite } from '../models/Invite';
import { Bucket } from '../models/Bucket';
import { Transaction } from '../models/Transaction';

describe('Phase 4A: Buckets & Backend-Enforced Privacy Tests', () => {
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
  }, 30000);

  beforeEach(async () => {
    await User.deleteMany({});
    await Household.deleteMany({});
    await Invite.deleteMany({});
    await Bucket.deleteMany({});
  });

  // Helper to register and obtain cookie
  async function registerUser(name: string, email: string, password = 'Password123', inviteToken?: string) {
    const res = await request(app)
      .post('/auth/register')
      .send({ name, email, password, ...(inviteToken ? { inviteToken } : {}) });
    
    expect(res.status).toBe(201);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const tokenCookie = cookies.find((c) => c.startsWith('token='));
    return {
      user: res.body.user,
      cookie: tokenCookie || '',
    };
  }

  describe('Bucket Creation & Balance Invariants', () => {
    it('creates a bucket initialized to 0 paise even if openingBalance or balance is in request body', async () => {
      const { cookie, user } = await registerUser('Arjun', 'arjun@example.com');

      const res = await request(app)
        .post('/buckets')
        .set('Cookie', cookie)
        .send({
          name: 'SBI Salary Account',
          type: 'bank',
          visibility: 'shared',
          description: 'Primary income account',
          openingBalance: 500000, // 5,000 INR
          balance: 999999, // Arbitrary direct balance editing is ignored by schema
        });

      expect(res.status).toBe(201);
      expect(res.body.bucket).toBeDefined();
      expect(res.body.bucket.name).toBe('SBI Salary Account');
      expect(res.body.bucket.balance).toBe(500000); // 500000 paise from opening balance ledger entry
      expect(res.body.bucket.isOwner).toBe(true);

      const dbDoc = await Bucket.findById(res.body.bucket.id);
      expect(dbDoc).not.toBeNull();
      expect(dbDoc?.balance).toBe(500000);
      expect(dbDoc?.ownerId.toString()).toBe(user.id);

      // Verify that an opening balance transaction was recorded in the ledger
      const tx = await Transaction.findOne({ toBucketId: res.body.bucket.id });
      expect(tx).not.toBeNull();
      expect(tx?.type).toBe('income');
      expect(tx?.amount).toBe(500000);
      expect(tx?.category).toBe('Opening balance');
      expect(tx?.status).toBe('active');
    });

    it('creates a bucket initialized to 0 paise when no openingBalance is provided even if balance is passed', async () => {
      const { cookie } = await registerUser('ZeroBalance', 'zero@example.com');

      const res = await request(app)
        .post('/buckets')
        .set('Cookie', cookie)
        .send({
          name: 'Zero Balance Bucket',
          type: 'cash',
          visibility: 'shared',
          balance: 888888, // Direct balance input ignored
        });

      expect(res.status).toBe(201);
      expect(res.body.bucket.balance).toBe(0);

      const dbDoc = await Bucket.findById(res.body.bucket.id);
      expect(dbDoc?.balance).toBe(0);

      // No transaction created
      const txCount = await Transaction.countDocuments({ toBucketId: res.body.bucket.id });
      expect(txCount).toBe(0);
    });

    it('creates a bucket named "Cash" with type "cash" and accurately saves type as "cash" (not "bank")', async () => {
      const { cookie } = await registerUser('Arjun', 'arjun_cash@example.com');

      const res = await request(app)
        .post('/buckets')
        .set('Cookie', cookie)
        .send({
          name: 'Cash',
          type: 'cash',
          visibility: 'shared',
        });

      expect(res.status).toBe(201);
      expect(res.body.bucket.name).toBe('Cash');
      expect(res.body.bucket.type).toBe('cash'); // Must be cash, never default to bank

      const dbDoc = await Bucket.findById(res.body.bucket.id);
      expect(dbDoc?.type).toBe('cash');
    });

    it('validates bucket input schema and rejects invalid type or empty name', async () => {
      const { cookie } = await registerUser('Arjun', 'arjun2@example.com');

      const res = await request(app)
        .post('/buckets')
        .set('Cookie', cookie)
        .send({
          name: '',
          type: 'invalid_type',
          visibility: 'shared',
        });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });
  });

  describe('Privacy Matrix & Policy Enforcement', () => {
    let ownerCookie: string;
    let partnerCookie: string;
    let otherCookie: string;

    let sharedBucketId: string;
    let balanceOnlyBucketId: string;
    let privateBucketId: string;

    beforeEach(async () => {
      // 1. Create Household 1 with Owner (Maya)
      const owner = await registerUser('Maya', 'maya@example.com');
      ownerCookie = owner.cookie;

      // 2. Invite Partner (Dev) into Household 1
      const inviteRes = await request(app).post('/invites').set('Cookie', ownerCookie);
      const inviteToken = inviteRes.body.token as string;

      const partner = await registerUser('Dev', 'dev@example.com', 'Password123', inviteToken);
      partnerCookie = partner.cookie;

      // 3. Create Household 2 with Other User (Stranger)
      const other = await registerUser('Stranger', 'stranger@example.com');
      otherCookie = other.cookie;

      // 4. Owner creates 3 buckets with different visibilities
      const bShared = await request(app)
        .post('/buckets')
        .set('Cookie', ownerCookie)
        .send({
          name: 'Joint Emergency Fund',
          type: 'bank',
          visibility: 'shared',
          description: '3 months living expenses',
        });
      sharedBucketId = bShared.body.bucket.id;

      const bBalanceOnly = await request(app)
        .post('/buckets')
        .set('Cookie', ownerCookie)
        .send({
          name: 'Discretionary Vault',
          type: 'cash',
          visibility: 'balance_only',
          description: 'Owner private personal notes',
        });
      balanceOnlyBucketId = bBalanceOnly.body.bucket.id;

      const bPrivate = await request(app)
        .post('/buckets')
        .set('Cookie', ownerCookie)
        .send({
          name: 'Personal Crypto',
          type: 'cash',
          visibility: 'private',
          description: 'Secret savings',
        });
      privateBucketId = bPrivate.body.bucket.id;
    });

    it('allows owner to see all buckets with full descriptions and metadata', async () => {
      const res = await request(app).get('/buckets').set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      expect(res.body.buckets).toHaveLength(3);

      const privateB = res.body.buckets.find((b: { id: string }) => b.id === privateBucketId);
      expect(privateB).toBeDefined();
      expect(privateB.description).toBe('Secret savings');
      expect(privateB.isOwner).toBe(true);
      expect(privateB.canViewTransactions).toBe(true);

      const balanceOnlyB = res.body.buckets.find((b: { id: string }) => b.id === balanceOnlyBucketId);
      expect(balanceOnlyB).toBeDefined();
      expect(balanceOnlyB.description).toBe('Owner private personal notes');
      expect(balanceOnlyB.canViewTransactions).toBe(true);
    });

    it('partner list query excludes private buckets and strips description for balance_only', async () => {
      const res = await request(app).get('/buckets').set('Cookie', partnerCookie);
      expect(res.status).toBe(200);
      
      // Must only contain shared and balance_only (private bucket is completely omitted)
      expect(res.body.buckets).toHaveLength(2);
      const ids = res.body.buckets.map((b: { id: string }) => b.id);
      expect(ids).toContain(sharedBucketId);
      expect(ids).toContain(balanceOnlyBucketId);
      expect(ids).not.toContain(privateBucketId);

      // Shared bucket has description and canViewTransactions = true
      const sharedB = res.body.buckets.find((b: { id: string }) => b.id === sharedBucketId);
      expect(sharedB.description).toBe('3 months living expenses');
      expect(sharedB.isOwner).toBe(false);
      expect(sharedB.canViewTransactions).toBe(true);

      // Balance_only bucket has NO description and canViewTransactions = false
      const balanceOnlyB = res.body.buckets.find((b: { id: string }) => b.id === balanceOnlyBucketId);
      expect(balanceOnlyB.description).toBeUndefined();
      expect(balanceOnlyB.isOwner).toBe(false);
      expect(balanceOnlyB.canViewTransactions).toBe(false);
    });

    it('partner GET by ID for private bucket returns 404 (preventing existence leak)', async () => {
      const res = await request(app)
        .get(`/buckets/${privateBucketId}`)
        .set('Cookie', partnerCookie);

      // CRITICAL PRIVACY INVARIANT: Must return 404, not 403
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Bucket not found');
    });

    it('partner GET by ID for balance_only bucket returns balance but strips description', async () => {
      const res = await request(app)
        .get(`/buckets/${balanceOnlyBucketId}`)
        .set('Cookie', partnerCookie);

      expect(res.status).toBe(200);
      expect(res.body.bucket.name).toBe('Discretionary Vault');
      expect(res.body.bucket.balance).toBe(0);
      expect(res.body.bucket.isOwner).toBe(false);
      expect(res.body.bucket.canViewTransactions).toBe(false);
      expect(res.body.bucket.description).toBeUndefined();
    });

    it('partner GET by ID for shared bucket returns full metadata', async () => {
      const res = await request(app)
        .get(`/buckets/${sharedBucketId}`)
        .set('Cookie', partnerCookie);

      expect(res.status).toBe(200);
      expect(res.body.bucket.name).toBe('Joint Emergency Fund');
      expect(res.body.bucket.description).toBe('3 months living expenses');
      expect(res.body.bucket.canViewTransactions).toBe(true);
    });

    it('other household user receives 404 for any bucket', async () => {
      const resShared = await request(app)
        .get(`/buckets/${sharedBucketId}`)
        .set('Cookie', otherCookie);
      expect(resShared.status).toBe(404);

      const resPrivate = await request(app)
        .get(`/buckets/${privateBucketId}`)
        .set('Cookie', otherCookie);
      expect(resPrivate.status).toBe(404);
    });
  });

  describe('Visibility Modification & Ownership Rules', () => {
    it('rejects partner attempting to modify bucket visibility or properties', async () => {
      const owner = await registerUser('Kavita', 'kavita@example.com');
      const inviteRes = await request(app).post('/invites').set('Cookie', owner.cookie);
      const inviteToken = inviteRes.body.token as string;
      const partner = await registerUser('Rohan', 'rohan@example.com', 'Password123', inviteToken);

      const bucketRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Kavita Cash', type: 'cash', visibility: 'shared' });
      const bucketId = bucketRes.body.bucket.id;

      // Partner attempts to change visibility
      const patchVisRes = await request(app)
        .patch(`/buckets/${bucketId}/visibility`)
        .set('Cookie', partner.cookie)
        .send({ visibility: 'private' });
      expect(patchVisRes.status).toBe(403);
      expect(patchVisRes.body.message).toContain('Only the bucket owner');

      // Partner attempts to update properties
      const patchPropRes = await request(app)
        .patch(`/buckets/${bucketId}`)
        .set('Cookie', partner.cookie)
        .send({ name: 'Hacked Name' });
      expect(patchPropRes.status).toBe(403);

      // Owner can change visibility
      const ownerPatchRes = await request(app)
        .patch(`/buckets/${bucketId}/visibility`)
        .set('Cookie', owner.cookie)
        .send({ visibility: 'private' });
      expect(ownerPatchRes.status).toBe(200);
      expect(ownerPatchRes.body.bucket.visibility).toBe('private');
    });
  });

  describe('Bucket Editing & Type Change Rules', () => {
    it('allows owner to edit bucket name and description at any time', async () => {
      const { cookie } = await registerUser('Vikram', 'vikram@example.com');
      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', cookie)
        .send({ name: 'Old Name', type: 'cash', visibility: 'shared', description: 'Old Note' });

      const patchRes = await request(app)
        .patch(`/buckets/${bRes.body.bucket.id}`)
        .set('Cookie', cookie)
        .send({ name: 'New Name', description: 'Updated Note' });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.bucket.name).toBe('New Name');
      expect(patchRes.body.bucket.description).toBe('Updated Note');
    });

    it('allows owner to change bucket type when balance is 0', async () => {
      const { cookie } = await registerUser('Vikram', 'vikram2@example.com');
      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', cookie)
        .send({ name: 'Pocket Money', type: 'cash', visibility: 'shared' });

      const patchRes = await request(app)
        .patch(`/buckets/${bRes.body.bucket.id}`)
        .set('Cookie', cookie)
        .send({ type: 'bank' });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.bucket.type).toBe('bank');
    });

    it('rejects changing bucket type when balance is non-zero', async () => {
      const { cookie } = await registerUser('Vikram', 'vikram3@example.com');
      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', cookie)
        .send({ name: 'Savings', type: 'bank', visibility: 'shared' });

      // Simulate balance in DB
      await Bucket.findByIdAndUpdate(bRes.body.bucket.id, { balance: 10000 });

      const patchRes = await request(app)
        .patch(`/buckets/${bRes.body.bucket.id}`)
        .set('Cookie', cookie)
        .send({ type: 'cash' });

      expect(patchRes.status).toBe(400);
      expect(patchRes.body.message).toContain('Cannot change the type of a bucket with a non-zero balance');
    });

    it('rejects partner attempting to edit bucket name, description or type', async () => {
      const owner = await registerUser('Vikram', 'vikram4@example.com');
      const inviteRes = await request(app).post('/invites').set('Cookie', owner.cookie);
      const partner = await registerUser('Anita', 'anita@example.com', 'Password123', inviteRes.body.token);

      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Vikram Private Vault', type: 'cash', visibility: 'shared' });

      const patchRes = await request(app)
        .patch(`/buckets/${bRes.body.bucket.id}`)
        .set('Cookie', partner.cookie)
        .send({ name: 'Partner Tampered Name', type: 'bank' });

      expect(patchRes.status).toBe(403);
      expect(patchRes.body.message).toContain('Only the bucket owner');
    });
  });

  describe('Bucket Archiving & Zero Balance Invariant', () => {
    it('rejects archiving a bucket with non-zero balance and succeeds when balance is 0', async () => {
      const owner = await registerUser('Nikhil', 'nikhil@example.com');
      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Trip Fund', type: 'cash', visibility: 'shared' });
      const bucketId = bRes.body.bucket.id;

      // Simulate a non-zero balance in DB
      await Bucket.findByIdAndUpdate(bucketId, { balance: 25000 }); // 250 INR

      // Attempt to archive with non-zero balance
      const archiveFail = await request(app)
        .post(`/buckets/${bucketId}/archive`)
        .set('Cookie', owner.cookie);

      expect(archiveFail.status).toBe(400);
      expect(archiveFail.body.message).toContain('Cannot archive a bucket with a non-zero balance');

      // Settle balance to 0
      await Bucket.findByIdAndUpdate(bucketId, { balance: 0 });

      // Archiving now succeeds
      const archiveSuccess = await request(app)
        .post(`/buckets/${bucketId}/archive`)
        .set('Cookie', owner.cookie);

      expect(archiveSuccess.status).toBe(200);
      expect(archiveSuccess.body.bucket.isArchived).toBe(true);

      // Archived bucket omitted from default list
      const listRes = await request(app).get('/buckets').set('Cookie', owner.cookie);
      expect(listRes.body.buckets).toHaveLength(0);

      // Included when includeArchived=true
      const listArchived = await request(app)
        .get('/buckets?includeArchived=true')
        .set('Cookie', owner.cookie);
      expect(listArchived.body.buckets).toHaveLength(1);
      expect(listArchived.body.buckets[0].isArchived).toBe(true);
    });
  });

  describe('Summary Metrics Calculation', () => {
    it('accurately calculates householdTotal and myTotal based on privacy matrix', async () => {
      // Setup Owner & Partner
      const owner = await registerUser('Alice', 'alice@example.com');
      const inviteRes = await request(app).post('/invites').set('Cookie', owner.cookie);
      const inviteToken = inviteRes.body.token as string;
      const partner = await registerUser('Bob', 'bob@example.com', 'Password123', inviteToken);

      // Alice creates:
      // 1. Shared (10,000 paise)
      const aShared = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Alice Shared', type: 'bank', visibility: 'shared' });
      await Bucket.findByIdAndUpdate(aShared.body.bucket.id, { balance: 10000 });

      // 2. BalanceOnly (20,000 paise)
      const aBalOnly = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Alice Balance Only', type: 'cash', visibility: 'balance_only' });
      await Bucket.findByIdAndUpdate(aBalOnly.body.bucket.id, { balance: 20000 });

      // 3. Private (30,000 paise)
      const aPrivate = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Alice Private', type: 'bank', visibility: 'private' });
      await Bucket.findByIdAndUpdate(aPrivate.body.bucket.id, { balance: 30000 });

      // Bob creates:
      // 4. Shared (40,000 paise)
      const bShared = await request(app)
        .post('/buckets')
        .set('Cookie', partner.cookie)
        .send({ name: 'Bob Shared', type: 'bank', visibility: 'shared' });
      await Bucket.findByIdAndUpdate(bShared.body.bucket.id, { balance: 40000 });

      // 5. Private (50,000 paise)
      const bPrivate = await request(app)
        .post('/buckets')
        .set('Cookie', partner.cookie)
        .send({ name: 'Bob Private', type: 'bank', visibility: 'private' });
      await Bucket.findByIdAndUpdate(bPrivate.body.bucket.id, { balance: 50000 });

      // Alice's View:
      // householdTotal = sum of shared + balance_only in household
      //   = Alice Shared (10,000) + Alice BalanceOnly (20,000) + Bob Shared (40,000)
      //   = 70,000 paise
      // myTotal = Alice's own buckets (all visibilities: 10,000 + 20,000 + 30,000 = 60,000)
      //   + Bob's Shared (40,000)
      //   = 100,000 paise
      const aliceSummary = await request(app).get('/buckets/summary').set('Cookie', owner.cookie);
      expect(aliceSummary.status).toBe(200);
      expect(aliceSummary.body.householdTotal).toBe(70000);
      expect(aliceSummary.body.myTotal).toBe(100000);

      // Bob's View:
      // householdTotal = Alice Shared (10,000) + Alice BalanceOnly (20,000) + Bob Shared (40,000)
      //   = 70,000 paise (Identical household total!)
      // myTotal = Bob's own buckets (Bob Shared 40,000 + Bob Private 50,000 = 90,000)
      //   + Alice's Shared (10,000)
      //   = 100,000 paise
      const bobSummary = await request(app).get('/buckets/summary').set('Cookie', partner.cookie);
      expect(bobSummary.status).toBe(200);
      expect(bobSummary.body.householdTotal).toBe(70000);
      expect(bobSummary.body.myTotal).toBe(100000);
    });
  });

  describe('Phase 4A Fixes: Bucket Type & Partner Access Matrix', () => {
    it('rejects type change if bucket has transaction history, even if current balance is 0', async () => {
      const owner = await registerUser('Tanvi', 'tanvi@example.com');
      const bRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Emergency Cash', type: 'cash', visibility: 'shared' });
      const bucketId = bRes.body.bucket.id;

      // Balance is 0 right now, but record a historical (now settled or voided) transaction
      const user = await User.findOne({ email: 'tanvi@example.com' });
      await Transaction.create({
        householdId: user!.householdId,
        type: 'income',
        amount: 5000,
        toBucketId: bucketId,
        category: 'Salary',
        date: new Date(),
        createdBy: user!._id,
        status: 'voided', // Even voided transactions count as history!
      });

      // Attempt to change type when balance is 0 but transaction history exists
      const patchRes = await request(app)
        .patch(`/buckets/${bucketId}`)
        .set('Cookie', owner.cookie)
        .send({ type: 'bank' });

      expect(patchRes.status).toBe(400);
      expect(patchRes.body.message).toContain('Cannot change the type of a bucket with existing transaction history');
    });

    it('enforces partner access rules: 403 on shared, 403 on balance_only, and 404 on private for PATCH, visibility, and archive', async () => {
      const owner = await registerUser('Harish', 'harish@example.com');
      const inviteRes = await request(app).post('/invites').set('Cookie', owner.cookie);
      const partner = await registerUser('Meera', 'meera@example.com', 'Password123', inviteRes.body.token);

      // Create 3 buckets with different visibilities
      const sharedRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Harish Shared', type: 'bank', visibility: 'shared' });
      const sharedId = sharedRes.body.bucket.id;

      const balOnlyRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Harish Balance Only', type: 'bank', visibility: 'balance_only' });
      const balOnlyId = balOnlyRes.body.bucket.id;

      const privateRes = await request(app)
        .post('/buckets')
        .set('Cookie', owner.cookie)
        .send({ name: 'Harish Private', type: 'bank', visibility: 'private' });
      const privateId = privateRes.body.bucket.id;

      // 1. PATCH /buckets/:id
      // Shared -> 403
      const patchShared = await request(app)
        .patch(`/buckets/${sharedId}`)
        .set('Cookie', partner.cookie)
        .send({ name: 'Partner Edit Shared' });
      expect(patchShared.status).toBe(403);
      expect(patchShared.body.message).toContain('Only the bucket owner');

      // Balance only -> 403
      const patchBalOnly = await request(app)
        .patch(`/buckets/${balOnlyId}`)
        .set('Cookie', partner.cookie)
        .send({ name: 'Partner Edit Balance Only' });
      expect(patchBalOnly.status).toBe(403);
      expect(patchBalOnly.body.message).toContain('Only the bucket owner');

      // Private -> 404 (Never reveal existence!)
      const patchPrivate = await request(app)
        .patch(`/buckets/${privateId}`)
        .set('Cookie', partner.cookie)
        .send({ name: 'Partner Edit Private' });
      expect(patchPrivate.status).toBe(404);
      expect(patchPrivate.body.message).toContain('Bucket not found');

      // 2. PATCH /buckets/:id/visibility
      // Shared -> 403
      const visShared = await request(app)
        .patch(`/buckets/${sharedId}/visibility`)
        .set('Cookie', partner.cookie)
        .send({ visibility: 'private' });
      expect(visShared.status).toBe(403);

      // Balance only -> 403
      const visBalOnly = await request(app)
        .patch(`/buckets/${balOnlyId}/visibility`)
        .set('Cookie', partner.cookie)
        .send({ visibility: 'shared' });
      expect(visBalOnly.status).toBe(403);

      // Private -> 404
      const visPrivate = await request(app)
        .patch(`/buckets/${privateId}/visibility`)
        .set('Cookie', partner.cookie)
        .send({ visibility: 'shared' });
      expect(visPrivate.status).toBe(404);
      expect(visPrivate.body.message).toContain('Bucket not found');

      // 3. POST /buckets/:id/archive
      // Shared -> 403
      const archiveShared = await request(app)
        .post(`/buckets/${sharedId}/archive`)
        .set('Cookie', partner.cookie);
      expect(archiveShared.status).toBe(403);

      // Balance only -> 403
      const archiveBalOnly = await request(app)
        .post(`/buckets/${balOnlyId}/archive`)
        .set('Cookie', partner.cookie);
      expect(archiveBalOnly.status).toBe(403);

      // Private -> 404
      const archivePrivate = await request(app)
        .post(`/buckets/${privateId}/archive`)
        .set('Cookie', partner.cookie);
      expect(archivePrivate.status).toBe(404);
      expect(archivePrivate.body.message).toContain('Bucket not found');
    });
  });
});
