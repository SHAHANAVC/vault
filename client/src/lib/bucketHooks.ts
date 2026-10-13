import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PublicBucket,
  BucketSummary,
  CreateBucketInput,
  UpdateBucketInput,
  UpdateVisibilityInput,
  PublicUser,
} from '@vault/shared';

/**
 * Fetch current user & partner profile
 */
export function useAuthMe() {
  return useQuery<{
    user: PublicUser;
    partner: { id: string; name: string; email: string } | null;
  }>({
    queryKey: ['authMe'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) {
        throw new Error('Not authenticated');
      }
      return res.json();
    },
  });
}

/**
 * Fetch visible buckets
 */
export function useBuckets(includeArchived = false) {
  return useQuery<{ buckets: PublicBucket[] }>({
    queryKey: ['buckets', { includeArchived }],
    queryFn: async () => {
      const res = await fetch(`/api/buckets?includeArchived=${includeArchived}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to load buckets');
      }
      return res.json();
    },
  });
}

/**
 * Fetch financial summary (householdTotal and myTotal)
 */
export function useBucketSummary() {
  return useQuery<BucketSummary>({
    queryKey: ['bucketSummary'],
    queryFn: async () => {
      const res = await fetch('/api/buckets/summary', {
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to load summary');
      }
      return res.json();
    },
  });
}

/**
 * Create a new bucket
 */
export function useCreateBucket() {
  const queryClient = useQueryClient();
  return useMutation<{ bucket: PublicBucket }, Error, CreateBucketInput>({
    mutationFn: async (data: CreateBucketInput) => {
      const res = await fetch('/api/buckets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to create bucket');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buckets'] });
      queryClient.invalidateQueries({ queryKey: ['bucketSummary'] });
    },
  });
}

/**
 * Update bucket metadata (name, description)
 */
export function useUpdateBucket() {
  const queryClient = useQueryClient();
  return useMutation<
    { bucket: PublicBucket },
    Error,
    { id: string; data: UpdateBucketInput }
  >({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/buckets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to update bucket');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buckets'] });
    },
  });
}

/**
 * Update bucket visibility (owner only)
 */
export function useUpdateVisibility() {
  const queryClient = useQueryClient();
  return useMutation<
    { bucket: PublicBucket },
    Error,
    { id: string; data: UpdateVisibilityInput }
  >({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/buckets/${id}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to update visibility');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buckets'] });
      queryClient.invalidateQueries({ queryKey: ['bucketSummary'] });
    },
  });
}

/**
 * Archive a bucket (requires 0 balance)
 */
export function useArchiveBucket() {
  const queryClient = useQueryClient();
  return useMutation<{ bucket: PublicBucket }, Error, string>({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/buckets/${id}/archive`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to archive bucket');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buckets'] });
      queryClient.invalidateQueries({ queryKey: ['bucketSummary'] });
    },
  });
}
