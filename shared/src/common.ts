import { z } from 'zod';

/**
 * Common Zod Schemas & Financial Arithmetic Helpers
 */

/**
 * 24-character hexadecimal MongoDB ObjectId string validator
 */
export const objectIdSchema = z
  .string({
    required_error: 'ID is required',
    invalid_type_error: 'ID must be a string',
  })
  .regex(
    /^[0-9a-fA-F]{24}$/,
    'Invalid ObjectId format: must be a 24-character hex string'
  );

export type ObjectIdString = z.infer<typeof objectIdSchema>;

/**
 * Standard ISO 8601 date string validator (e.g. "2026-10-06T14:30:00.000Z")
 */
export const isoDateSchema = z
  .string({
    required_error: 'Date is required',
    invalid_type_error: 'Date must be a string',
  })
  .datetime({ message: 'Invalid date format: must be an ISO 8601 string' });

export type ISODateString = z.infer<typeof isoDateSchema>;

/**
 * Fundamental Financial Rule:
 * All transactions must have a positive, non-zero whole integer paise amount.
 * 1 INR = 100 paise (e.g. ₹250.50 -> 25050 paise).
 */
export const paiseAmountSchema = z
  .number({
    required_error: 'Amount is required',
    invalid_type_error: 'Amount must be a number',
  })
  .int('Amount in paise must be a whole integer (zero float tolerance)')
  .positive('Amount must be greater than 0 paise')
  .max(Number.MAX_SAFE_INTEGER, 'Amount must be a safe integer');

export type PaiseAmount = z.infer<typeof paiseAmountSchema>;

/**
 * Non-negative paise amount (for bucket balances or running totals which can be 0).
 */
export const nonNegativePaiseSchema = z
  .number({
    required_error: 'Amount is required',
    invalid_type_error: 'Amount must be a number',
  })
  .int('Amount in paise must be a whole integer')
  .nonnegative('Amount cannot be negative')
  .max(Number.MAX_SAFE_INTEGER, 'Amount must be a safe integer');

export type NonNegativePaise = z.infer<typeof nonNegativePaiseSchema>;

/**
 * Signed paise amount (specifically for ledger adjustments which can be positive or negative, but never 0).
 */
export const signedPaiseSchema = z
  .number({
    required_error: 'Adjustment amount is required',
    invalid_type_error: 'Adjustment amount must be a number',
  })
  .int('Adjustment amount in paise must be a whole integer')
  .min(-Number.MAX_SAFE_INTEGER, 'Adjustment amount exceeds minimum safe integer')
  .max(Number.MAX_SAFE_INTEGER, 'Adjustment amount exceeds maximum safe integer')
  .refine((val) => val !== 0, {
    message: 'Adjustment amount cannot be zero (must be positive or negative paise)',
  });

export type SignedPaise = z.infer<typeof signedPaiseSchema>;

/**
 * Health check response schema
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  timestamp: z.string(),
  uptimeSeconds: z.number(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * Converts a rupee decimal input (e.g. from user form "100.10" or 100.1) into integer paise (10010).
 * Prevents IEEE 754 float drift quirks (e.g., 100.10 * 100 becoming 10010.000000000002) using Math.round.
 */
export function rupeesToPaise(rupees: number | string): number {
  let num: number;
  if (typeof rupees === 'string') {
    const trimmed = rupees.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error(`Invalid rupee value: "${rupees}"`);
    }
    num = parseFloat(trimmed);
  } else {
    num = rupees;
  }
  if (isNaN(num) || !isFinite(num)) {
    throw new Error(`Invalid rupee value: "${rupees}"`);
  }
  return Math.round(num * 100);
}

/**
 * Converts integer paise back to rupees as a standard number for calculations if needed.
 */
export function paiseToRupees(paise: number): number {
  if (!Number.isInteger(paise)) {
    throw new Error(`Paise must be an integer, received: ${paise}`);
  }
  return paise / 100;
}

/**
 * Formats integer paise to an Indian Rupee string (e.g., 25050 paise -> "₹250.50" or 25000000 -> "₹2,50,000.00").
 * This must strictly be called at the presentation layer (UI).
 */
export function formatINR(paise: number): string {
  const safePaise = Number.isInteger(paise) ? paise : Math.round(paise);
  const rupees = safePaise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Alias for backward compatibility with Phase 0
 */
export const formatPaiseToINR = formatINR;

/**
 * Returns the given (or current) local date and time formatted for HTML datetime-local inputs (YYYY-MM-DDTHH:mm).
 * Avoids the UTC offset trap of `new Date().toISOString().slice(0, 16)`.
 */
export function formatLocalDateTimeForInput(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Formats a transaction date into Indian format with date and 12-hour time (e.g. "13 Oct 2026, 12:36 PM").
 */
export function formatDateTime(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}
