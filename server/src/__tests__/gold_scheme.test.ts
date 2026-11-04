import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../app';
import { User } from '../models/User';
import { Bucket } from '../models/Bucket';
import { Plan } from '../models/Plan';
import { getCurrentISTYearMonth } from '../utils/dateUtils';

describe('Gold Scheme Integration Tests (Replica Set + Supertest)', () => {
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

  // Helper: register user and return cookie + user document
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

  // Helper: setup household with owner and partner
  async function setupHousehold() {
    const owner = await registerUser('Arjun', 'arjun@example.com');
    const inviteRes = await request(app).post('/invites').set('Cookie', owner.cookie);
    const inviteToken = inviteRes.body.token as string;
    const partner = await registerUser('Priya', 'priya@example.com', 'Password123', inviteToken);
    return { owner, partner };
  }

  // Helper: create a bucket
  async function createFundedBucket(
    cookie: string[],
    name: string,
    type: 'bank' | 'cash' | 'kuri' | 'gold_scheme',
    balancePaise: number,
    visibility: 'shared' | 'balance_only' | 'private' = 'shared'
  ) {
    const bRes = await request(app).post('/buckets').set('Cookie', cookie).send({
      name,
      type,
      visibility,
      openingBalance: balancePaise,
    });
    return bRes.body.bucket;
  }

  describe('11 installments, balance, reporting, and net worth invariant', () => {
    it('11 installments of 5,000 into the gold bucket: balance 55,000, household expense total unchanged, net worth unchanged by the transfers', async () => {
      const { owner } = await setupHousehold();
      const currentMonth = getCurrentISTYearMonth();

      // Bank has ₹100,000 (10,000,000 paise)
      const bank = await createFundedBucket(owner.cookie, 'SBI Savings', 'bank', 10000000, 'shared');
      // Gold bucket starts with ₹0 (0 paise)
      const goldBucket = await createFundedBucket(owner.cookie, 'Tanishq Gold Scheme', 'gold_scheme', 0, 'shared');

      // Check initial Net Worth: ₹100,000
      const summaryBefore = await request(app).get('/buckets/summary').set('Cookie', owner.cookie);
      expect(summaryBefore.status).toBe(200);
      expect(summaryBefore.body.householdTotal).toBe(10000000);
      expect(summaryBefore.body.myTotal).toBe(10000000);

      // Create Gold Scheme Plan (11 installments of ₹5,000 = 500,000 paise, bonus ₹5,000)
      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Tanishq 11-Month Scheme',
        jewellerName: 'Tanishq',
        monthlyAmount: 500000,
        totalInstallments: 11,
        bonusAmount: 500000,
        startDate: '2026-01-15T00:00:00.000Z',
        dueDay: 15,
        payFromBucketId: bank.id,
        goldBucketId: goldBucket.id,
        reminderDaysBefore: 3,
        visibility: 'shared',
      });
      expect(planRes.status).toBe(201);
      const planId = planRes.body.id;

      // Pay all 11 installments
      for (let i = 1; i <= 11; i++) {
        const payRes = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
        expect(payRes.status).toBe(201);
        expect(payRes.body.plan.paidInstallments).toBe(i);
        expect(payRes.body.plan.paidAmount).toBe(i * 500000);
        expect(payRes.body.transaction.type).toBe('transfer');
        expect(payRes.body.transaction.category).toBe('Gold Scheme');
      }

      // Check Gold bucket balance: ₹55,000 (5,500,000 paise)
      const goldBucketUpdated = await Bucket.findById(goldBucket.id);
      expect(goldBucketUpdated?.balance).toBe(5500000);

      // Check Bank balance: ₹45,000 (4,500,000 paise)
      const bankUpdated = await Bucket.findById(bank.id);
      expect(bankUpdated?.balance).toBe(4500000);

      // Household expense total must remain UNCHANGED (transfers are excluded from expenses)
      const reportRes = await request(app).get(`/reports/summary?month=${currentMonth}`).set('Cookie', owner.cookie);
      expect(reportRes.status).toBe(200);
      expect(reportRes.body.totalExpense).toBe(0);

      // Net worth must be UNCHANGED by the transfers (10,000,000 paise)
      const summaryAfter = await request(app).get('/buckets/summary').set('Cookie', owner.cookie);
      expect(summaryAfter.status).toBe(200);
      expect(summaryAfter.body.householdTotal).toBe(10000000); // 45,000 + 55,000 = 100,000
      expect(summaryAfter.body.myTotal).toBe(10000000);
    });
  });

  describe('Duplicate payment and concurrency protection', () => {
    it('the same installment cannot be paid twice, including parallel requests', async () => {
      const { owner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'HDFC Bank', 'bank', 5000000);
      const goldBucket = await createFundedBucket(owner.cookie, 'Joyalukkas Gold', 'gold_scheme', 0);

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Joyalukkas Easy Gold',
        monthlyAmount: 500000,
        totalInstallments: 11,
        startDate: '2026-01-10T00:00:00.000Z',
        dueDay: 10,
        payFromBucketId: bank.id,
        goldBucketId: goldBucket.id,
        reminderDaysBefore: 3,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      // Pay installment #1
      const pay1 = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
      expect(pay1.status).toBe(201);
      expect(pay1.body.plan.paidInstallments).toBe(1);

      // Attempting to pay with the same idempotency key or parallel request
      const parallelRequests = [
        request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({ idempotencyKey: 'dup-key-1' }),
        request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({ idempotencyKey: 'dup-key-1' }),
      ];
      const results = await Promise.all(parallelRequests);
      const successCount = results.filter((r) => r.status === 201).length;
      expect(successCount).toBe(1);

      // Verify installment count is strictly 2
      const freshPlan = await Plan.findById(planId);
      expect(freshPlan?.paidInstallments).toBe(2);
    });
  });

  describe('Insufficient balance protection', () => {
    it('insufficient balance rejects the payment and changes nothing', async () => {
      const { owner } = await setupHousehold();
      // Bank has only ₹1,000 (100,000 paise)
      const bank = await createFundedBucket(owner.cookie, 'Low Bank', 'bank', 100000);
      const goldBucket = await createFundedBucket(owner.cookie, 'Malabar Gold', 'gold_scheme', 0);

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Malabar Smart Buy',
        monthlyAmount: 500000, // ₹5,000 required
        totalInstallments: 11,
        startDate: '2026-01-10T00:00:00.000Z',
        dueDay: 10,
        payFromBucketId: bank.id,
        goldBucketId: goldBucket.id,
        reminderDaysBefore: 3,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      const payRes = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
      expect(payRes.status).toBe(400);
      expect(payRes.body.message).toMatch(/Insufficient balance/i);

      // Balances and plan state must remain completely unchanged
      const bankFresh = await Bucket.findById(bank.id);
      expect(bankFresh?.balance).toBe(100000);
      const goldFresh = await Bucket.findById(goldBucket.id);
      expect(goldFresh?.balance).toBe(0);
      const planFresh = await Plan.findById(planId);
      expect(planFresh?.paidInstallments).toBe(0);
    });
  });

  describe('Bonus recording', () => {
    it('bonus: income entry once only; appears in income totals; second attempt rejected', async () => {
      const { owner } = await setupHousehold();
      const currentMonth = getCurrentISTYearMonth();

      const bank = await createFundedBucket(owner.cookie, 'ICICI Bank', 'bank', 5000000);
      const goldBucket = await createFundedBucket(owner.cookie, 'Kalyan Gold', 'gold_scheme', 0);

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Kalyan Gold Scheme',
        monthlyAmount: 500000,
        totalInstallments: 11,
        bonusAmount: 500000, // ₹5,000 bonus
        startDate: '2026-01-10T00:00:00.000Z',
        dueDay: 10,
        payFromBucketId: bank.id,
        goldBucketId: goldBucket.id,
        reminderDaysBefore: 3,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      // Record bonus
      const bonusRes = await request(app).post(`/plans/${planId}/bonus`).set('Cookie', owner.cookie).send({
        note: '11th month jeweller contribution',
      });
      expect(bonusRes.status).toBe(200);
      expect(bonusRes.body.plan.bonusRecorded).toBe(true);
      expect(bonusRes.body.transaction.type).toBe('income');
      expect(bonusRes.body.transaction.category).toBe('Scheme bonus');
      expect(bonusRes.body.transaction.amount).toBe(500000);

      // Gold bucket balance has received ₹5,000
      const goldBucketFresh = await Bucket.findById(goldBucket.id);
      expect(goldBucketFresh?.balance).toBe(500000);

      // Appears in household income totals
      const reportRes = await request(app).get(`/reports/summary?month=${currentMonth}`).set('Cookie', owner.cookie);
      expect(reportRes.status).toBe(200);
      expect(reportRes.body.totalIncome).toBe(500000);

      // Second attempt to record bonus MUST be rejected
      const secondBonusRes = await request(app).post(`/plans/${planId}/bonus`).set('Cookie', owner.cookie).send({});
      expect(secondBonusRes.status).toBe(400);
      expect(secondBonusRes.body.message).toMatch(/Bonus has already been recorded/i);
    });
  });

  describe('Redemption and Plan Completion', () => {
    it('redeem before all installments are paid is rejected; redeem above bucket balance is rejected', async () => {
      const { owner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'Axis Bank', 'bank', 10000000);
      const goldBucket = await createFundedBucket(owner.cookie, 'Tanishq Vault', 'gold_scheme', 0);

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Premature Redeem Test',
        monthlyAmount: 500000,
        totalInstallments: 11,
        bonusAmount: 500000,
        startDate: '2026-01-10T00:00:00.000Z',
        dueDay: 10,
        payFromBucketId: bank.id,
        goldBucketId: goldBucket.id,
        reminderDaysBefore: 3,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      // Pay only 1 installment
      await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});

      // Attempt redeem -> REJECTED (incomplete installments)
      const prematureRedeem = await request(app).post(`/plans/${planId}/redeem`).set('Cookie', owner.cookie).send({
        option: 'jewellery',
        amount: 500000,
      });
      expect(prematureRedeem.status).toBe(400);
      expect(prematureRedeem.body.message).toMatch(/all installments are paid/i);

      // Pay remaining 10 installments
      for (let i = 2; i <= 11; i++) {
        await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
      }

      // Record bonus
      await request(app).post(`/plans/${planId}/bonus`).set('Cookie', owner.cookie).send({});
      // Gold bucket balance is now 55,000 + 5,000 = 60,000 INR (6,000,000 paise)

      // Attempt redeem above bucket balance (e.g. 7,000,000 paise) -> REJECTED
      const excessRedeem = await request(app).post(`/plans/${planId}/redeem`).set('Cookie', owner.cookie).send({
        option: 'jewellery',
        amount: 7000000,
      });
      expect(excessRedeem.status).toBe(400);
      expect(excessRedeem.body.message).toMatch(/cannot exceed.*bucket balance/i);
    });

    it('the plan completes only after all installments AND redeem', async () => {
      const { owner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'HDFC Bank', 'bank', 10000000);
      const goldBucket = await createFundedBucket(owner.cookie, 'Gold Reserve', 'gold_scheme', 0);

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Completion Invariant Plan',
        monthlyAmount: 500000,
        totalInstallments: 5,
        bonusAmount: 500000,
        startDate: '2026-01-10T00:00:00.000Z',
        dueDay: 10,
        payFromBucketId: bank.id,
        goldBucketId: goldBucket.id,
        reminderDaysBefore: 3,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      // Pay all 5 installments
      for (let i = 1; i <= 5; i++) {
        await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
      }

      // Plan should STILL BE active (not completed yet because redeem is not recorded)
      const planAfterInstallments = await Plan.findById(planId);
      expect(planAfterInstallments?.status).toBe('active');
      expect(planAfterInstallments?.paidInstallments).toBe(5);
      expect(planAfterInstallments?.redeemRecorded).toBe(false);

      // Now record redeem option a (Bought jewellery)
      const redeemRes = await request(app).post(`/plans/${planId}/redeem`).set('Cookie', owner.cookie).send({
        option: 'jewellery',
        amount: 2500000, // 25,000 INR
        note: 'Gold ring',
      });
      expect(redeemRes.status).toBe(200);
      expect(redeemRes.body.plan.status).toBe('completed');
      expect(redeemRes.body.plan.redeemRecorded).toBe(true);
      expect(redeemRes.body.plan.redeemOption).toBe('jewellery');

      // Database verification
      const planCompleted = await Plan.findById(planId);
      expect(planCompleted?.status).toBe('completed');
    });

    it('redeem option a: expense category "Jewellery" appears in expense totals', async () => {
      const { owner } = await setupHousehold();
      const currentMonth = getCurrentISTYearMonth();

      const bank = await createFundedBucket(owner.cookie, 'Canara Bank', 'bank', 5000000);
      const goldBucket = await createFundedBucket(owner.cookie, 'Gold Option A', 'gold_scheme', 0);

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Jewellery Option Plan',
        monthlyAmount: 500000,
        totalInstallments: 2,
        startDate: '2026-01-10T00:00:00.000Z',
        dueDay: 10,
        payFromBucketId: bank.id,
        goldBucketId: goldBucket.id,
        reminderDaysBefore: 3,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      // Pay 2 installments (1,000,000 paise in gold bucket)
      await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
      await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});

      // Redeem via option a: jewellery
      const redeemRes = await request(app).post(`/plans/${planId}/redeem`).set('Cookie', owner.cookie).send({
        option: 'jewellery',
        amount: 1000000,
        note: 'Bridal necklace',
      });
      expect(redeemRes.status).toBe(200);
      expect(redeemRes.body.transaction.type).toBe('expense');
      expect(redeemRes.body.transaction.category).toBe('Jewellery');
      expect(redeemRes.body.transaction.amount).toBe(1000000);

      // Gold bucket balance is now 0
      const goldBucketFresh = await Bucket.findById(goldBucket.id);
      expect(goldBucketFresh?.balance).toBe(0);

      // Appears in household expense report
      const reportRes = await request(app).get(`/reports/summary?month=${currentMonth}`).set('Cookie', owner.cookie);
      expect(reportRes.status).toBe(200);
      expect(reportRes.body.totalExpense).toBe(1000000);
    });

    it('redeem option b: transfer, excluded from expense totals', async () => {
      const { owner } = await setupHousehold();
      const currentMonth = getCurrentISTYearMonth();

      const bank = await createFundedBucket(owner.cookie, 'HDFC Bank', 'bank', 5000000);
      const goldBucket = await createFundedBucket(owner.cookie, 'Gold Option B', 'gold_scheme', 0);

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Cash Refund Option Plan',
        monthlyAmount: 500000,
        totalInstallments: 2,
        startDate: '2026-01-10T00:00:00.000Z',
        dueDay: 10,
        payFromBucketId: bank.id,
        goldBucketId: goldBucket.id,
        reminderDaysBefore: 3,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      // Pay 2 installments (1,000,000 paise)
      await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
      await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});

      // Bank balance before refund: 5,000,000 - 1,000,000 = 4,000,000
      // Redeem via option b: cash_refund to bank
      const redeemRes = await request(app).post(`/plans/${planId}/redeem`).set('Cookie', owner.cookie).send({
        option: 'cash_refund',
        amount: 1000000,
        toBucketId: bank.id,
        note: 'Cash refund received',
      });
      expect(redeemRes.status).toBe(200);
      expect(redeemRes.body.transaction.type).toBe('transfer');
      expect(redeemRes.body.transaction.category).toBe('Gold Scheme Refund');

      // Bank balance receives the 1,000,000 back -> 5,000,000
      const bankFresh = await Bucket.findById(bank.id);
      expect(bankFresh?.balance).toBe(5000000);
      const goldFresh = await Bucket.findById(goldBucket.id);
      expect(goldFresh?.balance).toBe(0);

      // Excluded from expense totals! (Expense remains 0)
      const reportRes = await request(app).get(`/reports/summary?month=${currentMonth}`).set('Cookie', owner.cookie);
      expect(reportRes.status).toBe(200);
      expect(reportRes.body.totalExpense).toBe(0);
    });
  });

  describe('Voiding payments, bonus and redeem', () => {
    it('voiding a payment, the bonus and the redeem each restores the plan state and reopens a completed plan', async () => {
      const { owner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'Federal Bank', 'bank', 10000000);
      const goldBucket = await createFundedBucket(owner.cookie, 'Gold Void Test', 'gold_scheme', 0);

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Void Lifecycle Plan',
        monthlyAmount: 500000,
        totalInstallments: 2,
        bonusAmount: 500000,
        startDate: '2026-01-10T00:00:00.000Z',
        dueDay: 10,
        payFromBucketId: bank.id,
        goldBucketId: goldBucket.id,
        reminderDaysBefore: 3,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      // 1. Pay installment 1 & 2
      await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
      const pay2Res = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
      const pay2TxId = pay2Res.body.transaction.id;

      // 2. Record bonus
      const bonusRes = await request(app).post(`/plans/${planId}/bonus`).set('Cookie', owner.cookie).send({});
      const bonusTxId = bonusRes.body.transaction.id;

      // 3. Redeem jewellery (completes plan)
      const redeemRes = await request(app).post(`/plans/${planId}/redeem`).set('Cookie', owner.cookie).send({
        option: 'jewellery',
        amount: 1500000, // 10,000 + 5,000 = 15,000 INR
      });
      const redeemTxId = redeemRes.body.transaction.id;
      expect(redeemRes.body.plan.status).toBe('completed');

      // A. VOID REDEEM TRANSACTION -> Reopens completed plan!
      const voidRedeem = await request(app).post(`/transactions/${redeemTxId}/void`).set('Cookie', owner.cookie).send({
        reason: 'Redeem mistake',
      });
      expect(voidRedeem.status).toBe(200);

      const planAfterVoidRedeem = await Plan.findById(planId);
      expect(planAfterVoidRedeem?.status).toBe('active');
      expect(planAfterVoidRedeem?.redeemRecorded).toBe(false);
      expect(planAfterVoidRedeem?.redeemOption).toBeUndefined();

      // Gold bucket balance restored to 1,500,000 paise
      const goldRestored = await Bucket.findById(goldBucket.id);
      expect(goldRestored?.balance).toBe(1500000);

      // B. VOID BONUS TRANSACTION -> Resets bonusRecorded to false!
      const voidBonus = await request(app).post(`/transactions/${bonusTxId}/void`).set('Cookie', owner.cookie).send({
        reason: 'Bonus correction',
      });
      expect(voidBonus.status).toBe(200);

      const planAfterVoidBonus = await Plan.findById(planId);
      expect(planAfterVoidBonus?.bonusRecorded).toBe(false);
      const goldAfterVoidBonus = await Bucket.findById(goldBucket.id);
      expect(goldAfterVoidBonus?.balance).toBe(1000000);

      // C. VOID INSTALLMENT #2 -> Decrements paidInstallments from 2 to 1!
      const voidPay2 = await request(app).post(`/transactions/${pay2TxId}/void`).set('Cookie', owner.cookie).send({
        reason: 'Duplicate payment void',
      });
      expect(voidPay2.status).toBe(200);

      const planAfterVoidPay2 = await Plan.findById(planId);
      expect(planAfterVoidPay2?.paidInstallments).toBe(1);
      expect(planAfterVoidPay2?.paidAmount).toBe(500000);
      const goldAfterVoidPay2 = await Bucket.findById(goldBucket.id);
      expect(goldAfterVoidPay2?.balance).toBe(500000);
      const bankAfterVoidPay2 = await Bucket.findById(bank.id);
      expect(bankAfterVoidPay2?.balance).toBe(9500000); // 500,000 refunded to bank
    });
  });

  describe('Privacy and Partner Isolation', () => {
    it('private gold plan and bucket hidden from partner everywhere; shared plan view-only; partner cannot pay, bonus or redeem', async () => {
      const { owner, partner } = await setupHousehold();

      // Owner creates a private gold bucket and a private gold plan
      const bank = await createFundedBucket(owner.cookie, 'Joint Bank', 'bank', 5000000, 'shared');
      const privateGoldBucket = await createFundedBucket(owner.cookie, 'Private Gold Vault', 'gold_scheme', 0, 'private');

      const privatePlanRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Private Gold Scheme',
        monthlyAmount: 500000,
        totalInstallments: 5,
        bonusAmount: 500000,
        startDate: '2026-01-10T00:00:00.000Z',
        dueDay: 10,
        payFromBucketId: bank.id,
        goldBucketId: privateGoldBucket.id,
        reminderDaysBefore: 3,
        visibility: 'private',
      });
      const privatePlanId = privatePlanRes.body.id;

      // Partner cannot see private plan in list
      const partnerPlansList = await request(app).get('/plans').set('Cookie', partner.cookie);
      expect(partnerPlansList.body.plans.find((p: any) => p.id === privatePlanId)).toBeUndefined();

      // Partner gets 404 when querying private plan by ID
      const partnerPlanGet = await request(app).get(`/plans/${privatePlanId}`).set('Cookie', partner.cookie);
      expect(partnerPlanGet.status).toBe(404);

      // Now create a SHARED Gold Scheme
      const sharedGoldBucket = await createFundedBucket(owner.cookie, 'Family Gold Scheme', 'gold_scheme', 0, 'shared');
      const sharedPlanRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Shared Family Gold',
        monthlyAmount: 500000,
        totalInstallments: 5,
        bonusAmount: 500000,
        startDate: '2026-01-10T00:00:00.000Z',
        dueDay: 10,
        payFromBucketId: bank.id,
        goldBucketId: sharedGoldBucket.id,
        reminderDaysBefore: 3,
        visibility: 'shared',
      });
      const sharedPlanId = sharedPlanRes.body.id;

      // Partner CAN view shared plan
      const partnerSharedGet = await request(app).get(`/plans/${sharedPlanId}`).set('Cookie', partner.cookie);
      expect(partnerSharedGet.status).toBe(200);
      expect(partnerSharedGet.body.plan.name).toBe('Shared Family Gold');

      // Partner CANNOT pay the shared plan (Creator-only mutation rule)
      const partnerPay = await request(app).post(`/plans/${sharedPlanId}/pay`).set('Cookie', partner.cookie).send({});
      expect(partnerPay.status).toBe(403);

      // Partner CANNOT record bonus
      const partnerBonus = await request(app).post(`/plans/${sharedPlanId}/bonus`).set('Cookie', partner.cookie).send({});
      expect(partnerBonus.status).toBe(403);

      // Partner CANNOT redeem
      const partnerRedeem = await request(app).post(`/plans/${sharedPlanId}/redeem`).set('Cookie', partner.cookie).send({
        option: 'jewellery',
        amount: 500000,
      });
      expect(partnerRedeem.status).toBe(403);
    });
  });

  describe('Alerts Engine', () => {
    it('alerts: due soon, overdue, shortfall summed with other plans on one bucket; completed plan produces no alerts', async () => {
      const { owner } = await setupHousehold();
      // Bank has only ₹3,000 (300,000 paise)
      const bank = await createFundedBucket(owner.cookie, 'Alerts Bank', 'bank', 300000);
      const goldBucket = await createFundedBucket(owner.cookie, 'Gold Alerts', 'gold_scheme', 0);

      const today = new Date();
      const currentDay = today.getDate();

      // Create Gold Plan requiring ₹5,000 per month
      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Shortfall Gold Plan',
        monthlyAmount: 500000, // 500,000 paise
        totalInstallments: 1,
        bonusAmount: 0,
        startDate: today.toISOString(),
        dueDay: currentDay,
        payFromBucketId: bank.id,
        goldBucketId: goldBucket.id,
        reminderDaysBefore: 5,
        visibility: 'shared',
      });
      expect(planRes.status).toBe(201);
      const planId = planRes.body.id;

      // Check alerts: Bank has 300,000, but needs 500,000 -> Shortfall is 200,000 paise
      const alertsRes = await request(app).get('/plans/alerts').set('Cookie', owner.cookie);
      expect(alertsRes.status).toBe(200);
      expect(alertsRes.body.shortfalls.length).toBeGreaterThan(0);
      const bankShortfall = alertsRes.body.shortfalls.find((s: any) => s.bucketId === bank.id);
      expect(bankShortfall).toBeDefined();
      expect(bankShortfall.shortfall).toBe(200000);

      // Add funds to bank so shortfall clears and we can pay
      const incRes = await request(app).post('/transactions').set('Cookie', owner.cookie).send({
        type: 'income',
        amount: 1000000,
        toBucketId: bank.id,
        category: 'Salary',
        date: new Date().toISOString(),
      });
      expect(incRes.status).toBe(201);

      // Pay the 1 installment
      const payRes = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
      expect(payRes.status).toBe(201);

      // Redeem to complete plan
      const redeemRes = await request(app).post(`/plans/${planId}/redeem`).set('Cookie', owner.cookie).send({
        option: 'jewellery',
        amount: 500000,
      });
      expect(redeemRes.status).toBe(200);

      // Completed plan MUST produce zero alerts!
      const alertsAfterCompletion = await request(app).get('/plans/alerts').set('Cookie', owner.cookie);
      expect(alertsAfterCompletion.status).toBe(200);
      expect(alertsAfterCompletion.body.alerts.find((p: any) => p.planId === planId)).toBeUndefined();
    });
  });

  describe('Reconcile Integrity Verification', () => {
    it('reconcile zero mismatches after a mix of installments, bonus, redeem (both options) and voids', async () => {
      const { owner } = await setupHousehold();

      const bank = await createFundedBucket(owner.cookie, 'Reconcile Primary Bank', 'bank', 20000000);
      const goldBucket1 = await createFundedBucket(owner.cookie, 'Reconcile Gold Scheme 1', 'gold_scheme', 0);
      const goldBucket2 = await createFundedBucket(owner.cookie, 'Reconcile Gold Scheme 2', 'gold_scheme', 0);

      // Plan 1: jewellery redeem
      const p1Res = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Scheme 1 - Jewellery',
        monthlyAmount: 500000,
        totalInstallments: 3,
        bonusAmount: 500000,
        startDate: '2026-01-10T00:00:00.000Z',
        dueDay: 10,
        payFromBucketId: bank.id,
        goldBucketId: goldBucket1.id,
        reminderDaysBefore: 3,
        visibility: 'shared',
      });
      const p1Id = p1Res.body.id;

      // Plan 2: cash refund redeem
      const p2Res = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'gold_scheme',
        name: 'Scheme 2 - Cash Refund',
        monthlyAmount: 500000,
        totalInstallments: 2,
        bonusAmount: 0,
        startDate: '2026-01-10T00:00:00.000Z',
        dueDay: 10,
        payFromBucketId: bank.id,
        goldBucketId: goldBucket2.id,
        reminderDaysBefore: 3,
        visibility: 'shared',
      });
      const p2Id = p2Res.body.id;

      // Plan 1 payments + bonus + redeem + void
      await request(app).post(`/plans/${p1Id}/pay`).set('Cookie', owner.cookie).send({});
      await request(app).post(`/plans/${p1Id}/pay`).set('Cookie', owner.cookie).send({});
      await request(app).post(`/plans/${p1Id}/pay`).set('Cookie', owner.cookie).send({});
      await request(app).post(`/plans/${p1Id}/bonus`).set('Cookie', owner.cookie).send({});
      const p1Redeem = await request(app).post(`/plans/${p1Id}/redeem`).set('Cookie', owner.cookie).send({
        option: 'jewellery',
        amount: 2000000,
      });

      // Void redeem of Plan 1
      await request(app).post(`/transactions/${p1Redeem.body.transaction.id}/void`).set('Cookie', owner.cookie).send({
        reason: 'Void redeem',
      });

      // Plan 2 payments + cash refund redeem
      await request(app).post(`/plans/${p2Id}/pay`).set('Cookie', owner.cookie).send({});
      await request(app).post(`/plans/${p2Id}/pay`).set('Cookie', owner.cookie).send({});
      await request(app).post(`/plans/${p2Id}/redeem`).set('Cookie', owner.cookie).send({
        option: 'cash_refund',
        amount: 1000000,
        toBucketId: bank.id,
      });

      // Run Reconcile API
      const reconcileRes = await request(app).get('/transactions/reconcile').set('Cookie', owner.cookie);
      expect(reconcileRes.status).toBe(200);
      expect(reconcileRes.body.matches).toBe(true);
      expect(reconcileRes.body.mismatches).toHaveLength(0);
    });
  });
});
