import { z } from 'zod';

/**
 * Three Privacy Levels (Per Bucket):
 *
 * 1. 'shared':
 *    Partner has full visibility over the bucket, its balance, and all associated transactions.
 *
 * 2. 'balance_only':
 *    Partner can see the bucket and its current balance ONLY.
 *    No transactions, no categories, no notes, no comments, no notifications.
 *
 * 3. 'private':
 *    Completely invisible to the partner. Excluded from partner queries and reports.
 */

export const visibilityEnum = z.enum(['shared', 'balance_only', 'private']);
export type Visibility = z.infer<typeof visibilityEnum>;

export interface ViewerAccess {
  /** Can the viewer see the bucket's existence and metadata (name, type) */
  bucket: boolean;
  /** Can the viewer see the current balance */
  balance: boolean;
  /** Can the viewer see transactions, categories, purposes, and activity */
  transactions: boolean;
}

/**
 * Pure function determining what a viewer (either the bucket owner or the partner) can see.
 * This function forms the basis of all backend privacy filters, query projections, and masking.
 */
export function canViewerSee(visibility: Visibility, isOwner: boolean): ViewerAccess {
  // The owner can ALWAYS see 100% of their own bucket
  if (isOwner) {
    return {
      bucket: true,
      balance: true,
      transactions: true,
    };
  }

  // Access rules for the partner:
  switch (visibility) {
    case 'shared':
      return {
        bucket: true,
        balance: true,
        transactions: true,
      };

    case 'balance_only':
      return {
        bucket: true,
        balance: true,
        transactions: false,
      };

    case 'private':
      return {
        bucket: false,
        balance: false,
        transactions: false,
      };
  }
}
