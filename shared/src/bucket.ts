import { z } from 'zod';
import { objectIdSchema, isoDateSchema } from './common';
import { visibilityEnum } from './visibility';

/**
 * Bucket Types:
 * - cash: Physical cash in wallet/home
 * - bank: Savings/Current accounts (SBI, Federal, etc.)
 * - kuri: Chit fund / informal community savings
 * - gold_scheme: Jewellery gold savings scheme asset
 * - loan_given: Money lent to someone (asset / receivable)
 * - loan_taken: Debt owed to someone (liability / payable)
 */
export const bucketTypeEnum = z.enum([
  'cash',
  'bank',
  'kuri',
  'gold_scheme',
  'loan_given',
  'loan_taken',
]);

export type BucketType = z.infer<typeof bucketTypeEnum>;

/**
 * Display labels for bucket types.
 * Single source of truth across client and server.
 */
export const BUCKET_TYPE_LABELS: Record<BucketType, string> = {
  cash: 'Cash',
  bank: 'Bank',
  kuri: 'Kuri',
  gold_scheme: 'Gold Scheme',
  loan_given: 'Loan Given',
  loan_taken: 'Loan Taken',
};

/**
 * Input schema for creating a bucket.
 * CRITICAL FINANCIAL INVARIANT:
 * `balance` is NOT accepted here! Buckets are initialized at 0 paise.
 * Balance can only be added or changed via a recorded transaction.
 */
export const createBucketSchema = z.object({
  name: z
    .string({ required_error: 'Bucket name is required' })
    .trim()
    .min(1, 'Bucket name cannot be empty')
    .max(50, 'Bucket name cannot exceed 50 characters'),
  type: bucketTypeEnum,
  visibility: visibilityEnum,
  description: z.string().trim().max(200, 'Description too long').optional(),
  /**
   * Optional opening balance in paise entered in UI.
   * Stored bucket balance will be 0 until Phase 4B ledger records an opening transaction.
   */
  openingBalance: z.number().int().nonnegative('Opening balance cannot be negative').optional(),
});

export type CreateBucketInput = z.infer<typeof createBucketSchema>;

/**
 * Input schema for updating bucket metadata.
 * Balance is NEVER editable directly (Immutable Ledger Rule).
 */
export const updateBucketSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Bucket name cannot be empty')
    .max(50, 'Bucket name cannot exceed 50 characters')
    .optional(),
  type: bucketTypeEnum.optional(),
  description: z.string().trim().max(200).optional(),
});

export type UpdateBucketInput = z.infer<typeof updateBucketSchema>;

/**
 * Schema for updating bucket visibility.
 * Owner-only privilege.
 */
export const updateVisibilitySchema = z.object({
  visibility: visibilityEnum,
});

export type UpdateVisibilityInput = z.infer<typeof updateVisibilitySchema>;

/**
 * Summary schema for household and user totals (Net Worth).
 * Net Worth definition across all assets and liabilities:
 * Net Worth = cash + bank + kuri + gold_scheme + loan_given - loan_taken
 */
export const bucketSummarySchema = z.object({
  /**
   * Sum of shared and balance_only buckets visible across the household
   */
  householdTotal: z.number().int(),
  /**
   * Sum of user's own buckets (all visibilities) + partner's shared buckets
   */
  myTotal: z.number().int(),
});

export type BucketSummary = z.infer<typeof bucketSummarySchema>;

/**
 * Sanitized public bucket schema returned to clients according to viewer privacy
 */
export const publicBucketSchema = z.object({
  id: objectIdSchema,
  householdId: objectIdSchema,
  ownerId: objectIdSchema,
  name: z.string().min(1).max(50),
  type: bucketTypeEnum,
  balance: z.number().int('Balance must be integer paise'),
  visibility: visibilityEnum,
  isArchived: z.boolean(),
  isOwner: z.boolean(),
  canViewTransactions: z.boolean(),
  description: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type PublicBucket = z.infer<typeof publicBucketSchema>;

/**
 * Stored Bucket Entity Schema in Database
 */
export const bucketSchema = z.object({
  id: objectIdSchema,
  householdId: objectIdSchema,
  ownerId: objectIdSchema,
  name: z.string().min(1).max(50),
  type: bucketTypeEnum,
  balance: z.number().int('Balance must be integer paise'),
  visibility: visibilityEnum,
  isArchived: z.boolean(),
  description: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type Bucket = z.infer<typeof bucketSchema>;
