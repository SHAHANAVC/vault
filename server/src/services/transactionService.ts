import { Types, ClientSession } from 'mongoose';
import {
  TransactionInput,
  PublicTransaction,
  SplitIncomeInput,
  SplitTransferInput,
  AdjustmentInput,
  PublicTransactionGroup,
  TransactionQueryInput,
  MonthSummaryResponse,
  CategoryBreakdownResponse,
  CategoryBreakdownItem,
  TrendResponse,
  TrendMonthItem,
  DashboardResponse,
  PaginatedTransactionsResponse,
  formatINR,
} from '@vault/shared';
import { BucketService } from './bucketService';
import { PlanService } from './planService';
import {
  getCurrentISTYearMonth,
  getISTMonthDateRange,
  getPastNMonthsIST,
  escapeRegex,
} from '../utils/dateUtils';
import { Transaction, ITransaction } from '../models/Transaction';
import { Bucket, IBucket } from '../models/Bucket';
import { User } from '../models/User';
import { Plan } from '../models/Plan';
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
  public static async atomicDebit(
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
  public static async atomicCredit(
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
        if (tx.loanAction === 'borrow') {
          // Borrow: toBucketId (cash) was credited, fromBucketId (loan_taken) was credited
          // Reversal: debit cash (cannot go negative) and debit loan_taken
          await this.atomicDebit(tx.toBucketId, householdId, tx.amount, session);
          await this.atomicDebit(tx.fromBucketId, householdId, tx.amount, session);
        } else if (tx.loanAction === 'repay') {
          // Repay: fromBucketId (cash) was debited, toBucketId (loan_taken) was debited
          // Reversal: credit cash and credit loan_taken
          await this.atomicCredit(tx.fromBucketId, householdId, tx.amount, session);
          await this.atomicCredit(tx.toBucketId, householdId, tx.amount, session);
        } else {
          // Regular transfer, lend, or receive_repayment:
          // Transfer debited fromBucketId & credited toBucketId ->
          // Reversal must DEBIT toBucketId & CREDIT fromBucketId
          await this.atomicDebit(tx.toBucketId, householdId, tx.amount, session);
          await this.atomicCredit(tx.fromBucketId, householdId, tx.amount, session);
        }

        const reversalTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'transfer',
          amount: tx.amount,
          fromBucketId: tx.toBucketId,
          toBucketId: tx.fromBucketId,
          purpose: `Reversal of voided ${tx.loanAction || 'transfer'} ${tx._id}`,
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

      // If this transaction was linked to an active/completed Plan, roll back plan state
      if (tx.planId) {
        const plan = await Plan.findById(tx.planId).session(session || null);
        if (plan) {
          if (tx.installmentNumber !== undefined && tx.installmentNumber !== null) {
            // Installment payment rollback
            plan.paidAmount = Math.max(0, plan.paidAmount - tx.amount);
            plan.paidInstallments = Math.max(0, plan.paidInstallments - 1);
            if (plan.status === 'completed') {
              plan.status = 'active';
              plan.completedAt = undefined;
            }
          } else if (tx.category === 'Scheme bonus') {
            // Gold scheme bonus rollback
            plan.bonusRecorded = false;
            if (plan.status === 'completed') {
              plan.status = 'active';
              plan.completedAt = undefined;
            }
          } else if (tx.category === 'Jewellery' || tx.category === 'Gold Scheme Refund') {
            // Gold scheme redemption rollback
            plan.redeemRecorded = false;
            plan.redeemOption = undefined;
            if (plan.status === 'completed') {
              plan.status = 'active';
              plan.completedAt = undefined;
            }
          } else if (tx.category === 'Kuri Payout') {
            // Kuri payout rollback
            plan.payoutRecorded = false;
            if (plan.status === 'completed') {
              plan.status = 'active';
              plan.completedAt = undefined;
            }
          }
          await plan.save({ session });
        }
      }

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
   * Updates an existing transaction.
   * - If only metadata (category, purpose, date) is edited, updates the entry directly.
   * - If financial amounts or accounts are changed, executes an atomic rollback & replacement
   *   inside a MongoDB transaction to preserve audit trails and avoid bucket corruption.
   * Creator-only privilege enforced.
   */
  static async updateTransaction(
    transactionId: string,
    householdId: string,
    viewerId: string,
    input: {
      amount?: number;
      category?: string;
      purpose?: string;
      date?: string;
      fromBucketId?: string;
      toBucketId?: string;
    }
  ): Promise<PublicTransaction> {
    if (!Types.ObjectId.isValid(transactionId)) {
      throw new NotFoundError('Transaction not found');
    }

    const tx = await Transaction.findById(transactionId);
    if (!tx || tx.householdId.toString() !== householdId) {
      throw new NotFoundError('Transaction not found');
    }

    if (tx.createdBy.toString() !== viewerId) {
      throw new ForbiddenError('Only the creator can edit this transaction');
    }

    if (tx.status === 'voided') {
      throw new BadRequestError('Cannot edit a voided transaction');
    }

    const isFinancialChange =
      (input.amount !== undefined && input.amount !== tx.amount) ||
      (input.fromBucketId !== undefined && input.fromBucketId !== tx.fromBucketId?.toString()) ||
      (input.toBucketId !== undefined && input.toBucketId !== tx.toBucketId?.toString());

    if (!isFinancialChange) {
      if (input.category) tx.category = input.category;
      if (input.purpose !== undefined) tx.purpose = input.purpose;
      if (input.date) tx.date = new Date(input.date);
      await tx.save();

      const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
      const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
      const users = await User.find({ householdId: new Types.ObjectId(householdId) });
      const usersMap = new Map(users.map((u) => [u._id.toString(), u]));
      const publicTx = mapTransactionForViewer(tx, viewerId, householdId, bucketsMap, usersMap);
      if (!publicTx) throw new Error('Failed to map updated transaction');
      return publicTx;
    }

    return runInTransaction(async (session) => {
      // 1. Revert previous balance movement
      if (tx.type === 'income' && tx.toBucketId) {
        await this.atomicDebit(tx.toBucketId, householdId, tx.amount, session);
      } else if (tx.type === 'expense' && tx.fromBucketId) {
        await this.atomicCredit(tx.fromBucketId, householdId, tx.amount, session);
      } else if (tx.type === 'transfer' && tx.fromBucketId && tx.toBucketId) {
        await this.atomicDebit(tx.toBucketId, householdId, tx.amount, session);
        await this.atomicCredit(tx.fromBucketId, householdId, tx.amount, session);
      }

      // Mark old tx as voided
      tx.status = 'voided';
      tx.voidedBy = new Types.ObjectId(viewerId);
      tx.voidedAt = new Date();
      await tx.save({ session });

      // 2. Prepare new fields
      const newAmount = input.amount !== undefined ? input.amount : tx.amount;
      const newFromBucketId = input.fromBucketId ? new Types.ObjectId(input.fromBucketId) : tx.fromBucketId;
      const newToBucketId = input.toBucketId ? new Types.ObjectId(input.toBucketId) : tx.toBucketId;
      const newCategory = input.category || tx.category;
      const newPurpose = input.purpose !== undefined ? input.purpose : tx.purpose;
      const newDate = input.date ? new Date(input.date) : tx.date;

      // 3. Apply new balance movement
      if (tx.type === 'income' && newToBucketId) {
        await this.atomicCredit(newToBucketId, householdId, newAmount, session);
      } else if (tx.type === 'expense' && newFromBucketId) {
        await this.atomicDebit(newFromBucketId, householdId, newAmount, session);
      } else if (tx.type === 'transfer' && newFromBucketId && newToBucketId) {
        await this.atomicDebit(newFromBucketId, householdId, newAmount, session);
        await this.atomicCredit(newToBucketId, householdId, newAmount, session);
      }

      // 4. Create updated replacement transaction
      const newTx = new Transaction({
        householdId: new Types.ObjectId(householdId),
        type: tx.type,
        amount: newAmount,
        fromBucketId: newFromBucketId,
        toBucketId: newToBucketId,
        category: newCategory,
        purpose: newPurpose,
        date: newDate,
        createdBy: new Types.ObjectId(viewerId),
        status: 'active',
        reversalOf: tx._id,
      });
      await newTx.save({ session });

      const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
      const users = await User.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

      const publicTx = mapTransactionForViewer(newTx, viewerId, householdId, bucketsMap, usersMap);
      if (!publicTx) throw new Error('Failed to map updated transaction');
      return publicTx;
    });
  }

  /**
   * Retrieves transactions for the household, filtered by the viewer's privacy permissions,
   * with combinable filters, search, and stable pagination (date: -1, _id: -1).
   * Grouped split entries come back as one item with a lines count.
   */
  static async getTransactions(
    householdId: string,
    viewerId: string,
    queryOrPage: TransactionQueryInput | number = 1,
    legacyLimit = 50
  ): Promise<PaginatedTransactionsResponse> {
    const query: TransactionQueryInput =
      typeof queryOrPage === 'number'
        ? { page: queryOrPage, limit: legacyLimit, sort: 'date_desc', includeVoided: true }
        : queryOrPage;

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
    const conditions: Record<string, unknown>[] = [
      { householdId: new Types.ObjectId(householdId) },
      {
        $or: [
          { createdBy: new Types.ObjectId(viewerId) },
          { fromBucketId: { $in: allowedBucketIds } },
          { toBucketId: { $in: allowedBucketIds } },
        ],
      },
    ];

    // Include/exclude voided transactions
    if (!query.includeVoided) {
      conditions.push({ status: { $ne: 'voided' } });
    }

    // Bucket ID filter
    if (query.bucketId && Types.ObjectId.isValid(query.bucketId)) {
      const bId = new Types.ObjectId(query.bucketId);
      conditions.push({
        $or: [{ fromBucketId: bId }, { toBucketId: bId }],
      });
    }

    // Transaction Type filter
    if (query.type) {
      conditions.push({ type: query.type });
    }

    // Category filter
    if (query.category) {
      conditions.push({
        category: new RegExp(`^${escapeRegex(query.category)}$`, 'i'),
      });
    }

    // CreatedBy filter: 'me', 'partner', or specific user ID
    if (query.createdBy === 'me') {
      conditions.push({ createdBy: new Types.ObjectId(viewerId) });
    } else if (query.createdBy === 'partner') {
      conditions.push({ createdBy: { $ne: new Types.ObjectId(viewerId) } });
    } else if (query.createdBy && Types.ObjectId.isValid(query.createdBy)) {
      conditions.push({ createdBy: new Types.ObjectId(query.createdBy) });
    }

    // Date range filter
    if (query.fromDate || query.toDate) {
      const dateFilter: Record<string, unknown> = {};
      if (query.fromDate) dateFilter.$gte = new Date(query.fromDate);
      if (query.toDate) dateFilter.$lte = new Date(query.toDate);
      conditions.push({ date: dateFilter });
    }

    // Amount range filter (paise)
    if (query.minAmount !== undefined || query.maxAmount !== undefined) {
      const amountFilter: Record<string, unknown> = {};
      if (query.minAmount !== undefined) amountFilter.$gte = query.minAmount;
      if (query.maxAmount !== undefined) amountFilter.$lte = query.maxAmount;
      conditions.push({ amount: amountFilter });
    }

    // Search filter (purpose, category, reason) - case-insensitive, regex-escaped
    if (query.search?.trim()) {
      const searchRegex = new RegExp(escapeRegex(query.search.trim()), 'i');
      conditions.push({
        $or: [
          { purpose: searchRegex },
          { category: searchRegex },
          { reason: searchRegex },
        ],
      });
    }

    const finalQuery = conditions.length === 1 ? conditions[0] : { $and: conditions };

    // Stable Sort (date desc, _id desc)
    let sortObj: Record<string, 1 | -1> = { date: -1, _id: -1 };
    if (query.sort === 'date_asc') sortObj = { date: 1, _id: 1 };
    if (query.sort === 'amount_desc') sortObj = { amount: -1, _id: -1 };
    if (query.sort === 'amount_asc') sortObj = { amount: 1, _id: 1 };

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 50) : 20;
    const skip = (page - 1) * limit;

    const [rawTransactions, total] = await Promise.all([
      Transaction.find(finalQuery).sort(sortObj).skip(skip).limit(limit),
      Transaction.countDocuments(finalQuery),
    ]);

    // Map through privacy policy
    const mappedTransactions: PublicTransaction[] = [];
    const groupedMap = new Map<string, PublicTransaction[]>();

    for (const tx of rawTransactions) {
      const mapped = mapTransactionForViewer(tx, viewerId, householdId, bucketsMap, usersMap);
      if (!mapped) continue;

      if (!mapped.groupId || mapped.groupId.startsWith('reversal_')) {
        mappedTransactions.push(mapped);
      } else {
        if (!groupedMap.has(mapped.groupId)) {
          groupedMap.set(mapped.groupId, []);
        }
        groupedMap.get(mapped.groupId)!.push(mapped);
      }
    }

    // If query has specific bucketId filter, keep individual lines
    if (query.bucketId) {
      for (const lines of groupedMap.values()) {
        mappedTransactions.push(...lines);
      }
    } else {
      // Otherwise, collapse grouped transactions into single item with linesCount
      for (const lines of groupedMap.values()) {
        const first = lines[0];
        if (!first) continue;
        if (lines.length === 1) {
          mappedTransactions.push({
            ...first,
            linesCount: 1,
          });
        } else {
          const visibleTotal = lines.reduce((sum, l) => sum + (l.isMasked ? 0 : l.amount), 0);
          mappedTransactions.push({
            ...first,
            amount: visibleTotal,
            linesCount: lines.length,
            isGroupParent: true,
            groupSummary: `${lines.length} allocations totaling ${formatINR(visibleTotal)}`,
          });
        }
      }
    }

    // Re-sort according to requested sort direction
    mappedTransactions.sort((a, b) => {
      if (query.sort === 'date_asc') {
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      }
      if (query.sort === 'amount_desc') {
        return b.amount - a.amount;
      }
      if (query.sort === 'amount_asc') {
        return a.amount - b.amount;
      }
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    const totalPages = Math.ceil(total / limit) || 1;
    const hasMore = page < totalPages;

    return {
      transactions: mappedTransactions,
      total,
      page,
      limit,
      totalPages,
      hasMore,
    };
  }

  /**
   * Generates financial summary for the specified month (Asia/Kolkata IST):
   * totalIncome, totalExpense, and netSavings in integer paise.
   * Excludes voided/reversals, transfers, adjustments, and opening balances.
   */
  static async getMonthSummary(
    householdId: string,
    viewerId: string,
    monthStr?: string
  ): Promise<MonthSummaryResponse> {
    const ym = monthStr && /^\d{4}-\d{2}$/.test(monthStr) ? monthStr : getCurrentISTYearMonth();
    const { start, end } = getISTMonthDateRange(ym);

    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    const viewerOwnedBucketIds = buckets
      .filter((b) => b.ownerId.toString() === viewerId)
      .map((b) => b._id);
    const sharedBucketIds = buckets
      .filter((b) => b.ownerId.toString() !== viewerId && b.visibility === 'shared')
      .map((b) => b._id);

    const accessibleBucketIds = [...viewerOwnedBucketIds, ...sharedBucketIds];
    const openingBalanceRegex = /^opening balance$/i;

    const [incomeAgg, expenseAgg] = await Promise.all([
      Transaction.aggregate([
        {
          $match: {
            householdId: new Types.ObjectId(householdId),
            type: 'income',
            status: { $ne: 'voided' },
            reversalOf: { $exists: false },
            category: { $not: openingBalanceRegex },
            purpose: { $not: openingBalanceRegex },
            date: { $gte: start, $lt: end },
            toBucketId: { $in: accessibleBucketIds },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
          },
        },
      ]),
      Transaction.aggregate([
        {
          $match: {
            householdId: new Types.ObjectId(householdId),
            type: 'expense',
            status: { $ne: 'voided' },
            reversalOf: { $exists: false },
            category: { $not: openingBalanceRegex },
            purpose: { $not: openingBalanceRegex },
            date: { $gte: start, $lt: end },
            fromBucketId: { $in: accessibleBucketIds },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
          },
        },
      ]),
    ]);

    const totalIncome = incomeAgg[0]?.total || 0;
    const totalExpense = expenseAgg[0]?.total || 0;
    const netSavings = totalIncome - totalExpense;

    return {
      totalIncome,
      totalExpense,
      netSavings,
    };
  }

  /**
   * Generates expense breakdown by category for the specified month (Asia/Kolkata IST).
   * Returns top categories plus 'Other'.
   */
  static async getCategoryBreakdown(
    householdId: string,
    viewerId: string,
    monthStr?: string
  ): Promise<CategoryBreakdownResponse> {
    const ym = monthStr && /^\d{4}-\d{2}$/.test(monthStr) ? monthStr : getCurrentISTYearMonth();
    const { start, end } = getISTMonthDateRange(ym);

    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    const viewerOwnedBucketIds = buckets
      .filter((b) => b.ownerId.toString() === viewerId)
      .map((b) => b._id);
    const sharedBucketIds = buckets
      .filter((b) => b.ownerId.toString() !== viewerId && b.visibility === 'shared')
      .map((b) => b._id);

    const accessibleBucketIds = [...viewerOwnedBucketIds, ...sharedBucketIds];
    const openingBalanceRegex = /^opening balance$/i;

    const categoryAgg = await Transaction.aggregate([
      {
        $match: {
          householdId: new Types.ObjectId(householdId),
          type: 'expense',
          status: { $ne: 'voided' },
          reversalOf: { $exists: false },
          category: { $not: openingBalanceRegex },
          purpose: { $not: openingBalanceRegex },
          date: { $gte: start, $lt: end },
          fromBucketId: { $in: accessibleBucketIds },
        },
      },
      {
        $group: {
          _id: { $ifNull: ['$category', 'Miscellaneous'] },
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { amount: -1 } },
    ]);

    const totalExpense = categoryAgg.reduce((sum, item) => sum + item.amount, 0);

    const topN = 5;
    const items: CategoryBreakdownItem[] = [];
    let otherAmount = 0;

    for (let i = 0; i < categoryAgg.length; i++) {
      const cat = categoryAgg[i]._id || 'Miscellaneous';
      const amt = categoryAgg[i].amount;
      if (i < topN) {
        items.push({
          category: cat,
          amount: amt,
          percentage: totalExpense > 0 ? Math.round((amt / totalExpense) * 100) : 0,
        });
      } else {
        otherAmount += amt;
      }
    }

    if (otherAmount > 0) {
      items.push({
        category: 'Other',
        amount: otherAmount,
        percentage: totalExpense > 0 ? Math.round((otherAmount / totalExpense) * 100) : 0,
      });
    }

    return { items, totalExpense };
  }

  /**
   * Generates 6-month (or N-month) income vs expense trend in Asia/Kolkata (IST).
   * Zero-filled for empty months in chronological order.
   */
  static async getTrend(
    householdId: string,
    viewerId: string,
    monthsCount = 6
  ): Promise<TrendResponse> {
    const validMonthsCount = Math.max(1, Math.min(monthsCount, 12));
    const monthsList = getPastNMonthsIST(validMonthsCount);

    const earliestMonth = monthsList[0] || getCurrentISTYearMonth();
    const latestMonth = monthsList[monthsList.length - 1] || earliestMonth;
    const { start } = getISTMonthDateRange(earliestMonth);
    const { end } = getISTMonthDateRange(latestMonth);

    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    const viewerOwnedBucketIds = buckets
      .filter((b) => b.ownerId.toString() === viewerId)
      .map((b) => b._id);
    const sharedBucketIds = buckets
      .filter((b) => b.ownerId.toString() !== viewerId && b.visibility === 'shared')
      .map((b) => b._id);

    const accessibleBucketIds = [...viewerOwnedBucketIds, ...sharedBucketIds];
    const openingBalanceRegex = /^opening balance$/i;

    const [incomeByMonth, expenseByMonth] = await Promise.all([
      Transaction.aggregate([
        {
          $match: {
            householdId: new Types.ObjectId(householdId),
            type: 'income',
            status: { $ne: 'voided' },
            reversalOf: { $exists: false },
            category: { $not: openingBalanceRegex },
            purpose: { $not: openingBalanceRegex },
            date: { $gte: start, $lt: end },
            toBucketId: { $in: accessibleBucketIds },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$date', timezone: '+05:30' } },
            total: { $sum: '$amount' },
          },
        },
      ]),
      Transaction.aggregate([
        {
          $match: {
            householdId: new Types.ObjectId(householdId),
            type: 'expense',
            status: { $ne: 'voided' },
            reversalOf: { $exists: false },
            category: { $not: openingBalanceRegex },
            purpose: { $not: openingBalanceRegex },
            date: { $gte: start, $lt: end },
            fromBucketId: { $in: accessibleBucketIds },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$date', timezone: '+05:30' } },
            total: { $sum: '$amount' },
          },
        },
      ]),
    ]);

    const incomeMap = new Map<string, number>(incomeByMonth.map((r) => [r._id, r.total]));
    const expenseMap = new Map<string, number>(expenseByMonth.map((r) => [r._id, r.total]));

    const items: TrendMonthItem[] = monthsList.map((ym) => {
      const inc = incomeMap.get(ym) || 0;
      const exp = expenseMap.get(ym) || 0;
      return {
        month: ym,
        income: inc,
        expense: exp,
        netSavings: inc - exp,
      };
    });

    return { items };
  }

  /**
   * Consolidated Household Dashboard endpoint.
   * Single roundtrip returns buckets, totals, monthly summary, recent 5 transactions, and alerts.
   */
  static async getDashboard(
    householdId: string,
    viewerId: string,
    monthStr?: string
  ): Promise<DashboardResponse> {
    const [summary, bucketCards, monthSummary, recentTxsRes, alertsData] = await Promise.all([
      BucketService.getSummary(householdId, viewerId),
      BucketService.getBuckets(householdId, viewerId),
      this.getMonthSummary(householdId, viewerId, monthStr),
      this.getTransactions(householdId, viewerId, { page: 1, limit: 5 }),
      PlanService.getAlerts(householdId, viewerId),
    ]);

    const alertSummaries = alertsData.alerts
      .filter((a) => !a.isDismissedToday)
      .map((a) => {
        if (a.isMasked) {
          return `${a.planName} (${a.kind.toUpperCase()}): Due on ${new Date(a.dueDate).toLocaleDateString('en-IN')}`;
        }
        if (a.isShortfall && a.shortfallAmount) {
          return `${a.status === 'overdue' ? 'OVERDUE: ' : ''}${a.planName} (${formatINR(a.amountDue)}). ${a.payFromBucketName} has ${formatINR(a.bucketBalance || 0)}, short by ${formatINR(a.shortfallAmount)}`;
        }
        return `${a.status === 'overdue' ? 'OVERDUE: ' : ''}${a.planName} due on ${new Date(a.dueDate).toLocaleDateString('en-IN')} (${formatINR(a.amountDue)})`;
      });

    return {
      householdTotal: summary.householdTotal,
      myTotal: summary.myTotal,
      buckets: bucketCards,
      monthSummary,
      recentTransactions: recentTxsRes.transactions,
      alerts: alertSummaries,
      planAlerts: alertsData.alerts,
      shortfalls: alertsData.shortfalls,
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
