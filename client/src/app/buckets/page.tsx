'use client';

/**
 * Client Component: /buckets
 * Rationale: Uses "use client" for client interactivity (TanStack Query,
 * filter tabs, modal forms, privacy confirmation dialog, and card menus).
 */

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  PublicBucket,
  Visibility,
  BucketType,
  CreateBucketInput,
} from '@vault/shared';
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
import {
  Plus,
  ArrowLeft,
  Filter,
  AlertTriangle,
  FolderOpen,
  Shield,
  Layers,
  Banknote,
  Landmark,
  Coins,
  ArrowUpDown,
} from 'lucide-react';

type FilterTab = 'all' | 'cash' | 'bank' | 'kuri' | 'loans';

const FILTER_TABS: Array<{ key: FilterTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'all', label: 'All Funds', icon: Layers },
  { key: 'cash', label: 'Cash', icon: Banknote },
  { key: 'bank', label: 'Banks', icon: Landmark },
  { key: 'kuri', label: 'Kuri', icon: Coins },
  { key: 'loans', label: 'Loans', icon: ArrowUpDown },
];

export default function BucketsPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [includeArchived, setIncludeArchived] = useState(false);

  // Form Modal State (Used for both Create and Edit)
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingBucket, setEditingBucket] = useState<PublicBucket | null>(null);

  // Privacy Dialog State
  const [privacyModalBucket, setPrivacyModalBucket] = useState<PublicBucket | null>(null);
  const [newVisibility, setNewVisibility] = useState<Visibility>('shared');

  // Adjustment Modal State
  const [adjustModalBucket, setAdjustModalBucket] = useState<PublicBucket | null>(null);

  // Error feedback
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Queries & Mutations
  const { data: authData } = useAuthMe();
  const { data, isLoading, isError, error, refetch } = useBuckets(includeArchived);

  const createMutation = useCreateBucket();
  const updateMutation = useUpdateBucket();
  const updateVisibilityMutation = useUpdateVisibility();
  const archiveMutation = useArchiveBucket();

  const partnerName = authData?.partner?.name || null;
  const buckets = data?.buckets || [];

  // Filter logic
  const filteredBuckets = useMemo(() => {
    if (activeTab === 'all') return buckets;
    if (activeTab === 'cash') return buckets.filter((b) => b.type === 'cash');
    if (activeTab === 'bank') return buckets.filter((b) => b.type === 'bank');
    if (activeTab === 'kuri') return buckets.filter((b) => b.type === 'kuri');
    if (activeTab === 'loans')
      return buckets.filter((b) => b.type === 'loan_given' || b.type === 'loan_taken');
    return buckets;
  }, [buckets, activeTab]);

  // Form Submit Handler (Handles both Create and Edit)
  const handleFormSubmit = async (formData: CreateBucketInput) => {
    setFeedbackError(null);
    try {
      if (editingBucket) {
        // Edit Mode: update name, description, and type (if allowed)
        await updateMutation.mutateAsync({
          id: editingBucket.id,
          data: {
            name: formData.name,
            description: formData.description,
            type: formData.type,
          },
        });
      } else {
        // Create Mode
        await createMutation.mutateAsync(formData);
      }
      setFormModalOpen(false);
      setEditingBucket(null);
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Operation failed');
    }
  };

  const handleOpenCreate = () => {
    setFeedbackError(null);
    setEditingBucket(null);
    setFormModalOpen(true);
  };

  const handleOpenEdit = (bucket: PublicBucket) => {
    setFeedbackError(null);
    setEditingBucket(bucket);
    setFormModalOpen(true);
  };

  const handleOpenPrivacy = (bucket: PublicBucket) => {
    setFeedbackError(null);
    setPrivacyModalBucket(bucket);
    setNewVisibility(bucket.visibility);
  };

  const handleConfirmPrivacy = async () => {
    if (!privacyModalBucket) return;
    setFeedbackError(null);
    try {
      await updateVisibilityMutation.mutateAsync({
        id: privacyModalBucket.id,
        data: { visibility: newVisibility },
      });
      setPrivacyModalBucket(null);
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Failed to update visibility');
    }
  };

  const handleArchive = async (bucket: PublicBucket) => {
    setFeedbackError(null);
    if (bucket.balance !== 0) {
      setFeedbackError(
        `Cannot archive "${bucket.name}". It still has an active balance. Please transfer or settle remaining funds to 0 first.`
      );
      return;
    }

    if (!confirm(`Are you sure you want to archive "${bucket.name}"? It will become read-only.`)) {
      return;
    }

    try {
      await archiveMutation.mutateAsync(bucket.id);
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Failed to archive bucket');
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top Application Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-muted hover:text-foreground transition-colors flex items-center gap-1.5 text-xs font-semibold"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Dashboard</span>
            </Link>
            <span className="text-border">/</span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground tracking-tight text-sm sm:text-base">
                Buckets & Funds
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold">
                {buckets.length} Total
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />

            <button
              type="button"
              onClick={handleOpenCreate}
              className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-background font-semibold text-xs tracking-wide transition-all shadow-sm shadow-primary/20 flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span className="hidden sm:inline">Add Bucket</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex-1 w-full space-y-6">
        {/* Banner Title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Financial Buckets
            </h1>
            <p className="text-xs sm:text-sm text-muted mt-1">
              Organize cash, bank accounts, community kuri funds, and receivables with strict ledger isolation.
            </p>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none self-start sm:self-auto">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="rounded border-border bg-card text-primary focus:ring-primary/40 cursor-pointer"
            />
            <span>Include archived accounts</span>
          </label>
        </div>

        {/* Global Feedback Banner */}
        {feedbackError && (
          <div className="p-3.5 rounded-xl bg-negative/10 border border-negative/20 text-negative text-xs flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{feedbackError}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackError(null)}
              className="text-negative hover:underline font-semibold text-[11px]"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Filter Segmented Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-card border border-border overflow-x-auto">
          {FILTER_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'bg-primary text-background shadow-xs'
                    : 'text-muted hover:text-foreground hover:bg-muted/10'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Loading Skeletons */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="rounded-2xl p-5 border border-border bg-card animate-pulse space-y-4"
              >
                <div className="flex justify-between items-center">
                  <div className="h-5 w-14 bg-muted/20 rounded-full" />
                  <div className="h-5 w-16 bg-muted/20 rounded-full" />
                </div>
                <div className="flex gap-3 items-center">
                  <div className="h-10 w-10 bg-muted/20 rounded-xl" />
                  <div className="space-y-1.5 flex-1">
                    <div className="h-4 bg-muted/20 rounded-md w-3/4" />
                    <div className="h-3 bg-muted/20 rounded-md w-1/2" />
                  </div>
                </div>
                <div className="h-8 bg-muted/20 rounded-md w-2/3 mt-4" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="p-8 rounded-2xl bg-negative/10 border border-negative/20 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-negative mx-auto" />
            <h2 className="text-sm font-bold text-foreground">Failed to load financial buckets</h2>
            <p className="text-xs text-muted max-w-sm mx-auto">
              {error instanceof Error ? error.message : 'A network error occurred while connecting.'}
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="px-4 py-2 rounded-xl bg-card border border-border text-foreground text-xs font-semibold hover:border-muted cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !isError && filteredBuckets.length === 0 && (
          <div className="py-20 text-center bg-card border border-border rounded-2xl p-8 space-y-4">
            <div className="inline-flex p-4 rounded-2xl bg-primary/10 text-primary mb-2">
              <FolderOpen className="w-8 h-8" />
            </div>
            <h2 className="text-base font-bold text-foreground">
              {activeTab === 'all'
                ? 'No financial buckets found'
                : `No buckets in "${activeTab}" category`}
            </h2>
            <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed">
              Create your first financial bucket (Cash, Bank, Kuri, or Loan) to start tracking joint family finances with strict integer paise precision.
            </p>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-background font-semibold text-xs tracking-wide transition-all shadow-sm shadow-primary/20 cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Add Your First Bucket</span>
            </button>
          </div>
        )}

        {/* Responsive Grid */}
        {!isLoading && !isError && filteredBuckets.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredBuckets.map((bucket) => (
              <BucketCard
                key={bucket.id}
                bucket={bucket}
                partnerName={partnerName}
                onEdit={handleOpenEdit}
                onChangePrivacy={handleOpenPrivacy}
                onArchive={handleArchive}
                onAdjust={(b) => setAdjustModalBucket(b)}
              />
            ))}
          </div>
        )}
      </main>

      {/* CREATE & EDIT BUCKET MODAL */}
      <BucketFormModal
        isOpen={formModalOpen}
        onClose={() => {
          setFormModalOpen(false);
          setEditingBucket(null);
        }}
        onSubmit={handleFormSubmit}
        initialBucket={editingBucket}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />

      {/* ADJUSTMENT MODAL */}
      <AdjustmentModal
        isOpen={!!adjustModalBucket}
        onClose={() => setAdjustModalBucket(null)}
        bucket={adjustModalBucket}
      />

      {/* PRIVACY MODAL CONFIRMATION DIALOG */}
      {privacyModalBucket && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="privacy-dialog-title"
        >
          <div className="bg-card border border-border text-foreground rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div>
              <h2 id="privacy-dialog-title" className="text-base font-bold text-foreground">
                Update Privacy Setting
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Modifying visibility level for <strong className="text-foreground">{privacyModalBucket.name}</strong>.
              </p>
            </div>

            {/* Radio choices */}
            <div className="space-y-2">
              {(['shared', 'balance_only', 'private'] as Visibility[]).map((level) => {
                const isSelected = newVisibility === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setNewVisibility(level)}
                    className={`w-full text-left p-3 rounded-xl border text-xs transition-all cursor-pointer ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-foreground shadow-xs font-semibold'
                        : 'border-border bg-background/50 hover:border-muted text-foreground'
                    }`}
                  >
                    <span className="capitalize block">{level.replace('_', ' ')}</span>
                  </button>
                );
              })}
            </div>

            {/* Impact explanation on ledger */}
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-start gap-2.5 leading-relaxed">
              <Shield className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
              <div>
                <strong className="block font-semibold mb-0.5">Historical Ledger Effect:</strong>
                {newVisibility === 'shared' && (
                  <span>
                    Making this bucket <strong>Shared</strong> will grant your partner visibility over the balance and all past & future ledger transactions.
                  </span>
                )}
                {newVisibility === 'balance_only' && (
                  <span>
                    Making this bucket <strong>Balance Only</strong> will reveal the current balance to your partner, but hide all past & future transaction details.
                  </span>
                )}
                {newVisibility === 'private' && (
                  <span>
                    Making this bucket <strong>Private</strong> will completely hide the account and its transaction history from your partner.
                  </span>
                )}
              </div>
            </div>

            {/* Dialog Actions */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setPrivacyModalBucket(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-muted hover:text-foreground hover:bg-muted/10 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPrivacy}
                disabled={updateVisibilityMutation.isPending}
                className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-background font-semibold text-xs tracking-wide transition-all shadow-sm shadow-primary/20 disabled:opacity-50 cursor-pointer"
              >
                {updateVisibilityMutation.isPending ? 'Updating...' : 'Confirm Privacy Change'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
