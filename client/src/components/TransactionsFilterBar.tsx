'use client';

/**
 * Client Component: TransactionsFilterBar
 * 
 * Server vs Client Choice:
 * "use client" is strictly required because this component:
 * 1. Reads dynamic URL query parameters via Next.js `useSearchParams()`
 * 2. Manages interactive form controls, debounced search inputs, and mobile drawer toggles
 * 3. Imperatively updates URL search parameters via `useRouter()` without full page reloads
 * 
 * Must be wrapped in a React `<Suspense>` boundary by parent Server/Client pages
 * to prevent de-optimizing the route during Next.js streaming SSR.
 */

import React, { useState, useEffect, useTransition, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  TransactionType,
  TRANSACTION_CATEGORIES,
  rupeesToPaise,
  paiseToRupees,
} from '@vault/shared';
import { useBuckets } from '../lib/bucketHooks';
import {
  Search,
  Filter,
  X,
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  SlidersHorizontal,
  User,
} from 'lucide-react';

interface TransactionsFilterBarProps {
  onClear?: () => void;
}

export function TransactionsFilterBar({ onClear }: TransactionsFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const { data: bucketsData } = useBuckets();
  const buckets = bucketsData?.buckets || [];

  // Collapsible state for mobile
  const [mobileExpanded, setMobileExpanded] = useState(false);

  // Local state for debounced search text
  const currentSearch = searchParams.get('search') || '';
  const [searchValue, setSearchValue] = useState(currentSearch);
  const [prevSearchParam, setPrevSearchParam] = useState(currentSearch);

  // Sync internal search input with URL params when URL changes
  if (currentSearch !== prevSearchParam) {
    setPrevSearchParam(currentSearch);
    setSearchValue(currentSearch);
  }

  // Helper to update URL searchParams cleanly
  const updateQuery = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '' || value === undefined) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }

      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [searchParams, pathname, router]
  );

  // Debounce search update (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = searchValue.trim();
      const current = searchParams.get('search') || '';
      if (trimmed !== current) {
        updateQuery({ search: trimmed || null, page: '1' });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchValue, searchParams, updateQuery]);

  // Quick Date Range handlers
  const handleQuickDate = (preset: 'this_month' | 'last_month' | 'last_7_days') => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');

    if (preset === 'this_month') {
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const from = `${year}-${pad(month)}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const to = `${year}-${pad(month)}-${pad(lastDay)}`;
      updateQuery({ fromDate: from, toDate: to, page: '1' });
    } else if (preset === 'last_month') {
      let year = now.getFullYear();
      let month = now.getMonth();
      if (month === 0) {
        month = 12;
        year -= 1;
      }
      const from = `${year}-${pad(month)}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const to = `${year}-${pad(month)}-${pad(lastDay)}`;
      updateQuery({ fromDate: from, toDate: to, page: '1' });
    } else if (preset === 'last_7_days') {
      const to = now.toISOString().split('T')[0]!;
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const from = sevenDaysAgo.toISOString().split('T')[0]!;
      updateQuery({ fromDate: from, toDate: to, page: '1' });
    }
  };

  // Reset all filters
  const handleResetFilters = () => {
    setSearchValue('');
    startTransition(() => {
      router.push(pathname);
    });
    if (onClear) onClear();
  };

  // Active filters count
  const activeFiltersCount = [
    searchParams.get('search'),
    searchParams.get('bucketId'),
    searchParams.get('type'),
    searchParams.get('category'),
    searchParams.get('createdBy'),
    searchParams.get('fromDate'),
    searchParams.get('toDate'),
    searchParams.get('minAmount'),
    searchParams.get('maxAmount'),
    searchParams.get('includeVoided') === 'true' ? 'voided' : null,
  ].filter(Boolean).length;

  return (
    <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
      {/* Top Bar: Search Input, Quick Filters Toggle & Reset */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search input with debounced state */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search purpose, category, reason..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-background border border-border rounded-xl text-xs text-foreground placeholder:text-muted focus:outline-hidden focus:ring-2 focus:ring-primary/20"
          />
          {searchValue && (
            <button
              onClick={() => {
                setSearchValue('');
                updateQuery({ search: null, page: '1' });
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground rounded-md"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Mobile Collapse Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileExpanded((prev) => !prev)}
            className="sm:hidden flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-background text-xs font-medium text-foreground hover:bg-muted/10 transition-colors"
          >
            <Filter className="w-3.5 h-3.5 text-primary" />
            <span>Filters</span>
            {activeFiltersCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-primary text-background text-[10px] font-bold flex items-center justify-center">
                {activeFiltersCount}
              </span>
            )}
            {mobileExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {/* Clear Filters Button */}
          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-rose-500 hover:bg-rose-500/10 border border-rose-500/20 transition-all cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Clear ({activeFiltersCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Matrix (Always visible on desktop, toggleable on mobile) */}
      <div className={`space-y-4 pt-1 border-t border-border/60 ${mobileExpanded ? 'block' : 'hidden sm:block'}`}>
        {/* Row 1: Dropdown Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {/* Transaction Type */}
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">
              Type
            </label>
            <select
              value={searchParams.get('type') || ''}
              onChange={(e) => updateQuery({ type: e.target.value || null, page: '1' })}
              className="w-full px-3 py-2 bg-background border border-border rounded-xl text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All Types</option>
              <option value="income">Income (Inflow)</option>
              <option value="expense">Expense (Outflow)</option>
              <option value="transfer">Transfer (Internal)</option>
              <option value="adjustment">Balance Adjustment</option>
            </select>
          </div>

          {/* Bucket Picker */}
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">
              Bucket
            </label>
            <select
              value={searchParams.get('bucketId') || ''}
              onChange={(e) => updateQuery({ bucketId: e.target.value || null, page: '1' })}
              className="w-full px-3 py-2 bg-background border border-border rounded-xl text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All Buckets</option>
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Category Picker */}
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">
              Category
            </label>
            <select
              value={searchParams.get('category') || ''}
              onChange={(e) => updateQuery({ category: e.target.value || null, page: '1' })}
              className="w-full px-3 py-2 bg-background border border-border rounded-xl text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All Categories</option>
              {TRANSACTION_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Member Picker */}
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">
              Created By
            </label>
            <select
              value={searchParams.get('createdBy') || ''}
              onChange={(e) => updateQuery({ createdBy: e.target.value || null, page: '1' })}
              className="w-full px-3 py-2 bg-background border border-border rounded-xl text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All Household Members</option>
              <option value="me">Recorded by Me</option>
              <option value="partner">Recorded by Partner</option>
            </select>
          </div>
        </div>

        {/* Row 2: Date Range & Quick Chips + Amount Range */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* Date Range with Quick Chips */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                Date Range
              </label>
              {/* Quick Chips */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleQuickDate('this_month')}
                  className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-muted/10 hover:bg-muted/20 text-foreground transition-colors"
                >
                  This Month
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickDate('last_month')}
                  className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-muted/10 hover:bg-muted/20 text-foreground transition-colors"
                >
                  Last Month
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickDate('last_7_days')}
                  className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-muted/10 hover:bg-muted/20 text-foreground transition-colors"
                >
                  Last 7 Days
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={searchParams.get('fromDate') || ''}
                onChange={(e) => updateQuery({ fromDate: e.target.value || null, page: '1' })}
                className="w-full px-2.5 py-1.5 bg-background border border-border rounded-xl text-xs text-foreground"
              />
              <input
                type="date"
                value={searchParams.get('toDate') || ''}
                onChange={(e) => updateQuery({ toDate: e.target.value || null, page: '1' })}
                className="w-full px-2.5 py-1.5 bg-background border border-border rounded-xl text-xs text-foreground"
              />
            </div>
          </div>

          {/* Amount Range & Show Voided Toggle */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                Amount Range (₹)
              </label>
              {/* Show Voided Checkbox */}
              <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer hover:text-foreground">
                <input
                  type="checkbox"
                  checked={searchParams.get('includeVoided') === 'true'}
                  onChange={(e) =>
                    updateQuery({
                      includeVoided: e.target.checked ? 'true' : null,
                      page: '1',
                    })
                  }
                  className="rounded border-border text-primary focus:ring-primary/20"
                />
                <span className="text-[11px] font-medium">Show voided</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted font-semibold">
                  ₹
                </span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Min"
                  value={
                    searchParams.get('minAmount')
                      ? paiseToRupees(Number(searchParams.get('minAmount')))
                      : ''
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    const paise = val ? rupeesToPaise(Number(val)) : null;
                    updateQuery({ minAmount: paise !== null ? String(paise) : null, page: '1' });
                  }}
                  className="w-full pl-6 pr-2 py-1.5 bg-background border border-border rounded-xl text-xs text-foreground placeholder:text-muted"
                />
              </div>

              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted font-semibold">
                  ₹
                </span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Max"
                  value={
                    searchParams.get('maxAmount')
                      ? paiseToRupees(Number(searchParams.get('maxAmount')))
                      : ''
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    const paise = val ? rupeesToPaise(Number(val)) : null;
                    updateQuery({ maxAmount: paise !== null ? String(paise) : null, page: '1' });
                  }}
                  className="w-full pl-6 pr-2 py-1.5 bg-background border border-border rounded-xl text-xs text-foreground placeholder:text-muted"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
