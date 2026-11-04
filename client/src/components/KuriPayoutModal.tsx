'use client';

/**
 * Client Component: KuriPayoutModal
 * 
 * Dialog for recording the payout transfer from a Kuri asset bucket back into
 * a bank or cash bucket, completing the Kuri plan when all installments are met.
 */

import React, { useState } from 'react';
import { formatINR, PublicPlan } from '@vault/shared';
import { usePayoutKuri } from '../lib/planHooks';
import { useBuckets } from '../lib/bucketHooks';
import {
  X,
  PiggyBank,
  ArrowRightLeft,
  AlertCircle,
} from 'lucide-react';

interface KuriPayoutModalProps {
  plan: PublicPlan | null;
  isOpen: boolean;
  onClose: () => void;
}

export function KuriPayoutModal({ plan, isOpen, onClose }: KuriPayoutModalProps) {
  const { data: bucketsData } = useBuckets();
  const buckets = React.useMemo(() => bucketsData?.buckets || [], [bucketsData]);
  const payoutMutation = usePayoutKuri();

  // Eligible destination buckets: bank and cash
  const destinationBuckets = React.useMemo(() => {
    return buckets.filter((b) => !b.isArchived && (b.type === 'bank' || b.type === 'cash'));
  }, [buckets]);

  const kuriBucket = React.useMemo(() => {
    if (!plan?.kuriBucketId) return null;
    return buckets.find((b) => b.id === plan.kuriBucketId);
  }, [buckets, plan]);

  const [customToBucketId, setCustomToBucketId] = useState<string | null>(null);
  const [customAmountRupees, setCustomAmountRupees] = useState<string | null>(null);
  const [note, setNote] = useState('Kuri payout received');
  const [apiError, setApiError] = useState<string | null>(null);

  const toBucketId = customToBucketId ?? (destinationBuckets[0]?.id || '');
  const amountRupees = customAmountRupees ?? (kuriBucket ? (kuriBucket.balance / 100).toString() : '');

  if (!isOpen || !plan) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    const amountPaise = Math.round((parseFloat(amountRupees) || 0) * 100);
    if (amountPaise <= 0) {
      setApiError('Payout amount must be greater than zero');
      return;
    }

    if (!toBucketId) {
      setApiError('Please select a destination bucket');
      return;
    }

    payoutMutation.mutate(
      {
        id: plan.id,
        data: {
          toBucketId,
          amount: amountPaise,
          note: note.trim() || undefined,
          date: new Date().toISOString(),
        },
      },
      {
        onSuccess: () => {
          onClose();
        },
        onError: (err) => {
          setApiError(err.message);
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-card text-foreground rounded-2xl border border-border shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <PiggyBank className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Record Kuri Payout</h2>
              <span className="text-xs text-muted font-mono">{plan.name}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground p-1 rounded-md hover:bg-muted/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {apiError && (
            <div className="p-3 rounded-xl bg-negative/10 border border-negative/20 text-negative text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{apiError}</span>
            </div>
          )}

          {/* Kuri Pool Info */}
          <div className="p-3.5 rounded-xl bg-primary/5 border border-primary/20 text-xs space-y-1">
            <div className="flex items-center justify-between text-muted">
              <span>Kuri Asset Bucket</span>
              <span className="font-semibold text-foreground">{plan.kuriBucketName || 'Kuri Bucket'}</span>
            </div>
            <div className="flex items-center justify-between text-muted">
              <span>Accumulated Balance</span>
              <span className="font-mono font-bold text-primary text-sm">
                {kuriBucket ? formatINR(kuriBucket.balance) : formatINR(plan.paidAmount)}
              </span>
            </div>
            <p className="text-[11px] text-muted pt-1 border-t border-primary/10">
              Payout will record a verified transfer from the Kuri bucket into your chosen account.
            </p>
          </div>

          {/* Payout Amount */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Payout Amount (₹) <span className="text-negative">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="1"
              required
              value={amountRupees}
              onChange={(e) => setCustomAmountRupees(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-foreground text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Destination Bucket */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Destination Bucket <span className="text-negative">*</span>
            </label>
            <select
              required
              value={toBucketId}
              onChange={(e) => setCustomToBucketId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            >
              {destinationBuckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.type}) — Current: {formatINR(b.balance)}
                </option>
              ))}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Note (Optional)</label>
            <input
              type="text"
              placeholder="e.g. Received Kuri prize auction"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold text-muted hover:text-foreground hover:bg-muted/10 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={payoutMutation.isPending}
              className="flex-2 py-2 px-3 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>{payoutMutation.isPending ? 'Processing...' : 'Transfer Payout'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
