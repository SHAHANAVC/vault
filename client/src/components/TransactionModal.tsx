'use client';

/**
 * Client Component: TransactionModal
 * "use client" required for:
 * 1. Dynamic tabs: Single (Income/Expense/Transfer) vs Split (Split Income / Split Transfer)
 * 2. Dynamic multi-row allocations using React Hook Form's useFieldArray
 * 3. Live "Remaining to allocate" counter & "Distribute remainder" helper
 * 4. Preventing duplicate bucket selection and client-side balance validations
 */

import React, { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import {
  PublicBucket,
  formatINR,
  rupeesToPaise,
  paiseToRupees,
  SplitIncomeInput,
  SplitTransferInput,
  TransactionInput,
} from '@vault/shared';
import {
  useCreateTransaction,
  useCreateSplitIncome,
  useCreateSplitTransfer,
} from '../lib/transactionHooks';
import {
  X,
  Layers,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  Plus,
  Trash2,
  Sparkles,
  Check,
  AlertCircle,
  Clock,
  Split,
} from 'lucide-react';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  buckets: PublicBucket[];
  initialMode?: 'single' | 'split-income' | 'split-transfer';
  preselectedBucketId?: string;
}

type MainTab = 'single' | 'split';
type SingleType = 'income' | 'expense' | 'transfer';
type SplitMode = 'split-income' | 'split-transfer';

export function TransactionModal({
  isOpen,
  onClose,
  buckets,
  initialMode = 'single',
  preselectedBucketId,
}: TransactionModalProps) {
  const [mainTab, setMainTab] = useState<MainTab>(
    initialMode.startsWith('split') ? 'split' : 'single'
  );
  const [singleType, setSingleType] = useState<SingleType>('income');
  const [splitMode, setSplitMode] = useState<SplitMode>(
    initialMode === 'split-transfer' ? 'split-transfer' : 'split-income'
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createTransaction = useCreateTransaction();
  const createSplitIncome = useCreateSplitIncome();
  const createSplitTransfer = useCreateSplitTransfer();

  // Active buckets available for transactions (exclude archived)
  const activeBuckets = buckets.filter((b) => !b.isArchived);

  // Single Form State
  const [singleAmountRupees, setSingleAmountRupees] = useState<number | ''>('');
  const [fromBucketId, setFromBucketId] = useState<string>(preselectedBucketId || activeBuckets[0]?.id || '');
  const [toBucketId, setToBucketId] = useState<string>(
    activeBuckets.length > 1 ? activeBuckets[1]?.id : activeBuckets[0]?.id || ''
  );
  const [category, setCategory] = useState<string>('Salary');
  const [purpose, setPurpose] = useState<string>('');
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 16));

  // Split Form State (React Hook Form + useFieldArray)
  const {
    register,
    control,
    watch,
    setValue,
    reset: resetSplitForm,
    formState: { isSubmitting },
  } = useForm({
    defaultValues: {
      totalAmountRupees: 0,
      sourceBucketId: preselectedBucketId || activeBuckets[0]?.id || '',
      sourceName: 'Salary',
      purpose: '',
      date: new Date().toISOString().slice(0, 16),
      allocations: [
        { bucketId: activeBuckets[0]?.id || '', amountRupees: 0, note: '' },
        { bucketId: activeBuckets[1]?.id || '', amountRupees: 0, note: '' },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'allocations',
  });

  const watchTotalRupees = watch('totalAmountRupees') || 0;
  const watchAllocations = watch('allocations') || [];
  const watchSourceBucketId = watch('sourceBucketId');

  // Calculate live sum and remaining to allocate
  const allocatedSumRupees = watchAllocations.reduce(
    (sum, row) => sum + (Number(row.amountRupees) || 0),
    0
  );
  const remainingRupees = Number((watchTotalRupees - allocatedSumRupees).toFixed(2));
  const isBalanced = Math.abs(remainingRupees) < 0.001 && watchTotalRupees > 0;
  const isOverAllocated = remainingRupees < -0.001;

  useEffect(() => {
    if (initialMode === 'split-income') {
      setMainTab('split');
      setSplitMode('split-income');
    } else if (initialMode === 'split-transfer') {
      setMainTab('split');
      setSplitMode('split-transfer');
    }
  }, [initialMode]);

  if (!isOpen) return null;

  // Auto distribute remaining amount into last row
  const handleDistributeRemainder = () => {
    if (fields.length === 0 || remainingRupees <= 0) return;
    const lastIndex = fields.length - 1;
    const currentLastAmount = Number(watchAllocations[lastIndex]?.amountRupees || 0);
    const newAmount = Number((currentLastAmount + remainingRupees).toFixed(2));
    setValue(`allocations.${lastIndex}.amountRupees`, newAmount);
  };

  // Submit Single Transaction
  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const amountPaise = rupeesToPaise(Number(singleAmountRupees));
    if (amountPaise <= 0) {
      setSubmitError('Amount must be greater than zero');
      return;
    }

    const idempotencyKey = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      if (singleType === 'income') {
        const payload: TransactionInput = {
          type: 'income',
          toBucketId,
          amount: amountPaise,
          category: category.trim() || 'Income',
          purpose: purpose.trim() || undefined,
          date: new Date(date).toISOString(),
          idempotencyKey,
        };
        await createTransaction.mutateAsync(payload);
      } else if (singleType === 'expense') {
        if (!purpose.trim()) {
          setSubmitError('Purpose is required for expenses');
          return;
        }
        const payload: TransactionInput = {
          type: 'expense',
          fromBucketId,
          amount: amountPaise,
          category: category.trim() || 'Expense',
          purpose: purpose.trim(),
          date: new Date(date).toISOString(),
          idempotencyKey,
        };
        await createTransaction.mutateAsync(payload);
      } else if (singleType === 'transfer') {
        if (fromBucketId === toBucketId) {
          setSubmitError('Source and destination buckets must be different');
          return;
        }
        const payload: TransactionInput = {
          type: 'transfer',
          fromBucketId,
          toBucketId,
          amount: amountPaise,
          purpose: purpose.trim() || undefined,
          date: new Date(date).toISOString(),
          idempotencyKey,
        };
        await createTransaction.mutateAsync(payload);
      }

      onClose();
    } catch (err: any) {
      setSubmitError(err.message || 'Transaction failed');
    }
  };

  // Submit Split Form (Split Income or Split Transfer)
  const handleSplitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!isBalanced) {
      setSubmitError(`Please allocate the entire amount. Remaining: ₹${remainingRupees.toFixed(2)}`);
      return;
    }

    const totalPaise = rupeesToPaise(Number(watchTotalRupees));
    const idempotencyKey = `split_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      if (splitMode === 'split-income') {
        const payload: SplitIncomeInput = {
          totalAmount: totalPaise,
          source: watch('sourceName').trim() || 'Salary',
          purpose: watch('purpose')?.trim() || undefined,
          date: new Date(watch('date')).toISOString(),
          allocations: watchAllocations.map((a) => ({
            bucketId: a.bucketId,
            amount: rupeesToPaise(Number(a.amountRupees)),
            note: a.note?.trim() || undefined,
          })),
          idempotencyKey,
        };
        await createSplitIncome.mutateAsync(payload);
      } else if (splitMode === 'split-transfer') {
        const payload: SplitTransferInput = {
          fromBucketId: watchSourceBucketId,
          totalAmount: totalPaise,
          purpose: watch('purpose')?.trim() || undefined,
          date: new Date(watch('date')).toISOString(),
          destinations: watchAllocations.map((a) => ({
            bucketId: a.bucketId,
            amount: rupeesToPaise(Number(a.amountRupees)),
            note: a.note?.trim() || undefined,
          })),
          idempotencyKey,
        };
        await createSplitTransfer.mutateAsync(payload);
      }

      resetSplitForm();
      onClose();
    } catch (err: any) {
      setSubmitError(err.message || 'Split transaction failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              {mainTab === 'split' ? <Split className="w-5 h-5" /> : <Layers className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {mainTab === 'split' ? 'Split Transaction' : 'Record Transaction'}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {mainTab === 'split'
                  ? 'Atomically distribute income or funds across multiple buckets'
                  : 'Record income, expense, or transfer in the immutable ledger'}
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

        {/* Primary Tabs: Single vs Split */}
        <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 p-2 gap-2">
          <button
            type="button"
            onClick={() => setMainTab('single')}
            className={`flex-1 py-2 px-4 rounded-xl text-xs font-semibold transition-all ${
              mainTab === 'single'
                ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm border border-zinc-200 dark:border-zinc-700'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Single Transaction
          </button>
          <button
            type="button"
            onClick={() => setMainTab('split')}
            className={`flex-1 py-2 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              mainTab === 'split'
                ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm border border-zinc-200 dark:border-zinc-700'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Split Allocation
          </button>
        </div>

        {submitError && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
            {submitError}
          </div>
        )}

        {/* ===================================================================
            SINGLE TRANSACTION FORM
           =================================================================== */}
        {mainTab === 'single' && (
          <form onSubmit={handleSingleSubmit} className="p-6 space-y-4">
            {/* Type selector: Income, Expense, Transfer */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSingleType('income')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-medium border transition-all ${
                  singleType === 'income'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 ring-2 ring-emerald-500/20'
                    : 'bg-zinc-50 dark:bg-zinc-800/40 text-zinc-600 dark:text-zinc-400 border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <ArrowDownLeft className="w-4 h-4" />
                Income
              </button>
              <button
                type="button"
                onClick={() => setSingleType('expense')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-medium border transition-all ${
                  singleType === 'expense'
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 ring-2 ring-red-500/20'
                    : 'bg-zinc-50 dark:bg-zinc-800/40 text-zinc-600 dark:text-zinc-400 border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <ArrowUpRight className="w-4 h-4" />
                Expense
              </button>
              <button
                type="button"
                onClick={() => setSingleType('transfer')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-medium border transition-all ${
                  singleType === 'transfer'
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 ring-2 ring-blue-500/20'
                    : 'bg-zinc-50 dark:bg-zinc-800/40 text-zinc-600 dark:text-zinc-400 border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <ArrowRightLeft className="w-4 h-4" />
                Transfer
              </button>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Amount (₹)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-zinc-400">
                  ₹
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={singleAmountRupees}
                  onChange={(e) => setSingleAmountRupees(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  className="w-full pl-8 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                />
              </div>
            </div>

            {/* Bucket Pickers */}
            {singleType === 'income' && (
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Destination Bucket
                </label>
                <select
                  value={toBucketId}
                  onChange={(e) => setToBucketId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  {activeBuckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({formatINR(b.balance)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {singleType === 'expense' && (
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Source Bucket
                </label>
                <select
                  value={fromBucketId}
                  onChange={(e) => setFromBucketId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  {activeBuckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({formatINR(b.balance)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {singleType === 'transfer' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    From Bucket
                  </label>
                  <select
                    value={fromBucketId}
                    onChange={(e) => setFromBucketId(e.target.value)}
                    className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-medium text-zinc-900 dark:text-zinc-100"
                  >
                    {activeBuckets.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({formatINR(b.balance)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    To Bucket
                  </label>
                  <select
                    value={toBucketId}
                    onChange={(e) => setToBucketId(e.target.value)}
                    className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-medium text-zinc-900 dark:text-zinc-100"
                  >
                    {activeBuckets
                      .filter((b) => b.id !== fromBucketId)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({formatINR(b.balance)})
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            )}

            {/* Category / Source */}
            {singleType !== 'transfer' && (
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  {singleType === 'income' ? 'Income Source / Category' : 'Expense Category'}
                </label>
                <input
                  type="text"
                  placeholder={singleType === 'income' ? 'e.g. Salary, Freelance, Dividend' : 'e.g. Groceries, Rent, Utilities'}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>
            )}

            {/* Purpose / Note */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Purpose / Description {singleType === 'expense' && <span className="text-red-500">*</span>}
              </label>
              <input
                type="text"
                placeholder="Brief description or purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100"
              />
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Date & Time
              </label>
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100"
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!singleAmountRupees || singleAmountRupees <= 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-xs rounded-xl shadow-md transition-all"
              >
                <Check className="w-4 h-4" />
                Record Transaction
              </button>
            </div>
          </form>
        )}

        {/* ===================================================================
            SPLIT TRANSACTION FORM (Split Income / Split Transfer)
           =================================================================== */}
        {mainTab === 'split' && (
          <form onSubmit={handleSplitSubmit} className="p-6 space-y-5">
            {/* Sub-modes: Split Income vs Split Transfer */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSplitMode('split-income')}
                className={`py-2 px-3 rounded-xl text-xs font-medium border transition-all ${
                  splitMode === 'split-income'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 ring-2 ring-emerald-500/20'
                    : 'bg-zinc-50 dark:bg-zinc-800/40 text-zinc-600 dark:text-zinc-400 border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                Split Income (e.g. Salary)
              </button>
              <button
                type="button"
                onClick={() => setSplitMode('split-transfer')}
                className={`py-2 px-3 rounded-xl text-xs font-medium border transition-all ${
                  splitMode === 'split-transfer'
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 ring-2 ring-blue-500/20'
                    : 'bg-zinc-50 dark:bg-zinc-800/40 text-zinc-600 dark:text-zinc-400 border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                Split Transfer (From 1 Bucket)
              </button>
            </div>

            {/* Source Details */}
            <div className="grid grid-cols-2 gap-3">
              {splitMode === 'split-transfer' ? (
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Source Bucket (To Debit)
                  </label>
                  <select
                    {...register('sourceBucketId', { required: true })}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100"
                  >
                    {activeBuckets.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({formatINR(b.balance)})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Income Source / Category
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Monthly Salary, Freelance"
                    {...register('sourceName', { required: true })}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Total Amount to Distribute (₹)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-400">
                    ₹
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    {...register('totalAmountRupees', { valueAsNumber: true, required: true })}
                    className="w-full pl-7 pr-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-semibold text-zinc-900 dark:text-zinc-100"
                  />
                </div>
              </div>
            </div>

            {/* Live Remaining Balance Pill */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/60">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    isBalanced
                      ? 'bg-emerald-500 animate-pulse'
                      : isOverAllocated
                      ? 'bg-red-500'
                      : 'bg-amber-500'
                  }`}
                />
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  {isBalanced
                    ? '100% Allocated (Balanced)'
                    : isOverAllocated
                    ? 'Over-allocated by:'
                    : 'Remaining to allocate:'}
                </span>
                <span
                  className={`text-xs font-bold ${
                    isBalanced
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : isOverAllocated
                      ? 'text-red-500'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  ₹{Math.abs(remainingRupees).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {remainingRupees > 0 && (
                <button
                  type="button"
                  onClick={handleDistributeRemainder}
                  className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors border border-blue-500/20"
                >
                  <Sparkles className="w-3 h-3" />
                  Fill Remainder into Last Row
                </button>
              )}
            </div>

            {/* Allocation Rows */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Destination Allocations ({fields.length})
                </label>
                <button
                  type="button"
                  onClick={() =>
                    append({
                      bucketId: activeBuckets.find(
                        (b) => !watchAllocations.some((a) => a.bucketId === b.id)
                      )?.id || activeBuckets[0]?.id || '',
                      amountRupees: 0,
                      note: '',
                    })
                  }
                  disabled={fields.length >= 15}
                  className="flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Allocation
                </button>
              </div>

              {fields.map((field, index) => {
                // Prevent duplicate bucket selection
                const selectedBucketIds = watchAllocations.map((a, i) => (i !== index ? a.bucketId : null));
                const availableBuckets = activeBuckets.filter(
                  (b) =>
                    !selectedBucketIds.includes(b.id) &&
                    (splitMode !== 'split-transfer' || b.id !== watchSourceBucketId)
                );

                return (
                  <div
                    key={field.id}
                    className="flex items-center gap-2 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200/80 dark:border-zinc-700/60"
                  >
                    {/* Bucket Picker */}
                    <div className="flex-1">
                      <select
                        {...register(`allocations.${index}.bucketId`, { required: true })}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-medium text-zinc-900 dark:text-zinc-100"
                      >
                        {availableBuckets.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({formatINR(b.balance)})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Amount */}
                    <div className="w-28 relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400 font-semibold">
                        ₹
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="0.00"
                        {...register(`allocations.${index}.amountRupees`, { valueAsNumber: true, required: true })}
                        className="w-full pl-6 pr-2 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-semibold text-zinc-900 dark:text-zinc-100"
                      />
                    </div>

                    {/* Optional Note */}
                    <div className="w-36">
                      <input
                        type="text"
                        placeholder="Note (optional)"
                        {...register(`allocations.${index}.note`)}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                      />
                    </div>

                    {/* Remove Row Button */}
                    {fields.length > 1 && (
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="p-1.5 text-zinc-400 hover:text-red-500 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Date & Purpose */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Overall Purpose / Memo
                </label>
                <input
                  type="text"
                  placeholder="e.g. October Salary Split"
                  {...register('purpose')}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Date
                </label>
                <input
                  type="datetime-local"
                  {...register('date', { required: true })}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !isBalanced}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-xs rounded-xl shadow-md transition-all"
              >
                {isSubmitting ? (
                  <span>Executing Split...</span>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Save Split Allocation
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
