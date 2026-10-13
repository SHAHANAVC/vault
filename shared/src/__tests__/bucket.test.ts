import { createBucketSchema, updateBucketSchema, bucketTypeEnum } from '../bucket';

describe('Bucket Schemas', () => {
  describe('bucketTypeEnum', () => {
    it('accepts all 5 domain bucket types', () => {
      expect(bucketTypeEnum.safeParse('cash').success).toBe(true);
      expect(bucketTypeEnum.safeParse('bank').success).toBe(true);
      expect(bucketTypeEnum.safeParse('kuri').success).toBe(true);
      expect(bucketTypeEnum.safeParse('loan_given').success).toBe(true);
      expect(bucketTypeEnum.safeParse('loan_taken').success).toBe(true);
    });

    it('rejects unsupported bucket types', () => {
      expect(bucketTypeEnum.safeParse('crypto').success).toBe(false);
      expect(bucketTypeEnum.safeParse('stocks').success).toBe(false);
    });
  });

  describe('createBucketSchema', () => {
    it('accepts valid bucket creation payload', () => {
      const valid = {
        name: 'SBI Salary Account',
        type: 'bank',
        visibility: 'shared',
        description: 'Primary joint household account',
      };
      const res = createBucketSchema.safeParse(valid);
      expect(res.success).toBe(true);
    });

    it('rejects empty bucket name', () => {
      const res = createBucketSchema.safeParse({
        name: '   ',
        type: 'cash',
        visibility: 'shared',
      });
      expect(res.success).toBe(false);
    });

    it('CRITICAL RULE: balance is NOT in createBucketSchema input', () => {
      // Even if a client sends a balance, Zod strips it out because balance changes only via transactions
      const inputWithBalance = {
        name: 'Emergency Cash',
        type: 'cash',
        visibility: 'private',
        balance: 500000,
      };
      const res = createBucketSchema.safeParse(inputWithBalance);
      expect(res.success).toBe(true);
      if (res.success) {
        expect((res.data as Record<string, unknown>)['balance']).toBeUndefined();
      }
    });
  });

  describe('updateBucketSchema', () => {
    it('allows updating name, visibility, and isArchived', () => {
      const validUpdate = {
        name: 'Renamed SBI Account',
        isArchived: true,
        visibility: 'balance_only',
      };
      expect(updateBucketSchema.safeParse(validUpdate).success).toBe(true);
    });

    it('CRITICAL RULE: balance is NOT in updateBucketSchema input', () => {
      const updateWithBalance = {
        balance: 999999,
      };
      const res = updateBucketSchema.safeParse(updateWithBalance);
      expect(res.success).toBe(true);
      if (res.success) {
        expect((res.data as Record<string, unknown>)['balance']).toBeUndefined();
      }
    });
  });
});
