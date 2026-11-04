import { Types, ClientSession } from 'mongoose';
import {
  LendLoanInput,
  ReceiveRepaymentLoanInput,
  BorrowLoanInput,
  RepayLoanInput,
  PublicTransaction,
  LoansSummaryResponse,
  LoanAlert,
  calculatePartyBalance,
  formatINR,
} from '@vault/shared';
import { Party } from '../models/Party';
import { Bucket, IBucket } from '../models/Bucket';
import { Transaction } from '../models/Transaction';
import { User } from '../models/User';
import { LoanDismissal } from '../models/LoanDismissal';
import { runInTransaction } from '../utils/transactionRunner';
import { NotFoundError, ForbiddenError, BadRequestError } from '../utils/errors';
import { getCurrentISTDateString } from '../utils/dateUtils';
import { TransactionService } from './transactionService';
import { mapTransactionForViewer } from './transactionPrivacyPolicy';
import { PartyService } from './partyService';

export class LoanService {
  /**
   * Retrieves or automatically provisions the single canonical loan bucket for an owner.
   * - type === 'loan_given': "Loans Given (Receivables)" - Asset
   * - type === 'loan_taken': "Loans Taken (Payables)" - Liability
   * Created automatically on first use with visibility: 'shared', balance: 0.
   */
  static async getOrCreateLoanBucket(
    householdId: string,
    ownerId: string,
    type: 'loan_given' | 'loan_taken',
    session?: ClientSession
  ): Promise<IBucket> {
    const existing = await Bucket.findOne({
      householdId: new Types.ObjectId(householdId),
      ownerId: new Types.ObjectId(ownerId),
      type,
      isArchived: false,
    }).session(session || null);

    if (existing) {
      return existing;
    }

    const bucket = new Bucket({
      householdId: new Types.ObjectId(householdId),
      ownerId: new Types.ObjectId(ownerId),
      name: type === 'loan_given' ? 'Loans Given (Receivables)' : 'Loans Taken (Payables)',
      type,
      visibility: 'shared',
      balance: 0,
      isArchived: false,
    });

    await bucket.save({ session });
    return bucket;
  }

  /**
   * Helper to verify if viewer has spending/withdrawal rights from a paying bucket.
   */
  private static verifySpendingRights(bucket: IBucket, viewerId: string): void {
    if (bucket.isArchived) {
      throw new BadRequestError(`Archived bucket ("${bucket.name}") cannot participate in transactions`);
    }

    const isOwner = bucket.ownerId.toString() === viewerId;
    if (!isOwner) {
      if (bucket.visibility !== 'shared') {
        throw new ForbiddenError(`You do not have permission to spend from "${bucket.name}"`);
      }
    }
  }

  /**
   * Lends money to a party.
   * Decreases cash/bank (cannot go below 0). Increases loan_given bucket.
   */
  static async lend(
    householdId: string,
    viewerId: string,
    input: LendLoanInput
  ): Promise<PublicTransaction> {
    if (!Types.ObjectId.isValid(input.partyId)) {
      throw new NotFoundError('Party not found');
    }

    // Idempotency check
    if (input.idempotencyKey) {
      const existing = await Transaction.findOne({
        householdId: new Types.ObjectId(householdId),
        idempotencyKey: input.idempotencyKey,
      });
      if (existing) {
        return TransactionService.getTransactionById(existing._id.toString(), householdId, viewerId);
      }
    }

    const party = await Party.findById(input.partyId);
    if (!party || party.householdId.toString() !== householdId || party.isArchived) {
      throw new NotFoundError('Party not found');
    }

    // Partner cannot lend on behalf of party; view-only
    if (party.ownerId.toString() !== viewerId) {
      if (party.visibility === 'private') {
        throw new NotFoundError('Party not found');
      }
      throw new ForbiddenError('Only the party owner can lend to this party');
    }

    const fromBucket = await Bucket.findById(input.fromBucketId);
    if (!fromBucket || fromBucket.householdId.toString() !== householdId) {
      throw new NotFoundError('Source bucket not found');
    }
    this.verifySpendingRights(fromBucket, viewerId);

    return runInTransaction(async (session) => {
      // Auto-provision or get canonical loan_given bucket
      const loanBucket = await this.getOrCreateLoanBucket(householdId, viewerId, 'loan_given', session);

      // Debit cash/bank (cannot go negative)
      await TransactionService.atomicDebit(
        new Types.ObjectId(input.fromBucketId),
        householdId,
        input.amount,
        session
      );

      // Credit loan_given bucket
      await TransactionService.atomicCredit(
        loanBucket._id,
        householdId,
        input.amount,
        session
      );

      const tx = new Transaction({
        householdId: new Types.ObjectId(householdId),
        type: 'transfer',
        amount: input.amount,
        fromBucketId: new Types.ObjectId(input.fromBucketId),
        toBucketId: loanBucket._id,
        partyId: party._id,
        loanAction: 'lend',
        purpose: input.purpose || `Loan given to ${party.name}`,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
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

      const mapped = mapTransactionForViewer(tx, viewerId, householdId, bucketsMap, usersMap);
      if (!mapped) throw new Error('Failed to map created lend transaction');
      return mapped;
    });
  }

  /**
   * Receives repayment for money previously lent.
   * Decreases loan_given bucket. Increases cash/bank.
   * Rejects if repayment exceeds party's outstanding loan_given balance.
   */
  static async receiveRepayment(
    householdId: string,
    viewerId: string,
    input: ReceiveRepaymentLoanInput
  ): Promise<PublicTransaction> {
    if (!Types.ObjectId.isValid(input.partyId)) {
      throw new NotFoundError('Party not found');
    }

    if (input.idempotencyKey) {
      const existing = await Transaction.findOne({
        householdId: new Types.ObjectId(householdId),
        idempotencyKey: input.idempotencyKey,
      });
      if (existing) {
        return TransactionService.getTransactionById(existing._id.toString(), householdId, viewerId);
      }
    }

    const party = await Party.findById(input.partyId);
    if (!party || party.householdId.toString() !== householdId || party.isArchived) {
      throw new NotFoundError('Party not found');
    }

    if (party.ownerId.toString() !== viewerId) {
      if (party.visibility === 'private') {
        throw new NotFoundError('Party not found');
      }
      throw new ForbiddenError('Only the party owner can receive repayments for this party');
    }

    const toBucket = await Bucket.findById(input.toBucketId);
    if (!toBucket || toBucket.householdId.toString() !== householdId) {
      throw new NotFoundError('Destination bucket not found');
    }
    if (toBucket.isArchived) {
      throw new BadRequestError(`Cannot deposit into archived bucket ("${toBucket.name}")`);
    }

    // Verify overpayment against active party entries
    const partyTxs = await Transaction.find({
      householdId: new Types.ObjectId(householdId),
      partyId: party._id,
      status: { $ne: 'voided' },
    });

    const partyBalance = calculatePartyBalance(
      partyTxs.map((tx) => ({
        loanAction: tx.loanAction,
        amount: tx.amount,
        status: tx.status,
      }))
    );

    if (input.amount > partyBalance.loanGivenOutstanding) {
      throw new BadRequestError(
        `Repayment amount (${formatINR(input.amount)}) cannot exceed outstanding loan given balance (${formatINR(partyBalance.loanGivenOutstanding)}). Remaining amount is ${formatINR(partyBalance.loanGivenOutstanding)}.`
      );
    }

    return runInTransaction(async (session) => {
      const loanBucket = await this.getOrCreateLoanBucket(householdId, viewerId, 'loan_given', session);

      // Debit loan_given bucket
      await TransactionService.atomicDebit(
        loanBucket._id,
        householdId,
        input.amount,
        session
      );

      // Credit destination cash/bank bucket
      await TransactionService.atomicCredit(
        new Types.ObjectId(input.toBucketId),
        householdId,
        input.amount,
        session
      );

      const tx = new Transaction({
        householdId: new Types.ObjectId(householdId),
        type: 'transfer',
        amount: input.amount,
        fromBucketId: loanBucket._id,
        toBucketId: new Types.ObjectId(input.toBucketId),
        partyId: party._id,
        loanAction: 'receive_repayment',
        purpose: input.purpose || `Repayment from ${party.name}`,
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

      const mapped = mapTransactionForViewer(tx, viewerId, householdId, bucketsMap, usersMap);
      if (!mapped) throw new Error('Failed to map created receive repayment transaction');
      return mapped;
    });
  }

  /**
   * Borrows money from a party.
   * Increases cash/bank. Increases loan_taken bucket balance.
   */
  static async borrow(
    householdId: string,
    viewerId: string,
    input: BorrowLoanInput
  ): Promise<PublicTransaction> {
    if (!Types.ObjectId.isValid(input.partyId)) {
      throw new NotFoundError('Party not found');
    }

    if (input.idempotencyKey) {
      const existing = await Transaction.findOne({
        householdId: new Types.ObjectId(householdId),
        idempotencyKey: input.idempotencyKey,
      });
      if (existing) {
        return TransactionService.getTransactionById(existing._id.toString(), householdId, viewerId);
      }
    }

    const party = await Party.findById(input.partyId);
    if (!party || party.householdId.toString() !== householdId || party.isArchived) {
      throw new NotFoundError('Party not found');
    }

    if (party.ownerId.toString() !== viewerId) {
      if (party.visibility === 'private') {
        throw new NotFoundError('Party not found');
      }
      throw new ForbiddenError('Only the party owner can borrow from this party');
    }

    const toBucket = await Bucket.findById(input.toBucketId);
    if (!toBucket || toBucket.householdId.toString() !== householdId) {
      throw new NotFoundError('Destination bucket not found');
    }
    if (toBucket.isArchived) {
      throw new BadRequestError(`Cannot deposit into archived bucket ("${toBucket.name}")`);
    }

    return runInTransaction(async (session) => {
      const loanBucket = await this.getOrCreateLoanBucket(householdId, viewerId, 'loan_taken', session);

      // Credit cash/bank where funds arrive
      await TransactionService.atomicCredit(
        new Types.ObjectId(input.toBucketId),
        householdId,
        input.amount,
        session
      );

      // Credit liability bucket (increases owed balance)
      await TransactionService.atomicCredit(
        loanBucket._id,
        householdId,
        input.amount,
        session
      );

      const tx = new Transaction({
        householdId: new Types.ObjectId(householdId),
        type: 'transfer',
        amount: input.amount,
        fromBucketId: loanBucket._id,
        toBucketId: new Types.ObjectId(input.toBucketId),
        partyId: party._id,
        loanAction: 'borrow',
        purpose: input.purpose || `Loan borrowed from ${party.name}`,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
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

      const mapped = mapTransactionForViewer(tx, viewerId, householdId, bucketsMap, usersMap);
      if (!mapped) throw new Error('Failed to map created borrow transaction');
      return mapped;
    });
  }

  /**
   * Repays money borrowed from a party.
   * Decreases cash/bank (cannot go below 0). Decreases loan_taken bucket.
   * Rejects if repayment exceeds party's outstanding loan_taken balance.
   */
  static async repay(
    householdId: string,
    viewerId: string,
    input: RepayLoanInput
  ): Promise<PublicTransaction> {
    if (!Types.ObjectId.isValid(input.partyId)) {
      throw new NotFoundError('Party not found');
    }

    if (input.idempotencyKey) {
      const existing = await Transaction.findOne({
        householdId: new Types.ObjectId(householdId),
        idempotencyKey: input.idempotencyKey,
      });
      if (existing) {
        return TransactionService.getTransactionById(existing._id.toString(), householdId, viewerId);
      }
    }

    const party = await Party.findById(input.partyId);
    if (!party || party.householdId.toString() !== householdId || party.isArchived) {
      throw new NotFoundError('Party not found');
    }

    if (party.ownerId.toString() !== viewerId) {
      if (party.visibility === 'private') {
        throw new NotFoundError('Party not found');
      }
      throw new ForbiddenError('Only the party owner can repay loans to this party');
    }

    const fromBucket = await Bucket.findById(input.fromBucketId);
    if (!fromBucket || fromBucket.householdId.toString() !== householdId) {
      throw new NotFoundError('Paying bucket not found');
    }
    this.verifySpendingRights(fromBucket, viewerId);

    // Verify overpayment against active party entries
    const partyTxs = await Transaction.find({
      householdId: new Types.ObjectId(householdId),
      partyId: party._id,
      status: { $ne: 'voided' },
    });

    const partyBalance = calculatePartyBalance(
      partyTxs.map((tx) => ({
        loanAction: tx.loanAction,
        amount: tx.amount,
        status: tx.status,
      }))
    );

    if (input.amount > partyBalance.loanTakenOutstanding) {
      throw new BadRequestError(
        `Repayment amount (${formatINR(input.amount)}) cannot exceed outstanding loan taken balance (${formatINR(partyBalance.loanTakenOutstanding)}). Remaining amount is ${formatINR(partyBalance.loanTakenOutstanding)}.`
      );
    }

    return runInTransaction(async (session) => {
      const loanBucket = await this.getOrCreateLoanBucket(householdId, viewerId, 'loan_taken', session);

      // Debit cash/bank (cannot go negative)
      await TransactionService.atomicDebit(
        new Types.ObjectId(input.fromBucketId),
        householdId,
        input.amount,
        session
      );

      // Debit loan_taken bucket (decreases owed balance)
      await TransactionService.atomicDebit(
        loanBucket._id,
        householdId,
        input.amount,
        session
      );

      const tx = new Transaction({
        householdId: new Types.ObjectId(householdId),
        type: 'transfer',
        amount: input.amount,
        fromBucketId: new Types.ObjectId(input.fromBucketId),
        toBucketId: loanBucket._id,
        partyId: party._id,
        loanAction: 'repay',
        purpose: input.purpose || `Loan repayment to ${party.name}`,
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

      const mapped = mapTransactionForViewer(tx, viewerId, householdId, bucketsMap, usersMap);
      if (!mapped) throw new Error('Failed to map created repay transaction');
      return mapped;
    });
  }

  /**
   * Retrieves summary of all loans (receivables, payables, net) visible to the viewer.
   */
  static async getSummary(
    householdId: string,
    viewerId: string
  ): Promise<LoansSummaryResponse> {
    const parties = await PartyService.getParties(householdId, viewerId, false);

    let totalReceivable = 0;
    let totalPayable = 0;
    let activeReceivablesCount = 0;
    let activePayablesCount = 0;

    for (const p of parties) {
      if (p.loanGivenOutstanding > 0) {
        totalReceivable += p.loanGivenOutstanding;
        activeReceivablesCount++;
      }
      if (p.loanTakenOutstanding > 0) {
        totalPayable += p.loanTakenOutstanding;
        activePayablesCount++;
      }
    }

    return {
      totalReceivable,
      totalPayable,
      netBalance: totalReceivable - totalPayable,
      activeReceivablesCount,
      activePayablesCount,
    };
  }

  /**
   * Live alert engine for loans:
   * - Borrowed loans with dueDate: "due soon" / "due" / "overdue" alerts.
   * - Shortfall check: if paying bucket has less than amount due, trigger shortfall.
   * - Lent loans with dueDate: gentle reminder for money owed to me.
   * - Settled loans (outstanding = 0) produce NO alerts.
   * - Dismissals for today only are respected.
   */
  static async getAlerts(
    householdId: string,
    viewerId: string,
    currentDate: Date = new Date()
  ): Promise<LoanAlert[]> {
    const todayStr = getCurrentISTDateString(currentDate);
    const nowTime = currentDate.getTime();

    const parties = await PartyService.getParties(householdId, viewerId, false);
    const partyMap = new Map(parties.map((p) => [p.id, p]));

    // Fetch active loan transactions with dueDate
    const transactions = await Transaction.find({
      householdId: new Types.ObjectId(householdId),
      partyId: { $in: parties.map((p) => new Types.ObjectId(p.id)) },
      dueDate: { $ne: null },
      status: { $ne: 'voided' },
    });

    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));

    // Fetch dismissals for today
    const dismissals = await LoanDismissal.find({
      userId: new Types.ObjectId(viewerId),
      dateString: todayStr,
    });
    const dismissedAlertIds = new Set(dismissals.map((d) => d.alertId));

    const alerts: LoanAlert[] = [];

    for (const tx of transactions) {
      const party = partyMap.get(tx.partyId?.toString() || '');
      if (!party) continue;

      const isDismissed = dismissedAlertIds.has(tx._id.toString());
      if (isDismissed) continue;

      const dueDateObj = tx.dueDate as Date;
      const dueDateIST = getCurrentISTDateString(dueDateObj);
      const dueDateTime = dueDateObj.getTime();

      // Settled check: If party has 0 balance in that direction, settled -> NO alert!
      if (tx.loanAction === 'borrow') {
        if (party.loanTakenOutstanding <= 0) continue;

        // Status calculation
        let status: 'due_soon' | 'due' | 'overdue';
        if (todayStr > dueDateIST) {
          status = 'overdue';
        } else if (todayStr === dueDateIST) {
          status = 'due';
        } else {
          // Within 7 days window
          const reminderTime = dueDateTime - 7 * 24 * 60 * 60 * 1000;
          if (nowTime >= reminderTime) {
            status = 'due_soon';
          } else {
            continue;
          }
        }

        // Shortfall check against destination/paying bucket
        const payingBucket = tx.toBucketId ? bucketsMap.get(tx.toBucketId.toString()) : undefined;
        const bucketBalance = payingBucket?.balance ?? 0;
        const amountDue = party.loanTakenOutstanding;
        const isShortfall = bucketBalance < amountDue;

        alerts.push({
          partyId: party.id,
          partyName: party.name,
          action: 'borrow',
          amountDue,
          dueDate: dueDateObj.toISOString(),
          status,
          payingBucketId: payingBucket?._id.toString(),
          payingBucketName: payingBucket?.name || 'Default Account',
          isShortfall,
          shortfallAmount: isShortfall ? amountDue - bucketBalance : undefined,
          isDismissedToday: isDismissed,
        });
      } else if (tx.loanAction === 'lend') {
        if (party.loanGivenOutstanding <= 0) continue;

        let status: 'due_soon' | 'due' | 'overdue' | 'reminder';
        if (todayStr > dueDateIST) {
          status = 'overdue';
        } else if (todayStr === dueDateIST) {
          status = 'due';
        } else {
          const reminderTime = dueDateTime - 7 * 24 * 60 * 60 * 1000;
          if (nowTime >= reminderTime) {
            status = 'due_soon';
          } else {
            status = 'reminder';
          }
        }

        alerts.push({
          partyId: party.id,
          partyName: party.name,
          action: 'lend',
          amountDue: party.loanGivenOutstanding,
          dueDate: dueDateObj.toISOString(),
          status,
          isDismissedToday: isDismissed,
        });
      }
    }

    return alerts;
  }

  /**
   * Dismisses a loan alert for the current user for today only.
   */
  static async dismissAlertToday(
    alertId: string,
    _householdId: string,
    viewerId: string,
    currentDate: Date = new Date()
  ): Promise<{ success: boolean; dateString: string }> {
    const dateString = getCurrentISTDateString(currentDate);

    await LoanDismissal.findOneAndUpdate(
      {
        userId: new Types.ObjectId(viewerId),
        alertId,
        dateString,
      },
      {
        $setOnInsert: {
          userId: new Types.ObjectId(viewerId),
          alertId,
          dateString,
        },
      },
      { upsert: true }
    );

    return { success: true, dateString };
  }
}
