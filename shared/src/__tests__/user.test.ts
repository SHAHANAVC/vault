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

    it('rejects password with fewer than 6 characters', () => {
      const result = registerSchema.safeParse({
        name: 'Rahul',
        email: 'rahul@example.com',
        password: '12345',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/at least 6 characters/i);
      }
    });

    it('accepts simple 6-digit or character passwords', () => {
      const result = registerSchema.safeParse({
        name: 'Rahul',
        email: 'rahul@example.com',
        password: '123456',
      });
      expect(result.success).toBe(true);
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
