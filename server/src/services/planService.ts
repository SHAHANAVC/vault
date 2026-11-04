import { Types, ClientSession } from 'mongoose';
import {
  CreatePlanInput,
  UpdatePlanInput,
  PayPlanInput,
  KuriPayoutInput,
  RecordBonusInput,
  RedeemInput,
  PublicPlan,
  PlanAlert,
  BucketShortfallSummary,
  DashboardAlertsResponse,
  calculateInstallmentsCount,
  calculateNextInstallmentAmount,
  calculateNextDueDate,
  calculatePlanDerivedState,
  formatINR,
} from '@vault/shared';
import { Plan, IPlan } from '../models/Plan';
import { Transaction, ITransaction } from '../models/Transaction';
import { Bucket, IBucket } from '../models/Bucket';
import { User } from '../models/User';
import { PlanDismissal } from '../models/PlanDismissal';
import { runInTransaction } from '../utils/transactionRunner';
import { mapTransactionForViewer } from './transactionPrivacyPolicy';
import { getCurrentISTDateString } from '../utils/dateUtils';
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
} from '../utils/errors';

export class PlanService {
  /**
   * Helper: atomically debit bucket with negative balance protection
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
      throw new BadRequestError(`Bucket "${bucket.name}" is archived and cannot participate in transactions`);
    }

    if (['cash', 'bank'].includes(bucket.type) && bucket.balance < amount) {
      const shortfall = amount - bucket.balance;
      throw new BadRequestError(
        `Insufficient balance in ${bucket.type} bucket "${bucket.name}". Required: ${formatINR(amount)}, Available: ${formatINR(bucket.balance)}, Shortfall: ${formatINR(shortfall)}`
      );
    }

    const updated = await Bucket.findOneAndUpdate(
      ['cash', 'bank'].includes(bucket.type)
        ? { _id: bucketId, householdId, balance: { $gte: amount } }
        : { _id: bucketId, householdId },
      { $inc: { balance: -amount } },
      { new: true, session: session || null }
    );

    if (!updated) {
      throw new BadRequestError(
        `Insufficient balance in ${bucket.type} bucket "${bucket.name}" (concurrent update collision)`
      );
    }
    return updated;
  }

  /**
   * Helper: atomically credit bucket
   */
  private static async atomicCredit(
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
      throw new BadRequestError(`Bucket "${bucket.name}" is archived and cannot participate in transactions`);
    }

    const updated = await Bucket.findByIdAndUpdate(
      bucketId,
      { $inc: { balance: amount } },
      { new: true, session: session || null }
    );
    if (!updated) {
      throw new NotFoundError('Bucket not found during credit update');
    }
    return updated;
  }

  /**
   * Helper: Map IPlan to PublicPlan DTO with derived runtime state
   */
  public static mapPlanForViewer(
    plan: IPlan,
    viewerId: string,
    bucketsMap: Map<string, IBucket>,
    usersMap: Map<string, { name: string }>
  ): PublicPlan | null {
    const isOwner = plan.ownerId.toString() === viewerId;
    if (!isOwner && plan.visibility === 'private') {
      return null;
    }

    const derived = calculatePlanDerivedState({
      kind: plan.kind,
      totalAmount: plan.totalAmount,
      monthlyAmount: plan.monthlyAmount,
      totalInstallments: plan.totalInstallments,
      paidAmount: plan.paidAmount,
      paidInstallments: plan.paidInstallments,
      dueDay: plan.dueDay,
      startDate: plan.startDate,
      status: plan.status,
      payoutRecorded: plan.payoutRecorded,
      redeemRecorded: plan.redeemRecorded,
    });

    const payBucket = bucketsMap.get(plan.payFromBucketId.toString());
    const kuriBucket = plan.kuriBucketId ? bucketsMap.get(plan.kuriBucketId.toString()) : undefined;
    const goldBucket = plan.goldBucketId ? bucketsMap.get(plan.goldBucketId.toString()) : undefined;
    const owner = usersMap.get(plan.ownerId.toString());

    return {
      id: plan._id.toString(),
      householdId: plan.householdId.toString(),
      ownerId: plan.ownerId.toString(),
      ownerName: owner?.name,
      kind: plan.kind,
      name: plan.name,
      note: plan.note,
      totalAmount: plan.totalAmount,
      monthlyAmount: plan.monthlyAmount,
      totalInstallments: plan.totalInstallments,
      paidInstallments: plan.paidInstallments,
      paidAmount: plan.paidAmount,
      dueDay: plan.dueDay,
      startDate: plan.startDate.toISOString(),
      payFromBucketId: plan.payFromBucketId.toString(),
      payFromBucketName: payBucket?.name || 'Unknown Bucket',
      kuriBucketId: plan.kuriBucketId?.toString(),
      kuriBucketName: kuriBucket?.name,
      jewellerName: plan.jewellerName,
      bonusAmount: plan.bonusAmount,
      bonusRecorded: plan.bonusRecorded,
      goldBucketId: plan.goldBucketId?.toString(),
      goldBucketName: goldBucket?.name,
      redeemRecorded: plan.redeemRecorded,
      redeemOption: plan.redeemOption,
      reminderDaysBefore: plan.reminderDaysBefore,
      visibility: plan.visibility,
      status: plan.status,
      payoutRecorded: plan.payoutRecorded,
      completedAt: plan.completedAt?.toISOString(),
      nextInstallmentNumber: derived.nextInstallmentNumber,
      nextInstallmentAmount: derived.nextInstallmentAmount,
      nextDueDate: derived.nextDueDate,
      remainingAmount: derived.remainingAmount,
      remainingInstallments: derived.remainingInstallments,
      createdAt: plan.createdAt.toISOString(),
    };
  }

  /**
   * POST /plans
   * Creates an EMI or Kuri financial plan.
   */
  static async createPlan(
    householdId: string,
    ownerId: string,
    input: CreatePlanInput
  ): Promise<PublicPlan> {
    const payFromBucket = await Bucket.findOne({
      _id: new Types.ObjectId(input.payFromBucketId),
      householdId: new Types.ObjectId(householdId),
    });
    if (!payFromBucket) {
      throw new NotFoundError('Pay-from bucket not found');
    }
    if (payFromBucket.isArchived) {
      throw new BadRequestError(`Bucket "${payFromBucket.name}" is archived and cannot be used for plans`);
    }

    let totalAmount = 0;
    let totalInstallments = 0;
    let kuriBucketId: Types.ObjectId | undefined = undefined;
    let goldBucketId: Types.ObjectId | undefined = undefined;
    let jewellerName: string | undefined = undefined;
    let bonusAmount = 0;

    if (input.kind === 'emi') {
      totalAmount = input.totalAmount;
      totalInstallments = calculateInstallmentsCount('emi', input.totalAmount, input.monthlyAmount);
    } else if (input.kind === 'kuri') {
      // kuri
      const kuriBucket = await Bucket.findOne({
        _id: new Types.ObjectId(input.kuriBucketId),
        householdId: new Types.ObjectId(householdId),
      });
      if (!kuriBucket) {
        throw new NotFoundError('Kuri bucket not found');
      }
      if (kuriBucket.type !== 'kuri') {
        throw new BadRequestError(`Target bucket "${kuriBucket.name}" must be of type "kuri"`);
      }
      if (kuriBucket.isArchived) {
        throw new BadRequestError(`Kuri bucket "${kuriBucket.name}" is archived`);
      }
      kuriBucketId = kuriBucket._id;
      totalInstallments = input.totalInstallments;
      totalAmount = input.monthlyAmount * input.totalInstallments;
    } else {
      // gold_scheme
      const goldBucket = await Bucket.findOne({
        _id: new Types.ObjectId(input.goldBucketId),
        householdId: new Types.ObjectId(householdId),
      });
      if (!goldBucket) {
        throw new NotFoundError('Gold scheme bucket not found');
      }
      if (goldBucket.type !== 'gold_scheme') {
        throw new BadRequestError(`Target bucket "${goldBucket.name}" must be of type "gold_scheme"`);
      }
      if (goldBucket.isArchived) {
        throw new BadRequestError(`Gold scheme bucket "${goldBucket.name}" is archived`);
      }
      goldBucketId = goldBucket._id;
      totalInstallments = input.totalInstallments;
      totalAmount = input.monthlyAmount * input.totalInstallments;
      jewellerName = input.jewellerName;
      bonusAmount = input.bonusAmount ?? 0;
    }

    const plan = new Plan({
      householdId: new Types.ObjectId(householdId),
      ownerId: new Types.ObjectId(ownerId),
      kind: input.kind,
      name: input.name,
      note: input.note,
      totalAmount,
      monthlyAmount: input.monthlyAmount,
      totalInstallments,
      paidInstallments: 0,
      paidAmount: 0,
      dueDay: input.dueDay,
      startDate: new Date(input.startDate),
      payFromBucketId: new Types.ObjectId(input.payFromBucketId),
      kuriBucketId,
      goldBucketId,
      jewellerName,
      bonusAmount,
      bonusRecorded: false,
      redeemRecorded: false,
      reminderDaysBefore: input.reminderDaysBefore ?? 3,
      visibility: input.visibility ?? 'shared',
      status: 'active',
      payoutRecorded: false,
    });

    await plan.save();

    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
    const users = await User.find({ householdId: new Types.ObjectId(householdId) });
    const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

    const mapped = this.mapPlanForViewer(plan, ownerId, bucketsMap, usersMap);
    if (!mapped) throw new Error('Failed to map created plan');
    return mapped;
  }

  /**
   * GET /plans
   * Lists plans filtered by household and privacy rules.
   */
  static async getPlans(
    householdId: string,
    viewerId: string,
    statusFilter?: string
  ): Promise<PublicPlan[]> {
    const query: Record<string, unknown> = {
      householdId: new Types.ObjectId(householdId),
    };
    if (statusFilter && ['active', 'completed', 'cancelled'].includes(statusFilter)) {
      query['status'] = statusFilter;
    }

    const plans = await Plan.find(query).sort({ createdAt: -1 });
    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
    const users = await User.find({ householdId: new Types.ObjectId(householdId) });
    const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

    const visiblePlans: PublicPlan[] = [];
    for (const p of plans) {
      const mapped = this.mapPlanForViewer(p, viewerId, bucketsMap, usersMap);
      if (mapped) visiblePlans.push(mapped);
    }
    return visiblePlans;
  }

  /**
   * GET /plans/:id
   * Retrieves single plan with full payment history (void-aware).
   */
  static async getPlanById(
    planId: string,
    householdId: string,
    viewerId: string
  ): Promise<{ plan: PublicPlan; payments: any[] }> {
    if (!Types.ObjectId.isValid(planId)) {
      throw new NotFoundError('Plan not found');
    }

    const plan = await Plan.findOne({
      _id: new Types.ObjectId(planId),
      householdId: new Types.ObjectId(householdId),
    });
    if (!plan) {
      throw new NotFoundError('Plan not found');
    }

    // Privacy: private plan is 404 to partner
    if (plan.ownerId.toString() !== viewerId && plan.visibility === 'private') {
      throw new NotFoundError('Plan not found');
    }

    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
    const users = await User.find({ householdId: new Types.ObjectId(householdId) });
    const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

    const mapped = this.mapPlanForViewer(plan, viewerId, bucketsMap, usersMap);
    if (!mapped) throw new NotFoundError('Plan not found');

    // Retrieve all linked transaction payments (both active and voided)
    const rawTxs = await Transaction.find({
      householdId: new Types.ObjectId(householdId),
      planId: plan._id,
    }).sort({ date: -1, _id: -1 });

    const payments = rawTxs
      .map((tx) => mapTransactionForViewer(tx, viewerId, householdId, bucketsMap, usersMap))
      .filter((tx) => tx !== null);

    return { plan: mapped, payments };
  }

  /**
   * PATCH /plans/:id
   * Updates plan metadata. Financial terms can only be edited if paidInstallments === 0.
   */
  static async updatePlan(
    planId: string,
    householdId: string,
    viewerId: string,
    input: UpdatePlanInput
  ): Promise<PublicPlan> {
    if (!Types.ObjectId.isValid(planId)) {
      throw new NotFoundError('Plan not found');
    }

    const plan = await Plan.findOne({
      _id: new Types.ObjectId(planId),
      householdId: new Types.ObjectId(householdId),
    });
    if (!plan) throw new NotFoundError('Plan not found');

    if (plan.ownerId.toString() !== viewerId) {
      if (plan.visibility === 'private') {
        throw new NotFoundError('Plan not found');
      }
      throw new ForbiddenError('Only the plan owner can modify this plan');
    }

    if (input.name) plan.name = input.name;
    if (input.note !== undefined) plan.note = input.note;
    if (input.reminderDaysBefore !== undefined) plan.reminderDaysBefore = input.reminderDaysBefore;

    if (input.payFromBucketId) {
      const b = await Bucket.findOne({
        _id: new Types.ObjectId(input.payFromBucketId),
        householdId: new Types.ObjectId(householdId),
      });
      if (!b) throw new NotFoundError('Pay-from bucket not found');
      if (b.isArchived) throw new BadRequestError(`Bucket "${b.name}" is archived`);
      plan.payFromBucketId = b._id;
    }

    // Financial terms are strictly locked once any payments have been recorded
    const hasFinancialChanges =
      input.totalAmount !== undefined ||
      input.monthlyAmount !== undefined ||
      input.totalInstallments !== undefined ||
      input.dueDay !== undefined ||
      input.startDate !== undefined;

    if (hasFinancialChanges) {
      if (plan.paidInstallments > 0) {
        throw new BadRequestError(
          'Financial terms cannot be modified for a plan with existing recorded payments'
        );
      }

      if (input.monthlyAmount) plan.monthlyAmount = input.monthlyAmount;
      if (input.dueDay) plan.dueDay = input.dueDay;
      if (input.startDate) plan.startDate = new Date(input.startDate);

      if (plan.kind === 'emi') {
        if (input.totalAmount) plan.totalAmount = input.totalAmount;
        plan.totalInstallments = calculateInstallmentsCount('emi', plan.totalAmount, plan.monthlyAmount);
      } else {
        if (input.totalInstallments) plan.totalInstallments = input.totalInstallments;
        plan.totalAmount = plan.monthlyAmount * plan.totalInstallments;
      }
    }

    await plan.save();

    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
    const users = await User.find({ householdId: new Types.ObjectId(householdId) });
    const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

    const mapped = this.mapPlanForViewer(plan, viewerId, bucketsMap, usersMap);
    if (!mapped) throw new Error('Failed to map updated plan');
    return mapped;
  }

  /**
   * POST /plans/:id/cancel
   * Cancels an active plan.
   */
  static async cancelPlan(
    planId: string,
    householdId: string,
    viewerId: string
  ): Promise<PublicPlan> {
    if (!Types.ObjectId.isValid(planId)) throw new NotFoundError('Plan not found');

    const plan = await Plan.findOne({
      _id: new Types.ObjectId(planId),
      householdId: new Types.ObjectId(householdId),
    });
    if (!plan) throw new NotFoundError('Plan not found');

    if (plan.ownerId.toString() !== viewerId) {
      if (plan.visibility === 'private') {
        throw new NotFoundError('Plan not found');
      }
      throw new ForbiddenError('Only the plan owner can cancel this plan');
    }

    if (plan.status === 'completed') {
      throw new BadRequestError('Cannot cancel an already completed plan');
    }

    plan.status = 'cancelled';
    await plan.save();

    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
    const users = await User.find({ householdId: new Types.ObjectId(householdId) });
    const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

    const mapped = this.mapPlanForViewer(plan, viewerId, bucketsMap, usersMap);
    if (!mapped) throw new Error('Failed to map cancelled plan');
    return mapped;
  }

  /**
   * POST /plans/:id/pay
   * In ONE atomic session: creates expense (emi) or transfer (kuri),
   * updates plan paidAmount and paidInstallments, and checks auto-completion.
   */
  static async payPlan(
    planId: string,
    householdId: string,
    viewerId: string,
    input: PayPlanInput
  ): Promise<{ plan: PublicPlan; transaction: any }> {
    if (!Types.ObjectId.isValid(planId)) throw new NotFoundError('Plan not found');

    const initialPlan = await Plan.findOne({
      _id: new Types.ObjectId(planId),
      householdId: new Types.ObjectId(householdId),
    });
    if (!initialPlan) throw new NotFoundError('Plan not found');

    // Only owner can pay
    if (initialPlan.ownerId.toString() !== viewerId) {
      if (initialPlan.visibility === 'private') {
        throw new NotFoundError('Plan not found');
      }
      throw new ForbiddenError('Only the plan owner can record payments for this plan');
    }

    if (initialPlan.status !== 'active') {
      throw new BadRequestError(`Cannot pay a ${initialPlan.status} plan`);
    }

    // Check idempotency replay
    if (input.idempotencyKey) {
      const existing = await Transaction.findOne({
        householdId: new Types.ObjectId(householdId),
        idempotencyKey: input.idempotencyKey,
        status: 'active',
      });
      if (existing) {
        const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
        const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
        const users = await User.find({ householdId: new Types.ObjectId(householdId) });
        const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

        const mappedPlan = this.mapPlanForViewer(initialPlan, viewerId, bucketsMap, usersMap);
        const mappedTx = mapTransactionForViewer(existing, viewerId, householdId, bucketsMap, usersMap);
        if (mappedPlan && mappedTx) {
          return { plan: mappedPlan, transaction: mappedTx };
        }
      }
    }

    return runInTransaction(async (session) => {
      const plan = await Plan.findById(planId).session(session || null);
      if (!plan || plan.householdId.toString() !== householdId) {
        throw new NotFoundError('Plan not found');
      }
      if (plan.status !== 'active') {
        throw new BadRequestError(`Cannot pay a ${plan.status} plan`);
      }

      const nextInstallmentNumber = plan.paidInstallments + 1;

      // Prevent duplicate installment payment
      const existingPayment = await Transaction.findOne({
        planId: plan._id,
        installmentNumber: nextInstallmentNumber,
        status: 'active',
      }).session(session || null);
      if (existingPayment) {
        throw new ConflictError(`Installment #${nextInstallmentNumber} has already been paid`);
      }

      // Compute installment amount to pay
      let amountToPay = 0;
      if (plan.kind === 'emi') {
        amountToPay = calculateNextInstallmentAmount(
          'emi',
          plan.totalAmount,
          plan.monthlyAmount,
          plan.paidAmount
        );
      } else {
        // kuri
        amountToPay = input.amount || plan.monthlyAmount;
      }

      if (amountToPay <= 0) {
        throw new BadRequestError('Calculated payment amount is zero');
      }

      // Check balance and execute atomic balance movements
      const txDate = input.date ? new Date(input.date) : new Date();
      let createdTx: ITransaction;

      if (plan.kind === 'emi') {
        // EMI is an EXPENSE from payFromBucketId (category: 'EMI')
        await this.atomicDebit(plan.payFromBucketId, householdId, amountToPay, session);

        createdTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'expense',
          amount: amountToPay,
          fromBucketId: plan.payFromBucketId,
          category: 'EMI',
          purpose: `${plan.name} - Installment ${nextInstallmentNumber}/${plan.totalInstallments}`,
          date: txDate,
          createdBy: new Types.ObjectId(viewerId),
          planId: plan._id,
          installmentNumber: nextInstallmentNumber,
          status: 'active',
          idempotencyKey: input.idempotencyKey,
        });
        await createdTx.save({ session: session || undefined });
      } else if (plan.kind === 'kuri') {
        // Kuri is a TRANSFER from payFromBucketId into kuriBucketId (asset)
        await this.atomicDebit(plan.payFromBucketId, householdId, amountToPay, session);
        await this.atomicCredit(plan.kuriBucketId!, householdId, amountToPay, session);

        createdTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'transfer',
          amount: amountToPay,
          fromBucketId: plan.payFromBucketId,
          toBucketId: plan.kuriBucketId!,
          category: 'Kuri',
          purpose: `${plan.name} - Installment ${nextInstallmentNumber}/${plan.totalInstallments}`,
          date: txDate,
          createdBy: new Types.ObjectId(viewerId),
          planId: plan._id,
          installmentNumber: nextInstallmentNumber,
          status: 'active',
          idempotencyKey: input.idempotencyKey,
        });
        await createdTx.save({ session: session || undefined });
      } else {
        // Gold Scheme is a TRANSFER from payFromBucketId into goldBucketId (asset)
        await this.atomicDebit(plan.payFromBucketId, householdId, amountToPay, session);
        await this.atomicCredit(plan.goldBucketId!, householdId, amountToPay, session);

        createdTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'transfer',
          amount: amountToPay,
          fromBucketId: plan.payFromBucketId,
          toBucketId: plan.goldBucketId!,
          category: 'Gold Scheme',
          purpose: `${plan.name} - Installment ${nextInstallmentNumber}/${plan.totalInstallments}`,
          date: txDate,
          createdBy: new Types.ObjectId(viewerId),
          planId: plan._id,
          installmentNumber: nextInstallmentNumber,
          status: 'active',
          idempotencyKey: input.idempotencyKey,
        });
        await createdTx.save({ session: session || undefined });
      }

      // Update plan progress
      plan.paidAmount += amountToPay;
      plan.paidInstallments += 1;

      // Auto completion evaluation
      if (plan.kind === 'emi') {
        if (plan.paidAmount >= plan.totalAmount || plan.paidInstallments >= plan.totalInstallments) {
          plan.status = 'completed';
          plan.completedAt = new Date();
        }
      } else if (plan.kind === 'kuri') {
        // Kuri completes only when all installments are paid AND payout has been recorded
        if (plan.paidInstallments >= plan.totalInstallments && plan.payoutRecorded) {
          plan.status = 'completed';
          plan.completedAt = new Date();
        }
      } else if (plan.kind === 'gold_scheme') {
        // Gold Scheme completes only when all installments are paid AND redeem has been recorded
        if (plan.paidInstallments >= plan.totalInstallments && plan.redeemRecorded) {
          plan.status = 'completed';
          plan.completedAt = new Date();
        }
      }

      await plan.save({ session: session || undefined });

      const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
      const users = await User.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

      const publicPlan = this.mapPlanForViewer(plan, viewerId, bucketsMap, usersMap);
      const publicTx = mapTransactionForViewer(createdTx, viewerId, householdId, bucketsMap, usersMap);

      if (!publicPlan || !publicTx) {
        throw new Error('Failed to map payment response');
      }

      return { plan: publicPlan, transaction: publicTx };
    });
  }

  /**
   * POST /plans/:id/payout (kuri only)
   * Records payout transfer from Kuri bucket back to bank/cash bucket.
   * Completes plan if all installments have been paid.
   */
  static async payoutKuri(
    planId: string,
    householdId: string,
    viewerId: string,
    input: KuriPayoutInput
  ): Promise<{ plan: PublicPlan; transaction: any }> {
    if (!Types.ObjectId.isValid(planId)) throw new NotFoundError('Plan not found');

    const initialPlan = await Plan.findOne({
      _id: new Types.ObjectId(planId),
      householdId: new Types.ObjectId(householdId),
    });
    if (!initialPlan) throw new NotFoundError('Plan not found');

    if (initialPlan.ownerId.toString() !== viewerId) {
      if (initialPlan.visibility === 'private') {
        throw new NotFoundError('Plan not found');
      }
      throw new ForbiddenError('Only the plan owner can record a payout');
    }

    if (initialPlan.kind !== 'kuri') {
      throw new BadRequestError('Payouts can only be recorded for Kuri plans');
    }

    if (initialPlan.payoutRecorded) {
      throw new BadRequestError('Payout has already been recorded for this Kuri plan');
    }

    return runInTransaction(async (session) => {
      const plan = await Plan.findById(planId).session(session || null);
      if (!plan || plan.householdId.toString() !== householdId) {
        throw new NotFoundError('Plan not found');
      }
      if (plan.payoutRecorded) {
        throw new BadRequestError('Payout has already been recorded');
      }

      const kuriBucket = await Bucket.findById(plan.kuriBucketId).session(session || null);
      if (!kuriBucket) throw new NotFoundError('Kuri bucket not found');

      const toBucket = await Bucket.findOne({
        _id: new Types.ObjectId(input.toBucketId),
        householdId: new Types.ObjectId(householdId),
      }).session(session || null);
      if (!toBucket) throw new NotFoundError('Destination bucket not found');
      if (toBucket.isArchived) throw new BadRequestError('Destination bucket is archived');

      const payoutAmount = input.amount || kuriBucket.balance;
      if (payoutAmount <= 0) {
        throw new BadRequestError('Payout amount must be greater than zero');
      }

      // Transfer from Kuri bucket to destination bucket
      await this.atomicDebit(kuriBucket._id, householdId, payoutAmount, session);
      await this.atomicCredit(toBucket._id, householdId, payoutAmount, session);

      const txDate = input.date ? new Date(input.date) : new Date();
      const createdTx = new Transaction({
        householdId: new Types.ObjectId(householdId),
        type: 'transfer',
        amount: payoutAmount,
        fromBucketId: kuriBucket._id,
        toBucketId: toBucket._id,
        category: 'Kuri Payout',
        purpose: `${plan.name} - Kuri Payout Received`,
        date: txDate,
        createdBy: new Types.ObjectId(viewerId),
        planId: plan._id,
        status: 'active',
        idempotencyKey: input.idempotencyKey,
      });
      await createdTx.save({ session: session || undefined });

      plan.payoutRecorded = true;
      if (plan.paidInstallments >= plan.totalInstallments) {
        plan.status = 'completed';
        plan.completedAt = new Date();
      }
      await plan.save({ session: session || undefined });

      const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
      const users = await User.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

      const publicPlan = this.mapPlanForViewer(plan, viewerId, bucketsMap, usersMap);
      const publicTx = mapTransactionForViewer(createdTx, viewerId, householdId, bucketsMap, usersMap);

      if (!publicPlan || !publicTx) {
        throw new Error('Failed to map payout response');
      }

      return { plan: publicPlan, transaction: publicTx };
    });
  }

  /**
   * POST /plans/:id/bonus
   * Income entry (category "Scheme bonus") credited to the gold_scheme bucket.
   * Only once per plan, only by the owner.
   */
  static async recordBonus(
    planId: string,
    householdId: string,
    viewerId: string,
    input: RecordBonusInput
  ): Promise<{ plan: PublicPlan; transaction: any }> {
    if (!Types.ObjectId.isValid(planId)) throw new NotFoundError('Plan not found');

    const initialPlan = await Plan.findOne({
      _id: new Types.ObjectId(planId),
      householdId: new Types.ObjectId(householdId),
    });
    if (!initialPlan) throw new NotFoundError('Plan not found');

    if (initialPlan.ownerId.toString() !== viewerId) {
      if (initialPlan.visibility === 'private') {
        throw new NotFoundError('Plan not found');
      }
      throw new ForbiddenError('Only the plan owner can record a bonus');
    }

    if (initialPlan.kind !== 'gold_scheme') {
      throw new BadRequestError('Bonus can only be recorded for Gold Scheme plans');
    }

    if (initialPlan.bonusRecorded) {
      throw new BadRequestError('Bonus has already been recorded for this Gold Scheme plan');
    }

    return runInTransaction(async (session) => {
      const plan = await Plan.findById(planId).session(session || null);
      if (!plan || plan.householdId.toString() !== householdId) {
        throw new NotFoundError('Plan not found');
      }
      if (plan.bonusRecorded) {
        throw new BadRequestError('Bonus has already been recorded');
      }

      const goldBucket = await Bucket.findById(plan.goldBucketId).session(session || null);
      if (!goldBucket) throw new NotFoundError('Gold scheme bucket not found');
      if (goldBucket.isArchived) throw new BadRequestError('Gold scheme bucket is archived');

      const bonusAmount = input.amount !== undefined ? input.amount : (plan.bonusAmount || 0);
      if (bonusAmount <= 0) {
        throw new BadRequestError('Bonus amount must be greater than zero');
      }

      // Credit gold_scheme bucket as real income
      await this.atomicCredit(goldBucket._id, householdId, bonusAmount, session);

      const txDate = input.date ? new Date(input.date) : new Date();
      const createdTx = new Transaction({
        householdId: new Types.ObjectId(householdId),
        type: 'income',
        amount: bonusAmount,
        toBucketId: goldBucket._id,
        category: 'Scheme bonus',
        purpose: input.note || `${plan.name} - Scheme bonus`,
        date: txDate,
        createdBy: new Types.ObjectId(viewerId),
        planId: plan._id,
        status: 'active',
        idempotencyKey: input.idempotencyKey,
      });
      await createdTx.save({ session: session || undefined });

      plan.bonusRecorded = true;
      await plan.save({ session: session || undefined });

      const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
      const users = await User.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

      const publicPlan = this.mapPlanForViewer(plan, viewerId, bucketsMap, usersMap);
      const publicTx = mapTransactionForViewer(createdTx, viewerId, householdId, bucketsMap, usersMap);

      if (!publicPlan || !publicTx) {
        throw new Error('Failed to map bonus response');
      }

      return { plan: publicPlan, transaction: publicTx };
    });
  }

  /**
   * POST /plans/:id/redeem
   * ONE session: expense (option a) or transfer (option b) out of gold bucket;
   * rejects if installments are not all paid or amount exceeds bucket balance;
   * marks redeemRecorded and completes the plan.
   */
  static async redeemPlan(
    planId: string,
    householdId: string,
    viewerId: string,
    input: RedeemInput
  ): Promise<{ plan: PublicPlan; transaction: any }> {
    if (!Types.ObjectId.isValid(planId)) throw new NotFoundError('Plan not found');

    const initialPlan = await Plan.findOne({
      _id: new Types.ObjectId(planId),
      householdId: new Types.ObjectId(householdId),
    });
    if (!initialPlan) throw new NotFoundError('Plan not found');

    if (initialPlan.ownerId.toString() !== viewerId) {
      if (initialPlan.visibility === 'private') {
        throw new NotFoundError('Plan not found');
      }
      throw new ForbiddenError('Only the plan owner can redeem this plan');
    }

    if (initialPlan.kind !== 'gold_scheme') {
      throw new BadRequestError('Redeem can only be performed on Gold Scheme plans');
    }

    if (initialPlan.paidInstallments < initialPlan.totalInstallments) {
      throw new BadRequestError(
        `Cannot redeem before all installments are paid (${initialPlan.paidInstallments}/${initialPlan.totalInstallments} paid)`
      );
    }

    if (initialPlan.redeemRecorded) {
      throw new BadRequestError('This Gold Scheme plan has already been redeemed');
    }

    return runInTransaction(async (session) => {
      const plan = await Plan.findById(planId).session(session || null);
      if (!plan || plan.householdId.toString() !== householdId) {
        throw new NotFoundError('Plan not found');
      }
      if (plan.paidInstallments < plan.totalInstallments) {
        throw new BadRequestError('Cannot redeem before all installments are paid');
      }
      if (plan.redeemRecorded) {
        throw new BadRequestError('Plan has already been redeemed');
      }

      const goldBucket = await Bucket.findById(plan.goldBucketId).session(session || null);
      if (!goldBucket) throw new NotFoundError('Gold scheme bucket not found');

      if (input.amount <= 0) {
        throw new BadRequestError('Redeem amount must be greater than zero');
      }

      if (input.amount > goldBucket.balance) {
        throw new BadRequestError(
          `Redeem amount (${formatINR(input.amount)}) cannot exceed Gold Scheme bucket balance (${formatINR(goldBucket.balance)})`
        );
      }

      const txDate = input.date ? new Date(input.date) : new Date();
      let createdTx: ITransaction;

      if (input.option === 'jewellery') {
        // Option A: Bought jewellery - EXPENSE (category "Jewellery") from gold_scheme bucket
        await this.atomicDebit(goldBucket._id, householdId, input.amount, session);

        createdTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'expense',
          amount: input.amount,
          fromBucketId: goldBucket._id,
          category: 'Jewellery',
          purpose: input.note || `${plan.name} - Jewellery Purchase`,
          date: txDate,
          createdBy: new Types.ObjectId(viewerId),
          planId: plan._id,
          status: 'active',
          idempotencyKey: input.idempotencyKey,
        });
        await createdTx.save({ session: session || undefined });
      } else {
        // Option B: Cash refund - TRANSFER from gold_scheme bucket to chosen bank/cash bucket
        const toBucket = await Bucket.findOne({
          _id: new Types.ObjectId(input.toBucketId),
          householdId: new Types.ObjectId(householdId),
        }).session(session || null);
        if (!toBucket) throw new NotFoundError('Destination refund bucket not found');
        if (toBucket.isArchived) throw new BadRequestError('Destination bucket is archived');

        await this.atomicDebit(goldBucket._id, householdId, input.amount, session);
        await this.atomicCredit(toBucket._id, householdId, input.amount, session);

        createdTx = new Transaction({
          householdId: new Types.ObjectId(householdId),
          type: 'transfer',
          amount: input.amount,
          fromBucketId: goldBucket._id,
          toBucketId: toBucket._id,
          category: 'Gold Scheme Refund',
          purpose: input.note || `${plan.name} - Cash Refund`,
          date: txDate,
          createdBy: new Types.ObjectId(viewerId),
          planId: plan._id,
          status: 'active',
          idempotencyKey: input.idempotencyKey,
        });
        await createdTx.save({ session: session || undefined });
      }

      plan.redeemRecorded = true;
      plan.redeemOption = input.option;
      plan.status = 'completed';
      plan.completedAt = new Date();
      await plan.save({ session: session || undefined });

      const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));
      const users = await User.find({ householdId: new Types.ObjectId(householdId) }).session(session || null);
      const usersMap = new Map(users.map((u) => [u._id.toString(), u]));

      const publicPlan = this.mapPlanForViewer(plan, viewerId, bucketsMap, usersMap);
      const publicTx = mapTransactionForViewer(createdTx, viewerId, householdId, bucketsMap, usersMap);

      if (!publicPlan || !publicTx) {
        throw new Error('Failed to map redeem response');
      }

      return { plan: publicPlan, transaction: publicTx };
    });
  }

  /**
   * GET /plans/alerts (and dashboard alerts)
   * Computed LIVE on every request, no cron job:
   * - Triggered if today >= nextDueDate minus reminderDaysBefore.
   * - Checks overdue, due, or due soon.
   * - Groups due amounts by payFromBucketId for combined shortfall check.
   * - Privacy masking: Partner never sees hidden bucket balances or private plans.
   */
  static async getAlerts(
    householdId: string,
    viewerId: string,
    currentDate: Date = new Date()
  ): Promise<DashboardAlertsResponse> {
    const todayStr = getCurrentISTDateString(currentDate);
    const nowTime = currentDate.getTime();

    // Fetch active plans in household
    const activePlans = await Plan.find({
      householdId: new Types.ObjectId(householdId),
      status: 'active',
    });

    // Fetch viewer dismissals for today
    const dismissals = await PlanDismissal.find({
      userId: new Types.ObjectId(viewerId),
      dateString: todayStr,
    });
    const dismissedPlanIds = new Set(dismissals.map((d) => d.planId.toString()));

    // Fetch buckets for balance and privacy evaluation
    const buckets = await Bucket.find({ householdId: new Types.ObjectId(householdId) });
    const bucketsMap = new Map(buckets.map((b) => [b._id.toString(), b]));

    // Pre-calculate total amounts due soon / due / overdue grouped by payFromBucketId
    const bucketNeedsMap = new Map<string, number>();

    interface RawTriggeredPlan {
      plan: IPlan;
      dueDateStr: string;
      amountDue: number;
      status: 'due_soon' | 'due' | 'overdue';
    }

    const triggeredPlans: RawTriggeredPlan[] = [];

    for (const plan of activePlans) {
      // Skip if viewer dismissed this plan today
      if (dismissedPlanIds.has(plan._id.toString())) {
        continue;
      }

      // Privacy check: Skip partner's private plans
      const isOwner = plan.ownerId.toString() === viewerId;
      if (!isOwner && plan.visibility === 'private') {
        continue;
      }

      // If all installments are already paid, no further installment alerts are produced
      if (plan.paidInstallments >= plan.totalInstallments) {
        continue;
      }

      const nextDueDateStr = calculateNextDueDate(plan.startDate, plan.dueDay, plan.paidInstallments);
      const amountDue = calculateNextInstallmentAmount(
        plan.kind,
        plan.totalAmount,
        plan.monthlyAmount,
        plan.paidAmount
      );

      const dueDateObj = new Date(nextDueDateStr);
      const reminderTime = dueDateObj.getTime() - plan.reminderDaysBefore * 24 * 60 * 60 * 1000;

      // Only trigger if reminder window has started
      if (nowTime < reminderTime) {
        continue;
      }

      const dueDateIST = getCurrentISTDateString(dueDateObj);
      let status: 'due_soon' | 'due' | 'overdue';
      if (todayStr > dueDateIST) {
        status = 'overdue';
      } else if (todayStr === dueDateIST) {
        status = 'due';
      } else {
        status = 'due_soon';
      }

      triggeredPlans.push({
        plan,
        dueDateStr: nextDueDateStr,
        amountDue,
        status,
      });

      const bucketKey = plan.payFromBucketId.toString();
      const currentNeed = bucketNeedsMap.get(bucketKey) || 0;
      bucketNeedsMap.set(bucketKey, currentNeed + amountDue);
    }

    // Build BucketShortfallSummary for buckets where viewer has visibility
    const shortfalls: BucketShortfallSummary[] = [];

    for (const [bucketIdStr, totalNeeded] of bucketNeedsMap.entries()) {
      const bucket = bucketsMap.get(bucketIdStr);
      if (!bucket) continue;

      const isOwner = bucket.ownerId.toString() === viewerId;
      const canSeeBalance = isOwner || bucket.visibility === 'shared' || bucket.visibility === 'balance_only';

      if (canSeeBalance && bucket.balance < totalNeeded) {
        const plansOnBucket = triggeredPlans.filter((tp) => tp.plan.payFromBucketId.toString() === bucketIdStr);
        shortfalls.push({
          bucketId: bucketIdStr,
          bucketName: bucket.name,
          currentBalance: bucket.balance,
          totalDueSoonOrOverdue: totalNeeded,
          shortfall: totalNeeded - bucket.balance,
          plansCount: plansOnBucket.length,
        });
      }
    }

    // Build individual PlanAlerts
    const alerts: PlanAlert[] = [];

    for (const item of triggeredPlans) {
      const { plan, dueDateStr, amountDue, status } = item;
      const bucket = bucketsMap.get(plan.payFromBucketId.toString());
      const isBucketOwner = bucket ? bucket.ownerId.toString() === viewerId : false;
      const canSeeBucketBalance =
        bucket && (isBucketOwner || bucket.visibility === 'shared' || bucket.visibility === 'balance_only');

      const totalNeededOnBucket = bucketNeedsMap.get(plan.payFromBucketId.toString()) || amountDue;
      const bucketHasShortfall = bucket ? bucket.balance < totalNeededOnBucket : false;

      const isDismissed = dismissedPlanIds.has(plan._id.toString());

      alerts.push({
        planId: plan._id.toString(),
        planName: plan.name,
        kind: plan.kind,
        dueDate: dueDateStr,
        amountDue,
        payFromBucketId: plan.payFromBucketId.toString(),
        payFromBucketName: canSeeBucketBalance ? bucket?.name || 'Bucket' : 'Protected Bucket',
        status,
        isShortfall: bucketHasShortfall,
        bucketBalance: canSeeBucketBalance && bucket ? bucket.balance : undefined,
        shortfallAmount: canSeeBucketBalance && bucket && bucketHasShortfall ? totalNeededOnBucket - bucket.balance : undefined,
        isDismissedToday: isDismissed,
        isMasked: !canSeeBucketBalance,
      });
    }

    return {
      alerts,
      shortfalls,
      activePlansCount: activePlans.length,
    };
  }

  /**
   * POST /plans/:id/dismiss
   * Dismisses an alert for the current user for today only.
   */
  static async dismissAlertToday(
    planId: string,
    householdId: string,
    viewerId: string,
    currentDate: Date = new Date()
  ): Promise<{ success: boolean; dateString: string }> {
    if (!Types.ObjectId.isValid(planId)) throw new NotFoundError('Plan not found');

    const plan = await Plan.findOne({
      _id: new Types.ObjectId(planId),
      householdId: new Types.ObjectId(householdId),
    });
    if (!plan) throw new NotFoundError('Plan not found');
    if (plan.visibility === 'private' && plan.ownerId.toString() !== viewerId) {
      throw new NotFoundError('Plan not found');
    }

    const dateString = getCurrentISTDateString(currentDate);

    await PlanDismissal.findOneAndUpdate(
      {
        userId: new Types.ObjectId(viewerId),
        planId: plan._id,
        dateString,
      },
      {
        $setOnInsert: {
          userId: new Types.ObjectId(viewerId),
          planId: plan._id,
          dateString,
        },
      },
      { upsert: true }
    );

    return { success: true, dateString };
  }
}
