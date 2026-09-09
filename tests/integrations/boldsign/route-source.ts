// =============================================================================
// route-source.ts — reading a NEXT ROUTE HANDLER, which is not an edge function.
//
// WHY A SECOND LOCAL HELPER
// -------------------------
// `tests/helpers/edge-contract.ts` is shared with the spine and parses Deno edge
// functions: it looks for `Deno.serve(async` and for one of three
// `await req.json()` shapes. A Next route handler has neither. It exports one
// named function PER HTTP METHOD:
//
//     export async function POST(request: NextRequest) { ... }
//     export async function GET(request: NextRequest)  { ... }
//
// and that export list IS the route's method contract — Next answers 405 for
// every verb with no matching export. So "which methods does this route accept"
// is a question about exports, and nothing in tests/helpers can answer it.
//
// `boldsign-source.ts` (this folder) already reads the *request body* of a Next
// route (`destructuredRequestKeys`). This file adds the three things the six
// portal e-sign routes need that neither helper has:
//
//   1. the exported HTTP methods                       -> exportedHttpMethods()
//   2. whether the route establishes WHO is calling    -> authMarkers()
//   3. every supabase query chain and whether it is
//      scoped to a tenant                              -> queryChains()
//
// THE RULE THIS FOLDER KEEPS, KEPT HERE TOO: every parser below THROWS when it
// cannot find what it is looking for. A parser that shrugs and returns an empty
// list turns every assertion built on it into a tautology, which is worse than
// a red build — it is a green build that proves nothing. That is the exact
// failure this whole suite was re-audited for.
// =============================================================================

import { readRepoSource } from "./boldsign-source";

export { readRepoSource };

// ---------------------------------------------------------------------------
// Comment blanking
// ---------------------------------------------------------------------------

/**
 * Replace every comment with spaces of the same length, keeping newlines.
 *
 * Length-preserving because everything below works in character offsets — "does
 * the auth check sit ABOVE the first database call" is an offset comparison, and
 * anything that shortens the text invalidates it.
 *
 * This exists rather than importing `blankComments` from tests/helpers only so
 * this file has no dependency on a helper it is not allowed to edit; the
 * behaviour is deliberately identical, string literals tracked so the `//` in a
 * `https://` URL is not read as a comment.
 *
 * It matters more here than anywhere: these routes are heavily commented and
 * several comments NAME the very things being asserted. `route.ts` contains the
 * prose "Trusting body.tenantId from the client is fragile" — a scan that did
 * not blank comments would count that sentence as a use of `body.tenantId` and
 * report the file as one occurrence safer than it is.
 */
export function blankComments(s: string): string {
  const out = s.split("");
  let i = 0;
  const blankTo = (end: number) => {
    for (let k = i; k < end && k < out.length; k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    if (c === "/" && next === "/") {
      const end = s.indexOf("\n", i);
      blankTo(end === -1 ? s.length : end);
      i = end === -1 ? s.length : end;
    } else if (c === "/" && next === "*") {
      const end = s.indexOf("*/", i + 2);
      const stop = end === -1 ? s.length : end + 2;
      blankTo(stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      i += 1;
      while (i < s.length && s[i] !== c) i += s[i] === "\\" ? 2 : 1;
      i += 1;
    } else {
      i += 1;
    }
  }
  return out.join("");
}

/** Comment-blanked source of a repo file, by repo-relative path. */
export function readRoute(relPath: string): string {
  return blankComments(readRepoSource(relPath));
}

// ---------------------------------------------------------------------------
// 1. The method contract
// ---------------------------------------------------------------------------

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * The HTTP methods a Next route handler accepts, read off its exports.
 *
 * Both spellings Next recognises are handled:
 *   `export async function POST(...)`
 *   `export const POST = ...`
 *
 * Throws when a route file exports NO method handler at all, because that is
 * not "a route that accepts nothing" — it is a parse that failed, or a file
 * that stopped being a route. Either way an empty list would silently satisfy
 * a "does not accept DELETE" assertion for the wrong reason.
 */
export function exportedHttpMethods(relPath: string): HttpMethod[] {
  const src = readRoute(relPath);
  const re = new RegExp(
    `export\\s+(?:async\\s+)?(?:function\\s+|const\\s+)(${HTTP_METHODS.join("|")})\\b`,
    "g",
  );
  const found = [...new Set([...src.matchAll(re)].map((m) => m[1] as HttpMethod))];
  if (!found.length) {
    throw new Error(
      `${relPath} exports no HTTP method handler.\n` +
        `  A Next route file must export at least one of ${HTTP_METHODS.join("/")}.\n` +
        `  Either the file stopped being a route (FAILURE MODE (a) — say so and move\n` +
        `  the test), or this parser no longer recognises how the handler is written.\n` +
        `  It throws rather than returning [] on purpose: an empty method list makes\n` +
        `  every "this route does not accept X" assertion pass for the wrong reason.`,
    );
  }
  return found.sort() as HttpMethod[];
}

// ---------------------------------------------------------------------------
// 2. Does the route establish WHO is calling?
// ---------------------------------------------------------------------------

/**
 * Every way a Next route in THIS repo could identify its caller.
 *
 * Deliberately broad — the point of the sweep is to be unable to miss an auth
 * check that exists, so that reporting "there is none" is a statement worth
 * trusting. A false positive here is cheap (a test starts asserting something);
 * a false negative would print a finding that is not real.
 *
 * The list is drawn from what the rest of this repo actually uses to authorise:
 * the two Supabase auth entry points, the SSR cookie clients, the RBAC helpers,
 * the `Authorization` header, and the `x-tenant-slug` header the portal proxy
 * injects.
 */
export const AUTH_MARKERS: { marker: RegExp; what: string }[] = [
  { marker: /supabase\.auth\b/, what: "supabase.auth.*" },
  { marker: /\bgetUser\s*\(/, what: "getUser()" },
  { marker: /\bgetSession\s*\(/, what: "getSession()" },
  { marker: /createServerClient\s*\(/, what: "createServerClient() (SSR cookie client)" },
  { marker: /createRouteHandlerClient\s*\(/, what: "createRouteHandlerClient()" },
  { marker: /\bcookies\s*\(\s*\)/, what: "cookies()" },
  { marker: /headers\s*\(\s*\)\s*\.\s*get\s*\(\s*['"]authorization/i, what: "headers().get('authorization')" },
  { marker: /\.headers\s*\.\s*get\s*\(\s*['"]authorization/i, what: "request.headers.get('authorization')" },
  { marker: /['"]x-tenant-slug['"]/, what: "the x-tenant-slug header" },
  { marker: /\bapp_users\b/, what: "an app_users lookup (the portal's staff table)" },
  { marker: /manager_permissions/, what: "a manager_permissions check" },
  { marker: /\bis_super_admin\b/, what: "an is_super_admin check" },
  { marker: /getAuthenticatedUser|requireAuth|assertAuth|withAuth/, what: "an auth wrapper" },
];

/** Which of `AUTH_MARKERS` this route contains. Empty means: it authenticates nobody. */
export function authMarkers(relPath: string): string[] {
  const src = readRoute(relPath);
  return AUTH_MARKERS.filter(({ marker }) => marker.test(src)).map(({ what }) => what);
}

// ---------------------------------------------------------------------------
// 3. Query chains, and whether they are scoped to a tenant
// ---------------------------------------------------------------------------

export interface QueryChain {
  /** The table named in `.from('x')`. */
  table: string;
  /** `write` when the chain contains insert/update/upsert/delete, else `read`. */
  op: "read" | "write";
  /** Does the chain carry `.eq('tenant_id', ...)`? */
  tenantScoped: boolean;
  /** Does it address a single row by primary key — `.eq('id', ...)`? */
  byId: boolean;
  /** 1-based line number of the `.from(...)`, so a failure can be opened. */
  line: number;
  /** The chain text, trimmed, for a failure message. */
  text: string;
}

/**
 * Every `supabase.from('table')…` chain in a route, with its tenant scoping.
 *
 * A chain runs from `.from(` to the first `;` at bracket depth zero. Brace
 * counting rather than a lazy regex: these chains span many lines and contain
 * nested object literals (`.insert({ ... })`), and `[\s\S]*?;` stops at the
 * first semicolon inside the literal, which is never the end of the chain.
 *
 * Throws when a route contains no chain at all. All six e-sign routes query the
 * database; a route that suddenly parses to zero chains has been reshaped, and
 * "no unscoped queries found" would then be a lie of omission.
 */
export function queryChains(relPath: string): QueryChain[] {
  const src = readRoute(relPath);
  const out: QueryChain[] = [];

  for (const m of src.matchAll(/\.from\(\s*['"]([a-zA-Z_][\w]*)['"]\s*\)/g)) {
    const start = m.index!;
    let depth = 0;
    let i = start;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (c === "(" || c === "{" || c === "[") depth += 1;
      else if (c === ")" || c === "}" || c === "]") depth -= 1;
      else if (c === ";" && depth <= 0) break;
    }
    const text = src.slice(start, i);
    out.push({
      table: m[1],
      op: /\.(insert|update|upsert|delete)\s*\(/.test(text) ? "write" : "read",
      tenantScoped: /\.eq\(\s*['"]tenant_id['"]/.test(text),
      byId: /\.eq\(\s*['"]id['"]/.test(text),
      line: src.slice(0, start).split("\n").length,
      text: text.replace(/\s+/g, " ").trim().slice(0, 160),
    });
  }

  if (!out.length) {
    throw new Error(
      `${relPath} contains no supabase .from(...) chain.\n` +
        `  Every e-sign route reads the database. Zero chains means the route was\n` +
        `  reshaped (FAILURE MODE (a)) or this parser stopped recognising the calls —\n` +
        `  and an empty list would make "nothing is unscoped here" pass for the wrong\n` +
        `  reason. Fix the parser or move the test; do not accept the empty result.`,
    );
  }
  return out;
}

/** `.from(...)` chains on the tables that carry one tenant's business data. */
export const TENANT_OWNED_TABLES = [
  "rentals",
  "rental_agreements",
  "customers",
  "customer_documents",
  "customer_users",
  "customer_notifications",
  "rental_additional_drivers",
  "rental_key_handovers",
  "installment_plans",
  "scheduled_installments",
  "identity_verifications",
  "agreement_templates",
];

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * First offset of each marker, or -1.
 *
 * Order is the whole point of several assertions here: a guard that runs after
 * the document has been revoked is not a guard, and a row marked `voided`
 * before BoldSign confirms the revoke is a lie the operator acts on.
 */
export function positionsOf(src: string, markers: Record<string, string | RegExp>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, needle] of Object.entries(markers)) {
    out[name] = typeof needle === "string" ? src.indexOf(needle) : (needle.exec(src)?.index ?? -1);
  }
  return out;
}

/**
 * Assert every marker was found, naming the ones that were not.
 *
 * A `-1` silently compares as "earliest", so an ordering assertion built on a
 * marker that no longer exists passes while proving nothing. This is the guard
 * against that, and every ordering test below calls it first.
 */
export function requireAllFound(
  at: Record<string, number>,
  label: string,
): void {
  const gone = Object.entries(at).filter(([, v]) => v === -1).map(([k]) => k);
  if (gone.length) {
    throw new Error(
      `${label}: ${gone.length} anchor(s) no longer appear in the source: ${gone.join(", ")}.\n` +
        `  An ordering assertion cannot run against a marker that is not there — a\n` +
        `  missing anchor reads as offset -1, which sorts BEFORE everything and would\n` +
        `  make the order test pass for the wrong reason.\n` +
        `  THIS IS FAILURE MODE (a): the route was edited. Re-anchor the test on\n` +
        `  whatever replaced it, or delete the assertion if the step is genuinely gone.`,
    );
  }
}

// ---------------------------------------------------------------------------
// The deployed-schema snapshot — the only evidence in this repo of what is
// actually running in the production database.
// ---------------------------------------------------------------------------

export interface BaselineTrigger {
  table_name: string;
  name: string;
  function_name: string;
  timing: string;
  events: string;
  enabled: string;
}

interface Baseline {
  schema: {
    tables: Record<string, { rls: boolean }>;
    triggers: Record<string, BaselineTrigger>;
  };
  edgeFunctions: Record<string, unknown>;
}

let baselineCache: Baseline | null = null;

/**
 * `scripts/v1-check/baseline.json` — the committed snapshot of the live schema.
 *
 * It matters for one specific reason. This repo keeps migration FILES, but
 * V2_PLAN.md §6 is explicit that a migration file is not proof of deployment,
 * and several structures in this system were applied through the Management API
 * with no migration at all. The baseline is taken FROM the running database, so
 * it is the only thing here that can answer "is that trigger actually live" —
 * which is the whole question when the trigger is the only path by which an
 * operator is told an agreement was signed.
 */
export function readBaseline(): Baseline {
  if (baselineCache) return baselineCache;
  const raw = readRepoSource("scripts/v1-check/baseline.json");
  const parsed = JSON.parse(raw) as Baseline;
  if (!parsed?.schema?.triggers || !parsed?.schema?.tables) {
    throw new Error(
      "scripts/v1-check/baseline.json has no schema.triggers / schema.tables.\n" +
        "  The snapshot format changed. Re-point these tests at the new shape rather\n" +
        "  than dropping them — the baseline is the only evidence in this repo of what\n" +
        "  is deployed, as opposed to what a migration file says should be.",
    );
  }
  baselineCache = parsed;
  return parsed;
}

/** One trigger from the deployed snapshot, by `table.trigger_name`. Throws if absent. */
export function baselineTrigger(key: string): BaselineTrigger {
  const t = readBaseline().schema.triggers[key];
  if (!t) {
    throw new Error(
      `No trigger \`${key}\` in the deployed-schema snapshot ` +
        `(scripts/v1-check/baseline.json).\n` +
        `  Either it was dropped from the live database, or the snapshot is stale.\n` +
        `  Both matter: this trigger is a delivery path, and a delivery path that is\n` +
        `  not deployed fails silently by definition.`,
    );
  }
  return t;
}

// ---------------------------------------------------------------------------
// Readable failures on large files
// ---------------------------------------------------------------------------

/**
 * Is `needle` in `src`?
 *
 * Exists purely so an assertion about a 2,000-line route fails READABLY.
 * `expect(wholeRouteSource, msg).toContain('X')` prints the entire file as the
 * "received" value, and the message — the part that says which failure mode
 * this is and what to do — scrolls off the top. The team lead's rule is that a
 * failure which does not tell you which mode it is has failed at its job; a
 * failure that tells you and then buries it under two thousand lines has failed
 * the same way, more slowly.
 *
 * So the subject becomes a boolean and the needle goes in the message. Use it
 * wherever the subject is a whole file; a short, already-scoped slice reads
 * fine with `toContain` and does not need it.
 */
export function present(src: string, needle: string | RegExp): boolean {
  return typeof needle === "string" ? src.includes(needle) : needle.test(src);
}
