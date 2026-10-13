import { PublicBucket } from '@vault/shared';
import { IBucket } from '../models/Bucket';

/**
 * Pure Privacy Policy Module
 * Enforces backend privacy rules at both the query level and response mapping layer.
 * 
 * Rules:
 * 1. Viewer is owner: sees everything (name, type, balance, description, transactions).
 * 2. Viewer is partner, 'shared': sees bucket, balance, description, and transactions.
 * 3. Viewer is partner, 'balance_only': sees name and CURRENT BALANCE ONLY.
 *    No description/notes, no transactions (canViewTransactions = false).
 * 4. Viewer is partner, 'private': bucket DOES NOT exist for them. (Returns null -> 404 Not Found).
 * 5. Another household: bucket DOES NOT exist. (Returns null -> 404 Not Found).
 */

/**
 * Builds the MongoDB query filter for listing buckets visible to a specific user.
 * Partner's private buckets are excluded at the database level.
 */
export function getVisibleBucketsFilter(
  householdId: string,
  viewerId: string,
  includeArchived = false
): Record<string, unknown> {
  const baseFilter: Record<string, unknown> = {
    householdId,
    $or: [
      { ownerId: viewerId },
      { visibility: { $in: ['shared', 'balance_only'] } },
    ],
  };

  if (!includeArchived) {
    baseFilter['isArchived'] = false;
  }

  return baseFilter;
}

/**
 * Checks whether a viewer has permission to view a bucket.
 */
export function canViewerAccessBucket(
  bucket: IBucket,
  viewerId: string,
  viewerHouseholdId: string
): boolean {
  // Foreign household check: never allow cross-household access
  if (bucket.householdId.toString() !== viewerHouseholdId) {
    return false;
  }

  // Owner always has full access
  if (bucket.ownerId.toString() === viewerId) {
    return true;
  }

  // Partner access depends on visibility level
  switch (bucket.visibility) {
    case 'shared':
    case 'balance_only':
      return true;
    case 'private':
      return false; // Private buckets are invisible to partner
  }
}

/**
 * Transforms an internal Bucket document into a sanitized PublicBucket based on the viewer.
 * Strips sensitive fields (like description and transaction access) for balance_only buckets.
 * Returns null if the bucket is invisible to the viewer (private or foreign household).
 */
export function mapBucketForViewer(
  bucket: IBucket,
  viewerId: string,
  viewerHouseholdId: string
): PublicBucket | null {
  if (!canViewerAccessBucket(bucket, viewerId, viewerHouseholdId)) {
    return null;
  }

  const isOwner = bucket.ownerId.toString() === viewerId;

  if (isOwner) {
    return {
      id: bucket._id.toString(),
      householdId: bucket.householdId.toString(),
      ownerId: bucket.ownerId.toString(),
      name: bucket.name,
      type: bucket.type,
      balance: bucket.balance,
      visibility: bucket.visibility,
      isArchived: bucket.isArchived,
      isOwner: true,
      canViewTransactions: true,
      description: bucket.description,
      createdAt: bucket.createdAt.toISOString(),
      updatedAt: bucket.updatedAt.toISOString(),
    };
  }

  // Viewer is partner
  if (bucket.visibility === 'shared') {
    return {
      id: bucket._id.toString(),
      householdId: bucket.householdId.toString(),
      ownerId: bucket.ownerId.toString(),
      name: bucket.name,
      type: bucket.type,
      balance: bucket.balance,
      visibility: bucket.visibility,
      isArchived: bucket.isArchived,
      isOwner: false,
      canViewTransactions: true,
      description: bucket.description,
      createdAt: bucket.createdAt.toISOString(),
      updatedAt: bucket.updatedAt.toISOString(),
    };
  }

  if (bucket.visibility === 'balance_only') {
    return {
      id: bucket._id.toString(),
      householdId: bucket.householdId.toString(),
      ownerId: bucket.ownerId.toString(),
      name: bucket.name,
      type: bucket.type,
      balance: bucket.balance,
      visibility: bucket.visibility,
      isArchived: bucket.isArchived,
      isOwner: false,
      canViewTransactions: false,
      // Description is stripped for balance_only privacy
      description: undefined,
      createdAt: bucket.createdAt.toISOString(),
      updatedAt: bucket.updatedAt.toISOString(),
    };
  }

  return null;
}
