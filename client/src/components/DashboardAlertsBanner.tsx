'use client';

/**
 * Client Component: DashboardAlertsBanner
 * 
 * Computes and renders live payment alerts and balance shortfall warnings.
 * Renders nothing if no alerts are active.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { formatINR } from '@vault/shared';
import { usePlanAlerts, useDismissAlert } from '../lib/planHooks';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  X,
  CreditCard,
  PiggyBank,
  Shield,
  ArrowRightLeft,
} from 'lucide-react';

interface DashboardAlertsBannerProps {
  onOpenTransfer?: (data: { fromBucketId?: string; toBucketId?: string; amount?: number }) => void;
  onOpenPayPlan?: (planId: string) => void;
}

export function DashboardAlertsBanner({
  onOpenTransfer,
  onOpenPayPlan,
}: DashboardAlertsBannerProps) {
  const { data: alertsData, isLoading } = usePlanAlerts();
  const dismissMutation = useDismissAlert();
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  if (isLoading || !alertsData) {
    return null;
  }

  const { alerts, shortfalls } = alertsData;

  // Filter out any that were dismissed today (server also filters them)
  const activeAlerts = alerts.filter((a) => !a.isDismissedToday);

  if (activeAlerts.length === 0 && shortfalls.length === 0) {
    return null;
  }

  const handleDismiss = (planId: string) => {
    setDismissingId(planId);
    dismissMutation.mutate(planId, {
      onSettled: () => setDismissingId(null),
    });
  };

  return (
    <div className="space-y-2.5 mb-3.5">
      {/* Shortfall Summaries (grouped across plans on the same bucket) */}
      {shortfalls.map((sf) => (
        <div
          key={`sf-${sf.bucketId}`}
          className="rounded-xl border border-negative/30 bg-negative/5 p-3 sm:p-3.5 text-foreground shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 animate-in fade-in duration-200"
        >
          <div className="flex items-start gap-2.5">
            <div className="p-1.5 rounded-lg bg-negative/10 text-negative mt-0.5">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-xs sm:text-sm text-foreground">
                  Shortfall Alert: {sf.bucketName}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-negative/20 text-negative font-bold">
                  {sf.plansCount} {sf.plansCount === 1 ? 'plan' : 'plans'} due
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                Total needed: <strong className="text-foreground">{formatINR(sf.totalDueSoonOrOverdue)}</strong>. Current balance: <strong className="text-foreground">{formatINR(sf.currentBalance)}</strong>. Shortfall: <strong className="text-negative">{formatINR(sf.shortfall)}</strong>.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            {onOpenTransfer && (
              <button
                type="button"
                onClick={() =>
                  onOpenTransfer({
                    toBucketId: sf.bucketId,
                    amount: sf.shortfall,
                  })
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-negative text-white hover:bg-negative/90 text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>Transfer {formatINR(sf.shortfall)}</span>
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Individual Plan Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {activeAlerts.map((alert) => {
          const isOverdue = alert.status === 'overdue';
          const isDue = alert.status === 'due';
          const isDismissing = dismissingId === alert.planId;

          // Format due date in local readable format
          const dueFormatted = new Date(alert.dueDate).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
          });

          const isKuri = alert.kind === 'kuri';

          return (
            <div
              key={alert.planId}
              className={`rounded-xl border p-3 sm:p-3.5 transition-all duration-200 relative shadow-xs ${
                isOverdue
                  ? 'border-negative/30 bg-gradient-to-r from-negative/5 to-negative/2'
                  : alert.isShortfall
                  ? 'border-amber-500/30 bg-gradient-to-r from-amber-500/5 to-amber-500/2'
                  : 'border-primary/25 bg-gradient-to-r from-primary/5 to-primary/2'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`p-2 rounded-xl text-base ${
                      isOverdue
                        ? 'bg-negative/15 text-negative border border-negative/20'
                        : alert.isShortfall
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                        : isKuri
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                        : 'bg-primary/15 text-primary border border-primary/20'
                    }`}
                  >
                    {isKuri ? <PiggyBank className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/plans/${alert.planId}`}
                        className="font-bold text-xs sm:text-sm text-foreground hover:text-primary transition-colors flex items-center gap-1 group"
                      >
                        <span>{alert.planName}</span>
                        <ArrowRight className="w-3 h-3 text-muted group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                      </Link>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 uppercase font-sans">
                        {isKuri ? 'Kuri Chit' : 'EMI'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted mt-0.5">
                      {isOverdue && <span className="inline-block w-1.5 h-1.5 rounded-full bg-negative animate-ping" />}
                      <span className={isOverdue ? 'text-negative font-semibold' : ''}>
                        {isDue ? 'Due Today' : isOverdue ? 'Overdue since ' + dueFormatted : 'Due on ' + dueFormatted}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Dismiss action */}
                <button
                  type="button"
                  title="Dismiss for today"
                  disabled={isDismissing}
                  onClick={() => handleDismiss(alert.planId)}
                  className="text-muted hover:text-foreground p-1 rounded-md hover:bg-muted/10 transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="mt-2.5 flex items-center justify-between border-t border-border/50 pt-2">
                <div>
                  <span className="text-xs text-muted block">Installment Due</span>
                  <span className="text-base font-bold text-foreground">
                    {formatINR(alert.amountDue)}
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-xs text-muted block">
                    Paying from {alert.payFromBucketName}
                  </span>
                  {alert.isMasked ? (
                    <span className="text-xs text-muted italic flex items-center gap-1 justify-end">
                      <Shield className="w-3 h-3 text-muted" />
                      Protected
                    </span>
                  ) : alert.isShortfall && alert.shortfallAmount ? (
                    <span className="text-xs font-semibold text-negative">
                      Short by {formatINR(alert.shortfallAmount)}
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-positive flex items-center gap-1 justify-end">
                      <CheckCircle2 className="w-3 h-3" />
                      Ready ({formatINR(alert.bucketBalance || 0)})
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-3 flex items-center gap-2">
                {alert.isShortfall && onOpenTransfer ? (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenTransfer({
                        toBucketId: alert.payFromBucketId,
                        amount: alert.shortfallAmount,
                      })
                    }
                    className="flex-1 py-1.5 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    <span>Transfer Shortfall ({formatINR(alert.shortfallAmount || 0)})</span>
                  </button>
                ) : onOpenPayPlan ? (
                  <button
                    type="button"
                    onClick={() => onOpenPayPlan(alert.planId)}
                    className="flex-1 py-1.5 px-3 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Pay {formatINR(alert.amountDue)}</span>
                  </button>
                ) : (
                  <Link
                    href={`/plans/${alert.planId}`}
                    className="flex-1 py-1.5 px-3 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors text-center"
                  >
                    View Plan
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
