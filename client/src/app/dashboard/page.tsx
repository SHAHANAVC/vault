'use client';

/**
 * Client Component: /dashboard
 * 
 * Server vs Client Component Rationale:
 * This page is marked as 'use client' because it orchestrates rich interactive capabilities:
 * 1. Dynamic Month Navigation: Interactively cycles between past, current, and future months
 *    with responsive query refetching via TanStack Query.
 * 2. Recharts Data Visualizations: Interactive SVG charts (Income vs Expense Bar Chart,
 *    Category Expense Donut) that require client-side window resizing, tooltips, and canvas events.
 * 3. Modal Dialogs: Instant creation of single transactions, salary splits, bucket edits,
 *    and balance adjustments without full page transitions.
 * 4. Interactive Tooltips: Hover and focus tooltips explaining financial invariant metrics
 *    (Household Total vs My Total).
 */

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  formatINR,
  PublicBucket,
  PublicTransaction,
  Visibility,
  MonthSummaryResponse,
  CategoryBreakdownResponse,
  TrendResponse,
} from '@vault/shared';
import {
  useDashboard,
  useCategoryBreakdown,
  useTrendReport,
} from '../../lib/transactionHooks';
import {
  useBuckets,
  useCreateBucket,
  useUpdateBucket,
  useUpdateVisibility,
  useArchiveBucket,
  useAuthMe,
} from '../../lib/bucketHooks';
import { ThemeToggle } from '../../components/ThemeToggle';
import { BucketCard } from '../../components/BucketCard';
import { BucketFormModal } from '../../components/BucketFormModal';
import { AdjustmentModal } from '../../components/AdjustmentModal';
import { TransactionModal } from '../../components/TransactionModal';
import { DashboardAlertsBanner } from '../../components/DashboardAlertsBanner';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Wallet,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Layers,
  ArrowRight,
  Plus,
  Split,
  Receipt,
  Info,
  Users,
  Scale,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRightLeft,
  SlidersHorizontal,
  Table,
  CheckCircle2,
  PieChart as PieChartIcon,
  BarChart3,
  ExternalLink,
} from 'lucide-react';

// Curated harmonious chart colors
const CATEGORY_COLORS = [
  '#0F766E', // Primary Teal
  '#2563EB', // Blue
  '#7C3AED', // Violet
  '#DB2777', // Pink
  '#D97706', // Amber
  '#059669', // Emerald
  '#4B5563', // Slate
  '#84CC16', // Lime
];

function getInitialISTMonth(): string {
  const d = new Date();
  // Adjust to Asia/Kolkata (UTC+5:30)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(d.getTime() + (d.getTimezoneOffset() * 60 * 1000) + istOffsetMs);
  const y = istDate.getFullYear();
  const m = String(istDate.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function offsetMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map((v) => parseInt(v, 10));
  const date = new Date(y, m - 1 + delta, 1);
  const nextY = date.getFullYear();
  const nextM = String(date.getMonth() + 1).padStart(2, '0');
  return `${nextY}-${nextM}`;
}

export default function DashboardPage() {
  const currentISTMonth = useMemo(() => getInitialISTMonth(), []);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentISTMonth);
  const [showDataTable, setShowDataTable] = useState(false);
  const [viewScope, setViewScope] = useState<'personal' | 'household'>('personal');
  const [bucketFilter, setBucketFilter] = useState<'all' | 'mine' | 'partner'>('mine');

  // Authentication & Partner Context
  const { data: authData } = useAuthMe();
  const partnerName = authData?.partner?.name || null;

  // Data Queries
  const { data: dashboard, isLoading: isDashboardLoading } = useDashboard(selectedMonth);
  const { data: categoryData, isLoading: isCategoriesLoading } = useCategoryBreakdown(selectedMonth);
  const { data: trendData, isLoading: isTrendLoading } = useTrendReport(6);

  // Modals State
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txModalMode, setTxModalMode] = useState<
    'single' | 'transfer' | 'split-income' | 'split-transfer'
  >('single');
  const [selectedBucketForTx, setSelectedBucketForTx] = useState<PublicBucket | null>(null);

  const [bucketModalOpen, setBucketModalOpen] = useState(false);
  const [editingBucket, setEditingBucket] = useState<PublicBucket | null>(null);

  const [adjustModalBucket, setAdjustModalBucket] = useState<PublicBucket | null>(null);

  // Bucket Mutations
  const createMutation = useCreateBucket();
  const updateMutation = useUpdateBucket();
  const updateVisibilityMutation = useUpdateVisibility();
  const archiveMutation = useArchiveBucket();

  // Tooltip Toggle States
  const [householdTooltipOpen, setHouseholdTooltipOpen] = useState(false);
  const [myTotalTooltipOpen, setMyTotalTooltipOpen] = useState(false);

  // Transform trend data for Recharts (Rupees for clean chart axes)
  const chartTrendData = useMemo(() => {
    if (!trendData?.items) return [];
    return trendData.items.map((item) => {
      const [year, month] = item.month.split('-');
      const shortMonth = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1).toLocaleDateString(
        'en-IN',
        { month: 'short' }
      );
      return {
        month: shortMonth,
        rawMonth: item.month,
        incomeRupees: item.income / 100,
        expenseRupees: item.expense / 100,
        netSavingsRupees: item.netSavings / 100,
        incomePaise: item.income,
        expensePaise: item.expense,
      };
    });
  }, [trendData]);

  // Transform category data for PieChart
  const pieCategoryData = useMemo(() => {
    if (!categoryData?.items || categoryData.items.length === 0) return [];
    return categoryData.items.map((item, idx) => ({
      name: item.category,
      value: item.amount / 100, // Rupees for slice proportions
      amountPaise: item.amount,
      percentage: item.percentage,
      color: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
    }));
  }, [categoryData]);

  const monthSummary = dashboard?.monthSummary;
  const buckets = useMemo(() => dashboard?.buckets || [], [dashboard?.buckets]);
  const recentTransactions = dashboard?.recentTransactions || [];

  // Partition buckets by ownership
  const myBuckets = useMemo(
    () => buckets.filter((b) => !b.isArchived && b.isOwner),
    [buckets]
  );

  const partnerBuckets = useMemo(
    () => buckets.filter((b) => !b.isArchived && !b.isOwner),
    [buckets]
  );

  const filteredBuckets = useMemo(() => {
    if (bucketFilter === 'mine') return myBuckets;
    if (bucketFilter === 'partner') return partnerBuckets;
    return buckets;
  }, [buckets, myBuckets, partnerBuckets, bucketFilter]);

  // Liquid funds = Cash & Bank accounts (Spendable immediately in hand or account)
  const myLiquidTotal = useMemo(() => {
    return myBuckets
      .filter((b) => b.type === 'cash' || b.type === 'bank')
      .reduce((sum, b) => sum + b.balance, 0);
  }, [myBuckets]);

  // Locked savings = Kuri & Gold Schemes (Accumulating savings asset, locked until maturity/payout)
  const myLockedSavingsTotal = useMemo(() => {
    return myBuckets
      .filter((b) => b.type === 'kuri' || b.type === 'gold_scheme')
      .reduce((sum, b) => sum + b.balance, 0);
  }, [myBuckets]);

  // Liabilities = Loans Taken
  const myLoansTotal = useMemo(() => {
    return myBuckets
      .filter((b) => b.type === 'loan_taken')
      .reduce((sum, b) => sum + b.balance, 0);
  }, [myBuckets]);

  // Total Net Portfolio (Liquid + Locked Savings - Loans)
  const myNetTotal = useMemo(() => {
    return myLiquidTotal + myLockedSavingsTotal - myLoansTotal;
  }, [myLiquidTotal, myLockedSavingsTotal, myLoansTotal]);

  // Partner calculations
  const partnerLiquidTotal = useMemo(() => {
    return partnerBuckets
      .filter((b) => b.type === 'cash' || b.type === 'bank')
      .reduce((sum, b) => sum + b.balance, 0);
  }, [partnerBuckets]);

  const partnerLockedSavingsTotal = useMemo(() => {
    return partnerBuckets
      .filter((b) => b.type === 'kuri' || b.type === 'gold_scheme')
      .reduce((sum, b) => sum + b.balance, 0);
  }, [partnerBuckets]);

  const partnerLoansTotal = useMemo(() => {
    return partnerBuckets
      .filter((b) => b.type === 'loan_taken')
      .reduce((sum, b) => sum + b.balance, 0);
  }, [partnerBuckets]);

  const partnerNetTotal = useMemo(() => {
    return partnerLiquidTotal + partnerLockedSavingsTotal - partnerLoansTotal;
  }, [partnerLiquidTotal, partnerLockedSavingsTotal, partnerLoansTotal]);

  // Combined Household calculations
  const householdLiquidTotal = useMemo(() => {
    return buckets
      .filter((b) => !b.isArchived && (b.type === 'cash' || b.type === 'bank'))
      .reduce((sum, b) => sum + b.balance, 0);
  }, [buckets]);

  const householdLockedSavingsTotal = useMemo(() => {
    return buckets
      .filter((b) => !b.isArchived && (b.type === 'kuri' || b.type === 'gold_scheme'))
      .reduce((sum, b) => sum + b.balance, 0);
  }, [buckets]);

  const householdLoansTotal = useMemo(() => {
    return buckets
      .filter((b) => !b.isArchived && b.type === 'loan_taken')
      .reduce((sum, b) => sum + b.balance, 0);
  }, [buckets]);

  const householdNetTotal = useMemo(() => {
    return householdLiquidTotal + householdLockedSavingsTotal - householdLoansTotal;
  }, [householdLiquidTotal, householdLockedSavingsTotal, householdLoansTotal]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur-md px-4 sm:px-6 py-3.5 transition-colors">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm">
              <PiggyBank className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-foreground">
                  Vault Dashboard
                </h1>
                {partnerName && (
                  <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[11px] font-medium">
                    <ShieldCheck className="w-3 h-3" />
                    with {partnerName}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted">
                Collaborative cash flow, bucket balances & monthly analytics
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/transactions"
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs font-medium text-foreground hover:bg-muted/10 transition-colors"
            >
              <Receipt className="w-4 h-4 text-primary" />
              Transactions
            </Link>

            <Link
              href="/buckets"
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs font-medium text-foreground hover:bg-muted/10 transition-colors"
            >
              <Layers className="w-4 h-4 text-primary" />
              Buckets
            </Link>

            <Link
              href="/plans"
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs font-medium text-foreground hover:bg-muted/10 transition-colors"
            >
              <Calendar className="w-4 h-4 text-primary" />
              Plans & EMI
            </Link>

            <div className="hidden sm:flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setSelectedBucketForTx(null);
                  setTxModalMode('single');
                  setTxModalOpen(true);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 shadow-sm flex items-center gap-1.5 transition-all"
              >
                <Plus className="w-4 h-4" />
                Record Tx
              </button>

              <button
                type="button"
                onClick={() => {
                  setTxModalMode('split-income');
                  setTxModalOpen(true);
                }}
                className="px-3 py-1.5 rounded-xl border border-primary/20 bg-primary/5 text-primary text-xs font-semibold hover:bg-primary/10 transition-all flex items-center gap-1.5"
                title="Split salary across buckets"
              >
                <Split className="w-4 h-4" />
                Split Salary
              </button>
            </div>

            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3.5 sm:p-5 space-y-4">
        {/* Live Phase 7 EMI & Kuri Alerts & Shortfalls */}
        <DashboardAlertsBanner />

        {/* Top Controls: View Scope Toggle & Month Selector */}
        <section className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3.5 pb-1">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full md:w-auto justify-between md:justify-start">
            <div>
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                Financial Overview
              </h2>
              <p className="text-xs text-muted">
                Reporting period: {formatMonthLabel(selectedMonth)}
              </p>
            </div>

            {/* Segmented Scope Toggle: My Finances vs Family Overview */}
            <div className="inline-flex p-1 bg-muted/20 border border-border rounded-2xl shadow-2xs self-start sm:self-auto">
              <button
                type="button"
                onClick={() => {
                  setViewScope('personal');
                  setBucketFilter('mine');
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  viewScope === 'personal'
                    ? 'bg-card text-foreground shadow-xs border border-border/80'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                <Wallet className="w-3.5 h-3.5 text-emerald-500" />
                <span>My Finances</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewScope('household');
                  setBucketFilter('all');
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  viewScope === 'household'
                    ? 'bg-card text-foreground shadow-xs border border-border/80'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-blue-500" />
                <span>Family Overview</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-card border border-border p-1 rounded-xl shadow-2xs self-end md:self-auto">
            <button
              type="button"
              onClick={() => setSelectedMonth((m) => offsetMonth(m, -1))}
              className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-muted/10 transition-colors cursor-pointer"
              title="Previous Month"
              aria-label="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1.5 px-2 text-xs font-semibold text-foreground">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              <span>{formatMonthLabel(selectedMonth)}</span>
            </div>

            <button
              type="button"
              onClick={() => setSelectedMonth((m) => offsetMonth(m, 1))}
              className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-muted/10 transition-colors cursor-pointer"
              title="Next Month"
              aria-label="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {selectedMonth !== currentISTMonth && (
              <button
                type="button"
                onClick={() => setSelectedMonth(currentISTMonth)}
                className="ml-1 px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/10 rounded-md transition-colors cursor-pointer"
              >
                Today
              </button>
            )}
          </div>
        </section>

        {/* Top Metric Cards: 3-Column Compact Laptop Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {viewScope === 'personal' ? (
            <>
              {/* Card 1: Available Liquid Cash (Cash & Bank) */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-card to-emerald-500/5 border border-emerald-500/25 shadow-2xs relative overflow-hidden group">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <Wallet className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
                      Available Cash & Bank
                    </span>
                  </div>

                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    Spendable Now
                  </span>
                </div>

                <div className="mt-2">
                  {isDashboardLoading ? (
                    <div className="h-7 w-28 bg-muted/20 animate-pulse rounded-lg" />
                  ) : (
                    <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground font-mono">
                      {formatINR(myLiquidTotal)}
                    </div>
                  )}
                  <p className="text-[11px] text-muted mt-0.5">
                    Instant liquid money in bank & cash pockets
                  </p>
                </div>
              </div>

              {/* Card 2: Kuri & Locked Savings (Chit funds & Gold schemes) */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-card to-amber-500/5 border border-amber-500/25 shadow-2xs relative overflow-hidden group">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <PiggyBank className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
                      Kuri & Locked Savings
                    </span>
                  </div>

                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    Locked Asset
                  </span>
                </div>

                <div className="mt-2">
                  {isDashboardLoading ? (
                    <div className="h-7 w-28 bg-muted/20 animate-pulse rounded-lg" />
                  ) : (
                    <div className="text-xl sm:text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400 font-mono">
                      {formatINR(myLockedSavingsTotal)}
                    </div>
                  )}
                  <p className="text-[11px] text-muted mt-0.5">
                    Accumulating chit funds & gold (payout upon maturity)
                  </p>
                </div>
              </div>

              {/* Card 3: Partner's Available Cash (or Net Worth if no partner) */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-card to-blue-500/5 border border-blue-500/25 shadow-2xs relative overflow-hidden group">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                      <Users className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
                      {partnerName ? `${partnerName}'s Available` : 'Partner Funds'}
                    </span>
                  </div>

                  {partnerName ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                      Shared with you
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-muted/20 text-muted">
                      No partner
                    </span>
                  )}
                </div>

                <div className="mt-2">
                  {isDashboardLoading ? (
                    <div className="h-7 w-28 bg-muted/20 animate-pulse rounded-lg" />
                  ) : (
                    <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground font-mono">
                      {formatINR(partnerLiquidTotal)}
                    </div>
                  )}
                  <p className="text-[11px] text-muted mt-0.5">
                    {partnerName
                      ? `Liquid bank & cash shared by ${partnerName}`
                      : 'Invite your partner to collaborate on family accounts'}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Card 1: Household Liquid Cash */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-card to-emerald-500/5 border border-emerald-500/25 shadow-2xs relative overflow-hidden group">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <Wallet className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
                      Household Liquid Cash
                    </span>
                  </div>

                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    Spendable Now
                  </span>
                </div>

                <div className="mt-2">
                  {isDashboardLoading ? (
                    <div className="h-7 w-28 bg-muted/20 animate-pulse rounded-lg" />
                  ) : (
                    <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground font-mono">
                      {formatINR(householdLiquidTotal)}
                    </div>
                  )}
                  <p className="text-[11px] text-muted mt-0.5">
                    Total instant spendable money across family bank accounts
                  </p>
                </div>
              </div>

              {/* Card 2: Family Kuri & Gold */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-card to-amber-500/5 border border-amber-500/25 shadow-2xs relative overflow-hidden group">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <PiggyBank className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
                      Family Kuri & Savings
                    </span>
                  </div>

                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    Locked Assets
                  </span>
                </div>

                <div className="mt-2">
                  {isDashboardLoading ? (
                    <div className="h-7 w-28 bg-muted/20 animate-pulse rounded-lg" />
                  ) : (
                    <div className="text-xl sm:text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400 font-mono">
                      {formatINR(householdLockedSavingsTotal)}
                    </div>
                  )}
                  <p className="text-[11px] text-muted mt-0.5">
                    Combined rotating chit funds & gold schemes pool
                  </p>
                </div>
              </div>

              {/* Card 3: Combined Family Net Worth */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-card to-primary/5 border border-primary/25 shadow-2xs relative overflow-hidden group">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
                      Total Family Net Worth
                    </span>
                  </div>

                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                    Net Portfolio
                  </span>
                </div>

                <div className="mt-2">
                  {isDashboardLoading ? (
                    <div className="h-7 w-28 bg-muted/20 animate-pulse rounded-lg" />
                  ) : (
                    <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground font-mono">
                      {formatINR(householdNetTotal)}
                    </div>
                  )}
                  <p className="text-[11px] text-muted mt-0.5">
                    Liquid cash + locked savings minus active loan liabilities
                  </p>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Monthly Summary Cards: Income, Expense, Net Savings */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {/* Income Card */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-card border border-border shadow-2xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
                Monthly Income
              </span>
              <div className="p-1.5 rounded-lg bg-positive/10 text-positive">
                <TrendingUp className="w-3.5 h-3.5" />
              </div>
            </div>
            {isDashboardLoading ? (
              <div className="h-6 w-24 bg-muted/20 animate-pulse rounded-lg" />
            ) : (
              <div className="text-xl sm:text-2xl font-bold text-positive font-mono">
                +{formatINR(monthSummary?.totalIncome ?? 0)}
              </div>
            )}
            <p className="text-[10px] text-muted">
              Excludes transfers, adjustments & opening balances
            </p>
          </div>

          {/* Expense Card */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-card border border-border shadow-2xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
                Monthly Expense
              </span>
              <div className="p-1.5 rounded-lg bg-negative/10 text-negative">
                <TrendingDown className="w-3.5 h-3.5" />
              </div>
            </div>
            {isDashboardLoading ? (
              <div className="h-6 w-24 bg-muted/20 animate-pulse rounded-lg" />
            ) : (
              <div className="text-xl sm:text-2xl font-bold text-negative font-mono">
                -{formatINR(monthSummary?.totalExpense ?? 0)}
              </div>
            )}
            <p className="text-[10px] text-muted">
              Only active non-voided household spending
            </p>
          </div>

          {/* Net Savings Card */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-card border border-border shadow-2xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
                Net Savings
              </span>
              <div
                className={`p-1.5 rounded-lg ${
                  (monthSummary?.netSavings ?? 0) >= 0
                    ? 'bg-positive/10 text-positive'
                    : 'bg-negative/10 text-negative'
                }`}
              >
                <PiggyBank className="w-3.5 h-3.5" />
              </div>
            </div>
            {isDashboardLoading ? (
              <div className="h-6 w-24 bg-muted/20 animate-pulse rounded-lg" />
            ) : (
              <div
                className={`text-xl sm:text-2xl font-bold font-mono ${
                  (monthSummary?.netSavings ?? 0) >= 0 ? 'text-positive' : 'text-negative'
                }`}
              >
                {(monthSummary?.netSavings ?? 0) < 0 ? '-' : '+'}
                {formatINR(Math.abs(monthSummary?.netSavings ?? 0))}
              </div>
            )}
            <p className="text-[10px] text-muted">
              Income minus expenses for {formatMonthLabel(selectedMonth)}
            </p>
          </div>
        </section>

        {/* Bucket Cards Section */}
        <section className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                <h2 className="text-base font-bold text-foreground">
                  {viewScope === 'personal' ? 'My Buckets' : 'Household Buckets'}
                </h2>
                <span className="text-xs font-semibold text-muted bg-muted/10 px-2 py-0.5 rounded-full">
                  {filteredBuckets.length}
                </span>
              </div>

              {/* Bucket Owner Filter Pills */}
              <div className="inline-flex p-0.5 bg-muted/20 border border-border rounded-xl">
                <button
                  type="button"
                  onClick={() => setBucketFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    bucketFilter === 'all'
                      ? 'bg-card text-foreground shadow-xs font-bold'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  All ({buckets.length})
                </button>
                <button
                  type="button"
                  onClick={() => setBucketFilter('mine')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    bucketFilter === 'mine'
                      ? 'bg-card text-emerald-600 dark:text-emerald-400 shadow-xs font-bold'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  Mine ({myBuckets.length})
                </button>
                {partnerBuckets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setBucketFilter('partner')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      bucketFilter === 'partner'
                        ? 'bg-card text-blue-600 dark:text-blue-400 shadow-xs font-bold'
                        : 'text-muted hover:text-foreground'
                    }`}
                  >
                    {partnerName ? `${partnerName}'s` : "Partner's"} ({partnerBuckets.length})
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingBucket(null);
                  setBucketModalOpen(true);
                }}
                className="text-xs font-semibold text-primary hover:text-primary-hover flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Bucket
              </button>

              <Link
                href="/buckets"
                className="text-xs font-semibold text-muted hover:text-foreground flex items-center gap-1 transition-colors ml-2"
              >
                Manage all
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {isDashboardLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-44 rounded-3xl bg-card border border-border animate-pulse" />
              ))}
            </div>
          ) : filteredBuckets.length === 0 ? (
            <div className="p-8 rounded-3xl bg-card border border-dashed border-border text-center space-y-3">
              <p className="text-sm text-muted">
                {bucketFilter === 'mine'
                  ? 'No personal buckets found. Click "Add Bucket" to create one.'
                  : bucketFilter === 'partner'
                  ? `No shared buckets from ${partnerName || 'partner'} found yet.`
                  : 'No financial buckets configured yet in this household.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setEditingBucket(null);
                  setBucketModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 shadow-sm transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Create First Bucket
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredBuckets.slice(0, 6).map((bucket) => (
                <BucketCard
                  key={bucket.id}
                  bucket={bucket}
                  partnerName={partnerName}
                  onEdit={(b) => {
                    setEditingBucket(b);
                    setBucketModalOpen(true);
                  }}
                  onChangePrivacy={(b) => {
                    // Quick privacy toggle or modal
                    const next: Visibility =
                      b.visibility === 'shared'
                        ? 'balance_only'
                        : b.visibility === 'balance_only'
                        ? 'private'
                        : 'shared';
                    updateVisibilityMutation.mutate({ id: b.id, data: { visibility: next } });
                  }}
                  onArchive={(b) => {
                    if (confirm(`Archive bucket "${b.name}"?`)) {
                      archiveMutation.mutate(b.id);
                    }
                  }}
                  onAdjust={(b) => setAdjustModalBucket(b)}
                  onAddTransaction={(b) => {
                    setSelectedBucketForTx(b);
                    setTxModalMode('single');
                    setTxModalOpen(true);
                  }}
                  onTransfer={(b) => {
                    setSelectedBucketForTx(b);
                    setTxModalMode('transfer');
                    setTxModalOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {/* Visual Charts: 6-Month Income vs Expense Bar Chart & Category Donut */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 6-Month Trend Bar Chart */}
          <div className="lg:col-span-2 p-5 rounded-3xl bg-card border border-border shadow-sm flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  Income vs Expense (Last 6 Months)
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setShowDataTable(!showDataTable)}
                className="text-xs font-medium text-muted hover:text-foreground flex items-center gap-1 transition-colors"
                title="Toggle accessible data table view"
              >
                <Table className="w-3.5 h-3.5" />
                {showDataTable ? 'Show Chart' : 'Accessible Table'}
              </button>
            </div>

            {showDataTable ? (
              /* Accessible Table Fallback */
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="border-b border-border text-muted uppercase text-[10px]">
                    <tr>
                      <th className="py-2">Month</th>
                      <th className="py-2">Income</th>
                      <th className="py-2">Expense</th>
                      <th className="py-2">Net Savings</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {chartTrendData.map((row) => (
                      <tr key={row.rawMonth}>
                        <td className="py-2.5 font-medium">{row.rawMonth}</td>
                        <td className="py-2.5 text-positive font-semibold">
                          {formatINR(row.incomePaise)}
                        </td>
                        <td className="py-2.5 text-negative font-semibold">
                          {formatINR(row.expensePaise)}
                        </td>
                        <td className="py-2.5 font-bold">
                          {formatINR(row.incomePaise - row.expensePaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : isTrendLoading ? (
              <div className="h-64 rounded-2xl bg-muted/10 animate-pulse flex items-center justify-center text-xs text-muted">
                Loading trend analytics...
              </div>
            ) : chartTrendData.length === 0 ? (
              <div className="h-64 rounded-2xl border border-dashed border-border flex items-center justify-center text-xs text-muted">
                No cash flow activity recorded in the past 6 months.
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartTrendData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                    <XAxis
                      dataKey="month"
                      stroke="var(--muted)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="var(--muted)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) => `₹${val}`}
                    />
                    <RechartsTooltip
                      formatter={(val: unknown) => [formatINR(Math.round(Number(val ?? 0) * 100)), '']}
                      contentStyle={{
                        backgroundColor: 'var(--card)',
                        borderColor: 'var(--border)',
                        borderRadius: '0.75rem',
                        fontSize: '11px',
                        color: 'var(--foreground)',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                    <Bar
                      dataKey="incomeRupees"
                      name="Income"
                      fill="var(--positive)"
                      radius={[6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="expenseRupees"
                      name="Expense"
                      fill="var(--negative)"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="text-[11px] text-muted">
              Amounts in integer rupees (converted from paise). Internal transfers excluded.
            </p>
          </div>

          {/* Expense by Category Donut Chart */}
          <div className="p-5 rounded-3xl bg-card border border-border shadow-sm flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PieChartIcon className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  Expense by Category
                </h3>
              </div>
              <span className="text-[11px] text-muted font-medium">
                {formatMonthLabel(selectedMonth)}
              </span>
            </div>

            {isCategoriesLoading ? (
              <div className="h-64 rounded-2xl bg-muted/10 animate-pulse flex items-center justify-center text-xs text-muted">
                Loading categories...
              </div>
            ) : pieCategoryData.length === 0 ? (
              <div className="h-64 rounded-2xl border border-dashed border-border flex flex-col items-center justify-center text-center p-4">
                <p className="text-xs text-muted font-medium">
                  Zero expenses recorded for {formatMonthLabel(selectedMonth)}.
                </p>
                <p className="text-[11px] text-muted mt-1">
                  New expenses will automatically populate this breakdown.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="h-44 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieCategoryData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={75}
                        paddingAngle={3}
                      >
                        {pieCategoryData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(val: unknown) => [formatINR(Math.round(Number(val ?? 0) * 100)), 'Amount']}
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          borderColor: 'var(--border)',
                          borderRadius: '0.75rem',
                          fontSize: '11px',
                          color: 'var(--foreground)',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Category Legend List */}
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {pieCategoryData.map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between text-xs py-0.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate text-foreground font-medium">
                          {item.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-muted font-medium">{item.percentage}%</span>
                        <span className="font-semibold text-foreground">
                          {formatINR(item.amountPaise)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted">
              Top 5 categories + consolidated Other. Excludes voided expenses.
            </p>
          </div>
        </section>

        {/* Recent Transactions List (Top 5) */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" />
              <h2 className="text-base font-bold text-foreground">Recent Transactions</h2>
              <span className="text-xs font-semibold text-muted bg-muted/10 px-2 py-0.5 rounded-full">
                5 most recent
              </span>
            </div>

            <Link
              href="/transactions"
              className="text-xs font-semibold text-primary hover:text-primary-hover flex items-center gap-1 transition-colors"
            >
              View all transactions
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {isDashboardLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-2xl bg-card border border-border animate-pulse" />
              ))}
            </div>
          ) : recentTransactions.length === 0 ? (
            <div className="p-8 rounded-3xl bg-card border border-dashed border-border text-center space-y-2">
              <p className="text-xs text-muted">
                No recent transactions recorded in this household.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedBucketForTx(null);
                  setTxModalMode('single');
                  setTxModalOpen(true);
                }}
                className="text-xs font-semibold text-primary hover:underline"
              >
                + Record your first transaction
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {recentTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-3.5 rounded-2xl bg-card border border-border flex items-center justify-between gap-3 shadow-xs hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-xl shrink-0 ${
                        tx.type === 'income'
                          ? 'bg-positive/10 text-positive'
                          : tx.type === 'expense'
                          ? 'bg-negative/10 text-negative'
                          : 'bg-primary/10 text-primary'
                      }`}
                    >
                      {tx.type === 'income' ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : tx.type === 'expense' ? (
                        <ArrowUpRight className="w-4 h-4" />
                      ) : (
                        <ArrowRightLeft className="w-4 h-4" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {tx.purpose || tx.category || 'Transaction'}
                        </span>
                        {tx.isMasked && (
                          <span className="text-[10px] font-medium bg-muted/10 text-muted px-1.5 py-0.5 rounded">
                            Masked
                          </span>
                        )}
                        {tx.status === 'voided' && (
                          <span className="text-[10px] font-medium bg-negative/10 text-negative px-1.5 py-0.5 rounded">
                            Voided
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted flex items-center gap-2 mt-0.5">
                        <span>
                          {new Date(tx.date).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                        <span>•</span>
                        <span className="truncate">
                          {tx.type === 'transfer'
                            ? `${tx.fromBucketName || 'External'} → ${tx.toBucketName || 'External'}`
                            : tx.type === 'income'
                            ? `To: ${tx.toBucketName || 'External'}`
                            : `From: ${tx.fromBucketName || 'External'}`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div
                      className={`text-xs font-bold ${
                        tx.type === 'income'
                          ? 'text-positive'
                          : tx.type === 'expense'
                          ? 'text-negative'
                          : 'text-foreground'
                      }`}
                    >
                      {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                      {formatINR(tx.amount)}
                    </div>
                    <span className="text-[10px] text-muted capitalize">{tx.type}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Mobile Floating Action Button (FAB) */}
      <div className="sm:hidden fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => {
            setTxModalMode('split-income');
            setTxModalOpen(true);
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
            setSelectedBucketForTx(null);
            setTxModalMode('single');
            setTxModalOpen(true);
          }}
          className="w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center hover:bg-primary/90 transition-transform active:scale-95"
          title="Record Transaction"
          aria-label="Record Transaction"
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>

      {/* Transaction Modal */}
      <TransactionModal
        isOpen={txModalOpen}
        onClose={() => {
          setTxModalOpen(false);
          setSelectedBucketForTx(null);
        }}
        buckets={buckets}
        preselectedBucketId={selectedBucketForTx?.id}
        initialMode={txModalMode}
      />

      {/* Bucket Creation / Edit Modal */}
      <BucketFormModal
        isOpen={bucketModalOpen}
        onClose={() => {
          setBucketModalOpen(false);
          setEditingBucket(null);
        }}
        onSubmit={async (formData) => {
          if (editingBucket) {
            await updateMutation.mutateAsync({ id: editingBucket.id, data: formData });
          } else {
            await createMutation.mutateAsync(formData);
          }
          setBucketModalOpen(false);
          setEditingBucket(null);
        }}
        initialBucket={editingBucket}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />

      {/* Balance Adjustment Modal */}
      <AdjustmentModal
        isOpen={!!adjustModalBucket}
        onClose={() => setAdjustModalBucket(null)}
        bucket={adjustModalBucket}
      />
    </div>
  );
}
