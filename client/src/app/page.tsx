'use client';

/**
 * Client Component: Home Page (/)
 * 
 * Simplified, User-Friendly Family Finance Command Center:
 * 1. Add Income directly (+ Add Income)
 * 2. See how income is spent (- Add Expense + Monthly Category Breakdown)
 * 3. Track accounts between partners (My Accounts vs Partner's Shared Accounts)
 * 4. Move cash to savings (Transfer Funds)
 * 5. Clean, single-click monthly filter
 */

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  formatINR,
  PublicUser,
  PublicBucket,
  PublicTransaction,
  TransactionType,
} from '@vault/shared';
import {
  useBuckets,
  useBucketSummary,
  useAuthMe,
} from '../lib/bucketHooks';
import {
  useMonthSummary,
  useCategoryBreakdown,
  useTransactions,
  useVoidTransaction,
} from '../lib/transactionHooks';
import { ThemeToggle } from '../components/ThemeToggle';
import { TransactionModal } from '../components/TransactionModal';
import { DashboardAlertsBanner } from '../components/DashboardAlertsBanner';
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Users,
  Copy,
  Check,
  LogOut,
  Send,
  Building2,
  Coins,
  Sparkles,
  PiggyBank,
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  X,
  CreditCard,
  ShieldCheck,
  UserCheck,
  Pencil,
} from 'lucide-react';

interface ActiveInvite {
  token: string;
  inviteUrl: string;
  expiresAt: string;
}

function getCurrentMonthString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function formatMonthTitle(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr || '2026', 10);
  const month = parseInt(monthStr || '1', 10) - 1;
  const d = new Date(year, month, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function addMonths(yearMonth: string, delta: number): string {
  const [yearStr, monthStr] = yearMonth.split('-');
  let year = parseInt(yearStr || '2026', 10);
  let month = parseInt(monthStr || '1', 10) + delta;
  if (month < 1) {
    month = 12;
    year -= 1;
  } else if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

function getMonthRangeIso(yearMonth: string): { fromDate: string; toDate: string } {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr || '2026', 10);
  const month = parseInt(monthStr || '1', 10);
  const pad = (n: number) => String(n).padStart(2, '0');

  const fromDate = `${year}-${pad(month)}-01T00:00:00.000Z`;
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const toDate = `${nextYear}-${pad(nextMonth)}-01T00:00:00.000Z`;
  return { fromDate, toDate };
}

function getBucketIcon(type: string) {
  switch (type) {
    case 'cash':
      return '💵';
    case 'bank':
      return '🏛️';
    case 'fixed_savings':
      return '🛡️';
    case 'kuri':
      return '🪙';
    case 'gold_scheme':
      return '✨';
    default:
      return '💼';
  }
}

export default function HomePage() {
  const router = useRouter();

  // Current session & auth
  const { data: authData, isLoading: authLoading } = useAuthMe();
  const user = authData?.user;
  const partner = authData?.partner;

  // Selected Month state
  const currentMonth = useMemo(() => getCurrentMonthString(), []);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth);

  // Optional specific day filter (e.g. "2026-11-06" or empty for full month)
  const [selectedDay, setSelectedDay] = useState<string>('');

  const todayIsoDate = useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  // Month or Day date range for transactions query (with local timezone boundaries)
  const { fromDate, toDate } = useMemo(() => {
    if (selectedDay) {
      const parts = selectedDay.split('-').map(Number);
      const y = parts[0];
      const m = parts[1];
      const d = parts[2];
      if (y && m && d) {
        const start = new Date(y, m - 1, d, 0, 0, 0, 0);
        const end = new Date(y, m - 1, d, 23, 59, 59, 999);
        return { fromDate: start.toISOString(), toDate: end.toISOString() };
      }
    }
    return getMonthRangeIso(selectedMonth);
  }, [selectedMonth, selectedDay]);

  // Live queries for the selected month
  const { data: monthSummary, isLoading: summaryLoading } = useMonthSummary(selectedMonth);
  const { data: categoryData, isLoading: categoriesLoading } = useCategoryBreakdown(selectedMonth);
  const { data: bucketData } = useBuckets();
  const buckets = bucketData?.buckets || [];

  // Transaction Filter state
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense' | 'transfer'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Transactions query
  const {
    data: txData,
    isLoading: txLoading,
    refetch: refetchTx,
  } = useTransactions({
    fromDate,
    toDate,
    type: filterType === 'all' ? undefined : filterType,
    category: filterCategory === 'all' ? undefined : filterCategory,
    search: searchQuery.trim() || undefined,
    page: 1,
    limit: 50,
  });

  const transactions = txData?.transactions || [];

  // Dynamic Metrics for the filtered view
  const filteredMetrics = useMemo(() => {
    let incomeSum = 0;
    let expenseSum = 0;
    let transferSum = 0;
    let count = 0;

    for (const t of transactions) {
      if (t.status === 'voided') continue;
      count++;
      if (t.type === 'income') incomeSum += t.amount;
      else if (t.type === 'expense') expenseSum += t.amount;
      else if (t.type === 'transfer') transferSum += t.amount;
    }

    return {
      incomeSum,
      expenseSum,
      transferSum,
      netSum: incomeSum - expenseSum,
      count,
    };
  }, [transactions]);

  // Transaction Modal State
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txModalMode, setTxModalMode] = useState<'income' | 'expense' | 'transfer'>('income');
  const [preselectedBucketId, setPreselectedBucketId] = useState<string | undefined>(undefined);
  const [editingTx, setEditingTx] = useState<PublicTransaction | null>(null);

  // Partner Invite Modal State
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [activeInvite, setActiveInvite] = useState<ActiveInvite | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Void transaction mutation
  const voidMutation = useVoidTransaction();
  const [voidingId, setVoidingId] = useState<string | null>(null);

  // Open modal helpers
  const handleOpenIncome = (bucketId?: string) => {
    setTxModalMode('income');
    setPreselectedBucketId(bucketId);
    setTxModalOpen(true);
  };

  const handleOpenExpense = (bucketId?: string) => {
    setTxModalMode('expense');
    setPreselectedBucketId(bucketId);
    setTxModalOpen(true);
  };

  const handleOpenTransfer = (bucketId?: string) => {
    setTxModalMode('transfer');
    setPreselectedBucketId(bucketId);
    setTxModalOpen(true);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch (_err) {
      router.push('/login');
    }
  };

  const handleCreateInvite = async () => {
    setGeneratingInvite(true);
    setInviteError(null);
    try {
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresInDays: 7 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.message || 'Failed to generate invite');
        setGeneratingInvite(false);
        return;
      }
      setActiveInvite(data);
    } catch (_err) {
      setInviteError('Network error generating invite');
    } finally {
      setGeneratingInvite(false);
    }
  };

  const getEffectiveInviteUrl = (invite: ActiveInvite | null): string => {
    if (!invite) return '';
    if (typeof window !== 'undefined') {
      try {
        const parsed = new URL(invite.inviteUrl);
        if (
          parsed.hostname === 'localhost' ||
          parsed.hostname === '127.0.0.1' ||
          !invite.inviteUrl.startsWith('http')
        ) {
          return `${window.location.origin}/invite/${invite.token}`;
        }
      } catch {
        return `${window.location.origin}/invite/${invite.token}`;
      }
    }
    return invite.inviteUrl;
  };

  const handleCopyInvite = async () => {
    if (!activeInvite) return;
    try {
      const urlToCopy = getEffectiveInviteUrl(activeInvite);
      await navigator.clipboard.writeText(urlToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_err) {}
  };

  const handleVoid = async (txId: string) => {
    if (
      !confirm(
        'Are you sure you want to void this transaction? An append-only reversal entry will be recorded.'
      )
    ) {
      return;
    }
    setVoidingId(txId);
    try {
      await voidMutation.mutateAsync(txId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to void transaction';
      alert(message);
    } finally {
      setVoidingId(null);
    }
  };

  // Partition buckets into user buckets & partner/shared buckets
  const myBuckets = useMemo(
    () => buckets.filter((b) => !b.isArchived && b.ownerId === user?.id),
    [buckets, user?.id]
  );

  const partnerBuckets = useMemo(
    () => buckets.filter((b) => !b.isArchived && b.ownerId !== user?.id),
    [buckets, user?.id]
  );

  // Net saved calculation
  const incomePaise = monthSummary?.totalIncome ?? 0;
  const expensePaise = monthSummary?.totalExpense ?? 0;
  const netSavedPaise = monthSummary?.netSavings ?? (incomePaise - expensePaise);

  const monthCategories = categoryData?.items || [];

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted">
        <div className="flex items-center gap-3">
          <RefreshCw className="animate-spin h-5 w-5 text-primary" />
          <span className="text-sm font-medium text-foreground">Loading Vault...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col antialiased">
      {/* Top Navigation Bar */}
      <header className="border-b border-border bg-card/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          {/* Logo & Partner Badge */}
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 text-primary font-bold flex items-center justify-center text-base shadow-xs">
                V
              </div>
              <div className="hidden sm:block">
                <span className="text-base font-bold tracking-tight text-foreground">
                  Vault
                </span>
                <span className="ml-2 text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold">
                  Family Finance
                </span>
              </div>
            </Link>

            {/* Partner Status Pill */}
            {partner ? (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <UserCheck className="w-3.5 h-3.5" />
                <span>Partner: {partner.name}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setInviteModalOpen(true);
                  if (!activeInvite) handleCreateInvite();
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-[11px] font-semibold text-amber-600 dark:text-amber-400 transition-colors cursor-pointer"
              >
                <Users className="w-3.5 h-3.5" />
                <span>+ Connect Partner</span>
              </button>
            )}
          </div>

          {/* 3 Quick Action Buttons right in header */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleOpenIncome()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
              title="Add Income received"
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              <span>Income</span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenExpense()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
              title="Record an Expense"
            >
              <Minus className="w-3.5 h-3.5 stroke-[3]" />
              <span>Expense</span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenTransfer()}
              className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
              title="Transfer to Savings or between accounts"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Transfer</span>
            </button>

            <div className="h-6 w-px bg-border mx-1 hidden md:block" />

            <Link
              href="/buckets"
              className="hidden lg:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted/15 transition-colors"
            >
              <span>Accounts</span>
            </Link>

            <Link
              href="/plans"
              className="hidden lg:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted/15 transition-colors"
            >
              <span>Plans & EMI</span>
            </Link>

            <ThemeToggle />

            <button
              type="button"
              onClick={handleLogout}
              className="p-1.5 rounded-xl text-muted hover:text-foreground hover:bg-muted/15 transition-colors cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-28 sm:pb-8 w-full space-y-6 flex-1">
        {/* Optional Live Alerts Banner (for loan / kuri dues) */}
        <DashboardAlertsBanner />

        {/* ========================================================
            MONTH SELECTOR / FILTER (CENTRAL CONTROLLER)
           ======================================================== */}
        <div className="bg-card border border-border rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedDay('');
                setSelectedMonth((m) => addMonths(m, -1));
              }}
              className="p-2 rounded-xl bg-background border border-border hover:bg-muted/20 text-foreground transition-colors cursor-pointer"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 px-4 py-2 bg-background border border-border rounded-xl">
              <Calendar className="w-4 h-4 text-primary" />
              <span className="font-bold text-sm sm:text-base text-foreground tracking-tight">
                {formatMonthTitle(selectedMonth)}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setSelectedDay('');
                setSelectedMonth((m) => addMonths(m, 1));
              }}
              className="p-2 rounded-xl bg-background border border-border hover:bg-muted/20 text-foreground transition-colors cursor-pointer"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {selectedMonth !== currentMonth && (
              <button
                type="button"
                onClick={() => setSelectedMonth(currentMonth)}
                className="px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold transition-colors cursor-pointer"
              >
                Back to This Month
              </button>
            )}

            <button
              type="button"
              onClick={() => handleOpenTransfer()}
              className="sm:hidden inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Transfer</span>
            </button>
          </div>
        </div>

        {/* ========================================================
            MONTHLY OVERVIEW: 3 CORE FINANCIAL CARDS
           ======================================================== */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* 1. Total Income */}
          <div className="bg-gradient-to-br from-emerald-500/10 via-card to-card border border-emerald-500/20 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Total Income
                </span>
                <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <ArrowDownLeft className="w-4 h-4" />
                </span>
              </div>
              <p className="text-2xl sm:text-3xl font-extrabold text-foreground mt-3 font-mono tabular-nums">
                {formatINR(incomePaise)}
              </p>
            </div>
            <p className="text-[11px] text-muted mt-3 pt-2.5 border-t border-border/60">
              Salary, business & cash inflow in {formatMonthTitle(selectedMonth)}
            </p>
          </div>

          {/* 2. Total Expense */}
          <div className="bg-gradient-to-br from-rose-500/10 via-card to-card border border-rose-500/20 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                  Total Expenses
                </span>
                <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                  <ArrowUpRight className="w-4 h-4" />
                </span>
              </div>
              <p className="text-2xl sm:text-3xl font-extrabold text-foreground mt-3 font-mono tabular-nums">
                {formatINR(expensePaise)}
              </p>
            </div>
            <p className="text-[11px] text-muted mt-3 pt-2.5 border-t border-border/60">
              Total spent across groceries, bills & shopping
            </p>
          </div>

          {/* 3. Net Saved / Remaining Balance */}
          <div
            className={`bg-gradient-to-br ${
              netSavedPaise >= 0
                ? 'from-blue-500/10 via-card to-card border-blue-500/20'
                : 'from-amber-500/10 via-card to-card border-amber-500/20'
            } border rounded-2xl p-5 shadow-xs flex flex-col justify-between`}
          >
            <div>
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-bold uppercase tracking-wider ${
                    netSavedPaise >= 0
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {netSavedPaise >= 0 ? 'Net Savings' : 'Net Deficit'}
                </span>
                <span className="p-1.5 rounded-lg bg-card text-foreground">
                  <PiggyBank className="w-4 h-4" />
                </span>
              </div>
              <p
                className={`text-2xl sm:text-3xl font-extrabold mt-3 font-mono tabular-nums ${
                  netSavedPaise >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {formatINR(Math.abs(netSavedPaise))}
              </p>
            </div>
            <p className="text-[11px] text-muted mt-3 pt-2.5 border-t border-border/60">
              {netSavedPaise >= 0
                ? 'Remaining cash surplus from this month’s income'
                : 'Expenses exceeded income for this month'}
            </p>
          </div>
        </div>

        {/* ========================================================
            "HOW INCOME IS SPENT" (CATEGORY BREAKDOWN)
           ======================================================== */}
        <section className="bg-card border border-border rounded-2xl p-6 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div>
              <h2 className="text-base font-bold text-foreground">
                Spending by Category
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Category-wise breakdown for {formatMonthTitle(selectedMonth)}
              </p>
            </div>
            {monthCategories.length > 0 && (
              <span className="text-xs font-semibold text-muted">
                {monthCategories.length} Categories
              </span>
            )}
          </div>

          <div className="mt-4">
            {categoriesLoading ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 bg-muted/20 rounded-md w-full" />
                <div className="h-4 bg-muted/20 rounded-md w-3/4" />
              </div>
            ) : monthCategories.length === 0 ? (
              <div className="text-center py-8 text-muted space-y-2">
                <p className="text-sm">No expenses recorded for {formatMonthTitle(selectedMonth)} yet.</p>
                <button
                  type="button"
                  onClick={() => handleOpenExpense()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Record First Expense</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3.5">
                {monthCategories.map((cat) => {
                  const percentage = cat.percentage;
                  return (
                    <div key={cat.category} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="text-foreground">{cat.category}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-muted font-mono">{percentage}%</span>
                          <span className="text-foreground font-mono font-bold">
                            {formatINR(cat.amount)}
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted/20 overflow-hidden">
                        <div
                          className="h-full bg-rose-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(2, percentage))}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ========================================================
            "ACCOUNTS & PARTNER TRACKING" (ACCOUNTS / BUCKETS)
           ======================================================== */}
        <section className="bg-card border border-border rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-border">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Wallet className="w-5 h-5 text-primary" />
                <span>Accounts & Balances</span>
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Track Cash in Hand, Bank Accounts, Savings & Partner funds
              </p>
            </div>
            <Link
              href="/buckets"
              className="text-xs font-semibold text-primary hover:underline self-start sm:self-auto"
            >
              Manage / Add Accounts →
            </Link>
          </div>

          {/* My Accounts Grid */}
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted block">
              My Accounts
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {myBuckets.map((b) => (
                <div
                  key={b.id}
                  className="p-4 rounded-xl bg-background border border-border flex items-center justify-between gap-3 shadow-2xs hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{getBucketIcon(b.type)}</span>
                    <div>
                      <h3 className="text-xs font-bold text-foreground">{b.name}</h3>
                      <p className="text-sm font-extrabold text-foreground font-mono mt-0.5">
                        {formatINR(b.balance)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenTransfer(b.id)}
                      className="p-1.5 rounded-lg bg-muted/10 hover:bg-muted/20 text-muted hover:text-foreground text-[11px] font-semibold transition-colors cursor-pointer"
                      title="Transfer / Save"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenIncome(b.id)}
                      className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold transition-colors cursor-pointer"
                      title="Deposit Income"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Partner & Shared Accounts Grid */}
          {partnerBuckets.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-border">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 block flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span>Partner&apos;s & Shared Accounts ({partner?.name || 'Partner'})</span>
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {partnerBuckets.map((b) => (
                  <div
                    key={b.id}
                    className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/20 flex items-center justify-between gap-3 shadow-2xs"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{getBucketIcon(b.type)}</span>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-xs font-bold text-foreground">{b.name}</h3>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold">
                            Shared
                          </span>
                        </div>
                        <p className="text-sm font-extrabold text-foreground font-mono mt-0.5">
                          {formatINR(b.balance)}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenTransfer(b.id)}
                      className="p-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 text-[11px] font-semibold transition-colors cursor-pointer"
                      title="Transfer to/from Partner"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ========================================================
            MONTHLY TRANSACTIONS LIST
           ======================================================== */}
        <section className="bg-card border border-border rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-base font-bold text-foreground">
                  Transactions
                </h2>

                {/* Inline Calendar / Date Picker right next to Transactions */}
                <div className="flex items-center gap-1.5 bg-background border border-border rounded-xl px-2.5 py-1 text-xs">
                  <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
                  <input
                    type="date"
                    value={selectedDay}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedDay(val);
                      if (val) {
                        setSelectedMonth(val.substring(0, 7));
                      }
                    }}
                    className="bg-transparent border-none text-foreground font-semibold text-xs focus:outline-hidden cursor-pointer"
                    title="Select date"
                  />
                  {selectedDay ? (
                    <button
                      type="button"
                      onClick={() => setSelectedDay('')}
                      className="text-[11px] font-bold text-rose-500 hover:text-rose-600 px-1 py-0.5 rounded cursor-pointer"
                      title="Clear to view All Month"
                    >
                      ✕ All Month
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDay(todayIsoDate);
                        setSelectedMonth(todayIsoDate.substring(0, 7));
                      }}
                      className="text-[11px] font-bold text-primary hover:text-primary/80 bg-primary/10 px-2 py-0.5 rounded-md cursor-pointer"
                    >
                      Today
                    </button>
                  )}
                </div>
              </div>

              <p className="text-xs text-muted mt-1">
                {selectedDay
                  ? `Showing records for ${new Date(selectedDay).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`
                  : `Showing all records for ${formatMonthTitle(selectedMonth)}`}
              </p>
            </div>

            {/* Dynamic Filter Total Badge & Type Pills */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 self-start sm:self-auto">
              {/* Dynamic summary based on active filter */}
              {filterType === 'expense' && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 font-bold text-xs">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  <span>Total Expenses:</span>
                  <span className="font-mono text-sm">{formatINR(filteredMetrics.expenseSum)}</span>
                </div>
              )}
              {filterType === 'income' && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  <span>Total Income:</span>
                  <span className="font-mono text-sm">{formatINR(filteredMetrics.incomeSum)}</span>
                </div>
              )}
              {filterType === 'transfer' && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 font-bold text-xs">
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>Total Moved:</span>
                  <span className="font-mono text-sm">{formatINR(filteredMetrics.transferSum)}</span>
                </div>
              )}
              {filterType === 'all' && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-muted/15 border border-border text-foreground font-semibold text-xs">
                  <span>Net Flow:</span>
                  <span
                    className={`font-mono text-sm font-bold ${
                      filteredMetrics.netSum >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {filteredMetrics.netSum >= 0 ? '+' : ''}
                    {formatINR(filteredMetrics.netSum)}
                  </span>
                </div>
              )}

              {/* Type Filter Pills */}
              <div className="flex items-center gap-1 p-1 bg-background border border-border rounded-xl overflow-x-auto">
                {(
                  [
                    { key: 'all', label: 'All' },
                    { key: 'income', label: '+ Income' },
                    { key: 'expense', label: '- Expense' },
                    { key: 'transfer', label: '⇄ Transfer' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilterType(tab.key)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                      filterType === tab.key
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'text-muted hover:text-foreground'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by note, description, or category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-background border border-border text-xs text-foreground focus:outline-hidden focus:border-primary"
            />
          </div>

          {/* Transactions Feed */}
          <div className="space-y-2.5 pt-1">
            {txLoading ? (
              <div className="space-y-3 py-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-muted/15 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-10 text-muted space-y-2">
                <p className="text-xs">No transactions found for this month.</p>
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handleOpenIncome()}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold"
                  >
                    + Add Income
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenExpense()}
                    className="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold"
                  >
                    - Record Expense
                  </button>
                </div>
              </div>
            ) : (
              transactions.map((tx) => {
                const isIncome = tx.type === 'income';
                const isExpense = tx.type === 'expense';
                const isTransfer = tx.type === 'transfer';
                const isCreator = tx.createdBy === user?.id;
                const isVoided = tx.status === 'voided';

                const formattedDate = new Date(tx.date).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <div
                    key={tx.id}
                    className={`p-3.5 rounded-xl bg-background border border-border flex items-center justify-between gap-3 transition-colors ${
                      isVoided ? 'opacity-40 line-through' : 'hover:border-primary/30'
                    }`}
                  >
                    {/* Left: Icon & Details */}
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 ${
                          isIncome
                            ? 'bg-emerald-600'
                            : isExpense
                            ? 'bg-rose-600'
                            : 'bg-blue-600'
                        }`}
                      >
                        {isIncome && <ArrowDownLeft className="w-4 h-4 stroke-[2.5]" />}
                        {isExpense && <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />}
                        {isTransfer && <ArrowRightLeft className="w-4 h-4 stroke-[2.5]" />}
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-foreground">
                            {tx.category || (isTransfer ? 'Transfer' : 'Transaction')}
                          </span>
                          {/* Partner vs You Badge */}
                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                              isCreator
                                ? 'bg-primary/10 text-primary'
                                : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                            }`}
                          >
                            {isCreator ? 'You' : partner?.name || 'Partner'}
                          </span>
                        </div>

                        <p className="text-[11px] text-muted flex items-center gap-2">
                          <span>{formattedDate}</span>
                          <span>•</span>
                          <span>
                            {isIncome && `To: ${tx.toBucketName || 'Account'}`}
                            {isExpense && `From: ${tx.fromBucketName || 'Account'}`}
                            {isTransfer &&
                              `${tx.fromBucketName || 'Account'} → ${tx.toBucketName || 'Account'}`}
                          </span>
                        </p>

                        {tx.purpose && (
                          <p className="text-[11px] text-foreground/80 italic">
                            &ldquo;{tx.purpose}&rdquo;
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right: Amount & Void Action */}
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p
                          className={`text-sm sm:text-base font-extrabold font-mono tabular-nums ${
                            isIncome
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : isExpense
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-blue-600 dark:text-blue-400'
                          }`}
                        >
                          {isIncome && '+ '}
                          {isExpense && '- '}
                          {isTransfer && '⇄ '}
                          {formatINR(tx.amount)}
                        </p>
                        {isVoided && (
                          <span className="text-[10px] text-rose-500 font-bold uppercase">
                            Voided
                          </span>
                        )}
                      </div>

                      {/* Creator can edit or void active transaction */}
                      {isCreator && !isVoided && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTx(tx);
                              setTxModalMode(tx.type as 'income' | 'expense' | 'transfer');
                              setTxModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                            title="Edit this entry"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleVoid(tx.id)}
                            disabled={voidingId === tx.id}
                            className="p-1.5 rounded-lg text-muted hover:text-rose-600 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title="Void this entry"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>

      {/* Mobile Bottom Navigation Bar (sm:hidden) */}
      <nav
        aria-label="Mobile Navigation"
        className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-xl border-t border-border px-3 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] flex items-center justify-around shadow-2xl"
      >
        <Link
          href="/"
          className="flex flex-col items-center gap-1 text-[10px] font-bold text-primary px-2 py-1"
        >
          <Wallet className="w-5 h-5" />
          <span>Home</span>
        </Link>

        <button
          type="button"
          onClick={() => handleOpenIncome()}
          className="flex flex-col items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 px-2 py-1 active:scale-95 transition-transform cursor-pointer"
        >
          <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-md">
            <Plus className="w-4 h-4 stroke-[3]" />
          </div>
          <span>+ Income</span>
        </button>

        <button
          type="button"
          onClick={() => handleOpenExpense()}
          className="flex flex-col items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 px-2 py-1 active:scale-95 transition-transform cursor-pointer"
        >
          <div className="w-9 h-9 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-md">
            <Minus className="w-4 h-4 stroke-[3]" />
          </div>
          <span>- Expense</span>
        </button>

        <button
          type="button"
          onClick={() => handleOpenTransfer()}
          className="flex flex-col items-center gap-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 px-2 py-1 active:scale-95 transition-transform cursor-pointer"
        >
          <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md">
            <ArrowRightLeft className="w-4 h-4" />
          </div>
          <span>⇄ Transfer</span>
        </button>

        <Link
          href="/buckets"
          className="flex flex-col items-center gap-1 text-[10px] font-bold text-muted hover:text-foreground px-2 py-1"
        >
          <Building2 className="w-5 h-5" />
          <span>Accounts</span>
        </Link>
      </nav>

      {/* Transaction Modal */}
      <TransactionModal
        isOpen={txModalOpen}
        onClose={() => {
          setEditingTx(null);
          setTxModalOpen(false);
        }}
        buckets={buckets}
        initialMode={txModalMode}
        preselectedBucketId={preselectedBucketId}
        partnerName={partner?.name}
        editingTransaction={editingTx}
      />

      {/* Connect Partner Modal */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md bg-card text-card-foreground rounded-3xl shadow-2xl border border-border p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">Invite Your Partner</h3>
              </div>
              <button
                type="button"
                onClick={() => setInviteModalOpen(false)}
                className="p-1.5 rounded-xl text-muted hover:text-foreground cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted leading-relaxed">
              Share this invite link with your spouse or family partner. Once they register using
              this link, you will both track shared accounts, cash flow, and household expenses
              together seamlessly.
            </p>

            {inviteError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs font-medium">
                {inviteError}
              </div>
            )}

            {generatingInvite ? (
              <div className="p-4 rounded-xl bg-muted/15 text-center text-xs text-muted animate-pulse">
                Generating unique invite link...
              </div>
            ) : activeInvite ? (
              <div className="space-y-3 pt-2">
                <div className="p-3 rounded-xl bg-background border border-border text-xs font-mono break-all text-muted">
                  {getEffectiveInviteUrl(activeInvite)}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="py-2.5 px-3 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copied ? 'Copied!' : 'Copy Link'}</span>
                  </button>

                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(
                      `Hi! Join my Vault to track our family cash flow and expenses together: ${getEffectiveInviteUrl(activeInvite)}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    <Send className="w-4 h-4" />
                    <span>WhatsApp</span>
                  </a>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleCreateInvite}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold cursor-pointer"
              >
                Generate Invite Link
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
