import {
  incomeInputSchema,
  expenseInputSchema,
  transferInputSchema,
  adjustmentInputSchema,
  adjustmentSchema,
  transactionInputSchema,
  splitIncomeInputSchema,
  splitIncomeSchema,
  splitTransferInputSchema,
  splitTransferSchema,
} from '../transaction';

describe('Transaction Schemas & Invariants', () => {
  const bucketA = '507f1f77bcf86cd799439011';
  const bucketB = '507f1f77bcf86cd799439012';
  const bucketC = '507f1f77bcf86cd799439013';
  const validDate = '2026-10-06T14:30:00.000Z';

  describe('Single Transaction Shapes', () => {
    it('validates a correct income transaction', () => {
      const res = incomeInputSchema.safeParse({
        type: 'income',
        toBucketId: bucketA,
        amount: 5000000, // ₹50,000.00
        category: 'Salary',
        purpose: 'October Salary',
        date: validDate,
      });
      expect(res.success).toBe(true);
    });

    it('validates a correct expense transaction requiring purpose', () => {
      const res = expenseInputSchema.safeParse({
        type: 'expense',
        fromBucketId: bucketA,
        amount: 250000, // ₹2,500.00
        category: 'Groceries',
        purpose: 'Supermarket weekly shopping',
        date: validDate,
      });
      expect(res.success).toBe(true);
    });

    it('rejects an expense transaction missing purpose', () => {
      const res = expenseInputSchema.safeParse({
        type: 'expense',
        fromBucketId: bucketA,
        amount: 250000,
        category: 'Groceries',
        purpose: '',
        date: validDate,
      });
      expect(res.success).toBe(false);
    });

    it('validates a transfer between two distinct buckets', () => {
      const res = transferInputSchema.safeParse({
        type: 'transfer',
        fromBucketId: bucketA,
        toBucketId: bucketB,
        amount: 1000000,
        purpose: 'Move to cash reserve',
        date: validDate,
      });
      expect(res.success).toBe(true);
    });

    it('CRITICAL RULE: rejects transfer where fromBucketId === toBucketId', () => {
      const res = transferInputSchema.safeParse({
        type: 'transfer',
        fromBucketId: bucketA,
        toBucketId: bucketA, // Same bucket!
        amount: 1000000,
        date: validDate,
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(
          /Source and destination buckets must be different/i
        );
      }
    });

    it('validates adjustment with required reason and signed amount', () => {
      const resPositive = adjustmentInputSchema.safeParse({
        type: 'adjustment',
        bucketId: bucketA,
        amount: 15000, // +₹150.00
        reason: 'Bank interest credited but unrecorded',
        date: validDate,
      });
      expect(resPositive.success).toBe(true);

      const resNegative = adjustmentInputSchema.safeParse({
        type: 'adjustment',
        bucketId: bucketA,
        amount: -5000, // -₹50.00
        reason: 'ATM withdrawal fee correction',
        date: validDate,
      });
      expect(resNegative.success).toBe(true);
    });

    it('CRITICAL RULE: rejects adjustment without a reason', () => {
      const res = adjustmentInputSchema.safeParse({
        type: 'adjustment',
        bucketId: bucketA,
        amount: 15000,
        reason: '  ',
        date: validDate,
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(
          /Adjustment reason must be at least 3 characters/i
        );
      }
    });
  });

  describe('transactionInputSchema (Discriminated Union)', () => {
    it('correctly discriminates and validates through union', () => {
      const incomeRes = transactionInputSchema.safeParse({
        type: 'income',
        toBucketId: bucketA,
        amount: 10000,
        category: 'Gift',
        date: validDate,
      });
      expect(incomeRes.success).toBe(true);
    });

    it('rejects transfer with same bucket via discriminated union', () => {
      const sameBucketTransfer = transactionInputSchema.safeParse({
        type: 'transfer',
        fromBucketId: bucketA,
        toBucketId: bucketA,
        amount: 50000,
        date: validDate,
      });
      expect(sameBucketTransfer.success).toBe(false);
    });
  });

  describe('Split Transactions (Phase 5)', () => {
    describe('splitIncomeSchema / splitIncomeInputSchema', () => {
      it('accepts split income with 1 or more allocations when sum equals totalAmount', () => {
        const resSingle = splitIncomeSchema.safeParse({
          totalAmount: 50000,
          source: 'Consulting',
          purpose: 'Project invoice',
          allocations: [{ bucketId: bucketA, amount: 50000, note: 'Primary deposit' }],
          date: validDate,
        });
        expect(resSingle.success).toBe(true);

        const resMulti = splitIncomeSchema.safeParse({
          totalAmount: 100000, // ₹1,000.00
          source: 'Salary',
          purpose: 'Monthly salary distribution',
          allocations: [
            { bucketId: bucketA, amount: 60000, note: 'Living expenses' },
            { bucketId: bucketB, amount: 40000, note: 'Savings reserve' },
          ],
          date: validDate,
        });
        expect(resMulti.success).toBe(true);
      });

      it('CRITICAL RULE: rejects split income when allocations sum != totalAmount with explicit difference', () => {
        const res = splitIncomeSchema.safeParse({
          totalAmount: 100000,
          source: 'Salary',
          allocations: [
            { bucketId: bucketA, amount: 60000 },
            { bucketId: bucketB, amount: 30000 }, // sum 90000, diff 10000
          ],
          date: validDate,
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.issues[0]?.message).toContain('Difference: 10000 paise');
        }
      });

      it('CRITICAL RULE: rejects split income with duplicate bucketId in allocations', () => {
        const res = splitIncomeSchema.safeParse({
          totalAmount: 100000,
          source: 'Bonus',
          allocations: [
            { bucketId: bucketA, amount: 50000 },
            { bucketId: bucketA, amount: 50000 }, // Duplicate bucketA!
          ],
          date: validDate,
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.issues[0]?.message).toMatch(/Duplicate bucketId found in split allocations/i);
        }
      });

      it('rejects split income with 0 allocations or more than 15 allocations', () => {
        const resZero = splitIncomeSchema.safeParse({
          totalAmount: 100000,
          source: 'Salary',
          allocations: [],
          date: validDate,
        });
        expect(resZero.success).toBe(false);

        // 16 allocations
        const allocations16 = Array.from({ length: 16 }, (_, i) => ({
          bucketId: `507f1f77bcf86cd79943901${i.toString(16)}`,
          amount: 1000,
        }));
        const resOver15 = splitIncomeSchema.safeParse({
          totalAmount: 16000,
          source: 'Salary',
          allocations: allocations16,
          date: validDate,
        });
        expect(resOver15.success).toBe(false);
      });
    });

    describe('splitTransferSchema / splitTransferInputSchema', () => {
      it('accepts valid split transfer', () => {
        const res = splitTransferSchema.safeParse({
          fromBucketId: bucketA,
          totalAmount: 150000, // ₹1,500.00
          purpose: 'Weekly bucket refill',
          destinations: [
            { bucketId: bucketB, amount: 100000, note: 'Groceries' },
            { bucketId: bucketC, amount: 50000, note: 'Fuel' },
          ],
          date: validDate,
        });
        expect(res.success).toBe(true);
      });

      it('rejects split transfer when sum does not match totalAmount with explicit difference', () => {
        const res = splitTransferSchema.safeParse({
          fromBucketId: bucketA,
          totalAmount: 150000,
          destinations: [
            { bucketId: bucketB, amount: 100000 },
            { bucketId: bucketC, amount: 40000 }, // sum 140000, diff 10000
          ],
          date: validDate,
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.issues[0]?.message).toContain('Difference: 10000 paise');
        }
      });

      it('CRITICAL RULE: rejects split transfer if destination equals source bucket', () => {
        const res = splitTransferSchema.safeParse({
          fromBucketId: bucketA,
          totalAmount: 150000,
          destinations: [
            { bucketId: bucketB, amount: 100000 },
            { bucketId: bucketA, amount: 50000 }, // Destination is bucketA (same as fromBucketId)!
          ],
          date: validDate,
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.issues[0]?.message).toMatch(
            /Destination bucket cannot be the same as the source bucket/i
          );
        }
      });

      it('CRITICAL RULE: rejects split transfer with duplicate destination bucketId', () => {
        const res = splitTransferSchema.safeParse({
          fromBucketId: bucketA,
          totalAmount: 100000,
          destinations: [
            { bucketId: bucketB, amount: 50000 },
            { bucketId: bucketB, amount: 50000 }, // Duplicate destination bucketB!
          ],
          date: validDate,
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.issues[0]?.message).toMatch(
            /Duplicate bucketId found in destinations/i
          );
        }
      });
    });
  });
});
