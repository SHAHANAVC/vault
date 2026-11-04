import { z } from 'zod';
import { isoDateSchema } from './common';
import { visibilityEnum } from './visibility';

/**
 * Validates international / Indian phone format (10-15 digits with optional leading +)
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+?[0-9]{1,4}[\s-]?)?[0-9]{10}$/, 'Phone number must be a valid 10-digit number or international format')
  .optional()
  .or(z.literal(''));

export const createPartySchema = z.object({
  name: z
    .string({ required_error: 'Party name is required' })
    .trim()
    .min(1, 'Party name cannot be empty')
    .max(100, 'Party name cannot exceed 100 characters'),
  phone: phoneSchema,
  note: z.string().trim().max(300, 'Note cannot exceed 300 characters').optional().or(z.literal('')),
  visibility: visibilityEnum.default('shared'),
});

export type CreatePartyInput = z.infer<typeof createPartySchema>;

export const updatePartySchema = z.object({
  name: z.string().trim().min(1, 'Party name cannot be empty').max(100).optional(),
  phone: phoneSchema,
  note: z.string().trim().max(300).optional().or(z.literal('')),
  visibility: visibilityEnum.optional(),
});

export type UpdatePartyInput = z.infer<typeof updatePartySchema>;

export const publicPartySchema = z.object({
  id: z.string(),
  householdId: z.string(),
  ownerId: z.string(),
  ownerName: z.string().optional(),
  name: z.string(),
  phone: z.string().optional(),
  note: z.string().optional(),
  visibility: visibilityEnum,
  isArchived: z.boolean(),
  loanGivenOutstanding: z.number().int().nonnegative(),
  loanTakenOutstanding: z.number().int().nonnegative(),
  netBalance: z.number().int(),
  totalLent: z.number().int().nonnegative(),
  totalRepaidToMe: z.number().int().nonnegative(),
  totalBorrowed: z.number().int().nonnegative(),
  totalRepaidByMe: z.number().int().nonnegative(),
  lastActivityDate: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type PublicParty = z.infer<typeof publicPartySchema>;
