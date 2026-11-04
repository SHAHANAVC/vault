'use client';

/**
 * Client Component: PayPlanModal
 * 
 * Confirmation modal for recording an EMI/Kuri installment payment.
 * Displays amount, paying bucket, and balance after payment.
 * If balance is insufficient, converts into "Transfer money first".
 */

import React, { useState } from 'react';
import { formatINR, PublicPlan, PublicBucket } from '@vault/shared';
import { usePayPlan } from '../lib/planHooks';
import { useBuckets } from '../lib/bucketHooks';
import {
  X,
  CreditCard,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Calendar,
  Wallet,
  Sparkles,
} from 'lucide-react';

interface PayPlanModalProps {
  plan: PublicPlan | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenTransfer?: (data: { toBucketId: string; amount: number }) => void;
}

export function PayPlanModal({
  plan,
  isOpen,
  onClose,
  onOpenTransfer,
}: PayPlanModalProps) {
  const [successData, setSuccessData] = useState<{
    isCompleted: boolean;
    installmentNumber: number;
    amount: number;
  } | null>(null);

  const { data: bucketsData } = useBuckets();
  const buckets = bucketsData?.buckets || [];
  const payPlanMutation = usePayPlan();

  if (!isOpen || !plan) return null;

  const payingBucket = buckets.find((b) => b.id === plan.payFromBucketId);
  const currentBalance = payingBucket?.balance ?? 0;
  const amountToPay = plan.nextInstallmentAmount ?? plan.monthlyAmount ?? 0;
  const isInsufficient = currentBalance < amountToPay;
  const shortfall = amountToPay - currentBalance;
  const projectedBalance = currentBalance - amountToPay;

  const isFinalInstallment =
    plan.kind === 'emi'
      ? plan.paidAmount + amountToPay >= plan.totalAmount
      : plan.paidInstallments + 1 >= plan.totalInstallments;

  const handleConfirmPay = () => {
    payPlanMutation.mutate(
      { id: plan.id },
      {
        onSuccess: (res) => {
          setSuccessData({
            isCompleted: res.plan.status === 'completed',
            installmentNumber: res.transaction.installmentNumber || plan.paidInstallments + 1,
            amount: res.transaction.amount,
          });
        },
      }
    );
  };

  const handleClose = () => {
    setSuccessData(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-card text-foreground rounded-2xl border border-border shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {successData ? 'Payment Recorded' : 'Confirm Installment Payment'}
              </h2>
              <span className="text-xs text-muted font-mono">{plan.name}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-muted hover:text-foreground p-1 rounded-md hover:bg-muted/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success View */}
        {successData ? (
          <div className="p-6 text-center space-y-4">
            <div className="inline-flex p-3 rounded-full bg-positive/10 text-positive">
              {successData.isCompleted ? (
                <Sparkles className="w-8 h-8 text-positive animate-bounce" />
              ) : (
                <CheckCircle2 className="w-8 h-8 text-positive" />
              )}
            </div>

            <div>
              <h3 className="text-lg font-bold text-foreground">
                {successData.isCompleted ? 'Plan Completed!' : 'Installment Paid!'}
              </h3>
              <p className="text-xs text-muted mt-1">
                Installment #{successData.installmentNumber} of {formatINR(successData.amount)} has been recorded as a verified ledger entry.
              </p>
            </div>

            {successData.isCompleted && (
              <div className="p-3 rounded-xl bg-positive/10 border border-positive/20 text-positive text-xs font-medium">
                Congratulations! All commitments for &quot;{plan.name}&quot; have been fulfilled and active alerts have stopped.
              </div>
            )}

            <button
              type="button"
              onClick={handleClose}
              className="w-full py-2.5 px-4 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          /* Confirmation Content */
          <div className="p-6 space-y-4">
            {/* Installment Badge & Amount */}
            <div className="text-center p-4 rounded-xl bg-muted/5 border border-border">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Installment #{plan.paidInstallments + 1} of {plan.totalInstallments}
              </span>
              <div className="text-3xl font-extrabold text-foreground mt-1">
                {formatINR(amountToPay)}
              </div>
              {isFinalInstallment && (
                <span className="inline-block mt-1 text-[11px] font-medium text-primary px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
                  Final Installment (Completes Plan)
                </span>
              )}
            </div>

            {/* Paying Bucket & Projected Balance */}
            <div className="p-3.5 rounded-xl border border-border space-y-2 text-xs">
              <div className="flex items-center justify-between text-muted">
                <span>Paying Bucket</span>
                <span className="font-semibold text-foreground flex items-center gap-1">
                  <Wallet className="w-3.5 h-3.5 text-primary" />
                  {plan.payFromBucketName}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted">
                <span>Current Balance</span>
                <span className="font-mono font-medium text-foreground">
                  {formatINR(currentBalance)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-border font-medium">
                <span>Balance After Payment</span>
                <span
                  className={`font-mono font-semibold ${
                    projectedBalance < 0 ? 'text-negative' : 'text-foreground'
                  }`}
                >
                  {formatINR(projectedBalance)}
                </span>
              </div>
            </div>

            {/* Shortfall Alert */}
            {isInsufficient && (
              <div className="p-3 rounded-xl bg-negative/10 border border-negative/20 text-negative text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Insufficient Balance</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Available balance is lower than the installment. You need an additional{' '}
                  <strong className="font-mono">{formatINR(shortfall)}</strong> in{' '}
                  {plan.payFromBucketName} before paying.
                </p>
              </div>
            )}

            {payPlanMutation.isError && (
              <div className="p-3 rounded-xl bg-negative/10 border border-negative/20 text-negative text-xs">
                {payPlanMutation.error?.message || 'Payment failed'}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold text-muted hover:text-foreground hover:bg-muted/10 transition-colors cursor-pointer"
              >
                Cancel
              </button>

              {isInsufficient ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    if (onOpenTransfer) {
                      onOpenTransfer({
                        toBucketId: plan.payFromBucketId,
                        amount: shortfall,
                      });
                    }
                  }}
                  className="flex-2 py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>Transfer Money First</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={payPlanMutation.isPending}
                  onClick={handleConfirmPay}
                  className="flex-2 py-2 px-3 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>{payPlanMutation.isPending ? 'Recording...' : `Pay ${formatINR(amountToPay)}`}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
