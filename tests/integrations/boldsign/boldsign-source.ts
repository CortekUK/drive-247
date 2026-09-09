// =============================================================================
// boldsign-source.ts — the parsing this folder needs and tests/helpers does not
// have.
//
// WHY A LOCAL HELPER AT ALL
// -------------------------
// `tests/helpers/edge-contract.ts` is shared with the spine and is not mine to
// edit. It knows three request-parsing shapes and THROWS on a fourth, on
// purpose: an unparsed function silently contributes zero fields and makes
// every assertion against it pass for the wrong reason.
//
// The BoldSign surface uses two shapes it does not know:
//
//   4. `const body = await req.json() as SigningEmailRequest;`   send-signing-email
//   5. `const data: NotifyRequest = await req.json();`           notify-signing-completed
//
// and half of the surface is not an edge function at all — the operator's send,
// resend, view, status and void all live in Next route handlers under
// `apps/portal/src/app/api/esign/`. So the same idea is reimplemented here for
// those two cases, with the same rule kept intact: EVERY parser below throws
// when it cannot find what it is looking for. None of them ever returns an
// empty set.
//
// The shared helper is still used wherever it works —
// `create-boldsign-document` and `get-boldsign-document` both destructure, which
// it handles — so this file adds to it rather than replacing it.
// =============================================================================

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  liveStatus,
  liveWritesAllowed,
  liveMoneyMovementRequested,
  mentionsProductionRef,
  ProductionTargetError,
  type LiveTarget,
} from "../../helpers/live-call";

const HERE = dirname(fileURLToPath(import.meta.url));
/** tests/integrations/boldsign -> tests/integrations -> tests -> repo root */
export const REPO_ROOT = join(HERE, "..", "..", "..");

// ---------------------------------------------------------------------------
// Reading source
// ---------------------------------------------------------------------------

/**
 * Any repo file, by repo-relative path.
 *
 * A missing file is a hard error naming the path, because "the route moved" and
 * "the route was deleted" are both things a reader has to be told rather than
 * left to infer from a test that quietly asserted nothing.
 */
export function readRepoSource(relPath: string): string {
  const file = join(REPO_ROOT, relPath);
  if (!existsSync(file)) {
    throw new Error(
      `No file at ${relPath}.\n` +
        `  Either it was renamed or deleted, or this test names it wrongly. This is\n` +
        `  FAILURE MODE (a) — a developer moved something — and the fix is to point\n` +
        `  the test at the new path, or delete the test if the surface is gone.`,
    );
  }
  return readFileSync(file, "utf8");
}

export function repoRelative(relPath: string): string {
  return relative(REPO_ROOT, join(REPO_ROOT, relPath));
}

/**
 * Inner text of the balanced block that OPENS at `openIndex`.
 *
 * Works for `{}`, `()` and `[]`. Deliberately brace-counting rather than
 * regex — an agreement route is 2,000 lines of nested object literals and a
 * lazy `[\s\S]*?` stops at the first `}` it sees, which is never the right one.
 */
export function balanced(src: string, openIndex: number): string {
  const open = src[openIndex];
  const close = open === "{" ? "}" : open === "(" ? ")" : open === "[" ? "]" : null;
  if (!close) throw new Error(`balanced() expects to start on a bracket, got "${open}"`);
  let depth = 0;
  for (let i = openIndex; i < src.length; i += 1) {
    const c = src[i];
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return src.slice(openIndex + 1, i);
    }
  }
  throw new Error("Unbalanced bracket while reading source");
}

export interface TypeMember {
  name: string;
  optional: boolean;
}

/**
 * Top-level members of `interface <name> { ... }`.
 *
 * Depth-aware: a nested object type's fields are not top-level request fields.
 * Throws when the interface is not there, which is the honest outcome — a
 * request type that vanished is drift, not "zero fields".
 */
export function interfaceMembers(src: string, name: string): TypeMember[] {
  const m = new RegExp(`\\binterface\\s+${name}\\s*(?:extends[^{]+)?\\{`).exec(src);
  if (!m) {
    throw new Error(
      `No \`interface ${name}\` in this source.\n` +
        `  The request type was renamed, inlined or deleted. Until it is found again\n` +
        `  this test can assert nothing, so it fails rather than passing empty.`,
    );
  }
  const block = balanced(src, m.index + m[0].length - 1);
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  const out: TypeMember[] = [];
  let depth = 0;
  let lineStart = 0;
  for (let i = 0; i <= clean.length; i += 1) {
    const c = clean[i];
    if (c === "{" || c === "(" || c === "[") depth += 1;
    else if (c === "}" || c === ")" || c === "]") depth -= 1;
    const isBreak = i === clean.length || ((c === ";" || c === "," || c === "\n") && depth === 0);
    if (!isBreak) continue;
    const seg = clean.slice(lineStart, i);
    lineStart = i + 1;
    const mm = /^\s*(?:readonly\s+)?["']?([A-Za-z_$][\w$]*)["']?\s*(\?)?\s*:/.exec(seg);
    if (mm) out.push({ name: mm[1], optional: Boolean(mm[2]) });
  }
  if (!out.length) {
    throw new Error(`\`interface ${name}\` parsed to zero members — refusing to assert against nothing.`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shapes 4 and 5 — the two request-parsing forms tests/helpers throws on
// ---------------------------------------------------------------------------

export interface AnnotatedBodyShape {
  fn: string;
  file: string;
  /** The interface the body is annotated with. */
  typeName: string;
  /** Every field declared on that interface. Sorted. */
  fields: string[];
  /** Declared without `?`. */
  requiredByType: string[];
  /** The local name the parsed body was bound to (`body`, `data`, ...). */
  binding: string;
}

/**
 * Read an edge function whose handler parses its body as
 *
 *   `const <id> = await req.json() as <Type>;`      (shape 4)
 *   `const <id>: <Type> = await req.json();`        (shape 5)
 *
 * and resolve `<Type>` to its declared members.
 *
 * Throws on anything else. That matters more than it looks: both functions this
 * is used for send mail or notify an operator, and a parser that shrugged and
 * returned `[]` would turn every assertion below into a tautology.
 */
export function annotatedBodyShape(fn: string): AnnotatedBodyShape {
  const rel = join("supabase", "functions", fn, "index.ts");
  const src = readRepoSource(rel);

  const shape4 = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+req\.json\(\)\s*as\s+([A-Za-z_$][\w$]*)/.exec(src);
  const shape5 = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\s*=\s*await\s+req\.json\(\)/.exec(src);
  const hit = shape4 ?? shape5;
  if (!hit) {
    throw new Error(
      `${fn}: could not find where the request body is parsed in ${rel}.\n` +
        `  boldsign-source.ts knows the two annotated shapes (\`= await req.json() as T\`\n` +
        `  and \`: T = await req.json()\`); tests/helpers/edge-contract.ts knows the other\n` +
        `  three. This function now uses a sixth — teach one of the two parsers rather\n` +
        `  than deleting the test, because an unparsed function contributes zero fields\n` +
        `  and makes every contract assertion against it pass for the wrong reason.`,
    );
  }

  const [, binding, typeName] = hit;
  const members = interfaceMembers(src, typeName);
  return {
    fn,
    file: rel,
    typeName,
    binding,
    fields: members.map((m) => m.name).sort(),
    requiredByType: members.filter((m) => !m.optional).map((m) => m.name).sort(),
  };
}

// ---------------------------------------------------------------------------
// The client side: what a call site actually puts on the wire
// ---------------------------------------------------------------------------

/**
 * The top-level keys of the JSON body a call site POSTs to `url`.
 *
 * Handles the three shapes the BoldSign call sites actually use:
 *
 *   fetch("/api/esign", { body: JSON.stringify({ rentalId, ... }) })
 *   const body = { ... }; fetch("/api/esign", { body: JSON.stringify(body) })
 *   ...(isExtension && { extensionPreviousEndDate, ... })      spread-conditional
 *
 * The spread case is the one worth explaining. `AgreementTimeline` sends the
 * extension fields only for an extension, so those keys live inside a nested
 * object literal — but they ARE top-level keys on the wire. A depth-blind scan
 * would miss them; a depth-ignoring scan would also pick up `headers` and every
 * nested value. So the walk tracks, per brace, whether that brace was opened
 * immediately after `&&` (a spread-conditional, still the payload) or not (a
 * genuine nested value, not a payload key).
 *
 * Throws when the call site cannot be found or parses to nothing.
 */
export function payloadKeysAtCallSite(
  src: string,
  url: string,
  opts: { occurrence?: number; label?: string } = {},
): string[] {
  const want = opts.occurrence ?? 1;
  const label = opts.label ?? url;

  const fetchRe = new RegExp(`fetch\\(\\s*['"\`]${escapeRe(url)}['"\`]`, "g");
  let m: RegExpExecArray | null;
  let seen = 0;
  let at = -1;
  while ((m = fetchRe.exec(src))) {
    seen += 1;
    if (seen === want) {
      at = m.index;
      break;
    }
  }
  if (at === -1) {
    throw new Error(
      `No fetch("${url}") #${want} in this file (found ${seen}).\n` +
        `  ${label} no longer posts to ${url}, or the call was reshaped. FAILURE MODE (a).`,
    );
  }

  return keysFromNextStringify(src, at, `fetch("${url}")`, label);
}

/**
 * The same reading, anchored on an arbitrary string rather than a literal URL.
 *
 * `retry-credit-failed-agreements` builds its target as
 * `https://${slug}.${PORTAL_BASE_DOMAIN}/api/esign` and calls `fetch(url, ...)`,
 * so there is no literal to match on — but it is still a caller of the same
 * contract, and a server-to-server one that no operator would ever see fail.
 */
export function payloadKeysAfterAnchor(src: string, anchor: string, label: string): string[] {
  const at = src.indexOf(anchor);
  if (at === -1) {
    throw new Error(
      `Anchor \`${anchor}\` not found in ${label}.\n` +
        `  The caller was reshaped or removed. FAILURE MODE (a).`,
    );
  }
  return keysFromNextStringify(src, at, `anchor \`${anchor}\``, label);
}

/** Regex-escape a literal (URLs here contain `${}` and `/`, both meaningful). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * The payload of the next request after `from`, whichever way it is written.
 *
 * Two forms are in use and both are the same contract:
 *   `fetch(url, { body: JSON.stringify({ ... }) })`      HTTP callers
 *   `supabase.functions.invoke("fn", { body: { ... } })` edge-to-edge callers
 *
 * Whichever appears FIRST after the anchor wins, so a `body:` belonging to a
 * later, unrelated call cannot be picked up by accident.
 */
function keysFromNextStringify(src: string, from: number, what: string, label: string): string[] {
  const stringifyAt = src.indexOf("JSON.stringify(", from);
  const invokeBodyAt = (() => {
    const m = /\bbody\s*:\s*\{/.exec(src.slice(from));
    return m ? from + m.index + m[0].length - 1 : -1;
  })();

  if (stringifyAt === -1 && invokeBodyAt === -1) {
    throw new Error(
      `${what} in ${label} has neither a JSON.stringify() body nor a \`body: { ... }\` ` +
        `object — cannot read what it sends.`,
    );
  }
  if (invokeBodyAt !== -1 && (stringifyAt === -1 || invokeBodyAt < stringifyAt)) {
    const keys = objectLiteralKeys(balanced(src, invokeBodyAt));
    if (!keys.length) {
      throw new Error(`${what} in ${label} parsed to zero keys — refusing to assert against nothing.`);
    }
    return keys.sort();
  }

  const argText = balanced(src, stringifyAt + "JSON.stringify".length).trim();

  let objectText: string;
  let assignedLater: string[] = [];
  if (argText.startsWith("{")) {
    objectText = balanced(argText, 0);
  } else {
    // `JSON.stringify(body)` — the payload is built into a variable above.
    const ident = /^([A-Za-z_$][\w$]*)$/.exec(argText)?.[1];
    if (!ident) {
      throw new Error(
        `${what} in ${label} stringifies \`${argText.slice(0, 60)}\`, which this ` +
          `parser cannot resolve. Teach it rather than dropping the assertion.`,
      );
    }
    // The LAST declaration before this call, not the first in the file. A page
    // with several handlers (`handleResend`, `handleVoid`, ...) declares a
    // `body` in each; taking the first would read a different handler's payload
    // and assert against the wrong thing while looking perfectly green.
    const declRe = new RegExp(`(?:const|let)\\s+${ident}\\b[^=;]*=\\s*\\{`, "g");
    const head = src.slice(0, stringifyAt);
    let decl: RegExpExecArray | null = null;
    let hit: RegExpExecArray | null;
    while ((hit = declRe.exec(head))) decl = hit;
    if (!decl) {
      throw new Error(`Could not find where \`${ident}\` is built above ${what} in ${label}.`);
    }
    objectText = balanced(head, decl.index + decl[0].length - 1);
    // Keys added after the literal: `body.agreementId = doc.id;`
    assignedLater = [
      ...head.slice(decl.index).matchAll(new RegExp(`\\b${ident}\\.([A-Za-z_$][\\w$]*)\\s*=[^=]`, "g")),
    ].map((x) => x[1]);
  }

  const keys = objectLiteralKeys(objectText);
  const all = [...new Set([...keys, ...assignedLater])].sort();
  if (!all.length) {
    throw new Error(`${what} in ${label} parsed to zero keys — refusing to assert against nothing.`);
  }
  return all;
}

/**
 * Payload keys out of an object-literal body, spread-conditionals included.
 * See the note on `payloadKeysAtCallSite` for why the `&&` tracking is there.
 */
/**
 * `"{"` or `","` when the token starting at `i` is in member position, else
 * null. Whitespace between is skipped; a `:` before it means we are looking at
 * a VALUE, not a key.
 */
function prevMeaningful(s: string, i: number): string | null {
  let k = i - 1;
  while (k >= 0 && /\s/.test(s[k])) k -= 1;
  if (k < 0) return "{";
  return s[k] === "{" || s[k] === "," ? s[k] : null;
}

export function objectLiteralKeys(inner: string): string[] {
  const clean = inner.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const out: string[] = [];
  // Stack of "is this brace still the payload level?" — index 0 is the body itself.
  const payloadLevel: boolean[] = [true];
  let i = 0;
  while (i < clean.length) {
    const c = clean[i];
    if (c === "{") {
      const before = clean.slice(Math.max(0, i - 8), i);
      const isSpreadConditional = /(&&|\|\||\?)\s*$/.test(before);
      payloadLevel.push(isSpreadConditional && payloadLevel[payloadLevel.length - 1]);
      i += 1;
      continue;
    }
    if (c === "}") {
      payloadLevel.pop();
      i += 1;
      continue;
    }
    if (c === "(" || c === "[") {
      // Skip the whole group unless it is a spread-conditional wrapper, which is
      // handled by the `{` branch when we walk into it.
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i += 1;
      while (i < clean.length && clean[i] !== c) i += clean[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    const at = payloadLevel[payloadLevel.length - 1];
    const key = /^([A-Za-z_$][\w$]*)\s*[:,\n}]/.exec(clean.slice(i));
    // A KEY, not a value. `extensionNumber: extNum` would otherwise report
    // `extNum` as a second key — a phantom field that no server declares, which
    // turns a green contract test red for a reason that does not exist. So the
    // previous non-whitespace character must be the start of a member: `{` or
    // `,`, and nothing else.
    if (at && key && prevMeaningful(clean, i) !== null) {
      out.push(key[1]);
      i += key[1].length;
      continue;
    }
    i += 1;
  }
  return [...new Set(out)];
}

/**
 * The WIRE keys a Next route handler destructures off its request body.
 *
 *   `const { rentalId, envelopeId: providedEnvelopeId, agreementId } = await request.json();`
 *
 * The key is what crosses the wire; the alias after `:` is a local rename and is
 * discarded — exactly as tests/helpers/edge-contract.ts does for edge functions.
 * Throws when the destructure cannot be found, rather than reporting no fields.
 */
export function destructuredRequestKeys(src: string, label: string): string[] {
  const m = /(?:const|let)\s*\{([\s\S]*?)\}\s*=\s*await\s+(?:request|req)\.json\(\)/.exec(src);
  if (!m) {
    throw new Error(
      `Could not find where ${label} destructures its request body.\n` +
        `  This parser knows \`const { ... } = await request.json()\`. If the route now\n` +
        `  parses differently, teach it — a route that contributes zero fields makes\n` +
        `  every contract assertion against it pass for the wrong reason.`,
    );
  }
  const keys = m[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .split(",")
    .map((part) => /^\s*([A-Za-z_$][\w$]*)/.exec(part)?.[1] ?? "")
    .filter(Boolean);
  if (!keys.length) throw new Error(`${label}: destructure parsed to zero keys.`);
  return [...new Set(keys)].sort();
}

// ---------------------------------------------------------------------------
// Order assertions
// ---------------------------------------------------------------------------

/**
 * Where each marker first appears, or -1.
 *
 * Order is the point of several assertions in this folder: a guard that runs
 * after the document has been sent is not a guard, and a credit refund written
 * above the failure it refunds is not a refund.
 */
export function positionsOf(src: string, markers: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, needle] of Object.entries(markers)) out[name] = src.indexOf(needle);
  return out;
}

// ---------------------------------------------------------------------------
// The two failure modes, in this folder's words
// ---------------------------------------------------------------------------

/**
 * The message a contract mismatch fails with.
 *
 * Same rule as the spine: a failure that does not say WHICH of the two failure
 * modes it is has failed at its job. A source-derived contract can only ever
 * see mode (a), so it says so rather than leaving the reader wondering whether
 * a customer is currently unable to sign anything.
 */
export function describeClientDrift(args: {
  caseName: string;
  clientLabel: string;
  clientFile: string;
  serverLabel: string;
  serverFile: string;
  extra: string[];
  missing: string[];
  excused?: Record<string, string>;
}): string {
  const lines: string[] = ["", `CONTRACT DRIFT — ${args.caseName}`, ""];

  if (args.extra.length) {
    lines.push(
      `  ${args.clientLabel} sends ${args.extra.length} field(s) ${args.serverLabel} does not declare:`,
      ...args.extra.map((f) => `    - ${f}`),
      "",
      `  WHICH SIDE MOVED: the SERVER. ${args.serverFile} no longer declares`,
      `  ${args.extra.map((f) => `\`${f}\``).join(", ")}, but the caller still sends it — so that value is`,
      `  now silently dropped on arrival.`,
      "",
    );
  }

  if (args.missing.length) {
    lines.push(
      `  ${args.serverLabel} declares ${args.missing.length} required field(s) ${args.clientLabel} does not send:`,
      ...args.missing.map((f) => `    - ${f}`),
      "",
      `  WHICH SIDE MOVED: the SERVER grew a required field, or the CALLER dropped one.`,
      `  ${args.clientFile} builds the payload; ${args.serverFile} reads it.`,
      "",
    );
  }

  if (args.excused && Object.keys(args.excused).length) {
    lines.push(
      "  Fields deliberately not sent by this caller, and why:",
      ...Object.entries(args.excused).map(([k, why]) => `    - ${k}: ${why}`),
      "",
    );
  }

  lines.push(
    "  THIS IS FAILURE MODE (a): a developer changed a field. It is the healthy,",
    "  expected failure — nothing is broken for an operator right now. Fix whichever",
    "  side is wrong and the build goes green.",
    "",
    "  It is NOT failure mode (b) — 'the endpoint is returning 400/401/500'. A",
    "  contract test never touches the network and cannot see a status code. The",
    "  Layer 2 cases in this folder are what catch mode (b).",
    "",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// LAYER 2 — the gates
// ---------------------------------------------------------------------------

/**
 * A BoldSign send is not free and it is not undoable.
 *
 * `create-boldsign-document` calls `deduct_credits` BEFORE it calls BoldSign,
 * against `tenant_credit_wallets` — a balance the operator paid for. And the
 * document itself lands in a real BoldSign account, counting against a real
 * sandbox quota (BoldSign's own limit is 50 sends an hour, which this repo
 * already handles as a 429 retry). Neither has a DELETE.
 *
 * So a live send inherits the whole ladder — `liveStatus()` first, because that
 * is the call carrying the production refusal — and then adds one declaration
 * the Supabase guards cannot make on its own:
 *
 *   `tenants.boldsign_mode` is a PER-TENANT COLUMN. A perfectly non-production
 *   Supabase project can hold a tenant wired to the live BoldSign key, and
 *   `create-boldsign-document` reads that column — not any variable here — when
 *   it picks which key to send with. A live-key send is a real, legally
 *   presented document in a real customer's name.
 *
 * `D247_LIVE_BOLDSIGN_MODE=test` is therefore a human declaration, refused when
 * unset (fail closed), and it can only ever NARROW: `liveStatus()` has already
 * run and already thrown by the time it is read.
 *
 * This mirrors `liveMoneyGate()` in tests/helpers/live-call.ts deliberately, and
 * lives here rather than there because the shared helpers are not mine to edit.
 */
export type SandboxGate =
  | { allowed: true; target: LiveTarget }
  | { allowed: false; reason: string };

export function boldsignSendRequested(): boolean {
  return process.env.D247_LIVE_ALLOW_MONEY_MOVEMENT === "1";
}

function sandboxRefusal(lines: string[]): ProductionTargetError {
  return new ProductionTargetError(
    [
      "",
      "  ############################################################",
      "  #  REFUSING TO SEND A REAL BOLDSIGN DOCUMENT               #",
      "  ############################################################",
      "",
      ...lines.map((l) => `  ${l}`),
      "",
      "  A sent agreement cannot be un-sent by this repository, and the credits it",
      "  spends cannot be un-spent. Configure the run completely, or leave the send",
      "  cases skipped — which is the default and the correct state for CI.",
      "",
    ].join("\n"),
  );
}

export function boldsignSandboxGate(): SandboxGate {
  if (!boldsignSendRequested()) {
    return {
      allowed: false,
      reason:
        "Document-creating cases are off (D247_LIVE_ALLOW_MONEY_MOVEMENT is not 1). " +
        "A send spends e-sign credits from a real wallet, so it sits on the same rung " +
        "as the Stripe money cases. The contract half of this case still ran — see " +
        "tests/integrations/boldsign/README.md.",
    };
  }

  // Rung 1, inherited rather than re-implemented: this is the call that carries
  // the production refusal, and it throws.
  const status = liveStatus();
  if (!status.enabled) {
    throw sandboxRefusal([
      "D247_LIVE_ALLOW_MONEY_MOVEMENT=1 but Layer 2 itself is off.",
      `  (${status.reason})`,
      "",
      "You have said a real document may be sent and then not said where. Set",
      "D247_LIVE_TESTS=1 and an explicit target, or unset the money flag.",
    ]);
  }

  // Rung 2. A send writes: rental_agreements, rentals.docusign_envelope_id,
  // rental_additional_drivers.signing_status, and the credit ledger.
  if (!liveWritesAllowed()) {
    throw sandboxRefusal([
      "D247_LIVE_ALLOW_MONEY_MOVEMENT=1 but D247_LIVE_ALLOW_WRITES is not 1.",
      "",
      "Every send writes — the agreement row, the rental's envelope id and the",
      "credit ledger all change. Sending is a strict superset of writing, so it",
      "cannot be granted while writing is withheld.",
    ]);
  }

  const declared = process.env.D247_LIVE_BOLDSIGN_MODE;
  if (declared !== "test") {
    throw sandboxRefusal([
      declared
        ? `D247_LIVE_BOLDSIGN_MODE is "${declared}". Only "test" is accepted.`
        : "D247_LIVE_BOLDSIGN_MODE is not set.",
      "",
      "The Supabase guards prove which DATABASE this run points at. They prove",
      "nothing about BoldSign: `tenants.boldsign_mode` is a per-tenant column, so a",
      "non-production project can hold a tenant on the LIVE BoldSign key — and",
      "create-boldsign-document reads that column, not this variable, when it picks",
      "which key to send with.",
      "",
      "So this is a declaration, not a detection, and unset is refused rather than",
      "assumed. A wrong guess here puts a real document, in a real customer's name,",
      "into a real signing account.",
    ]);
  }

  return { allowed: true, target: status.target };
}

/**
 * A one-shot fixture: the rental a live send is allowed to send against.
 *
 * Never inferred. Guessing a rental to send a legal agreement for is the e-sign
 * version of guessing a project ref.
 */
export function resolveSendFixture(): { rentalId: string } {
  const rentalId = process.env.D247_LIVE_BOLDSIGN_RENTAL_ID?.trim();
  if (!rentalId) {
    throw sandboxRefusal([
      "D247_LIVE_BOLDSIGN_RENTAL_ID is not set.",
      "",
      "The send cases need a rental they are allowed to issue an agreement for, and",
      "there is no safe default. Name one explicitly.",
    ]);
  }
  return { rentalId };
}

// ---------------------------------------------------------------------------
// The portal target — Layer 2 for the half of this surface that is NOT an edge
// function.
// ---------------------------------------------------------------------------

/**
 * Send, resend, view, status and void are Next route handlers, so
 * `liveCall()` — which speaks to `<project>.supabase.co/functions/v1` — cannot
 * reach them. They need their own target, and therefore their own refusal.
 *
 * The rule is the same one, transposed: production is refused outright and
 * there is no override. For the portal, production is any host under
 * `drive-247.com` (operators reach it as `{tenant}.portal.drive-247.com`), plus
 * anything mentioning the production Supabase ref — a preview deployment wired
 * to the production database is production for this purpose, whatever its
 * hostname says.
 *
 * Localhost and preview hosts pass. Nothing here can write or spend anything:
 * the only live cases that use it POST deliberately invalid bodies and are
 * answered by input validation before any BoldSign or database call.
 */
export type PortalTarget =
  | { enabled: true; baseUrl: string }
  | { enabled: false; reason: string };

const PRODUCTION_PORTAL_HOST_MARKERS = ["drive-247.com", "drive247.com"];

export function portalTarget(): PortalTarget {
  const status = liveStatus();
  if (!status.enabled) return { enabled: false, reason: status.reason };

  const raw = process.env.D247_LIVE_PORTAL_URL?.trim();
  if (!raw) {
    return {
      enabled: false,
      reason:
        "D247_LIVE_PORTAL_URL is not set. The send/resend/view routes are Next route " +
        "handlers, not edge functions, so they need their own explicit target — never " +
        "inferred, for the same reason D247_LIVE_FUNCTIONS_URL is never inferred.",
    };
  }

  const lower = raw.toLowerCase();
  const prodHost = PRODUCTION_PORTAL_HOST_MARKERS.find((h) => lower.includes(h));
  if (prodHost) {
    throw new ProductionTargetError(
      [
        "",
        "  ############################################################",
        "  #  REFUSING TO RUN LIVE TESTS AGAINST THE PRODUCTION PORTAL #",
        "  ############################################################",
        "",
        `  D247_LIVE_PORTAL_URL mentions ${prodHost}`,
        "  That is the production portal — the one ~32 paying operators send their",
        "  customers' rental agreements from.",
        "",
        "  Point it at localhost or a preview deployment and re-run.",
        "  There is no override flag. Adding one is how this ends up in CI.",
        "",
      ].join("\n"),
    );
  }

  const mentionsProd = mentionsProductionRef(raw);
  if (mentionsProd) {
    throw new ProductionTargetError(
      `\n  D247_LIVE_PORTAL_URL mentions the production Supabase project ref ${mentionsProd}.\n` +
        "  A preview deployment wired to the production database is production.\n",
    );
  }

  return { enabled: true, baseUrl: raw.replace(/\/+$/, "") };
}

export interface PortalResponse {
  status: number;
  ok: boolean;
  json: any;
  text: string;
  ms: number;
}

/** POST a JSON body at one portal route. No auth: these routes take none. */
export async function portalCall(
  path: string,
  body: unknown,
  opts: { method?: string; timeoutMs?: number } = {},
): Promise<PortalResponse> {
  const target = portalTarget();
  if (!target.enabled) throw new Error(`portalCall("${path}") reached while disabled: ${target.reason}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  const startedAt = Date.now();
  try {
    const res = await fetch(`${target.baseUrl}${path}`, {
      method: opts.method ?? "POST",
      headers: { "Content-Type": "application/json" },
      body: opts.method === "GET" ? undefined : JSON.stringify(body ?? {}),
      signal: controller.signal,
      redirect: "manual",
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // A non-JSON body is itself a finding: these routes answer JSON, except
      // signing-redirect, which answers plain text on purpose (it is opened by
      // a customer's mail client, not by code).
    }
    return { status: res.status, ok: res.ok, json, text, ms: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

/** Re-exported so the test files import their gates from one place. */
export { liveMoneyMovementRequested, liveWritesAllowed };
