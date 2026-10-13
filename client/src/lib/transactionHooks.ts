import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PublicTransaction,
  PublicTransactionGroup,
  TransactionInput,
  SplitIncomeInput,
  SplitTransferInput,
  AdjustmentInput,
} from '@vault/shared';

/**
 * Fetch paginated list of transactions
 */
export function useTransactions(page = 1, limit = 50) {
  return useQuery<{
    transactions: PublicTransaction[];
    total: number;
    page: number;
    limit: number;
  }>({
    queryKey: ['transactions', { page, limit }],
    queryFn: async () => {
      const res = await fetch(`/api/transactions?page=${page}&limit=${limit}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to fetch transactions');
      }
      return res.json();
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['buckets'] });
      queryClient.invalidateQueries({ queryKey: ['bucketSummary'] });
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['buckets'] });
      queryClient.invalidateQueries({ queryKey: ['bucketSummary'] });
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['buckets'] });
      queryClient.invalidateQueries({ queryKey: ['bucketSummary'] });
    },
  });
}

/**
 * Balance Adjustment creation (owner-only)
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['buckets'] });
      queryClient.invalidateQueries({ queryKey: ['bucketSummary'] });
    },
  });
}

/**
 * Void a single transaction
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['buckets'] });
      queryClient.invalidateQueries({ queryKey: ['bucketSummary'] });
    },
  });
}

/**
 * Void an entire transaction group
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['transactionGroup'] });
      queryClient.invalidateQueries({ queryKey: ['buckets'] });
      queryClient.invalidateQueries({ queryKey: ['bucketSummary'] });
    },
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
