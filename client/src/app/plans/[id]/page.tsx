'use client';

/**
 * Client Component: /plans/[id]
 * 
 * Server vs Client Component Rationale:
 * Marked as 'use client' because it handles live interactive user actions:
 * 1. Fetching single plan details and dynamic payment ledger history.
 * 2. Opening Payment and Kuri Payout confirmation modals.
 * 3. Void-aware ledger presentation (voided transactions clearly flagged).
 * 4. Cancellation confirmation dialog.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { formatINR } from '@vault/shared';
import { usePlan, useCancelPlan } from '../../../lib/planHooks';
import { useAuthMe, useBuckets } from '../../../lib/bucketHooks';
import { ThemeToggle } from '../../../components/ThemeToggle';
import { PayPlanModal } from '../../../components/PayPlanModal';
import { EditPlanModal } from '../../../components/EditPlanModal';
import { KuriPayoutModal } from '../../../components/KuriPayoutModal';
import { RecordBonusModal } from '../../../components/RecordBonusModal';
import { RedeemPlanModal } from '../../../components/RedeemPlanModal';
import { TransactionModal } from '../../../components/TransactionModal';
import {
  ArrowLeft,
  CreditCard,
  PiggyBank,
  Sparkles,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Wallet,
  Shield,
  Eye,
  Trash2,
  Receipt,
  RotateCcw,
  Edit2,
} from 'lucide-react';

export default function PlanDetailPage() {
  const params = useParams();
  const planId = params['id'] as string;

  const { data: authData } = useAuthMe();
  const currentUser = authData?.user;

  const { data: bucketsData } = useBuckets();
  const buckets = bucketsData?.buckets || [];

  const { data: planData, isLoading, error } = usePlan(planId);
  const cancelPlanMutation = useCancelPlan();

  const [payModalOpen, setPayModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [payoutModalOpen, setPayoutModalOpen] = useState(false);
  const [bonusModalOpen, setBonusModalOpen] = useState(false);
  const [redeemModalOpen, setRedeemModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferPrefill, setTransferPrefill] = useState<{
    toBucketId?: string;
    amount?: number;
  }>({});

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted">
        <div className="flex items-center gap-3">
          <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
          <span className="text-sm font-medium text-foreground">Loading plan details...</span>
        </div>
      </div>
    );
  }

  if (error || !planData?.plan) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-4">
        <div className="p-4 rounded-2xl border border-negative/20 bg-negative/5 text-center max-w-md w-full space-y-3">
          <AlertTriangle className="w-8 h-8 text-negative mx-auto" />
          <h2 className="text-base font-semibold">Plan Not Found</h2>
          <p className="text-xs text-muted">
            The requested plan either does not exist or is private to another household member.
          </p>
          <Link
            href="/plans"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Plans</span>
          </Link>
        </div>
      </div>
    );
  }

  const { plan, payments } = planData;
  const isOwner = currentUser ? plan.ownerId === currentUser.id : true;
  const isCompleted = plan.status === 'completed';
  const isCancelled = plan.status === 'cancelled';
  const isKuri = plan.kind === 'kuri';
  const isGoldScheme = plan.kind === 'gold_scheme';

  const percentage =
    plan.totalAmount > 0
      ? Math.min(100, Math.round((plan.paidAmount / plan.totalAmount) * 100))
      : 0;

  const handleCancel = () => {
    if (confirm(`Are you sure you want to cancel the plan "${plan.name}"?`)) {
      cancelPlanMutation.mutate(plan.id);
    }
  };

  const handleOpenTransfer = (data: { toBucketId?: string; amount?: number }) => {
    setTransferPrefill(data);
    setTransferModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col antialiased transition-colors duration-200">
      {/* Top Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/plans"
              className="p-2 rounded-xl border border-border hover:bg-muted/10 text-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <span className="text-base font-semibold text-foreground tracking-tight">
                {plan.name}
              </span>
              <span className="text-xs text-muted block">
                Created by {plan.ownerName || (isOwner ? 'You' : 'Partner')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOwner && !isCompleted && !isCancelled && (
              <button
                type="button"
                onClick={() => setEditModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border hover:bg-muted/10 text-xs font-semibold text-foreground transition-colors cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5 text-primary" />
                <span>Edit Plan</span>
              </button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Plan Overview Card */}
        <div className="p-6 rounded-2xl border border-border bg-card shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`p-3 rounded-2xl text-xl flex items-center justify-center ${
                  isGoldScheme
                    ? 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20'
                    : isKuri
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                    : 'bg-primary/15 text-primary border border-primary/20'
                }`}
              >
                {isGoldScheme ? (
                  <Sparkles className="w-6 h-6" />
                ) : isKuri ? (
                  <PiggyBank className="w-6 h-6" />
                ) : (
                  <CreditCard className="w-6 h-6" />
                )}
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">{plan.name}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 uppercase font-sans">
                    {isGoldScheme ? 'Gold Scheme' : isKuri ? 'Kuri' : 'EMI Plan'}
                  </span>
                  {plan.jewellerName && (
                    <span className="text-xs font-medium text-muted bg-muted/10 px-2 py-0.5 rounded-md border border-border/40">
                      {plan.jewellerName}
                    </span>
                  )}
                  <span className="text-xs text-muted flex items-center gap-1">
                    {plan.visibility === 'shared' ? (
                      <Eye className="w-3.5 h-3.5 text-primary" />
                    ) : (
                      <Shield className="w-3.5 h-3.5 text-muted" />
                    )}
                    {plan.visibility === 'shared' ? 'Shared with partner' : 'Private to you'}
                  </span>
                </div>
              </div>
            </div>

            {/* Status Chip */}
            <div className="self-start sm:self-center">
              {isCompleted ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-positive/15 text-positive font-semibold text-xs border border-positive/20">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Plan Fulfilled</span>
                </span>
              ) : isCancelled ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/20 text-muted font-semibold text-xs">
                  <span>Cancelled</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/15 text-primary font-semibold text-xs border border-primary/20">
                  <Clock className="w-4 h-4" />
                  <span>Active Commitment</span>
                </span>
              )}
            </div>
          </div>

          {plan.note && (
            <p className="text-xs text-muted italic bg-muted/5 p-3 rounded-xl border border-border">
              &quot;{plan.note}&quot;
            </p>
          )}

          {/* Progress Bar & Amount Summary */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="text-muted">
                {plan.paidInstallments} of {plan.totalInstallments} installments completed
              </span>
              <span className="font-mono font-bold text-foreground">{percentage}%</span>
            </div>

            <div className="w-full h-3 rounded-full bg-muted/20 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isCompleted ? 'bg-positive' : 'bg-primary'
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
              <div className="p-3 rounded-xl bg-muted/5 border border-border">
                <span className="text-[11px] text-muted block">Total Commitment</span>
                <span className="text-base font-bold text-foreground">
                  {formatINR(plan.totalAmount)}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-muted/5 border border-border">
                <span className="text-[11px] text-muted block">Monthly Installment</span>
                <span className="text-base font-bold text-foreground">
                  {formatINR(plan.monthlyAmount)}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-positive/5 border border-positive/20">
                <span className="text-[11px] text-positive block">Total Paid</span>
                <span className="text-base font-bold text-positive">
                  {formatINR(plan.paidAmount)}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-muted/5 border border-border">
                <span className="text-[11px] text-muted block">Remaining</span>
                <span className="text-base font-bold text-foreground">
                  {formatINR(plan.remainingAmount)}
                </span>
              </div>
            </div>
          </div>

          {/* Configuration Grid */}
          <div className="p-4 rounded-xl bg-muted/5 border border-border text-xs grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <span className="text-muted block">Paying Bucket</span>
              <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                <Wallet className="w-3.5 h-3.5 text-primary" />
                {plan.payFromBucketName}
              </span>
            </div>

            {isKuri && plan.kuriBucketName && (
              <div>
                <span className="text-muted block">Kuri Asset Pool</span>
                <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                  <PiggyBank className="w-3.5 h-3.5 text-amber-500" />
                  {plan.kuriBucketName}
                </span>
              </div>
            )}

            {isGoldScheme && plan.goldBucketName && (
              <div>
                <span className="text-muted block">Scheme Asset Pool</span>
                <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                  <Sparkles className="w-3.5 h-3.5 text-yellow-500" />
                  {plan.goldBucketName}
                </span>
              </div>
            )}

            {isGoldScheme && (
              <div>
                <span className="text-muted block">Merchant Bonus</span>
                <span className="font-semibold text-foreground mt-0.5 block">
                  {plan.bonusRecorded ? (
                    <span className="text-positive flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Recorded ({formatINR(plan.bonusAmount || 0)})
                    </span>
                  ) : (plan.bonusAmount ?? 0) > 0 ? (
                    <span className="text-yellow-600 dark:text-yellow-400">
                      {formatINR(plan.bonusAmount!)} (Pending)
                    </span>
                  ) : (
                    <span className="text-muted">None configured</span>
                  )}
                </span>
              </div>
            )}

            {isGoldScheme && (
              <div>
                <span className="text-muted block">Redemption Status</span>
                <span className="font-semibold text-foreground mt-0.5 block">
                  {plan.redeemRecorded ? (
                    <span className="text-positive flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Redeemed via {plan.redeemOption === 'cash_refund' ? 'Cash Refund' : 'Jewellery'}
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

            <div>
              <span className="text-muted block">Payment Schedule</span>
              <span className="font-semibold text-foreground mt-0.5 block">
                Day {plan.dueDay} of each month (Reminder: {plan.reminderDaysBefore}d before)
              </span>
            </div>
          </div>

          {/* Action Bar */}
          {!isCompleted && !isCancelled && isOwner && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelPlanMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-negative hover:bg-negative/10 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Cancel Plan</span>
              </button>

              <div className="flex items-center gap-2">
                {isKuri && plan.paidInstallments >= plan.totalInstallments && !plan.payoutRecorded ? (
                  <button
                    type="button"
                    onClick={() => setPayoutModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  >
                    <PiggyBank className="w-4 h-4" />
                    <span>Record Kuri Payout</span>
                  </button>
                ) : isGoldScheme && plan.paidInstallments >= plan.totalInstallments && !plan.redeemRecorded ? (
                  <div className="flex items-center gap-2">
                    {!plan.bonusRecorded && (plan.bonusAmount ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => setBonusModalOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 text-xs font-semibold hover:bg-yellow-500/20 transition-colors cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Record Bonus</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setRedeemModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>Redeem Scheme</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {isGoldScheme && !plan.bonusRecorded && (plan.bonusAmount ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => setBonusModalOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 text-xs font-semibold hover:bg-yellow-500/20 transition-colors cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Record Bonus</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPayModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                    >
                      <CreditCard className="w-4 h-4" />
                      <span>
                        Pay Next Installment ({formatINR(plan.nextInstallmentAmount ?? plan.monthlyAmount ?? 0)})
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Payment History Timeline */}
        <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Payment History</h2>
            </div>
            <span className="text-xs text-muted font-mono">
              {payments.filter((p) => p.status === 'active').length} of {plan.totalInstallments} recorded
            </span>
          </div>

          {payments.length === 0 ? (
            <div className="text-center py-12 px-4 text-xs text-muted">
              No payments recorded yet. Click &quot;Pay Next Installment&quot; to begin fulfilling this commitment.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {payments.map((p) => {
                const isVoided = p.status === 'voided';
                const formattedDate = new Date(p.date).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                });

                return (
                  <div
                    key={p.id}
                    className={`p-4 flex items-center justify-between gap-3 transition-colors ${
                      isVoided ? 'bg-muted/5 opacity-60' : 'hover:bg-muted/5'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-xl text-xs font-mono font-bold ${
                          isVoided
                            ? 'bg-muted/10 text-muted'
                            : 'bg-primary/10 text-primary'
                        }`}
                      >
                        #{p.installmentNumber || '•'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            {p.purpose || `Installment #${p.installmentNumber}`}
                          </span>
                          {isVoided && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-negative/15 text-negative border border-negative/20 flex items-center gap-1">
                              <RotateCcw className="w-3 h-3" />
                              <span>Voided</span>
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-muted block mt-0.5">
                          Paid on {formattedDate} via {p.fromBucketName || 'Bucket'}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span
                        className={`text-sm font-bold font-mono ${
                          isVoided ? 'line-through text-muted' : 'text-foreground'
                        }`}
                      >
                        {formatINR(p.amount)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      <EditPlanModal
        plan={plan}
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
      />

      <PayPlanModal
        plan={plan}
        isOpen={payModalOpen}
        onClose={() => setPayModalOpen(false)}
        onOpenTransfer={handleOpenTransfer}
      />

      <KuriPayoutModal
        plan={plan}
        isOpen={payoutModalOpen}
        onClose={() => setPayoutModalOpen(false)}
      />

      <RecordBonusModal
        plan={plan}
        isOpen={bonusModalOpen}
        onClose={() => setBonusModalOpen(false)}
      />

      <RedeemPlanModal
        plan={plan}
        isOpen={redeemModalOpen}
        onClose={() => setRedeemModalOpen(false)}
      />

      <TransactionModal
        isOpen={transferModalOpen}
        onClose={() => {
          setTransferModalOpen(false);
          setTransferPrefill({});
        }}
        buckets={buckets}
        initialMode="transfer"
        preselectedBucketId={transferPrefill.toBucketId}
      />
    </div>
  );
}
