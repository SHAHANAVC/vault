'use client';

/**
 * Client Component: BucketCard
 * Displays individual bucket with modern glassmorphism, type-specific ambient glow,
 * glowing visibility badge, prominent INR balance, quick-action buttons, and three-dots menu.
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
  Sparkles,
  ShieldCheck,
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
  Plus,
  ArrowRightLeft,
} from 'lucide-react';

interface BucketCardProps {
  bucket: PublicBucket;
  partnerName?: string | null;
  onEdit: (bucket: PublicBucket) => void;
  onChangePrivacy: (bucket: PublicBucket) => void;
  onArchive: (bucket: PublicBucket) => void;
  onAdjust?: (bucket: PublicBucket) => void;
  onAddTransaction?: (bucket: PublicBucket) => void;
  onTransfer?: (bucket: PublicBucket) => void;
}

const TYPE_CONFIG: Record<
  BucketType,
  {
    label: string;
    sublabel: string;
    icon: React.ComponentType<{ className?: string }>;
    accentColor: string;
    accentBg: string;
    topGradient: string;
  }
> = {
  cash: {
    label: 'Cash / Wallet',
    sublabel: 'Physical Liquid Cash',
    icon: Banknote,
    accentColor: 'text-emerald-500 dark:text-emerald-400',
    accentBg: 'bg-emerald-500/10 border-emerald-500/20',
    topGradient: 'from-emerald-500/60 via-teal-400/40 to-transparent',
  },
  bank: {
    label: 'Bank Account',
    sublabel: 'Savings & Current Account',
    icon: Landmark,
    accentColor: 'text-cyan-500 dark:text-cyan-400',
    accentBg: 'bg-cyan-500/10 border-cyan-500/20',
    topGradient: 'from-cyan-500/60 via-blue-400/40 to-transparent',
  },
  kuri: {
    label: 'Kuri',
    sublabel: 'Rotating Savings Ledger',
    icon: Coins,
    accentColor: 'text-amber-500 dark:text-amber-400',
    accentBg: 'bg-amber-500/10 border-amber-500/20',
    topGradient: 'from-amber-500/60 via-orange-400/40 to-transparent',
  },
  gold_scheme: {
    label: 'Gold Scheme',
    sublabel: 'Jewellery Gold Scheme',
    icon: Sparkles,
    accentColor: 'text-yellow-500 dark:text-yellow-400',
    accentBg: 'bg-yellow-500/10 border-yellow-500/20',
    topGradient: 'from-yellow-500/60 via-amber-400/40 to-transparent',
  },
  fixed_savings: {
    label: 'Fixed Savings',
    sublabel: 'Locked Emergency Reserve',
    icon: ShieldCheck,
    accentColor: 'text-violet-500 dark:text-violet-400',
    accentBg: 'bg-violet-500/10 border-violet-500/20',
    topGradient: 'from-violet-500/60 via-purple-400/40 to-transparent',
  },
  loan_given: {
    label: 'Loan Given',
    sublabel: 'Receivable Asset',
    icon: ArrowUpRight,
    accentColor: 'text-indigo-500 dark:text-indigo-400',
    accentBg: 'bg-indigo-500/10 border-indigo-500/20',
    topGradient: 'from-indigo-500/60 via-purple-400/40 to-transparent',
  },
  loan_taken: {
    label: 'Loan Taken',
    sublabel: 'Payable Liability',
    icon: ArrowDownLeft,
    accentColor: 'text-rose-500 dark:text-rose-400',
    accentBg: 'bg-rose-500/10 border-rose-500/20',
    topGradient: 'from-rose-500/60 via-red-400/40 to-transparent',
  },
};

const VISIBILITY_CONFIG: Record<
  Visibility,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badgeClass: string;
    dotClass: string;
    tooltip: string;
  }
> = {
  shared: {
    label: 'Shared',
    icon: Users,
    badgeClass: 'bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-400/10 dark:text-blue-400 dark:border-blue-400/25',
    dotClass: 'bg-blue-500',
    tooltip: 'Shared: Partner has full visibility over balance and all ledger transactions.',
  },
  balance_only: {
    label: 'Balance Only',
    icon: Eye,
    badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/25 dark:bg-amber-400/10 dark:text-amber-400 dark:border-amber-400/25',
    dotClass: 'bg-amber-500',
    tooltip: 'Balance Only: Partner sees current balance only. Zero transactions, notes, or activity are visible.',
  },
  private: {
    label: 'Private',
    icon: Lock,
    badgeClass: 'bg-purple-500/10 text-purple-600 border-purple-500/25 dark:bg-purple-400/10 dark:text-purple-400 dark:border-purple-400/25',
    dotClass: 'bg-purple-500',
    tooltip: 'Private: Completely hidden from your partner. Invisible in partner queries and reports.',
  },
};

export function BucketCard({
  bucket,
  partnerName,
  onEdit,
  onChangePrivacy,
  onArchive,
  onAdjust,
  onAddTransaction,
  onTransfer,
}: BucketCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const typeInfo = TYPE_CONFIG[bucket.type] || TYPE_CONFIG.cash;
  const visInfo = VISIBILITY_CONFIG[bucket.visibility] || VISIBILITY_CONFIG.shared;
  const TypeIcon = typeInfo.icon;
  const VisIcon = visInfo.icon;

  const isLiability = bucket.type === 'loan_taken';
  const isNegative = bucket.balance < 0;

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
      className={`group relative rounded-2xl p-4 sm:p-4.5 border transition-all duration-300 flex flex-col justify-between overflow-hidden bg-card/90 backdrop-blur-md ${
        bucket.isArchived
          ? 'border-border/50 opacity-60'
          : 'border-border/80 hover:border-primary/50 shadow-sm hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5'
      }`}
    >
      {/* Top Ambient Glow Edge */}
      <div
        className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${typeInfo.topGradient}`}
      />

      <div>
        {/* Top Badges & Card Menu */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Ownership Badge */}
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                bucket.isOwner
                  ? 'bg-muted/10 text-muted border-border/80'
                  : 'bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400'
              }`}
            >
              {bucket.isOwner ? 'Mine' : partnerLabel}
            </span>

            {/* Visibility Badge with Glowing Dot */}
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border cursor-help ${visInfo.badgeClass}`}
              title={visInfo.tooltip}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${visInfo.dotClass} animate-pulse`} />
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
                className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-muted/15 transition-colors cursor-pointer"
                aria-label={`Actions for ${bucket.name}`}
                aria-expanded={menuOpen}
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-7 z-30 w-44 rounded-xl bg-card/95 backdrop-blur-xl border border-border shadow-xl p-1 text-xs animate-in fade-in zoom-in-95 duration-100">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit(bucket);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-foreground hover:bg-muted/15 transition-colors text-left cursor-pointer font-medium"
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
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-foreground hover:bg-muted/15 transition-colors text-left cursor-pointer font-medium"
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
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-foreground hover:bg-muted/15 transition-colors text-left cursor-pointer font-medium"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-amber-500" />
                      <span>Adjust Balance</span>
                    </button>
                  )}

                  <div className="h-px bg-border/70 my-1" />

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onArchive(bucket);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-negative hover:bg-negative/10 transition-colors text-left cursor-pointer font-medium"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>Archive Bucket</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bucket Name & Icon Header */}
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-xl border shrink-0 transition-transform duration-200 group-hover:scale-105 ${typeInfo.accentBg}`}>
            <TypeIcon className={`w-4.5 h-4.5 ${typeInfo.accentColor}`} />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className="font-bold text-foreground text-sm sm:text-base truncate tracking-tight group-hover:text-primary transition-colors"
              title={bucket.name}
            >
              {bucket.name}
            </h3>
            <p className="text-[11px] text-muted truncate mt-0.5">{typeInfo.label}</p>
          </div>
        </div>

        {/* Description / Purpose Note */}
        {bucket.description ? (
          <p
            className="text-[11px] text-muted/90 mt-2 line-clamp-1 italic bg-muted/5 px-2 py-1 rounded-lg border border-border/40"
            title={bucket.description}
          >
            &quot;{bucket.description}&quot;
          </p>
        ) : (
          <p className="text-[10px] text-muted/60 mt-2 italic">{typeInfo.sublabel}</p>
        )}
      </div>

      {/* Balance & Action Footer */}
      <div className="mt-4 pt-3 border-t border-border/70 space-y-2.5">
        <div>
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted font-bold">
            <span>{isLiability ? 'Liability Balance' : 'Current Balance'}</span>
            {isLiability && (
              <span className="text-rose-500 dark:text-rose-400 font-semibold lowercase">
                payable
              </span>
            )}
          </div>
          <div
            className={`text-xl sm:text-2xl font-extrabold tracking-tight font-mono tabular-nums mt-0.5 ${
              isLiability || isNegative
                ? 'text-rose-500 dark:text-rose-400'
                : 'text-foreground'
            }`}
          >
            {formatINR(bucket.balance)}
          </div>
        </div>

        {/* Quick Actions (Add Tx & Transfer) */}
        {!bucket.isArchived && (onAddTransaction || onTransfer) && (
          <div className="grid grid-cols-2 gap-2 pt-0.5">
            {onAddTransaction && (
              <button
                type="button"
                onClick={() => onAddTransaction(bucket)}
                className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-xl bg-card border border-border/80 hover:border-primary/50 text-foreground text-xs font-semibold hover:bg-muted/10 transition-all cursor-pointer shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5 text-primary" />
                <span>Record Tx</span>
              </button>
            )}

            {onTransfer && (
              <button
                type="button"
                onClick={() => onTransfer(bucket)}
                className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-xl bg-card border border-border/80 hover:border-primary/50 text-foreground text-xs font-semibold hover:bg-muted/10 transition-all cursor-pointer shadow-2xs"
              >
                <ArrowRightLeft className="w-3.5 h-3.5 text-cyan-500" />
                <span>Transfer</span>
              </button>
            )}
          </div>
        )}

        {bucket.isArchived && (
          <span className="text-[10px] text-muted italic block font-medium text-center py-0.5">
            Archived (Read Only)
          </span>
        )}
      </div>
    </div>
  );
}
