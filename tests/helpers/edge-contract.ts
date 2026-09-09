// =============================================================================
// edge-contract.ts — read an edge function's REQUEST SHAPE out of its source.
//
// WHY THIS PARSES SOURCE INSTEAD OF LISTING FIELDS BY HAND
// --------------------------------------------------------
// A test that hardcodes both sides of a contract only ever proves that one
// developer typed the same list twice. The point of these tests is to catch the
// moment the two sides STOP agreeing, so exactly one side may be written down
// by hand — the payload the browser builds — and the other side has to be
// derived from `supabase/functions/<fn>/index.ts` itself. Then a field removed
// from the function shows up here on the next run, with no one having
// remembered to update a list.
//
// It is a regex parser, not the TypeScript compiler, and that is deliberate:
// these files are Deno modules with `https://esm.sh/...` imports that no Node
// type-checker in this repo can resolve. It handles the three request-parsing
// shapes actually used across supabase/functions:
//
//   1. `let body: BeginRequest;      body = (await req.json()) as BeginRequest;`
//   2. `let body: { slug?: string }; body = await req.json();`
//   3. `const { rentalId, reason }: RefundRequest = await req.json();`
//
// If a fourth shape appears, `readEdgeFunction` throws rather than silently
// returning an empty field set — an empty set would make every contract test
// pass for the wrong reason, which is worse than a red build.
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** tests/helpers -> tests -> repo root */
export const REPO_ROOT = join(HERE, "..", "..");
export const FUNCTIONS_DIR = join(REPO_ROOT, "supabase", "functions");

export type FieldOrigin = "declared-type" | "destructured" | "member-access";

export interface EdgeFunctionShape {
  /** Function directory name, e.g. "signup-begin". */
  fn: string;
  /** Repo-relative path, for failure messages a human can open. */
  file: string;
  /** The request interface name, "(inline)" for an inline object type. */
  typeName: string | null;
  /** Every field name this function can read off the JSON body. Sorted. */
  fields: string[];
  /** Declared WITHOUT `?`. Type-level only — see the note in `requiredByType`. */
  requiredByType: string[];
  /** Fields the function names in a 400 detail (`{ field: "slug" }`). */
  validated: string[];
  /** Which parsing rule produced each field. Used to word failures precisely. */
  origin: Record<string, FieldOrigin[]>;
}

/** Cheap memo: five test files read the same four functions. */
const cache = new Map<string, EdgeFunctionShape>();

/**
 * Replace every comment with spaces of the same length, keeping newlines.
 *
 * WHY LENGTH-PRESERVING: the parser works in character offsets (where the
 * handler starts, where `body` is re-declared), so anything that shortens the
 * text invalidates them.
 *
 * WHY AT ALL: prose is not code, and these files are heavily commented. Without
 * this, `process-refund`'s comment
 *
 *     // The RENTAL decides which tenant's Stripe account is used, not the
 *     // request body. Preferring a caller-supplied tenantId let a caller ...
 *
 * makes `body. Preferring` match the member-access pattern, and the function is
 * reported as reading a request field called `Preferring`. Real bug, found by
 * the first run.
 *
 * String literals are tracked so the `//` in `https://esm.sh/...` — which every
 * one of these functions imports from — is not mistaken for a comment.
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

/**
 * Extract a balanced `{ ... }` block starting at `openIndex` (which must be the
 * index of the `{`). Returns the inner text, braces excluded.
 */
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

/**
 * Top-level member names of a TypeScript object-type body.
 *
 * Depth-aware, because `ProvisionRequest.operatingSchedule` is a nested object
 * type and its inner `days` / `opensAt` fields are NOT top-level request fields.
 * Comments are stripped first so a field name mentioned in prose does not become
 * a phantom member.
 */
function membersOf(block: string): { name: string; optional: boolean }[] {
  const clean = block
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  const out: { name: string; optional: boolean }[] = [];
  let depth = 0;
  let lineStart = 0;

  for (let i = 0; i <= clean.length; i += 1) {
    const c = clean[i];
    if (c === "{" || c === "(" || c === "[") depth += 1;
    else if (c === "}" || c === ")" || c === "]") depth -= 1;

    // A member ends at a `;`, a `,` or a newline that sits at nesting depth 0.
    const isBreak = i === clean.length || ((c === ";" || c === "," || c === "\n") && depth === 0);
    if (!isBreak) continue;

    const segment = clean.slice(lineStart, i);
    lineStart = i + 1;
    const m = /^\s*(?:readonly\s+)?["']?([A-Za-z_$][\w$]*)["']?\s*(\?)?\s*:/.exec(segment);
    if (m) out.push({ name: m[1], optional: Boolean(m[2]) });
  }
  return out;
}

/** Find `interface Name {` or `type Name = {` anywhere in the file. */
function findNamedType(src: string, name: string): string | null {
  const iface = new RegExp(`\\binterface\\s+${name}\\s*(?:extends[^{]+)?\\{`).exec(src);
  if (iface) return balancedBlock(src, iface.index + iface[0].length - 1);
  const alias = new RegExp(`\\btype\\s+${name}\\s*=\\s*\\{`).exec(src);
  if (alias) return balancedBlock(src, alias.index + alias[0].length - 1);
  return null;
}

/**
 * Raw source of an edge function.
 *
 * Exported because a couple of properties worth pinning are not field names —
 * "does this endpoint still refuse an unauthenticated caller", for instance.
 * Reading the source is a blunt way to assert that, and it is honest about
 * being blunt: it cannot run the code, only check that the guard is still
 * written down.
 */
export function readEdgeFunctionSource(fn: string): string {
  const file = join(FUNCTIONS_DIR, fn, "index.ts");
  if (!existsSync(file)) {
    throw new Error(
      `No edge function at ${relative(REPO_ROOT, file)}.\n` +
        `Either the function was renamed or deleted, or this test names it wrongly.`,
    );
  }
  return readFileSync(file, "utf8");
}

export function readEdgeFunction(fn: string): EdgeFunctionShape {
  const hit = cache.get(fn);
  if (hit) return hit;

  const file = join(FUNCTIONS_DIR, fn, "index.ts");
  // Comments out, offsets intact. Everything below reads code, not prose.
  const src = blankComments(readEdgeFunctionSource(fn));

  // Only look inside the request handler. `signup-begin` has a helper above it
  // that does `const body = await res.json()` on a GoTrue response, and its
  // `body?.users` would otherwise be reported as a request field.
  const handlerAt = (() => {
    const m = /(?:Deno\.serve|\bserve)\s*\(\s*async/.exec(src);
    return m ? m.index : 0;
  })();
  const handler = src.slice(handlerAt);

  const origin: Record<string, FieldOrigin[]> = {};
  const add = (name: string, from: FieldOrigin) => {
    const seen = (origin[name] ??= []);
    // De-duplicated: `body.slug` appearing twice in the handler is not two
    // separate reasons the field exists, and printing it twice in a failure
    // message makes the message look like a bug.
    if (!seen.includes(from)) seen.push(from);
  };

  let typeName: string | null = null;
  let typeBlock: string | null = null;
  let parseIndex = -1;
  let destructured: string[] = [];

  // --- shape 3: `const { a, b }: T = await req.json()` ----------------------
  const destructure =
    /(?:const|let)\s*\{([\s\S]*?)\}\s*(?::\s*([^=]+?))?=\s*await\s+req\.json\(\)/.exec(handler);

  // --- shapes 1 & 2: a `body` variable with a type annotation --------------
  const declared = /(?:let|const)\s+body\s*:\s*(\{|[A-Za-z_$][\w$]*)/.exec(handler);

  if (declared) {
    parseIndex = declared.index;
    if (declared[1] === "{") {
      typeName = "(inline)";
      typeBlock = balancedBlock(handler, declared.index + declared[0].length - 1);
    } else {
      typeName = declared[1];
      typeBlock = findNamedType(src, typeName);
      if (!typeBlock) {
        throw new Error(
          `${fn}: body is declared as \`${typeName}\` but no \`interface ${typeName}\` ` +
            `or \`type ${typeName}\` was found in ${relative(REPO_ROOT, file)}.`,
        );
      }
    }
  } else if (destructure) {
    parseIndex = destructure.index;
    // The KEY is what crosses the wire; `tenantId: requestTenantId` renames it
    // locally only, so the alias after `:` is discarded.
    destructured = destructure[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .split(",")
      .map((part) => /^\s*([A-Za-z_$][\w$]*)/.exec(part)?.[1] ?? "")
      .filter(Boolean);
    for (const name of destructured) add(name, "destructured");

    // The annotation on a destructure (`: RefundRequest & { extensionId?: string }`)
    // still carries the optionality, which the destructure itself cannot show.
    const ann = destructure[2] ?? "";
    const named = /\b([A-Z][\w$]*)\b/.exec(ann);
    if (named) {
      typeName = named[1];
      typeBlock = findNamedType(src, typeName);
    }
    const inline = ann.indexOf("{");
    if (inline !== -1) {
      typeBlock = (typeBlock ?? "") + "\n" + balancedBlock(ann, inline);
      typeName = typeName ?? "(inline)";
    }
  } else {
    throw new Error(
      `${fn}: could not find where the request body is parsed in ` +
        `${relative(REPO_ROOT, file)}.\n` +
        `edge-contract.ts knows three shapes (see its header comment). This ` +
        `function uses a fourth — teach the parser rather than deleting the test, ` +
        `because an unparsed function silently contributes zero fields and makes ` +
        `every contract assertion against it pass for the wrong reason.`,
    );
  }

  const requiredByType: string[] = [];
  if (typeBlock) {
    for (const m of membersOf(typeBlock)) {
      add(m.name, "declared-type");
      if (!m.optional) requiredByType.push(m.name);
    }
  }

  // --- `body.x` / `body?.x`, up to any RE-declaration of `body` -------------
  // `process-refund` reuses the name for an unrelated object further down its
  // handler; everything past that point belongs to a different object.
  let region = handler;
  if (parseIndex >= 0) {
    const redecl = /(?:const|let|var)\s+body\s*[:=]/g;
    redecl.lastIndex = parseIndex + 1;
    let m: RegExpExecArray | null;
    while ((m = redecl.exec(handler))) {
      // Skip the declaration we already consumed.
      if (m.index <= parseIndex) continue;
      region = handler.slice(0, m.index);
      break;
    }
  }
  for (const m of region.matchAll(/\bbody\s*\??\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    add(m[1], "member-access");
  }

  // Fields the function will 400 on by name. `signupError(..., { field: "x" })`
  // and the local `fail(..., { field: "x" })` wrapper both use this shape.
  const validated = [...new Set(
    [...handler.matchAll(/\bfield:\s*["']([A-Za-z_$][\w$]*)["']/g)].map((m) => m[1]),
  )].sort();

  const shape: EdgeFunctionShape = {
    fn,
    file: relative(REPO_ROOT, file),
    typeName,
    fields: Object.keys(origin).sort(),
    requiredByType: [...new Set(requiredByType)].sort(),
    validated,
    origin,
  };
  cache.set(fn, shape);
  return shape;
}

// ---------------------------------------------------------------------------
// The contract, and what a mismatch means
// ---------------------------------------------------------------------------

export interface PayloadContract {
  /** Spine step id, e.g. "02-account". Used by the chain and in messages. */
  step: string;
  /** Edge function directory name. */
  fn: string;
  /** Repo-relative file where the browser actually builds this payload. */
  builtIn: string;
  /** Exactly what the browser puts on the wire. Keys are what is asserted. */
  payload: Record<string, unknown>;
  /**
   * Fields the function is allowed to read that this client deliberately does
   * NOT send — every one needs a reason, because "the function reads something
   * nobody sends" is otherwise the exact drift we are hunting.
   */
  serverOnlyOptional?: Record<string, string>;
}

export interface ContractDrift {
  /** In the payload, unknown to the function. */
  extra: string[];
  /** Read by the function, absent from the payload and not excused. */
  missing: string[];
}

export function diffContract(
  contract: PayloadContract,
  shape: EdgeFunctionShape,
): ContractDrift {
  const sent = new Set(Object.keys(contract.payload));
  const read = new Set(shape.fields);
  const excused = new Set(Object.keys(contract.serverOnlyOptional ?? {}));

  return {
    extra: [...sent].filter((k) => !read.has(k)).sort(),
    missing: [...read].filter((k) => !sent.has(k) && !excused.has(k)).sort(),
  };
}

/**
 * The failure message.
 *
 * The team lead's rule: a failure that does not say WHICH of the two failure
 * modes it is has failed at its job. A contract test can only ever see mode
 * (a) — a field moved — because it makes no network call, so it says so
 * explicitly rather than leaving the reader to wonder whether production is on
 * fire.
 */
export function describeDrift(
  contract: PayloadContract,
  shape: EdgeFunctionShape,
  drift: ContractDrift,
): string {
  const lines: string[] = [
    "",
    `CONTRACT DRIFT — ${contract.fn} (spine step ${contract.step})`,
    "",
  ];

  if (drift.extra.length) {
    lines.push(
      `  The payload sends ${drift.extra.length} field(s) that ${contract.fn} does not read:`,
      ...drift.extra.map((f) => `    - ${f}`),
      "",
      `  WHICH SIDE MOVED: the EDGE FUNCTION. ${shape.file} no longer reads`,
      `  ${drift.extra.map((f) => `\`${f}\``).join(", ")}, but the contract in this test still declares it.`,
      "",
    );
  }

  if (drift.missing.length) {
    lines.push(
      `  ${contract.fn} reads ${drift.missing.length} field(s) that nothing sends:`,
      ...drift.missing.map((f) => `    - ${f}  (${(shape.origin[f] ?? []).join(", ")})`),
      "",
      `  WHICH SIDE MOVED: the EDGE FUNCTION grew a field, or the CLIENT dropped one.`,
      `  ${contract.builtIn} builds the payload; ${shape.file} reads it.`,
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
    "  Layer 2 live tests are what catch mode (b); see tests/README.md.",
    "",
  );

  return lines.join("\n");
}

/** Throws with `describeDrift` when the two sides disagree. */
export function assertContract(contract: PayloadContract): EdgeFunctionShape {
  const shape = readEdgeFunction(contract.fn);
  const drift = diffContract(contract, shape);
  if (drift.extra.length || drift.missing.length) {
    throw new Error(describeDrift(contract, shape, drift));
  }
  return shape;
}
