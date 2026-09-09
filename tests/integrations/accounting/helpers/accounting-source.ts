// =============================================================================
// accounting-source.ts — the contract reader for the four OAuth functions.
//
// WHY THIS EXISTS AND helpers/edge-contract.ts DOES NOT SUFFICE
// -------------------------------------------------------------
// The shared helper parses three body shapes and THROWS on a fourth, on
// purpose: "an unparsed function silently contributes zero fields and makes
// every contract assertion against it pass for the wrong reason". All four
// accounting functions are that fourth shape, and it throws on every one of
// them. Verified, not assumed:
//
//   readEdgeFunction("xero-oauth-start")     -> "could not find where the
//   readEdgeFunction("zoho-oauth-start")         request body is parsed"
//   readEdgeFunction("xero-oauth-callback")  -> same
//   readEdgeFunction("zoho-oauth-callback")  -> same
//
// Two distinct reasons, and both matter:
//
//   1. THE START FUNCTIONS parse the body but never annotate the variable:
//
//          const body = (await req.json().catch(() => ({}))) as Payload;
//
//      The shared parser looks for `let body: T` / `const body: T` (a COLON) or
//      a destructure `const { a } = await req.json()`. An `as` cast is neither.
//      It also cannot see the fields these functions read through an INLINE
//      cast, which is how both of them read `tenantSlug`:
//
//          (body as { tenantSlug?: string }).tenantSlug
//
//      That field is absent from the `Payload` interface entirely, so a parser
//      that only read the declared type would report a contract the portal
//      does not send — and `tenantSlug` is the field that decides WHICH
//      TENANT'S BOOKS get connected for a super admin. It cannot be invisible.
//
//   2. THE CALLBACKS HAVE NO BODY AT ALL. They are the provider's redirect
//      target: a browser GET, with `code`, `state` and `error` in the QUERY
//      STRING. `req.json()` is never called, so there is nothing for a
//      body parser to find and the concept of a "payload contract" does not
//      apply to them. Their contract is the query string, and that is what
//      this file derives instead.
//
// tests/helpers/** is shared and must not be edited from this folder, so the
// parser lives here. It follows the same rule as the one it stands in for:
// an unrecognised shape THROWS. A silent zero would make every assertion in
// this folder pass against nothing, which is strictly worse than a red build.
// =============================================================================

import { blankComments, readEdgeFunctionSource } from "../../../helpers/edge-contract";

export type FieldOrigin =
  | "declared-type"
  | "member-access"
  | "inline-cast"
  | "query-param";

/** How a function receives its inputs. Decides which parse rule must fire. */
export type RequestKind = "json-body" | "query-string";

export interface AccountingShape {
  /** Function directory name, e.g. "xero-oauth-start". */
  fn: string;
  /** Repo-relative path, for failure messages a human can open. */
  file: string;
  /** Source with comments blanked. Offsets are preserved, so order holds. */
  src: string;
  /** Raw source, comments intact. Only for tests that read prose deliberately. */
  raw: string;
  kind: RequestKind;
  /** The declared request interface name, or null for a query-string function. */
  typeName: string | null;
  /** Every input name this function can read. Sorted. */
  fields: string[];
  /** Declared WITHOUT `?` on the request interface. Body functions only. */
  requiredByType: string[];
  /** Which parse rule produced each field. Used to word failures precisely. */
  origin: Record<string, FieldOrigin[]>;
}

const cache = new Map<string, AccountingShape>();

/* -------------------------------------------------------------------------
 * Minimal TypeScript-shape reading. Deliberately a copy of the ideas in
 * edge-contract.ts rather than an import: those internals are not exported,
 * and this folder may not edit the shared file to export them.
 * ---------------------------------------------------------------------- */

function balancedBlock(src: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < src.length; i += 1) {
    const c = src[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openIndex + 1, i);
    }
  }
  throw new Error("Unbalanced brace while reading a request type");
}

/** Top-level members of an object type body, depth-aware. */
function membersOf(block: string): { name: string; optional: boolean }[] {
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const out: { name: string; optional: boolean }[] = [];
  let depth = 0;
  let lineStart = 0;
  for (let i = 0; i <= clean.length; i += 1) {
    const c = clean[i];
    if (c === "{" || c === "(" || c === "[") depth += 1;
    else if (c === "}" || c === ")" || c === "]") depth -= 1;
    const isBreak =
      i === clean.length || ((c === ";" || c === "," || c === "\n") && depth === 0);
    if (!isBreak) continue;
    const segment = clean.slice(lineStart, i);
    lineStart = i + 1;
    const m = /^\s*(?:readonly\s+)?["']?([A-Za-z_$][\w$]*)["']?\s*(\?)?\s*:/.exec(segment);
    if (m) out.push({ name: m[1], optional: Boolean(m[2]) });
  }
  return out;
}

function findNamedType(src: string, name: string): string | null {
  const iface = new RegExp(`\\binterface\\s+${name}\\s*(?:extends[^{]+)?\\{`).exec(src);
  if (iface) return balancedBlock(src, iface.index + iface[0].length - 1);
  const alias = new RegExp(`\\btype\\s+${name}\\s*=\\s*\\{`).exec(src);
  if (alias) return balancedBlock(src, alias.index + alias[0].length - 1);
  return null;
}

/**
 * Read one accounting OAuth function's input contract out of its own source.
 *
 * `kind` is passed in rather than sniffed, so that a callback rewritten to take
 * a JSON body (or a start function rewritten to take query params) fails here
 * loudly instead of quietly parsing as the other thing.
 */
export function readAccountingFunction(fn: string, kind: RequestKind): AccountingShape {
  const key = `${fn}:${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const raw = readEdgeFunctionSource(fn);
  // Comments out, offsets intact. Everything below reads code, not prose —
  // these four files are more comment than code in places, and the callbacks'
  // comments name `code`, `state` and `client_secret` repeatedly.
  const src = blankComments(raw);
  const file = `supabase/functions/${fn}/index.ts`;

  const origin: Record<string, FieldOrigin[]> = {};
  const add = (name: string, from: FieldOrigin) => {
    const seen = (origin[name] ??= []);
    if (!seen.includes(from)) seen.push(from);
  };

  let typeName: string | null = null;
  const requiredByType: string[] = [];

  if (kind === "query-string") {
    // `url.searchParams.get("code")`. Anchored on the `url` identifier so the
    // `new URLSearchParams(...).get("reason")` inside the redirect() helper —
    // which reads a string this function BUILT, not one it received — is not
    // counted as an input.
    for (const m of src.matchAll(
      /\burl\s*\.\s*searchParams\s*\.\s*get\(\s*["']([^"']+)["']\s*\)/g,
    )) {
      add(m[1], "query-param");
    }
    if (Object.keys(origin).length === 0) {
      throw new Error(
        `${fn}: parsed ZERO query parameters out of ${file}.\n` +
          `  This helper reads \`url.searchParams.get("x")\`. If the function now reads\n` +
          `  its inputs another way — a different variable name, a destructured\n` +
          `  URLSearchParams, a JSON body — teach this parser rather than deleting the\n` +
          `  test. An unparsed function contributes zero fields and makes every\n` +
          `  assertion in this folder pass for the wrong reason.`,
      );
    }
  } else {
    // ---- `const body = <anything containing req.json()> as Payload;` --------
    const decl =
      /(?:const|let)\s+body\s*(?::\s*[A-Za-z_$][\w$]*\s*)?=\s*([^;]*\breq\s*\.\s*json\s*\([^;]*)/.exec(
        src,
      );
    if (!decl) {
      throw new Error(
        `${fn}: could not find where the request body is parsed in ${file}.\n` +
          `  This helper knows one shape — \`const body = <expr with req.json()> as T\` —\n` +
          `  because that is what both *-oauth-start functions use. The shared\n` +
          `  tests/helpers/edge-contract.ts knows three OTHER shapes and throws on this\n` +
          `  one, which is why this file exists at all. Teach whichever parser is\n` +
          `  closest; do not delete the test.`,
      );
    }

    const asCast = /\bas\s+([A-Za-z_$][\w$]*)/.exec(decl[1]);
    if (asCast) {
      typeName = asCast[1];
      const block = findNamedType(src, typeName);
      if (block) {
        for (const m of membersOf(block)) {
          add(m.name, "declared-type");
          if (!m.optional) requiredByType.push(m.name);
        }
      }
    }

    // ---- `(body as { tenantSlug?: string }).tenantSlug` --------------------
    // Read BEFORE the plain member-access sweep so the inline-cast origin is
    // recorded even though the same text also matches `body ... . name`.
    for (const m of src.matchAll(
      /\(\s*body\s+as\s+\{([^}]*)\}\s*\)\s*\??\s*\.\s*([A-Za-z_$][\w$]*)/g,
    )) {
      add(m[2], "inline-cast");
      for (const inner of membersOf(m[1])) add(inner.name, "inline-cast");
    }

    // ---- `body.x` / `body?.x` ---------------------------------------------
    for (const m of src.matchAll(/\bbody\s*\??\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
      add(m[1], "member-access");
    }

    if (Object.keys(origin).length === 0) {
      throw new Error(
        `${fn}: parsed ZERO request fields out of ${file}, but the body IS parsed.\n` +
          `  The function reads nothing off it, or it reads it in a shape this helper\n` +
          `  does not recognise. Either way a zero-field contract asserts nothing.`,
      );
    }
  }

  const shape: AccountingShape = {
    fn,
    file,
    src,
    raw,
    kind,
    typeName,
    fields: Object.keys(origin).sort(),
    requiredByType: [...new Set(requiredByType)].sort(),
    origin,
  };
  cache.set(key, shape);
  return shape;
}

/* =========================================================================
 * THE PROVIDER TABLE
 *
 * "Zoho–Xero toh ek hi hai na takreeban, woh cases toh EK HI BANENGE."
 *
 * The cases are written once and driven over this table. What the table does
 * NOT do is pretend the two providers are the same function with a different
 * name — the fields below that differ (`region`, `extraAuthorizeParams`,
 * `scopeSeparator`, `callbackQueryFields`) are exactly the places where a
 * naive shared suite would assert something false about one of them, so each
 * difference is DECLARED here and asserted in provider-asymmetry.test.ts
 * rather than averaged away.
 * ====================================================================== */

export interface RegionSupport {
  /** The body field the portal sends. */
  bodyField: string;
  /** What zoho-oauth-start's ALLOWED_REGIONS accepts. */
  allowed: readonly string[];
  /** The default applied when the caller omits it. */
  fallback: string;
}

export interface ProviderSpec {
  id: "xero" | "zoho";
  label: string;
  startFn: string;
  callbackFn: string;
  /** Where the portal actually builds the start payload. */
  builtIn: string;
  /** Exactly what the portal puts on the wire. Keys are what is asserted. */
  startPayload: Record<string, unknown>;
  /** Zoho only. `null` states plainly that Xero has no data-centre concept. */
  region: RegionSupport | null;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** The 403 the role gate returns. Verbatim, because the live case reads it. */
  roleRefusal: string;
  /** The tenants column the callback flips on success. */
  tenantFlag: string;
  /** How the provider wants its scope list joined. NOT the same for the two. */
  scopeSeparator: string;
  /** Authorize-URL params this provider needs and the other does not. */
  extraAuthorizeParams: readonly string[];
  /** Query params the callback reads beyond code/state/error. */
  extraCallbackParams: readonly string[];
  /** The `provider` literal written to accounting_oauth_state by start. */
  stateProvider: string;
}

export const PROVIDERS: readonly ProviderSpec[] = [
  {
    id: "xero",
    label: "Xero",
    startFn: "xero-oauth-start",
    callbackFn: "xero-oauth-callback",
    builtIn:
      "apps/portal/src/app/(dashboard)/integrations/_panels/xero-data.ts (useConnectXero)",
    startPayload: {
      redirectBack: "https://test.portal.drive-247.com/integrations?xero=connected",
      tenantSlug: "test",
    },
    region: null,
    clientIdEnv: "XERO_CLIENT_ID",
    clientSecretEnv: "XERO_CLIENT_SECRET",
    roleRefusal: "Only admin or head_admin can connect Xero",
    tenantFlag: "integration_xero",
    // Xero's identity server takes ONE space-separated scope string.
    scopeSeparator: " ",
    extraAuthorizeParams: [],
    extraCallbackParams: [],
    stateProvider: "xero",
  },
  {
    id: "zoho",
    label: "Zoho Books",
    startFn: "zoho-oauth-start",
    callbackFn: "zoho-oauth-callback",
    builtIn:
      "apps/portal/src/app/(dashboard)/integrations/_panels/zoho.tsx (connect mutation)",
    startPayload: {
      region: "com",
      redirectBack: "https://test.portal.drive-247.com/integrations?provider=zoho&status=success",
      tenantSlug: "test",
    },
    region: {
      bodyField: "region",
      allowed: ["com", "eu", "in", "com.au", "jp", "sa"],
      fallback: "com",
    },
    clientIdEnv: "ZOHO_CLIENT_ID",
    clientSecretEnv: "ZOHO_CLIENT_SECRET",
    roleRefusal: "Only admin or head_admin can connect Zoho",
    tenantFlag: "integration_zoho_books",
    // Zoho Books takes a COMMA-separated scope list. Swapping the two
    // separators breaks consent at the provider, silently, for new connections.
    scopeSeparator: ",",
    extraAuthorizeParams: ["access_type", "prompt"],
    // Zoho tells us which data centre owns the account on the way back.
    extraCallbackParams: ["location", "accounts-server"],
    stateProvider: "zoho",
  },
] as const;

export function providerById(id: "xero" | "zoho"): ProviderSpec {
  const hit = PROVIDERS.find((p) => p.id === id);
  if (!hit) throw new Error(`No provider spec for "${id}"`);
  return hit;
}

/* =========================================================================
 * Contract diffing, in the suite's own wording.
 *
 * tests/README.md §5: a failure that does not say WHICH of the two failure
 * modes it is has failed at its job. A source-derived contract test never
 * touches the network and can therefore only ever see mode (a).
 * ====================================================================== */

export interface ContractDrift {
  extra: string[];
  missing: string[];
}

export function diffStartContract(p: ProviderSpec, shape: AccountingShape): ContractDrift {
  const sent = new Set(Object.keys(p.startPayload));
  const read = new Set(shape.fields);
  return {
    extra: [...sent].filter((k) => !read.has(k)).sort(),
    missing: [...read].filter((k) => !sent.has(k)).sort(),
  };
}

export function describeStartDrift(
  p: ProviderSpec,
  shape: AccountingShape,
  drift: ContractDrift,
): string {
  const lines: string[] = ["", `CONTRACT DRIFT — ${p.startFn} (integrations/accounting)`, ""];

  if (drift.extra.length) {
    lines.push(
      `  The portal sends ${drift.extra.length} field(s) that ${p.startFn} does not read:`,
      ...drift.extra.map((f) => `    - ${f}`),
      "",
      `  WHICH SIDE MOVED: the EDGE FUNCTION. ${shape.file} no longer reads`,
      `  ${drift.extra.map((f) => `\`${f}\``).join(", ")}, but the contract in this test still declares it.`,
      "",
    );
  }

  if (drift.missing.length) {
    lines.push(
      `  ${p.startFn} reads ${drift.missing.length} field(s) that nothing sends:`,
      ...drift.missing.map((f) => `    - ${f}  (${(shape.origin[f] ?? []).join(", ")})`),
      "",
      `  WHICH SIDE MOVED: the EDGE FUNCTION grew a field, or the CLIENT dropped one.`,
      `  ${p.builtIn} builds the payload; ${shape.file} reads it.`,
      "",
    );
  }

  lines.push(
    "  THIS IS FAILURE MODE (a): a developer changed a field. It is the healthy,",
    "  expected failure. Nothing is broken for a paying operator right now — fix",
    "  whichever side is wrong and the build goes green.",
    "",
    "  It is NOT failure mode (b) — 'the edge function itself is returning 400/401'.",
    "  A contract test never touches the network and cannot see a status code. The",
    "  Layer 2 cases at the bottom of oauth-start.test.ts are what catch mode (b).",
    "",
  );
  return lines.join("\n");
}

export function assertStartContract(p: ProviderSpec): AccountingShape {
  const shape = readAccountingFunction(p.startFn, "json-body");
  const drift = diffStartContract(p, shape);
  if (drift.extra.length || drift.missing.length) {
    throw new Error(describeStartDrift(p, shape, drift));
  }
  return shape;
}

/* =========================================================================
 * Order helpers.
 *
 * Half the assertions in this folder are about ORDER, for the same reason the
 * Stripe refund test's are: a guard that runs after the irreversible step is
 * not a guard. Here the irreversible step is redeeming the one-time
 * authorization code — once it is spent the operator has to start the consent
 * round-trip again, and every check that was supposed to protect it ran too
 * late to matter.
 * ====================================================================== */

/** Index of `needle` in the comment-blanked source, or -1. */
export function at(shape: AccountingShape, needle: string | RegExp): number {
  if (typeof needle === "string") return shape.src.indexOf(needle);
  const m = needle.exec(shape.src);
  return m ? m.index : -1;
}

/** Index of `needle`, throwing a named failure when it is gone entirely. */
export function requireAt(shape: AccountingShape, needle: string | RegExp, what: string): number {
  const idx = at(shape, needle);
  if (idx < 0) {
    throw new Error(
      `\n  ${what} is GONE from ${shape.file}.\n` +
        `  Looked for: ${String(needle)}\n` +
        `  Either it was renamed (failure mode (a) — retarget this assertion) or it\n` +
        `  was deleted (failure mode (b) — the guard this folder exists to protect is\n` +
        `  no longer in the function).`,
    );
  }
  return idx;
}

/**
 * Read the column list of the `.select(...)` that follows a given `.from(...)`.
 *
 * Not cosmetic. `zoho-oauth-callback` decides "has this nonce expired?" with
 *
 *     new Date(stateRow.expires_at).getTime() < Date.now()
 *
 * and if `expires_at` were dropped from the select, `stateRow.expires_at` is
 * `undefined`, `new Date(undefined).getTime()` is `NaN`, and `NaN < Date.now()`
 * is FALSE. The nonce would then never expire — a guard that fails OPEN with no
 * error anywhere. Asserting the column is selected is the cheapest way to pin
 * a dependency that is invisible at the comparison itself.
 */
export function selectedColumnsAfterFrom(shape: AccountingShape, table: string): string[] {
  const fromAt = shape.src.indexOf(`.from("${table}")`);
  if (fromAt < 0) return [];
  const sel = /\.select\(\s*["']([^"']*)["']/.exec(shape.src.slice(fromAt));
  if (!sel) return [];
  return sel[1]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}
