import { Types } from 'mongoose';
import {
  CreateBucketInput,
  UpdateBucketInput,
  UpdateVisibilityInput,
  PublicBucket,
  BucketSummary,
} from '@vault/shared';
import { Bucket } from '../models/Bucket';
import { Transaction } from '../models/Transaction';
import { runInTransaction } from '../utils/transactionRunner';
import {
  getVisibleBucketsFilter,
  mapBucketForViewer,
} from './privacyPolicy';
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
} from '../utils/errors';

export class BucketService {
  /**
   * Creates a new bucket.
   * 
   * FINANCIAL INVARIANT (Immutable Ledger):
   * Balance is NEVER accepted from arbitrary client input or directly written as opening balance.
   * All buckets are initialized with balance = 0 paise.
   * If openingBalance is specified, we store balance = 0 and provide a hook for Phase 4B
   * to record an opening-balance transaction in the ledger.
   */
  static async createBucket(
    householdId: string,
    ownerId: string,
    input: CreateBucketInput
  ): Promise<PublicBucket> {
    if (input.openingBalance && input.openingBalance > 0) {
      // Execute bucket creation + opening balance transaction inside a MongoDB transaction session
      return runInTransaction(async (session) => {
        const bucket = new Bucket({
          householdId: new Types.ObjectId(householdId),
          ownerId: new Types.ObjectId(ownerId),
          name: input.name.trim(),
          type: input.type,
          visibility: input.visibility,
          description: input.description?.trim(),
          balance: input.openingBalance,
          isArchived: false,
        });
        await bucket.save({ session });

        // Record opening balance ledger entry
        const tx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'income',
          amount: input.openingBalance,
          toBucketId: bucket._id,
          category: 'Opening balance',
          purpose: 'Initial balance on bucket creation',
          date: new Date(),
          createdBy: new Types.ObjectId(ownerId),
          status: 'active',
        });
        await tx.save({ session });

        const publicBucket = mapBucketForViewer(bucket, ownerId, householdId);
        if (!publicBucket) {
          throw new Error('Failed to map created bucket');
        }
        return publicBucket;
      });
    }

    const bucket = await Bucket.create({
      householdId: new Types.ObjectId(householdId),
      ownerId: new Types.ObjectId(ownerId),
      name: input.name.trim(),
      type: input.type,
      visibility: input.visibility,
      description: input.description?.trim(),
      balance: 0, // Invariant: Always start at 0 paise when no opening balance
      isArchived: false,
    });

    const publicBucket = mapBucketForViewer(bucket, ownerId, householdId);
    if (!publicBucket) {
      throw new Error('Failed to map created bucket');
    }
    return publicBucket;
  }

  /**
   * Retrieves all buckets in the household visible to the viewer.
   * Private partner buckets are excluded at the database query level.
   */
  static async getBuckets(
    householdId: string,
    viewerId: string,
    includeArchived = false
  ): Promise<PublicBucket[]> {
    const filter = getVisibleBucketsFilter(householdId, viewerId, includeArchived);
    const buckets = await Bucket.find(filter).sort({ createdAt: -1 });

    const visibleBuckets: PublicBucket[] = [];
    for (const b of buckets) {
      const mapped = mapBucketForViewer(b, viewerId, householdId);
      if (mapped) {
        visibleBuckets.push(mapped);
      }
    }
    return visibleBuckets;
  }

  /**
   * Retrieves a single bucket by ID.
   * 
   * PRIVACY INVARIANT:
   * If the bucket belongs to another household, or if it is a partner's private bucket,
   * we return 404 NotFoundError (never 403), ensuring the bucket's very existence is not leaked.
   */
  static async getBucketById(
    bucketId: string,
    householdId: string,
    viewerId: string
  ): Promise<PublicBucket> {
    if (!Types.ObjectId.isValid(bucketId)) {
      throw new NotFoundError('Bucket not found');
    }

    const bucket = await Bucket.findById(bucketId);
    if (!bucket || bucket.householdId.toString() !== householdId) {
      throw new NotFoundError('Bucket not found');
    }

    const publicBucket = mapBucketForViewer(bucket, viewerId, householdId);
    if (!publicBucket) {
      // Bucket is private and viewer is partner: return 404 to avoid leaking existence
      throw new NotFoundError('Bucket not found');
    }

    return publicBucket;
  }

  /**
   * Updates bucket metadata (name, description).
   * Owner only. Balance is NEVER editable.
   */
  static async updateBucket(
    bucketId: string,
    householdId: string,
    viewerId: string,
    input: UpdateBucketInput
  ): Promise<PublicBucket> {
    if (!Types.ObjectId.isValid(bucketId)) {
      throw new NotFoundError('Bucket not found');
    }

    const bucket = await Bucket.findById(bucketId);
    if (!bucket || bucket.householdId.toString() !== householdId) {
      throw new NotFoundError('Bucket not found');
    }

    if (bucket.ownerId.toString() !== viewerId) {
      // If the bucket is private, never reveal its existence (404 Not Found)
      if (bucket.visibility === 'private') {
        throw new NotFoundError('Bucket not found');
      }
      throw new ForbiddenError('Only the bucket owner can update this bucket');
    }

    if (bucket.isArchived) {
      throw new BadRequestError('Archived buckets cannot be edited');
    }

    if (input.name !== undefined) {
      bucket.name = input.name.trim();
    }
    if (input.description !== undefined) {
      bucket.description = input.description.trim();
    }
    if (input.type !== undefined && input.type !== bucket.type) {
      // FINANCIAL INVARIANT:
      // Changing a bucket's financial classification (e.g., cash vs bank vs loan liability)
      // is only allowed when balance is 0 AND the bucket has ZERO transactions (any status, including voided).
      // Changing the type of an active or historical ledger bucket corrupts double-entry history.
      if (bucket.balance !== 0) {
        throw new BadRequestError(
          'Cannot change the type of a bucket with a non-zero balance. Please settle funds to 0 first.'
        );
      }

      const txCount = await Transaction.countDocuments({
        $or: [{ fromBucketId: bucket._id }, { toBucketId: bucket._id }],
      });
      if (txCount > 0) {
        throw new BadRequestError(
          'Cannot change the type of a bucket with existing transaction history. Bucket type is immutable once transactions have been recorded.'
        );
      }

      bucket.type = input.type;
    }

    await bucket.save();

    const publicBucket = mapBucketForViewer(bucket, viewerId, householdId);
    if (!publicBucket) {
      throw new NotFoundError('Bucket not found');
    }
    return publicBucket;
  }

  /**
   * Updates bucket visibility level (shared | balance_only | private).
   * Owner only.
   */
  static async updateVisibility(
    bucketId: string,
    householdId: string,
    viewerId: string,
    input: UpdateVisibilityInput
  ): Promise<PublicBucket> {
    if (!Types.ObjectId.isValid(bucketId)) {
      throw new NotFoundError('Bucket not found');
    }

    const bucket = await Bucket.findById(bucketId);
    if (!bucket || bucket.householdId.toString() !== householdId) {
      throw new NotFoundError('Bucket not found');
    }

    if (bucket.ownerId.toString() !== viewerId) {
      if (bucket.visibility === 'private') {
        throw new NotFoundError('Bucket not found');
      }
      throw new ForbiddenError('Only the bucket owner can change its visibility');
    }

    bucket.visibility = input.visibility;
    await bucket.save();

    const publicBucket = mapBucketForViewer(bucket, viewerId, householdId);
    if (!publicBucket) {
      throw new NotFoundError('Bucket not found');
    }
    return publicBucket;
  }

  /**
   * Archives a bucket.
   * 
   * FINANCIAL INVARIANT:
   * A bucket can ONLY be archived if its balance is exactly 0 paise.
   * If balance != 0, it is rejected with a clear error requiring funds to be settled first.
   */
  static async archiveBucket(
    bucketId: string,
    householdId: string,
    viewerId: string
  ): Promise<PublicBucket> {
    if (!Types.ObjectId.isValid(bucketId)) {
      throw new NotFoundError('Bucket not found');
    }

    const bucket = await Bucket.findById(bucketId);
    if (!bucket || bucket.householdId.toString() !== householdId) {
      throw new NotFoundError('Bucket not found');
    }

    if (bucket.ownerId.toString() !== viewerId) {
      if (bucket.visibility === 'private') {
        throw new NotFoundError('Bucket not found');
      }
      throw new ForbiddenError('Only the bucket owner can archive this bucket');
    }

    if (bucket.balance !== 0) {
      throw new BadRequestError(
        'Cannot archive a bucket with a non-zero balance. Please transfer or settle the funds to zero first.'
      );
    }

    bucket.isArchived = true;
    await bucket.save();

    const publicBucket = mapBucketForViewer(bucket, viewerId, householdId);
    if (!publicBucket) {
      throw new NotFoundError('Bucket not found');
    }
    return publicBucket;
  }

  /**
   * Calculates financial summary metrics for the viewer:
   * 
   * 1. householdTotal:
   *    Sum of all active buckets in the household marked as 'shared' or 'balance_only'.
   *    Excludes any 'private' buckets (both partner's and user's own private buckets)
   *    to represent the joint family visible net balance.
   * 
   * 2. myTotal:
   *    Sum of all the viewer's own active buckets (of ANY visibility: private, balance_only, shared)
   *    PLUS partner's buckets marked as 'shared'.
   *    Excludes partner's 'balance_only' and 'private' buckets.
   */
  static async getSummary(
    householdId: string,
    viewerId: string
  ): Promise<BucketSummary> {
    const activeBuckets = await Bucket.find({
      householdId: new Types.ObjectId(householdId),
      isArchived: false,
    });

    let householdTotal = 0;
    let myTotal = 0;

    for (const b of activeBuckets) {
      const isOwner = b.ownerId.toString() === viewerId;

      // householdTotal includes all shared + balance_only buckets
      if (b.visibility === 'shared' || b.visibility === 'balance_only') {
        householdTotal += b.balance;
      }

      // myTotal includes:
      // 1. All of viewer's own buckets (private, balance_only, shared)
      // 2. Partner's shared buckets
      if (isOwner) {
        myTotal += b.balance;
      } else if (b.visibility === 'shared') {
        myTotal += b.balance;
      }
    }

    return {
      householdTotal,
      myTotal,
    };
  }
}
