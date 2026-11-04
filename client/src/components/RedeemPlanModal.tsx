'use client';

/**
 * Client Component: RedeemPlanModal
 * 
 * Dialog for redeeming a Gold Scheme at maturity:
 * Option a) Bought jewellery: EXPENSE (category "Jewellery") from the gold_scheme bucket.
 * Option b) Cash refund: TRANSFER from the gold_scheme bucket to a bank/cash bucket.
 * 
 * Rejects if amount exceeds bucket balance or installments are incomplete.
 * Marks redeemRecorded and completes the plan.
 */

import React, { useState, useMemo } from 'react';
import { formatINR, PublicPlan, RedeemInput } from '@vault/shared';
import { useRedeemPlan } from '../lib/planHooks';
import { useBuckets } from '../lib/bucketHooks';
import {
  X,
  Sparkles,
  ShoppingBag,
  ArrowRightLeft,
  AlertCircle,
  Info,
} from 'lucide-react';

interface RedeemPlanModalProps {
  plan: PublicPlan | null;
  isOpen: boolean;
  onClose: () => void;
}

export function RedeemPlanModal({ plan, isOpen, onClose }: RedeemPlanModalProps) {
  const { data: bucketsData } = useBuckets();
  const buckets = useMemo(() => bucketsData?.buckets || [], [bucketsData]);
  const redeemMutation = useRedeemPlan();

  const [option, setOption] = useState<'jewellery' | 'cash_refund'>('jewellery');

  // Destination buckets for cash refund (bank and cash only)
  const destinationBuckets = useMemo(() => {
    return buckets.filter((b) => !b.isArchived && (b.type === 'bank' || b.type === 'cash'));
  }, [buckets]);

  const goldBucket = useMemo(() => {
    if (!plan?.goldBucketId) return null;
    return buckets.find((b) => b.id === plan.goldBucketId);
  }, [buckets, plan]);

  const maxBalancePaise = goldBucket?.balance ?? 0;
  const defaultAmountRupees = maxBalancePaise > 0 ? (maxBalancePaise / 100).toString() : '';

  const [amountRupees, setAmountRupees] = useState<string>(defaultAmountRupees);
  const [customToBucketId, setCustomToBucketId] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);

  const toBucketId = customToBucketId ?? (destinationBuckets[0]?.id || '');



  if (!isOpen || !plan) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    const amountPaise = Math.round((parseFloat(amountRupees) || 0) * 100);
    if (amountPaise <= 0) {
      setApiError('Redemption amount must be greater than zero');
      return;
    }

    if (amountPaise > maxBalancePaise) {
      setApiError(`Amount exceeds available scheme balance (${formatINR(maxBalancePaise)})`);
      return;
    }

    let payload: RedeemInput;

    if (option === 'jewellery') {
      payload = {
        option: 'jewellery',
        amount: amountPaise,
        date: date ? new Date(date).toISOString() : undefined,
        note: note.trim() || undefined,
      };
    } else {
      if (!toBucketId) {
        setApiError('Please select a destination account for the cash refund');
        return;
      }
      payload = {
        option: 'cash_refund',
        amount: amountPaise,
        toBucketId,
        date: date ? new Date(date).toISOString() : undefined,
        note: note.trim() || undefined,
      };
    }

    redeemMutation.mutate(
      {
        id: plan.id,
        data: payload,
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
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card text-foreground rounded-2xl border border-border shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-card to-card-muted/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Redeem Gold Scheme</h2>
              <span className="text-xs text-muted font-mono">{plan.name}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground p-1.5 rounded-lg hover:bg-muted/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {apiError && (
            <div className="p-3 rounded-xl bg-negative/10 border border-negative/20 text-negative text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{apiError}</span>
            </div>
          )}

          {/* Scheme Balance Status */}
          <div className="p-3.5 rounded-xl bg-muted/10 border border-border flex items-center justify-between text-xs">
            <div>
              <span className="text-muted block">Scheme Bucket Balance</span>
              <span className="font-semibold text-foreground">{goldBucket?.name || 'Gold Scheme'}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-muted block uppercase font-mono">Available</span>
              <span className="text-sm font-bold font-mono text-primary">{formatINR(maxBalancePaise)}</span>
            </div>
          </div>

          {/* Redemption Option Choice */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-2">
              Select Redemption Option <span className="text-negative">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setOption('jewellery')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  option === 'jewellery'
                    ? 'border-yellow-500/80 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300 font-semibold shadow-2xs ring-1 ring-yellow-500/30'
                    : 'border-border hover:bg-muted/10 text-muted'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <ShoppingBag className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                  <span className="text-xs font-bold">Bought Jewellery</span>
                </div>
                <p className="text-[11px] text-muted leading-tight font-normal">
                  Purchased gold ornaments/coins at the jeweller.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setOption('cash_refund')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  option === 'cash_refund'
                    ? 'border-primary/80 bg-primary/10 text-primary font-semibold shadow-2xs ring-1 ring-primary/30'
                    : 'border-border hover:bg-muted/10 text-muted'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <ArrowRightLeft className="w-4 h-4 text-primary" />
                  <span className="text-xs font-bold">Cash Refund</span>
                </div>
                <p className="text-[11px] text-muted leading-tight font-normal">
                  Refunded cash balance back to your bank account.
                </p>
              </button>
            </div>
          </div>

          {/* Ledger & Reports Explanation */}
          <div className="p-3.5 rounded-xl bg-card-muted/50 border border-border text-xs space-y-1">
            <div className="font-semibold flex items-center gap-1.5 text-foreground">
              <Info className="w-4 h-4 text-primary" />
              Impact on Balances and Reports
            </div>
            {option === 'jewellery' ? (
              <p className="text-[11px] text-muted leading-relaxed">
                Money leaves your Gold Scheme bucket as an <strong>EXPENSE</strong> under category <strong>&quot;Jewellery&quot;</strong>. This expenditure appears in your household expense totals and net cash flow reports.
              </p>
            ) : (
              <p className="text-[11px] text-muted leading-relaxed">
                Money leaves your Gold Scheme bucket as a <strong>TRANSFER</strong> into your selected bank/cash bucket. Because it is an internal account movement, it is <strong>EXCLUDED</strong> from expense and income totals.
              </p>
            )}
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Redemption Amount (₹) <span className="text-negative">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="e.g. 60000"
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
            <span className="text-[11px] text-muted mt-1 block">
              Max available: {formatINR(maxBalancePaise)}
            </span>
          </div>

          {/* Target Bucket for Cash Refund */}
          {option === 'cash_refund' && (
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Deposit Into Bucket <span className="text-negative">*</span>
              </label>
              {destinationBuckets.length === 0 ? (
                <div className="p-2.5 rounded-xl bg-negative/10 border border-negative/20 text-negative text-xs">
                  No active bank or cash buckets found.
                </div>
              ) : (
                <select
                  required
                  value={toBucketId}
                  onChange={(e) => setCustomToBucketId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                >
                  {destinationBuckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.type}) — {formatINR(b.balance)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Date & Note */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Redemption Date
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Note (Optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={option === 'jewellery' ? 'e.g. Gold necklace purchase' : 'e.g. Refund received'}
                className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-3 rounded-xl border border-border text-muted hover:text-foreground hover:bg-muted/10 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={redeemMutation.isPending || maxBalancePaise <= 0}
              className="flex-1 py-2.5 px-4 rounded-xl bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{redeemMutation.isPending ? 'Redeeming Scheme...' : 'Redeem & Complete Plan'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
