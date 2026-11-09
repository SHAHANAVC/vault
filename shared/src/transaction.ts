import { z } from 'zod';
import {
  objectIdSchema,
  isoDateSchema,
  paiseAmountSchema,
  signedPaiseSchema,
} from './common';
import { PlanAlert, BucketShortfallSummary } from './plan';
import { PublicBucket } from './bucket';
import { LoanAlert } from './loan';

/**
 * Transaction Types:
 * - income: Inflow into a specific bucket
 * - expense: Outflow from a specific bucket
 * - transfer: Movement between two distinct buckets
 * - adjustment: Corrective reconciliation for an unrecorded delta (reason required)
 */
export const transactionTypeEnum = z.enum([
  'income',
  'expense',
  'transfer',
  'adjustment',
]);
export type TransactionType = z.infer<typeof transactionTypeEnum>;

/**
 * Status of transaction:
 * - active: Normal valid entry
 * - voided: Cancelled via append-only reversal entry (Immutable Ledger Rule #3)
 */
export const transactionStatusEnum = z.enum(['active', 'voided']);
export type TransactionStatus = z.infer<typeof transactionStatusEnum>;

/* ==========================================================================
   Single Transaction Input Schemas (Discriminated Union)
   ========================================================================== */

export const incomeInputSchema = z.object({
  type: z.literal('income'),
  toBucketId: objectIdSchema,
  amount: paiseAmountSchema,
  category: z.string().trim().min(1, 'Category/source is required').max(50),
  purpose: z.string().trim().max(200).optional(),
  date: isoDateSchema,
  idempotencyKey: z.string().trim().max(100).optional(),
});

export type IncomeInput = z.infer<typeof incomeInputSchema>;

export const expenseInputSchema = z.object({
  type: z.literal('expense'),
  fromBucketId: objectIdSchema,
  amount: paiseAmountSchema,
  category: z.string().trim().min(1, 'Category is required').max(50),
  purpose: z.string().trim().min(1, 'Purpose is required').max(200),
  date: isoDateSchema,
  idempotencyKey: z.string().trim().max(100).optional(),
});

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

/**
 * Base transfer schema as a pure ZodObject.
 * Zod's discriminatedUnion requires members to be direct ZodObjects (not wrapped in ZodEffects).
 */
export const transferBaseSchema = z.object({
  type: z.literal('transfer'),
  fromBucketId: objectIdSchema,
  toBucketId: objectIdSchema,
  amount: paiseAmountSchema,
  purpose: z.string().trim().max(200).optional(),
  date: isoDateSchema,
  idempotencyKey: z.string().trim().max(100).optional(),
});

/**
 * Standalone transfer input schema with refinement ensuring distinct buckets.
 */
export const transferInputSchema = transferBaseSchema.refine(
  (data) => data.fromBucketId !== data.toBucketId,
  {
    message: 'Source and destination buckets must be different for a transfer',
    path: ['toBucketId'],
  }
);

export type TransferInput = z.infer<typeof transferInputSchema>;

export const adjustmentSchema = z.object({
  type: z.literal('adjustment').optional().default('adjustment'),
  bucketId: objectIdSchema,
  amount: signedPaiseSchema,
  reason: z
    .string({ required_error: 'Adjustment reason is required' })
    .trim()
    .min(3, 'Adjustment reason must be at least 3 characters')
    .max(200, 'Adjustment reason cannot exceed 200 characters'),
  date: isoDateSchema,
  idempotencyKey: z.string().trim().max(100).optional(),
});

export const adjustmentInputSchema = adjustmentSchema;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

/**
 * Discriminated Union of all single transaction input shapes.
 * TypeScript automatically narrows the type when checking `data.type`.
 */
export const transactionInputSchema = z
  .discriminatedUnion('type', [
    incomeInputSchema,
    expenseInputSchema,
    transferBaseSchema,
    adjustmentSchema,
  ])
  .superRefine((data, ctx) => {
    if (data.type === 'transfer' && data.fromBucketId === data.toBucketId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Source and destination buckets must be different for a transfer',
        path: ['toBucketId'],
      });
    }
  });

export type TransactionInput = z.infer<typeof transactionInputSchema>;

/* ==========================================================================
   Split Transaction Input Schemas
   ========================================================================== */

export const splitIncomeAllocationSchema = z.object({
  bucketId: objectIdSchema,
  amount: paiseAmountSchema,
  note: z.string().trim().max(200).optional(),
});

export type SplitIncomeAllocation = z.infer<typeof splitIncomeAllocationSchema>;

export const splitIncomeSchema = z
  .object({
    totalAmount: paiseAmountSchema,
    receivingBucketId: objectIdSchema.optional(),
    source: z
      .string({ required_error: 'Source is required' })
      .trim()
      .min(1, 'Source is required')
      .max(50, 'Source cannot exceed 50 characters'),
    purpose: z.string().trim().max(200).optional(),
    date: isoDateSchema,
    allocations: z
      .array(splitIncomeAllocationSchema)
      .min(1, 'At least 1 allocation is required')
      .max(15, 'Maximum 15 allocations allowed'),
    idempotencyKey: z.string().trim().max(100).optional(),
  })
  .superRefine((data, ctx) => {
    const sum = data.allocations.reduce((acc, curr) => acc + curr.amount, 0);
    if (sum !== data.totalAmount) {
      const diff = Math.abs(data.totalAmount - sum);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Sum of allocations (${sum} paise) must equal total amount (${data.totalAmount} paise). Difference: ${diff} paise`,
        path: ['allocations'],
      });
    }

    const seenBucketIds = new Set<string>();
    data.allocations.forEach((alloc, index) => {
      if (seenBucketIds.has(alloc.bucketId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate bucketId found in split allocations. Each bucket must appear at most once.',
          path: ['allocations', index, 'bucketId'],
        });
      }
      seenBucketIds.add(alloc.bucketId);
    });
  });

export const splitIncomeInputSchema = splitIncomeSchema;
export type SplitIncomeInput = z.infer<typeof splitIncomeSchema>;

export const splitTransferDestinationSchema = z.object({
  bucketId: objectIdSchema,
  amount: paiseAmountSchema,
  note: z.string().trim().max(200).optional(),
});

export type SplitTransferDestination = z.infer<typeof splitTransferDestinationSchema>;

export const splitTransferSchema = z
  .object({
    fromBucketId: objectIdSchema,
    totalAmount: paiseAmountSchema,
    purpose: z.string().trim().max(200).optional(),
    date: isoDateSchema,
    destinations: z
      .array(splitTransferDestinationSchema)
      .min(1, 'At least 1 destination is required')
      .max(15, 'Maximum 15 destinations allowed'),
    idempotencyKey: z.string().trim().max(100).optional(),
  })
  .superRefine((data, ctx) => {
    // 1. Check sum matches totalAmount
    const sum = data.destinations.reduce((acc, curr) => acc + curr.amount, 0);
    if (sum !== data.totalAmount) {
      const diff = Math.abs(data.totalAmount - sum);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Sum of destinations (${sum} paise) must equal total amount (${data.totalAmount} paise). Difference: ${diff} paise`,
        path: ['destinations'],
      });
    }

    // 2. Ensure no duplicates in destinations and destination is not source
    const seenBucketIds = new Set<string>();
    data.destinations.forEach((dest, index) => {
      if (seenBucketIds.has(dest.bucketId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate bucketId found in destinations. Each destination bucket must be unique.',
          path: ['destinations', index, 'bucketId'],
        });
      }
      seenBucketIds.add(dest.bucketId);

      if (dest.bucketId === data.fromBucketId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Destination bucket cannot be the same as the source bucket',
          path: ['destinations', index, 'bucketId'],
        });
      }
    });
  });

export const splitTransferInputSchema = splitTransferSchema;
export type SplitTransferInput = z.infer<typeof splitTransferSchema>;

/* ==========================================================================
   Stored Transaction Record Schema
   ========================================================================== */

export const transactionSchema = z.object({
  id: objectIdSchema,
  householdId: objectIdSchema,
  createdBy: objectIdSchema,
  type: transactionTypeEnum,
  amount: paiseAmountSchema,
  fromBucketId: objectIdSchema.optional(),
  toBucketId: objectIdSchema.optional(),
  category: z.string().max(50).optional(),
  purpose: z.string().max(200).optional(),
  reason: z.string().max(200).optional(),
  date: isoDateSchema,
  groupId: z.string().optional(),
  status: transactionStatusEnum,
  reversalOf: objectIdSchema.optional(),
  voidedBy: objectIdSchema.optional(),
  voidedAt: isoDateSchema.optional(),
  planId: objectIdSchema.optional(),
  installmentNumber: z.number().int().positive().optional(),
  partyId: objectIdSchema.optional(),
  loanAction: z.enum(['lend', 'receive_repayment', 'borrow', 'repay']).optional(),
  dueDate: isoDateSchema.optional(),
  idempotencyKey: z.string().optional(),
  createdAt: isoDateSchema,
});

export type Transaction = z.infer<typeof transactionSchema>;

/* ==========================================================================
   Public/Sanitized Transaction (For Client and Privacy Mapper)
   ========================================================================== */

export const publicTransactionSchema = z.object({
  id: objectIdSchema,
  householdId: objectIdSchema,
  createdBy: objectIdSchema,
  creatorName: z.string().optional(),
  type: transactionTypeEnum,
  amount: paiseAmountSchema,
  fromBucketId: objectIdSchema.optional(),
  fromBucketName: z.string().optional(),
  toBucketId: objectIdSchema.optional(),
  toBucketName: z.string().optional(),
  category: z.string().max(50).optional(),
  purpose: z.string().max(200).optional(),
  reason: z.string().max(200).optional(),
  date: isoDateSchema,
  groupId: z.string().optional(),
  linesCount: z.number().int().nonnegative().optional(),
  isGroupParent: z.boolean().optional(),
  groupSummary: z.string().optional(),
  status: transactionStatusEnum,
  reversalOf: objectIdSchema.optional(),
  voidedBy: objectIdSchema.optional(),
  voidedAt: isoDateSchema.optional(),
  planId: objectIdSchema.optional(),
  installmentNumber: z.number().int().positive().optional(),
  partyId: objectIdSchema.optional(),
  partyName: z.string().optional(),
  loanAction: z.enum(['lend', 'receive_repayment', 'borrow', 'repay']).optional(),
  dueDate: isoDateSchema.optional(),
  isMasked: z.boolean().optional(),
  createdAt: isoDateSchema,
});

export type PublicTransaction = z.infer<typeof publicTransactionSchema>;

/* ==========================================================================
   Public Group Transaction Schema (For GET /transactions/groups/:groupId)
   ========================================================================== */

export const publicTransactionGroupSchema = z.object({
  groupId: z.string(),
  type: transactionTypeEnum,
  totalAmount: paiseAmountSchema,
  linesCount: z.number().int().nonnegative(),
  visibleLinesCount: z.number().int().nonnegative(),
  date: isoDateSchema,
  source: z.string().optional(),
  purpose: z.string().optional(),
  status: transactionStatusEnum,
  createdBy: objectIdSchema,
  creatorName: z.string().optional(),
  fromBucketId: objectIdSchema.optional(),
  fromBucketName: z.string().optional(),
  lines: z.array(publicTransactionSchema),
  createdAt: isoDateSchema,
});

export type PublicTransactionGroup = z.infer<typeof publicTransactionGroupSchema>;

/* ==========================================================================
   Standard Categories List
   ========================================================================== */

export const STANDARD_INCOME_CATEGORIES = [
  'Salary',
  'Business',
  'Freelance',
  'Investments',
  'Gift',
  'Rental',
  'Other Income',
] as const;

export const STANDARD_EXPENSE_CATEGORIES = [
  'Groceries',
  'Rent',
  'Utilities',
  'Food & Dining',
  'Transportation',
  'Healthcare',
  'Entertainment',
  'Shopping',
  'Education',
  'Personal Care',
  'Travel',
  'Debt Repayment',
  'Miscellaneous',
] as const;

export const TRANSACTION_CATEGORIES = [
  ...STANDARD_INCOME_CATEGORIES,
  ...STANDARD_EXPENSE_CATEGORIES,
] as const;

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

/* ==========================================================================
   Transaction Query & Filter Schema
   ========================================================================== */

export const transactionQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50, 'Limit cannot exceed 50').default(20),
    cursor: z.string().optional(),
    bucketId: z.string().optional(),
    type: transactionTypeEnum.optional(),
    category: z.string().optional(),
    createdBy: z.string().optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    minAmount: z.coerce.number().int().nonnegative('minAmount must be non-negative').optional(),
    maxAmount: z.coerce.number().int().positive('maxAmount must be positive').optional(),
    search: z.string().optional(),
    includeVoided: z
      .preprocess((val) => {
        if (typeof val === 'string') return val === 'true';
        return Boolean(val);
      }, z.boolean())
      .default(false),
    sort: z
      .enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc'])
      .default('date_desc'),
  })
  .refine(
    (data) => {
      if (data.fromDate && data.toDate) {
        return new Date(data.fromDate).getTime() <= new Date(data.toDate).getTime();
      }
      return true;
    },
    {
      message: 'fromDate must be before or equal to toDate',
      path: ['fromDate'],
    }
  )
  .refine(
    (data) => {
      if (data.minAmount !== undefined && data.maxAmount !== undefined) {
        return data.minAmount <= data.maxAmount;
      }
      return true;
    },
    {
      message: 'minAmount must be less than or equal to maxAmount',
      path: ['minAmount'],
    }
  );

export type TransactionQueryInput = z.input<typeof transactionQuerySchema>;
export type TransactionQueryOutput = z.output<typeof transactionQuerySchema>;

/* ==========================================================================
   Report & Dashboard Summary Types
   ========================================================================== */

export interface MonthSummaryResponse {
  totalIncome: number; // paise
  totalExpense: number; // paise
  netSavings: number; // paise
}

export interface CategoryBreakdownItem {
  category: string;
  amount: number; // paise
  percentage: number;
}

export interface CategoryBreakdownResponse {
  items: CategoryBreakdownItem[];
  totalExpense: number; // paise
}

export interface TrendMonthItem {
  month: string; // YYYY-MM
  income: number; // paise
  expense: number; // paise
  netSavings: number; // paise
}

export interface TrendResponse {
  items: TrendMonthItem[];
}

export interface DashboardResponse {
  householdTotal: number; // paise
  myTotal: number; // paise
  buckets: PublicBucket[];
  monthSummary: MonthSummaryResponse;
  recentTransactions: PublicTransaction[];
  alerts: string[];
  planAlerts?: PlanAlert[];
  shortfalls?: BucketShortfallSummary[];
  totalReceivable?: number; // paise
  totalPayable?: number; // paise
  netWorth?: number; // paise
  loanAlerts?: LoanAlert[];
}

export interface PaginatedTransactionsResponse {
  transactions: PublicTransaction[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

export const updateTransactionSchema = z.object({
  amount: paiseAmountSchema.optional(),
  category: z.string().trim().min(1).max(50).optional(),
  purpose: z.string().trim().max(200).optional(),
  date: isoDateSchema.optional(),
  fromBucketId: objectIdSchema.optional(),
  toBucketId: objectIdSchema.optional(),
});

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;


