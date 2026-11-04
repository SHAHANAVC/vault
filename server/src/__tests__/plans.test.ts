import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../app';
import { User } from '../models/User';
import { Bucket } from '../models/Bucket';
import { Transaction } from '../models/Transaction';
import { Plan } from '../models/Plan';

describe('Phase 7: EMI, Kuri and Recurring Payment Plans Integration Tests', () => {
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

  // Helper: create a bucket and add funds via initial opening balance
  async function createFundedBucket(
    cookie: string[],
    name: string,
    type: 'bank' | 'cash' | 'kuri',
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

  describe('EMI Scenario', () => {
    it('total 40,000, monthly 5,000: pays 8 times, completes at 40,000, 9th pay rejected, ledger correct', async () => {
      const { owner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'HDFC Bank', 'bank', 5000000); // 50,000 INR

      // 1. Create EMI Plan (total 40,000 INR = 4,000,000 paise, monthly 5,000 INR = 500,000 paise)
      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'MacBook EMI',
        totalAmount: 4000000,
        monthlyAmount: 500000,
        startDate: '2026-01-10T00:00:00.000Z',
        dueDay: 10,
        payFromBucketId: bank.id,
        reminderDaysBefore: 3,
        visibility: 'shared',
      });

      expect(planRes.status).toBe(201);
      const planId = planRes.body.id;
      expect(planRes.body.totalInstallments).toBe(8);
      expect(planRes.body.paidInstallments).toBe(0);
      expect(planRes.body.status).toBe('active');

      // 2. Pay 8 installments sequentially
      for (let i = 1; i <= 8; i++) {
        const payRes = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({
          date: new Date().toISOString(),
          idempotencyKey: `emi-payment-${i}`,
        });
        expect(payRes.status).toBe(201);
        expect(payRes.body.transaction.category).toBe('EMI');
        expect(payRes.body.transaction.type).toBe('expense');
        expect(payRes.body.transaction.installmentNumber).toBe(i);
        expect(payRes.body.transaction.planId).toBe(planId);
        expect(payRes.body.plan.paidInstallments).toBe(i);
        expect(payRes.body.plan.paidAmount).toBe(i * 500000);

        if (i < 8) {
          expect(payRes.body.plan.status).toBe('active');
        } else {
          expect(payRes.body.plan.status).toBe('completed');
          expect(payRes.body.plan.completedAt).toBeDefined();
        }
      }

      // 3. 9th payment attempt is rejected because plan is completed
      const extraPayRes = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({
        date: new Date().toISOString(),
      });
      expect(extraPayRes.status).toBe(400);
      expect(extraPayRes.body.message).toMatch(/completed/i);

      // 4. Verify paying bucket balance: 50,000 - 40,000 = 10,000 INR (1,000,000 paise)
      const updatedBank = await Bucket.findById(bank.id);
      expect(updatedBank!.balance).toBe(1000000);

      // 5. Verify total expenses recorded
      const txs = await Transaction.find({ planId, status: 'active' });
      expect(txs).toHaveLength(8);
      const totalExpense = txs.reduce((sum, t) => sum + t.amount, 0);
      expect(totalExpense).toBe(4000000);
    });

    it('uneven total 42,000: 8 payments of 5,000 and 9th payment of remaining 2,000 completes the plan', async () => {
      const { owner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'SBI Bank', 'bank', 5000000); // 50,000 INR

      // Total: 42,000 INR (4,200,000 paise), Monthly: 5,000 INR (500,000 paise) -> 9 installments
      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'Bike EMI',
        totalAmount: 4200000,
        monthlyAmount: 500000,
        startDate: '2026-02-05T00:00:00.000Z',
        dueDay: 5,
        payFromBucketId: bank.id,
        visibility: 'shared',
      });

      expect(planRes.status).toBe(201);
      const planId = planRes.body.id;
      expect(planRes.body.totalInstallments).toBe(9);

      // Pay 8 installments of 5,000 (total 40,000)
      for (let i = 1; i <= 8; i++) {
        const payRes = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
        expect(payRes.status).toBe(201);
        expect(payRes.body.transaction.amount).toBe(500000);
      }

      // Check plan state before 9th payment: remaining is 2,000 (200,000 paise)
      const planBefore9 = await request(app).get(`/plans/${planId}`).set('Cookie', owner.cookie);
      expect(planBefore9.body.plan.remainingAmount).toBe(200000);
      expect(planBefore9.body.plan.nextInstallmentAmount).toBe(200000);

      // Pay 9th installment (should automatically be 200,000 paise)
      const pay9Res = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
      expect(pay9Res.status).toBe(201);
      expect(pay9Res.body.transaction.amount).toBe(200000);
      expect(pay9Res.body.plan.paidAmount).toBe(4200000);
      expect(pay9Res.body.plan.paidInstallments).toBe(9);
      expect(pay9Res.body.plan.status).toBe('completed');
    });
  });

  describe('Double Payment & Concurrency Protections', () => {
    it('same installment cannot be paid twice; unique constraint prevents duplicate installment number', async () => {
      const { owner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'Axis Bank', 'bank', 2000000);

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'Phone EMI',
        totalAmount: 1000000,
        monthlyAmount: 500000,
        startDate: '2026-01-01T00:00:00.000Z',
        dueDay: 1,
        payFromBucketId: bank.id,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      // First pay succeeds
      const pay1 = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({
        idempotencyKey: 'tx-key-1',
      });
      expect(pay1.status).toBe(201);
      expect(pay1.body.transaction.installmentNumber).toBe(1);

      // Replaying with identical idempotencyKey returns existing transaction without double deduction
      const replay = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({
        idempotencyKey: 'tx-key-1',
      });
      expect([200, 201]).toContain(replay.status);
      expect(replay.body.transaction.id).toBe(pay1.body.transaction.id);

      // Bank balance only deducted once
      const bankDoc = await Bucket.findById(bank.id);
      expect(bankDoc!.balance).toBe(1500000);
    });

    it('parallel payment requests handle race conditions gracefully', async () => {
      const { owner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'Kotak Bank', 'bank', 2000000);

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'Tablet EMI',
        totalAmount: 500000,
        monthlyAmount: 500000,
        startDate: '2026-01-01T00:00:00.000Z',
        dueDay: 1,
        payFromBucketId: bank.id,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      // Send 2 concurrent requests to pay installment 1
      const [res1, res2] = await Promise.all([
        request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({}),
        request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({}),
      ]);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(201);
      // The other should either be 400 (already completed/already paid) or 409 (conflict)
      const errorStatus = statuses.find((s) => s !== 201);
      expect([400, 409]).toContain(errorStatus);

      // Plan should only have 1 active transaction
      const txs = await Transaction.find({ planId, status: 'active' });
      expect(txs).toHaveLength(1);
      const planDoc = await Plan.findById(planId);
      expect(planDoc!.paidInstallments).toBe(1);
      expect(planDoc!.paidAmount).toBe(500000);
    });
  });

  describe('Insufficient Balance Protection', () => {
    it('insufficient balance rejects payment, includes shortfall details, and leaves state unchanged', async () => {
      const { owner } = await setupHousehold();
      // Bucket only has 3,000 INR (300,000 paise)
      const bank = await createFundedBucket(owner.cookie, 'Low Balance Bank', 'bank', 300000);

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'AC EMI',
        totalAmount: 2000000,
        monthlyAmount: 500000, // 5,000 INR required
        startDate: '2026-03-01T00:00:00.000Z',
        dueDay: 1,
        payFromBucketId: bank.id,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      const payRes = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
      expect(payRes.status).toBe(400);
      expect(payRes.body.message).toMatch(/insufficient balance/i);

      // Bucket balance unchanged
      const bankDoc = await Bucket.findById(bank.id);
      expect(bankDoc!.balance).toBe(300000);

      // Plan paid amount remains 0
      const planDoc = await Plan.findById(planId);
      expect(planDoc!.paidAmount).toBe(0);
      expect(planDoc!.paidInstallments).toBe(0);
    });
  });

  describe('Voiding a Plan Payment', () => {
    it('voiding a payment restores paidAmount and reopens a completed plan', async () => {
      const { owner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'ICICI Bank', 'bank', 2000000);

      // 1-installment EMI
      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'Small EMI',
        totalAmount: 500000,
        monthlyAmount: 500000,
        startDate: '2026-01-01T00:00:00.000Z',
        dueDay: 1,
        payFromBucketId: bank.id,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      // Pay to completion
      const payRes = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
      expect(payRes.status).toBe(201);
      const txId = payRes.body.transaction.id;

      let planDoc = await Plan.findById(planId);
      expect(planDoc!.status).toBe('completed');
      expect(planDoc!.paidAmount).toBe(500000);
      expect(planDoc!.paidInstallments).toBe(1);

      // Bank balance reduced
      let bankDoc = await Bucket.findById(bank.id);
      expect(bankDoc!.balance).toBe(1500000);

      // Void the payment transaction via existing POST /transactions/:id/void
      const voidRes = await request(app).post(`/transactions/${txId}/void`).set('Cookie', owner.cookie).send({
        reason: 'Duplicate erroneous payment',
      });
      expect(voidRes.status).toBe(200);

      // Bank balance restored
      bankDoc = await Bucket.findById(bank.id);
      expect(bankDoc!.balance).toBe(2000000);

      // Plan is reopened to active, paid amount and installment count rolled back
      planDoc = await Plan.findById(planId);
      expect(planDoc!.status).toBe('active');
      expect(planDoc!.completedAt).toBeUndefined();
      expect(planDoc!.paidAmount).toBe(0);
      expect(planDoc!.paidInstallments).toBe(0);

      // Payment history reflects the voided payment
      const detailRes = await request(app).get(`/plans/${planId}`).set('Cookie', owner.cookie);
      expect(detailRes.body.payments).toHaveLength(1);
      expect(detailRes.body.payments[0].status).toBe('voided');
    });
  });

  describe('Kuri Scenario', () => {
    it('10 monthly transfers into Kuri bucket, payout back to bank, plan completes only after both', async () => {
      const { owner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'Salary Bank', 'bank', 10000000); // 100,000 INR
      const kuriBucket = await createFundedBucket(owner.cookie, 'Friends Kuri Fund', 'kuri', 0);

      // Create Kuri Plan: 10 installments of 5,000 INR = 50,000 INR total
      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'kuri',
        name: 'Friends Kuri 2026',
        monthlyAmount: 500000,
        totalInstallments: 10,
        startDate: '2026-01-15T00:00:00.000Z',
        dueDay: 15,
        payFromBucketId: bank.id,
        kuriBucketId: kuriBucket.id,
        visibility: 'shared',
      });

      expect(planRes.status).toBe(201);
      const planId = planRes.body.id;
      expect(planRes.body.totalAmount).toBe(5000000);

      // Pay 10 installments
      for (let i = 1; i <= 10; i++) {
        const payRes = await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});
        expect(payRes.status).toBe(201);
        expect(payRes.body.transaction.type).toBe('transfer');
        expect(payRes.body.transaction.fromBucketId).toBe(bank.id);
        expect(payRes.body.transaction.toBucketId).toBe(kuriBucket.id);
      }

      // Verify all installments paid, but plan is STILL active because payout is not recorded yet
      const planAfter10 = await Plan.findById(planId);
      expect(planAfter10!.paidInstallments).toBe(10);
      expect(planAfter10!.payoutRecorded).toBe(false);
      expect(planAfter10!.status).toBe('active');

      // Verify Kuri bucket balance has accumulated 50,000 INR (5,000,000 paise)
      let kuriDoc = await Bucket.findById(kuriBucket.id);
      expect(kuriDoc!.balance).toBe(5000000);

      // Record payout to the bank bucket
      const payoutRes = await request(app).post(`/plans/${planId}/payout`).set('Cookie', owner.cookie).send({
        destinationBucketId: bank.id,
        amount: 5000000,
        date: new Date().toISOString(),
        note: 'Kuri prize money received',
      });

      expect(payoutRes.status).toBe(200);
      expect(payoutRes.body.plan.payoutRecorded).toBe(true);
      expect(payoutRes.body.plan.status).toBe('completed');
      expect(payoutRes.body.transaction.type).toBe('transfer');
      expect(payoutRes.body.transaction.fromBucketId).toBe(kuriBucket.id);
      expect(payoutRes.body.transaction.toBucketId).toBe(bank.id);

      // Kuri bucket is back to 0
      kuriDoc = await Bucket.findById(kuriBucket.id);
      expect(kuriDoc!.balance).toBe(0);

      // Bank has all 100,000 INR back
      const bankDoc = await Bucket.findById(bank.id);
      expect(bankDoc!.balance).toBe(10000000);
    });
  });

  describe('Partner View and Privacy Enforcements', () => {
    it('private plan is hidden everywhere from partner (404 by id, excluded from list and alerts)', async () => {
      const { owner, partner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'Owner Private Bank', 'bank', 2000000, 'private');

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'Secret Gadget EMI',
        totalAmount: 1000000,
        monthlyAmount: 500000,
        startDate: '2026-01-01T00:00:00.000Z',
        dueDay: 1,
        payFromBucketId: bank.id,
        visibility: 'private',
      });
      const planId = planRes.body.id;

      // Partner GET /plans does not include private plan
      const partnerList = await request(app).get('/plans').set('Cookie', partner.cookie);
      expect(partnerList.status).toBe(200);
      expect(partnerList.body.plans.find((p: { id: string }) => p.id === planId)).toBeUndefined();

      // Partner GET /plans/:id returns 404
      const partnerGet = await request(app).get(`/plans/${planId}`).set('Cookie', partner.cookie);
      expect(partnerGet.status).toBe(404);

      // Partner POST /plans/:id/pay returns 404
      const partnerPay = await request(app).post(`/plans/${planId}/pay`).set('Cookie', partner.cookie).send({});
      expect(partnerPay.status).toBe(404);

      // Partner alerts does not include private plan
      const partnerAlerts = await request(app).get('/plans/alerts').set('Cookie', partner.cookie);
      expect(partnerAlerts.status).toBe(200);
      expect(partnerAlerts.body.alerts.find((a: { planId: string }) => a.planId === planId)).toBeUndefined();
    });

    it('shared plan is view-only for partner; partner cannot pay, update, or cancel', async () => {
      const { owner, partner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'Family Bank', 'bank', 2000000, 'shared');

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'Shared Fridge EMI',
        totalAmount: 1000000,
        monthlyAmount: 500000,
        startDate: '2026-01-01T00:00:00.000Z',
        dueDay: 1,
        payFromBucketId: bank.id,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      // Partner can view shared plan
      const partnerGet = await request(app).get(`/plans/${planId}`).set('Cookie', partner.cookie);
      expect(partnerGet.status).toBe(200);
      expect(partnerGet.body.plan.name).toBe('Shared Fridge EMI');

      // Partner cannot pay (403 Forbidden)
      const partnerPay = await request(app).post(`/plans/${planId}/pay`).set('Cookie', partner.cookie).send({});
      expect(partnerPay.status).toBe(403);
      expect(partnerPay.body.message).toMatch(/only the plan owner/i);

      // Partner cannot update (403 Forbidden)
      const partnerPatch = await request(app).patch(`/plans/${planId}`).set('Cookie', partner.cookie).send({
        name: 'Hacked Name',
      });
      expect(partnerPatch.status).toBe(403);

      // Partner cannot cancel (403 Forbidden)
      const partnerCancel = await request(app).post(`/plans/${planId}/cancel`).set('Cookie', partner.cookie);
      expect(partnerCancel.status).toBe(403);
    });

    it('shared plan paying from owner hidden bucket masks bucket details in partner alert', async () => {
      const { owner, partner } = await setupHousehold();
      // Owner creates a private bucket
      const privateBank = await createFundedBucket(owner.cookie, 'Secret Stash', 'bank', 100000, 'private');

      // Shared plan paying from owner's private bucket
      await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'Shared TV EMI',
        totalAmount: 1000000,
        monthlyAmount: 500000,
        startDate: new Date().toISOString(),
        dueDay: new Date().getDate(),
        payFromBucketId: privateBank.id,
        reminderDaysBefore: 5,
        visibility: 'shared',
      });

      // Partner queries alerts
      const partnerAlertsRes = await request(app).get('/plans/alerts').set('Cookie', partner.cookie);
      expect(partnerAlertsRes.status).toBe(200);
      const alert = partnerAlertsRes.body.alerts.find((a: { planName: string }) => a.planName === 'Shared TV EMI');
      expect(alert).toBeDefined();
      expect(alert.isMasked).toBe(true);
      expect(alert.payFromBucketName).toBe('Protected Bucket');
      // Partner never sees private balance or shortfall numbers
      expect(alert.bucketBalance).toBeUndefined();
      expect(alert.shortfallAmount).toBeUndefined();
    });
  });

  describe('Live Alerts & Dismissal', () => {
    it('computes due soon, overdue, shortfall summed across multiple plans on one bucket', async () => {
      const { owner } = await setupHousehold();
      // Bucket balance: 4,000 INR (400,000 paise)
      const bank = await createFundedBucket(owner.cookie, 'Shared Bank', 'bank', 400000);

      const today = new Date();
      const currentDay = today.getDate();

      // Plan A: monthly 3,000 INR (300,000 paise)
      await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'Plan Alpha',
        totalAmount: 3000000,
        monthlyAmount: 300000,
        startDate: today.toISOString(),
        dueDay: currentDay,
        payFromBucketId: bank.id,
        reminderDaysBefore: 5,
        visibility: 'shared',
      });

      // Plan B: monthly 2,000 INR (200,000 paise)
      await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'Plan Beta',
        totalAmount: 2000000,
        monthlyAmount: 200000,
        startDate: today.toISOString(),
        dueDay: currentDay,
        payFromBucketId: bank.id,
        reminderDaysBefore: 5,
        visibility: 'shared',
      });

      // Query alerts
      const alertsRes = await request(app).get('/plans/alerts').set('Cookie', owner.cookie);
      expect(alertsRes.status).toBe(200);
      expect(alertsRes.body.alerts).toHaveLength(2);

      // Shortfall check: total required = 300,000 + 200,000 = 500,000 paise. Balance = 400,000. Shortfall = 100,000 paise.
      const shortfallSummary = alertsRes.body.shortfalls.find(
        (s: { bucketId: string }) => s.bucketId === bank.id
      );
      expect(shortfallSummary).toBeDefined();
      expect(shortfallSummary.totalDueSoonOrOverdue).toBe(500000);
      expect(shortfallSummary.currentBalance).toBe(400000);
      expect(shortfallSummary.shortfall).toBe(100000);
    });

    it('dismissing an alert hides it for today only', async () => {
      const { owner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'Daily Bank', 'bank', 1000000);

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'Dismissable EMI',
        totalAmount: 1000000,
        monthlyAmount: 200000,
        startDate: new Date().toISOString(),
        dueDay: new Date().getDate(),
        payFromBucketId: bank.id,
        reminderDaysBefore: 5,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      // Initially present
      let alertsRes = await request(app).get('/plans/alerts').set('Cookie', owner.cookie);
      expect(alertsRes.body.alerts.find((a: { planId: string }) => a.planId === planId)).toBeDefined();

      // Dismiss for today
      const dismissRes = await request(app).post(`/plans/${planId}/dismiss`).set('Cookie', owner.cookie);
      expect(dismissRes.status).toBe(200);

      // Subsequent query excludes it
      alertsRes = await request(app).get('/plans/alerts').set('Cookie', owner.cookie);
      expect(alertsRes.body.alerts.find((a: { planId: string }) => a.planId === planId)).toBeUndefined();
    });

    it('completed plans produce no alerts', async () => {
      const { owner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'Finish Bank', 'bank', 1000000);

      const planRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'One-off EMI',
        totalAmount: 200000,
        monthlyAmount: 200000,
        startDate: new Date().toISOString(),
        dueDay: new Date().getDate(),
        payFromBucketId: bank.id,
        reminderDaysBefore: 5,
        visibility: 'shared',
      });
      const planId = planRes.body.id;

      // Pay it
      await request(app).post(`/plans/${planId}/pay`).set('Cookie', owner.cookie).send({});

      // Completed plan has no alerts
      const alertsRes = await request(app).get('/plans/alerts').set('Cookie', owner.cookie);
      expect(alertsRes.body.alerts.find((a: { planId: string }) => a.planId === planId)).toBeUndefined();
    });
  });

  describe('Reconcile Integrity Verification', () => {
    it('reconcile reports zero mismatches after EMI payments, Kuri contributions, payouts, and voids', async () => {
      const { owner } = await setupHousehold();
      const bank = await createFundedBucket(owner.cookie, 'Reconcile Bank', 'bank', 10000000);
      const kuriBucket = await createFundedBucket(owner.cookie, 'Reconcile Kuri', 'kuri', 0);

      // Create EMI
      const emiRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'emi',
        name: 'Reconcile EMI',
        totalAmount: 2000000,
        monthlyAmount: 1000000,
        startDate: '2026-01-01T00:00:00.000Z',
        dueDay: 1,
        payFromBucketId: bank.id,
        visibility: 'shared',
      });
      const emiId = emiRes.body.id;

      // Pay EMI installment 1
      const emiPay1 = await request(app).post(`/plans/${emiId}/pay`).set('Cookie', owner.cookie).send({});
      expect(emiPay1.status).toBe(201);

      // Create Kuri
      const kuriRes = await request(app).post('/plans').set('Cookie', owner.cookie).send({
        kind: 'kuri',
        name: 'Reconcile Kuri Plan',
        monthlyAmount: 1000000,
        totalInstallments: 2,
        startDate: '2026-01-01T00:00:00.000Z',
        dueDay: 1,
        payFromBucketId: bank.id,
        kuriBucketId: kuriBucket.id,
        visibility: 'shared',
      });
      const kuriId = kuriRes.body.id;

      // Pay Kuri installment 1 & 2
      await request(app).post(`/plans/${kuriId}/pay`).set('Cookie', owner.cookie).send({});
      await request(app).post(`/plans/${kuriId}/pay`).set('Cookie', owner.cookie).send({});

      // Record Kuri payout
      await request(app).post(`/plans/${kuriId}/payout`).set('Cookie', owner.cookie).send({
        destinationBucketId: bank.id,
        amount: 2000000,
      });

      // Void the EMI payment
      await request(app).post(`/transactions/${emiPay1.body.transaction.id}/void`).set('Cookie', owner.cookie).send({
        reason: 'Test void',
      });

      // Run reconcile check
      const recRes = await request(app).get('/transactions/reconcile').set('Cookie', owner.cookie);
      expect(recRes.status).toBe(200);
      expect(recRes.body.matches).toBe(true);
      expect(recRes.body.mismatches).toHaveLength(0);
    });
  });
});
