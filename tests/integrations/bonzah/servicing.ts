// =============================================================================
// servicing.ts — the parsing, the lifting and the Layer 2 gate that the SECOND
// half of the Bonzah surface needs, and that neither tests/helpers nor the
// files already in this folder provide.
//
// WHAT "THE SECOND HALF" IS
// -------------------------
// `functional.test.ts` and the two maths files cover the money path: quote,
// premium, confirm, balance. This module serves the six functions that were
// listed in this folder's README as "the obvious next files" and then were not
// written:
//
//   bonzah-verify-credentials   are the stored credentials usable
//   bonzah-view-policy          read an issued policy back from Bonzah
//   bonzah-download-pdf         fetch the certificate PDF
//   bonzah-probe-pdf            a 28-endpoint diagnostic for the one above
//   bonzah-grade-quiz           the partner-onboarding knowledge check
//   bonzah-partner-review       a Bonzah partner approves/rejects an operator
//
// THREE THINGS ARE NEEDED, AND EACH ONE THROWS RATHER THAN DEFAULTING
// -------------------------------------------------------------------
// 1. A PARSER for a request shape `tests/helpers/edge-contract.ts` does not
//    know. It knows three and throws on a fourth, deliberately — an unparsed
//    function contributes zero fields and makes every assertion against it pass
//    for the wrong reason. `bonzah-grade-quiz` and `bonzah-partner-review` both
//    use a fourth:
//
//        const body = await req.json().catch(() => ({}));
//
//    so `readLooseBodyShape` implements exactly that shape here, with the same
//    rule kept: it never returns an empty field set, it throws.
//
// 2. AN ASYNC LIFTER. `rate-card.ts` lifts pure arithmetic with `new Function`,
//    which cannot compile a body containing `await`. The classification this
//    half turns on — "is this response a PDF", "is this cached token being
//    handed out for the wrong password" — lives inside `async function`s. So
//    the same trick is repeated through the AsyncFunction constructor, and the
//    shipped body is EXECUTED against a fake `fetch` rather than re-typed.
//
// 3. A LAYER 2 GATE with a rung the existing ones do not have. `sandbox.ts`
//    guards the URL when the test itself calls Bonzah. These functions are
//    called through OUR edge function, which then picks the Bonzah host from
//    `tenants.bonzah_mode` — a per-tenant column this process cannot see. A URL
//    guard is useless there, so the only honest control is the same human
//    declaration `D247_LIVE_BONZAH_MODE=test` that the money gate already
//    demands, and it is demanded here too even though nothing below spends.
//
// NOTHING IN THIS FILE CAN WIDEN A TARGET. `liveStatus()` in
// tests/helpers/live-call.ts stays the only thing allowed to answer "which
// database am I pointed at", it is called first, and its throw is inherited.
// =============================================================================

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  blankComments,
  readEdgeFunctionSource,
  REPO_ROOT,
  type FieldOrigin,
} from "../../helpers/edge-contract";
import { liveStatus, type LiveTarget } from "../../helpers/live-call";
import { BONZAH_LIVE_HOST, BONZAH_SANDBOX_HOST } from "./sandbox";

function env(name: string): string | null {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export const fileOf = (fn: string) =>
  relative(REPO_ROOT, join(REPO_ROOT, "supabase", "functions", fn, "index.ts"));

/** Source with prose blanked, so a field named in a comment is never a field. */
export function srcOf(fn: string): string {
  return blankComments(readEdgeFunctionSource(fn));
}

/** A repo file that is not an edge function — a caller in `apps/**`, usually. */
export function readRepoFile(relPath: string): string {
  const file = join(REPO_ROOT, relPath);
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `No file at ${relPath}.\n` +
        "  Either it moved or this test names it wrongly. That is FAILURE MODE (a) —\n" +
        "  a developer changed something — and the fix is to point the test at the new\n" +
        "  path, or delete the case if the caller is genuinely gone.",
    );
  }
}

/**
 * Every `.ts`/`.tsx` file under `apps/` whose text contains `needle`.
 *
 * Used to answer "does anything actually call this function", which is not a
 * question source-parsing one file can answer. Done in-process rather than by
 * shelling out to grep: `grep` exits 1 on NO MATCH, and no-match is the
 * interesting answer here — a test that dies on its own success is worse than
 * no test. Build output is skipped so a stale `.next` cannot invent a caller.
 */
export function grepApps(needle: string): string[] {
  const skip = new Set(["node_modules", ".next", ".turbo", "dist", "build", ".git", "coverage"]);
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && readFileSync(full, "utf8").includes(needle)) {
        hits.push(relative(REPO_ROOT, full));
      }
    }
  };
  walk(join(REPO_ROOT, "apps"));
  return hits.sort();
}

function fail(where: string, lookedFor: string, extra = ""): never {
  throw new Error(
    [
      "",
      `BONZAH SERVICING EXTRACTOR — could not find ${lookedFor}`,
      "",
      `  in ${where}`,
      extra ? `  ${extra}` : "",
      "",
      "  THIS IS FAILURE MODE (a): a developer changed the code. These tests parse and",
      "  EXECUTE the real thing rather than re-typing it, so a rewrite has to be taught",
      "  to tests/integrations/bonzah/servicing.ts.",
      "",
      "  It is NOT evidence that anything is broken in production — nothing here calls",
      "  the network and nothing here can see a status code. Read the new shape, update",
      "  the extractor, and check the hand-written expectations still hold.",
      "",
      "  Deleting the extraction and hardcoding the behaviour instead would make every",
      "  one of those expectations pass for the wrong reason.",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// 1. The fourth request shape
// ---------------------------------------------------------------------------

export interface LooseBodyShape {
  fn: string;
  file: string;
  /** Every field the handler can read off the JSON body. Sorted. */
  fields: string[];
  origin: Record<string, FieldOrigin[]>;
  /** Character offset of the `const body = await req.json()` line. */
  parseIndex: number;
}

/**
 * The request shape of a function that parses its body WITHOUT a type:
 *
 *     const body = await req.json().catch(() => ({}));
 *     const { submissionId, action } = body;
 *     const reason = (body.reason || "").trim();
 *
 * Fields come from two places, both after the parse site: a destructure OF
 * `body`, and `body.x` / `body?.x` member access. There is no declared type, so
 * unlike `readEdgeFunction` there is nothing to say which fields are required —
 * that has to be read off the guards instead, and the tests do exactly that.
 *
 * Throws when the parse site is missing, for the same reason the shared helper
 * does: a function whose body-read cannot be found must not quietly contribute
 * zero fields.
 */
export function readLooseBodyShape(fn: string): LooseBodyShape {
  const src = srcOf(fn);
  const handlerAt = /(?:Deno\.serve|\bserve)\s*\(\s*async/.exec(src)?.index ?? 0;
  const handler = src.slice(handlerAt);

  const parse = /(?:const|let)\s+body\s*=\s*await\s+req\.json\(\)/.exec(handler);
  if (!parse) {
    fail(
      fileOf(fn),
      "`const body = await req.json()` inside the request handler",
      "tests/helpers/edge-contract.ts knows three body shapes and throws on a fourth; " +
        "this parser exists for that fourth one. If the function now uses a fifth, teach " +
        "it here rather than dropping the contract test.",
    );
  }

  const region = handler.slice(parse.index);
  const origin: Record<string, FieldOrigin[]> = {};
  const add = (name: string, from: FieldOrigin) => {
    const seen = (origin[name] ??= []);
    if (!seen.includes(from)) seen.push(from);
  };

  // `const { submissionId, action } = body;` — the KEY is what crosses the
  // wire, so an alias after `:` is discarded exactly as the shared helper does.
  for (const m of region.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*body\b/g)) {
    for (const part of m[1].split(",")) {
      const name = /^\s*([A-Za-z_$][\w$]*)/.exec(part)?.[1];
      if (name) add(name, "destructured");
    }
  }
  for (const m of region.matchAll(/\bbody\s*\??\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    add(m[1], "member-access");
  }

  if (!Object.keys(origin).length) {
    fail(
      fileOf(fn),
      "any field read off `body` after it is parsed",
      "The handler parses a body and then never reads a field from it, which either " +
        "means the request shape moved or that this function no longer takes input.",
    );
  }

  return {
    fn,
    file: fileOf(fn),
    fields: Object.keys(origin).sort(),
    origin,
    parseIndex: handlerAt + parse.index,
  };
}

/**
 * The same drift check `assertContract` makes, for the loose shape.
 *
 * One side written by hand (what the caller in `apps/**` puts on the wire), one
 * side derived from source. Never both — two hand-written lists only prove that
 * somebody typed the same thing twice.
 */
export function assertLooseContract(opts: {
  fn: string;
  builtIn: string;
  payload: Record<string, unknown>;
  serverOnlyOptional?: Record<string, string>;
}): LooseBodyShape {
  const shape = readLooseBodyShape(opts.fn);
  const sent = new Set(Object.keys(opts.payload));
  const excused = new Set(Object.keys(opts.serverOnlyOptional ?? {}));
  const extra = [...sent].filter((k) => !shape.fields.includes(k)).sort();
  const missing = shape.fields.filter((k) => !sent.has(k) && !excused.has(k)).sort();

  if (extra.length || missing.length) {
    throw new Error(
      [
        "",
        `CONTRACT DRIFT — ${opts.fn} (integrations/bonzah)`,
        "",
        ...(extra.length
          ? [
              `  The payload sends ${extra.length} field(s) that ${opts.fn} does not read:`,
              ...extra.map((f) => `    - ${f}`),
              "",
              `  WHICH SIDE MOVED: the EDGE FUNCTION. ${shape.file} no longer reads them.`,
              "",
            ]
          : []),
        ...(missing.length
          ? [
              `  ${opts.fn} reads ${missing.length} field(s) that nothing sends:`,
              ...missing.map((f) => `    - ${f}  (${(shape.origin[f] ?? []).join(", ")})`),
              "",
              `  WHICH SIDE MOVED: the EDGE FUNCTION grew a field, or the CLIENT dropped one.`,
              `  ${opts.builtIn} builds the payload; ${shape.file} reads it.`,
              "",
            ]
          : []),
        "  THIS IS FAILURE MODE (a): a developer changed a field. It is the healthy,",
        "  expected failure — fix whichever side is wrong and the build goes green.",
        "",
        "  It is NOT failure mode (b) — 'the function is returning 400/401'. A contract",
        "  test never touches the network and cannot see a status code.",
        "",
      ].join("\n"),
    );
  }
  return shape;
}

// ---------------------------------------------------------------------------
// 2. Executing the shipped code
// ---------------------------------------------------------------------------

/** `Object.getPrototypeOf(async function(){}).constructor` — an async `new Function`. */
const AsyncFunction = Object.getPrototypeOf(async function () {
  /* shape only */
}).constructor as new (...args: string[]) => (...args: any[]) => Promise<any>;

/** Inner text of the balanced `{ ... }` (or `( )`, `[ ]`) opening at `openIndex`. */
export function balanced(src: string, openIndex: number): string {
  const open = src[openIndex];
  const close = open === "{" ? "}" : open === "(" ? ")" : "]";
  let depth = 0;
  for (let i = openIndex; i < src.length; i += 1) {
    if (src[i] === open) depth += 1;
    else if (src[i] === close) {
      depth -= 1;
      if (depth === 0) return src.slice(openIndex + 1, i);
    }
  }
  throw new Error("Unbalanced brace while lifting a block out of a Bonzah function");
}

/**
 * Take the TypeScript out of a STATEMENT body so it can be compiled as JS.
 *
 * Wider than `rate-card.ts`'s expression stripper because whole function bodies
 * carry three constructs an expression never does, and each one is a syntax
 * error in plain JavaScript:
 *
 *   `let bodyText: string`               a declaration with a type and NO value
 *   `const x: T = ...`                   a declaration with both
 *   `... as Error & { code: string }`    an assertion to an intersection type
 *
 * Deliberately narrow — anything it does not recognise is left alone and fails
 * loudly at compile time, which is the correct outcome. A silently mangled body
 * would be running code nobody wrote.
 */
export function stripTypesForRuntime(body: string): string {
  return (
    body
      // `as Error & { code: string }`, `as ProbeResult`, `as const`
      .replace(/\s+as\s+(?:const\b|[A-Za-z_$][\w$]*(?:\s*\[\s*\])?(?:\s*&\s*\{[^}]*\})?)/g, "")
      // `const x: T = ...`  ->  `const x = ...`
      .replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*[^=;\n]+=/g, "$1 $2 =")
      // `let bodyText: string` (no initializer) -> `let bodyText`
      .replace(/\b(let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*[^=;\n]+(?=[;\n])/g, "$1 $2")
  );
}

/**
 * One parameter, type removed, DEFAULT AND OPTIONALITY PRESERVED.
 *
 *   "url: string"                  -> "url"
 *   "body?: string"                -> "body"       (the `?` is not valid JS)
 *   "context: 'a'|'b' = 'saved'"   -> "context = 'saved'"
 *
 * Dropping a default would make the lifted function take `undefined` where the
 * shipped one takes a value, and the test would then be asserting a behaviour it
 * introduced itself.
 */
function paramName(part: string): string {
  const colon = part.indexOf(":");
  const eq = part.indexOf("=");
  if (colon === -1) return part.trim().replace(/\?$/, "");
  const name = part.slice(0, colon).trim().replace(/\?$/, "");
  return eq > colon ? `${name} ${part.slice(eq).trim()}` : name;
}

export interface LiftedAsync<T extends (...args: any[]) => any> {
  name: string;
  file: string;
  params: string[];
  body: string;
  call: T;
}

function liftAsyncFrom<T extends (...args: any[]) => any>(
  file: string,
  src: string,
  name: string,
  inject: Record<string, unknown>,
): LiftedAsync<T> {
  const sig = new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(([^)]*)\\)[^{]*\\{`).exec(src);
  if (!sig) fail(file, `\`async function ${name}(...)\``);

  const params = (sig[1].trim() ? sig[1].split(",") : []).map(paramName).filter(Boolean);
  const body = stripTypesForRuntime(balanced(src, sig.index + sig[0].length - 1));

  const injectKeys = Object.keys(inject);
  let built: (...args: any[]) => Promise<any>;
  try {
    built = new AsyncFunction(...injectKeys, ...params, body);
  } catch (e) {
    fail(
      file,
      `a runnable body for \`${name}\``,
      `It was found, but ${(e as Error).message}. Most likely a TypeScript construct ` +
        "stripTypesForRuntime() in servicing.ts does not handle yet.",
    );
  }
  const injectValues = injectKeys.map((k) => inject[k]);
  return {
    name,
    file,
    params,
    body,
    call: ((...args: unknown[]) => built(...injectValues, ...args)) as unknown as T,
  };
}

/** Lift an `async function` out of an edge function's own `index.ts`. */
export function liftAsyncEdge<T extends (...args: any[]) => any>(
  fn: string,
  name: string,
  inject: Record<string, unknown> = {},
): LiftedAsync<T> {
  return liftAsyncFrom<T>(fileOf(fn), srcOf(fn), name, inject);
}

const SHARED_CLIENT = join(REPO_ROOT, "supabase", "functions", "_shared", "bonzah-client.ts");

/** Lift an `async function` out of `supabase/functions/_shared/bonzah-client.ts`. */
export function liftAsyncSharedClient<T extends (...args: any[]) => any>(
  name: string,
  inject: Record<string, unknown> = {},
): LiftedAsync<T> {
  const src = blankComments(readFileSync(SHARED_CLIENT, "utf8"));
  return liftAsyncFrom<T>(relative(REPO_ROOT, SHARED_CLIENT), src, name, inject);
}

/**
 * Lift a run of STATEMENTS — a `for` loop, a scoring pass — out of a handler and
 * make it callable.
 *
 * `rate-card.ts` can lift an expression and a whole named function; neither
 * covers arithmetic that ships inline in the middle of `Deno.serve`, which is
 * where both the PDF byte loop and the quiz scoring pass live. `pattern` must
 * have exactly one capture group: the statements.
 */
export function liftStatements<T extends (...args: any[]) => any>(opts: {
  fn: string;
  what: string;
  pattern: RegExp;
  params: string[];
  /** Runs before the lifted statements — the `let score = 0` the loop mutates. */
  prelude?: string;
  /** Runs after — `return score`. */
  epilogue?: string;
}): { statements: string; call: T } {
  const src = srcOf(opts.fn);
  const m = opts.pattern.exec(src);
  if (!m) fail(fileOf(opts.fn), opts.what);
  const statements = stripTypesForRuntime(m[1]);
  const code = [opts.prelude ?? "", statements, opts.epilogue ?? ""].join("\n");
  try {
    // eslint-disable-next-line no-new-func
    const built = new Function(...opts.params, code) as (...args: unknown[]) => unknown;
    return { statements, call: ((...args: unknown[]) => built(...args)) as T };
  } catch (e) {
    fail(fileOf(opts.fn), `runnable statements for ${opts.what}`, `${(e as Error).message}\n  lifted: ${statements}`);
  }
}

// ---------------------------------------------------------------------------
// 3. The Layer 2 gate for the servicing half
// ---------------------------------------------------------------------------

export type ServicingGate =
  | { allowed: true; target: LiveTarget }
  | { allowed: false; reason: string };

/** The declaration alone. Safe at collection time — it cannot throw. */
export function bonzahModeDeclared(): boolean {
  return env("D247_LIVE_BONZAH_MODE") === "test";
}

/**
 * Permission to call one of the SERVICING endpoints live.
 *
 * These read: view a policy, download a certificate, check a login, grade a
 * quiz. None of them spends a balance or issues cover, so there is no money
 * rung here and inventing one would teach the next reader that the rungs are
 * decoration.
 *
 * But `D247_LIVE_BONZAH_MODE=test` is still required, and that is the point of
 * this gate existing at all. `sandbox.ts` can refuse a hostname because the
 * test itself does the calling. Here the call goes through OUR edge function,
 * which resolves the Bonzah host from `tenants.bonzah_mode` — a per-tenant
 * column no variable in this process can see. So a live-mode fixture tenant
 * would send `bonzah-view-policy` and `bonzah-download-pdf` straight at
 * production insurance, and no URL guard anywhere in this folder would notice.
 *
 * A human declaring the fixture tenant is in test mode is the only control that
 * exists. Unset is refused rather than assumed — fail closed, V2_PLAN.md §2.
 */
export function bonzahServicingGate(): ServicingGate {
  const status = liveStatus(); // carries the production-Supabase refusal
  if (!status.enabled) {
    return {
      allowed: false,
      reason: `${status.reason} The contract half of this case still ran offline.`,
    };
  }
  if (!bonzahModeDeclared()) {
    return {
      allowed: false,
      reason:
        "D247_LIVE_BONZAH_MODE is not \"test\". These endpoints resolve their Bonzah host " +
        `from tenants.bonzah_mode, so a live-mode fixture tenant sends them at ` +
        `${BONZAH_LIVE_HOST} (production insurance) instead of ${BONZAH_SANDBOX_HOST}, and ` +
        "no URL guard in this folder can see that happen — the host is chosen server-side. " +
        "The declaration is the only control there is, and unset is refused.",
    };
  }
  return { allowed: true, target: status.target };
}

/** Fixtures are never inferred. Missing means SKIP, never a guess. */
export function fixtureOrNull(name: string): string | null {
  return env(name);
}
