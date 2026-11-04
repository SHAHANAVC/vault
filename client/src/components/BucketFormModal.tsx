'use client';

/**
 * Client Component: BucketFormModal
 * Reusable modal for both creating and editing financial buckets.
 * Uses React Hook Form + @vault/shared schemas and semantic CSS variables.
 */

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createBucketSchema,
  CreateBucketInput,
  PublicBucket,
  BucketType,
  Visibility,
} from '@vault/shared';
import {
  Banknote,
  Landmark,
  Coins,
  Sparkles,
  ArrowUpRight,
  ArrowDownLeft,
  Users,
  Eye,
  Lock,
  X,
  AlertCircle,
} from 'lucide-react';

interface BucketFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateBucketInput) => Promise<void>;
  initialBucket?: PublicBucket | null;
  isLoading?: boolean;
}

const BUCKET_TYPES: Array<{
  type: BucketType;
  label: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { type: 'cash', label: 'Cash', sub: 'Physical cash & wallet', icon: Banknote },
  { type: 'bank', label: 'Bank Account', sub: 'Savings & checking', icon: Landmark },
  { type: 'kuri', label: 'Kuri', sub: 'Rotating savings', icon: Coins },
  { type: 'gold_scheme', label: 'Gold Scheme', sub: 'Jewellery gold savings scheme', icon: Sparkles },
  { type: 'loan_given', label: 'Loan Given', sub: 'Asset / receivable', icon: ArrowUpRight },
  { type: 'loan_taken', label: 'Loan Taken', sub: 'Debt / payable', icon: ArrowDownLeft },
];

const VISIBILITY_OPTIONS: Array<{
  level: Visibility;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
}> = [
  {
    level: 'shared',
    label: 'Shared',
    description: 'Partner has full visibility over balance and all transactions.',
    icon: Users,
    accentColor: 'text-blue-500',
  },
  {
    level: 'balance_only',
    label: 'Balance Only',
    description: 'Partner sees name and balance only. Zero transactions or notes.',
    icon: Eye,
    accentColor: 'text-amber-500',
  },
  {
    level: 'private',
    label: 'Private',
    description: 'Completely invisible to your partner. Never leaked.',
    icon: Lock,
    accentColor: 'text-purple-500',
  },
];

export function BucketFormModal({
  isOpen,
  onClose,
  onSubmit,
  initialBucket,
  isLoading = false,
}: BucketFormModalProps) {
  const isEditMode = Boolean(initialBucket);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<CreateBucketInput>({
    resolver: zodResolver(createBucketSchema),
    defaultValues: {
      name: '',
      type: 'cash', // Default to cash for intuitive creation
      visibility: 'shared',
      description: '',
    },
  });

  const selectedType = watch('type');
  const selectedVisibility = watch('visibility');

  useEffect(() => {
    if (initialBucket) {
      reset({
        name: initialBucket.name,
        type: initialBucket.type,
        visibility: initialBucket.visibility,
        description: initialBucket.description || '',
      });
    } else {
      reset({
        name: '',
        type: 'cash',
        visibility: 'shared',
        description: '',
      });
    }
  }, [initialBucket, reset, isOpen]);

  if (!isOpen) return null;

  const canChangeType = !isEditMode || initialBucket?.balance === 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="bg-card border border-border text-foreground rounded-2xl w-full max-w-xl p-6 shadow-2xl my-8 transition-all">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div>
            <h2 id="modal-title" className="text-lg font-bold text-foreground">
              {isEditMode ? 'Edit Bucket' : 'Create Financial Bucket'}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              {isEditMode
                ? 'Update bucket properties and classification'
                : 'Configure account type and privacy parameters'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-muted/10 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-5">
          {/* Bucket Name */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
              Bucket Name *
            </label>
            <input
              type="text"
              placeholder="e.g. Cash in Wallet, SBI Checking, Kuri Pool"
              {...register('name')}
              className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground placeholder:text-muted/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
            />
            {errors.name && (
              <p className="text-negative text-xs mt-1.5 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {errors.name.message}
              </p>
            )}
          </div>

          {/* Type Picker Cards */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
                Account Type *
              </label>
              {!canChangeType && (
                <span className="text-[11px] text-muted italic">
                  Type locked (balance ≠ 0)
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {BUCKET_TYPES.map((bt) => {
                const Icon = bt.icon;
                const isSelected = selectedType === bt.type;
                const isDisabled = !canChangeType && !isSelected;

                return (
                  <button
                    key={bt.type}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => setValue('type', bt.type, { shouldValidate: true })}
                    className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-primary shadow-xs'
                        : 'border-border bg-background/50 hover:border-muted text-foreground'
                    } ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    aria-pressed={isSelected}
                  >
                    <Icon className="w-4 h-4 mb-2 text-current" />
                    <div>
                      <span className="text-xs font-semibold block leading-tight">
                        {bt.label}
                      </span>
                      <span className="text-[10px] text-muted block mt-0.5 leading-tight">
                        {bt.sub}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {errors.type && (
              <p className="text-negative text-xs mt-1.5">{errors.type.message}</p>
            )}
          </div>

          {/* Visibility Selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
              Partner Visibility Level *
            </label>
            <div className="space-y-2">
              {VISIBILITY_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = selectedVisibility === opt.level;

                return (
                  <button
                    key={opt.level}
                    type="button"
                    onClick={() => setValue('visibility', opt.level, { shouldValidate: true })}
                    className={`w-full p-3 rounded-xl border text-left transition-all flex items-start gap-3 cursor-pointer ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-foreground shadow-xs'
                        : 'border-border bg-background/50 hover:border-muted text-foreground'
                    }`}
                    aria-pressed={isSelected}
                  >
                    <div className={`p-2 rounded-lg bg-card border border-border shrink-0 ${opt.accentColor}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground">
                          {opt.label}
                        </span>
                        {isSelected && (
                          <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted mt-0.5 leading-relaxed">
                        {opt.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
            {errors.visibility && (
              <p className="text-negative text-xs mt-1.5">{errors.visibility.message}</p>
            )}
          </div>

          {/* Description / Notes */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
              Description / Notes (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Account number, physical location, purpose"
              {...register('description')}
              className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-foreground placeholder:text-muted/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
            />
          </div>

          {/* Opening Balance Field (Disabled until Phase 4B) */}
          {!isEditMode && (
            <div className="p-3.5 rounded-xl bg-background/80 border border-border/80">
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1">
                Opening Balance
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  disabled
                  value="₹0.00"
                  className="w-36 px-3 py-1.5 rounded-lg bg-card border border-border text-muted font-mono text-sm cursor-not-allowed"
                />
                <span className="text-xs text-muted flex-1 leading-snug">
                  Opening balances are initialized as 0. An initial deposit transaction will be recorded via the ledger in Phase 4B.
                </span>
              </div>
            </div>
          )}

          {/* Form Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl text-xs font-medium text-muted hover:text-foreground hover:bg-muted/10 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-background font-semibold text-xs tracking-wide transition-all shadow-md shadow-primary/20 disabled:opacity-50 cursor-pointer"
            >
              {isLoading
                ? isEditMode
                  ? 'Saving Changes...'
                  : 'Creating Bucket...'
                : isEditMode
                ? 'Save Changes'
                : 'Create Bucket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
