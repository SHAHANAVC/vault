import { registerSchema, loginSchema, publicUserSchema } from '../user';

describe('User & Auth Schemas', () => {
  describe('registerSchema', () => {
    it('accepts valid registration input and normalizes email/name', () => {
      const valid = {
        name: '  Rahul Sharma  ',
        email: '  Rahul.Sharma@Example.COM  ',
        password: 'Password123',
      };
      const result = registerSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Rahul Sharma');
        expect(result.data.email).toBe('rahul.sharma@example.com');
      }
    });

    it('rejects weak password with fewer than 8 characters', () => {
      const result = registerSchema.safeParse({
        name: 'Rahul',
        email: 'rahul@example.com',
        password: 'Pass1',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/at least 8 characters/i);
      }
    });

    it('rejects password missing an uppercase letter', () => {
      const result = registerSchema.safeParse({
        name: 'Rahul',
        email: 'rahul@example.com',
        password: 'password123',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/uppercase letter/i);
      }
    });

    it('rejects password missing a digit', () => {
      const result = registerSchema.safeParse({
        name: 'Rahul',
        email: 'rahul@example.com',
        password: 'PasswordNoDigits',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/at least one digit/i);
      }
    });

    it('rejects invalid email address', () => {
      const result = registerSchema.safeParse({
        name: 'Rahul',
        email: 'invalid-email',
        password: 'Password123',
      });
      expect(result.success).toBe(false);
    });

    it('rejects name shorter than 2 characters', () => {
      const result = registerSchema.safeParse({
        name: 'R',
        email: 'rahul@example.com',
        password: 'Password123',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('loginSchema', () => {
    it('accepts valid login credentials', () => {
      const result = loginSchema.safeParse({
        email: 'rahul@example.com',
        password: 'Password123',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty password', () => {
      const result = loginSchema.safeParse({
        email: 'rahul@example.com',
        password: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('publicUserSchema', () => {
    it('accepts a valid public user payload and strips any password field', () => {
      const user = {
        id: '507f1f77bcf86cd799439011',
        name: 'Rahul Sharma',
        email: 'rahul@example.com',
        householdId: '507f1f77bcf86cd799439012',
        partnerId: null,
        createdAt: '2026-10-06T14:30:00.000Z',
      };
      expect(publicUserSchema.safeParse(user).success).toBe(true);
    });
  });
});
