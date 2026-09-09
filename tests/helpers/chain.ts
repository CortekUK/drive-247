// =============================================================================
// chain.ts — stop at the first step that is not 200.
//
// From the whiteboard:
//
//     plan select.  --- 99
//     account --- [password, work] ---> edge functionn. --- 200
//     paymnet --- checkout ---> {999} --- 200
//
// "uska result bhi 200 aana chahiye — magar 200 nahi aayega to HUM YAHAN PAR
//  ROK DENGE."
//
// The onboarding flow is a chain, not a bag of independent cases. If the
// account step never returns 200 then there is no session, so the slug check
// cannot be authenticated, so there is no paid subscription, so provisioning
// has nothing to provision. Running those anyway produces four red tests for
// one broken thing and buries the one that matters.
//
// So: the first failing step BREAKS the chain, and every later step SKIPS with
// a message naming the step that broke it. One red line, in the right place.
//
// This is also why tests/vitest.config.ts pins the runner to a single fork with
// file parallelism off and an alphabetical sequencer — the 01..05 numbering on
// disk IS the execution order, and this module's state is shared across the
// five files because they run in one process.
// =============================================================================

/** The spine, in order. The file names mirror this exactly. */
export const SPINE_ORDER = [
  "01-plan-select",
  "02-account",
  "03-slug-check",
  "04-payment",
  "05-provision",
] as const;

export type SpineStep = (typeof SPINE_ORDER)[number];

interface Broken {
  step: SpineStep;
  why: string;
}

class SpineChain {
  private passed = new Set<SpineStep>();
  private broken: Broken | null = null;
  private seeds = new Map<string, unknown>();

  /** Called on the last line of a passing step. A step that throws never gets here. */
  pass(step: SpineStep, note?: string): void {
    this.passed.add(step);
    if (note) this.notes.set(step, note);
  }

  private notes = new Map<SpineStep, string>();

  /** Explicitly break the chain — used when a step detects a failure itself. */
  fail(step: SpineStep, why: string): void {
    if (!this.broken) this.broken = { step, why };
  }

  noteOf(step: SpineStep): string | undefined {
    return this.notes.get(step);
  }

  /**
   * Why `step` must not run, or null if it may.
   *
   * A step is runnable only when every step before it has passed. A previous
   * step that has not run at all (ordering broke, or someone ran one file with
   * `-t`) is treated the same as a failure — conservative on purpose, since the
   * later steps genuinely depend on it.
   */
  reasonToSkip(step: SpineStep): string | null {
    if (this.broken && SPINE_ORDER.indexOf(step) > SPINE_ORDER.indexOf(this.broken.step)) {
      return `chain stopped at ${this.broken.step}: ${this.broken.why}`;
    }
    for (const prior of SPINE_ORDER) {
      if (prior === step) break;
      if (!this.passed.has(prior)) {
        return `chain stopped at ${prior}: it did not pass (see the failure above)`;
      }
    }
    return null;
  }

  /** Values that travel down the chain — the hardcoded 99 being the whole point. */
  seed<T>(key: string, value: T): T {
    this.seeds.set(key, value);
    return value;
  }

  seeded<T>(key: string): T {
    if (!this.seeds.has(key)) {
      throw new Error(
        `Nothing seeded under "${key}". Step 01 seeds the plan the whole run is ` +
          `priced against; a later step reading it before 01 ran means the file ` +
          `order broke — check tests/vitest.config.ts.`,
      );
    }
    return this.seeds.get(key) as T;
  }

  /** For the run summary, and for tests of the chain itself. */
  snapshot() {
    return {
      passed: [...this.passed],
      broken: this.broken,
      seeds: Object.fromEntries(this.seeds),
    };
  }

  /** Test-only. Never called by the spine files. */
  reset(): void {
    this.passed.clear();
    this.notes.clear();
    this.broken = null;
    this.seeds.clear();
  }
}

/** One chain per run. Module state, shared because the runner uses one fork. */
export const chain = new SpineChain();

/**
 * First line of every spine test after 01.
 *
 * Returns true when the caller should stop. `ctx.skip(reason)` marks the test
 * skipped rather than failed — a green-with-skips run reading "chain stopped at
 * 02-account" points at one thing, which is the entire purpose.
 */
export function haltIfBroken(
  ctx: { skip: (note?: string) => void },
  step: SpineStep,
): boolean {
  const why = chain.reasonToSkip(step);
  if (!why) return false;
  ctx.skip(why);
  return true;
}

/**
 * A one-line summary of a failure, for the "chain stopped at ..." note that
 * every later step is skipped with.
 *
 * Decoration is skipped, not just blank lines: the production refusal in
 * live-call.ts opens with a `####` banner, and "chain stopped at 02-account:
 * ####################" tells the reader nothing about why.
 */
function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const line = msg
    .split("\n")
    .map((l) => l.replace(/^[\s#|*=-]+/, "").replace(/[\s#|*=-]+$/, "").trim())
    .find((l) => /[A-Za-z]{3}/.test(l));
  return line ?? "assertion failed";
}

/**
 * Run a step's assertions and break the chain if any of them throw.
 *
 * Without this the chain would only know about a failure if the LAST test in a
 * file happened to be the one that failed — `chain.pass()` sits on the last
 * line of the last test, so an earlier red test would be followed by a green
 * `pass()` and the chain would carry on as if nothing happened.
 */
export function guarded<T>(step: SpineStep, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    chain.fail(step, firstLine(e));
    throw e;
  }
}

export async function guardedAsync<T>(step: SpineStep, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    chain.fail(step, firstLine(e));
    throw e;
  }
}
