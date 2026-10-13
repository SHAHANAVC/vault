import { PublicTransaction, PublicTransactionGroup } from '@vault/shared';
import { ITransaction } from '../models/Transaction';
import { IBucket } from '../models/Bucket';
import { IUser } from '../models/User';

/**
 * Pure Transaction Privacy Policy Module
 * Enforces privacy at both the database query filter level and the response mapper layer.
 * 
 * Rules:
 * 1. Owner of all touched buckets / creator: sees everything unmasked.
 * 2. Partner:
 *    - Sees an income/expense only if the bucket is "shared".
 *    - Transactions touching a "balance_only" bucket are NEVER visible to the partner.
 *    - Transactions inside "private" buckets are NEVER visible to the partner.
 *    - Transfers between two "shared" buckets: partner sees unmasked.
 *    - Transfers between a "shared" bucket and a hidden bucket (private or balance_only):
 *      partner sees amount, date, and status with masked label ("Moved to private" / "From private"),
 *      without the hidden bucket's name, category, purpose, or notes.
 */

export function canViewerAccessTransaction(
  tx: ITransaction,
  viewerId: string,
  viewerHouseholdId: string,
  bucketsMap: Map<string, IBucket>
): boolean {
  // Foreign household check
  if (tx.householdId.toString() !== viewerHouseholdId) {
    return false;
  }

  // Creator always has access to their own transactions
  if (tx.createdBy.toString() === viewerId) {
    return true;
  }

  const fromBucket = tx.fromBucketId ? bucketsMap.get(tx.fromBucketId.toString()) : undefined;
  const toBucket = tx.toBucketId ? bucketsMap.get(tx.toBucketId.toString()) : undefined;

  // If viewer owns all touched buckets
  const ownsFrom = !fromBucket || fromBucket.ownerId.toString() === viewerId;
  const ownsTo = !toBucket || toBucket.ownerId.toString() === viewerId;
  if (ownsFrom && ownsTo) {
    return true;
  }

  // Partner visibility rules by type:
  if (tx.type === 'income') {
    return toBucket?.visibility === 'shared';
  }

  if (tx.type === 'expense') {
    return fromBucket?.visibility === 'shared';
  }

  if (tx.type === 'transfer') {
    const isFromShared = fromBucket?.visibility === 'shared';
    const isToShared = toBucket?.visibility === 'shared';
    // Visible if at least one side is shared
    return isFromShared || isToShared;
  }

  if (tx.type === 'adjustment') {
    const bucket = toBucket || fromBucket;
    return bucket?.visibility === 'shared';
  }

  return false;
}

export function mapTransactionForViewer(
  tx: ITransaction,
  viewerId: string,
  viewerHouseholdId: string,
  bucketsMap: Map<string, IBucket>,
  usersMap?: Map<string, IUser>
): PublicTransaction | null {
  if (!canViewerAccessTransaction(tx, viewerId, viewerHouseholdId, bucketsMap)) {
    return null;
  }

  const creator = usersMap?.get(tx.createdBy.toString());
  const fromBucket = tx.fromBucketId ? bucketsMap.get(tx.fromBucketId.toString()) : undefined;
  const toBucket = tx.toBucketId ? bucketsMap.get(tx.toBucketId.toString()) : undefined;

  const isCreator = tx.createdBy.toString() === viewerId;
  const ownsFrom = !fromBucket || fromBucket.ownerId.toString() === viewerId;
  const ownsTo = !toBucket || toBucket.ownerId.toString() === viewerId;
  const fullOwnership = isCreator || (ownsFrom && ownsTo);

  const dateStr = tx.date instanceof Date ? tx.date.toISOString() : new Date(tx.date).toISOString();
  const createdAtStr = tx.createdAt
    ? (tx.createdAt instanceof Date ? tx.createdAt.toISOString() : new Date(tx.createdAt).toISOString())
    : new Date().toISOString();
  const voidedAtStr = tx.voidedAt
    ? (tx.voidedAt instanceof Date ? tx.voidedAt.toISOString() : new Date(tx.voidedAt).toISOString())
    : undefined;

  // If viewer has full visibility (creator or owner of both buckets)
  if (fullOwnership) {
    return {
      id: tx._id.toString(),
      householdId: tx.householdId.toString(),
      createdBy: tx.createdBy.toString(),
      creatorName: creator?.name || 'Household Member',
      type: tx.type,
      amount: tx.amount,
      fromBucketId: tx.fromBucketId?.toString(),
      fromBucketName: fromBucket?.name,
      toBucketId: tx.toBucketId?.toString(),
      toBucketName: toBucket?.name,
      category: tx.category,
      purpose: tx.purpose,
      reason: tx.reason,
      date: dateStr,
      groupId: tx.groupId,
      status: tx.status,
      reversalOf: tx.reversalOf?.toString(),
      voidedBy: tx.voidedBy?.toString(),
      voidedAt: voidedAtStr,
      isMasked: false,
      createdAt: createdAtStr,
    };
  }

  // Partner view:
  // 1. Both buckets shared
  const fromShared = fromBucket?.visibility === 'shared';
  const toShared = toBucket?.visibility === 'shared';

  if ((!fromBucket || fromShared) && (!toBucket || toShared)) {
    return {
      id: tx._id.toString(),
      householdId: tx.householdId.toString(),
      createdBy: tx.createdBy.toString(),
      creatorName: creator?.name || 'Partner',
      type: tx.type,
      amount: tx.amount,
      fromBucketId: tx.fromBucketId?.toString(),
      fromBucketName: fromBucket?.name,
      toBucketId: tx.toBucketId?.toString(),
      toBucketName: toBucket?.name,
      category: tx.category,
      purpose: tx.purpose,
      reason: tx.reason,
      date: dateStr,
      groupId: tx.groupId,
      status: tx.status,
      reversalOf: tx.reversalOf?.toString(),
      voidedBy: tx.voidedBy?.toString(),
      voidedAt: voidedAtStr,
      isMasked: false,
      createdAt: createdAtStr,
    };
  }

  // 2. Transfer between Shared and Hidden (Private or Balance Only) -> MASKED
  if (tx.type === 'transfer') {
    if (fromShared && !toShared) {
      // Outflow from shared to hidden bucket
      return {
        id: tx._id.toString(),
        householdId: tx.householdId.toString(),
        createdBy: tx.createdBy.toString(),
        creatorName: creator?.name || 'Partner',
        type: 'transfer',
        amount: tx.amount,
        fromBucketId: fromBucket?._id.toString(),
        fromBucketName: fromBucket?.name,
        toBucketId: undefined,
        toBucketName: 'Protected Bucket',
        category: 'Transfer',
        purpose: 'Moved to private',
        reason: undefined,
        date: dateStr,
        status: tx.status,
        reversalOf: tx.reversalOf?.toString(),
        voidedBy: tx.voidedBy?.toString(),
        voidedAt: voidedAtStr,
        isMasked: true,
        createdAt: createdAtStr,
      };
    }

    if (!fromShared && toShared) {
      // Inflow from hidden bucket to shared
      return {
        id: tx._id.toString(),
        householdId: tx.householdId.toString(),
        createdBy: tx.createdBy.toString(),
        creatorName: creator?.name || 'Partner',
        type: 'transfer',
        amount: tx.amount,
        fromBucketId: undefined,
        fromBucketName: 'Protected Bucket',
        toBucketId: toBucket?._id.toString(),
        toBucketName: toBucket?.name,
        category: 'Transfer',
        purpose: 'From private',
        reason: undefined,
        date: dateStr,
        status: tx.status,
        reversalOf: tx.reversalOf?.toString(),
        voidedBy: tx.voidedBy?.toString(),
        voidedAt: voidedAtStr,
        isMasked: true,
        createdAt: createdAtStr,
      };
    }
  }

  return null;
}

/**
 * Maps a group of split transactions (income or transfer) with per-line privacy enforcement.
 * 
 * Invariants:
 * - Creator sees all lines unmasked.
 * - Partner sees visible lines (e.g. into shared buckets or transfers touching shared buckets).
 * - Hidden lines for the partner are rendered as masked placeholders without leaking bucket name, amount, or notes.
 * - Group total amount shown to partner is computed strictly from visible lines.
 */
export function mapTransactionGroupForViewer(
  groupTxs: ITransaction[],
  viewerId: string,
  viewerHouseholdId: string,
  bucketsMap: Map<string, IBucket>,
  usersMap?: Map<string, IUser>
): PublicTransactionGroup | null {
  if (groupTxs.length === 0) {
    return null;
  }

  const firstTx = groupTxs[0];
  if (firstTx.householdId.toString() !== viewerHouseholdId) {
    return null;
  }

  const isCreator = firstTx.createdBy.toString() === viewerId;
  const creator = usersMap?.get(firstTx.createdBy.toString());

  const lines: PublicTransaction[] = [];
  let visibleLinesCount = 0;
  let totalVisibleAmount = 0;

  for (const tx of groupTxs) {
    const mapped = mapTransactionForViewer(tx, viewerId, viewerHouseholdId, bucketsMap, usersMap);
    if (mapped) {
      lines.push(mapped);
      visibleLinesCount++;
      totalVisibleAmount += mapped.amount;
    } else {
      // Hidden line from partner view:
      // Provide a protected placeholder without leaking bucket or amount
      lines.push({
        id: tx._id.toString(),
        householdId: tx.householdId.toString(),
        createdBy: tx.createdBy.toString(),
        creatorName: creator?.name || 'Partner',
        type: tx.type,
        amount: 0,
        category: 'Protected Allocation',
        purpose: 'Another allocation (private)',
        date: tx.date instanceof Date ? tx.date.toISOString() : new Date(tx.date).toISOString(),
        groupId: tx.groupId,
        status: tx.status,
        isMasked: true,
        createdAt: tx.createdAt instanceof Date ? tx.createdAt.toISOString() : new Date(tx.createdAt).toISOString(),
      });
    }
  }

  // If partner cannot see ANY lines and is not creator, the entire group is hidden (returns null -> 404)
  if (!isCreator && visibleLinesCount === 0) {
    return null;
  }

  const fromBucket = firstTx.fromBucketId ? bucketsMap.get(firstTx.fromBucketId.toString()) : undefined;
  const isFromShared = fromBucket?.visibility === 'shared';
  const fromBucketName = isCreator || isFromShared ? fromBucket?.name : 'Protected Bucket';

  // Total amount: If creator, exact sum of all lines; if partner, sum of visible lines
  const totalAmount = isCreator
    ? groupTxs.reduce((sum, tx) => sum + tx.amount, 0)
    : totalVisibleAmount;

  const dateStr = firstTx.date instanceof Date ? firstTx.date.toISOString() : new Date(firstTx.date).toISOString();
  const createdAtStr = firstTx.createdAt
    ? (firstTx.createdAt instanceof Date ? firstTx.createdAt.toISOString() : new Date(firstTx.createdAt).toISOString())
    : new Date().toISOString();

  const allVoided = groupTxs.every((tx) => tx.status === 'voided');

  return {
    groupId: firstTx.groupId || firstTx._id.toString(),
    type: firstTx.type,
    totalAmount,
    linesCount: groupTxs.length,
    visibleLinesCount,
    date: dateStr,
    source: firstTx.category,
    purpose: firstTx.purpose,
    status: allVoided ? 'voided' : 'active',
    createdBy: firstTx.createdBy.toString(),
    creatorName: creator?.name || (isCreator ? 'You' : 'Partner'),
    fromBucketId: isCreator || isFromShared ? firstTx.fromBucketId?.toString() : undefined,
    fromBucketName,
    lines,
    createdAt: createdAtStr,
  };
}
