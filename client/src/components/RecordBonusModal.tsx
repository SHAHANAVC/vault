'use client';

/**
 * Client Component: RecordBonusModal
 * 
 * Dialog for recording merchant / jeweller bonus for a Gold Scheme plan.
 * Credited as real income under category "Scheme bonus" into the gold_scheme asset bucket.
 */

import React, { useState } from 'react';
import { formatINR, PublicPlan } from '@vault/shared';
import { useRecordBonus } from '../lib/planHooks';
import {
  X,
  Sparkles,
  AlertCircle,
  Coins,
} from 'lucide-react';

interface RecordBonusModalProps {
  plan: PublicPlan | null;
  isOpen: boolean;
  onClose: () => void;
}

export function RecordBonusModal({ plan, isOpen, onClose }: RecordBonusModalProps) {
  const recordBonusMutation = useRecordBonus();

  const defaultBonusRupees = plan?.bonusAmount ? (plan.bonusAmount / 100).toString() : '';
  const [amountRupees, setAmountRupees] = useState(defaultBonusRupees);
  const [note, setNote] = useState('Scheme bonus credited');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [apiError, setApiError] = useState<string | null>(null);

  if (!isOpen || !plan) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    const amountPaise = amountRupees ? Math.round((parseFloat(amountRupees) || 0) * 100) : undefined;
    if (amountPaise !== undefined && amountPaise <= 0) {
      setApiError('Bonus amount must be greater than zero');
      return;
    }

    recordBonusMutation.mutate(
      {
        id: plan.id,
        data: {
          amount: amountPaise,
          note: note.trim() || undefined,
          date: date ? new Date(date).toISOString() : undefined,
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
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Record Scheme Bonus</h2>
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {apiError && (
            <div className="p-3 rounded-xl bg-negative/10 border border-negative/20 text-negative text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{apiError}</span>
            </div>
          )}

          {/* Ledger Effect Banner */}
          <div className="p-3.5 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-800 dark:text-yellow-300 text-xs space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <Coins className="w-4 h-4" />
              Income Credit & Ledger Effect
            </div>
            <p className="text-[11px] leading-relaxed text-yellow-700 dark:text-yellow-400">
              This entry is recorded as real household <strong>INCOME</strong> (category: &quot;Scheme bonus&quot;) credited directly into your Gold Scheme bucket <strong>{plan.goldBucketName || 'Asset Bucket'}</strong>.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Bonus Amount (₹)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="e.g. 5000"
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
            {plan.bonusAmount ? (
              <span className="text-[11px] text-muted mt-1 block">
                Target bonus configured in plan: {formatINR(plan.bonusAmount)}
              </span>
            ) : null}
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Credit Date
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
              placeholder="e.g. 11th month jeweller contribution"
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-3 rounded-xl border border-border text-muted hover:text-foreground hover:bg-muted/10 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={recordBonusMutation.isPending}
              className="flex-1 py-2 px-3 rounded-xl bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{recordBonusMutation.isPending ? 'Crediting...' : 'Record Bonus'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
