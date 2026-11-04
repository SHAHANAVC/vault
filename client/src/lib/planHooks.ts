import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PublicPlan,
  CreatePlanInput,
  UpdatePlanInput,
  PayPlanInput,
  KuriPayoutInput,
  RecordBonusInput,
  RedeemInput,
  DashboardAlertsResponse,
  PublicTransaction,
} from '@vault/shared';

function invalidatePlanQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['plans'] });
  queryClient.invalidateQueries({ queryKey: ['plan'] });
  queryClient.invalidateQueries({ queryKey: ['planAlerts'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  queryClient.invalidateQueries({ queryKey: ['buckets'] });
  queryClient.invalidateQueries({ queryKey: ['bucketSummary'] });
  queryClient.invalidateQueries({ queryKey: ['transactions'] });
}

/**
 * Fetch plans list with optional status filter
 */
export function usePlans(status?: 'active' | 'completed' | 'cancelled') {
  return useQuery<{ plans: PublicPlan[]; activeCount: number; completedCount: number }>({
    queryKey: ['plans', { status }],
    queryFn: async () => {
      const url = status ? `/api/plans?status=${status}` : '/api/plans';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to load plans');
      }
      return res.json();
    },
  });
}

/**
 * Fetch a single plan with its payment transaction history
 */
export function usePlan(id: string) {
  return useQuery<{
    plan: PublicPlan;
    payments: PublicTransaction[];
  }>({
    queryKey: ['plan', id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/plans/${id}`, { credentials: 'include' });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to load plan details');
      }
      return res.json();
    },
  });
}

/**
 * Fetch live alerts and shortfall summaries
 */
export function usePlanAlerts() {
  return useQuery<DashboardAlertsResponse>({
    queryKey: ['planAlerts'],
    queryFn: async () => {
      const res = await fetch('/api/plans/alerts', { credentials: 'include' });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to load plan alerts');
      }
      return res.json();
    },
    refetchInterval: 30000, // Refresh alerts every 30s
  });
}

/**
 * Create a new EMI or Kuri plan
 */
export function useCreatePlan() {
  const queryClient = useQueryClient();
  return useMutation<PublicPlan, Error, CreatePlanInput>({
    mutationFn: async (input) => {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to create plan');
      }
      return res.json();
    },
    onSuccess: () => {
      invalidatePlanQueries(queryClient);
    },
  });
}

/**
 * Update plan metadata
 */
export function useUpdatePlan() {
  const queryClient = useQueryClient();
  return useMutation<PublicPlan, Error, { id: string; data: UpdatePlanInput }>({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/plans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to update plan');
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['plan', variables.id] });
      invalidatePlanQueries(queryClient);
    },
  });
}

/**
 * Cancel an active plan
 */
export function useCancelPlan() {
  const queryClient = useQueryClient();
  return useMutation<PublicPlan, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/plans/${id}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to cancel plan');
      }
      return res.json();
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['plan', id] });
      invalidatePlanQueries(queryClient);
    },
  });
}

/**
 * Record an installment payment (Expense for EMI, Transfer for Kuri)
 */
export function usePayPlan() {
  const queryClient = useQueryClient();
  return useMutation<
    { plan: PublicPlan; transaction: PublicTransaction },
    Error,
    { id: string; data?: Partial<PayPlanInput> }
  >({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/plans/${id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data || {}),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to record plan payment');
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['plan', variables.id] });
      invalidatePlanQueries(queryClient);
    },
  });
}

/**
 * Record Kuri payout (Transfer from Kuri bucket back to bank/cash bucket)
 */
export function usePayoutKuri() {
  const queryClient = useQueryClient();
  return useMutation<
    { plan: PublicPlan; transaction: PublicTransaction },
    Error,
    { id: string; data: Partial<KuriPayoutInput> }
  >({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/plans/${id}/payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to record Kuri payout');
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['plan', variables.id] });
      invalidatePlanQueries(queryClient);
    },
  });
}

/**
 * Record Gold Scheme bonus (Income in gold_scheme bucket)
 */
export function useRecordBonus() {
  const queryClient = useQueryClient();
  return useMutation<
    { plan: PublicPlan; transaction: PublicTransaction },
    Error,
    { id: string; data?: Partial<RecordBonusInput> }
  >({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/plans/${id}/bonus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data || {}),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to record gold scheme bonus');
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['plan', variables.id] });
      invalidatePlanQueries(queryClient);
    },
  });
}

/**
 * Redeem Gold Scheme (Jewellery expense or Cash refund transfer)
 */
export function useRedeemPlan() {
  const queryClient = useQueryClient();
  return useMutation<
    { plan: PublicPlan; transaction: PublicTransaction },
    Error,
    { id: string; data: RedeemInput }
  >({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/plans/${id}/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to redeem gold scheme');
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['plan', variables.id] });
      invalidatePlanQueries(queryClient);
    },
  });
}

/**
 * Dismiss an alert for today
 */
export function useDismissAlert() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; dateString: string }, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/plans/${id}/dismiss`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to dismiss alert');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planAlerts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
