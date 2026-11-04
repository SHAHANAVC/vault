'use client';

/**
 * Client Component: TransactionsList
 * "use client" required for:
 * 1. Collapsible split group card expand/collapse interaction
 * 2. Void confirmation modal/actions with optimistic cache updates
 * 3. Client-side grouping of multi-line split transactions
 * 4. Pagination controls with smooth transitions
 */

import React, { useState } from 'react';
import {
  PublicTransaction,
  formatINR,
  TransactionType,
  TransactionStatus,
  TransactionQueryInput,
} from '@vault/shared';
import {
  useTransactions,
  useTransactionGroup,
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
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Shield,
  Clock,
  Layers,
  Sparkles,
  AlertTriangle,
  Lock,
  RefreshCw,
} from 'lucide-react';

interface TransactionsListProps {
  currentUserId?: string;
  onNewTransaction?: () => void;
  onSplitSalary?: () => void;
  query?: TransactionQueryInput;
  onClearFilters?: () => void;
  showPagination?: boolean;
  onPageChange?: (newPage: number) => void;
}

function SplitGroupLines({
  groupId,
  initialLines,
}: {
  groupId: string;
  initialLines?: PublicTransaction[];
}) {
  const { data, isLoading } = useTransactionGroup(
    initialLines && initialLines.length > 1 ? undefined : groupId
  );
  const lines =
    initialLines && initialLines.length > 1 ? initialLines : data?.group.lines || [];

  if (isLoading && (!initialLines || initialLines.length <= 1)) {
    return (
      <div className="p-3 text-xs text-muted animate-pulse">
        Loading allocation breakdown...
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-2">
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pb-1">
        Allocation Breakdown ({lines.length})
      </div>
      {lines.map((line) => (
        <div
          key={line.id}
          className="flex items-center justify-between p-2.5 rounded-xl bg-background border border-border text-xs"
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span className="font-semibold text-foreground">
              {line.toBucketName || line.fromBucketName || 'Protected Allocation'}
            </span>
            {line.purpose && <span className="text-muted">({line.purpose})</span>}
            {line.isMasked && (
              <span className="text-[10px] text-purple-500 font-medium">(Private)</span>
            )}
          </div>
          <div className="font-bold tabular-nums text-foreground">
            {line.isMasked ? '—' : formatINR(line.amount)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TransactionsList({
  currentUserId,
  onNewTransaction,
  onSplitSalary,
  query,
  onClearFilters,
  showPagination = false,
  onPageChange,
}: TransactionsListProps) {
  const { data, isLoading, error, refetch } = useTransactions(query || 1, 20);
  const voidTransaction = useVoidTransaction();
  const voidGroup = useVoidGroup();

  // State to track expanded split groups
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  // Voiding state
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const handleVoidSingle = async (txId: string) => {
    if (
      !confirm(
        'Are you sure you want to void this transaction? An append-only reversal entry will be recorded in the ledger.'
      )
    ) {
      return;
    }
    setVoidingId(txId);
    try {
      await voidTransaction.mutateAsync(txId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to void transaction';
      alert(message);
    } finally {
      setVoidingId(null);
    }
  };

  const handleVoidGroup = async (groupId: string) => {
    if (
      !confirm(
        'Are you sure you want to void this entire split group? All allocation lines will be reversed atomically.'
      )
    ) {
      return;
    }
    setVoidingId(groupId);
    try {
      await voidGroup.mutateAsync(groupId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to void transaction group';
      alert(message);
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
            className="p-4 rounded-2xl bg-card border border-border animate-pulse flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted/20" />
              <div className="space-y-2">
                <div className="w-32 h-3.5 rounded bg-muted/20" />
                <div className="w-20 h-2.5 rounded bg-muted/20" />
              </div>
            </div>
            <div className="w-24 h-4 rounded bg-muted/20" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
        <div>
          <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">
            Failed to load transactions
          </p>
          <p className="text-xs text-rose-500/80 mt-1">{(error as Error).message}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500 text-white text-xs font-semibold hover:bg-rose-600 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  const rawTransactions = data?.transactions || [];

  if (rawTransactions.length === 0) {
    return (
      <div className="p-10 rounded-2xl bg-card border border-dashed border-border text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-muted/10 text-muted flex items-center justify-center mx-auto">
          <Layers className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">
          No transactions found
        </h3>
        <p className="text-xs text-muted max-w-sm mx-auto">
          {onClearFilters
            ? 'No entries match your current search or filter criteria.'
            : 'Start recording income, expenses, transfers or salary splits to track your household cash flow.'}
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          {onClearFilters && (
            <button
              onClick={onClearFilters}
              className="px-4 py-2 bg-primary text-background font-semibold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
            >
              Clear Filters
            </button>
          )}
          {onNewTransaction && !onClearFilters && (
            <button
              onClick={onNewTransaction}
              className="px-4 py-2 bg-primary hover:bg-primary-hover text-background font-medium text-xs rounded-xl shadow-xs transition-all cursor-pointer"
            >
              Record Transaction
            </button>
          )}
          {onSplitSalary && !onClearFilters && (
            <button
              onClick={onSplitSalary}
              className="px-4 py-2 bg-muted/10 hover:bg-muted/20 text-foreground font-medium text-xs rounded-xl transition-all cursor-pointer"
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
    | {
        isGroup: true;
        groupId: string;
        groupType: TransactionType;
        lines: PublicTransaction[];
        linesCount: number;
        totalAmount: number;
        isVoided: boolean;
        date: string;
        category?: string;
        purpose?: string;
        createdBy: string;
        isCreator: boolean;
      }
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

    const isGroup = tx.isGroupParent || (tx.linesCount && tx.linesCount > 1) || groupLines.length > 1;

    if (!isGroup) {
      groupedView.push({ isGroup: false, tx });
      continue;
    }

    const totalAmount =
      tx.isGroupParent && tx.amount
        ? tx.amount
        : groupLines.reduce((sum, t) => sum + t.amount, 0);

    const linesCount = tx.linesCount || groupLines.length;
    const isVoided = tx.status === 'voided' || groupLines.every((t) => t.status === 'voided');

    groupedView.push({
      isGroup: true,
      groupId: tx.groupId,
      groupType: tx.type,
      lines: groupLines,
      linesCount,
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
                  ? 'bg-card/40 border-border/40 opacity-70'
                  : 'bg-card border-border hover:shadow-xs'
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
                        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
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
                      <span className="text-sm font-semibold text-foreground truncate">
                        {tx.type === 'adjustment'
                          ? `Adjustment: ${tx.reason || 'Balance correction'}`
                          : (tx.category || tx.purpose || 'Transaction').includes('Reversal of voided')
                          ? `Void Reversal • Transfer #${(tx.category || tx.purpose || '').split(' ').pop()?.slice(-6) || 'reversal'}`
                          : tx.category || tx.purpose || 'Transaction'}
                      </span>
                      {tx.type === 'adjustment' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          Adjustment
                        </span>
                      )}
                      {tx.isMasked && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                          <Lock className="w-2.5 h-2.5" />
                          Protected
                        </span>
                      )}
                      {isVoided && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-muted/20 text-muted">
                          Voided
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
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
                      <span>
                        {new Date(tx.date).toLocaleDateString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}{' '}
                        at{' '}
                        {new Date(tx.date).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true,
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Amount & Actions */}
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div
                      className={`text-sm font-bold tabular-nums ${
                        isVoided
                          ? 'line-through text-muted'
                          : tx.type === 'income'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : tx.type === 'expense'
                          ? 'text-rose-500'
                          : 'text-foreground'
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
                      className="p-1.5 text-muted hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
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
        // GROUPED SPLIT TRANSACTION CARD (Collapsible)
        // ===================================================================
        const isExpanded = expandedGroups[item.groupId];
        const isVoided = item.isVoided;

        return (
          <div
            key={item.groupId}
            className={`rounded-2xl border transition-all overflow-hidden ${
              isVoided
                ? 'bg-card/40 border-border/40 opacity-70'
                : 'bg-card border-border shadow-xs'
            }`}
          >
            {/* Header (Collapsible trigger) */}
            <div
              onClick={() => toggleGroup(item.groupId)}
              className="p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-muted/10 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground truncate">
                      {item.category || item.purpose || 'Split Transaction'}
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                      {item.linesCount} Allocations
                    </span>
                    {isVoided && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-muted/20 text-muted">
                        Voided
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {new Date(item.date).toLocaleDateString('en-IN', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}{' '}
                    at{' '}
                    {new Date(item.date).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}
                    {item.purpose && ` • ${item.purpose}`}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div
                    className={`text-sm font-bold tabular-nums ${
                      isVoided
                        ? 'line-through text-muted'
                        : item.groupType === 'income'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-foreground'
                    }`}
                  >
                    {item.groupType === 'income' ? '+' : ''}
                    {formatINR(item.totalAmount)}
                  </div>
                </div>

                <div className="p-1 rounded-lg text-muted hover:text-foreground">
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </div>
            </div>

            {/* Expanded Lines */}
            {isExpanded && (
              <div className="p-4 pt-0 border-t border-border/80 bg-background/50 space-y-3">
                <SplitGroupLines groupId={item.groupId} initialLines={item.lines} />

                {/* Void Group Action */}
                {!isVoided && item.isCreator && (
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleVoidGroup(item.groupId)}
                      disabled={voidingId === item.groupId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 transition-all cursor-pointer"
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

      {/* Pagination Footer */}
      {showPagination && data && data.totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border/60">
          <div className="text-xs text-muted">
            Page <span className="font-semibold text-foreground">{data.page}</span> of{' '}
            <span className="font-semibold text-foreground">{data.totalPages}</span>{' '}
            ({data.total} total)
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={data.page <= 1}
              onClick={() => onPageChange && onPageChange(data.page - 1)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-card text-xs font-medium text-foreground hover:bg-muted/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              disabled={!data.hasMore}
              onClick={() => onPageChange && onPageChange(data.page + 1)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-card text-xs font-medium text-foreground hover:bg-muted/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
