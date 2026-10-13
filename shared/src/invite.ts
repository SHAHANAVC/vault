import { z } from 'zod';
import { objectIdSchema, isoDateSchema } from './common';

/**
 * Partner Invite Schemas
 * Partner joins exclusively by single-use invite link (WhatsApp share).
 * No join code, no group screen.
 */

export const inviteStatusEnum = z.enum(['pending', 'accepted', 'expired']);
export type InviteStatus = z.infer<typeof inviteStatusEnum>;

/**
 * Schema for creating a new partner invitation.
 * Backend creates token automatically; optionally accepts custom expiration in days (1-30).
 */
export const createInviteSchema = z.object({
  expiresInDays: z
    .number()
    .int()
    .min(1, 'Expiration must be at least 1 day')
    .max(30, 'Expiration cannot exceed 30 days')
    .default(7),
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;

/**
 * Schema for accepting an invitation link.
 * Token is a secure cryptographic hex/uuid string passed via URL query or payload.
 */
export const acceptInviteSchema = z.object({
  token: z
    .string({ required_error: 'Invite token is required' })
    .trim()
    .min(16, 'Invite token must be at least 16 characters')
    .max(128, 'Invite token is too long'),
});

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

/**
 * Stored Invite Record Schema
 */
export const inviteSchema = z.object({
  id: objectIdSchema,
  householdId: objectIdSchema,
  invitedBy: objectIdSchema,
  token: z.string(),
  status: inviteStatusEnum,
  expiresAt: isoDateSchema,
  createdAt: isoDateSchema,
});

export type Invite = z.infer<typeof inviteSchema>;
