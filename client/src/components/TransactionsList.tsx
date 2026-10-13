'use client';

/**
 * Client Component: TransactionsList
 * "use client" required for:
 * 1. Collapsible split group card expand/collapse interaction
 * 2. Void confirmation modal/actions with optimistic cache updates
 * 3. Client-side grouping of multi-line split transactions
 */

import React, { useState } from 'react';
import {
  PublicTransaction,
  formatINR,
  TransactionType,
  TransactionStatus,
} from '@vault/shared';
import {
  useTransactions,
  useVoidTransaction,
  useVoidGroup,
} from '../lib/transactionHooks';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Shield,
  Clock,
  Layers,
  Sparkles,
  AlertTriangle,
  Lock,
} from 'lucide-react';

interface TransactionsListProps {
  currentUserId?: string;
  onNewTransaction?: () => void;
  onSplitSalary?: () => void;
}

export function TransactionsList({
  currentUserId,
  onNewTransaction,
  onSplitSalary,
}: TransactionsListProps) {
  const { data, isLoading, error } = useTransactions(1, 100);
  const voidTransaction = useVoidTransaction();
  const voidGroup = useVoidGroup();

  // State to track expanded split groups
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  // Voiding state
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidConfirmGroup, setVoidConfirmGroup] = useState<string | null>(null);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const handleVoidSingle = async (txId: string) => {
    if (!confirm('Are you sure you want to void this transaction? An append-only reversal entry will be recorded in the ledger.')) {
      return;
    }
    setVoidingId(txId);
    try {
      await voidTransaction.mutateAsync(txId);
    } catch (err: any) {
      alert(err.message || 'Failed to void transaction');
    } finally {
      setVoidingId(null);
    }
  };

  const handleVoidGroup = async (groupId: string) => {
    if (!confirm('Are you sure you want to void this entire split group? All allocation lines will be reversed atomically.')) {
      return;
    }
    setVoidingId(groupId);
    try {
      await voidGroup.mutateAsync(groupId);
      setVoidConfirmGroup(null);
    } catch (err: any) {
      alert(err.message || 'Failed to void transaction group');
    } finally {
      setVoidingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 animate-pulse flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
              <div className="space-y-2">
                <div className="w-32 h-3.5 rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="w-20 h-2.5 rounded bg-zinc-200 dark:bg-zinc-800" />
              </div>
            </div>
            <div className="w-24 h-4 rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-sm font-semibold text-red-600 dark:text-red-400">
          Failed to load transactions
        </p>
        <p className="text-xs text-red-500/80 mt-1">{(error as Error).message}</p>
      </div>
    );
  }

  const rawTransactions = data?.transactions || [];

  if (rawTransactions.length === 0) {
    return (
      <div className="p-10 rounded-2xl bg-zinc-50/50 dark:bg-zinc-900/50 border border-dashed border-zinc-300 dark:border-zinc-800 text-center">
        <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto mb-3">
          <Layers className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          No transactions yet
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
          Start recording income, expenses, transfers or salary splits to track your household cash flow.
        </p>
        <div className="flex items-center justify-center gap-3 mt-4">
          {onNewTransaction && (
            <button
              onClick={onNewTransaction}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-xl shadow-sm transition-all"
            >
              Record Transaction
            </button>
          )}
          {onSplitSalary && (
            <button
              onClick={onSplitSalary}
              className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-medium text-xs rounded-xl transition-all"
            >
              Split Salary
            </button>
          )}
        </div>
      </div>
    );
  }

  // Group split transactions together by groupId for collapsible display
  const groupedView: Array<
    | { isGroup: false; tx: PublicTransaction }
    | { isGroup: true; groupId: string; groupType: TransactionType; lines: PublicTransaction[]; totalAmount: number; isVoided: boolean; date: string; category?: string; purpose?: string; createdBy: string; isCreator: boolean }
  > = [];

  const processedGroupIds = new Set<string>();

  for (const tx of rawTransactions) {
    if (!tx.groupId || tx.groupId.startsWith('reversal_')) {
      groupedView.push({ isGroup: false, tx });
      continue;
    }

    if (processedGroupIds.has(tx.groupId)) {
      continue;
    }

    processedGroupIds.add(tx.groupId);
    const groupLines = rawTransactions.filter((t) => t.groupId === tx.groupId);

    if (groupLines.length === 1) {
      groupedView.push({ isGroup: false, tx });
      continue;
    }

    const totalAmount = groupLines.reduce((sum, t) => sum + t.amount, 0);
    const isVoided = groupLines.every((t) => t.status === 'voided');

    groupedView.push({
      isGroup: true,
      groupId: tx.groupId,
      groupType: tx.type,
      lines: groupLines,
      totalAmount,
      isVoided,
      date: tx.date,
      category: tx.category,
      purpose: tx.purpose,
      createdBy: tx.createdBy,
      isCreator: currentUserId ? tx.createdBy === currentUserId : true,
    });
  }

  return (
    <div className="space-y-3">
      {groupedView.map((item) => {
        if (!item.isGroup) {
          const tx = item.tx;
          const isVoided = tx.status === 'voided';
          const isCreator = currentUserId ? tx.createdBy === currentUserId : true;

          return (
            <div
              key={tx.id}
              className={`p-4 rounded-2xl border transition-all ${
                isVoided
                  ? 'bg-zinc-50/50 dark:bg-zinc-900/30 border-zinc-200/50 dark:border-zinc-800/40 opacity-70'
                  : 'bg-white dark:bg-zinc-900 border-zinc-200/80 dark:border-zinc-800 hover:shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                {/* Left: Icon & Meta */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`p-2.5 rounded-xl shrink-0 ${
                      tx.type === 'income'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                        : tx.type === 'expense'
                        ? 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'
                        : tx.type === 'transfer'
                        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                    }`}
                  >
                    {tx.type === 'income' && <ArrowDownLeft className="w-5 h-5" />}
                    {tx.type === 'expense' && <ArrowUpRight className="w-5 h-5" />}
                    {tx.type === 'transfer' && <ArrowRightLeft className="w-5 h-5" />}
                    {tx.type === 'adjustment' && <SlidersHorizontal className="w-5 h-5" />}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {tx.type === 'adjustment'
                          ? `Adjustment: ${tx.reason || 'Balance correction'}`
                          : tx.category || tx.purpose || 'Transaction'}
                      </span>
                      {tx.isMasked && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                          <Lock className="w-2.5 h-2.5" />
                          Protected
                        </span>
                      )}
                      {isVoided && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                          Voided
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {tx.type === 'transfer' && (
                        <span>
                          {tx.fromBucketName || 'External'} → {tx.toBucketName || 'External'}
                        </span>
                      )}
                      {tx.type === 'income' && <span>To: {tx.toBucketName || 'Bucket'}</span>}
                      {tx.type === 'expense' && <span>From: {tx.fromBucketName || 'Bucket'}</span>}
                      {tx.type === 'adjustment' && (
                        <span>Bucket: {tx.toBucketName || tx.fromBucketName || 'Bucket'}</span>
                      )}
                      <span>•</span>
                      <span>{new Date(tx.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  </div>
                </div>

                {/* Right: Amount & Actions */}
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div
                      className={`text-sm font-bold tabular-nums ${
                        isVoided
                          ? 'line-through text-zinc-400'
                          : tx.type === 'income'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : tx.type === 'expense'
                          ? 'text-red-500'
                          : 'text-zinc-900 dark:text-zinc-100'
                      }`}
                    >
                      {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                      {formatINR(tx.amount)}
                    </div>
                  </div>

                  {!isVoided && isCreator && (
                    <button
                      onClick={() => handleVoidSingle(tx.id)}
                      disabled={voidingId === tx.id}
                      title="Void this entry"
                      className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        }

        // ===================================================================
        // GROUPED SPLIT TRANSACTION CARD
        // ===================================================================
        const isExpanded = expandedGroups[item.groupId];
        const isVoided = item.isVoided;

        return (
          <div
            key={item.groupId}
            className={`rounded-2xl border transition-all overflow-hidden ${
              isVoided
                ? 'bg-zinc-50/50 dark:bg-zinc-900/30 border-zinc-200/50 dark:border-zinc-800/40 opacity-70'
                : 'bg-white dark:bg-zinc-900 border-zinc-200/80 dark:border-zinc-800 shadow-sm'
            }`}
          >
            {/* Header (Collapsible trigger) */}
            <div
              onClick={() => toggleGroup(item.groupId)}
              className="p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {item.category || item.purpose || 'Split Transaction'}
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                      {item.lines.length} Allocations
                    </span>
                    {isVoided && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                        Voided
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {new Date(item.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {item.purpose && ` • ${item.purpose}`}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div
                    className={`text-sm font-bold tabular-nums ${
                      isVoided
                        ? 'line-through text-zinc-400'
                        : item.groupType === 'income'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-zinc-900 dark:text-zinc-100'
                    }`}
                  >
                    {item.groupType === 'income' ? '+' : ''}
                    {formatINR(item.totalAmount)}
                  </div>
                </div>

                <div className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </div>
            </div>

            {/* Expanded Lines */}
            {isExpanded && (
              <div className="p-4 pt-0 border-t border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-800/20 space-y-2">
                <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider pt-3 pb-1">
                  Allocation Breakdown
                </div>
                {item.lines.map((line) => (
                  <div
                    key={line.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-zinc-800/80 border border-zinc-200/60 dark:border-zinc-700/50 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                        {line.toBucketName || line.fromBucketName || 'Protected Allocation'}
                      </span>
                      {line.purpose && (
                        <span className="text-zinc-500 dark:text-zinc-400">
                          ({line.purpose})
                        </span>
                      )}
                      {line.isMasked && (
                        <span className="text-[10px] text-purple-500 font-medium">(Private)</span>
                      )}
                    </div>
                    <div className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {line.isMasked ? '—' : formatINR(line.amount)}
                    </div>
                  </div>
                ))}

                {/* Void Group Action */}
                {!isVoided && item.isCreator && (
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleVoidGroup(item.groupId)}
                      disabled={voidingId === item.groupId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-all"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {voidingId === item.groupId ? 'Voiding Group...' : 'Void Entire Split Group'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
