import { Types } from 'mongoose';
import {
  CreatePartyInput,
  UpdatePartyInput,
  PublicParty,
  calculatePartyBalance,
  LoanAction,
} from '@vault/shared';
import { Party, IParty } from '../models/Party';
import { Transaction, ITransaction } from '../models/Transaction';
import { Bucket, IBucket } from '../models/Bucket';
import { User, IUser } from '../models/User';
import { NotFoundError, ForbiddenError, BadRequestError } from '../utils/errors';
import { escapeRegex } from '../utils/dateUtils';
import { mapTransactionForViewer } from './transactionPrivacyPolicy';

export interface PartyLedgerEntry {
  id: string;
  date: string;
  loanAction: LoanAction;
  amount: number;
  purpose?: string;
  dueDate?: string;
  runningBalance: number;
  bucketId?: string;
  bucketName?: string;
  status: 'active' | 'voided';
  canVoid: boolean;
  isMasked?: boolean;
  createdAt: string;
}

export interface PartyDetailResponse {
  party: PublicParty;
  entries: PartyLedgerEntry[];
  outstandingGiven: number;
  outstandingTaken: number;
  netBalance: number;
  nextDueDate?: string;
  isSettled: boolean;
}

export class PartyService {
  /**
   * Maps an internal Party document to PublicParty with computed balance statistics.
   */
  static mapPartyForViewer(
    party: IParty,
    viewerId: string,
    transactions: ITransaction[] = [],
    usersMap?: Map<string, IUser>
  ): PublicParty | null {
    // Privacy check: Private party owned by partner is invisible
    const isOwner = party.ownerId.toString() === viewerId;
    if (!isOwner && party.visibility === 'private') {
      return null;
    }

    const partyTxs = transactions.filter(
      (tx) => tx.partyId && tx.partyId.toString() === party._id.toString()
    );

    const balance = calculatePartyBalance(
      partyTxs.map((tx) => ({
        loanAction: tx.loanAction,
        amount: tx.amount,
        status: tx.status,
      }))
    );

    let lastActivityDate: string | undefined = undefined;
    if (partyTxs.length > 0) {
      const sortedByDate = [...partyTxs].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const latestTx = sortedByDate[0];
      if (latestTx) {
        lastActivityDate =
          latestTx.date instanceof Date
            ? latestTx.date.toISOString()
            : new Date(latestTx.date).toISOString();
      }
    }

    const owner = usersMap?.get(party.ownerId.toString());

    return {
      id: party._id.toString(),
      householdId: party.householdId.toString(),
      ownerId: party.ownerId.toString(),
      ownerName: owner?.name || (isOwner ? 'You' : 'Partner'),
      name: party.name,
      phone: party.phone || undefined,
      note: party.note || undefined,
      visibility: party.visibility,
      isArchived: party.isArchived,
      loanGivenOutstanding: balance.loanGivenOutstanding,
      loanTakenOutstanding: balance.loanTakenOutstanding,
      netBalance: balance.netBalance,
      totalLent: balance.totalLent,
      totalRepaidToMe: balance.totalRepaidToMe,
      totalBorrowed: balance.totalBorrowed,
      totalRepaidByMe: balance.totalRepaidByMe,
      lastActivityDate,
      createdAt:
        party.createdAt instanceof Date
          ? party.createdAt.toISOString()
          : new Date(party.createdAt).toISOString(),
      updatedAt:
        party.updatedAt instanceof Date
          ? party.updatedAt.toISOString()
          : new Date(party.updatedAt).toISOString(),
    };
  }

  /**
   * Creates a new party.
   * Name is unique per owner within household (case-insensitive).
   */
  static async createParty(
    householdId: string,
    ownerId: string,
    input: CreatePartyInput
  ): Promise<PublicParty> {
    const trimmedName = input.name.trim();

    const existing = await Party.findOne({
      householdId: new Types.ObjectId(householdId),
      ownerId: new Types.ObjectId(ownerId),
      name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') },
    });

    if (existing) {
      throw new BadRequestError(`A party named "${trimmedName}" already exists`);
    }

    const party = new Party({
      householdId: new Types.ObjectId(householdId),
      ownerId: new Types.ObjectId(ownerId),
      name: trimmedName,
      phone: input.phone?.trim() || undefined,
      note: input.note?.trim() || undefined,
      visibility: input.visibility || 'shared',
      isArchived: false,
    });

    await party.save();

    const mapped = this.mapPartyForViewer(party, ownerId, []);
    if (!mapped) {
      throw new Error('Failed to map created party');
    }
    return mapped;
  }

  /**
   * Retrieves all parties visible to the viewer with up-to-date ledger balances.
   */
  static async getParties(
    householdId: string,
    viewerId: string,
    includeArchived = false
  ): Promise<PublicParty[]> {
    const filter: Record<string, unknown> = {
      householdId: new Types.ObjectId(householdId),
      $or: [
        { ownerId: new Types.ObjectId(viewerId) },
        { visibility: 'shared' },
      ],
    };

    if (!includeArchived) {
      filter.isArchived = false;
    }

    const parties = await Party.find(filter).sort({ name: 1 });

    // Fetch all active/relevant transactions to calculate live balances
    const transactions = await Transaction.find({
      householdId: new Types.ObjectId(householdId),
      partyId: { $ne: null },
    });

    const users = await User.find({ householdId: new Types.ObjectId(householdId) });
    const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

    const result: PublicParty[] = [];
    for (const p of parties) {
      const mapped = this.mapPartyForViewer(p, viewerId, transactions, usersMap);
      if (mapped) {
        result.push(mapped);
      }
    }

    return result;
  }

  /**
   * Retrieves single party details with chronological ledger and running balance.
   */
  static async getPartyById(
    partyId: string,
    householdId: string,
    viewerId: string
  ): Promise<PartyDetailResponse> {
    if (!Types.ObjectId.isValid(partyId)) {
      throw new NotFoundError('Party not found');
    }

    const party = await Party.findById(partyId);
    if (!party || party.householdId.toString() !== householdId) {
      throw new NotFoundError('Party not found');
    }

    const isOwner = party.ownerId.toString() === viewerId;
    if (!isOwner && party.visibility === 'private') {
      // Privacy invariant: Partner's private party yields 404 (never 403)
      throw new NotFoundError('Party not found');
    }

    const [transactions, buckets, users] = await Promise.all([
      Transaction.find({
        householdId: new Types.ObjectId(householdId),
        partyId: party._id,
      }).sort({ date: 1, createdAt: 1 }),
      Bucket.find({ householdId: new Types.ObjectId(householdId) }),
      User.find({ householdId: new Types.ObjectId(householdId) }),
    ]);

    const bucketsMap = new Map<string, IBucket>(buckets.map((b) => [b._id.toString(), b]));
    const usersMap = new Map<string, IUser>(users.map((u) => [u._id.toString(), u]));

    const mappedParty = this.mapPartyForViewer(party, viewerId, transactions, usersMap);
    if (!mappedParty) {
      throw new NotFoundError('Party not found');
    }

    // Build ledger entries with running balance
    let runningNet = 0;
    const entries: PartyLedgerEntry[] = [];
    let nextDueDate: string | undefined = undefined;
    const nowTime = Date.now();

    for (const tx of transactions) {
      const publicTx = mapTransactionForViewer(tx, viewerId, householdId, bucketsMap, usersMap);
      // If transaction is completely hidden by privacy rules, skip
      if (!publicTx) continue;

      const isVoided = tx.status === 'voided';
      if (!isVoided) {
        if (tx.loanAction === 'lend') {
          runningNet += tx.amount;
        } else if (tx.loanAction === 'receive_repayment') {
          runningNet -= tx.amount;
        } else if (tx.loanAction === 'borrow') {
          runningNet -= tx.amount;
        } else if (tx.loanAction === 'repay') {
          runningNet += tx.amount;
        }
      }

      const txDateStr =
        tx.date instanceof Date ? tx.date.toISOString() : new Date(tx.date).toISOString();
      const dueDateStr = tx.dueDate
        ? tx.dueDate instanceof Date
          ? tx.dueDate.toISOString()
          : new Date(tx.dueDate).toISOString()
        : undefined;

      if (!isVoided && dueDateStr && new Date(dueDateStr).getTime() >= nowTime) {
        if (!nextDueDate || new Date(dueDateStr).getTime() < new Date(nextDueDate).getTime()) {
          nextDueDate = dueDateStr;
        }
      }

      // Determine counter bucket (cash or bank)
      const counterBucketId =
        tx.loanAction === 'lend' || tx.loanAction === 'repay'
          ? tx.fromBucketId?.toString()
          : tx.toBucketId?.toString();
      const counterBucket = counterBucketId ? bucketsMap.get(counterBucketId) : undefined;
      const canSeeBucket =
        isOwner ||
        counterBucket?.visibility === 'shared' ||
        counterBucket?.visibility === 'balance_only';

      entries.push({
        id: tx._id.toString(),
        date: txDateStr,
        loanAction: tx.loanAction as LoanAction,
        amount: tx.amount,
        purpose: publicTx.purpose,
        dueDate: dueDateStr,
        runningBalance: runningNet,
        bucketId: canSeeBucket ? counterBucketId : undefined,
        bucketName: canSeeBucket ? counterBucket?.name : 'Protected Bucket',
        status: tx.status,
        canVoid: tx.createdBy.toString() === viewerId && tx.status === 'active',
        isMasked: publicTx.isMasked,
        createdAt:
          tx.createdAt instanceof Date ? tx.createdAt.toISOString() : new Date(tx.createdAt).toISOString(),
      });
    }

    const isSettled =
      mappedParty.loanGivenOutstanding === 0 && mappedParty.loanTakenOutstanding === 0;

    return {
      party: mappedParty,
      entries: entries.reverse(), // Most recent first for UI ledger
      outstandingGiven: mappedParty.loanGivenOutstanding,
      outstandingTaken: mappedParty.loanTakenOutstanding,
      netBalance: mappedParty.netBalance,
      nextDueDate,
      isSettled,
    };
  }

  /**
   * Updates party metadata (name, phone, note, visibility).
   * Creator/owner only.
   */
  static async updateParty(
    partyId: string,
    householdId: string,
    viewerId: string,
    input: UpdatePartyInput
  ): Promise<PublicParty> {
    if (!Types.ObjectId.isValid(partyId)) {
      throw new NotFoundError('Party not found');
    }

    const party = await Party.findById(partyId);
    if (!party || party.householdId.toString() !== householdId) {
      throw new NotFoundError('Party not found');
    }

    const isOwner = party.ownerId.toString() === viewerId;
    if (!isOwner) {
      if (party.visibility === 'private') {
        throw new NotFoundError('Party not found');
      }
      throw new ForbiddenError('Only the party owner can update this party');
    }

    if (input.name && input.name.trim() !== party.name) {
      const trimmed = input.name.trim();
      const existing = await Party.findOne({
        _id: { $ne: party._id },
        householdId: new Types.ObjectId(householdId),
        ownerId: new Types.ObjectId(viewerId),
        name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') },
      });
      if (existing) {
        throw new BadRequestError(`A party named "${trimmed}" already exists`);
      }
      party.name = trimmed;
    }

    if (input.phone !== undefined) {
      party.phone = input.phone?.trim() || undefined;
    }
    if (input.note !== undefined) {
      party.note = input.note?.trim() || undefined;
    }
    if (input.visibility !== undefined) {
      party.visibility = input.visibility;
    }

    await party.save();

    const transactions = await Transaction.find({
      householdId: new Types.ObjectId(householdId),
      partyId: party._id,
    });

    const mapped = this.mapPartyForViewer(party, viewerId, transactions);
    if (!mapped) {
      throw new Error('Failed to map updated party');
    }
    return mapped;
  }

  /**
   * Archives a party.
   * Can ONLY be archived if outstanding balance is zero.
   * Creator/owner only.
   */
  static async archiveParty(
    partyId: string,
    householdId: string,
    viewerId: string
  ): Promise<PublicParty> {
    if (!Types.ObjectId.isValid(partyId)) {
      throw new NotFoundError('Party not found');
    }

    const party = await Party.findById(partyId);
    if (!party || party.householdId.toString() !== householdId) {
      throw new NotFoundError('Party not found');
    }

    const isOwner = party.ownerId.toString() === viewerId;
    if (!isOwner) {
      if (party.visibility === 'private') {
        throw new NotFoundError('Party not found');
      }
      throw new ForbiddenError('Only the party owner can archive this party');
    }

    // Verify balance is zero
    const transactions = await Transaction.find({
      householdId: new Types.ObjectId(householdId),
      partyId: party._id,
      status: { $ne: 'voided' },
    });

    const balance = calculatePartyBalance(
      transactions.map((tx) => ({
        loanAction: tx.loanAction,
        amount: tx.amount,
        status: tx.status,
      }))
    );

    if (balance.loanGivenOutstanding !== 0 || balance.loanTakenOutstanding !== 0) {
      throw new BadRequestError(
        'Cannot archive a party with an active outstanding balance. Please settle all loans first.'
      );
    }

    party.isArchived = true;
    await party.save();

    const mapped = this.mapPartyForViewer(party, viewerId, transactions);
    if (!mapped) {
      throw new Error('Failed to map archived party');
    }
    return mapped;
  }
}
