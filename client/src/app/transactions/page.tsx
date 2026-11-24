'use client';

/**
 * Client Component: /transactions
 * 
 * Server vs Client Component Rationale:
 * 1. App Router pages that consume dynamic URL search params for filtering and pagination
 *    must either read `searchParams` prop in a Server Component or use `useSearchParams()`
 *    in a Client Component wrapped in a `<Suspense>` boundary.
 * 2. We use `'use client'` wrapped in `<Suspense>` because transactions require rich, dynamic
 *    client-side interactivity:
 *    - Modal dialogs for recording single, transfer, split-income, and split-transfer transactions.
 *    - TanStack Query cache synchronization (`useTransactions` with `placeholderData: keepPreviousData`).
 *    - Debounced search inputs and filter changes without full-page document reloads.
 *    - Collapsible transaction split-allocation inspections.
 *    - Void and group-void interactive confirmation states.
 */

import React, { Suspense, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  TransactionQueryInput,
  TransactionType,
  TransactionStatus,
} from '@vault/shared';
import { useAuthMe, useBuckets } from '../../lib/bucketHooks';
import { ThemeToggle } from '../../components/ThemeToggle';
import { TransactionsFilterBar } from '../../components/TransactionsFilterBar';
import { TransactionsList } from '../../components/TransactionsList';
import { TransactionModal } from '../../components/TransactionModal';
import {
  ArrowLeft,
  LayoutDashboard,
  Layers,
  Plus,
  Receipt,
  Sparkles,
  Split,
} from 'lucide-react';

function TransactionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: authData } = useAuthMe();
  const { data: bucketsData } = useBuckets();
  const buckets = bucketsData?.buckets || [];

  const currentUserId = authData?.user?.id;

  // Transaction Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<
    'income' | 'expense' | 'transfer' | 'single' | 'split-income' | 'split-transfer'
  >('income');

  // Parse query filters from searchParams
  const query: TransactionQueryInput = useMemo(() => {
    const pageStr = searchParams.get('page');
    const limitStr = searchParams.get('limit');
    const bucketId = searchParams.get('bucketId') || undefined;
    const typeStr = searchParams.get('type') || undefined;
    const category = searchParams.get('category') || undefined;
    const createdByParam = searchParams.get('createdBy');
    const createdBy = createdByParam === 'all' ? undefined : (createdByParam || 'me');
    const fromDate = searchParams.get('fromDate') || undefined;
    const toDate = searchParams.get('toDate') || undefined;
    const minAmountStr = searchParams.get('minAmount');
    const maxAmountStr = searchParams.get('maxAmount');
    const search = searchParams.get('search') || undefined;
    const includeVoidedStr = searchParams.get('includeVoided');
    const sort = (searchParams.get('sort') as 'date_desc' | 'date_asc') || 'date_desc';

    return {
      page: pageStr ? parseInt(pageStr, 10) : 1,
      limit: limitStr ? parseInt(limitStr, 10) : 20,
      bucketId,
      type: typeStr ? (typeStr as TransactionType) : undefined,
      category,
      createdBy,
      fromDate,
      toDate,
      minAmount: minAmountStr ? parseInt(minAmountStr, 10) : undefined,
      maxAmount: maxAmountStr ? parseInt(maxAmountStr, 10) : undefined,
      search,
      includeVoided: includeVoidedStr === 'true',
      sort,
    };
  }, [searchParams]);

  // Page navigation helper
  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', newPage.toString());
    router.push(`/transactions?${params.toString()}`);
  };

  // Clear filters helper
  const handleClearFilters = () => {
    router.push('/transactions');
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur-md px-4 sm:px-6 py-3.5 transition-colors">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="p-2 -ml-2 rounded-xl text-muted hover:text-foreground hover:bg-muted/10 transition-colors"
              title="Return to Dashboard"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>

            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-primary/10 text-primary rounded-xl">
                <Receipt className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                  Transactions
                </h1>
                <p className="text-xs text-muted hidden sm:block">
                  Ledger of all household cash flows, transfers and splits
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs font-medium text-foreground hover:bg-muted/10 transition-colors"
            >
              <LayoutDashboard className="w-4 h-4 text-primary" />
              Dashboard
            </Link>

            <Link
              href="/buckets"
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs font-medium text-foreground hover:bg-muted/10 transition-colors"
            >
              <Layers className="w-4 h-4 text-primary" />
              Buckets
            </Link>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setModalMode('income');
                  setModalOpen(true);
                }}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs flex items-center gap-1 transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 stroke-[3]" />
                <span>Income</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setModalMode('expense');
                  setModalOpen(true);
                }}
                className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs flex items-center gap-1 transition-all cursor-pointer"
              >
                <span>- Expense</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setModalMode('transfer');
                  setModalOpen(true);
                }}
                className="hidden sm:flex px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs items-center gap-1 transition-all cursor-pointer"
              >
                <span>⇄ Transfer</span>
              </button>
            </div>

            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Filter Controls Bar */}
        <section aria-label="Transaction filters">
          <TransactionsFilterBar onClear={handleClearFilters} />
        </section>

        {/* Transactions List with Server Pagination */}
        <section aria-label="Transaction records list">
          <TransactionsList
            currentUserId={currentUserId}
            query={query}
            showPagination={true}
            onPageChange={handlePageChange}
            onClearFilters={handleClearFilters}
            onNewTransaction={() => {
              setModalMode('single');
              setModalOpen(true);
            }}
            onSplitSalary={() => {
              setModalMode('split-income');
              setModalOpen(true);
            }}
          />
        </section>
      </main>

      {/* Mobile Floating Action Button (FAB) */}
      <div className="sm:hidden fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => {
            setModalMode('split-income');
            setModalOpen(true);
          }}
          className="w-12 h-12 rounded-full bg-card border border-border text-foreground shadow-lg flex items-center justify-center hover:bg-muted/10 transition-transform active:scale-95"
          title="Split Salary"
          aria-label="Split Salary"
        >
          <Split className="w-5 h-5 text-primary" />
        </button>

        <button
          type="button"
          onClick={() => {
            setModalMode('single');
            setModalOpen(true);
          }}
          className="w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center hover:bg-primary/90 transition-transform active:scale-95"
          title="Add Transaction"
          aria-label="Add Transaction"
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>

      {/* Transaction Modal */}
      <TransactionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        buckets={buckets}
        initialMode={modalMode}
      />
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-xs text-muted">Loading transactions...</p>
        </div>
      }
    >
      <TransactionsContent />
    </Suspense>
  );
}
