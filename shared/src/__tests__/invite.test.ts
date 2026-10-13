import { inviteStatusEnum, createInviteSchema, acceptInviteSchema } from '../invite';

describe('Partner Invite Schemas', () => {
  describe('inviteStatusEnum', () => {
    it('accepts valid statuses: pending, accepted, expired', () => {
      expect(inviteStatusEnum.safeParse('pending').success).toBe(true);
      expect(inviteStatusEnum.safeParse('accepted').success).toBe(true);
      expect(inviteStatusEnum.safeParse('expired').success).toBe(true);
    });

    it('rejects unexpected status values', () => {
      expect(inviteStatusEnum.safeParse('cancelled').success).toBe(false);
      expect(inviteStatusEnum.safeParse('active').success).toBe(false);
    });
  });

  describe('createInviteSchema', () => {
    it('accepts default or specified expiresInDays between 1 and 30', () => {
      expect(createInviteSchema.safeParse({}).success).toBe(true);
      expect(createInviteSchema.safeParse({ expiresInDays: 14 }).success).toBe(true);
      expect(createInviteSchema.safeParse({ expiresInDays: 0 }).success).toBe(false);
      expect(createInviteSchema.safeParse({ expiresInDays: 31 }).success).toBe(false);
    });
  });

  describe('acceptInviteSchema', () => {
    it('accepts valid token of at least 16 characters', () => {
      const valid = { token: 'a1b2c3d4e5f6g7h8i9j0' };
      expect(acceptInviteSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects short tokens (< 16 chars)', () => {
      const short = { token: 'too-short' };
      const res = acceptInviteSchema.safeParse(short);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(/at least 16 characters/i);
      }
    });
  });
});
