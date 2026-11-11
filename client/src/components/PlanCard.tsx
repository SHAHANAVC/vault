'use client';

/**
 * Client Component: PlanCard
 * 
 * Interactive card displaying plan status, progress bar, installment breakdown,
 * next due date status chip, and contextual action buttons (Pay / Record Payout).
 */

import React from 'react';
import Link from 'next/link';
import { formatINR, PublicPlan } from '@vault/shared';
import { useBuckets } from '../lib/bucketHooks';
import {
  CreditCard,
  PiggyBank,
  Sparkles,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Shield,
  Eye,
  Wallet,
  ArrowRightLeft,
  ChevronRight,
  Edit2,
} from 'lucide-react';

interface PlanCardProps {
  plan: PublicPlan;
  currentUserId?: string;
  onPayClick: (plan: PublicPlan) => void;
  onPayoutClick: (plan: PublicPlan) => void;
  onEditClick?: (plan: PublicPlan) => void;
  onRecordBonusClick?: (plan: PublicPlan) => void;
  onRedeemClick?: (plan: PublicPlan) => void;
}

export function PlanCard({
  plan,
  currentUserId,
  onPayClick,
  onPayoutClick,
  onEditClick,
  onRecordBonusClick,
  onRedeemClick,
}: PlanCardProps) {
  const { data: bucketsData } = useBuckets();
  const buckets = bucketsData?.buckets || [];

  const isOwner = currentUserId ? plan.ownerId === currentUserId : true;
  const isCompleted = plan.status === 'completed';
  const isCancelled = plan.status === 'cancelled';
  const isKuri = plan.kind === 'kuri';
  const isGoldScheme = plan.kind === 'gold_scheme';

  // Calculate progress percentage
  const percentage = plan.totalAmount > 0 ? Math.min(100, Math.round((plan.paidAmount / plan.totalAmount) * 100)) : 0;

  // Next due date display
  const nextDueDateObj = plan.nextDueDate ? new Date(plan.nextDueDate) : null;
  const today = new Date();
  const isOverdue =
    nextDueDateObj &&
    !isCompleted &&
    today.getTime() > nextDueDateObj.getTime() + 24 * 60 * 60 * 1000;
  const isDueSoon =
    nextDueDateObj &&
    !isCompleted &&
    !isOverdue &&
    nextDueDateObj.getTime() - today.getTime() <= 5 * 24 * 60 * 60 * 1000;

  // Check paying bucket balance
  const payingBucket = buckets.find((b) => b.id === plan.payFromBucketId);
  const currentBalance = payingBucket?.balance ?? 0;
  const nextAmount = plan.nextInstallmentAmount ?? plan.monthlyAmount ?? 0;
  const isInsufficient = !isCompleted && currentBalance < nextAmount;

  const formattedDueDate = nextDueDateObj
    ? nextDueDateObj.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'None';

  return (
    <div
      className={`rounded-3xl border p-5 transition-all duration-200 bg-card flex flex-col justify-between shadow-2xs hover:shadow-md ${
        isCompleted
          ? 'border-positive/30 bg-positive/2'
          : isOverdue
          ? 'border-negative/40 bg-negative/2'
          : 'border-border hover:border-primary/40'
      }`}
    >
      <div>
        {/* Header Badges */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2.5 rounded-2xl border text-base flex items-center justify-center ${
                isGoldScheme
                  ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                  : isKuri
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                  : 'bg-primary/10 border-primary/20 text-primary'
              }`}
            >
              {isGoldScheme ? (
                <Sparkles className="w-5 h-5" />
              ) : isKuri ? (
                <PiggyBank className="w-5 h-5" />
              ) : (
                <CreditCard className="w-5 h-5" />
              )}
            </div>
            <div>
              <Link
                href={`/plans/${plan.id}`}
                className="font-bold text-base text-foreground hover:text-primary transition-colors flex items-center gap-1 group"
              >
                <span>{plan.name}</span>
                <ChevronRight className="w-4 h-4 text-muted group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
              </Link>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-sans uppercase">
                  {isGoldScheme ? 'Gold Scheme' : isKuri ? 'Kuri Chit' : 'EMI Plan'}
                </span>
                {plan.jewellerName && (
                  <span className="text-[10px] font-medium text-muted bg-muted/10 px-1.5 py-0.5 rounded-md border border-border/40">
                    {plan.jewellerName}
                  </span>
                )}
                <span className="text-[10px] text-muted flex items-center gap-1">
                  {plan.visibility === 'shared' ? (
                    <Eye className="w-3 h-3 text-primary" />
                  ) : (
                    <Shield className="w-3 h-3 text-muted" />
                  )}
                  {plan.visibility === 'shared' ? 'Shared' : 'Private'}
                </span>
              </div>
            </div>
          </div>

          {/* Status Badge */}
          {isCompleted ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-positive/15 text-positive border border-positive/20">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Completed</span>
            </span>
          ) : isCancelled ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-muted/20 text-muted">
              Cancelled
            </span>
          ) : isOverdue ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-negative/15 text-negative border border-negative/20 animate-pulse">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Overdue</span>
            </span>
          ) : isDueSoon ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <Clock className="w-3.5 h-3.5" />
              <span>Due Soon</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-muted/10 text-muted border border-border">
              <span>Upcoming</span>
            </span>
          )}
        </div>

        {/* Note if present */}
        {plan.note && (
          <p className="text-xs text-muted mb-3 line-clamp-1 italic">
            &quot;{plan.note}&quot;
          </p>
        )}

        {/* Progress Bar & Installment Numbers */}
        <div className="space-y-1.5 mb-4">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-muted">
              {plan.paidInstallments} of {plan.totalInstallments} installments
            </span>
            <span className="font-mono text-foreground font-semibold">{percentage}%</span>
          </div>

          <div className="w-full h-2 rounded-full bg-muted/20 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isCompleted
                  ? 'bg-positive'
                  : isOverdue
                  ? 'bg-negative'
                  : isGoldScheme
                  ? 'bg-yellow-500'
                  : 'bg-primary'
              }`}
              style={{ width: `${percentage}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs pt-1">
            <span className="text-muted">
              Paid: <strong className="text-foreground">{formatINR(plan.paidAmount)}</strong>
            </span>
            <span className="text-muted">
              Remaining: <strong className="text-foreground">{formatINR(plan.remainingAmount)}</strong>
            </span>
          </div>
        </div>

        {/* Details Grid */}
        <div className="p-3 rounded-xl bg-muted/5 border border-border/60 text-xs space-y-1.5 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-muted">Paying From</span>
            <span className="font-semibold text-foreground flex items-center gap-1">
              <Wallet className="w-3.5 h-3.5 text-primary" />
              {plan.payFromBucketName}
            </span>
          </div>

          {isKuri && plan.kuriBucketName && (
            <div className="flex items-center justify-between">
              <span className="text-muted">Kuri Asset Pool</span>
              <span className="font-semibold text-foreground flex items-center gap-1">
                <PiggyBank className="w-3.5 h-3.5 text-amber-500" />
                {plan.kuriBucketName}
              </span>
            </div>
          )}

          {isGoldScheme && plan.goldBucketName && (
            <div className="flex items-center justify-between">
              <span className="text-muted">Scheme Asset Pool</span>
              <span className="font-semibold text-foreground flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-yellow-500" />
                {plan.goldBucketName}
              </span>
            </div>
          )}

          {isGoldScheme && (
            <div className="flex items-center justify-between">
              <span className="text-muted">Merchant Bonus</span>
              <span className="font-semibold text-foreground">
                {plan.bonusRecorded ? (
                  <span className="text-positive flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Recorded
                  </span>
                ) : (plan.bonusAmount ?? 0) > 0 ? (
                  <span className="text-yellow-600 dark:text-yellow-400">
                    {formatINR(plan.bonusAmount!)} (Pending)
                  </span>
                ) : (
                  <span className="text-muted">None</span>
                )}
              </span>
            </div>
          )}

          {isGoldScheme && (
            <div className="flex items-center justify-between">
              <span className="text-muted">Redemption</span>
              <span className="font-semibold text-foreground">
                {plan.redeemRecorded ? (
                  <span className="text-positive flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    {plan.redeemOption === 'cash_refund' ? 'Cash Refund' : 'Jewellery'}
                  </span>
                ) : plan.paidInstallments >= plan.totalInstallments ? (
                  <span className="text-yellow-600 dark:text-yellow-400 font-bold">
                    Ready to Redeem
                  </span>
                ) : (
                  <span className="text-muted">Pending Installments</span>
                )}
              </span>
            </div>
          )}

          {!isCompleted && (
            <div className="flex items-center justify-between">
              <span className="text-muted">Next Due Date</span>
              <span className={`font-medium ${isOverdue ? 'text-negative font-semibold' : 'text-foreground'}`}>
                {formattedDueDate}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Action Footer */}
      <div className="pt-2 border-t border-border flex items-center gap-2">
        <Link
          href={`/plans/${plan.id}`}
          className="flex-1 py-2 px-3 rounded-xl border border-border hover:bg-muted/10 text-foreground text-xs font-semibold text-center transition-colors"
        >
          Details
        </Link>

        {isOwner && onEditClick && (
          <button
            type="button"
            onClick={() => onEditClick(plan)}
            className="py-2 px-3 rounded-xl border border-border hover:bg-muted/10 text-foreground text-xs font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
            title="Edit Plan"
          >
            <Edit2 className="w-3.5 h-3.5 text-primary" />
            <span className="hidden sm:inline">Edit</span>
          </button>
        )}

        {isCompleted ? (
          <span className="flex-1 py-2 px-3 rounded-xl bg-positive/10 text-positive text-xs font-semibold text-center flex items-center justify-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Fulfilled</span>
          </span>
        ) : !isOwner ? (
          <span className="flex-1 py-2 px-3 rounded-xl bg-muted/10 text-muted text-xs font-semibold text-center italic">
            View Only (Partner)
          </span>
        ) : isKuri && plan.paidInstallments >= plan.totalInstallments && !plan.payoutRecorded ? (
          <button
            type="button"
            onClick={() => onPayoutClick(plan)}
            className="flex-1 py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>Record Payout</span>
          </button>
        ) : isGoldScheme && plan.paidInstallments >= plan.totalInstallments && !plan.redeemRecorded ? (
          <div className="flex-1 flex items-center gap-1.5">
            {!plan.bonusRecorded && (plan.bonusAmount ?? 0) > 0 && onRecordBonusClick && (
              <button
                type="button"
                onClick={() => onRecordBonusClick(plan)}
                className="py-2 px-2.5 rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 text-xs font-semibold hover:bg-yellow-500/20 transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                <span>Bonus</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onRedeemClick?.(plan)}
              className="flex-1 py-2 px-3 rounded-xl bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Redeem</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onPayClick(plan)}
            className={`flex-1 py-2 px-3 rounded-xl text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1 cursor-pointer shadow-2xs ${
              isInsufficient
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-primary hover:bg-primary-hover'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Pay {formatINR(nextAmount)}</span>
          </button>
        )}
      </div>
    </div>
  );
}
