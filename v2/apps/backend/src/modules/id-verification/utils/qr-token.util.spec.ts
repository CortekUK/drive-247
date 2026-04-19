import { describe, it, expect } from 'vitest';
import {
  generateToken,
  hashToken,
  isExpired,
  tokensMatch,
} from './qr-token.util';

describe('qr-token.util', () => {
  describe('generateToken', () => {
    it('produces unique raw tokens on each call', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const { raw } = generateToken();
        expect(seen.has(raw)).toBe(false);
        seen.add(raw);
      }
    });

    it('produces base64url-encoded raw tokens (no + / = chars)', () => {
      const { raw } = generateToken();
      expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('hash is deterministic — same raw → same hash', () => {
      const { raw, hash } = generateToken();
      expect(hashToken(raw)).toBe(hash);
    });

    it('different raw tokens produce different hashes', () => {
      const a = generateToken();
      const b = generateToken();
      expect(a.hash).not.toBe(b.hash);
    });

    it('hash is NOT the raw token (never leak)', () => {
      const { raw, hash } = generateToken();
      expect(hash).not.toBe(raw);
    });
  });

  describe('tokensMatch', () => {
    it('returns true for identical hashes', () => {
      const hash = hashToken('whatever');
      expect(tokensMatch(hash, hash)).toBe(true);
    });

    it('returns false for different hashes', () => {
      expect(tokensMatch(hashToken('a'), hashToken('b'))).toBe(false);
    });

    it('returns false for different-length inputs (no throw)', () => {
      expect(tokensMatch('short', 'muchlongerstring')).toBe(false);
    });
  });

  describe('isExpired', () => {
    it('returns true when expiry is in the past', () => {
      const past = new Date(Date.now() - 1000);
      expect(isExpired(past)).toBe(true);
    });

    it('returns false when expiry is in the future', () => {
      const future = new Date(Date.now() + 60_000);
      expect(isExpired(future)).toBe(false);
    });

    it('treats the exact expiry moment as expired (<=)', () => {
      const now = new Date();
      expect(isExpired(now, now)).toBe(true);
    });
  });
});
