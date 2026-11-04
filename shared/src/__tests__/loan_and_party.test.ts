import {
  createPartySchema,
  updatePartySchema,
  lendLoanSchema,
  receiveRepaymentLoanSchema,
  borrowLoanSchema,
  repayLoanSchema,
  loanEntrySchema,
  calculatePartyBalance,
  calculateRemainingAfterRepayment,
  isOverpayment,
  calculateNetWorth,
  LOAN_ACTION_LABELS,
} from '../index';

describe('Phase 8: Loans & Parties Shared Contracts & Invariants', () => {
  describe('Party Schemas', () => {
    it('validates valid party creation input', () => {
      const valid = {
        name: 'Ramu',
        phone: '9876543210',
        note: 'Friend from college',
        visibility: 'shared' as const,
      };
      const result = createPartySchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Ramu');
        expect(result.data.phone).toBe('9876543210');
      }
    });

    it('accepts international phone format and empty phone', () => {
      expect(createPartySchema.safeParse({ name: 'Suresh', phone: '+919876543210' }).success).toBe(true);
      expect(createPartySchema.safeParse({ name: 'Suresh', phone: '' }).success).toBe(true);
      expect(createPartySchema.safeParse({ name: 'Suresh' }).success).toBe(true);
    });

    it('rejects empty or whitespace-only name and invalid phone', () => {
      expect(createPartySchema.safeParse({ name: '   ' }).success).toBe(false);
      expect(createPartySchema.safeParse({ name: 'Valid', phone: '123' }).success).toBe(false);
      expect(createPartySchema.safeParse({ name: 'Valid', phone: 'not-a-number' }).success).toBe(false);
    });

    it('validates partial updates in updatePartySchema', () => {
      expect(updatePartySchema.safeParse({ note: 'Updated note' }).success).toBe(true);
      expect(updatePartySchema.safeParse({ visibility: 'private' }).success).toBe(true);
    });
  });

  describe('Loan Entry Schemas (Discriminated Union)', () => {
    const validObjectId = '507f1f77bcf86cd799439011';
    const validBucketId = '507f1f77bcf86cd799439022';
    const validDate = '2026-10-21T00:00:00.000Z';

    it('validates lend loan action', () => {
      const res = lendLoanSchema.safeParse({
        action: 'lend',
        partyId: validObjectId,
        amount: 1000000,
        fromBucketId: validBucketId,
        date: validDate,
        purpose: 'Car repair loan',
        dueDate: '2026-11-21T00:00:00.000Z',
      });
      expect(res.success).toBe(true);
    });

    it('validates receive_repayment loan action', () => {
      const res = receiveRepaymentLoanSchema.safeParse({
        action: 'receive_repayment',
        partyId: validObjectId,
        amount: 400000,
        toBucketId: validBucketId,
        date: validDate,
      });
      expect(res.success).toBe(true);
    });

    it('validates borrow loan action', () => {
      const res = borrowLoanSchema.safeParse({
        action: 'borrow',
        partyId: validObjectId,
        amount: 2000000,
        toBucketId: validBucketId,
        date: validDate,
        dueDate: '2026-12-01T00:00:00.000Z',
      });
      expect(res.success).toBe(true);
    });

    it('validates repay loan action', () => {
      const res = repayLoanSchema.safeParse({
        action: 'repay',
        partyId: validObjectId,
        amount: 500000,
        fromBucketId: validBucketId,
        date: validDate,
      });
      expect(res.success).toBe(true);
    });

    it('validates discriminated union loanEntrySchema', () => {
      const lendRes = loanEntrySchema.safeParse({
        action: 'lend',
        partyId: validObjectId,
        amount: 1000000,
        fromBucketId: validBucketId,
        date: validDate,
      });
      expect(lendRes.success).toBe(true);

      const invalidAction = loanEntrySchema.safeParse({
        action: 'invalid_action',
        partyId: validObjectId,
        amount: 1000000,
      });
      expect(invalidAction.success).toBe(false);
    });

    it('rejects zero or negative amounts (integer paise positive invariant)', () => {
      expect(
        lendLoanSchema.safeParse({
          action: 'lend',
          partyId: validObjectId,
          amount: 0,
          fromBucketId: validBucketId,
          date: validDate,
        }).success
      ).toBe(false);

      expect(
        lendLoanSchema.safeParse({
          action: 'lend',
          partyId: validObjectId,
          amount: -500,
          fromBucketId: validBucketId,
          date: validDate,
        }).success
      ).toBe(false);
    });

    it('verifies human-readable labels in LOAN_ACTION_LABELS', () => {
      expect(LOAN_ACTION_LABELS.lend).toBe('Lend Money');
      expect(LOAN_ACTION_LABELS.receive_repayment).toBe('Receive Repayment');
      expect(LOAN_ACTION_LABELS.borrow).toBe('Borrow Money');
      expect(LOAN_ACTION_LABELS.repay).toBe('Repay Loan');
    });
  });

  describe('Pure Invariant Functions', () => {
    it('calculatePartyBalance derives accurate balances and ignores voided entries', () => {
      const entries = [
        { loanAction: 'lend' as const, amount: 1000000 }, // Lent 10,000
        { loanAction: 'receive_repayment' as const, amount: 400000 }, // Received 4,000
        { loanAction: 'receive_repayment' as const, amount: 200000, status: 'voided' }, // Voided 2,000 ignored
        { loanAction: 'borrow' as const, amount: 500000 }, // Borrowed 5,000
        { loanAction: 'repay' as const, amount: 200000 }, // Repaid 2,000
      ];

      const balance = calculatePartyBalance(entries);
      expect(balance.totalLent).toBe(1000000);
      expect(balance.totalRepaidToMe).toBe(400000);
      expect(balance.loanGivenOutstanding).toBe(600000); // 10,000 - 4,000 = 6,000
      expect(balance.totalBorrowed).toBe(500000);
      expect(balance.totalRepaidByMe).toBe(200000);
      expect(balance.loanTakenOutstanding).toBe(300000); // 5,000 - 2,000 = 3,000
      expect(balance.netBalance).toBe(300000); // 6,000 - 3,000 = +3,000 (net receivable)
    });

    it('calculateRemainingAfterRepayment computes remaining balance correctly', () => {
      expect(calculateRemainingAfterRepayment(1000000, 400000)).toBe(600000);
      expect(calculateRemainingAfterRepayment(1000000, 1000000)).toBe(0);
      expect(calculateRemainingAfterRepayment(500000, 600000)).toBe(0);
    });

    it('isOverpayment detects excess repayments accurately', () => {
      expect(isOverpayment(1000000, 999999)).toBe(false);
      expect(isOverpayment(1000000, 1000000)).toBe(false);
      expect(isOverpayment(1000000, 1000001)).toBe(true);
    });

    it('calculateNetWorth applies cash + bank + kuri + gold_scheme + loan_given - loan_taken', () => {
      const buckets = [
        { type: 'cash' as const, balance: 1000000 }, // 10,000
        { type: 'bank' as const, balance: 5000000 }, // 50,000
        { type: 'kuri' as const, balance: 2000000 }, // 20,000
        { type: 'gold_scheme' as const, balance: 3000000 }, // 30,000
        { type: 'loan_given' as const, balance: 4000000 }, // 40,000 (Asset)
        { type: 'loan_taken' as const, balance: 2500000 }, // 25,000 (Liability)
      ];

      // Net worth = 10,000 + 50,000 + 20,000 + 30,000 + 40,000 - 25,000 = 125,000 INR = 12,500,000 paise
      expect(calculateNetWorth(buckets)).toBe(12500000);
    });
  });
});
