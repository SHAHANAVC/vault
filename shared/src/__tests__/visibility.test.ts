import { canViewerSee, visibilityEnum } from '../visibility';

describe('Visibility & Privacy Levels', () => {
  describe('visibilityEnum', () => {
    it('accepts shared, balance_only, private', () => {
      expect(visibilityEnum.safeParse('shared').success).toBe(true);
      expect(visibilityEnum.safeParse('balance_only').success).toBe(true);
      expect(visibilityEnum.safeParse('private').success).toBe(true);
    });

    it('rejects invalid visibility options', () => {
      expect(visibilityEnum.safeParse('hidden').success).toBe(false);
      expect(visibilityEnum.safeParse('public').success).toBe(false);
    });
  });

  describe('canViewerSee (Pure Access Matrix)', () => {
    describe('When viewer IS the bucket owner (isOwner = true)', () => {
      it('owner sees 100% of their shared bucket', () => {
        expect(canViewerSee('shared', true)).toEqual({
          bucket: true,
          balance: true,
          transactions: true,
        });
      });

      it('owner sees 100% of their balance_only bucket', () => {
        expect(canViewerSee('balance_only', true)).toEqual({
          bucket: true,
          balance: true,
          transactions: true,
        });
      });

      it('owner sees 100% of their private bucket', () => {
        expect(canViewerSee('private', true)).toEqual({
          bucket: true,
          balance: true,
          transactions: true,
        });
      });
    });

    describe('When viewer IS the partner (isOwner = false)', () => {
      it('Outcome 1: "shared" grants partner full visibility', () => {
        expect(canViewerSee('shared', false)).toEqual({
          bucket: true,
          balance: true,
          transactions: true,
        });
      });

      it('Outcome 2: "balance_only" grants partner bucket + balance ONLY (0 transactions/details)', () => {
        expect(canViewerSee('balance_only', false)).toEqual({
          bucket: true,
          balance: true,
          transactions: false,
        });
      });

      it('Outcome 3: "private" completely hides bucket from partner (0 visibility)', () => {
        expect(canViewerSee('private', false)).toEqual({
          bucket: false,
          balance: false,
          transactions: false,
        });
      });
    });
  });
});
