'use client';

/**
 * Client Component Directive: "use client"
 * Required for the interactive dashboard and partner onboarding panel.
 * It uses client state (useState, useEffect) for:
 * 1. Fetching session data from /api/auth/me
 * 2. Generating dynamic partner invites on-demand
 * 3. Handling clipboard copy with timed visual feedback
 * 4. Handling session logout and redirect
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatINR, PublicUser } from '@vault/shared';
import { useBucketSummary, useBuckets } from '../lib/bucketHooks';
import { ThemeToggle } from '../components/ThemeToggle';
import { TransactionModal } from '../components/TransactionModal';
import { TransactionsList } from '../components/TransactionsList';
import {
  Users,
  Copy,
  Check,
  ArrowRight,
  UserPlus,
  LogOut,
  Wallet,
  ShieldCheck,
  Send,
  Plus,
  Split,
} from 'lucide-react';

interface PartnerInfo {
  id: string;
  name: string;
  email: string;
}

interface ActiveInvite {
  token: string;
  inviteUrl: string;
  expiresAt: string;
}

export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState<PublicUser | null>(null);
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Live bucket summary metrics (householdTotal & myTotal)
  const { data: summary } = useBucketSummary();
  const { data: bucketData } = useBuckets();
  const buckets = bucketData?.buckets || [];

  // Transaction Modal State
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txModalMode, setTxModalMode] = useState<'single' | 'split-income' | 'split-transfer'>('single');

  // Invite creation state
  const [activeInvite, setActiveInvite] = useState<ActiveInvite | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Fetch session & profile data
  useEffect(() => {
    async function fetchMe() {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          router.push('/login');
          return;
        }
        const data = await res.json();
        setUser(data.user);
        setPartner(data.partner);
      } catch (_err) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }

    fetchMe();
  }, [router]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch (_err) {
      router.push('/login');
    }
  };

  const handleCreateInvite = async () => {
    setGeneratingInvite(true);
    setInviteError(null);
    try {
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresInDays: 7 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.message || 'Failed to create partner invite');
        setGeneratingInvite(false);
        return;
      }
      setActiveInvite(data);
    } catch (_err) {
      setInviteError('Network error while generating partner invite');
    } finally {
      setGeneratingInvite(false);
    }
  };

  const handleCopyLink = async () => {
    if (!activeInvite) return;
    try {
      await navigator.clipboard.writeText(activeInvite.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_err) {
      // Fallback
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted">
        <div className="flex items-center gap-3">
          <svg
            className="animate-spin h-5 w-5 text-primary"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-sm font-medium text-foreground">Loading Vault dashboard...</span>
        </div>
      </div>
    );
  }

  const whatsappMessage = activeInvite
    ? encodeURIComponent(
        `Hi! Join my Vault to manage our family cash flow and expenses together: ${activeInvite.inviteUrl}`
      )
    : '';

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col antialiased transition-colors duration-200">
      {/* Top Navigation Bar */}
      <header className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 text-primary font-bold flex items-center justify-center text-base shadow-sm">
              V
            </div>
            <div>
              <span className="text-base font-semibold tracking-tight text-foreground">
                Vault
              </span>
              <span className="hidden sm:inline-block ml-2 text-xs font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                Family Finance
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => {
                setTxModalMode('split-income');
                setTxModalOpen(true);
              }}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card-muted hover:bg-muted/20 border border-border text-foreground text-xs font-semibold transition-colors cursor-pointer"
            >
              <Split className="w-3.5 h-3.5 text-primary" />
              <span>Split Salary</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTxModalMode('single');
                setTxModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-background text-xs font-semibold transition-all shadow-sm shadow-primary/20 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Record</span>
            </button>

            <ThemeToggle />

            <div className="text-right hidden sm:block border-l border-border pl-3">
              <span className="text-[11px] text-muted block">Signed in as</span>
              <p className="text-xs font-semibold text-foreground">{user?.name}</p>
            </div>

            <button
              onClick={handleLogout}
              className="py-1.5 px-3 rounded-lg text-xs font-medium bg-card hover:bg-card-muted border border-border text-foreground hover:text-primary transition-colors cursor-pointer flex items-center gap-1.5"
              title="Sign out of Vault"
            >
              <LogOut className="w-3.5 h-3.5 text-muted" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 w-full space-y-8 flex-1">
        {/* Welcome Hero */}
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-mono uppercase tracking-widest text-primary font-semibold">
                Family Finance Overview
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1">
                Welcome back, {user?.name}
              </h1>
              <p className="text-sm text-muted mt-1">
                Collaborative cash flow management with strict integer paise precision.
              </p>
            </div>

            {/* Partner Connection Status Pill */}
            <div className="flex items-center gap-2 self-start sm:self-auto px-3.5 py-1.5 rounded-full bg-card-muted border border-border text-xs">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  partner ? 'bg-positive animate-pulse' : 'bg-amber-500'
                }`}
              />
              <span className="font-medium text-foreground">
                {partner ? `Partner: ${partner.name}` : 'No Partner Connected'}
              </span>
            </div>
          </div>

          {/* Live Bucket Summary Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
            <div className="bg-background border border-border rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted font-medium">
                    Joint Family Net Balance
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-positive/10 text-positive border border-positive/20 font-mono font-medium">
                    householdTotal
                  </span>
                </div>
                <p className="text-2xl font-bold text-positive mt-2 font-mono tabular-nums">
                  {formatINR(summary?.householdTotal ?? 0)}
                </p>
                <span className="text-[11px] text-muted font-mono block mt-0.5">
                  {summary?.householdTotal ?? 0} integer paise
                </span>
              </div>
              <p className="text-[11px] text-muted mt-3 pt-2 border-t border-border">
                Sum of shared & balance-only funds across the household.
              </p>
            </div>

            <div className="bg-background border border-border rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted font-medium">
                    My Direct Funds
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-card-muted text-muted border border-border font-mono font-medium">
                    myTotal
                  </span>
                </div>
                <p className="text-2xl font-bold text-foreground mt-2 font-mono tabular-nums">
                  {formatINR(summary?.myTotal ?? 0)}
                </p>
                <span className="text-[11px] text-muted font-mono block mt-0.5">
                  {summary?.myTotal ?? 0} integer paise
                </span>
              </div>
              <p className="text-[11px] text-muted mt-3 pt-2 border-t border-border">
                Personal buckets (all visibilities) + partner&apos;s shared funds.
              </p>
            </div>

            <div className="bg-background border border-border rounded-xl p-4 sm:col-span-2 lg:col-span-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-primary" />
                  <span className="text-xs text-foreground font-semibold">
                    Buckets & Privacy Controls
                  </span>
                </div>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  Manage cash, bank & kuri funds with backend-enforced privacy: Shared, Balance Only, or Private.
                </p>
              </div>

              <div className="mt-4 pt-2 border-t border-border">
                <Link
                  href="/buckets"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-background text-xs font-semibold transition-all shadow-sm shadow-primary/20"
                >
                  <span>Manage Financial Buckets</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Ledger & Grouped Transactions Section */}
        <TransactionsList
          currentUserId={user?.id}
          onNewTransaction={() => {
            setTxModalMode('single');
            setTxModalOpen(true);
          }}
          onSplitSalary={() => {
            setTxModalMode('split-income');
            setTxModalOpen(true);
          }}
        />

        {/* Settings > Partner Section */}
        <section
          id="partner-settings"
          className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-sm"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-5">
            <div>
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                Partner Management
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Manage your partner connection for joint household finance tracking
              </p>
            </div>

            {partner && (
              <span className="text-xs px-3 py-1 rounded-full bg-positive/10 text-positive border border-positive/20 font-medium flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Connected
              </span>
            )}
          </div>

          {inviteError && (
            <div className="mt-4 p-3.5 rounded-xl bg-negative/10 border border-negative/20 text-negative text-xs">
              {inviteError}
            </div>
          )}

          {partner ? (
            /* Connected Partner View */
            <div className="mt-6 p-5 rounded-xl bg-background border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="h-11 w-11 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold flex items-center justify-center text-sm">
                  {partner.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{partner.name}</h3>
                  <p className="text-xs text-muted">{partner.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-positive bg-positive/10 border border-positive/20 px-3.5 py-1.5 rounded-lg self-start sm:self-auto font-medium">
                <Check className="w-4 h-4 text-positive" />
                <span>Partner Synced & Connected</span>
              </div>
            </div>
          ) : (
            /* Unconnected / Invite Generation View */
            <div className="mt-6 space-y-6">
              <div className="p-5 rounded-xl bg-background border border-border space-y-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-card-muted border border-border text-primary shrink-0">
                    <UserPlus className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Connect with your partner
                    </h3>
                    <p className="text-xs text-muted mt-1 leading-relaxed">
                      Vault uses a single-use invite link to establish your partner
                      connection. Generate an invitation link below and share it directly
                      or via WhatsApp. Once accepted, you will have shared visibility over
                      selected financial buckets.
                    </p>
                  </div>
                </div>

                {!activeInvite ? (
                  <div className="pt-2">
                    <button
                      onClick={handleCreateInvite}
                      disabled={generatingInvite}
                      className="py-2.5 px-4 rounded-xl font-semibold text-xs text-background bg-primary hover:bg-primary-hover active:scale-[0.99] transition-all duration-150 shadow-sm shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
                    >
                      {generatingInvite ? (
                        <>
                          <svg
                            className="animate-spin h-3.5 w-3.5 text-background"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                          </svg>
                          <span>Creating Invite...</span>
                        </>
                      ) : (
                        'Invite Partner'
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="pt-2 space-y-4">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span className="font-medium text-positive flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-positive animate-ping" />
                        Invite Active (Single-use, expires in 7 days)
                      </span>
                    </div>

                    {/* Invite Link Bar */}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        readOnly
                        value={activeInvite.inviteUrl}
                        className="flex-1 px-3.5 py-2.5 rounded-xl bg-card border border-border text-xs font-mono text-foreground select-all focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleCopyLink}
                          className="px-4 py-2.5 rounded-xl text-xs font-medium bg-card hover:bg-card-muted border border-border text-foreground transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          {copied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-positive" />
                              <span className="text-positive font-semibold">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-muted" />
                              <span>Copy Link</span>
                            </>
                          )}
                        </button>

                        <a
                          href={`https://wa.me/?text=${whatsappMessage}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2.5 rounded-xl text-xs font-medium bg-positive hover:bg-positive/90 text-white transition-colors flex items-center gap-1.5"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Share on WhatsApp</span>
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* TRANSACTION MODAL (Single & Split Modes) */}
      <TransactionModal
        isOpen={txModalOpen}
        onClose={() => setTxModalOpen(false)}
        buckets={buckets}
        initialMode={txModalMode}
      />
    </div>
  );
}

