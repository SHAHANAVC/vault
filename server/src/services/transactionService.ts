import { Types, ClientSession } from 'mongoose';
import {
  TransactionInput,
  PublicTransaction,
  SplitIncomeInput,
  SplitTransferInput,
  AdjustmentInput,
  PublicTransactionGroup,
} from '@vault/shared';
import { Transaction, ITransaction } from '../models/Transaction';
import { Bucket, IBucket } from '../models/Bucket';
import { User } from '../models/User';
import { runInTransaction } from '../utils/transactionRunner';
import {
  mapTransactionForViewer,
  mapTransactionGroupForViewer,
} from './transactionPrivacyPolicy';
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
} from '../utils/errors';

export class TransactionService {
  /**
   * Helper to validate that a bucket belongs to the user's household,
   * is not archived, and the user has permission to spend or deposit into it.
   */
  private static async validateBucketAccess(
    bucketId: string,
    householdId: string,
    viewerId: string,
    action: 'spend' | 'deposit',
    session?: ClientSession
  ): Promise<IBucket> {
    if (!Types.ObjectId.isValid(bucketId)) {
      throw new NotFoundError('Bucket not found');
    }

    const bucket = await Bucket.findById(bucketId).session(session || null);
    if (!bucket || bucket.householdId.toString() !== householdId) {
      throw new NotFoundError('Bucket not found');
    }

    if (bucket.isArchived) {
      throw new BadRequestError(`Cannot ${action} from/to an archived bucket ("${bucket.name}")`);
    }

    const isOwner = bucket.ownerId.toString() === viewerId;
    if (isOwner) {
      return bucket;
    }

    // Partner rules:
    // Partner can only spend from or deposit into SHARED buckets.
    // Cannot spend from or deposit into partner's private or balance_only buckets.
    if (bucket.visibility === 'private') {
      // Must not leak existence of private bucket
      throw new NotFoundError('Bucket not found');
    }

    if (bucket.visibility === 'balance_only') {
      throw new ForbiddenError(
        `You do not have permission to ${action} funds using this bucket ("${bucket.name}" is balance only).`
      );
    }

    // Shared bucket is accessible by partner
    return bucket;
  }

  /**
   * Performs an atomic conditional debit on a bucket.
   * For cash and bank accounts, enforces that balance >= amount.
   * Loan and kuri buckets may go negative.
   */
  private static async atomicDebit(
    bucketId: Types.ObjectId,
    householdId: string,
    amount: number,
    session?: ClientSession
  ): Promise<IBucket> {
    const bucket = await Bucket.findById(bucketId).session(session || null);
    if (!bucket || bucket.householdId.toString() !== householdId) {
      throw new NotFoundError('Bucket not found');
    }

    if (bucket.isArchived) {
      throw new BadRequestError(`Archived bucket ("${bucket.name}") cannot participate in transactions`);
    }

    const isNegativeProtected = bucket.type === 'cash' || bucket.type === 'bank';

    if (isNegativeProtected) {
      // Atomic conditional update: balance must be >= amount
      const updated = await Bucket.findOneAndUpdate(
        {
          _id: bucketId,
          householdId: new Types.ObjectId(householdId),
          isArchived: false,
          balance: { $gte: amount },
        },
        { $inc: { balance: -amount } },
        { returnDocument: 'after', session: session || undefined }
      );

      if (!updated) {
        throw new BadRequestError(
          `Insufficient funds in "${bucket.name}". Current balance is insufficient for this transaction.`
        );
      }
      return updated;
    } else {
      // Loan and kuri buckets may go negative
      const updated = await Bucket.findOneAndUpdate(
        {
          _id: bucketId,
          householdId: new Types.ObjectId(householdId),
          isArchived: false,
        },
        { $inc: { balance: -amount } },
        { returnDocument: 'after', session: session || undefined }
      );

      if (!updated) {
        throw new BadRequestError(`Failed to debit bucket "${bucket.name}".`);
      }
      return updated;
    }
  }

  /**
   * Performs an atomic credit on a bucket.
   */
  private static async atomicCredit(
    bucketId: Types.ObjectId,
    householdId: string,
    amount: number,
    session?: ClientSession
  ): Promise<IBucket> {
    const updated = await Bucket.findOneAndUpdate(
      {
        _id: bucketId,
        householdId: new Types.ObjectId(householdId),
        isArchived: false,
      },
      { $inc: { balance: amount } },
      { returnDocument: 'after', session: session || undefined }
    );

    if (!updated) {
      const bucket = await Bucket.findById(bucketId).session(session || null);
      if (bucket?.isArchived) {
        throw new BadRequestError(`Cannot deposit into archived bucket ("${bucket.name}")`);
      }
      throw new NotFoundError('Destination bucket not found');
    }

    return updated;
  }

  /**
   * Creates a transaction (Income, Expense, Transfer, or Adjustment)
   * executed inside a MongoDB transaction session with atomic conditional updates.
   */
  static async createTransaction(
    householdId: string,
    viewerId: string,
    input: TransactionInput
  ): Promise<PublicTransaction> {
    // 1. Idempotency Check
    if (input.idempotencyKey) {
      const existingTx = await Transaction.findOne({
        householdId: new Types.ObjectId(householdId),
        idempotencyKey: input.idempotencyKey,
      });

      if (existingTx) {
        // Fetch buckets and user to map response
        const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
        const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
        const users = await User.find({ householdId: new Types.ObjectId(householdId) });
        const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

        const mapped = mapTransactionForViewer(existingTx, viewerId, householdId, bucketsMap, usersMap);
        if (mapped) return mapped;
      }
    }

    // 2. Validate Permissions and Bucket Rules outside session before write lock
    if (input.type === 'income') {
      await this.validateBucketAccess(input.toBucketId, householdId, viewerId, 'deposit');
    } else if (input.type === 'expense') {
      await this.validateBucketAccess(input.fromBucketId, householdId, viewerId, 'spend');
    } else if (input.type === 'transfer') {
      if (input.fromBucketId === input.toBucketId) {
        throw new BadRequestError('Source and destination buckets must differ');
      }
      await this.validateBucketAccess(input.fromBucketId, householdId, viewerId, 'spend');
      await this.validateBucketAccess(input.toBucketId, householdId, viewerId, 'deposit');
    } else if (input.type === 'adjustment') {
      await this.validateBucketAccess(input.bucketId, householdId, viewerId, 'deposit');
    }

    // 3. Execute Ledger Write inside MongoDB session
    return runInTransaction(async (session) => {
      let createdTx: ITransaction;

      if (input.type === 'income') {
        const toBucketId = new Types.ObjectId(input.toBucketId);
        await this.atomicCredit(toBucketId, householdId, input.amount, session);

        createdTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'income',
          amount: input.amount,
          toBucketId,
          category: input.category,
          purpose: input.purpose,
          date: new Date(input.date),
          createdBy: new Types.ObjectId(viewerId),
          status: 'active',
          idempotencyKey: input.idempotencyKey,
        });
        await createdTx.save({ session });
      } else if (input.type === 'expense') {
        const fromBucketId = new Types.ObjectId(input.fromBucketId);
        await this.atomicDebit(fromBucketId, householdId, input.amount, session);

        createdTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'expense',
          amount: input.amount,
          fromBucketId,
          category: input.category,
          purpose: input.purpose,
          date: new Date(input.date),
          createdBy: new Types.ObjectId(viewerId),
          status: 'active',
          idempotencyKey: input.idempotencyKey,
        });
        await createdTx.save({ session });
      } else if (input.type === 'transfer') {
        const fromBucketId = new Types.ObjectId(input.fromBucketId);
        const toBucketId = new Types.ObjectId(input.toBucketId);

        // Atomic debit from source followed by atomic credit to destination
        await this.atomicDebit(fromBucketId, householdId, input.amount, session);
        await this.atomicCredit(toBucketId, householdId, input.amount, session);

        createdTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'transfer',
          amount: input.amount,
          fromBucketId,
          toBucketId,
          purpose: input.purpose,
          date: new Date(input.date),
          createdBy: new Types.ObjectId(viewerId),
          status: 'active',
          idempotencyKey: input.idempotencyKey,
        });
        await createdTx.save({ session });
      } else if (input.type === 'adjustment') {
        const bucketId = new Types.ObjectId(input.bucketId);
        if (input.amount > 0) {
          await this.atomicCredit(bucketId, householdId, input.amount, session);
        } else if (input.amount < 0) {
          await this.atomicDebit(bucketId, householdId, Math.abs(input.amount), session);
        }

        createdTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'adjustment',
          amount: Math.abs(input.amount),
          toBucketId: input.amount >= 0 ? bucketId : undefined,
          fromBucketId: input.amount < 0 ? bucketId : undefined,
          reason: input.reason,
          date: new Date(input.date),
          createdBy: new Types.ObjectId(viewerId),
          status: 'active',
          idempotencyKey: input.idempotencyKey,
        });
        await createdTx.save({ session });
      } else {
        throw new BadRequestError('Unsupported transaction type');
      }

      // Populate metadata for response mapping
      const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
      const users = await User.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

      const publicTx = mapTransactionForViewer(createdTx, viewerId, householdId, bucketsMap, usersMap);
      if (!publicTx) {
        throw new Error('Failed to map created transaction for viewer');
      }
      return publicTx;
    });
  }

  /**
   * Creates a multi-allocation split income in one atomic transaction session.
   * 
   * Architectural Design Choice:
   * Income is deposited directly into each destination bucket (no temporary "receiving" bucket).
   * This guarantees that an allocation to a private or balance_only bucket never appears as an outflow/transfer
   * out of a shared bucket, preventing any information leak or PII exposure to the partner.
   */
  static async createSplitIncome(
    input: SplitIncomeInput,
    householdId: string,
    viewerId: string
  ): Promise<PublicTransactionGroup> {
    // 1. Idempotency Check
    if (input.idempotencyKey) {
      const existing = await Transaction.findOne({
        householdId: new Types.ObjectId(householdId),
        idempotencyKey: input.idempotencyKey,
      });
      if (existing && existing.groupId) {
        return this.getGroupById(existing.groupId, householdId, viewerId);
      }
    }

    // 2. Validate all destination buckets
    for (const alloc of input.allocations) {
      await this.validateBucketAccess(alloc.bucketId, householdId, viewerId, 'deposit');
    }

    const groupId = new Types.ObjectId().toString();

    return runInTransaction(async (session) => {
      const createdTxs: ITransaction[] = [];

      for (const [i, alloc] of input.allocations.entries()) {
        const bucketId = new Types.ObjectId(alloc.bucketId);

        // Atomic credit to destination bucket
        await this.atomicCredit(bucketId, householdId, alloc.amount, session);

        const tx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'income',
          amount: alloc.amount,
          toBucketId: bucketId,
          category: input.source,
          purpose: alloc.note || input.purpose || 'Split income allocation',
          date: new Date(input.date),
          createdBy: new Types.ObjectId(viewerId),
          groupId,
          status: 'active',
          idempotencyKey: i === 0 ? input.idempotencyKey : undefined,
        });

        await tx.save({ session });
        createdTxs.push(tx);
      }

      const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
      const users = await User.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

      const publicGroup = mapTransactionGroupForViewer(createdTxs, viewerId, householdId, bucketsMap, usersMap);
      if (!publicGroup) {
        throw new Error('Failed to map created split income group');
      }
      return publicGroup;
    });
  }

  /**
   * Creates a multi-destination split transfer from a single source in one atomic transaction session.
   * 
   * Concurrency Safety:
   * The source bucket balance is debited atomically in a single $gte conditional update for the exact
   * total amount (input.totalAmount). This single atomic operation prevents overdraft on cash/bank accounts
   * under high concurrency race conditions.
   */
  static async createSplitTransfer(
    input: SplitTransferInput,
    householdId: string,
    viewerId: string
  ): Promise<PublicTransactionGroup> {
    // 1. Idempotency Check
    if (input.idempotencyKey) {
      const existing = await Transaction.findOne({
        householdId: new Types.ObjectId(householdId),
        idempotencyKey: input.idempotencyKey,
      });
      if (existing && existing.groupId) {
        return this.getGroupById(existing.groupId, householdId, viewerId);
      }
    }

    // 2. Validate source and destination buckets access
    await this.validateBucketAccess(input.fromBucketId, householdId, viewerId, 'spend');
    for (const dest of input.destinations) {
      await this.validateBucketAccess(dest.bucketId, householdId, viewerId, 'deposit');
    }

    const fromBucketId = new Types.ObjectId(input.fromBucketId);
    const groupId = new Types.ObjectId().toString();

    return runInTransaction(async (session) => {
      // Debit source bucket for the TOTAL amount atomically with $gte condition
      await this.atomicDebit(fromBucketId, householdId, input.totalAmount, session);

      const createdTxs: ITransaction[] = [];

      for (const [i, dest] of input.destinations.entries()) {
        const toBucketId = new Types.ObjectId(dest.bucketId);

        // Atomic credit to destination bucket
        await this.atomicCredit(toBucketId, householdId, dest.amount, session);

        const tx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'transfer',
          amount: dest.amount,
          fromBucketId,
          toBucketId,
          purpose: dest.note || input.purpose || 'Split transfer allocation',
          date: new Date(input.date),
          createdBy: new Types.ObjectId(viewerId),
          groupId,
          status: 'active',
          idempotencyKey: i === 0 ? input.idempotencyKey : undefined,
        });

        await tx.save({ session });
        createdTxs.push(tx);
      }

      const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
      const users = await User.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

      const publicGroup = mapTransactionGroupForViewer(createdTxs, viewerId, householdId, bucketsMap, usersMap);
      if (!publicGroup) {
        throw new Error('Failed to map created split transfer group');
      }
      return publicGroup;
    });
  }

  /**
   * Creates an adjustment transaction for correcting recorded balance to match real-world statements.
   * Owner-only privilege. Mandatory reason required.
   */
  static async createAdjustment(
    input: AdjustmentInput,
    householdId: string,
    viewerId: string
  ): Promise<PublicTransaction> {
    if (!Types.ObjectId.isValid(input.bucketId)) {
      throw new NotFoundError('Bucket not found');
    }

    const bucket = await Bucket.findById(input.bucketId);
    if (!bucket || bucket.householdId.toString() !== householdId) {
      throw new NotFoundError('Bucket not found');
    }

    // Owner-only check
    if (bucket.ownerId.toString() !== viewerId) {
      if (bucket.visibility === 'private') {
        throw new NotFoundError('Bucket not found');
      }
      throw new ForbiddenError('Only the bucket owner can adjust its balance');
    }

    if (bucket.isArchived) {
      throw new BadRequestError(`Cannot adjust an archived bucket ("${bucket.name}")`);
    }

    if (input.idempotencyKey) {
      const existing = await Transaction.findOne({
        householdId: new Types.ObjectId(householdId),
        idempotencyKey: input.idempotencyKey,
      });
      if (existing) {
        return this.getTransactionById(existing._id.toString(), householdId, viewerId);
      }
    }

    const bucketId = new Types.ObjectId(input.bucketId);
    const absAmount = Math.abs(input.amount);
    const isIncrease = input.amount > 0;

    return runInTransaction(async (session) => {
      if (isIncrease) {
        await this.atomicCredit(bucketId, householdId, absAmount, session);
      } else {
        await this.atomicDebit(bucketId, householdId, absAmount, session);
      }

      const tx = new Transaction({
        householdId: new Types.ObjectId(householdId),
        type: 'adjustment',
        amount: absAmount,
        toBucketId: isIncrease ? bucketId : undefined,
        fromBucketId: !isIncrease ? bucketId : undefined,
        reason: input.reason,
        date: new Date(input.date),
        createdBy: new Types.ObjectId(viewerId),
        status: 'active',
        idempotencyKey: input.idempotencyKey,
      });

      await tx.save({ session });

      const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
      const users = await User.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

      const publicTx = mapTransactionForViewer(tx, viewerId, householdId, bucketsMap, usersMap);
      if (!publicTx) {
        throw new Error('Failed to map created adjustment');
      }
      return publicTx;
    });
  }

  /**
   * Retrieves a split transaction group by groupId with per-line privacy masking.
   */
  static async getGroupById(
    groupId: string,
    householdId: string,
    viewerId: string
  ): Promise<PublicTransactionGroup> {
    const groupTxs = await Transaction.find({
      householdId: new Types.ObjectId(householdId),
      groupId,
    }).sort({ createdAt: 1 });

    if (groupTxs.length === 0) {
      throw new NotFoundError('Transaction group not found');
    }

    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
    const users = await User.find({ householdId: new Types.ObjectId(householdId) });
    const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

    const mapped = mapTransactionGroupForViewer(groupTxs, viewerId, householdId, bucketsMap, usersMap);
    if (!mapped) {
      throw new NotFoundError('Transaction group not found');
    }

    return mapped;
  }

  /**
   * Voids an entire transaction group in one atomic session.
   * Creator-only privilege.
   * If any single reversal would push cash/bank negative, the entire group void is rolled back.
   */
  static async voidGroup(
    groupId: string,
    householdId: string,
    viewerId: string
  ): Promise<PublicTransactionGroup> {
    const groupTxs = await Transaction.find({
      householdId: new Types.ObjectId(householdId),
      groupId,
    });

    if (groupTxs.length === 0) {
      throw new NotFoundError('Transaction group not found');
    }

    const firstTx = groupTxs[0];
    if (!firstTx) {
      throw new NotFoundError('Transaction group not found');
    }
    if (firstTx.createdBy.toString() !== viewerId) {
      throw new ForbiddenError('Only the creator can void this transaction group');
    }

    if (groupTxs.every((tx) => tx.status === 'voided')) {
      throw new BadRequestError('Transaction group is already voided');
    }

    return runInTransaction(async (session) => {
      for (const tx of groupTxs) {
        if (tx.status === 'voided') continue;

        if (tx.type === 'income' && tx.toBucketId) {
          await this.atomicDebit(tx.toBucketId, householdId, tx.amount, session);

          const reversalTx = new Transaction({
            householdId: new Types.ObjectId(householdId),
            type: 'expense',
            amount: tx.amount,
            fromBucketId: tx.toBucketId,
            category: 'Void Reversal',
            purpose: `Reversal of voided split income line ${tx._id}`,
            date: new Date(),
            createdBy: new Types.ObjectId(viewerId),
            groupId: `reversal_${groupId}`,
            status: 'active',
            reversalOf: tx._id,
          });
          await reversalTx.save({ session });
        } else if (tx.type === 'transfer' && tx.fromBucketId && tx.toBucketId) {
          await this.atomicDebit(tx.toBucketId, householdId, tx.amount, session);
          await this.atomicCredit(tx.fromBucketId, householdId, tx.amount, session);

          const reversalTx = new Transaction({
            householdId: new Types.ObjectId(householdId),
            type: 'transfer',
            amount: tx.amount,
            fromBucketId: tx.toBucketId,
            toBucketId: tx.fromBucketId,
            purpose: `Reversal of voided split transfer line ${tx._id}`,
            date: new Date(),
            createdBy: new Types.ObjectId(viewerId),
            groupId: `reversal_${groupId}`,
            status: 'active',
            reversalOf: tx._id,
          });
          await reversalTx.save({ session });
        }

        tx.status = 'voided';
        tx.voidedBy = new Types.ObjectId(viewerId);
        tx.voidedAt = new Date();
        await tx.save({ session });
      }

      const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
      const users = await User.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

      const publicGroup = mapTransactionGroupForViewer(groupTxs, viewerId, householdId, bucketsMap, usersMap);
      if (!publicGroup) {
        throw new Error('Failed to map voided transaction group');
      }
      return publicGroup;
    });
  }

  /**
   * Voids an active transaction via an append-only reversal entry.
   * Creator-only privilege.
   */
  static async voidTransaction(
    transactionId: string,
    householdId: string,
    viewerId: string
  ): Promise<PublicTransaction> {
    if (!Types.ObjectId.isValid(transactionId)) {
      throw new NotFoundError('Transaction not found');
    }

    const tx = await Transaction.findById(transactionId);
    if (!tx || tx.householdId.toString() !== householdId) {
      throw new NotFoundError('Transaction not found');
    }

    // Only the creator can void
    if (tx.createdBy.toString() !== viewerId) {
      throw new ForbiddenError('Only the creator can void this transaction');
    }

    if (tx.status === 'voided') {
      throw new BadRequestError('Transaction is already voided');
    }

    if (tx.groupId) {
      throw new BadRequestError(
        `This transaction is part of a split group (${tx.groupId}). Split groups must be voided as a whole via POST /transactions/groups/${tx.groupId}/void to preserve ledger consistency.`
      );
    }

    return runInTransaction(async (session) => {
      // Reversing balance movements
      if (tx.type === 'income' && tx.toBucketId) {
        // Income credited toBucketId -> reversal must DEBIT toBucketId
        await this.atomicDebit(tx.toBucketId, householdId, tx.amount, session);

        const reversalTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'expense',
          amount: tx.amount,
          fromBucketId: tx.toBucketId,
          category: 'Void Reversal',
          purpose: `Reversal of voided transaction ${tx._id}`,
          date: new Date(),
          createdBy: new Types.ObjectId(viewerId),
          status: 'active',
          reversalOf: tx._id,
        });
        await reversalTx.save({ session });
      } else if (tx.type === 'expense' && tx.fromBucketId) {
        // Expense debited fromBucketId -> reversal must CREDIT fromBucketId
        await this.atomicCredit(tx.fromBucketId, householdId, tx.amount, session);

        const reversalTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'income',
          amount: tx.amount,
          toBucketId: tx.fromBucketId,
          category: 'Void Reversal',
          purpose: `Reversal of voided transaction ${tx._id}`,
          date: new Date(),
          createdBy: new Types.ObjectId(viewerId),
          status: 'active',
          reversalOf: tx._id,
        });
        await reversalTx.save({ session });
      } else if (tx.type === 'transfer' && tx.fromBucketId && tx.toBucketId) {
        // Transfer debited fromBucketId & credited toBucketId ->
        // Reversal must DEBIT toBucketId & CREDIT fromBucketId
        await this.atomicDebit(tx.toBucketId, householdId, tx.amount, session);
        await this.atomicCredit(tx.fromBucketId, householdId, tx.amount, session);

        const reversalTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'transfer',
          amount: tx.amount,
          fromBucketId: tx.toBucketId,
          toBucketId: tx.fromBucketId,
          purpose: `Reversal of voided transfer ${tx._id}`,
          date: new Date(),
          createdBy: new Types.ObjectId(viewerId),
          status: 'active',
          reversalOf: tx._id,
        });
        await reversalTx.save({ session });
      } else if (tx.type === 'adjustment') {
        if (tx.toBucketId) {
          await this.atomicDebit(tx.toBucketId, householdId, tx.amount, session);
        } else if (tx.fromBucketId) {
          await this.atomicCredit(tx.fromBucketId, householdId, tx.amount, session);
        }

        const reversalTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'adjustment',
          amount: tx.amount,
          fromBucketId: tx.toBucketId,
          toBucketId: tx.fromBucketId,
          reason: `Reversal of adjustment ${tx._id}`,
          date: new Date(),
          createdBy: new Types.ObjectId(viewerId),
          status: 'active',
          reversalOf: tx._id,
        });
        await reversalTx.save({ session });
      }

      // Mark original entry voided
      tx.status = 'voided';
      tx.voidedBy = new Types.ObjectId(viewerId);
      tx.voidedAt = new Date();
      await tx.save({ session });

      const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
      const users = await User.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

      const publicTx = mapTransactionForViewer(tx, viewerId, householdId, bucketsMap, usersMap);
      if (!publicTx) {
        throw new Error('Failed to map voided transaction');
      }
      return publicTx;
    });
  }

  /**
   * Retrieves transactions for the household, filtered by the viewer's privacy permissions.
   * Newest first.
   */
  static async getTransactions(
    householdId: string,
    viewerId: string,
    page = 1,
    limit = 50
  ): Promise<{ transactions: PublicTransaction[]; total: number; page: number; limit: number }> {
    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
    const users = await User.find({ householdId: new Types.ObjectId(householdId) });
    const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

    // Identify visible buckets for query filter
    const viewerOwnedBucketIds = buckets
      .filter((b) => b.ownerId.toString() === viewerId)
      .map((b) => b._id);
    const sharedBucketIds = buckets
      .filter((b) => b.ownerId.toString() !== viewerId && b.visibility === 'shared')
      .map((b) => b._id);

    const allowedBucketIds = [...viewerOwnedBucketIds, ...sharedBucketIds];

    // Database query level privacy filter
    const queryFilter: Record<string, unknown> = {
      householdId: new Types.ObjectId(householdId),
      $or: [
        { createdBy: new Types.ObjectId(viewerId) },
        { fromBucketId: { $in: allowedBucketIds } },
        { toBucketId: { $in: allowedBucketIds } },
      ],
    };

    const skip = (page - 1) * limit;
    const [rawTransactions, total] = await Promise.all([
      Transaction.find(queryFilter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit),
      Transaction.countDocuments(queryFilter),
    ]);

    const mappedTransactions: PublicTransaction[] = [];
    for (const tx of rawTransactions) {
      const mapped = mapTransactionForViewer(tx, viewerId, householdId, bucketsMap, usersMap);
      if (mapped) {
        mappedTransactions.push(mapped);
      }
    }

    return {
      transactions: mappedTransactions,
      total,
      page,
      limit,
    };
  }

  /**
   * Retrieves a single transaction by ID, applying privacy checks.
   * Returns 404 if the transaction is hidden from the partner.
   */
  static async getTransactionById(
    transactionId: string,
    householdId: string,
    viewerId: string
  ): Promise<PublicTransaction> {
    if (!Types.ObjectId.isValid(transactionId)) {
      throw new NotFoundError('Transaction not found');
    }

    const tx = await Transaction.findById(transactionId);
    if (!tx || tx.householdId.toString() !== householdId) {
      throw new NotFoundError('Transaction not found');
    }

    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
    const users = await User.find({ householdId: new Types.ObjectId(householdId) });
    const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

    const mapped = mapTransactionForViewer(tx, viewerId, householdId, bucketsMap, usersMap);
    if (!mapped) {
      // Privacy invariant: Hidden transaction returns 404 (never 403)
      throw new NotFoundError('Transaction not found');
    }

    return mapped;
  }

  /**
   * Reconciles all bucket balances in the household.
   * Recomputes every bucket's balance strictly from the active transactions (and reversals)
   * in the immutable ledger, and reports any discrepancy with the stored bucket balance.
   */
  static async reconcile(householdId: string): Promise<{
    matches: boolean;
    totalBuckets: number;
    mismatches: Array<{
      bucketId: string;
      bucketName: string;
      storedBalance: number;
      recomputedBalance: number;
      discrepancyPaise: number;
    }>;
  }> {
    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    // In our immutable append-only ledger, voided transactions are negated by their active reversal counterparts.
    // Querying all ledger transactions guarantees an accurate mathematical reconstruction of each bucket balance.
    const allTransactions = await Transaction.find({
      householdId: new Types.ObjectId(householdId),
    });

    const calculatedBalances = new Map<string, number>();
    for (const b of buckets) {
      calculatedBalances.set(b._id.toString(), 0);
    }

    for (const tx of allTransactions) {
      if (tx.type === 'income' && tx.toBucketId) {
        const id = tx.toBucketId.toString();
        calculatedBalances.set(id, (calculatedBalances.get(id) || 0) + tx.amount);
      } else if (tx.type === 'expense' && tx.fromBucketId) {
        const id = tx.fromBucketId.toString();
        calculatedBalances.set(id, (calculatedBalances.get(id) || 0) - tx.amount);
      } else if (tx.type === 'transfer' && tx.fromBucketId && tx.toBucketId) {
        const fromId = tx.fromBucketId.toString();
        const toId = tx.toBucketId.toString();
        calculatedBalances.set(fromId, (calculatedBalances.get(fromId) || 0) - tx.amount);
        calculatedBalances.set(toId, (calculatedBalances.get(toId) || 0) + tx.amount);
      } else if (tx.type === 'adjustment') {
        if (tx.toBucketId) {
          const id = tx.toBucketId.toString();
          calculatedBalances.set(id, (calculatedBalances.get(id) || 0) + tx.amount);
        } else if (tx.fromBucketId) {
          const id = tx.fromBucketId.toString();
          calculatedBalances.set(id, (calculatedBalances.get(id) || 0) - tx.amount);
        }
      }
    }

    const mismatches: Array<{
      bucketId: string;
      bucketName: string;
      storedBalance: number;
      recomputedBalance: number;
      discrepancyPaise: number;
    }> = [];

    for (const b of buckets) {
      const recomputed = calculatedBalances.get(b._id.toString()) || 0;
      if (recomputed !== b.balance) {
        mismatches.push({
          bucketId: b._id.toString(),
          bucketName: b.name,
          storedBalance: b.balance,
          recomputedBalance: recomputed,
          discrepancyPaise: b.balance - recomputed,
        });
      }
    }

    return {
      matches: mismatches.length === 0,
      totalBuckets: buckets.length,
      mismatches,
    };
  }
}
