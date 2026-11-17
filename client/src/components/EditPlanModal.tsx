'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { formatINR, PublicPlan, UpdatePlanInput } from '@vault/shared';
import { useUpdatePlan } from '../lib/planHooks';
import { useBuckets } from '../lib/bucketHooks';
import { X, Calendar, Wallet, AlertCircle, Edit2 } from 'lucide-react';

interface EditPlanModalProps {
  plan: PublicPlan | null;
  isOpen: boolean;
  onClose: () => void;
}

export function EditPlanModal({ plan, isOpen, onClose }: EditPlanModalProps) {
  const { data: bucketsData } = useBuckets();
  const buckets = useMemo(() => bucketsData?.buckets || [], [bucketsData]);
  const updatePlanMutation = useUpdatePlan();

  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [dueDay, setDueDay] = useState('5');
  const [reminderDaysBefore, setReminderDaysBefore] = useState('3');
  const [payFromBucketId, setPayFromBucketId] = useState('');
  const [monthlyRupees, setMonthlyRupees] = useState('');
  const [totalRupees, setTotalRupees] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);

  // Eligible paying accounts (Cash & Bank)
  const payingBuckets = useMemo(() => {
    return buckets.filter((b) => !b.isArchived && (b.type === 'bank' || b.type === 'cash'));
  }, [buckets]);

  const canEditTerms = plan ? plan.paidInstallments === 0 : false;

  useEffect(() => {
    if (plan) {
      setName(plan.name || '');
      setNote(plan.note || '');
      setDueDay(plan.dueDay ? plan.dueDay.toString() : '5');
      setReminderDaysBefore(
        plan.reminderDaysBefore !== undefined ? plan.reminderDaysBefore.toString() : '3'
      );
      setPayFromBucketId(plan.payFromBucketId || payingBuckets[0]?.id || '');
      setMonthlyRupees(plan.monthlyAmount ? (plan.monthlyAmount / 100).toString() : '');
      setTotalRupees(plan.totalAmount ? (plan.totalAmount / 100).toString() : '');
      setApiError(null);
    }
  }, [plan, payingBuckets]);

  if (!isOpen || !plan) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    if (!name.trim()) {
      setApiError('Plan name is required');
      return;
    }

    const payload: UpdatePlanInput = {
      name: name.trim(),
      note: note.trim() || undefined,
      dueDay: parseInt(dueDay, 10) || 1,
      reminderDaysBefore: parseInt(reminderDaysBefore, 10) || 0,
      payFromBucketId: payFromBucketId || undefined,
    };

    if (canEditTerms) {
      const parsedMonthly = parseFloat(monthlyRupees);
      if (!isNaN(parsedMonthly) && parsedMonthly > 0) {
        payload.monthlyAmount = Math.round(parsedMonthly * 100);
      }
      const parsedTotal = parseFloat(totalRupees);
      if (!isNaN(parsedTotal) && parsedTotal > 0) {
        payload.totalAmount = Math.round(parsedTotal * 100);
      }
    }

    updatePlanMutation.mutate(
      { id: plan.id, data: payload },
      {
        onSuccess: () => {
          onClose();
        },
        onError: (err) => {
          setApiError(err.message || 'Failed to update plan');
        },
      }
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative bg-card border border-border text-foreground rounded-2xl w-full max-w-lg shadow-2xl my-auto max-h-[92vh] flex flex-col overflow-hidden transition-all">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Edit2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-foreground">Edit Plan</h2>
              <span className="text-xs text-muted font-sans capitalize">
                {plan.kind === 'kuri' ? 'Kuri Chit' : plan.kind === 'gold_scheme' ? 'Gold Scheme' : 'EMI Plan'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-muted/10 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {apiError && (
              <div className="p-3 rounded-xl bg-negative/10 border border-negative/20 text-negative text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{apiError}</span>
              </div>
            )}

            {/* Plan Name */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                Plan Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Laptop EMI, Karad Kuri"
                className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all font-semibold"
              />
            </div>

            {/* Pay From Bucket */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                Primary Account To Pay From
              </label>
              <select
                value={payFromBucketId}
                onChange={(e) => setPayFromBucketId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all cursor-pointer font-medium"
              >
                {payingBuckets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.type === 'bank' ? '🏛️' : '💵'} {b.name} ({formatINR(b.balance)})
                  </option>
                ))}
              </select>
            </div>

            {/* Due Day & Reminder */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                  Monthly Due Day (1-31)
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={dueDay}
                  onChange={(e) => setDueDay(e.target.value)}
                  onWheel={(e) => (e.target as HTMLInputElement).blur()}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                  Alert Reminder Days
                </label>
                <select
                  value={reminderDaysBefore}
                  onChange={(e) => setReminderDaysBefore(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all cursor-pointer"
                >
                  <option value="1">1 day before</option>
                  <option value="2">2 days before</option>
                  <option value="3">3 days before</option>
                  <option value="5">5 days before</option>
                  <option value="7">7 days before</option>
                </select>
              </div>
            </div>

            {/* Terms editing (Available only before first installment is paid) */}
            {canEditTerms ? (
              <div className="p-3.5 rounded-xl bg-muted/5 border border-border/80 space-y-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-primary block">
                  Editable Terms (No installments paid yet)
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">
                      Monthly Installment (₹)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="1"
                      value={monthlyRupees}
                      onChange={(e) => setMonthlyRupees(e.target.value)}
                      onWheel={(e) => (e.target as HTMLInputElement).blur()}
                      className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-sm font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">
                      Total Commitment (₹)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="1"
                      value={totalRupees}
                      onChange={(e) => setTotalRupees(e.target.value)}
                      onWheel={(e) => (e.target as HTMLInputElement).blur()}
                      className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-sm font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-muted/10 border border-border/60 text-xs text-muted flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-muted shrink-0 mt-0.5" />
                <p>
                  Financial terms (Total & Installment amounts) are locked because{' '}
                  <strong className="text-foreground">{plan.paidInstallments} installment(s)</strong> have already been paid into this plan.
                </p>
              </div>
            )}

            {/* Note / Purpose */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                Note / Remarks (Optional)
              </label>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Account number, chit auction details"
                className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all resize-none"
              />
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="px-5 py-3.5 flex items-center justify-end gap-3 border-t border-border bg-card shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={updatePlanMutation.isPending}
              className="px-4 py-2 rounded-xl text-xs font-medium text-muted hover:text-foreground hover:bg-muted/10 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updatePlanMutation.isPending}
              className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-xs tracking-wide transition-all shadow-md shadow-primary/20 disabled:opacity-50 cursor-pointer"
            >
              {updatePlanMutation.isPending ? 'Saving Changes...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

