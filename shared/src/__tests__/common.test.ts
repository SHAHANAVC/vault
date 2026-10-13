import {
  paiseAmountSchema,
  nonNegativePaiseSchema,
  signedPaiseSchema,
  objectIdSchema,
  isoDateSchema,
  rupeesToPaise,
  paiseToRupees,
  formatINR,
  formatLocalDateTimeForInput,
  formatDateTime,
} from '../common';

describe('Common Schemas & Monetary Helpers', () => {
  describe('paiseAmountSchema', () => {
    it('accepts positive whole integer paise', () => {
      expect(paiseAmountSchema.safeParse(1).success).toBe(true);
      expect(paiseAmountSchema.safeParse(100).success).toBe(true);
      expect(paiseAmountSchema.safeParse(25050).success).toBe(true);
    });

    it('rejects 0 paise (transactions must be greater than 0)', () => {
      const res = paiseAmountSchema.safeParse(0);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(/greater than 0 paise/i);
      }
    });

    it('rejects negative numbers', () => {
      const res = paiseAmountSchema.safeParse(-500);
      expect(res.success).toBe(false);
    });

    it('strictly rejects floating-point numbers (Zero Float Tolerance)', () => {
      const res1 = paiseAmountSchema.safeParse(10.5);
      expect(res1.success).toBe(false);
      if (!res1.success) {
        expect(res1.error.issues[0]?.message).toMatch(/whole integer/i);
      }

      const res2 = paiseAmountSchema.safeParse(250.5);
      expect(res2.success).toBe(false);
    });

    it('enforces safe integer limits', () => {
      expect(paiseAmountSchema.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
      expect(paiseAmountSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(
        false
      );
    });
  });

  describe('nonNegativePaiseSchema', () => {
    it('accepts 0 paise as valid', () => {
      expect(nonNegativePaiseSchema.safeParse(0).success).toBe(true);
    });

    it('accepts positive integers', () => {
      expect(nonNegativePaiseSchema.safeParse(50000).success).toBe(true);
    });

    it('rejects negative numbers', () => {
      expect(nonNegativePaiseSchema.safeParse(-1).success).toBe(false);
    });
  });

  describe('signedPaiseSchema', () => {
    it('accepts both positive and negative integer paise', () => {
      expect(signedPaiseSchema.safeParse(500).success).toBe(true);
      expect(signedPaiseSchema.safeParse(-500).success).toBe(true);
    });

    it('rejects 0 (adjustments must represent an actual change)', () => {
      const res = signedPaiseSchema.safeParse(0);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(/cannot be zero/i);
      }
    });

    it('rejects float adjustments', () => {
      expect(signedPaiseSchema.safeParse(10.5).success).toBe(false);
      expect(signedPaiseSchema.safeParse(-10.5).success).toBe(false);
    });
  });

  describe('objectIdSchema', () => {
    it('accepts valid 24-character hexadecimal MongoDB ObjectIds', () => {
      expect(objectIdSchema.safeParse('507f1f77bcf86cd799439011').success).toBe(true);
      expect(objectIdSchema.safeParse('64b8f0a2c89e1a2b3c4d5e6f').success).toBe(true);
    });

    it('rejects invalid lengths or non-hex characters', () => {
      expect(objectIdSchema.safeParse('not-an-id').success).toBe(false);
      expect(objectIdSchema.safeParse('507f1f77bcf86cd79943901').success).toBe(false); // 23 chars
      expect(objectIdSchema.safeParse('507f1f77bcf86cd7994390111').success).toBe(false); // 25 chars
      expect(objectIdSchema.safeParse('507f1f77bcf86cd79943901z').success).toBe(false); // invalid 'z'
    });
  });

  describe('isoDateSchema', () => {
    it('accepts valid ISO 8601 UTC date strings', () => {
      expect(isoDateSchema.safeParse('2026-10-06T14:30:00.000Z').success).toBe(true);
    });

    it('rejects arbitrary date strings or numbers', () => {
      expect(isoDateSchema.safeParse('06/10/2026').success).toBe(false);
      expect(isoDateSchema.safeParse('yesterday').success).toBe(false);
    });
  });

  describe('Financial Rounding & Formatting Helpers', () => {
    it('rupeesToPaise handles float drift safely (e.g. 100.10 -> 10010)', () => {
      expect(rupeesToPaise(100.1)).toBe(10010);
      expect(rupeesToPaise('100.10')).toBe(10010);
      expect(rupeesToPaise(250.5)).toBe(25050);
      expect(rupeesToPaise(0.01)).toBe(1);
    });

    it('rupeesToPaise throws on invalid rupee values', () => {
      expect(() => rupeesToPaise('invalid')).toThrow(/Invalid rupee value/);
      expect(() => rupeesToPaise('100.10abc')).toThrow(/Invalid rupee value/);
      expect(() => rupeesToPaise(NaN)).toThrow(/Invalid rupee value/);
    });

    it('paiseToRupees converts integer paise to decimal rupees', () => {
      expect(paiseToRupees(10010)).toBe(100.1);
      expect(paiseToRupees(25050)).toBe(250.5);
      expect(paiseToRupees(0)).toBe(0);
    });

    it('paiseToRupees throws on non-integer paise', () => {
      expect(() => paiseToRupees(100.5)).toThrow(/must be an integer/);
    });

    it('formatINR formats into Indian Rupee presentation format', () => {
      const formatted = formatINR(25000000); // 2.5 Lakhs
      const normalized = formatted.replace(/\u00A0/g, ' ');
      expect(normalized).toContain('2,50,000.00');
      expect(normalized).toContain('₹');
    });

    it('formatLocalDateTimeForInput formats a date into YYYY-MM-DDTHH:mm representation', () => {
      const fixedDate = new Date(2026, 9, 13, 14, 30); // 13 Oct 2026, 14:30
      expect(formatLocalDateTimeForInput(fixedDate)).toBe('2026-10-13T14:30');
    });

    it('formatDateTime formats a date into Indian presentation string', () => {
      const fixedDate = new Date(2026, 9, 13, 14, 30);
      const formatted = formatDateTime(fixedDate);
      expect(formatted).toContain('13');
      expect(formatted).toContain('Oct');
      expect(formatted).toContain('2026');
    });
  });
});
