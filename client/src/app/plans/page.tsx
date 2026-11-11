'use client';

/**
 * Client Component: /plans
 * 
 * Server vs Client Component Rationale:
 * Marked as 'use client' because this page orchestrates interactive modal flows:
 * 1. Filtering plans dynamically between Active, EMI, Kuri, and Completed.
 * 2. Real-time creation modal with dynamic preview calculations.
 * 3. Payment modal with inline balance shortfall checks that link into the Transfer modal.
 * 4. Kuri payout recording modal.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { PublicPlan } from '@vault/shared';
import { usePlans } from '../../lib/planHooks';
import { useAuthMe, useBuckets } from '../../lib/bucketHooks';
import { ThemeToggle } from '../../components/ThemeToggle';
import { DashboardAlertsBanner } from '../../components/DashboardAlertsBanner';
import { PlanCard } from '../../components/PlanCard';
import { CreatePlanModal } from '../../components/CreatePlanModal';
import { EditPlanModal } from '../../components/EditPlanModal';
import { PayPlanModal } from '../../components/PayPlanModal';
import { KuriPayoutModal } from '../../components/KuriPayoutModal';
import { RecordBonusModal } from '../../components/RecordBonusModal';
import { RedeemPlanModal } from '../../components/RedeemPlanModal';
import { TransactionModal } from '../../components/TransactionModal';
import {
  Calendar,
  Plus,
  LayoutDashboard,
  Receipt,
  Search,
} from 'lucide-react';

export default function PlansPage() {
  const { data: authData } = useAuthMe();
  const currentUser = authData?.user;

  // Tabs: 'active' | 'completed'
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  const [kindFilter, setKindFilter] = useState<'all' | 'emi' | 'kuri' | 'gold_scheme'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch plans and buckets
  const { data: plansData, isLoading } = usePlans(activeTab);
  const plans = plansData?.plans || [];
  const { data: bucketsData } = useBuckets();
  const buckets = bucketsData?.buckets || [];

  // Modal States
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<PublicPlan | null>(null);
  const [payPlan, setPayPlan] = useState<PublicPlan | null>(null);
  const [payoutPlan, setPayoutPlan] = useState<PublicPlan | null>(null);
  const [bonusPlan, setBonusPlan] = useState<PublicPlan | null>(null);
  const [redeemPlan, setRedeemPlan] = useState<PublicPlan | null>(null);

  // Transfer modal state (when shortfall occurs)
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferPrefill, setTransferPrefill] = useState<{
    toBucketId?: string;
    amount?: number;
  }>({});

  const filteredPlans = plans.filter((p) => {
    const matchesSearch =
      !searchQuery.trim() ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (kindFilter === 'all') return true;
    return p.kind === kindFilter;
  });

  const handleOpenTransfer = (data: { toBucketId?: string; amount?: number }) => {
    setTransferPrefill(data);
    setTransferModalOpen(true);
  };

  const handlePayClick = (plan: PublicPlan) => {
    setPayPlan(plan);
  };

  const handlePayoutClick = (plan: PublicPlan) => {
    setPayoutPlan(plan);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col antialiased transition-colors duration-200">
      {/* Top Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 text-primary font-bold flex items-center justify-center text-base shadow-xs">
                V
              </div>
              <span className="text-base font-semibold tracking-tight text-foreground">
                Vault
              </span>
            </Link>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium hidden sm:inline-block">
              Plans & Schemes
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted/10 transition-colors"
            >
              <LayoutDashboard className="w-3.5 h-3.5 text-primary" />
              <span>Dashboard</span>
            </Link>

            <Link
              href="/transactions"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted/10 transition-colors"
            >
              <Receipt className="w-3.5 h-3.5 text-primary" />
              <span>Transactions</span>
            </Link>

            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Plan</span>
            </button>

            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Live Dashboard Alerts Banner */}
        <DashboardAlertsBanner
          onOpenTransfer={handleOpenTransfer}
          onOpenPayPlan={(planId) => {
            const found = plans.find((p) => p.id === planId);
            if (found) setPayPlan(found);
          }}
        />

        {/* Section Title & Navigation Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Plans & Commitments
            </h1>
            <p className="text-xs sm:text-sm text-muted mt-0.5">
              Track fixed-term EMIs, Kuri savings, and Gold Schemes with payment schedules and balance-aware alerts.
            </p>
          </div>

          {/* Active vs Completed Tab Buttons */}
          <div className="flex items-center p-1 bg-muted/10 rounded-xl border border-border/60 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setActiveTab('active')}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'active'
                  ? 'bg-card text-primary shadow-xs border border-border/80'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              Active Plans {activeTab === 'active' ? `(${plans.length})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('completed')}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'completed'
                  ? 'bg-card text-primary shadow-xs border border-border/80'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              Completed {activeTab === 'completed' ? `(${plans.length})` : ''}
            </button>
          </div>
        </div>

        {/* Sub-Filters & Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { id: 'all', label: 'All Plans', icon: '📋' },
              { id: 'emi', label: 'EMIs', icon: '💳' },
              { id: 'kuri', label: 'Kuri Chits', icon: '🪙' },
              { id: 'gold_scheme', label: 'Gold Schemes', icon: '✨' },
            ].map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKindFilter(k.id as 'all' | 'emi' | 'kuri' | 'gold_scheme')}
                className={`py-1.5 px-3 rounded-full text-xs font-medium transition-colors cursor-pointer border flex items-center gap-1.5 ${
                  kindFilter === k.id
                    ? 'bg-primary/10 border-primary/30 text-primary font-bold shadow-2xs'
                    : 'border-border bg-card text-muted hover:text-foreground'
                }`}
              >
                <span>{k.icon}</span>
                <span>{k.label}</span>
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search plans or schemes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-border bg-card text-foreground text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        {/* Plans Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-64 rounded-2xl border border-border bg-card/50 animate-pulse"
              />
            ))}
          </div>
        ) : filteredPlans.length === 0 ? (
          <div className="text-center py-16 px-4 rounded-2xl border border-dashed border-border bg-muted/5 space-y-3">
            <div className="inline-flex p-3 rounded-full bg-muted/10 text-muted">
              <Calendar className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-foreground">
              {activeTab === 'active' ? 'No active plans found' : 'No completed plans yet'}
            </h3>
            <p className="text-xs text-muted max-w-sm mx-auto">
              {activeTab === 'active'
                ? 'Create a fixed EMI payment plan, a monthly Kuri chit-fund commitment, or a Jewellery Gold Scheme to track installments with live shortfall alerts.'
                : 'Plans will automatically move to this tab once all installments and redemptions are completed.'}
            </p>
            {activeTab === 'active' && (
              <button
                type="button"
                onClick={() => setCreateModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create Your First Plan</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredPlans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                currentUserId={currentUser?.id}
                onPayClick={handlePayClick}
                onPayoutClick={handlePayoutClick}
                onEditClick={(p) => setEditPlan(p)}
                onRecordBonusClick={(p) => setBonusPlan(p)}
                onRedeemClick={(p) => setRedeemPlan(p)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Modals */}
      <CreatePlanModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />

      <EditPlanModal
        plan={editPlan}
        isOpen={!!editPlan}
        onClose={() => setEditPlan(null)}
      />

      <PayPlanModal
        plan={payPlan}
        isOpen={!!payPlan}
        onClose={() => setPayPlan(null)}
        onOpenTransfer={handleOpenTransfer}
      />

      <KuriPayoutModal
        plan={payoutPlan}
        isOpen={!!payoutPlan}
        onClose={() => setPayoutPlan(null)}
      />

      <RecordBonusModal
        plan={bonusPlan}
        isOpen={!!bonusPlan}
        onClose={() => setBonusPlan(null)}
      />

      <RedeemPlanModal
        plan={redeemPlan}
        isOpen={!!redeemPlan}
        onClose={() => setRedeemPlan(null)}
      />

      <TransactionModal
        isOpen={transferModalOpen}
        onClose={() => {
          setTransferModalOpen(false);
          setTransferPrefill({});
        }}
        buckets={buckets}
        initialMode="transfer"
        preselectedBucketId={transferPrefill.toBucketId}
      />
    </div>
  );
}
