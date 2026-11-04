import {
  calculateInstallmentsCount,
  calculateNextInstallmentAmount,
  calculateNextDueDate,
  calculateReminderDate,
  calculatePlanDerivedState,
  getDaysInMonth,
  createPlanSchema,
} from '../plan';

describe('Phase 7: Plan Schemas & Pure Calculation Invariants', () => {
  describe('Days in month and leap year rules', () => {
    it('handles February in standard non-leap year (2026)', () => {
      expect(getDaysInMonth(2026, 2)).toBe(28);
    });

    it('handles February in leap year (2028, 2024, 2000)', () => {
      expect(getDaysInMonth(2028, 2)).toBe(29);
      expect(getDaysInMonth(2024, 2)).toBe(29);
      expect(getDaysInMonth(2000, 2)).toBe(29);
    });

    it('handles February in century non-leap year (2100, 1900)', () => {
      expect(getDaysInMonth(2100, 2)).toBe(28);
    });

    it('handles 30-day months (Apr, Jun, Sep, Nov)', () => {
      expect(getDaysInMonth(2026, 4)).toBe(30);
      expect(getDaysInMonth(2026, 6)).toBe(30);
      expect(getDaysInMonth(2026, 9)).toBe(30);
      expect(getDaysInMonth(2026, 11)).toBe(30);
    });

    it('handles 31-day months (Jan, Mar, May, Jul, Aug, Oct, Dec)', () => {
      expect(getDaysInMonth(2026, 1)).toBe(31);
      expect(getDaysInMonth(2026, 3)).toBe(31);
      expect(getDaysInMonth(2026, 5)).toBe(31);
      expect(getDaysInMonth(2026, 7)).toBe(31);
      expect(getDaysInMonth(2026, 8)).toBe(31);
      expect(getDaysInMonth(2026, 10)).toBe(31);
      expect(getDaysInMonth(2026, 12)).toBe(31);
    });
  });

  describe('Installments Count calculation', () => {
    it('calculates exact EMI division: 40,000 with 5,000 monthly = 8', () => {
      const count = calculateInstallmentsCount('emi', 4000000, 500000);
      expect(count).toBe(8);
    });

    it('calculates uneven EMI ceiling: 42,000 with 5,000 monthly = 9', () => {
      const count = calculateInstallmentsCount('emi', 4200000, 500000);
      expect(count).toBe(9);
    });

    it('respects kuri fixed installments count', () => {
      const count = calculateInstallmentsCount('kuri', 2000000, 200000, 10);
      expect(count).toBe(10);
    });
  });

  describe('Next installment amount & uneven last payment', () => {
    it('returns monthly amount for intermediate installments', () => {
      // 42,000 total, 5,000 monthly, paid 20,000 (4 paid)
      const nextAmount = calculateNextInstallmentAmount('emi', 4200000, 500000, 2000000);
      expect(nextAmount).toBe(500000);
    });

    it('returns partial remaining amount for last installment (42,000 total, 40,000 paid -> 2,000)', () => {
      const lastAmount = calculateNextInstallmentAmount('emi', 4200000, 500000, 4000000);
      expect(lastAmount).toBe(200000); // exactly 2,000 INR in paise
    });

    it('returns regular monthly amount for kuri installments', () => {
      const kuriAmount = calculateNextInstallmentAmount('kuri', 2000000, 200000, 1800000);
      expect(kuriAmount).toBe(200000);
    });
  });

  describe('Next Due Date clamping and short months in IST', () => {
    it('clamps due day 31 to Feb 28 in non-leap year (2026)', () => {
      // Start in Jan 2026, installment 1 (paid 1) is February
      const startDate = '2026-01-15T00:00:00.000Z';
      const febDueDate = calculateNextDueDate(startDate, 31, 1);
      expect(febDueDate).toContain('2026-02-28');
    });

    it('clamps due day 31 to Feb 29 in leap year (2028)', () => {
      const startDate = '2028-01-10T00:00:00.000Z';
      const febDueDate = calculateNextDueDate(startDate, 31, 1);
      expect(febDueDate).toContain('2028-02-29');
    });

    it('clamps due day 31 to April 30', () => {
      const startDate = '2026-01-01T00:00:00.000Z';
      // 3 months later is April (0: Jan, 1: Feb, 2: Mar, 3: Apr)
      const aprDueDate = calculateNextDueDate(startDate, 31, 3);
      expect(aprDueDate).toContain('2026-04-30');
    });

    it('keeps exact due day when month has enough days (Day 15)', () => {
      const startDate = '2026-01-01T00:00:00.000Z';
      const febDueDate = calculateNextDueDate(startDate, 15, 1);
      expect(febDueDate).toContain('2026-02-15');
    });
  });

  describe('Reminder Date calculation', () => {
    it('calculates reminder date = due date minus reminderDaysBefore', () => {
      const dueDate = '2026-10-15T00:00:00.000+05:30';
      const reminder = calculateReminderDate(dueDate, 3);
      const reminderDate = new Date(reminder);
      const dueDateObj = new Date(dueDate);

      const diffDays = (dueDateObj.getTime() - reminderDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(3);
    });
  });

  describe('calculatePlanDerivedState helper', () => {
    it('derives state correctly for active EMI with remaining amount', () => {
      const state = calculatePlanDerivedState({
        kind: 'emi',
        totalAmount: 4200000,
        monthlyAmount: 500000,
        totalInstallments: 9,
        paidAmount: 4000000,
        paidInstallments: 8,
        dueDay: 10,
        startDate: '2026-01-10T00:00:00.000Z',
        status: 'active',
      });

      expect(state.isCompleted).toBe(false);
      expect(state.remainingAmount).toBe(200000);
      expect(state.remainingInstallments).toBe(1);
      expect(state.nextInstallmentNumber).toBe(9);
      expect(state.nextInstallmentAmount).toBe(200000);
      expect(state.nextDueDate).toBeDefined();
    });

    it('marks EMI completed when paidAmount reaches totalAmount', () => {
      const state = calculatePlanDerivedState({
        kind: 'emi',
        totalAmount: 4000000,
        monthlyAmount: 500000,
        totalInstallments: 8,
        paidAmount: 4000000,
        paidInstallments: 8,
        dueDay: 10,
        startDate: '2026-01-10T00:00:00.000Z',
        status: 'completed',
      });

      expect(state.isCompleted).toBe(true);
      expect(state.remainingAmount).toBe(0);
      expect(state.remainingInstallments).toBe(0);
      expect(state.nextInstallmentNumber).toBeUndefined();
    });

    it('requires both installments AND payoutRecorded for kuri completion', () => {
      const unpaidPayout = calculatePlanDerivedState({
        kind: 'kuri',
        totalAmount: 1000000,
        monthlyAmount: 100000,
        totalInstallments: 10,
        paidAmount: 1000000,
        paidInstallments: 10,
        dueDay: 5,
        startDate: '2026-01-05T00:00:00.000Z',
        status: 'active',
        payoutRecorded: false,
      });
      expect(unpaidPayout.isCompleted).toBe(false);

      const completedKuri = calculatePlanDerivedState({
        kind: 'kuri',
        totalAmount: 1000000,
        monthlyAmount: 100000,
        totalInstallments: 10,
        paidAmount: 1000000,
        paidInstallments: 10,
        dueDay: 5,
        startDate: '2026-01-05T00:00:00.000Z',
        status: 'active',
        payoutRecorded: true,
      });
      expect(completedKuri.isCompleted).toBe(true);
    });
  });

  describe('createPlanSchema validation', () => {
    it('validates a valid EMI plan', () => {
      const valid = {
        kind: 'emi',
        name: 'MacBook Pro EMI',
        totalAmount: 15000000,
        monthlyAmount: 1500000,
        startDate: new Date().toISOString(),
        dueDay: 5,
        payFromBucketId: '507f1f77bcf86cd799439011',
        reminderDaysBefore: 3,
        visibility: 'shared',
      };
      const res = createPlanSchema.safeParse(valid);
      expect(res.success).toBe(true);
    });

    it('rejects EMI if monthlyAmount exceeds totalAmount', () => {
      const invalid = {
        kind: 'emi',
        name: 'Invalid EMI',
        totalAmount: 500000,
        monthlyAmount: 600000,
        startDate: new Date().toISOString(),
        dueDay: 5,
        payFromBucketId: '507f1f77bcf86cd799439011',
      };
      const res = createPlanSchema.safeParse(invalid);
      expect(res.success).toBe(false);
    });

    it('validates a valid Kuri plan', () => {
      const valid = {
        kind: 'kuri',
        name: 'Community Kuri Fund',
        monthlyAmount: 500000,
        totalInstallments: 20,
        startDate: new Date().toISOString(),
        dueDay: 10,
        payFromBucketId: '507f1f77bcf86cd799439011',
        kuriBucketId: '507f1f77bcf86cd799439022',
        reminderDaysBefore: 5,
        visibility: 'shared',
      };
      const res = createPlanSchema.safeParse(valid);
      expect(res.success).toBe(true);
    });

    it('rejects Kuri if payFromBucketId equals kuriBucketId', () => {
      const invalid = {
        kind: 'kuri',
        name: 'Same Bucket Kuri',
        monthlyAmount: 500000,
        totalInstallments: 10,
        startDate: new Date().toISOString(),
        dueDay: 10,
        payFromBucketId: '507f1f77bcf86cd799439011',
        kuriBucketId: '507f1f77bcf86cd799439011',
      };
      const res = createPlanSchema.safeParse(invalid);
      expect(res.success).toBe(false);
    });

    it('validates a valid Gold Scheme plan', () => {
      const valid = {
        kind: 'gold_scheme',
        name: 'Malabar Gold Scheme 11M',
        jewellerName: 'Malabar Gold & Diamonds',
        monthlyAmount: 500000,
        totalInstallments: 11,
        bonusAmount: 500000,
        startDate: new Date().toISOString(),
        dueDay: 15,
        payFromBucketId: '507f1f77bcf86cd799439011',
        goldBucketId: '507f1f77bcf86cd799439033',
        reminderDaysBefore: 3,
        visibility: 'shared',
      };
      const res = createPlanSchema.safeParse(valid);
      expect(res.success).toBe(true);
    });

    it('rejects Gold Scheme if payFromBucketId equals goldBucketId', () => {
      const invalid = {
        kind: 'gold_scheme',
        name: 'Same Bucket Gold Scheme',
        monthlyAmount: 500000,
        totalInstallments: 11,
        startDate: new Date().toISOString(),
        dueDay: 15,
        payFromBucketId: '507f1f77bcf86cd799439011',
        goldBucketId: '507f1f77bcf86cd799439011',
      };
      const res = createPlanSchema.safeParse(invalid);
      expect(res.success).toBe(false);
    });
  });

  describe('Gold Scheme Bonus & Redeem Schemas & Invariants', () => {
    it('calculates gold_scheme installments count and monthly amount', () => {
      expect(calculateInstallmentsCount('gold_scheme', 5500000, 500000, 11)).toBe(11);
      expect(calculateNextInstallmentAmount('gold_scheme', 5500000, 500000, 2000000)).toBe(500000);
    });

    it('marks gold_scheme completed ONLY when all installments paid AND redeem recorded', () => {
      const incomplete = calculatePlanDerivedState({
        kind: 'gold_scheme',
        totalAmount: 5500000,
        monthlyAmount: 500000,
        totalInstallments: 11,
        paidAmount: 5500000,
        paidInstallments: 11,
        dueDay: 15,
        startDate: '2026-01-15T00:00:00.000Z',
        status: 'active',
        redeemRecorded: false, // Not yet redeemed!
      });
      expect(incomplete.isCompleted).toBe(false);

      const completed = calculatePlanDerivedState({
        kind: 'gold_scheme',
        totalAmount: 5500000,
        monthlyAmount: 500000,
        totalInstallments: 11,
        paidAmount: 5500000,
        paidInstallments: 11,
        dueDay: 15,
        startDate: '2026-01-15T00:00:00.000Z',
        status: 'active',
        redeemRecorded: true, // Redeemed!
      });
      expect(completed.isCompleted).toBe(true);
    });
  });
});
