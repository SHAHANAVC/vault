import { z } from 'zod';
import { objectIdSchema, isoDateSchema } from './common';

/**
 * User & Authentication Schemas
 */

/**
 * Strong password rule:
 * - At least 8 characters
 * - At least 1 lowercase letter
 * - At least 1 uppercase letter
 * - At least 1 number
 */
const passwordValidation = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(100, 'Password must not exceed 100 characters')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit');

export const registerSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name must not exceed 50 characters'),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  password: passwordValidation,
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password cannot be empty'),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Public User Data Type:
 * Strictly safe to expose in API responses and frontend state.
 * Never includes passwordHash or sensitive credentials.
 */
export const publicUserSchema = z.object({
  id: objectIdSchema,
  name: z.string().min(2).max(50),
  email: z.string().email(),
  householdId: objectIdSchema,
  partnerId: objectIdSchema.nullable().optional(),
  createdAt: isoDateSchema,
});

export type PublicUser = z.infer<typeof publicUserSchema>;
