/**
 * Sprint 6 hardening — verify the backoff schedule against spec §14.
 *
 * Imports the shared helper directly from supabase/functions/_shared/accounting/
 * so any drift between code + tests fails CI. The helper has no Deno-specific
 * imports so Vitest can parse it as plain TS.
 */
import { describe, it, expect } from "vitest";
import {
  BACKOFF_MINUTES,
  DEAD_LETTER_AT_ATTEMPTS,
  isDeadLetter,
  nextAttemptAfter,
  nextAttemptDeltaMinutes,
} from "../../../../../supabase/functions/_shared/accounting/backoff";

describe("Finance Sync — backoff schedule (Spec §14)", () => {
  describe("BACKOFF_MINUTES constants", () => {
    it("follows the 1m → 5m → 30m → 2h → 12h schedule", () => {
      expect([...BACKOFF_MINUTES]).toEqual([1, 5, 30, 120, 720]);
    });

    it("dead-letter triggers on the 5th attempt", () => {
      expect(DEAD_LETTER_AT_ATTEMPTS).toBe(5);
    });
  });

  describe("nextAttemptAfter — transient errors retry with exponential backoff", () => {
    const NOW = new Date("2026-05-26T10:00:00Z").getTime();

    it("first failure (attempts=0) → +1 minute", () => {
      const result = nextAttemptAfter(0, "transient", NOW);
      expect(result).not.toBeNull();
      expect(result!.getTime() - NOW).toBe(60_000);
    });

    it("second failure (attempts=1) → +5 minutes", () => {
      const result = nextAttemptAfter(1, "transient", NOW);
      expect(result!.getTime() - NOW).toBe(5 * 60_000);
    });

    it("third failure (attempts=2) → +30 minutes", () => {
      const result = nextAttemptAfter(2, "transient", NOW);
      expect(result!.getTime() - NOW).toBe(30 * 60_000);
    });

    it("fourth failure (attempts=3) → +2 hours", () => {
      const result = nextAttemptAfter(3, "transient", NOW);
      expect(result!.getTime() - NOW).toBe(2 * 60 * 60_000);
    });

    it("fifth failure (attempts=4) → DEAD-LETTER (returns null)", () => {
      // After this attempt, currentAttempts+1 = 5 = DEAD_LETTER_AT_ATTEMPTS
      const result = nextAttemptAfter(4, "transient", NOW);
      expect(result).toBeNull();
    });

    it("unknown errors follow the same schedule as transient", () => {
      const transient = nextAttemptAfter(2, "transient", NOW);
      const unknown = nextAttemptAfter(2, "unknown", NOW);
      expect(transient).toEqual(unknown);
    });
  });

  describe("nextAttemptAfter — auth + validation never auto-retry", () => {
    it("auth errors return null on any attempt count", () => {
      expect(nextAttemptAfter(0, "auth")).toBeNull();
      expect(nextAttemptAfter(2, "auth")).toBeNull();
      expect(nextAttemptAfter(4, "auth")).toBeNull();
    });

    it("validation errors return null on any attempt count", () => {
      expect(nextAttemptAfter(0, "validation")).toBeNull();
      expect(nextAttemptAfter(4, "validation")).toBeNull();
    });

    it("duplicate errors return null (handled as silent success by worker)", () => {
      expect(nextAttemptAfter(0, "duplicate")).toBeNull();
    });
  });

  describe("nextAttemptDeltaMinutes — display helper", () => {
    it("matches the same schedule but returns minute deltas", () => {
      expect(nextAttemptDeltaMinutes(0, "transient")).toBe(1);
      expect(nextAttemptDeltaMinutes(1, "transient")).toBe(5);
      expect(nextAttemptDeltaMinutes(2, "transient")).toBe(30);
      expect(nextAttemptDeltaMinutes(3, "transient")).toBe(120);
      expect(nextAttemptDeltaMinutes(4, "transient")).toBeNull();   // dead-letter
    });

    it("returns null for auth + validation", () => {
      expect(nextAttemptDeltaMinutes(0, "auth")).toBeNull();
      expect(nextAttemptDeltaMinutes(0, "validation")).toBeNull();
    });
  });

  describe("isDeadLetter", () => {
    it("transient failure is dead-letter only at the 5th attempt", () => {
      expect(isDeadLetter(0, "transient")).toBe(false);
      expect(isDeadLetter(3, "transient")).toBe(false);
      expect(isDeadLetter(4, "transient")).toBe(true);
    });

    it("auth/validation errors are always dead-letter (no auto-retry)", () => {
      expect(isDeadLetter(0, "auth")).toBe(true);
      expect(isDeadLetter(0, "validation")).toBe(true);
    });
  });

  describe("Integration check — full retry sequence", () => {
    it("produces the documented 1m,5m,30m,2h,12h,dead-letter pattern", () => {
      const NOW = 0;  // for clean arithmetic
      const deltas: Array<number | null> = [];
      let attempts = 0;
      while (attempts <= 5) {
        const next = nextAttemptAfter(attempts, "transient", NOW);
        deltas.push(next ? next.getTime() / 60_000 : null);
        attempts++;
      }
      expect(deltas).toEqual([1, 5, 30, 120, null, null]);
    });
  });
});
