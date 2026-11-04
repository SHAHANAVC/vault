import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import {
  PublicTransaction,
  PublicTransactionGroup,
  TransactionInput,
  SplitIncomeInput,
  SplitTransferInput,
  AdjustmentInput,
  TransactionQueryInput,
  MonthSummaryResponse,
  CategoryBreakdownResponse,
  TrendResponse,
  DashboardResponse,
  PaginatedTransactionsResponse,
} from '@vault/shared';

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['transactions'] });
  queryClient.invalidateQueries({ queryKey: ['transactionGroup'] });
  queryClient.invalidateQueries({ queryKey: ['buckets'] });
  queryClient.invalidateQueries({ queryKey: ['bucketSummary'] });
  queryClient.invalidateQueries({ queryKey: ['monthSummary'] });
  queryClient.invalidateQueries({ queryKey: ['categoryBreakdown'] });
  queryClient.invalidateQueries({ queryKey: ['trendReport'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
}

/**
 * Fetch paginated list of transactions with combinable filters and search
 */
export function useTransactions(
  queryOrPage: TransactionQueryInput | number = 1,
  limit = 20
) {
  const params: TransactionQueryInput =
    typeof queryOrPage === 'number' ? { page: queryOrPage, limit } : queryOrPage;

  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.bucketId) searchParams.set('bucketId', params.bucketId);
  if (params.type) searchParams.set('type', params.type);
  if (params.category) searchParams.set('category', params.category);
  if (params.createdBy) searchParams.set('createdBy', params.createdBy);
  if (params.fromDate) searchParams.set('fromDate', params.fromDate);
  if (params.toDate) searchParams.set('toDate', params.toDate);
  if (params.minAmount !== undefined) searchParams.set('minAmount', String(params.minAmount));
  if (params.maxAmount !== undefined) searchParams.set('maxAmount', String(params.maxAmount));
  if (params.search) searchParams.set('search', params.search);
  if (params.includeVoided) searchParams.set('includeVoided', 'true');
  if (params.sort) searchParams.set('sort', params.sort);

  return useQuery<PaginatedTransactionsResponse>({
    queryKey: ['transactions', params],
    queryFn: async () => {
      const res = await fetch(`/api/transactions?${searchParams.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to fetch transactions');
      }
      return res.json();
    },
    placeholderData: keepPreviousData,
  });
}

/**
 * Fetch a split transaction group with per-line privacy details
 */
export function useTransactionGroup(groupId?: string) {
  return useQuery<{ group: PublicTransactionGroup }>({
    queryKey: ['transactionGroup', groupId],
    queryFn: async () => {
      if (!groupId) throw new Error('GroupId is required');
      const res = await fetch(`/api/transactions/groups/${groupId}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to fetch transaction group');
      }
      return res.json();
    },
    enabled: !!groupId,
  });
}

/**
 * Single transaction creation (income, expense, transfer)
 */
export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation<{ transaction: PublicTransaction }, Error, TransactionInput>({
    mutationFn: async (data: TransactionInput) => {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to create transaction');
      }
      return res.json();
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

/**
 * Multi-allocation Split Income creation
 */
export function useCreateSplitIncome() {
  const queryClient = useQueryClient();
  return useMutation<{ group: PublicTransactionGroup }, Error, SplitIncomeInput>({
    mutationFn: async (data: SplitIncomeInput) => {
      const res = await fetch('/api/transactions/split-income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to create split income');
      }
      return res.json();
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

/**
 * Multi-destination Split Transfer creation
 */
export function useCreateSplitTransfer() {
  const queryClient = useQueryClient();
  return useMutation<{ group: PublicTransactionGroup }, Error, SplitTransferInput>({
    mutationFn: async (data: SplitTransferInput) => {
      const res = await fetch('/api/transactions/split-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to create split transfer');
      }
      return res.json();
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

/**
 * Balance Adjustment creation
 */
export function useCreateAdjustment() {
  const queryClient = useQueryClient();
  return useMutation<{ transaction: PublicTransaction }, Error, AdjustmentInput>({
    mutationFn: async (data: AdjustmentInput) => {
      const res = await fetch('/api/transactions/adjustment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to create balance adjustment');
      }
      return res.json();
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

/**
 * Void single transaction
 */
export function useVoidTransaction() {
  const queryClient = useQueryClient();
  return useMutation<{ transaction: PublicTransaction }, Error, string>({
    mutationFn: async (transactionId: string) => {
      const res = await fetch(`/api/transactions/${transactionId}/void`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to void transaction');
      }
      return res.json();
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

/**
 * Void entire split group
 */
export function useVoidGroup() {
  const queryClient = useQueryClient();
  return useMutation<{ group: PublicTransactionGroup }, Error, string>({
    mutationFn: async (groupId: string) => {
      const res = await fetch(`/api/transactions/groups/${groupId}/void`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to void transaction group');
      }
      return res.json();
    },
    onSuccess: () => invalidateAll(queryClient),
  });
}

/**
 * Mathematical Ledger Reconcile Query
 */
export function useReconcile() {
  return useQuery<{
    matches: boolean;
    totalBuckets: number;
    mismatches: Array<{
      bucketId: string;
      bucketName: string;
      storedBalance: number;
      recomputedBalance: number;
      discrepancyPaise: number;
    }>;
  }>({
    queryKey: ['reconcile'],
    queryFn: async () => {
      const res = await fetch('/api/transactions/reconcile', {
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to run ledger reconcile');
      }
      return res.json();
    },
  });
}

/**
 * Monthly income, expense, and net savings summary
 */
export function useMonthSummary(month?: string) {
  return useQuery<MonthSummaryResponse>({
    queryKey: ['monthSummary', month],
    queryFn: async () => {
      const url = month ? `/api/reports/summary?month=${encodeURIComponent(month)}` : '/api/reports/summary';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to fetch monthly summary');
      }
      return res.json();
    },
  });
}

/**
 * Expense breakdown by category for the month
 */
export function useCategoryBreakdown(month?: string) {
  return useQuery<CategoryBreakdownResponse>({
    queryKey: ['categoryBreakdown', month],
    queryFn: async () => {
      const url = month ? `/api/reports/categories?month=${encodeURIComponent(month)}` : '/api/reports/categories';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to fetch category breakdown');
      }
      return res.json();
    },
  });
}

/**
 * 6-Month Income vs Expense historical trend
 */
export function useTrendReport(months = 6) {
  return useQuery<TrendResponse>({
    queryKey: ['trendReport', months],
    queryFn: async () => {
      const res = await fetch(`/api/reports/trend?months=${months}`, { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to fetch trend report');
      }
      return res.json();
    },
  });
}

/**
 * Consolidated Household Dashboard query
 */
export function useDashboard(month?: string) {
  return useQuery<DashboardResponse>({
    queryKey: ['dashboard', month],
    queryFn: async () => {
      const url = month ? `/api/dashboard?month=${encodeURIComponent(month)}` : '/api/dashboard';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to fetch dashboard data');
      }
      return res.json();
    },
  });
}
