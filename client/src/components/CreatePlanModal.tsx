'use client';

/**
 * Client Component: CreatePlanModal
 * 
 * Form modal for creating Phase 7 financial plans (EMI and Kuri only)
 * with real-time preview, bucket balance indicators, and strict integer-paise precision.
 */

import React, { useState, useMemo } from 'react';
import {
  formatINR,
  createPlanSchema,
  CreatePlanInput,
  calculateInstallmentsCount,
  calculateNextInstallmentAmount,
  calculateNextDueDate,
} from '@vault/shared';
import { useCreatePlan } from '../lib/planHooks';
import { useBuckets } from '../lib/bucketHooks';
import {
  X,
  CreditCard,
  PiggyBank,
  Calendar,
  AlertCircle,
  Shield,
  Eye,
  Sparkles,
} from 'lucide-react';

interface CreatePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreatePlanModal({ isOpen, onClose }: CreatePlanModalProps) {
  const [kind, setKind] = useState<'emi' | 'kuri' | 'gold_scheme'>('emi');
  const [apiError, setApiError] = useState<string | null>(null);

  const { data: bucketsData } = useBuckets();
  const buckets = useMemo(() => bucketsData?.buckets || [], [bucketsData]);
  const createPlanMutation = useCreatePlan();

  // Form State
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [jewellerName, setJewellerName] = useState('');
  const [bonusRupees, setBonusRupees] = useState('');
  const [totalRupees, setTotalRupees] = useState('');
  const [monthlyRupees, setMonthlyRupees] = useState('');
  const [totalInstallmentsStr, setTotalInstallmentsStr] = useState('20');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [dueDay, setDueDay] = useState(() => new Date().getDate().toString());
  const [reminderDaysBefore, setReminderDaysBefore] = useState('3');
  const [customPayBucketId, setCustomPayBucketId] = useState<string | null>(null);
  const [customKuriBucketId, setCustomKuriBucketId] = useState<string | null>(null);
  const [customGoldBucketId, setCustomGoldBucketId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<'shared' | 'private'>('shared');

  // Filter buckets for pay-from, kuri, and gold_scheme
  const payingBuckets = useMemo(() => {
    return buckets.filter((b) => !b.isArchived && (b.type === 'bank' || b.type === 'cash'));
  }, [buckets]);

  const kuriBuckets = useMemo(() => {
    return buckets.filter((b) => !b.isArchived && b.type === 'kuri');
  }, [buckets]);

  const goldBuckets = useMemo(() => {
    return buckets.filter((b) => !b.isArchived && b.type === 'gold_scheme');
  }, [buckets]);

  const payFromBucketId = customPayBucketId ?? (payingBuckets[0]?.id || '');
  const kuriBucketId = customKuriBucketId ?? (kuriBuckets[0]?.id || '');
  const goldBucketId = customGoldBucketId ?? (goldBuckets[0]?.id || '');

  // Real-time Derived State Preview
  const preview = useMemo(() => {
    const monthlyPaise = Math.round((parseFloat(monthlyRupees) || 0) * 100);
    const dayNum = parseInt(dueDay, 10) || 1;
    const sDate = startDate || new Date().toISOString();

    if (kind === 'emi') {
      const totalPaise = Math.round((parseFloat(totalRupees) || 0) * 100);
      if (totalPaise <= 0 || monthlyPaise <= 0 || monthlyPaise > totalPaise) {
        return null;
      }
      const count = calculateInstallmentsCount('emi', totalPaise, monthlyPaise);
      const lastAmount = calculateNextInstallmentAmount(
        'emi',
        totalPaise,
        monthlyPaise,
        monthlyPaise * (count - 1)
      );
      const finalDueDate = calculateNextDueDate(sDate, dayNum, count - 1);
      const finishMonthYear = new Date(finalDueDate).toLocaleDateString('en-IN', {
        month: 'short',
        year: 'numeric',
      });

      return {
        count,
        monthlyPaise,
        lastAmount,
        isUneven: lastAmount !== monthlyPaise,
        finishMonthYear,
        totalPaise,
        bonusPaise: 0,
        textPreview: `${count} installments of ${formatINR(monthlyPaise)}, matures ${finishMonthYear}`,
      };
    } else if (kind === 'kuri') {
      const installmentsCount = parseInt(totalInstallmentsStr, 10) || 0;
      if (monthlyPaise <= 0 || installmentsCount <= 0) {
        return null;
      }
      const totalCorpus = monthlyPaise * installmentsCount;
      const finalDueDate = calculateNextDueDate(sDate, dayNum, installmentsCount - 1);
      const finishMonthYear = new Date(finalDueDate).toLocaleDateString('en-IN', {
        month: 'short',
        year: 'numeric',
      });

      return {
        count: installmentsCount,
        monthlyPaise,
        lastAmount: monthlyPaise,
        isUneven: false,
        finishMonthYear,
        totalPaise: totalCorpus,
        bonusPaise: 0,
        textPreview: `${installmentsCount} installments of ${formatINR(monthlyPaise)}, corpus ${formatINR(totalCorpus)}, matures ${finishMonthYear}`,
      };
    } else {
      // gold_scheme
      const installmentsCount = parseInt(totalInstallmentsStr, 10) || 0;
      const bonusPaise = Math.round((parseFloat(bonusRupees) || 0) * 100);
      if (monthlyPaise <= 0 || installmentsCount <= 0) {
        return null;
      }
      const totalInstallmentsAmount = monthlyPaise * installmentsCount;
      const totalValue = totalInstallmentsAmount + (bonusPaise > 0 ? bonusPaise : 0);
      const finalDueDate = calculateNextDueDate(sDate, dayNum, installmentsCount - 1);
      const finishMonthYear = new Date(finalDueDate).toLocaleDateString('en-IN', {
        month: 'short',
        year: 'numeric',
      });

      return {
        count: installmentsCount,
        monthlyPaise,
        lastAmount: monthlyPaise,
        isUneven: false,
        finishMonthYear,
        totalPaise: totalValue,
        bonusPaise,
        textPreview: `${installmentsCount} installments of ${formatINR(monthlyPaise)}, bonus ${formatINR(bonusPaise)}, total value ${formatINR(totalValue)}, matures ${finishMonthYear}`,
      };
    }
  }, [kind, totalRupees, monthlyRupees, totalInstallmentsStr, bonusRupees, startDate, dueDay]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    const monthlyPaise = Math.round((parseFloat(monthlyRupees) || 0) * 100);
    const dayNum = parseInt(dueDay, 10);
    const remDays = parseInt(reminderDaysBefore, 10) || 3;

    if (!payFromBucketId) {
      setApiError('Please select a payment source bucket');
      return;
    }

    let payload: CreatePlanInput;

    if (kind === 'emi') {
      const totalPaise = Math.round((parseFloat(totalRupees) || 0) * 100);
      if (totalPaise <= 0) {
        setApiError('Total amount must be greater than zero');
        return;
      }
      if (monthlyPaise <= 0) {
        setApiError('Monthly installment must be greater than zero');
        return;
      }
      if (monthlyPaise > totalPaise) {
        setApiError('Monthly installment cannot exceed total amount');
        return;
      }

      payload = {
        kind: 'emi',
        name: name.trim(),
        note: note.trim() || undefined,
        totalAmount: totalPaise,
        monthlyAmount: monthlyPaise,
        startDate: new Date(startDate).toISOString(),
        dueDay: dayNum,
        payFromBucketId,
        reminderDaysBefore: remDays,
        visibility,
      };
    } else if (kind === 'kuri') {
      const installmentsCount = parseInt(totalInstallmentsStr, 10);
      if (monthlyPaise <= 0) {
        setApiError('Monthly installment must be greater than zero');
        return;
      }
      if (!installmentsCount || installmentsCount < 1) {
        setApiError('Total installments must be at least 1');
        return;
      }
      if (!kuriBucketId) {
        setApiError('Please select a Kuri accumulation bucket');
        return;
      }
      if (kuriBucketId === payFromBucketId) {
        setApiError('Source bucket and Kuri bucket must be different');
        return;
      }

      payload = {
        kind: 'kuri',
        name: name.trim(),
        note: note.trim() || undefined,
        monthlyAmount: monthlyPaise,
        totalInstallments: installmentsCount,
        startDate: new Date(startDate).toISOString(),
        dueDay: dayNum,
        payFromBucketId,
        kuriBucketId,
        reminderDaysBefore: remDays,
        visibility,
      };
    } else {
      // gold_scheme
      const installmentsCount = parseInt(totalInstallmentsStr, 10);
      const bonusPaise = Math.round((parseFloat(bonusRupees) || 0) * 100);
      if (monthlyPaise <= 0) {
        setApiError('Monthly installment must be greater than zero');
        return;
      }
      if (!installmentsCount || installmentsCount < 1) {
        setApiError('Total installments must be at least 1');
        return;
      }
      if (!goldBucketId) {
        setApiError('Please select a Gold Scheme accumulation bucket');
        return;
      }
      if (goldBucketId === payFromBucketId) {
        setApiError('Source bucket and Gold Scheme bucket must be different');
        return;
      }

      payload = {
        kind: 'gold_scheme',
        name: name.trim(),
        note: note.trim() || undefined,
        jewellerName: jewellerName.trim() || undefined,
        monthlyAmount: monthlyPaise,
        totalInstallments: installmentsCount,
        bonusAmount: bonusPaise > 0 ? bonusPaise : 0,
        startDate: new Date(startDate).toISOString(),
        dueDay: dayNum,
        payFromBucketId,
        goldBucketId,
        reminderDaysBefore: remDays,
        visibility,
      };
    }

    // Validate with shared Zod schema
    const validation = createPlanSchema.safeParse(payload);
    if (!validation.success) {
      const firstError = validation.error.errors[0]?.message;
      setApiError(firstError || 'Invalid plan configuration');
      return;
    }

    createPlanMutation.mutate(payload, {
      onSuccess: () => {
        onClose();
      },
      onError: (err) => {
        setApiError(err.message);
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card text-foreground rounded-3xl border border-border shadow-2xl max-w-xl w-full overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border bg-gradient-to-r from-card to-card-muted/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shadow-xs">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Create Recurring Plan</h2>
              <p className="text-xs text-muted">Fixed EMIs, Kuri plans, and Jewellery Gold Schemes</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground p-2 rounded-xl hover:bg-muted/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Plan Kind Selector */}
        <div className="p-6 pb-2">
          <div className="grid grid-cols-3 gap-2 p-1 bg-muted/15 rounded-2xl border border-border/60">
            <button
              type="button"
              onClick={() => {
                setKind('emi');
                setApiError(null);
              }}
              className={`py-2.5 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                kind === 'emi'
                  ? 'bg-card text-primary shadow-xs border border-border/80 font-bold'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              <CreditCard className="w-4 h-4" />
              <span>EMI Loan</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setKind('kuri');
                setApiError(null);
              }}
              className={`py-2.5 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                kind === 'kuri'
                  ? 'bg-card text-amber-600 dark:text-amber-400 shadow-xs border border-border/80 font-bold'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              <PiggyBank className="w-4 h-4" />
              <span>Kuri</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setKind('gold_scheme');
                setApiError(null);
              }}
              className={`py-2.5 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                kind === 'gold_scheme'
                  ? 'bg-card text-yellow-600 dark:text-yellow-400 shadow-xs border border-border/80 font-bold'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Gold Scheme</span>
            </button>
          </div>
          <p className="text-[11px] text-muted mt-2 px-1">
            {kind === 'emi'
              ? 'Fixed liability payoff commitment. Each monthly installment is recorded as an expense.'
              : kind === 'kuri'
              ? 'Informal community savings pot. Payments accumulate in your Kuri bucket as an asset.'
              : 'Jewellery gold scheme. Monthly installments accumulate in your Gold Scheme asset bucket, with an optional jeweller bonus at maturity.'}
          </p>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 pt-3 space-y-4">
          {apiError && (
            <div className="p-3.5 rounded-2xl bg-negative/10 border border-negative/20 text-negative text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-medium">{apiError}</span>
            </div>
          )}

          {/* Plan Name & Jeweller Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                {kind === 'emi' ? 'Plan Name' : kind === 'kuri' ? 'Kuri Name' : 'Scheme Name'}{' '}
                <span className="text-negative">*</span>
              </label>
              <input
                type="text"
                required
                placeholder={
                  kind === 'emi'
                    ? 'e.g. Bajaj Laptop EMI, Car Loan'
                    : kind === 'kuri'
                    ? 'e.g. KSFE 1 Lakh Chitti, Family Kuri'
                    : 'e.g. Tanishq Golden Harvest, Malabar Smart Buy'
                }
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {kind === 'gold_scheme' && (
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Jeweller / Merchant (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Tanishq, Malabar Gold, Joyalukkas"
                  value={jewellerName}
                  onChange={(e) => setJewellerName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                />
              </div>
            )}
          </div>

          {/* Amount Inputs */}
          {kind === 'emi' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Total Loan Amount (₹) <span className="text-negative">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  placeholder="e.g. 42000"
                  value={totalRupees}
                  onChange={(e) => setTotalRupees(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Monthly Installment (₹) <span className="text-negative">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  placeholder="e.g. 5000"
                  value={monthlyRupees}
                  onChange={(e) => setMonthlyRupees(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          ) : kind === 'kuri' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Monthly Installment (₹) <span className="text-negative">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  placeholder="e.g. 5000"
                  value={monthlyRupees}
                  onChange={(e) => setMonthlyRupees(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Total Installments (Months) <span className="text-negative">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  required
                  placeholder="e.g. 20"
                  value={totalInstallmentsStr}
                  onChange={(e) => setTotalInstallmentsStr(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Monthly Installment (₹) <span className="text-negative">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  placeholder="e.g. 5000"
                  value={monthlyRupees}
                  onChange={(e) => setMonthlyRupees(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Installments (Months) <span className="text-negative">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  required
                  placeholder="e.g. 11"
                  value={totalInstallmentsStr}
                  onChange={(e) => setTotalInstallmentsStr(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Bonus Amount (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 5000"
                  value={bonusRupees}
                  onChange={(e) => setBonusRupees(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          )}

          {/* Schedule Configuration */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Start Date <span className="text-negative">*</span>
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Due Day of Month <span className="text-negative">*</span>
              </label>
              <input
                type="number"
                min="1"
                max="31"
                required
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Alert Reminder
              </label>
              <select
                value={reminderDaysBefore}
                onChange={(e) => setReminderDaysBefore(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
              >
                <option value="1">1 day before</option>
                <option value="3">3 days before</option>
                <option value="5">5 days before</option>
                <option value="7">7 days before</option>
              </select>
            </div>
          </div>

          {/* Bucket Linkages */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Pay-From Bucket <span className="text-negative">*</span>
              </label>
              <select
                required
                value={payFromBucketId}
                onChange={(e) => setCustomPayBucketId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
              >
                {payingBuckets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.type}) — {formatINR(b.balance)}
                  </option>
                ))}
              </select>
            </div>

            {kind === 'kuri' && (
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Kuri Asset Bucket <span className="text-negative">*</span>
                </label>
                {kuriBuckets.length === 0 ? (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-[11px]">
                    Please create a bucket with type &quot;kuri&quot; under Financial Buckets first.
                  </div>
                ) : (
                  <select
                    required
                    value={kuriBucketId}
                    onChange={(e) => setCustomKuriBucketId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                  >
                    {kuriBuckets.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} (kuri) — {formatINR(b.balance)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {kind === 'gold_scheme' && (
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Gold Scheme Asset Bucket <span className="text-negative">*</span>
                </label>
                {goldBuckets.length === 0 ? (
                  <div className="p-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-[11px]">
                    Please create a bucket with type &quot;gold_scheme&quot; under Financial Buckets first.
                  </div>
                ) : (
                  <select
                    required
                    value={goldBucketId}
                    onChange={(e) => setCustomGoldBucketId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                  >
                    {goldBuckets.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} (gold_scheme) — {formatINR(b.balance)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {/* Visibility and Note */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Visibility
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibility('shared')}
                  className={`flex-1 py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    visibility === 'shared'
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'border-border text-muted hover:text-foreground'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Shared</span>
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility('private')}
                  className={`flex-1 py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    visibility === 'private'
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'border-border text-muted hover:text-foreground'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Private</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Note (Optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Loan reference #8812"
                className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Live Dynamic Preview Card */}
          {preview && (
            <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Schedule Summary
                </span>
                <span className="font-mono font-bold text-primary">
                  {formatINR(preview.totalPaise)} total
                </span>
              </div>
              <p className="text-xs text-foreground/90 font-medium bg-background/60 p-2 rounded-xl border border-border/40">
                {preview.textPreview}
              </p>
              <div className="grid grid-cols-3 gap-2 text-[11px] pt-1">
                <div>
                  <span className="text-muted block">Installments</span>
                  <span className="font-semibold text-foreground">{preview.count} months</span>
                </div>
                <div>
                  <span className="text-muted block">Monthly</span>
                  <span className="font-mono font-semibold text-foreground">
                    {formatINR(preview.monthlyPaise)}
                  </span>
                </div>
                <div>
                  <span className="text-muted block">Finishes by</span>
                  <span className="font-semibold text-foreground">{preview.finishMonthYear}</span>
                </div>
              </div>
              {preview.isUneven && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 pt-1 border-t border-primary/10">
                  Note: Final installment will be {formatINR(preview.lastAmount)} to settle the exact balance.
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold text-muted hover:text-foreground hover:bg-muted/10 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createPlanMutation.isPending}
              className="flex-2 py-2.5 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {createPlanMutation.isPending ? 'Creating Plan...' : 'Create Plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
