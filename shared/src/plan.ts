import { z } from 'zod';
import { objectIdSchema, isoDateSchema, paiseAmountSchema, nonNegativePaiseSchema } from './common';
import { visibilityEnum } from './visibility';

/**
 * Plan Kinds:
 * - emi: Fixed-amount liability/debt commitment (e.g. laptop on Bajaj EMI). Payments are EXPENSES (category: 'EMI').
 * - kuri: Fixed-month chit fund savings commitment. Payments are TRANSFERS into a Kuri bucket (an asset).
 * - gold_scheme: Jewellery gold savings commitment. Payments are TRANSFERS into a gold_scheme bucket (an asset).
 */
export const planKindEnum = z.enum(['emi', 'kuri', 'gold_scheme']);
export type PlanKind = z.infer<typeof planKindEnum>;

/**
 * Display labels for plan kinds.
 * Single source of truth across client and server.
 */
export const PLAN_KIND_LABELS: Record<PlanKind, string> = {
  emi: 'EMI Plan',
  kuri: 'Kuri',
  gold_scheme: 'Gold Scheme',
};

export const planStatusEnum = z.enum(['active', 'completed', 'cancelled']);
export type PlanStatus = z.infer<typeof planStatusEnum>;

/* ==========================================================================
   Create Plan Schemas (Discriminated by `kind`)
   ========================================================================== */

export const createEmiBaseSchema = z.object({
  kind: z.literal('emi'),
  name: z
    .string({ required_error: 'Plan name is required' })
    .trim()
    .min(1, 'Plan name cannot be empty')
    .max(100, 'Plan name cannot exceed 100 characters'),
  note: z.string().trim().max(300, 'Note cannot exceed 300 characters').optional(),
  totalAmount: paiseAmountSchema,
  monthlyAmount: paiseAmountSchema,
  startDate: isoDateSchema,
  dueDay: z
    .number({ required_error: 'Due day is required' })
    .int('Due day must be an integer')
    .min(1, 'Due day must be between 1 and 31')
    .max(31, 'Due day must be between 1 and 31'),
  payFromBucketId: objectIdSchema,
  reminderDaysBefore: z
    .number()
    .int()
    .min(0, 'Reminder days must be between 0 and 7')
    .max(7, 'Reminder days must be between 0 and 7')
    .default(3),
  visibility: visibilityEnum.default('shared'),
});

export const createEmiPlanSchema = createEmiBaseSchema.refine(
  (data) => data.monthlyAmount <= data.totalAmount,
  {
    message: 'Monthly installment cannot exceed total amount',
    path: ['monthlyAmount'],
  }
);

export const createKuriBaseSchema = z.object({
  kind: z.literal('kuri'),
  name: z
    .string({ required_error: 'Kuri name is required' })
    .trim()
    .min(1, 'Kuri name cannot be empty')
    .max(100, 'Kuri name cannot exceed 100 characters'),
  note: z.string().trim().max(300, 'Note cannot exceed 300 characters').optional(),
  monthlyAmount: paiseAmountSchema,
  totalInstallments: z
    .number({ required_error: 'Total installments is required' })
    .int('Total installments must be an integer')
    .min(1, 'Kuri must have at least 1 installment')
    .max(120, 'Kuri installments cannot exceed 120 months'),
  startDate: isoDateSchema,
  dueDay: z
    .number({ required_error: 'Due day is required' })
    .int('Due day must be an integer')
    .min(1, 'Due day must be between 1 and 31')
    .max(31, 'Due day must be between 1 and 31'),
  payFromBucketId: objectIdSchema,
  kuriBucketId: objectIdSchema,
  reminderDaysBefore: z
    .number()
    .int()
    .min(0, 'Reminder days must be between 0 and 7')
    .max(7, 'Reminder days must be between 0 and 7')
    .default(3),
  visibility: visibilityEnum.default('shared'),
});

export const createKuriPlanSchema = createKuriBaseSchema.refine(
  (data) => data.payFromBucketId !== data.kuriBucketId,
  {
    message: 'Payment source bucket and Kuri asset bucket must be different',
    path: ['kuriBucketId'],
  }
);

export const createGoldSchemeBaseSchema = z.object({
  kind: z.literal('gold_scheme'),
  name: z
    .string({ required_error: 'Plan name is required' })
    .trim()
    .min(1, 'Plan name cannot be empty')
    .max(100, 'Plan name cannot exceed 100 characters'),
  jewellerName: z.string().trim().max(100, 'Jeweller name cannot exceed 100 characters').optional(),
  note: z.string().trim().max(300, 'Note cannot exceed 300 characters').optional(),
  monthlyAmount: paiseAmountSchema,
  totalInstallments: z
    .number({ required_error: 'Total installments is required' })
    .int('Total installments must be an integer')
    .min(1, 'Gold scheme must have at least 1 installment')
    .max(120, 'Gold scheme installments cannot exceed 120 months'),
  bonusAmount: nonNegativePaiseSchema.default(0).optional(),
  startDate: isoDateSchema,
  dueDay: z
    .number({ required_error: 'Due day is required' })
    .int('Due day must be an integer')
    .min(1, 'Due day must be between 1 and 31')
    .max(31, 'Due day must be between 1 and 31'),
  payFromBucketId: objectIdSchema,
  goldBucketId: objectIdSchema,
  reminderDaysBefore: z
    .number()
    .int()
    .min(0, 'Reminder days must be between 0 and 7')
    .max(7, 'Reminder days must be between 0 and 7')
    .default(3),
  visibility: visibilityEnum.default('shared'),
});

export const createGoldSchemePlanSchema = createGoldSchemeBaseSchema.refine(
  (data) => data.payFromBucketId !== data.goldBucketId,
  {
    message: 'Payment source bucket and Gold scheme asset bucket must be different',
    path: ['goldBucketId'],
  }
);

export const createPlanSchema = z
  .discriminatedUnion('kind', [createEmiBaseSchema, createKuriBaseSchema, createGoldSchemeBaseSchema])
  .superRefine((data, ctx) => {
    if (data.kind === 'emi') {
      if (data.monthlyAmount > data.totalAmount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Monthly installment cannot exceed total amount',
          path: ['monthlyAmount'],
        });
      }
    } else if (data.kind === 'kuri') {
      if (data.payFromBucketId === data.kuriBucketId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Payment source bucket and Kuri asset bucket must be different',
          path: ['kuriBucketId'],
        });
      }
    } else if (data.kind === 'gold_scheme') {
      if (data.payFromBucketId === data.goldBucketId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Payment source bucket and Gold scheme asset bucket must be different',
          path: ['goldBucketId'],
        });
      }
    }
  });

export type CreateEmiPlanInput = z.infer<typeof createEmiPlanSchema>;
export type CreateKuriPlanInput = z.infer<typeof createKuriPlanSchema>;
export type CreateGoldSchemePlanInput = z.infer<typeof createGoldSchemePlanSchema>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

/* ==========================================================================
   Update & Mutation Schemas
   ========================================================================== */

export const updatePlanSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  note: z.string().trim().max(300).optional(),
  reminderDaysBefore: z.number().int().min(0).max(7).optional(),
  payFromBucketId: objectIdSchema.optional(),
  // Immutable if any payments have been recorded:
  totalAmount: paiseAmountSchema.optional(),
  monthlyAmount: paiseAmountSchema.optional(),
  totalInstallments: z.number().int().min(1).max(120).optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  startDate: isoDateSchema.optional(),
});

export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const payPlanSchema = z.object({
  planId: objectIdSchema,
  amount: paiseAmountSchema.optional(), // Optional override (e.g. for kuri dividend variance)
  date: isoDateSchema.optional(),
  idempotencyKey: z.string().trim().max(100).optional(),
});

export type PayPlanInput = z.infer<typeof payPlanSchema>;

export const kuriPayoutSchema = z
  .object({
    planId: objectIdSchema,
    toBucketId: objectIdSchema.optional(),
    destinationBucketId: objectIdSchema.optional(),
    amount: paiseAmountSchema.optional(), // If omitted, defaults to full kuri balance
    date: isoDateSchema.optional(),
    note: z.string().trim().max(300).optional(),
    idempotencyKey: z.string().trim().max(100).optional(),
  })
  .transform((data) => ({
    ...data,
    toBucketId: (data.toBucketId || data.destinationBucketId) as string,
  }))
  .refine((data) => !!data.toBucketId, {
    message: 'Destination bucket ID is required',
    path: ['toBucketId'],
  });

export type KuriPayoutInput = z.infer<typeof kuriPayoutSchema>;

/* ==========================================================================
   Gold Scheme Bonus & Redeem Schemas
   ========================================================================== */

export const recordBonusSchema = z.object({
  amount: paiseAmountSchema.optional(), // If omitted, defaults to plan.bonusAmount
  date: isoDateSchema.optional(),
  note: z.string().trim().max(300, 'Note cannot exceed 300 characters').optional(),
  idempotencyKey: z.string().trim().max(100).optional(),
});

export type RecordBonusInput = z.infer<typeof recordBonusSchema>;

export const redeemJewellerySchema = z.object({
  option: z.literal('jewellery'),
  amount: paiseAmountSchema,
  date: isoDateSchema.optional(),
  note: z.string().trim().max(300, 'Note cannot exceed 300 characters').optional(),
  idempotencyKey: z.string().trim().max(100).optional(),
});

export const redeemCashRefundSchema = z.object({
  option: z.literal('cash_refund'),
  amount: paiseAmountSchema,
  toBucketId: objectIdSchema,
  date: isoDateSchema.optional(),
  note: z.string().trim().max(300, 'Note cannot exceed 300 characters').optional(),
  idempotencyKey: z.string().trim().max(100).optional(),
});

export const redeemSchema = z.discriminatedUnion('option', [
  redeemJewellerySchema,
  redeemCashRefundSchema,
]);

export type RedeemInput = z.infer<typeof redeemSchema>;

/* ==========================================================================
   Public Plan Representation (DTO)
   ========================================================================== */

export const publicPlanSchema = z.object({
  id: objectIdSchema,
  householdId: objectIdSchema,
  ownerId: objectIdSchema,
  ownerName: z.string().optional(),
  kind: planKindEnum,
  name: z.string(),
  note: z.string().optional(),
  totalAmount: paiseAmountSchema,
  monthlyAmount: paiseAmountSchema,
  totalInstallments: z.number().int().positive(),
  paidInstallments: z.number().int().nonnegative(),
  paidAmount: z.number().int().nonnegative(),
  dueDay: z.number().int().min(1).max(31),
  startDate: isoDateSchema,
  payFromBucketId: objectIdSchema,
  payFromBucketName: z.string().optional(),
  kuriBucketId: objectIdSchema.optional(),
  kuriBucketName: z.string().optional(),
  jewellerName: z.string().optional(),
  bonusAmount: z.number().int().nonnegative().optional(),
  bonusRecorded: z.boolean().optional(),
  goldBucketId: objectIdSchema.optional(),
  goldBucketName: z.string().optional(),
  redeemRecorded: z.boolean().optional(),
  redeemOption: z.enum(['jewellery', 'cash_refund']).optional(),
  reminderDaysBefore: z.number().int().min(0).max(7),
  visibility: visibilityEnum,
  status: planStatusEnum,
  payoutRecorded: z.boolean(),
  completedAt: isoDateSchema.optional(),
  // Derived runtime helpers:
  nextInstallmentNumber: z.number().int().positive().optional(),
  nextInstallmentAmount: z.number().int().positive().optional(),
  nextDueDate: isoDateSchema.optional(),
  remainingAmount: z.number().int().nonnegative(),
  remainingInstallments: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
});

export type PublicPlan = z.infer<typeof publicPlanSchema>;

/* ==========================================================================
   Live Alerts Types
   ========================================================================== */

export const planAlertStatusEnum = z.enum(['due_soon', 'due', 'overdue']);
export type PlanAlertStatus = z.infer<typeof planAlertStatusEnum>;

export interface PlanAlert {
  planId: string;
  planName: string;
  kind: PlanKind;
  dueDate: string; // ISO date
  amountDue: number; // paise
  payFromBucketId: string;
  payFromBucketName: string;
  status: PlanAlertStatus;
  isShortfall: boolean;
  bucketBalance?: number; // Only exposed if viewer has balance visibility
  shortfallAmount?: number; // Only exposed if viewer has balance visibility
  isDismissedToday: boolean;
  isMasked?: boolean;
}

export interface BucketShortfallSummary {
  bucketId: string;
  bucketName: string;
  currentBalance: number; // paise
  totalDueSoonOrOverdue: number; // paise
  shortfall: number; // paise
  plansCount: number;
}

export interface DashboardAlertsResponse {
  alerts: PlanAlert[];
  shortfalls: BucketShortfallSummary[];
  activePlansCount: number;
}

/* ==========================================================================
   Pure Calculation & Date Invariants Functions
   ========================================================================== */

/**
 * Returns number of days in a given year and month (1-indexed month: 1=Jan, 2=Feb, etc.).
 * Correctly accounts for leap years in the Gregorian calendar.
 */
export function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeapYear ? 29 : 28;
  }
  if ([4, 6, 9, 11].includes(month)) {
    return 30;
  }
  return 31;
}

/**
 * Computes total number of installments.
 * For EMI: Math.ceil(totalAmount / monthlyAmount)
 * For Kuri: totalInstallments
 * For Gold Scheme: totalInstallments
 */
export function calculateInstallmentsCount(
  kind: PlanKind,
  totalAmount: number,
  monthlyAmount: number,
  installmentsCount?: number
): number {
  if (kind === 'kuri' || kind === 'gold_scheme') {
    return installmentsCount && installmentsCount > 0 ? installmentsCount : 1;
  }
  if (monthlyAmount <= 0) return 1;
  return Math.ceil(totalAmount / monthlyAmount);
}

/**
 * Computes the amount due for the next installment.
 * For EMI: The last installment is the remaining balance (e.g., total 42,000, monthly 5,000 -> 9th is 2,000).
 * For Kuri: monthlyAmount.
 * For Gold Scheme: monthlyAmount.
 */
export function calculateNextInstallmentAmount(
  kind: PlanKind,
  totalAmount: number,
  monthlyAmount: number,
  paidAmount: number
): number {
  if (kind === 'kuri' || kind === 'gold_scheme') {
    return monthlyAmount;
  }
  const remaining = Math.max(0, totalAmount - paidAmount);
  return Math.min(monthlyAmount, remaining);
}

/**
 * Calculates the next due date in Asia/Kolkata (IST = UTC+05:30) for a given installment number (0-indexed).
 * Clamps dueDay to the last day of the month for shorter months (e.g. Day 31 in Feb -> Feb 28 or 29, April -> Apr 30).
 */
export function calculateNextDueDate(
  startDateStr: string | Date,
  dueDay: number,
  paidInstallments: number
): string {
  const startDate = new Date(startDateStr);
  // Extract Year & Month in IST
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  });
  const [startYearStr, startMonthStr] = formatter.format(startDate).split('-');
  const startYear = parseInt(startYearStr || '2026', 10);
  const startMonth = parseInt(startMonthStr || '1', 10);

  const targetMonthIndex = (startMonth - 1) + paidInstallments;
  const targetYear = startYear + Math.floor(targetMonthIndex / 12);
  const targetMonth = (targetMonthIndex % 12) + 1;

  const maxDays = getDaysInMonth(targetYear, targetMonth);
  const actualDay = Math.min(dueDay, maxDays);

  const pad = (n: number) => String(n).padStart(2, '0');
  // Return start of day in IST (+05:30)
  return `${targetYear}-${pad(targetMonth)}-${pad(actualDay)}T00:00:00.000+05:30`;
}

/**
 * Computes the reminder trigger date given a due date and reminderDaysBefore.
 */
export function calculateReminderDate(dueDateStr: string | Date, reminderDaysBefore: number): string {
  const due = new Date(dueDateStr);
  const reminderTime = due.getTime() - reminderDaysBefore * 24 * 60 * 60 * 1000;
  return new Date(reminderTime).toISOString();
}

/**
 * Computes derived state for an active or completed plan.
 */
export function calculatePlanDerivedState(plan: {
  kind: PlanKind;
  totalAmount: number;
  monthlyAmount: number;
  totalInstallments: number;
  paidAmount: number;
  paidInstallments: number;
  dueDay: number;
  startDate: string | Date;
  status: PlanStatus;
  payoutRecorded?: boolean;
  redeemRecorded?: boolean;
}): {
  remainingAmount: number;
  remainingInstallments: number;
  nextInstallmentNumber: number | undefined;
  nextInstallmentAmount: number | undefined;
  nextDueDate: string | undefined;
  isCompleted: boolean;
} {
  const remainingAmount = Math.max(0, plan.totalAmount - plan.paidAmount);
  const remainingInstallments = Math.max(0, plan.totalInstallments - plan.paidInstallments);

  let isCompleted = false;
  if (plan.kind === 'emi') {
    isCompleted = plan.paidAmount >= plan.totalAmount || plan.paidInstallments >= plan.totalInstallments;
  } else if (plan.kind === 'kuri') {
    isCompleted = plan.paidInstallments >= plan.totalInstallments && Boolean(plan.payoutRecorded);
  } else if (plan.kind === 'gold_scheme') {
    isCompleted = plan.paidInstallments >= plan.totalInstallments && Boolean(plan.redeemRecorded);
  }

  if (isCompleted || plan.status === 'completed' || plan.status === 'cancelled') {
    return {
      remainingAmount: 0,
      remainingInstallments: 0,
      nextInstallmentNumber: undefined,
      nextInstallmentAmount: undefined,
      nextDueDate: undefined,
      isCompleted: true,
    };
  }

  const nextInstallmentNumber = plan.paidInstallments + 1;
  const nextInstallmentAmount = calculateNextInstallmentAmount(
    plan.kind,
    plan.totalAmount,
    plan.monthlyAmount,
    plan.paidAmount
  );
  const nextDueDate = calculateNextDueDate(plan.startDate, plan.dueDay, plan.paidInstallments);

  return {
    remainingAmount,
    remainingInstallments,
    nextInstallmentNumber,
    nextInstallmentAmount,
    nextDueDate,
    isCompleted,
  };
}
