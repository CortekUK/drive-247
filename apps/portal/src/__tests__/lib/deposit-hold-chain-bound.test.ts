/**
 * resolveChainBound — the ceiling that stops a deposit chain re-authorising
 * a renter's card forever.
 *
 * THE INCIDENT THIS PREVENTS
 * `deposit_hold_chain_expires_at` is stamped by place-deposit-hold, but THREE
 * paths mint a 'held' row without it (sync-deposit-hold, the webhook
 * auto-placement, and every row written before the column existed). Rule 2 used
 * to read a NULL cache as "no ceiling" — so those rows had NO bound at all and
 * the engine would keep minting a fresh authorization every few days, weeks
 * after the car came back. Measured on production the day this changed: 4 of 4
 * live holds were unbounded, two of them on rentals ending within 24 hours.
 *
 * The fix SEEDS the bound from the rental's live end_date when the cache is
 * NULL, floored at now + grace. Both halves are load-bearing and are asserted
 * separately below:
 *   - without the seed, an unstamped hold is immortal;
 *   - without the floor, a hold placed onto an ALREADY-ENDED rental (routine:
 *     staff take a deposit late on an overdue booking) is born expired and dies
 *     at its first link, silently.
 *
 * WHAT IS REAL HERE
 * `resolveChainBound` and `chainExpiryFromEndDate` are LIFTED from the edge
 * source and executed, so these assertions run the same code the cron runs.
 */

import { describe, it, expect } from 'vitest';
import { readEdgeSource, liftDeclaration, compile } from '../helpers/edge-source';

const engine = readEdgeSource('_shared/deposit-hold-refresh.ts');
const stripeClient = readEdgeSource('_shared/stripe-client.ts');

const GRACE_DAYS = Number(
  /export const CHAIN_GRACE_DAYS_AFTER_END = (\d+)/.exec(stripeClient)![1],
);

interface ChainBound {
  effective: string | null;
  stored: string | null;
  live: string | null;
  stale: boolean;
  expired: boolean;
}

const resolveChainBound = compile<
  (rental: Record<string, unknown>, now?: Date) => ChainBound
>(
  [
    `const CHAIN_GRACE_DAYS_AFTER_END = ${GRACE_DAYS};`,
    liftDeclaration(stripeClient, 'chainExpiryFromEndDate'),
    liftDeclaration(engine, 'resolveChainBound'),
  ],
  'resolveChainBound',
);

const NOW = new Date('2026-08-11T12:00:00.000Z');
const dayOffset = (days: number) =>
  new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10);
const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);

describe('resolveChainBound', () => {
  describe('the grace constant is shared, not re-declared', () => {
    it('reads CHAIN_GRACE_DAYS_AFTER_END from _shared/stripe-client.ts', () => {
      expect(GRACE_DAYS).toBeGreaterThan(0);
      // deposit-hold-refresh must IMPORT it, never redefine it — two
      // derivations of the same window would drift apart silently.
      expect(engine).toMatch(/CHAIN_GRACE_DAYS_AFTER_END,/);
      expect(engine).not.toMatch(/const CHAIN_GRACE_DAYS_AFTER_END\s*=/);
    });
  });

  describe('open-ended rentals keep no ceiling', () => {
    it('returns no ceiling when end_date is NULL and nothing is stored', () => {
      const b = resolveChainBound(
        { end_date: null, deposit_hold_chain_expires_at: null },
        NOW,
      );
      expect(b.effective).toBeNull();
      expect(b.expired).toBe(false);
    });

    it('returns no ceiling when end_date is unparseable', () => {
      const b = resolveChainBound(
        { end_date: 'not-a-date', deposit_hold_chain_expires_at: null },
        NOW,
      );
      expect(b.effective).toBeNull();
    });
  });

  describe('a NULL cache SEEDS from the live end_date (the unbounded-chain fix)', () => {
    it('no longer returns "no ceiling" for an unstamped hold', () => {
      const b = resolveChainBound(
        { end_date: dayOffset(10), deposit_hold_chain_expires_at: null },
        NOW,
      );
      expect(b.effective).not.toBeNull();
      expect(b.stored).toBeNull();
      expect(b.stale).toBe(true); // so the caller persists it under the claim CAS
    });

    it('seeds to the end_date plus the grace window', () => {
      const endDate = dayOffset(10);
      const b = resolveChainBound(
        { end_date: endDate, deposit_hold_chain_expires_at: null },
        NOW,
      );
      // Bound must land AFTER the rental ends, by roughly the grace window.
      expect(ms(b.effective)).toBeGreaterThan(new Date(`${endDate}T00:00:00Z`).getTime());
      expect(ms(b.effective)).toBeLessThanOrEqual(
        new Date(`${endDate}T23:59:59.999Z`).getTime() + GRACE_DAYS * 86_400_000,
      );
    });

    it('a seeded bound is never born already expired', () => {
      const b = resolveChainBound(
        { end_date: dayOffset(10), deposit_hold_chain_expires_at: null },
        NOW,
      );
      expect(b.expired).toBe(false);
    });
  });

  describe('the floor protects holds placed onto already-ended rentals', () => {
    it('does not kill a hold whose rental ended weeks ago', () => {
      // Staff take a deposit late on an overdue booking. Without the floor this
      // row would be born expired and die at its very first link.
      const b = resolveChainBound(
        { end_date: dayOffset(-30), deposit_hold_chain_expires_at: null },
        NOW,
      );
      expect(b.expired).toBe(false);
      expect(ms(b.effective)).toBeGreaterThan(NOW.getTime());
    });

    it('floors the bound at now + grace, not at the stale end date', () => {
      const b = resolveChainBound(
        { end_date: dayOffset(-30), deposit_hold_chain_expires_at: null },
        NOW,
      );
      expect(ms(b.effective)).toBe(NOW.getTime() + GRACE_DAYS * 86_400_000);
    });

    it('still bounds it — the floor is a reprieve, not immortality', () => {
      const b = resolveChainBound(
        { end_date: dayOffset(-30), deposit_hold_chain_expires_at: null },
        NOW,
      );
      expect(b.effective).not.toBeNull();
      // And once persisted, Rule 1 governs and it does expire on schedule.
      const later = new Date(ms(b.effective) + 1000);
      const after = resolveChainBound(
        { end_date: dayOffset(-30), deposit_hold_chain_expires_at: b.effective },
        later,
      );
      expect(after.expired).toBe(true);
    });
  });

  describe('Rule 1 — later of the two — is unchanged', () => {
    it('keeps the stored bound when it is later than the live derivation', () => {
      const stored = new Date(NOW.getTime() + 40 * 86_400_000).toISOString();
      const b = resolveChainBound(
        { end_date: dayOffset(1), deposit_hold_chain_expires_at: stored },
        NOW,
      );
      expect(b.effective).toBe(stored);
      expect(b.stale).toBe(false);
    });

    it('moves the bound OUT when the rental is extended', () => {
      const stored = new Date(NOW.getTime() + 2 * 86_400_000).toISOString();
      const b = resolveChainBound(
        { end_date: dayOffset(40), deposit_hold_chain_expires_at: stored },
        NOW,
      );
      expect(ms(b.effective)).toBeGreaterThan(ms(stored));
      expect(b.stale).toBe(true);
    });

    it('expires once the later of the two has genuinely passed', () => {
      const past = new Date(NOW.getTime() - 86_400_000).toISOString();
      const b = resolveChainBound(
        { end_date: dayOffset(-10), deposit_hold_chain_expires_at: past },
        NOW,
      );
      expect(b.expired).toBe(true);
    });
  });

  describe('an unselected end_date column is not the same fact as a NULL one', () => {
    it('falls back to the stored cache alone when end_date was not selected', () => {
      const stored = new Date(NOW.getTime() + 5 * 86_400_000).toISOString();
      const b = resolveChainBound({ deposit_hold_chain_expires_at: stored }, NOW);
      expect(b.effective).toBe(stored);
    });

    it('does NOT seed from a column the caller never asked for', () => {
      // Seeding here would invent a ceiling from information we do not have.
      const b = resolveChainBound({ deposit_hold_chain_expires_at: null }, NOW);
      expect(b.effective).toBeNull();
    });
  });
});
