import { z } from 'zod';
import { objectIdSchema, isoDateSchema, paiseAmountSchema } from './common';
import { BucketType } from './bucket';

/**
 * Discriminator enum for loan transactions
 */
export const loanActionEnum = z.enum([
  'lend',
  'receive_repayment',
  'borrow',
  'repay',
]);

export type LoanAction = z.infer<typeof loanActionEnum>;

export const LOAN_ACTION_LABELS: Record<LoanAction, string> = {
  lend: 'Lend Money',
  receive_repayment: 'Receive Repayment',
  borrow: 'Borrow Money',
  repay: 'Repay Loan',
};

/* ==========================================================================
   Action Schemas (Discriminated by `action`)
   ========================================================================== */

export const lendLoanSchema = z.object({
  action: z.literal('lend'),
  partyId: objectIdSchema,
  amount: paiseAmountSchema,
  fromBucketId: objectIdSchema,
  date: isoDateSchema,
  purpose: z.string().trim().max(300, 'Purpose cannot exceed 300 characters').optional().or(z.literal('')),
  dueDate: isoDateSchema.optional(),
  idempotencyKey: z.string().trim().max(100).optional(),
});

export type LendLoanInput = z.infer<typeof lendLoanSchema>;

export const receiveRepaymentLoanSchema = z.object({
  action: z.literal('receive_repayment'),
  partyId: objectIdSchema,
  amount: paiseAmountSchema,
  toBucketId: objectIdSchema,
  date: isoDateSchema,
  purpose: z.string().trim().max(300, 'Purpose cannot exceed 300 characters').optional().or(z.literal('')),
  idempotencyKey: z.string().trim().max(100).optional(),
});

export type ReceiveRepaymentLoanInput = z.infer<typeof receiveRepaymentLoanSchema>;

export const borrowLoanSchema = z.object({
  action: z.literal('borrow'),
  partyId: objectIdSchema,
  amount: paiseAmountSchema,
  toBucketId: objectIdSchema,
  date: isoDateSchema,
  purpose: z.string().trim().max(300, 'Purpose cannot exceed 300 characters').optional().or(z.literal('')),
  dueDate: isoDateSchema.optional(),
  idempotencyKey: z.string().trim().max(100).optional(),
});

export type BorrowLoanInput = z.infer<typeof borrowLoanSchema>;

export const repayLoanSchema = z.object({
  action: z.literal('repay'),
  partyId: objectIdSchema,
  amount: paiseAmountSchema,
  fromBucketId: objectIdSchema,
  date: isoDateSchema,
  purpose: z.string().trim().max(300, 'Purpose cannot exceed 300 characters').optional().or(z.literal('')),
  idempotencyKey: z.string().trim().max(100).optional(),
});

export type RepayLoanInput = z.infer<typeof repayLoanSchema>;

export const loanEntrySchema = z.discriminatedUnion('action', [
  lendLoanSchema,
  receiveRepaymentLoanSchema,
  borrowLoanSchema,
  repayLoanSchema,
]);

export type LoanEntryInput = z.infer<typeof loanEntrySchema>;

/* ==========================================================================
   Summary & DTO Types
   ========================================================================== */

export interface LoansSummaryResponse {
  totalReceivable: number; // paise
  totalPayable: number; // paise
  netBalance: number; // paise (totalReceivable - totalPayable)
  activeReceivablesCount: number;
  activePayablesCount: number;
}

export type LoanAlertStatus = 'due_soon' | 'due' | 'overdue' | 'reminder';

export interface LoanAlert {
  partyId: string;
  partyName: string;
  action: 'lend' | 'borrow'; // 'borrow' = I must repay; 'lend' = Owed to me
  amountDue: number; // paise
  dueDate: string; // ISO date
  status: LoanAlertStatus;
  payingBucketId?: string;
  payingBucketName?: string;
  isShortfall?: boolean;
  shortfallAmount?: number;
  isDismissedToday: boolean;
}

/* ==========================================================================
   Pure Invariant Calculation Functions
   ========================================================================== */

export interface RawLoanEntry {
  loanAction?: LoanAction | null;
  amount: number;
  status?: string;
}

/**
 * Computes per-party balances derived from transaction ledger entries.
 * Ignores voided transactions.
 */
export function calculatePartyBalance(entries: RawLoanEntry[]): {
  loanGivenOutstanding: number;
  loanTakenOutstanding: number;
  netBalance: number;
  totalLent: number;
  totalRepaidToMe: number;
  totalBorrowed: number;
  totalRepaidByMe: number;
} {
  let totalLent = 0;
  let totalRepaidToMe = 0;
  let totalBorrowed = 0;
  let totalRepaidByMe = 0;

  for (const entry of entries) {
    if (entry.status === 'voided') continue;

    if (entry.loanAction === 'lend') {
      totalLent += entry.amount;
    } else if (entry.loanAction === 'receive_repayment') {
      totalRepaidToMe += entry.amount;
    } else if (entry.loanAction === 'borrow') {
      totalBorrowed += entry.amount;
    } else if (entry.loanAction === 'repay') {
      totalRepaidByMe += entry.amount;
    }
  }

  const loanGivenOutstanding = Math.max(0, totalLent - totalRepaidToMe);
  const loanTakenOutstanding = Math.max(0, totalBorrowed - totalRepaidByMe);
  const netBalance = loanGivenOutstanding - loanTakenOutstanding;

  return {
    loanGivenOutstanding,
    loanTakenOutstanding,
    netBalance,
    totalLent,
    totalRepaidToMe,
    totalBorrowed,
    totalRepaidByMe,
  };
}

/**
 * Computes remaining outstanding balance after a repayment.
 */
export function calculateRemainingAfterRepayment(
  outstanding: number,
  repaymentAmount: number
): number {
  return Math.max(0, outstanding - repaymentAmount);
}

/**
 * Checks if a proposed repayment amount exceeds the outstanding loan balance.
 */
export function isOverpayment(
  outstanding: number,
  repaymentAmount: number
): boolean {
  return repaymentAmount > outstanding;
}

/**
 * Pure Net Worth calculation invariant:
 * Net worth = cash + bank + kuri + gold_scheme + loan_given - loan_taken
 * 
 * Assets (cash, bank, kuri, gold_scheme, loan_given) add to net worth.
 * Liabilities (loan_taken) are stored as positive owed balances and deducted.
 */
export function calculateNetWorth(
  buckets: Array<{ type: BucketType; balance: number }>
): number {
  let total = 0;
  for (const b of buckets) {
    if (b.type === 'loan_taken') {
      total -= b.balance;
    } else {
      total += b.balance;
    }
  }
  return total;
}
