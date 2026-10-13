'use client';

/**
 * Client Component: BucketCard
 * Displays individual bucket with type icon, distinct visibility badge,
 * neutral "Mine" vs partner badge, formatted tabular balance, and three-dots menu.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  formatINR,
  PublicBucket,
  BucketType,
  Visibility,
} from '@vault/shared';
import {
  Banknote,
  Landmark,
  Coins,
  ArrowUpRight,
  ArrowDownLeft,
  Users,
  Eye,
  Lock,
  MoreVertical,
  Edit2,
  Shield,
  Archive,
  SlidersHorizontal,
} from 'lucide-react';

interface BucketCardProps {
  bucket: PublicBucket;
  partnerName?: string | null;
  onEdit: (bucket: PublicBucket) => void;
  onChangePrivacy: (bucket: PublicBucket) => void;
  onArchive: (bucket: PublicBucket) => void;
  onAdjust?: (bucket: PublicBucket) => void;
}

const TYPE_CONFIG: Record<
  BucketType,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  cash: { label: 'Cash / Wallet', icon: Banknote },
  bank: { label: 'Bank Account', icon: Landmark },
  kuri: { label: 'Kuri / Chit Fund', icon: Coins },
  loan_given: { label: 'Loan Given (Asset)', icon: ArrowUpRight },
  loan_taken: { label: 'Loan Taken (Liability)', icon: ArrowDownLeft },
};

const VISIBILITY_CONFIG: Record<
  Visibility,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badgeClass: string;
    tooltip: string;
  }
> = {
  shared: {
    label: 'Shared',
    icon: Users,
    badgeClass: 'bg-blue-500/10 text-blue-500 border-blue-500/20 dark:bg-blue-400/10 dark:text-blue-400 dark:border-blue-400/20',
    tooltip: 'Shared: Partner has full visibility over balance and all ledger transactions.',
  },
  balance_only: {
    label: 'Balance Only',
    icon: Eye,
    badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-400/10 dark:text-amber-400 dark:border-amber-400/20',
    tooltip: 'Balance Only: Partner sees current balance only. Zero transactions, notes, or activity are visible.',
  },
  private: {
    label: 'Private',
    icon: Lock,
    badgeClass: 'bg-purple-500/10 text-purple-600 border-purple-500/20 dark:bg-purple-400/10 dark:text-purple-400 dark:border-purple-400/20',
    tooltip: 'Private: Completely hidden from your partner. Invisible in partner queries and reports.',
  },
};

export function BucketCard({
  bucket,
  partnerName,
  onEdit,
  onChangePrivacy,
  onArchive,
}: BucketCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const typeInfo = TYPE_CONFIG[bucket.type];
  const visInfo = VISIBILITY_CONFIG[bucket.visibility];
  const TypeIcon = typeInfo.icon;
  const VisIcon = visInfo.icon;

  const isNegative = bucket.type === 'loan_taken' || bucket.balance < 0;

  // Close menu on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

  const partnerLabel = partnerName
    ? `${partnerName.trim().split(' ')[0]}'s`
    : "Partner's";

  return (
    <div
      className={`relative rounded-2xl p-5 border transition-all flex flex-col justify-between bg-card ${
        bucket.isArchived
          ? 'border-border/60 opacity-60'
          : 'border-border hover:border-primary/50 shadow-sm hover:shadow-md'
      }`}
    >
      <div>
        {/* Top Badges & Card Menu */}
        <div className="flex items-center justify-between gap-2 mb-3.5">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Ownership Badge */}
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                bucket.isOwner
                  ? 'bg-muted/10 text-muted border-border font-medium'
                  : 'bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400'
              }`}
            >
              {bucket.isOwner ? 'Mine' : partnerLabel}
            </span>

            {/* Distinct Visibility Badge with Tooltip & Icon */}
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border cursor-help ${visInfo.badgeClass}`}
              title={visInfo.tooltip}
            >
              <VisIcon className="w-3 h-3" />
              <span>{visInfo.label}</span>
            </span>
          </div>

          {/* Three-dots menu (Owner only) */}
          {bucket.isOwner && !bucket.isArchived && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-muted/10 transition-colors cursor-pointer"
                aria-label={`Actions for ${bucket.name}`}
                aria-expanded={menuOpen}
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-7 z-30 w-44 rounded-xl bg-card border border-border shadow-xl p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit(bucket);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-foreground hover:bg-muted/10 transition-colors text-left cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-primary" />
                    <span>Edit Bucket</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onChangePrivacy(bucket);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-foreground hover:bg-muted/10 transition-colors text-left cursor-pointer"
                  >
                    <Shield className="w-3.5 h-3.5 text-blue-500" />
                    <span>Change Privacy</span>
                  </button>

                  {onAdjust && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onAdjust(bucket);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-foreground hover:bg-muted/10 transition-colors text-left cursor-pointer"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-amber-500" />
                      <span>Adjust Balance</span>
                    </button>
                  )}

                  <div className="h-px bg-border my-1" />

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onArchive(bucket);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-negative hover:bg-negative/10 transition-colors text-left cursor-pointer"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>Archive Bucket</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bucket Name & Type */}
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
            <TypeIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className="font-semibold text-foreground text-base truncate tracking-tight"
              title={bucket.name}
            >
              {bucket.name}
            </h3>
            <p className="text-xs text-muted truncate mt-0.5">{typeInfo.label}</p>
          </div>
        </div>

        {/* Description / Notes (if available) */}
        {bucket.description && (
          <p
            className="text-xs text-muted mt-2.5 line-clamp-2 italic"
            title={bucket.description}
          >
            &quot;{bucket.description}&quot;
          </p>
        )}
      </div>

      {/* Balance Footer */}
      <div className="mt-6 pt-4 border-t border-border">
        <span className="text-[11px] uppercase tracking-wider text-muted font-medium block">
          Current Balance
        </span>
        <div
          className={`text-2xl font-bold tracking-tight font-mono tabular-nums mt-0.5 ${
            isNegative ? 'text-negative' : 'text-foreground'
          }`}
        >
          {formatINR(bucket.balance)}
        </div>

        {bucket.isArchived && (
          <span className="text-[11px] text-muted italic mt-2 block font-medium">
            Archived (Read Only)
          </span>
        )}
      </div>
    </div>
  );
}
