'use client';

/**
 * Client Component: TransactionModal
 * 
 * Simplified, user-friendly modal for daily cash flow logging:
 * 1. Add Income (Direct deposit into Cash or Bank)
 * 2. Add Expense (Direct deduction from Cash or Bank with category)
 * 3. Transfer / Move to Savings (Zero-friction account-to-account or partner transfer)
 */

import React, { useState } from 'react';
import {
  PublicBucket,
  formatINR,
  formatLocalDateTimeForInput,
  rupeesToPaise,
  TransactionInput,
  PublicTransaction,
} from '@vault/shared';
import { useCreateTransaction, useUpdateTransaction } from '../lib/transactionHooks';
import {
  X,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  Wallet,
  Building2,
  Coins,
  Sparkles,
  PiggyBank,
  Check,
  AlertCircle,
  Calendar,
  Tag,
  FileText,
} from 'lucide-react';

export interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  buckets: PublicBucket[];
  initialMode?: 'income' | 'expense' | 'transfer' | 'single' | 'split-income' | 'split-transfer';
  preselectedBucketId?: string;
  partnerName?: string | null;
  editingTransaction?: PublicTransaction | null;
}

type TabType = 'income' | 'expense' | 'transfer';

const INCOME_QUICK_CATEGORIES = [
  'Salary',
  'From Partner',
  'Kuri Payout / Auction',
  'Cash Inflow',
  'Business',
  'Freelance',
  'Gift',
  'Rental',
  'Other Income',
];

const EXPENSE_QUICK_CATEGORIES = [
  'Groceries',
  'Food & Dining',
  'Rent',
  'Utilities',
  'Transportation',
  'Shopping',
  'Healthcare',
  'Kuri / Chitty',
  'EMI / Loan',
  'Gold Scheme',
  'Entertainment',
  'Miscellaneous',
];

function getBucketIcon(type: string) {
  switch (type) {
    case 'cash':
      return '💵';
    case 'bank':
      return '🏛️';
    case 'kuri':
      return '🪙';
    case 'gold_scheme':
      return '✨';
    default:
      return '💼';
  }
}

export function TransactionModal({
  isOpen,
  onClose,
  buckets,
  initialMode = 'income',
  preselectedBucketId,
  partnerName,
  editingTransaction,
}: TransactionModalProps) {
  // Map initial mode
  const resolvedInitialTab: TabType = editingTransaction
    ? ((editingTransaction.type as TabType) || 'income')
    : initialMode === 'expense'
    ? 'expense'
    : initialMode === 'transfer' || initialMode === 'split-transfer'
    ? 'transfer'
    : 'income';

  const [activeTab, setActiveTab] = useState<TabType>(resolvedInitialTab);
  const [amountRupees, setAmountRupees] = useState<string>('');
  const [selectedBucketId, setSelectedBucketId] = useState<string>('');
  const [toBucketId, setToBucketId] = useState<string>('');
  const [category, setCategory] = useState<string>('Salary');
  const [purpose, setPurpose] = useState<string>('');
  const [date, setDate] = useState<string>(formatLocalDateTimeForInput());
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createTransaction = useCreateTransaction();
  const updateTransaction = useUpdateTransaction();

  // Active buckets (excluding archived)
  const activeBuckets = buckets.filter((b) => !b.isArchived);
  const myBuckets = activeBuckets.filter((b) => b.isOwner);
  const partnerBuckets = activeBuckets.filter((b) => !b.isOwner);

  const [prevOpen, setPrevOpen] = useState(isOpen);

  // Sync state during render when modal is opened or closed
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (isOpen) {
      if (editingTransaction) {
        const mode: TabType = (editingTransaction.type as TabType) || 'income';
        setActiveTab(mode);
        setAmountRupees((editingTransaction.amount / 100).toString());
        setCategory(editingTransaction.category || '');
        setPurpose(editingTransaction.purpose || '');
        setDate(formatLocalDateTimeForInput(new Date(editingTransaction.date)));
        setSubmitError(null);

        const defaultBucket =
          (mode === 'income' ? editingTransaction.toBucketId : editingTransaction.fromBucketId) ||
          activeBuckets[0]?.id ||
          '';
        setSelectedBucketId(defaultBucket);
        setToBucketId(editingTransaction.toBucketId || defaultBucket);
      } else {
        const mode: TabType =
          initialMode === 'expense'
            ? 'expense'
            : initialMode === 'transfer' || initialMode === 'split-transfer'
            ? 'transfer'
            : 'income';

        setActiveTab(mode);
        setAmountRupees('');
        setPurpose('');
        setSubmitError(null);
        setDate(formatLocalDateTimeForInput());

        if (mode === 'income') {
          setCategory('Salary');
        } else if (mode === 'expense') {
          setCategory('Groceries');
        }

        // Default primary bucket
        const defaultBucket =
          preselectedBucketId && activeBuckets.some((b) => b.id === preselectedBucketId)
            ? preselectedBucketId
            : activeBuckets[0]?.id || '';

        setSelectedBucketId(defaultBucket);

        // Default destination bucket for transfers (must be different)
        const diffBucket = activeBuckets.find((b) => b.id !== defaultBucket);
        setToBucketId(diffBucket ? diffBucket.id : defaultBucket);
      }
    }
  }

  if (!isOpen) return null;

  const handleTabChange = (newTab: TabType) => {
    setActiveTab(newTab);
    setSubmitError(null);
    if (newTab === 'income') {
      setCategory('Salary');
    } else if (newTab === 'expense') {
      setCategory('Groceries');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const numericAmount = parseFloat(amountRupees);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setSubmitError('Please enter a valid amount greater than ₹0');
      return;
    }

    const amountPaise = rupeesToPaise(numericAmount);
    const idempotencyKey = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      if (editingTransaction) {
        if (!selectedBucketId) {
          setSubmitError('Please select an account');
          return;
        }
        if (activeTab === 'expense' && !purpose.trim()) {
          setSubmitError('Please add a brief description of what this was for');
          return;
        }
        if (activeTab === 'transfer' && (!toBucketId || selectedBucketId === toBucketId)) {
          setSubmitError('Source and destination accounts must be distinct');
          return;
        }

        await updateTransaction.mutateAsync({
          id: editingTransaction.id,
          data: {
            amount: amountPaise,
            category: activeTab !== 'transfer' ? category.trim() : undefined,
            purpose: purpose.trim() || undefined,
            date: new Date(date).toISOString(),
            fromBucketId: activeTab === 'income' ? undefined : selectedBucketId,
            toBucketId:
              activeTab === 'income'
                ? selectedBucketId
                : activeTab === 'transfer'
                ? toBucketId
                : undefined,
          },
        });
        onClose();
        return;
      }

      if (activeTab === 'income') {
        if (!selectedBucketId) {
          setSubmitError('Please select which account received the income');
          return;
        }

        const payload: TransactionInput = {
          type: 'income',
          toBucketId: selectedBucketId,
          amount: amountPaise,
          category: category.trim() || 'Income',
          purpose: purpose.trim() || undefined,
          date: new Date(date).toISOString(),
          idempotencyKey,
        };

        await createTransaction.mutateAsync(payload);
      } else if (activeTab === 'expense') {
        if (!selectedBucketId) {
          setSubmitError('Please select which account paid the expense');
          return;
        }
        if (!purpose.trim()) {
          setSubmitError('Please add a brief description of what this was for');
          return;
        }

        const payload: TransactionInput = {
          type: 'expense',
          fromBucketId: selectedBucketId,
          amount: amountPaise,
          category: category.trim() || 'Expense',
          purpose: purpose.trim(),
          date: new Date(date).toISOString(),
          idempotencyKey,
        };

        await createTransaction.mutateAsync(payload);
      } else if (activeTab === 'transfer') {
        if (!selectedBucketId || !toBucketId) {
          setSubmitError('Please select both source and destination accounts');
          return;
        }
        if (selectedBucketId === toBucketId) {
          setSubmitError('Source and destination accounts must be different');
          return;
        }

        const payload: TransactionInput = {
          type: 'transfer',
          fromBucketId: selectedBucketId,
          toBucketId,
          amount: amountPaise,
          purpose: purpose.trim() || 'Account Transfer / Savings',
          date: new Date(date).toISOString(),
          idempotencyKey,
        };

        await createTransaction.mutateAsync(payload);
      }

      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      setSubmitError(message);
    }
  };

  const selectedBucket = activeBuckets.find((b) => b.id === selectedBucketId);
  const destinationBucket = activeBuckets.find((b) => b.id === toBucketId);

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center items-end justify-center sm:p-4 p-0 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-lg bg-card text-card-foreground rounded-t-3xl sm:rounded-3xl shadow-2xl border border-border overflow-hidden my-0 sm:my-6 max-h-[92dvh] sm:max-h-[88vh] flex flex-col transition-all">
        {/* Mobile Pull Handle */}
        <div className="pt-2 pb-1 sm:hidden flex justify-center bg-card">
          <div className="w-12 h-1.5 rounded-full bg-muted/40" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-border bg-card/80">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-foreground">
              {editingTransaction
                ? `Edit ${activeTab === 'income' ? 'Income' : activeTab === 'expense' ? 'Expense' : 'Transfer'}`
                : activeTab === 'income'
                ? 'Add Income'
                : activeTab === 'expense'
                ? 'Record Expense'
                : 'Transfer Funds'}
            </h2>
            <p className="text-[11px] sm:text-xs text-muted mt-0.5">
              {editingTransaction
                ? 'Update amount, account, category, or purpose'
                : activeTab === 'income'
                ? 'Record incoming funds to cash or bank account'
                : activeTab === 'expense'
                ? 'Track daily spending and payments with category breakdown'
                : 'Move funds between accounts, savings, or partner'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-muted hover:text-foreground hover:bg-muted/10 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3 Main Action Pills (Only shown when adding new transaction) */}
        {!editingTransaction && (
          <div className="p-3 sm:p-4 bg-muted/10 border-b border-border shrink-0">
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2 p-1 bg-card rounded-2xl border border-border shadow-xs">
              <button
                type="button"
                onClick={() => handleTabChange('income')}
                className={`flex items-center justify-center gap-1.5 py-2 sm:py-2.5 px-2 sm:px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'income'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-muted hover:text-foreground hover:bg-muted/10'
                }`}
              >
                <ArrowDownLeft className="w-4 h-4" />
                <span>+ Income</span>
              </button>

              <button
                type="button"
                onClick={() => handleTabChange('expense')}
                className={`flex items-center justify-center gap-1.5 py-2 sm:py-2.5 px-2 sm:px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'expense'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-muted hover:text-foreground hover:bg-muted/10'
                }`}
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>- Expense</span>
              </button>

              <button
                type="button"
                onClick={() => handleTabChange('transfer')}
                className={`flex items-center justify-center gap-1.5 py-2 sm:py-2.5 px-2 sm:px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'transfer'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-muted hover:text-foreground hover:bg-muted/10'
                }`}
              >
                <ArrowRightLeft className="w-4 h-4" />
                <span>⇄ Transfer</span>
              </button>
            </div>
          </div>
        )}

        {/* Form Body - Scrollable on mobile with keyboard open */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1">
          {submitError && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Amount Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted uppercase tracking-wider block">
              Amount
            </label>
            <div className="relative rounded-2xl border-2 border-border focus-within:border-primary transition-colors bg-background overflow-hidden">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-muted">
                ₹
              </span>
              <input
                type="number"
                step="any"
                min="0.01"
                placeholder="0.00"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                autoFocus
                required
                className="w-full pl-9 pr-4 py-3.5 text-2xl font-extrabold text-foreground bg-transparent focus:outline-hidden font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Account Selection */}
          {activeTab === 'income' && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted uppercase tracking-wider block">
                Deposit To Account
              </label>
              <select
                value={selectedBucketId}
                onChange={(e) => setSelectedBucketId(e.target.value)}
                required
                className="w-full p-3 rounded-xl bg-background border border-border text-foreground text-base sm:text-sm font-semibold focus:outline-hidden focus:border-primary transition-colors cursor-pointer"
              >
                <optgroup label="👤 My Accounts">
                  {myBuckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {getBucketIcon(b.type)} {b.name} — Balance: {formatINR(b.balance)}
                    </option>
                  ))}
                </optgroup>
                {partnerBuckets.length > 0 && (
                  <optgroup label={`👥 ${partnerName || 'Partner'}'s Accounts`}>
                    {partnerBuckets.map((b) => (
                      <option
                        key={b.id}
                        value={b.id}
                        disabled={b.visibility === 'balance_only'}
                      >
                        {getBucketIcon(b.type)} {b.name} — Balance: {formatINR(b.balance)}
                        {b.visibility === 'balance_only' ? ' (View Only)' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {selectedBucket && (
                <p className="text-[11px] text-muted">
                  Current Balance: <span className="font-semibold text-foreground">{formatINR(selectedBucket.balance)}</span>
                </p>
              )}
            </div>
          )}

          {activeTab === 'expense' && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted uppercase tracking-wider block">
                Pay From Account
              </label>
              <select
                value={selectedBucketId}
                onChange={(e) => setSelectedBucketId(e.target.value)}
                required
                className="w-full p-3 rounded-xl bg-background border border-border text-foreground text-base sm:text-sm font-semibold focus:outline-hidden focus:border-primary transition-colors cursor-pointer"
              >
                <optgroup label="👤 My Accounts">
                  {myBuckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {getBucketIcon(b.type)} {b.name} — Available: {formatINR(b.balance)}
                    </option>
                  ))}
                </optgroup>
                {partnerBuckets.length > 0 && (
                  <optgroup label={`👥 ${partnerName || 'Partner'}'s Accounts`}>
                    {partnerBuckets.map((b) => (
                      <option
                        key={b.id}
                        value={b.id}
                        disabled={b.visibility === 'balance_only'}
                      >
                        {getBucketIcon(b.type)} {b.name} — Available: {formatINR(b.balance)}
                        {b.visibility === 'balance_only' ? ' (View Only)' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {selectedBucket && (
                <p className="text-[11px] text-muted">
                  Available in {selectedBucket.name}:{' '}
                  <span className="font-semibold text-foreground">{formatINR(selectedBucket.balance)}</span>
                </p>
              )}
            </div>
          )}

          {activeTab === 'transfer' && (
            <div className="space-y-3">
              {/* Quick transfer direction helpers */}
              <div className="flex flex-wrap items-center gap-1.5">
                {partnerBuckets.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const partnerB = partnerBuckets.find((b) => b.visibility === 'shared') || partnerBuckets[0];
                        if (partnerB && myBuckets[0]) {
                          setSelectedBucketId(partnerB.id);
                          setToBucketId(myBuckets[0].id);
                        }
                      }}
                      className="text-[11px] px-2.5 py-1 rounded-lg font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-colors cursor-pointer"
                    >
                      ⇄ {partnerName || 'Partner'} → My Account
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const partnerB = partnerBuckets.find((b) => b.visibility === 'shared') || partnerBuckets[0];
                        if (partnerB && myBuckets[0]) {
                          setSelectedBucketId(myBuckets[0].id);
                          setToBucketId(partnerB.id);
                        }
                      }}
                      className="text-[11px] px-2.5 py-1 rounded-lg font-bold bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors cursor-pointer"
                    >
                      ⇄ My Account → {partnerName || 'Partner'}
                    </button>
                  </>
                )}

                {myBuckets.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const cashB = myBuckets.find((b) => b.type === 'cash') || myBuckets[0];
                      const saveB = myBuckets.find((b) => b.id !== cashB?.id) || myBuckets[1];
                      if (cashB && saveB) {
                        setSelectedBucketId(cashB.id);
                        setToBucketId(saveB.id);
                      }
                    }}
                    className="text-[11px] px-2.5 py-1 rounded-lg font-bold bg-muted/15 text-foreground hover:bg-muted/25 transition-colors cursor-pointer"
                  >
                    ⇄ Cash → Savings
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 relative">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted uppercase tracking-wider block">
                    From Account
                  </label>
                  <select
                    value={selectedBucketId}
                    onChange={(e) => setSelectedBucketId(e.target.value)}
                    required
                    className="w-full p-3 rounded-xl bg-background border border-border text-foreground text-base sm:text-xs font-semibold focus:outline-hidden focus:border-primary transition-colors cursor-pointer"
                  >
                    <optgroup label="👤 My Accounts">
                      {myBuckets.map((b) => (
                        <option key={b.id} value={b.id}>
                          {getBucketIcon(b.type)} {b.name} ({formatINR(b.balance)})
                        </option>
                      ))}
                    </optgroup>
                    {partnerBuckets.length > 0 && (
                      <optgroup label={`👥 ${partnerName || 'Partner'}'s Accounts`}>
                        {partnerBuckets.map((b) => (
                          <option
                            key={b.id}
                            value={b.id}
                            disabled={b.visibility === 'balance_only'}
                          >
                            {getBucketIcon(b.type)} {b.name} ({formatINR(b.balance)})
                            {b.visibility === 'balance_only' ? ' (View Only)' : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted uppercase tracking-wider block">
                    To Account
                  </label>
                  <select
                    value={toBucketId}
                    onChange={(e) => setToBucketId(e.target.value)}
                    required
                    className="w-full p-3 rounded-xl bg-background border border-border text-foreground text-base sm:text-xs font-semibold focus:outline-hidden focus:border-primary transition-colors cursor-pointer"
                  >
                    <optgroup label="👤 My Accounts">
                      {myBuckets.map((b) => (
                        <option key={b.id} value={b.id}>
                          {getBucketIcon(b.type)} {b.name} ({formatINR(b.balance)})
                        </option>
                      ))}
                    </optgroup>
                    {partnerBuckets.length > 0 && (
                      <optgroup label={`👥 ${partnerName || 'Partner'}'s Accounts`}>
                        {partnerBuckets.map((b) => (
                          <option
                            key={b.id}
                            value={b.id}
                            disabled={b.visibility === 'balance_only'}
                          >
                            {getBucketIcon(b.type)} {b.name} ({formatINR(b.balance)})
                            {b.visibility === 'balance_only' ? ' (View Only)' : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Category Chips & Input (Income or Expense) */}
          {activeTab !== 'transfer' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted uppercase tracking-wider block flex items-center justify-between">
                <span>Category</span>
                <span className="text-[11px] text-primary font-normal">Select or type</span>
              </label>

              {/* Quick Select Chips */}
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pb-1">
                {(activeTab === 'income' ? INCOME_QUICK_CATEGORIES : EXPENSE_QUICK_CATEGORIES).map(
                  (cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(cat)}
                      className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                        category === cat
                          ? 'bg-primary text-primary-foreground font-bold'
                          : 'bg-muted/15 text-muted hover:text-foreground hover:bg-muted/25'
                      }`}
                    >
                      {cat}
                    </button>
                  )
                )}
              </div>

              <input
                type="text"
                placeholder="Or type custom category..."
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground text-base sm:text-xs focus:outline-hidden focus:border-primary"
              />
            </div>
          )}

          {/* Purpose / Note */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted uppercase tracking-wider block">
              {activeTab === 'expense' ? 'Description / Purpose' : 'Note (Optional)'}
            </label>
            <input
              type="text"
              placeholder={
                activeTab === 'income'
                  ? 'e.g., October Salary, Client payment, Bonus'
                  : activeTab === 'expense'
                  ? 'e.g., Weekly groceries, Fuel, Electric bill'
                  : 'e.g., Transfer to emergency savings, ATM withdrawal'
              }
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              required={activeTab === 'expense'}
              className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground text-base sm:text-xs focus:outline-hidden focus:border-primary"
            />
          </div>

          {/* Date & Time */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted uppercase tracking-wider block">
              Date & Time
            </label>
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground text-base sm:text-xs focus:outline-hidden focus:border-primary"
            />
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={createTransaction.isPending || updateTransaction.isPending}
              className={`w-full py-3.5 px-4 min-h-[48px] rounded-2xl text-white font-bold text-sm transition-all shadow-md cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === 'income'
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                  : activeTab === 'expense'
                  ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
                  : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
              } disabled:opacity-50`}
            >
              {createTransaction.isPending || updateTransaction.isPending ? (
                <span>{editingTransaction ? 'Updating...' : 'Saving...'}</span>
              ) : (
                <>
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>
                    {editingTransaction
                      ? 'Update Transaction'
                      : activeTab === 'income'
                      ? 'Add Income'
                      : activeTab === 'expense'
                      ? 'Record Expense'
                      : 'Transfer Funds'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
