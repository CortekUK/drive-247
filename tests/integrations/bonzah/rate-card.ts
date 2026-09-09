// =============================================================================
// rate-card.ts — RUN the shipped Bonzah arithmetic, don't re-type it.
//
// THE PROBLEM THIS SOLVES
// -----------------------
// A maths test that computes its expected value with the same expression the
// source uses proves nothing at all:
//
//     expect(rate * days).toBe(rate * days)          // vacuous
//     expect(premium(5)).toBe(RATES.CDW * 5)         // still vacuous — the
//                                                    // rate came from the code
//
// Both sides move together, so changing the rate card keeps the test green and
// the test is decoration. The rule for `premium-maths.test.ts` is therefore:
//
//     EXPECTED  = a literal, computed by hand from the published rate card and
//                 written into the test file as a number.
//     ACTUAL    = the arithmetic that actually ships, EXECUTED.
//
// This module supplies the ACTUAL half. It does not re-implement anything: it
// reads `supabase/functions/<fn>/index.ts`, lifts the real expressions and the
// real function bodies out of the source text, and turns them into callable
// JavaScript with `new Function`. Change `CDW: 26.95` to `CDW: 27.95` and every
// hand-written literal in the maths test goes red on the next run, with nobody
// having remembered to update a list.
//
// It is the same argument `helpers/edge-contract.ts` makes for parsing an edge
// function's request shape instead of listing its fields, applied to the money.
//
// WHY `new Function` AND NOT AN IMPORT
// ------------------------------------
// These are Deno modules. They call `serve(...)` at import time and import from
// `https://deno.land/std@0.168.0/...`; nothing in this Node test runner can
// resolve or safely evaluate them whole. Lifting the pure arithmetic out is the
// only way to run the real thing without running the server.
//
// WHEN THE SOURCE MOVES
// ---------------------
// Every extractor throws — loudly, naming the file and what it looked for —
// rather than returning a default. A silent zero here would make every maths
// assertion pass against nothing, which is worse than a red build. That is
// FAILURE MODE (a): a developer changed the code, and this file has to be
// taught the new shape. It is never on its own evidence of a broken function.
// =============================================================================

import { blankComments, readEdgeFunctionSource, REPO_ROOT } from "../../helpers/edge-contract";
import { join, relative } from "node:path";
import { readFileSync } from "node:fs";

/** The estimator the booking widget and the portal both poll while you tick boxes. */
export const PREMIUM_FN = "bonzah-calculate-premium";
/** The one that actually buys, and whose fallback arithmetic decides what is stored. */
export const QUOTE_FN = "bonzah-create-quote";

const fileOf = (fn: string) => relative(REPO_ROOT, join("supabase", "functions", fn, "index.ts"));

function fail(where: string, lookedFor: string, extra = ""): never {
  throw new Error(
    [
      "",
      `BONZAH MATHS EXTRACTOR — could not find ${lookedFor}`,
      "",
      `  in ${where}`,
      extra ? `  ${extra}` : "",
      "",
      "  THIS IS FAILURE MODE (a): a developer changed the code. The maths tests",
      "  execute the real expressions out of that file rather than re-typing them,",
      "  so a rewrite has to be taught to tests/integrations/bonzah/rate-card.ts.",
      "",
      "  It is NOT evidence that premiums are wrong. Nothing here calls the network",
      "  and nothing here can see a status code. Read the new shape, update the",
      "  extractor, and check the hand-written expected totals still hold.",
      "",
      "  Deleting the extraction and hardcoding the arithmetic instead would make",
      "  every one of those totals pass for the wrong reason.",
      "",
    ].join("\n"),
  );
}

/** Inner text of the balanced `{ ... }` that starts at `openIndex`. */
function balanced(src: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openIndex + 1, i);
    }
  }
  throw new Error("Unbalanced brace while lifting a block out of a Bonzah edge function");
}

// ---------------------------------------------------------------------------
// 1. The rate card
// ---------------------------------------------------------------------------

export interface RateCard {
  fn: string;
  file: string;
  /** Declaration order, which is also the order the response breakdown uses. */
  keys: string[];
  rates: Record<string, number>;
}

/**
 * `const RATES = { CDW: 26.95, ... }` as data.
 *
 * Comments are blanked first: the estimator writes the coverage's full name in a
 * trailing comment on every line, and "Renter's Contingent Liability Insurance"
 * contains an apostrophe that would otherwise open a string literal and swallow
 * the rest of the table.
 */
export function readRateCard(fn: string): RateCard {
  const src = blankComments(readEdgeFunctionSource(fn));
  const m = /\bconst\s+RATES\s*=\s*\{/.exec(src);
  if (!m) fail(fileOf(fn), "the `const RATES = { ... }` table");

  const block = balanced(src, m.index + m[0].length - 1);
  const keys: string[] = [];
  const rates: Record<string, number> = {};
  for (const part of block.split(/[\n,]/)) {
    const kv = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(-?\d+(?:\.\d+)?)\s*$/.exec(part);
    if (!kv) continue;
    keys.push(kv[1]);
    rates[kv[1]] = Number(kv[2]);
  }
  if (!keys.length) fail(fileOf(fn), "any `KEY: number` line inside `const RATES`");
  return { fn, file: fileOf(fn), keys, rates };
}

// ---------------------------------------------------------------------------
// 2. Lifting a whole function body out (calculateDays, splitDateRange, and the
//    two pure helpers in _shared/bonzah-client.ts)
// ---------------------------------------------------------------------------

/**
 * Strip the TYPE off one parameter while KEEPING any default value.
 *
 *   "startDate: string"        -> "startDate"
 *   "fallback = '33101'"       -> "fallback = '33101'"   (default preserved —
 *                                 dropping it would make normalizeZipForBonzah
 *                                 return undefined instead of the fallback ZIP,
 *                                 and the test would be asserting a bug it
 *                                 introduced itself)
 */
function paramName(part: string): string {
  const colon = part.indexOf(":");
  const eq = part.indexOf("=");
  if (colon === -1) return part.trim();
  const name = part.slice(0, colon).trim();
  return eq > colon ? `${name} ${part.slice(eq).trim()}` : name;
}

/**
 * Remove the type annotation from `const x: T = ...` declarations inside a body.
 * Deliberately narrow: it requires `const|let|var NAME :`, so a `:` inside a
 * string (`new Date(start + 'T00:00:00')`) or an object literal is untouched.
 */
function stripLocalTypes(body: string): string {
  return body.replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*[^=;\n]+=/g, "$1 $2 =");
}

export interface LiftedFunction<T extends (...args: any[]) => any> {
  name: string;
  file: string;
  params: string[];
  body: string;
  call: T;
}

function liftFrom<T extends (...args: any[]) => any>(
  label: string,
  file: string,
  src: string,
  name: string,
  inject: Record<string, unknown> = {},
): LiftedFunction<T> {
  const sig = new RegExp(`\\bfunction\\s+${name}\\s*\\(([^)]*)\\)[^{]*\\{`).exec(src);
  if (!sig) fail(file, `\`function ${name}(...)\``);

  const params = (sig[1].trim() ? sig[1].split(",") : []).map(paramName).filter(Boolean);
  const body = stripLocalTypes(balanced(src, sig.index + sig[0].length - 1));

  const injectKeys = Object.keys(inject);
  let built: (...args: any[]) => any;
  try {
    // eslint-disable-next-line no-new-func
    built = new Function(...injectKeys, ...params, body) as (...args: any[]) => any;
  } catch (e) {
    fail(
      file,
      `a runnable body for \`${name}\``,
      `It was found, but ${(e as Error).message}. Most likely a TypeScript construct ` +
        `the narrow type-stripper in rate-card.ts does not handle yet.`,
    );
  }

  const injectValues = injectKeys.map((k) => inject[k]);
  return {
    name,
    file,
    params,
    body,
    call: ((...args: unknown[]) => built(...injectValues, ...args)) as T,
  };
}

/** Lift a top-level function out of an edge function's `index.ts`. */
export function liftEdgeFunction<T extends (...args: any[]) => any>(
  fn: string,
  name: string,
  inject: Record<string, unknown> = {},
): LiftedFunction<T> {
  return liftFrom<T>(fn, fileOf(fn), blankComments(readEdgeFunctionSource(fn)), name, inject);
}

const SHARED_CLIENT = join(REPO_ROOT, "supabase", "functions", "_shared", "bonzah-client.ts");

/** Lift a top-level function out of `supabase/functions/_shared/bonzah-client.ts`. */
export function liftSharedClient<T extends (...args: any[]) => any>(
  name: string,
  inject: Record<string, unknown> = {},
): LiftedFunction<T> {
  const src = blankComments(readFileSync(SHARED_CLIENT, "utf8"));
  return liftFrom<T>("_shared/bonzah-client.ts", relative(REPO_ROOT, SHARED_CLIENT), src, name, inject);
}

export function readSharedClientSource(): string {
  return readFileSync(SHARED_CLIENT, "utf8");
}

/**
 * Take the TypeScript out of a lifted EXPRESSION so `new Function` can compile
 * it. Narrower than a transpiler on purpose — it only knows the two constructs
 * these functions actually use inside expressions:
 *
 *   `(sum: number, u: any) => ...`   arrow params with primitive annotations
 *   `(allocatedBalance as string)`   a cast
 *
 * Anything else it does not recognise stays as-is and fails loudly at compile
 * time, which is the correct outcome: a silently mangled expression would be
 * running arithmetic nobody wrote.
 */
export function stripInlineTypes(expr: string): string {
  return expr
    .replace(/\s+as\s+(?:const\b|[A-Za-z_$][\w$]*(?:\s*\[\s*\])?)/g, "")
    .replace(/([A-Za-z_$][\w$]*)\s*:\s*(number|string|boolean|any|unknown)\b/g, "$1");
}

/**
 * Lift ONE expression out of an edge function and make it callable.
 *
 * Same contract as everything else here: the expression that ships is the
 * expression that runs, and the expected values live in the test as literals.
 * `pattern` must have exactly one capture group — the expression text.
 */
export function liftEdgeExpression<T extends (...args: any[]) => any>(
  fn: string,
  what: string,
  pattern: RegExp,
  params: string[],
): { expr: string; call: T } {
  const src = blankComments(readEdgeFunctionSource(fn));
  const m = pattern.exec(src);
  if (!m) fail(fileOf(fn), what);
  const expr = stripInlineTypes(m[1].trim());
  try {
    // eslint-disable-next-line no-new-func
    const built = new Function(...params, `return (${expr});`) as (...args: unknown[]) => unknown;
    return { expr, call: ((...args: unknown[]) => built(...args)) as T };
  } catch (e) {
    fail(fileOf(fn), `a runnable expression for ${what}`, `${(e as Error).message}\n  lifted: ${expr}`);
  }
}

/** A named numeric constant, e.g. `const MAX_POLICY_DAYS = 30`. */
export function readNumericConst(fn: string, name: string): number {
  const src = blankComments(readEdgeFunctionSource(fn));
  const m = new RegExp(`\\bconst\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`).exec(src);
  if (!m) fail(fileOf(fn), `\`const ${name} = <number>\``);
  return Number(m[1]);
}

// ---------------------------------------------------------------------------
// 3. The estimator's per-coverage arithmetic
//
//    const cdwPremium = body.cdw_cover ? Math.round(RATES.CDW * days * 100) / 100 : 0
//
//    Each of those lines is lifted whole and evaluated. That means the test
//    exercises the real rounding rule, the real rate lookup AND the real
//    request-field name in one go: rename `cdw_cover` and the lifted ternary
//    stops seeing a selected coverage, so the premium collapses to 0 and the
//    hand-written expected total fails.
// ---------------------------------------------------------------------------

export interface PremiumLine {
  /** The local variable, e.g. `cdwPremium`. */
  varName: string;
  /** The RATES key it reads, e.g. `CDW`. */
  ratesKey: string;
  /** The request field it is gated on, e.g. `cdw_cover`. */
  bodyField: string;
  /** `cdw` — the response-breakdown key, derived from `bodyField`. */
  shortKey: string;
  /** The verbatim right-hand side. */
  expr: string;
  evaluate(rates: Record<string, number>, days: number, selected: boolean): number;
}

export interface PremiumModel {
  fn: string;
  file: string;
  card: RateCard;
  lines: PremiumLine[];
  /** `Math.round((cdwPremium + rcliPremium + ...) * 100) / 100` */
  totalExpr: string;
  total(parts: number[]): number;
  /** Run the whole thing: breakdown + total, for one coverage selection. */
  quote(days: number, selected: Record<string, boolean>): { breakdown: Record<string, number>; total: number };
}

export function readPremiumModel(fn: string = PREMIUM_FN): PremiumModel {
  const src = blankComments(readEdgeFunctionSource(fn));
  const card = readRateCard(fn);
  const model_file = fileOf(fn);

  const lines: PremiumLine[] = [];
  for (const m of src.matchAll(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n]*\bRATES\s*\.\s*[A-Za-z_$][\w$]*[^\n]*)/g,
  )) {
    const varName = m[1];
    const expr = m[2].trim();
    const ratesKey = /\bRATES\s*\.\s*([A-Za-z_$][\w$]*)/.exec(expr)?.[1];
    const bodyField = /\bbody\s*\??\s*\.\s*([A-Za-z_$][\w$]*)/.exec(expr)?.[1];
    if (!ratesKey || !bodyField) continue;

    let built: (rates: Record<string, number>, days: number, body: Record<string, boolean>) => number;
    try {
      // eslint-disable-next-line no-new-func
      built = new Function("RATES", "days", "body", `return (${expr});`) as typeof built;
    } catch (e) {
      fail(model_file, `a runnable expression for \`${varName}\``, (e as Error).message);
    }

    lines.push({
      varName,
      ratesKey,
      bodyField,
      shortKey: bodyField.replace(/_cover$/, ""),
      expr,
      evaluate: (rates, days, selected) => built(rates, days, { [bodyField]: selected }),
    });
  }
  if (!lines.length) fail(model_file, "any `const <x>Premium = body.<y> ? ...RATES.<K>... : 0` line");

  // Anchored on the variable names just discovered, rather than on a loose
  // "identifier plus identifier" shape: the summing line is required to mention
  // EVERY per-coverage premium, so a total that quietly stopped adding one of
  // the four is a hard extractor failure right here instead of a silently
  // smaller number that the maths table would then have to catch on its own.
  const totalExpr = (() => {
    for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n]+)/g)) {
      const rhs = m[2].trim();
      if (lines.some((l) => l.varName === m[1])) continue;
      if (lines.every((l) => new RegExp(`\\b${l.varName}\\b`).test(rhs))) return rhs;
    }
    return null;
  })();
  if (!totalExpr) {
    fail(
      model_file,
      `a single line summing all of ${lines.map((l) => l.varName).join(", ")}`,
      "Either the summing line was rewritten, or the total no longer adds every coverage.",
    );
  }

  let totalFn: (...parts: number[]) => number;
  try {
    // eslint-disable-next-line no-new-func
    totalFn = new Function(...lines.map((l) => l.varName), `return (${totalExpr});`) as typeof totalFn;
  } catch (e) {
    fail(model_file, "a runnable total expression", (e as Error).message);
  }

  const model: PremiumModel = {
    fn,
    file: fileOf(fn),
    card,
    lines,
    totalExpr,
    total: (parts) => totalFn(...parts),
    quote(days, selected) {
      const breakdown: Record<string, number> = {};
      const parts: number[] = [];
      for (const line of lines) {
        const v = line.evaluate(card.rates, days, Boolean(selected[line.shortKey]));
        breakdown[line.shortKey] = v;
        parts.push(v);
      }
      return { breakdown, total: totalFn(...parts) };
    },
  };
  return model;
}

// ---------------------------------------------------------------------------
// 4. The quote function's FALLBACK arithmetic
//
//    Used whenever Bonzah's /Bonzah/quote response omits `total_amount`. It is
//    the number that then gets written to `bonzah_insurance_policies.premium_amount`
//    and to `rentals.insurance_premium`, so it is a billed figure, not a display
//    one — and it is a SECOND copy of the same rate card in a second file.
//
//    Shape (multi-line, unlike the estimator's):
//
//        premium =
//          (body.coverage.cdw ? RATES.CDW * days : 0) +
//          ...
//        premium = Math.round(premium * 100) / 100
//
//    Both halves are lifted, so the sum AND the rounding that ships are what
//    run here.
// ---------------------------------------------------------------------------

export interface QuoteFallbackModel {
  fn: string;
  file: string;
  card: RateCard;
  sumExpr: string;
  roundExpr: string;
  /** Terms in declaration order: which coverage flag maps to which RATES key. */
  terms: { coverageKey: string; ratesKey: string }[];
  premium(days: number, coverage: Record<string, boolean>): number;
}

export function readQuoteFallbackModel(fn: string = QUOTE_FN): QuoteFallbackModel {
  const src = blankComments(readEdgeFunctionSource(fn));
  const card = readRateCard(fn);

  const m = /\bpremium\s*=[ \t]*\r?\n([\s\S]*?)\r?\n\s*premium\s*=\s*(Math\.round[^\n]+)/.exec(src);
  if (!m) {
    fail(
      fileOf(fn),
      "the multi-line `premium = (…RATES…) + (…) + (…) + (…)` fallback followed by " +
        "`premium = Math.round(premium * 100) / 100`",
    );
  }
  const sumExpr = m[1].trim();
  const roundExpr = m[2].trim();

  const terms = [...sumExpr.matchAll(/\bbody\s*\.\s*coverage\s*\.\s*([A-Za-z_$][\w$]*)[^)]*?\bRATES\s*\.\s*([A-Za-z_$][\w$]*)/g)].map(
    (t) => ({ coverageKey: t[1], ratesKey: t[2] }),
  );
  if (!terms.length) fail(fileOf(fn), "any `body.coverage.<x> ? RATES.<K> * days : 0` term in the fallback");

  let sumFn: (RATES: Record<string, number>, days: number, body: unknown) => number;
  let roundFn: (premium: number) => number;
  try {
    // eslint-disable-next-line no-new-func
    sumFn = new Function("RATES", "days", "body", `return (${sumExpr});`) as typeof sumFn;
    // eslint-disable-next-line no-new-func
    roundFn = new Function("premium", `return (${roundExpr});`) as typeof roundFn;
  } catch (e) {
    fail(fileOf(fn), "a runnable fallback premium expression", (e as Error).message);
  }

  return {
    fn,
    file: fileOf(fn),
    card,
    sumExpr,
    roundExpr,
    terms,
    premium: (days, coverage) => roundFn(sumFn(card.rates, days, { coverage })),
  };
}

// ---------------------------------------------------------------------------
// 5. Day counting and 30-day chunking
// ---------------------------------------------------------------------------

export type CalculateDays = (startDate: string, endDate: string) => number;
export type SplitDateRange = (start: string, end: string) => { start: string; end: string }[];

/** The `calculateDays` that ships in `fn`. Both Bonzah functions carry a copy. */
export function liftCalculateDays(fn: string): LiftedFunction<CalculateDays> {
  return liftEdgeFunction<CalculateDays>(fn, "calculateDays");
}

/**
 * `splitDateRange` out of bonzah-create-quote, with the module constant it
 * closes over injected so the real 30-day limit is what applies.
 */
export function liftSplitDateRange(): LiftedFunction<SplitDateRange> {
  return liftEdgeFunction<SplitDateRange>(QUOTE_FN, "splitDateRange", {
    MAX_POLICY_DAYS: readNumericConst(QUOTE_FN, "MAX_POLICY_DAYS"),
  });
}

/**
 * Is this process running in UTC, the way the deployed Deno runtime is?
 *
 * `splitDateRange` builds its dates with `new Date('YYYY-MM-DDT00:00:00')` —
 * LOCAL midnight — and reads them back with `toISOString()`, which is UTC. The
 * two only agree at offset 0. Tests that assert exact chunk BOUNDARIES are
 * therefore meaningful only here; the day-count and premium invariants hold in
 * every timezone and are asserted unconditionally.
 */
export function runningInUtc(): boolean {
  return new Date("2026-03-06T00:00:00").getTimezoneOffset() === 0;
}

/**
 * Does local time run at or ahead of UTC?
 *
 * `formatDateForBonzah` has the mirror-image dependency: it parses a date-only
 * string (UTC midnight, per the ISO date-only rule) and formats it with the
 * LOCAL `getMonth()/getDate()`. At offset 0 or east of it the calendar day is
 * unchanged; west of it the formatted date is a day early.
 */
export function localIsUtcOrEast(): boolean {
  return new Date("2026-03-06").getTimezoneOffset() <= 0;
}
