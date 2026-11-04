import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../app';
import { User } from '../models/User';
import { Transaction } from '../models/Transaction';
import { getCurrentISTYearMonth } from '../utils/dateUtils';

describe('Phase 6: Transaction Filters, Search, Reports & Household Dashboard', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      instanceOpts: [{ launchTimeout: 60000 }],
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

  // Helpers
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

  async function setupHousehold() {
    const owner = await registerUser('Arjun', 'arjun@example.com');
    const inviteRes = await request(app).post('/invites').set('Cookie', owner.cookie);
    const inviteToken = inviteRes.body.token as string;
    const partner = await registerUser('Priya', 'priya@example.com', 'Password123', inviteToken);
    return { owner, partner };
  }

  /* ==========================================================================
     1. FILTERS & SEARCH
     ========================================================================== */
  describe('GET /transactions filter criteria and regex safety', () => {
    it('filters by bucketId, type, category, and createdBy correctly', async () => {
      const { owner, partner } = await setupHousehold();

      // Create buckets
      const b1 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Main Bank',
        type: 'bank',
        visibility: 'shared',
        openingBalance: 1000000, // ₹10,000
      });
      const b2 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Cash Pocket',
        type: 'cash',
        visibility: 'shared',
        openingBalance: 500000, // ₹5,000
      });

      const bankId = b1.body.bucket.id;
      const cashId = b2.body.bucket.id;
      const now = new Date().toISOString();

      // Add expense from Bank by Owner
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 250000, // ₹2,500
        fromBucketId: bankId,
        category: 'Groceries',
        purpose: 'Supermarket shopping',
        date: now,
      });

      // Add expense from Cash by Partner
      await request(app).post('/transactions').set('Cookie', partner.cookie).send({
        type: 'expense',
        amount: 50000, // ₹500
        fromBucketId: cashId,
        category: 'Food & Dining',
        purpose: 'Coffee shop',
        date: now,
      });

      // Add transfer from Bank to Cash
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'transfer',
        amount: 100000, // ₹1,000
        fromBucketId: bankId,
        toBucketId: cashId,
        purpose: 'ATM withdrawal',
        date: now,
      });

      // Filter by bucketId = cashId
      const cashRes = await request(app)
        .get(`/transactions?bucketId=${cashId}`)
        .set('Cookie', owner.cookie);
      expect(cashRes.status).toBe(200);
      // Should include opening balance, coffee expense, and ATM transfer
      const purposes = cashRes.body.transactions.map((t: any) => t.purpose);
      expect(purposes).toContain('Coffee shop');
      expect(purposes).toContain('ATM withdrawal');
      expect(purposes).not.toContain('Supermarket shopping');

      // Filter by type = 'transfer'
      const transferRes = await request(app)
        .get('/transactions?type=transfer')
        .set('Cookie', owner.cookie);
      expect(transferRes.body.transactions.length).toBe(1);
      expect(transferRes.body.transactions[0].purpose).toBe('ATM withdrawal');

      // Filter by category = 'Groceries'
      const catRes = await request(app)
        .get('/transactions?category=groceries') // case-insensitive check
        .set('Cookie', owner.cookie);
      expect(catRes.body.transactions.length).toBe(1);
      expect(catRes.body.transactions[0].category).toBe('Groceries');

      // Filter by createdBy = 'partner'
      const partnerOnlyRes = await request(app)
        .get('/transactions?createdBy=partner')
        .set('Cookie', owner.cookie);
      expect(partnerOnlyRes.body.transactions.length).toBe(1);
      expect(partnerOnlyRes.body.transactions[0].purpose).toBe('Coffee shop');

      // Filter by createdBy = 'me'
      const meRes = await request(app)
        .get('/transactions?createdBy=me')
        .set('Cookie', owner.cookie);
      const mePurposes = meRes.body.transactions.map((t: any) => t.purpose);
      expect(mePurposes).toContain('Supermarket shopping');
      expect(mePurposes).toContain('ATM withdrawal');
      expect(mePurposes).not.toContain('Coffee shop');
    });

    it('enforces inclusive date and amount boundaries correctly', async () => {
      const { owner } = await setupHousehold();
      // Bucket without opening balance to isolate test transactions
      const b = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Account',
        type: 'bank',
        visibility: 'shared',
      });
      const bucketId = b.body.bucket.id;

      // Deposit initial funds via income
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'income',
        amount: 1000000,
        toBucketId: bucketId,
        category: 'Salary',
        purpose: 'Initial deposit',
        date: '2026-09-01T10:00:00.000Z',
      });

      // Create transactions with specific dates
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 10000, // ₹100
        fromBucketId: bucketId,
        category: 'Groceries',
        purpose: 'Day 10',
        date: '2026-10-10T10:00:00.000Z',
      });
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 20000, // ₹200
        fromBucketId: bucketId,
        category: 'Groceries',
        purpose: 'Day 15',
        date: '2026-10-15T10:00:00.000Z',
      });
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 30000, // ₹300
        fromBucketId: bucketId,
        category: 'Groceries',
        purpose: 'Day 20',
        date: '2026-10-20T10:00:00.000Z',
      });

      // Filter date range 2026-10-12 to 2026-10-18 (should only match Day 15)
      const dateRes = await request(app)
        .get('/transactions?fromDate=2026-10-12T00:00:00.000Z&toDate=2026-10-18T00:00:00.000Z')
        .set('Cookie', owner.cookie);
      expect(dateRes.body.transactions.length).toBe(1);
      expect(dateRes.body.transactions[0].purpose).toBe('Day 15');

      // Amount range 15000 to 25000 paise (should only match Day 15)
      const amtRes = await request(app)
        .get('/transactions?minAmount=15000&maxAmount=25000')
        .set('Cookie', owner.cookie);
      expect(amtRes.body.transactions.length).toBe(1);
      expect(amtRes.body.transactions[0].amount).toBe(20000);
    });

    it('safely escapes regex special characters and prevents injection attacks', async () => {
      const { owner } = await setupHousehold();
      const b = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Safe Bank',
        type: 'bank',
        visibility: 'shared',
        openingBalance: 500000,
      });

      const now = new Date().toISOString();

      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 15000,
        fromBucketId: b.body.bucket.id,
        category: 'Groceries',
        purpose: 'Purchase items (milk & bread)',
        date: now,
      });

      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 12000,
        fromBucketId: b.body.bucket.id,
        category: 'Miscellaneous',
        purpose: 'Price: $50.* test',
        date: now,
      });

      // Searching for ".*" must NOT match everything! It must match only the literal ".*"
      const wildRes = await request(app)
        .get('/transactions?search=' + encodeURIComponent('.*'))
        .set('Cookie', owner.cookie);
      expect(wildRes.status).toBe(200);
      expect(wildRes.body.transactions.length).toBe(1);
      expect(wildRes.body.transactions[0].purpose).toBe('Price: $50.* test');

      // Searching with parentheses like "(milk & bread)"
      const parenRes = await request(app)
        .get('/transactions?search=' + encodeURIComponent('(milk & bread)'))
        .set('Cookie', owner.cookie);
      expect(parenRes.status).toBe(200);
      expect(parenRes.body.transactions.length).toBe(1);
      expect(parenRes.body.transactions[0].purpose).toBe('Purchase items (milk & bread)');
    });

    it('respects includeVoided parameter (default false vs true)', async () => {
      const { owner } = await setupHousehold();
      const b = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Void Test Bank',
        type: 'bank',
        visibility: 'shared',
        openingBalance: 500000,
      });

      const tx = await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 5000,
        fromBucketId: b.body.bucket.id,
        category: 'Groceries',
        purpose: 'To be voided',
        date: new Date().toISOString(),
      });
      expect(tx.status).toBe(201);

      // Void the transaction
      const voidRes = await request(app)
        .post(`/transactions/${tx.body.transaction.id}/void`)
        .set('Cookie', owner.cookie);
      expect(voidRes.status).toBe(200);

      // Default (includeVoided=false): voided item is excluded
      const defaultRes = await request(app).get('/transactions').set('Cookie', owner.cookie);
      const hasVoided = defaultRes.body.transactions.some((t: any) => t.status === 'voided');
      expect(hasVoided).toBe(false);

      // Explicit includeVoided=true: voided item is included
      const withVoidedRes = await request(app)
        .get('/transactions?includeVoided=true')
        .set('Cookie', owner.cookie);
      const voidedTx = withVoidedRes.body.transactions.find((t: any) => t.status === 'voided');
      expect(voidedTx).toBeDefined();
      expect(voidedTx.purpose).toBe('To be voided');
    });
  });

  /* ==========================================================================
     2. STABLE PAGINATION
     ========================================================================== */
  describe('Stable Server Pagination with date desc, _id desc', () => {
    it('produces stable pages without duplicates or gaps', async () => {
      const { owner } = await setupHousehold();
      const b = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Pagination Bank',
        type: 'bank',
        visibility: 'shared',
        openingBalance: 1000000,
      });

      // Create 5 transactions on the exact same second
      const fixedDate = new Date('2026-10-13T12:00:00.000Z').toISOString();
      for (let i = 1; i <= 5; i++) {
        await request(app).post('/transactions').set('Cookie', owner.cookie).send({
          type: 'expense',
          amount: i * 1000,
          fromBucketId: b.body.bucket.id,
          category: 'Groceries',
          purpose: `Batch Item ${i}`,
          date: fixedDate,
        });
      }

      // Fetch Page 1 with limit=2 (excluding opening balance by filtering category=Groceries)
      const p1 = await request(app)
        .get('/transactions?category=Groceries&page=1&limit=2')
        .set('Cookie', owner.cookie);
      expect(p1.body.transactions.length).toBe(2);
      expect(p1.body.totalPages).toBe(3);
      expect(p1.body.hasMore).toBe(true);

      // Fetch Page 2 with limit=2
      const p2 = await request(app)
        .get('/transactions?category=Groceries&page=2&limit=2')
        .set('Cookie', owner.cookie);
      expect(p2.body.transactions.length).toBe(2);

      // Fetch Page 3 with limit=2
      const p3 = await request(app)
        .get('/transactions?category=Groceries&page=3&limit=2')
        .set('Cookie', owner.cookie);
      expect(p3.body.transactions.length).toBe(1);
      expect(p3.body.hasMore).toBe(false);

      // Verify no ID overlap between pages
      const idsP1 = p1.body.transactions.map((t: any) => t.id);
      const idsP2 = p2.body.transactions.map((t: any) => t.id);
      const idsP3 = p3.body.transactions.map((t: any) => t.id);

      const allIds = [...idsP1, ...idsP2, ...idsP3];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(5);
    });
  });

  /* ==========================================================================
     3. PRIVACY CONSISTENCY
     ========================================================================== */
  describe('Backend-Enforced Privacy & Partner Consistency Rule', () => {
    it('ensures partner query never leaks hidden rows and sum of visible transactions equals reports', async () => {
      const { owner, partner } = await setupHousehold();

      // Owner creates Shared Bank
      const sharedRes = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Shared Bank',
        type: 'bank',
        visibility: 'shared',
        openingBalance: 1000000, // ₹10,000
      });

      // Owner creates Balance-Only Pocket
      const boRes = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Owner Pocket',
        type: 'cash',
        visibility: 'balance_only',
        openingBalance: 500000, // ₹5,000
      });

      // Owner creates Private Vault
      const privateRes = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Owner Secret',
        type: 'bank',
        visibility: 'private',
        openingBalance: 2000000, // ₹20,000
      });

      const sharedId = sharedRes.body.bucket.id;
      const boId = boRes.body.bucket.id;
      const privateId = privateRes.body.bucket.id;
      const now = new Date().toISOString();

      // 1. Shared expense
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 150000, // ₹1,500
        fromBucketId: sharedId,
        category: 'Groceries',
        purpose: 'Shared groceries',
        date: now,
      });

      // 2. Balance-only expense (hidden from partner)
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 80000, // ₹800
        fromBucketId: boId,
        category: 'Personal Care',
        purpose: 'Haircut',
        date: now,
      });

      // 3. Private expense (hidden from partner)
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 50000, // ₹500
        fromBucketId: privateId,
        category: 'Entertainment',
        purpose: 'Gadget',
        date: now,
      });

      // Partner queries GET /transactions
      const partnerTxRes = await request(app).get('/transactions').set('Cookie', partner.cookie);
      expect(partnerTxRes.status).toBe(200);

      // Verify partner sees zero balance_only or private transactions
      const partnerPurposes = partnerTxRes.body.transactions.map((t: any) => t.purpose);
      expect(partnerPurposes).toContain('Shared groceries');
      expect(partnerPurposes).not.toContain('Haircut');
      expect(partnerPurposes).not.toContain('Gadget');

      // Check report summary for current month
      const currentMonth = getCurrentISTYearMonth();
      const partnerSummaryRes = await request(app)
        .get(`/reports/summary?month=${currentMonth}`)
        .set('Cookie', partner.cookie);
      expect(partnerSummaryRes.status).toBe(200);

      // Partner report must only show the shared expense (₹1,500 = 150000 paise)
      expect(partnerSummaryRes.body.totalExpense).toBe(150000);

      // Owner report includes both shared and private/balance-only: 150000 + 80000 + 50000 = 280000 paise
      const ownerSummaryRes = await request(app)
        .get(`/reports/summary?month=${currentMonth}`)
        .set('Cookie', owner.cookie);
      expect(ownerSummaryRes.body.totalExpense).toBe(280000);

      // PRIVACY CONSISTENCY INVARIANT:
      // For the partner, the sum of visible expense transactions in that month must equal the report's totalExpense
      const partnerVisibleExpenses = partnerTxRes.body.transactions
        .filter((t: any) => t.type === 'expense' && t.status !== 'voided')
        .reduce((sum: number, t: any) => sum + t.amount, 0);

      expect(partnerVisibleExpenses).toBe(partnerSummaryRes.body.totalExpense);
    });
  });

  /* ==========================================================================
     4. FINANCIAL REPORTS EXCLUSIONS & IST MIDNIGHT BOUNDARIES
     ========================================================================== */
  describe('GET /reports/summary, /reports/categories, /reports/trend', () => {
    it('excludes transfers, adjustments, opening balances, and void/reversal pairs', async () => {
      const { owner } = await setupHousehold();
      const b1 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Report Bank 1',
        type: 'bank',
        visibility: 'shared',
        openingBalance: 1000000, // ₹10,000 (Opening Balance excluded from income)
      });
      const b2 = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Report Bank 2',
        type: 'bank',
        visibility: 'shared',
        openingBalance: 500000,
      });

      const bank1Id = b1.body.bucket.id;
      const bank2Id = b2.body.bucket.id;
      const now = new Date().toISOString();

      // Legitimate active Income: ₹50,000 (5000000 paise)
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'income',
        amount: 5000000,
        toBucketId: bank1Id,
        category: 'Salary',
        purpose: 'Monthly salary',
        date: now,
      });

      // Legitimate active Expense: ₹12,000 (1200000 paise)
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 1200000,
        fromBucketId: bank1Id,
        category: 'Rent',
        purpose: 'House rent',
        date: now,
      });

      // Internal Transfer: ₹5,000 (must NOT be counted as income or expense)
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'transfer',
        amount: 500000,
        fromBucketId: bank1Id,
        toBucketId: bank2Id,
        purpose: 'Transfer to savings',
        date: now,
      });

      // Balance Adjustment: ₹1,000 (must NOT be counted as income or expense)
      await request(app).post('/transactions/adjustment').set('Cookie', owner.cookie).send({
        bucketId: bank1Id,
        amount: 100000,
        reason: 'Bank interest reconciliation',
        date: now,
      });

      // Erroneous Expense + Voided Reversal pair: ₹3,000
      const errTx = await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 300000,
        fromBucketId: bank1Id,
        category: 'Food & Dining',
        purpose: 'Mistaken expense',
        date: now,
      });
      expect(errTx.status).toBe(201);

      await request(app)
        .post(`/transactions/${errTx.body.transaction.id}/void`)
        .set('Cookie', owner.cookie);

      const summaryRes = await request(app).get('/reports/summary').set('Cookie', owner.cookie);
      expect(summaryRes.status).toBe(200);

      // Verify income is strictly 5000000 paise (excluding opening balances, transfers, and reversals)
      expect(summaryRes.body.totalIncome).toBe(5000000);
      // Verify expense is strictly 1200000 paise (excluding transfers, adjustments, and voided/reversal pairs)
      expect(summaryRes.body.totalExpense).toBe(1200000);
      expect(summaryRes.body.netSavings).toBe(5000000 - 1200000);
    });

    it('accurately attributes transactions near midnight IST to their calendar month', async () => {
      const { owner } = await setupHousehold();
      const b = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'IST Midnight Bank',
        type: 'bank',
        visibility: 'shared',
        openingBalance: 1000000,
      });

      // In IST (UTC+05:30):
      // 2026-01-31 23:45 IST is 2026-01-31 18:15 UTC -> Lands in 2026-01
      // 2026-02-01 00:15 IST is 2026-01-31 18:45 UTC -> Lands in 2026-02
      const janMidnightIST = '2026-01-31T18:15:00.000Z'; // 23:45 IST
      const febMidnightIST = '2026-01-31T18:45:00.000Z'; // 00:15 IST

      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 100000,
        fromBucketId: b.body.bucket.id,
        category: 'Groceries',
        purpose: 'Late January groceries',
        date: janMidnightIST,
      });

      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 200000,
        fromBucketId: b.body.bucket.id,
        category: 'Groceries',
        purpose: 'Early February groceries',
        date: febMidnightIST,
      });

      // Check January report
      const janReport = await request(app)
        .get('/reports/summary?month=2026-01')
        .set('Cookie', owner.cookie);
      expect(janReport.body.totalExpense).toBe(100000);

      // Check February report
      const febReport = await request(app)
        .get('/reports/summary?month=2026-02')
        .set('Cookie', owner.cookie);
      expect(febReport.body.totalExpense).toBe(200000);
    });

    it('returns top categories plus Other and zero-fills chronological trend months', async () => {
      const { owner } = await setupHousehold();
      const b = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Analytics Bank',
        type: 'bank',
        visibility: 'shared',
        openingBalance: 10000000,
      });
      const bucketId = b.body.bucket.id;
      const now = new Date().toISOString();

      // Add expenses across 7 categories
      const categories = [
        'Rent',
        'Groceries',
        'Utilities',
        'Food & Dining',
        'Transportation',
        'Entertainment',
        'Personal Care',
      ];

      for (let i = 0; i < categories.length; i++) {
        await request(app).post('/transactions').set('Cookie', owner.cookie).send({
          type: 'expense',
          amount: (i + 1) * 10000,
          fromBucketId: bucketId,
          category: categories[i],
          purpose: `Spend for ${categories[i]}`,
          date: now,
        });
      }

      // Check categories report
      const catRes = await request(app).get('/reports/categories').set('Cookie', owner.cookie);
      expect(catRes.status).toBe(200);
      expect(catRes.body.items.length).toBeLessThanOrEqual(6); // Top 5 + Other
      const hasOther = catRes.body.items.some((item: any) => item.category === 'Other');
      expect(hasOther).toBe(true);

      // Check trend report for last 6 months
      const trendRes = await request(app).get('/reports/trend?months=6').set('Cookie', owner.cookie);
      expect(trendRes.status).toBe(200);
      expect(trendRes.body.items.length).toBe(6);
      // Must be chronological
      const months = trendRes.body.items.map((i: any) => i.month);
      const sortedMonths = [...months].sort();
      expect(months).toEqual(sortedMonths);
    });
  });

  /* ==========================================================================
     5. DASHBOARD CONSOLIDATED ENDPOINT
     ========================================================================== */
  describe('GET /dashboard endpoint', () => {
    it('returns brand-new account zeros and empty arrays', async () => {
      const newUser = await registerUser('FreshUser', 'fresh@example.com');
      const res = await request(app).get('/dashboard').set('Cookie', newUser.cookie);
      expect(res.status).toBe(200);
      expect(res.body.householdTotal).toBe(0);
      expect(res.body.myTotal).toBe(0);
      expect(res.body.buckets).toEqual([]);
      expect(res.body.recentTransactions).toEqual([]);
      expect(res.body.alerts).toEqual([]);
      expect(res.body.monthSummary.totalIncome).toBe(0);
      expect(res.body.monthSummary.totalExpense).toBe(0);
      expect(res.body.monthSummary.netSavings).toBe(0);
    });

    it('matches Phase 4A definition for householdTotal and myTotal', async () => {
      const { owner, partner } = await setupHousehold();

      // Owner shared bucket: ₹10,000 (1000000 paise)
      await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Shared Bank',
        type: 'bank',
        visibility: 'shared',
        openingBalance: 1000000,
      });

      // Owner balance_only bucket: ₹5,000 (500000 paise)
      await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Owner Pocket',
        type: 'cash',
        visibility: 'balance_only',
        openingBalance: 500000,
      });

      // Partner shared bucket: ₹8,000 (800000 paise)
      await request(app).post('/buckets').set('Cookie', partner.cookie).send({
        name: 'Partner Shared Cash',
        type: 'cash',
        visibility: 'shared',
        openingBalance: 800000,
      });

      // Partner private bucket: ₹4,000 (400000 paise)
      await request(app).post('/buckets').set('Cookie', partner.cookie).send({
        name: 'Partner Secret',
        type: 'cash',
        visibility: 'private',
        openingBalance: 400000,
      });

      // Owner Dashboard
      const ownerDash = await request(app).get('/dashboard').set('Cookie', owner.cookie);
      expect(ownerDash.status).toBe(200);
      // Owner HouseholdTotal = Shared (10k + 8k) + Owner BO (5k) = 23,000 (2300000 paise)
      expect(ownerDash.body.householdTotal).toBe(2300000);
      // Owner MyTotal = Owner all owned (10k + 5k) + Partner shared (8k) = 23,000 (2300000 paise)
      expect(ownerDash.body.myTotal).toBe(2300000);

      // Partner Dashboard
      const partnerDash = await request(app).get('/dashboard').set('Cookie', partner.cookie);
      expect(partnerDash.status).toBe(200);
      // Partner HouseholdTotal = Shared (10k + 8k) + Owner BO (5k) = 23,000 (2300000 paise)
      expect(partnerDash.body.householdTotal).toBe(2300000);
      // Partner MyTotal = Partner all owned (8k + 4k) + Owner shared (10k) = 22,000 (2200000 paise)
      expect(partnerDash.body.myTotal).toBe(2200000);
    });
  });

  /* ==========================================================================
     6. SCENARIO TEST: SALARY SPLIT + EXPENSES DASHBOARD COMPARISON
     ========================================================================== */
  describe('Full Scenario: Salary Split + Pocket Expense + Partner Inspection', () => {
    it('accurately isolates owner pocket transactions while keeping partner dashboard aligned', async () => {
      const { owner, partner } = await setupHousehold();

      // Create buckets
      const sharedBankRes = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Joint Savings',
        type: 'bank',
        visibility: 'shared',
      });
      const sharedCashRes = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Household Cash',
        type: 'cash',
        visibility: 'shared',
      });
      const privatePocketRes = await request(app).post('/buckets').set('Cookie', owner.cookie).send({
        name: 'Personal Pocket',
        type: 'cash',
        visibility: 'balance_only',
      });

      const bankId = sharedBankRes.body.bucket.id;
      const cashId = sharedCashRes.body.bucket.id;
      const pocketId = privatePocketRes.body.bucket.id;
      const now = new Date().toISOString();

      // Split Salary of ₹1,00,000 (10000000 paise):
      // - ₹70,000 to Joint Savings (shared)
      // - ₹20,000 to Household Cash (shared)
      // - ₹10,000 to Personal Pocket (balance_only)
      const splitRes = await request(app).post('/transactions/split-income').set('Cookie', owner.cookie).send({
        totalAmount: 10000000,
        source: 'Acme Corp',
        purpose: 'October Salary',
        date: now,
        allocations: [
          { bucketId: bankId, amount: 7000000 },
          { bucketId: cashId, amount: 2000000 },
          { bucketId: pocketId, amount: 1000000 },
        ],
      });
      expect(splitRes.status).toBe(201);

      // Expense 1: ₹5,000 from Joint Savings (Groceries)
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 500000,
        fromBucketId: bankId,
        category: 'Groceries',
        purpose: 'Monthly supermarket run',
        date: now,
      });

      // Expense 2: ₹2,000 from Personal Pocket (Personal Care - balance_only)
      await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'expense',
        amount: 200000,
        fromBucketId: pocketId,
        category: 'Personal Care',
        purpose: 'Gym membership',
        date: now,
      });

      // Owner inspects dashboard
      const ownerDashboard = await request(app).get('/dashboard').set('Cookie', owner.cookie);
      expect(ownerDashboard.body.monthSummary.totalIncome).toBe(10000000); // full salary ₹1,00,000
      expect(ownerDashboard.body.monthSummary.totalExpense).toBe(700000); // 5k + 2k = 7k
      expect(ownerDashboard.body.monthSummary.netSavings).toBe(9300000); // 93k

      // Partner inspects dashboard
      const partnerDashboard = await request(app).get('/dashboard').set('Cookie', partner.cookie);
      // Partner only sees shared income lines: 70k + 20k = 90k (9000000 paise)
      expect(partnerDashboard.body.monthSummary.totalIncome).toBe(9000000);
      // Partner only sees shared expense: 5k (500000 paise)
      expect(partnerDashboard.body.monthSummary.totalExpense).toBe(500000);
      expect(partnerDashboard.body.monthSummary.netSavings).toBe(8500000);

      // Verify recent transactions for partner: only 5k grocery expense and shared salary allocations
      const partnerTxPurposes = partnerDashboard.body.recentTransactions.map((t: any) => t.purpose);
      expect(partnerTxPurposes).not.toContain('Gym membership');
    });
  });

  /* ==========================================================================
     7. INDEX EXPLAIN TEST
     ========================================================================== */
  describe('Database Indexes & Query Explain', () => {
    it('proves that the primary transaction query uses an index', async () => {
      const { owner } = await setupHousehold();
      const householdId = new Types.ObjectId(owner.user.householdId);

      // Create compound indexes if not already registered
      await Transaction.init();

      // Explain query on Transaction collection
      const explanation = await Transaction.find({
        householdId,
        date: { $gte: new Date('2026-01-01'), $lte: new Date('2026-12-31') },
      })
        .sort({ date: -1, _id: -1 })
        .explain('executionStats');

      // Verify that query planner uses an index scan rather than a full collection scan (COLLSCAN)
      const winningPlan = (explanation as any).queryPlanner?.winningPlan;
      const stage = winningPlan?.stage;
      const inputStage = winningPlan?.inputStage?.stage;

      const isIndexUsed =
        stage === 'IXSCAN' ||
        inputStage === 'IXSCAN' ||
        stage === 'FETCH' ||
        stage === 'PROJECTION_COVERED';

      expect(isIndexUsed).toBe(true);
    });
  });
});
