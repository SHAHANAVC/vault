'use client';

/**
 * Client Component: AdjustmentModal
 * "use client" required for:
 * 1. Interactive modal state and form inputs (React Hook Form)
 * 2. Plus/Minus polarity toggle for balance adjustments
 * 3. Client mutation execution via useCreateAdjustment
 */

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  PublicBucket,
  formatINR,
  formatLocalDateTimeForInput,
  rupeesToPaise,
  paiseToRupees,
  adjustmentSchema,
  AdjustmentInput,
} from '@vault/shared';
import { useCreateAdjustment } from '../lib/transactionHooks';
import { X, SlidersHorizontal, AlertCircle, Plus, Minus, Check } from 'lucide-react';

interface AdjustmentModalProps {
  bucket: PublicBucket | null;
  isOpen: boolean;
  onClose: () => void;
}

interface AdjustmentFormValues {
  polarity: 'positive' | 'negative';
  amountRupees: number;
  reason: string;
  date: string;
}

export function AdjustmentModal({ bucket, isOpen, onClose }: AdjustmentModalProps) {
  const createAdjustment = useCreateAdjustment();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AdjustmentFormValues>({
    defaultValues: {
      polarity: 'positive',
      amountRupees: 0,
      reason: '',
      date: formatLocalDateTimeForInput(), // datetime-local format
    },
  });

  useEffect(() => {
    if (isOpen) {
      setValue('date', formatLocalDateTimeForInput());
    }
  }, [isOpen, setValue]);

  const polarity = watch('polarity');
  const amountRupees = watch('amountRupees') || 0;

  if (!isOpen || !bucket) return null;

  const currentBalanceRupees = paiseToRupees(bucket.balance);
  const adjustedBalanceRupees =
    polarity === 'positive'
      ? currentBalanceRupees + (amountRupees || 0)
      : currentBalanceRupees - (amountRupees || 0);

  const onSubmit = async (data: AdjustmentFormValues) => {
    setSubmitError(null);
    try {
      const paise = rupeesToPaise(Number(data.amountRupees));
      if (paise <= 0) {
        setSubmitError('Adjustment amount must be greater than zero');
        return;
      }

      const signedAmount = data.polarity === 'positive' ? paise : -paise;
      const idempotencyKey = `adj_${bucket.id}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const payload: AdjustmentInput = {
        type: 'adjustment',
        bucketId: bucket.id,
        amount: signedAmount,
        reason: data.reason.trim(),
        date: new Date(data.date).toISOString(),
        idempotencyKey,
      };

      await createAdjustment.mutateAsync(payload);
      reset();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to apply balance adjustment';
      setSubmitError(message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Adjust Bucket Balance
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Correct recorded balance for <span className="font-medium text-zinc-700 dark:text-zinc-300">{bucket.name}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Audit Transparency Banner */}
        <div className="p-4 mx-6 mt-6 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/60 text-xs text-zinc-600 dark:text-zinc-300 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">Immutable Audit Record:</span> Balance adjustments correct recorded balances to match physical cash or bank passbooks. This adjustment is logged with your reason in the permanent ledger.
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">
          {submitError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
              {submitError}
            </div>
          )}

          {/* Current & Simulated Balance */}
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800">
            <div>
              <div className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Current Balance</div>
              <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mt-0.5">
                {formatINR(bucket.balance)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">New Balance</div>
              <div className={`text-sm font-semibold mt-0.5 ${adjustedBalanceRupees < 0 ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                ₹{adjustedBalanceRupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {/* Direction Toggle: Increase (+) vs Decrease (-) */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
              Adjustment Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setValue('polarity', 'positive')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-medium text-xs border transition-all ${
                  polarity === 'positive'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 ring-2 ring-emerald-500/20'
                    : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 border-transparent hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                <Plus className="w-4 h-4" />
                Increase Balance (Credit)
              </button>
              <button
                type="button"
                onClick={() => setValue('polarity', 'negative')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-medium text-xs border transition-all ${
                  polarity === 'negative'
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 ring-2 ring-red-500/20'
                    : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 border-transparent hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                <Minus className="w-4 h-4" />
                Decrease Balance (Debit)
              </button>
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
              Adjustment Amount (₹)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-zinc-400">
                ₹
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                {...register('amountRupees', { valueAsNumber: true })}
                className="w-full pl-8 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition-all"
              />
            </div>
            {errors.amountRupees && (
              <p className="mt-1 text-xs text-red-500">{errors.amountRupees.message}</p>
            )}
          </div>

          {/* Mandatory Reason */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
              Mandatory Reason <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g., Bank interest credited, unrecorded ATM fee, physical cash count match"
              {...register('reason', { required: 'Reason is required (min 3 chars)', minLength: 3, maxLength: 200 })}
              className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition-all placeholder:text-zinc-400"
            />
            {errors.reason && (
              <p className="mt-1 text-xs text-red-500">{errors.reason.message}</p>
            )}
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
              Date & Time
            </label>
            <input
              type="datetime-local"
              {...register('date', { required: true })}
              className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition-all"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || amountRupees <= 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-medium text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all"
            >
              {isSubmitting ? (
                <span>Recording Adjustment...</span>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Apply Adjustment
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
