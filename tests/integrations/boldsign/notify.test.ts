// =============================================================================
// boldsign/notify — "the operator was told the agreement was signed"
//
// THE QUESTION THIS FILE ANSWERS
// ------------------------------
// `send.test.ts` splits "the agreement went out" into leg A (the BoldSign
// document exists) and leg B (the customer was actually emailed), because
// neither implies the other. Completion has the same shape and the same trap,
// one step later:
//
//   LEG C — the agreement came back SIGNED, and the OPERATOR was told.
//
// An operator who is not told has a signed contract sitting in a table and a
// customer waiting at the desk. And unlike a failed send — which the operator
// sees as a red row on the rentals list — a notification that does not fire
// looks exactly like a customer who has not signed yet. Nothing turns red.
// That is the kind of thing nobody notices for weeks, which is precisely why
// it is worth a file.
//
// WHAT READING THE CODE ESTABLISHED
// ---------------------------------
// `supabase/functions/notify-signing-completed/` is the function that LOOKS
// like the answer: it composes a "Contract Signed" operator email carrying the
// booking ref, the customer, the vehicle and reg, the signed-at time and a link
// to the document, and it raises the operator bell.
//
// **Nothing calls it.** Not the webhook, not the portal sign route, not the
// booking route, not another edge function, not a cron, not a trigger. The
// sweep below proves that, and proves the sweep can find callers when they
// exist by running the same search against a function that HAS them.
//
// It is not a hole, though, and this file is careful not to report it as one.
// A migration dated 2026-07-18 says so in its own header — *"Both were
// HARD-BROKEN before: notify-signing-completed and notify-identity-verified had
// ZERO callers, so the bells never fired"* — and replaced it with two database
// triggers. The live path today is:
//
//   rental_agreements.document_status -> 'completed'
//     |  trigger on_signing_completed_notify
//     v
//   notifications INSERT (type 'signing_completed', user_id NULL)
//     |  trigger on_notification_operator_email  ->  pg_net POST
//     v
//   notify-operator-email  ->  category gate 'verification'  ->  the operator
//
// So the operator IS told. Every link in that chain is asserted here, from the
// DEPLOYED-schema snapshot rather than from the migration files, because a
// migration file is a statement of intent and this repo has structures that
// were applied without one.
//
// AND THE FAILURE IS SILENT AT EVERY STEP, by construction: `net.http_post` is
// fire-and-forget with no status captured, and the trigger wraps itself in
// `EXCEPTION WHEN OTHERS THEN RETURN NEW`. That is the right call for the
// INSERT — an email must never block a signature being recorded — but it means
// no row, no log and no return value anywhere observes a dropped operator
// email. Nothing will tell you. Only a test can.
// =============================================================================

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import {
  annotatedBodyShape,
  readRepoSource,
  REPO_ROOT,
} from "./boldsign-source";
import {
  baselineTrigger,
  blankComments,
  positionsOf,
  present,
  readBaseline,
  requireAllFound,
} from "./route-source";
import { classifyLive, liveCall, liveStatus } from "../../helpers/live-call";

const FN = "notify-signing-completed";
const FN_FILE = `supabase/functions/${FN}/index.ts`;

/** The trigger pair that replaced it, applied 2026-07-18. */
const SIGNING_TRIGGER_MIGRATION =
  "supabase/migrations/20260718050200_add_signing_and_identity_notification_triggers.sql";
const DISPATCH_TRIGGER_MIGRATION =
  "supabase/migrations/20260718050300_add_operator_email_dispatch_trigger.sql";

/** Strip `--` line comments from SQL so prose cannot satisfy an assertion. */
function blankSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

// ---------------------------------------------------------------------------
// The caller sweep
// ---------------------------------------------------------------------------

const SWEEP_ROOTS = ["apps", "supabase/functions", "supabase/migrations", "scripts"];
const SWEEP_SKIP = new Set(["node_modules", ".next", ".turbo", "dist", "build", ".git"]);
const SWEEP_EXT = /\.(ts|tsx|js|jsx|mjs|sql|toml)$/;

interface CallSite {
  file: string;
  line: number;
  text: string;
}

/**
 * Every NON-COMMENT mention of an edge function's name under the app + backend
 * trees.
 *
 * Comment-blanked first, and that is not a nicety: this repo's edge functions
 * are heavily commented and the migration that RETIRED `notify-signing-completed`
 * names it in its own header. A sweep that counted prose would report the dead
 * function as having a caller and the finding would evaporate. It is the same
 * mistake — a name inside a comment standing in for a fact — that this whole
 * suite was re-audited for.
 */
function sweepForCallers(fnName: string): CallSite[] {
  const hits: CallSite[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SWEEP_SKIP.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!SWEEP_EXT.test(name)) continue;
      const rel = relative(REPO_ROOT, full);
      // The function's own source is not a caller of itself.
      if (rel === FN_FILE || rel.startsWith(`supabase/functions/${fnName}/`)) continue;
      let raw: string;
      try {
        raw = readRepoSource(rel);
      } catch {
        continue;
      }
      if (!raw.includes(fnName)) continue;
      const clean = rel.endsWith(".sql") ? blankSqlComments(raw) : blankComments(raw);
      clean.split("\n").forEach((lineText, idx) => {
        if (lineText.includes(fnName)) {
          hits.push({ file: rel, line: idx + 1, text: lineText.trim().slice(0, 140) });
        }
      });
    }
  };
  for (const root of SWEEP_ROOTS) walk(join(REPO_ROOT, root));
  return hits;
}

// ===========================================================================
// The request contract — what a caller would have to send, if one existed
// ===========================================================================
describe("boldsign/notify — notify-signing-completed's request contract", () => {
  it("still declares the completion facts an operator email needs", () => {
    // Derived from source; only the expectation below is written by hand. The
    // shared helper cannot read this function — it parses three body shapes and
    // this one uses a fourth (`const data: NotifyRequest = await req.json()`),
    // which is why boldsign-source.ts exists.
    const shape = annotatedBodyShape(FN);

    expect(
      shape.typeName,
      "notify-signing-completed no longer annotates its body as NotifyRequest.",
    ).toBe("NotifyRequest");

    expect(
      shape.fields,
      "The fields notify-signing-completed can read have changed.\n" +
        "  FAILURE MODE (a): a developer reshaped the request. Nothing is broken for\n" +
        "  an operator — this function has no caller (see the sweep below) — but the\n" +
        "  list here has to follow the source.",
    ).toEqual([
      "bookingRef",
      "customerEmail",
      "customerName",
      "documentUrl",
      "envelopeId",
      "signedAt",
      "tenantId",
      "vehicleName",
      "vehicleReg",
    ]);

    // `tenantId` being OPTIONAL is the load-bearing oddity, and it is why this
    // function can be called and do nothing at all: both delivery branches are
    // gated on it. See "a revived caller" below.
    expect(
      shape.requiredByType,
      "The REQUIRED half of NotifyRequest moved. `tenantId` and `documentUrl` are\n" +
        "  the two declared optional — and tenantId's optionality is what makes a\n" +
        "  tenant-less call a silent no-op rather than a 400.",
    ).toEqual([
      "bookingRef",
      "customerEmail",
      "customerName",
      "envelopeId",
      "signedAt",
      "vehicleName",
      "vehicleReg",
    ]);
  });

  it("is not exempted from JWT verification, unlike the function that replaced it", () => {
    const config = readRepoSource("supabase/config.toml");

    // notify-operator-email MUST be exempt: the DB trigger POSTs to it through
    // pg_net with no Authorization header at all. Flip this to true and the
    // gateway 401s every operator email before the function is ever invoked —
    // and, because the trigger swallows everything, nothing anywhere reports it.
    expect(
      /\[functions\.notify-operator-email\]\s*\nverify_jwt\s*=\s*false/.test(config),
      "notify-operator-email is no longer verify_jwt = false.\n" +
        "  It is called by the on_notification_operator_email trigger via pg_net,\n" +
        "  which sends NO auth header (see the migration: headers are Content-Type\n" +
        "  only). With verification on, Supabase's gateway rejects every one of those\n" +
        "  POSTs at the door and EVERY operator email stops — silently, because the\n" +
        "  trigger discards the result. This is failure mode (b) waiting to happen.",
    ).toBe(true);

    expect(
      config.includes(`[functions.${FN}]`),
      `${FN} has gained a config.toml entry. It had none — so it defaults to\n` +
        "  verify_jwt = true, which is correct for a function nothing calls. If it is\n" +
        "  being revived as a trigger target, it needs the same exemption\n" +
        "  notify-operator-email has, and this test should assert that instead.",
    ).toBe(false);
  });
});

// ===========================================================================
// Who calls it: nobody. And what carries the notification instead.
// ===========================================================================
describe("boldsign/notify — the caller, and the chain that replaced it", () => {
  it("nothing in the repository invokes notify-signing-completed", () => {
    // THE ANTI-TAUTOLOGY CONTROL, first. A sweep that finds nothing because it
    // is broken looks identical to a sweep that finds nothing because there is
    // nothing. So run the SAME search against a function this folder has
    // already proved has callers (send.test.ts: "both web routes call it").
    const control = sweepForCallers("send-signing-email");
    expect(
      control.length,
      "The caller sweep found no reference to send-signing-email either — and that\n" +
        "  function is called by both /api/esign routes, which send.test.ts asserts.\n" +
        "  So the sweep itself is broken (a root moved, an extension dropped), and its\n" +
        "  verdict on notify-signing-completed below would be meaningless.",
    ).toBeGreaterThan(0);

    const callers = sweepForCallers(FN);
    expect(
      callers,
      `${FN} now has ${callers.length} non-comment reference(s):\n` +
        callers.map((c) => `    ${c.file}:${c.line}  ${c.text}`).join("\n") +
        "\n\n" +
        "  It had none. If someone has WIRED IT UP, that is a real change and a good\n" +
        "  one — but check the payload against NotifyRequest above, and check the\n" +
        "  dedupe collision asserted further down: the function keys its operator bell\n" +
        "  on the BoldSign envelope id while the trigger that already fires keys on the\n" +
        "  agreement row id, so the two do not see each other and the operator gets the\n" +
        "  same signature announced twice.",
    ).toEqual([]);
  });

  it("the deployed database carries both triggers that replaced it", () => {
    // Read from scripts/v1-check/baseline.json — a snapshot taken FROM the
    // running database — not from the migration files. A migration file says
    // what someone intended to apply. Only the snapshot says what is there, and
    // "is the notification path actually deployed" is the entire question.
    const signing = baselineTrigger("rental_agreements.on_signing_completed_notify");
    expect(signing.function_name, "the signing trigger points at a different function now").toBe(
      "public.notify_signing_completed",
    );
    expect(signing.timing, "the signing trigger no longer runs AFTER the row is written").toBe("AFTER");
    expect(
      signing.events,
      "the signing trigger no longer fires on both INSERT and UPDATE. An agreement\n" +
        "  that arrives already-completed (INSERT) and one that transitions to it\n" +
        "  (UPDATE) both have to raise the operator's bell.",
    ).toBe("INSERT UPDATE");
    expect(
      signing.enabled,
      "the signing trigger is no longer enabled ('O' = origin). A DISABLED trigger\n" +
        "  is the worst possible state: it is present in every schema listing and\n" +
        "  fires for nobody.",
    ).toBe("O");

    const dispatch = baselineTrigger("notifications.on_notification_operator_email");
    expect(dispatch.function_name).toBe("public.notify_operator_email_dispatch");
    expect(dispatch.timing).toBe("AFTER");
    expect(dispatch.events, "the operator-email dispatch no longer fires on INSERT").toBe("INSERT");
    expect(dispatch.enabled, "the operator-email dispatch trigger is disabled").toBe("O");
  });

  it("the signing trigger raises a broadcast operator notification the dispatcher will pick up", () => {
    const sql = blankSqlComments(readRepoSource(SIGNING_TRIGGER_MIGRATION));

    // The dispatch trigger only forwards rows that are (a) broadcast — user_id
    // NULL — (b) tenant-scoped, and (c) of an emailable type. All three are set
    // HERE, so the two triggers agree or the email half silently stops.
    expect(
      present(sql, "'signing_completed', false"),
      "The signing trigger no longer writes type 'signing_completed'. The dispatcher\n" +
        "  matches on that exact literal, so the operator email stops while the bell\n" +
        "  keeps ringing.",
    ).toBe(true);
    expect(
      /INSERT INTO notifications[\s\S]*?VALUES\s*\(\s*NULL,\s*_tenant_id/.test(sql),
      "The signing trigger no longer inserts with user_id = NULL. The operator-email\n" +
        "  dispatcher forwards ONLY broadcast rows (`IF NEW.user_id IS NOT NULL ...\n" +
        "  RETURN NEW`), so a per-user row raises the bell and sends no email.",
    ).toBe(true);
    expect(
      present(sql, "IF _tenant_id IS NULL THEN RETURN NEW; END IF;"),
      "The signing trigger no longer bails out when it cannot resolve a tenant.\n" +
        "  A tenant-less notifications row is dropped by the dispatcher anyway\n" +
        "  (`IF … NEW.tenant_id IS NULL THEN RETURN NEW`), so without this the bell is\n" +
        "  written and the email is silently discarded one trigger later.",
    ).toBe(true);
  });

  it("the dispatcher forwards 'signing_completed' and gates it on the same category the old function used", () => {
    const dispatchSql = blankSqlComments(readRepoSource(DISPATCH_TRIGGER_MIGRATION));
    expect(
      present(dispatchSql, "'signing_completed'"),
      "'signing_completed' has dropped out of the dispatcher's emailable-type list.\n" +
        "  The bell would still ring in the portal and the operator email would stop —\n" +
        "  the exact half-delivery this file exists to catch.",
    ).toBe(true);

    // …and the far end still maps that type to a category.
    const dispatcher = blankComments(readRepoSource("supabase/functions/notify-operator-email/index.ts"));
    expect(
      present(dispatcher, /signing_completed:\s*["']verification["']/),
      "notify-operator-email no longer maps signing_completed to a category.\n" +
        "  Looked for: `signing_completed: \"verification\"` in its CATEGORY_BY_TYPE map.\n" +
        "  An unmapped type returns `{ skipped: true, reason: 'type not emailable' }` —\n" +
        "  a 200, so pg_net sees success, so nothing anywhere looks wrong. Every operator\n" +
        "  stops being emailed about signed agreements and no error is raised at any\n" +
        "  point in the chain. FAILURE MODE (b), silent.",
    ).toBe(true);

    // The same category the orphaned function gated on. If the two ever
    // disagreed, an operator who turned "verification" emails off would keep
    // getting one of them.
    const orphan = blankComments(readRepoSource(FN_FILE));
    expect(
      present(orphan, '"verification"'),
      `${FN} gated its operator email on the "verification" category. The live\n` +
        "  dispatcher gates on the same one. If this changed, the two paths would\n" +
        "  honour different operator preferences for one event.",
    ).toBe(true);
  });

  it("the two paths key their dedupe on DIFFERENT ids — reviving the function double-notifies", () => {
    // Not a defect today (only one path runs). It is a trap laid for whoever
    // wires the function back up, and it is cheap to state now.
    const orphan = blankComments(readRepoSource(FN_FILE));
    expect(
      present(orphan, "dedupeKey: data.envelopeId"),
      `${FN} no longer dedupes its bell on the BoldSign envelope id.`,
    ).toBe(true);

    const sql = blankSqlComments(readRepoSource(SIGNING_TRIGGER_MIGRATION));
    expect(
      present(sql, "'dedupe_key', NEW.id::text"),
      "the signing trigger no longer dedupes on the agreement row id",
    ).toBe(true);

    // Stated as an assertion so it cannot be skimmed past: the two keys are not
    // the same value, so neither path can see the other's row.
    expect(
      orphan.includes("dedupeKey: data.envelopeId") && sql.includes("'dedupe_key', NEW.id::text"),
      "The two signing-completed notification paths dedupe on different keys — the\n" +
        "  BoldSign envelope id (edge function) and the rental_agreements row id\n" +
        "  (trigger). Only the trigger runs today, so this is harmless NOW. Wire the\n" +
        "  edge function back up without unifying the key and every signature is\n" +
        "  announced to the operator twice.",
    ).toBe(true);
  });
});

// ===========================================================================
// What the orphaned function would do if a caller appeared
// ===========================================================================
describe("boldsign/notify — notify-signing-completed's own behaviour", () => {
  it("gates the operator email on the master switch, the category and a real recipient — in that order", () => {
    const src = blankComments(readRepoSource(FN_FILE));
    const at = positionsOf(src, {
      categoryGate: "isOperatorEmailEnabled(",
      recipient: "getTenantNotificationRecipient(",
      compose: "getAdminEmailContent(",
      send: "results.adminEmail = await sendEmail(",
    });
    requireAllFound(at, `${FN} email-gate ordering`);

    expect(
      at.categoryGate < at.recipient,
      "The category gate now runs AFTER the recipient lookup. Harmless in itself, but\n" +
        "  it means a tenant with operator email switched off still costs a query.",
    ).toBe(true);
    expect(
      at.recipient < at.send,
      "The recipient is now resolved AFTER sendEmail is called — so the email has no\n" +
        "  established destination at the moment it is sent. FAILURE MODE (b).",
    ).toBe(true);
    expect(
      at.compose < at.send,
      "The email body is composed after it is sent.",
    ).toBe(true);
  });

  it("a tenant-less call is a total no-op that still answers 200 { success: true }", () => {
    const src = blankComments(readRepoSource(FN_FILE));

    // BOTH delivery branches hang off data.tenantId, which NotifyRequest
    // declares optional (asserted above). So a caller that omits it gets a
    // success response for having done nothing at all.
    expect(
      present(src, /if\s*\(\s*data\.tenantId\s*&&\s*await\s+isOperatorEmailEnabled/),
      `${FN}'s operator-email branch is no longer gated on data.tenantId.`,
    ).toBe(true);
    expect(
      present(src, /if\s*\(\s*data\.tenantId\s*\)\s*\{\s*await\s+notifyOperatorsInApp/),
      `${FN}'s operator-bell branch is no longer gated on data.tenantId.`,
    ).toBe(true);

    // And the response cannot distinguish the outcomes.
    expect(
      present(src, "adminEmail: null as any"),
      "The result accumulator no longer starts at null. It is the only thing that\n" +
        "  carries the email outcome back to a caller.",
    ).toBe(true);
    expect(
      present(src, "JSON.stringify({ success: true, results })"),
      `${FN} no longer returns success:true unconditionally. If it now reports\n` +
        "  whether the email actually left, that is an IMPROVEMENT — rewrite this test\n" +
        "  to assert the new, honest shape rather than deleting it.",
    ).toBe(true);

    // The point, stated as an assertion: nothing between the send and the
    // return inspects whether the send worked.
    const sendAt = src.indexOf("results.adminEmail = await sendEmail(");
    const returnAt = src.indexOf("JSON.stringify({ success: true, results })");
    expect(sendAt, "the sendEmail call is gone").toBeGreaterThan(-1);
    expect(returnAt, "the success response is gone").toBeGreaterThan(sendAt);
    expect(
      /results\.adminEmail\s*(?:\?|&&|===|!==|\.)/.test(src.slice(sendAt + 40, returnAt)),
      "notify-signing-completed now inspects results.adminEmail before returning.\n" +
        "  That would be a fix: today the value is logged and returned but never\n" +
        "  checked, so a caller gets `success: true` whether the operator was emailed,\n" +
        "  gated off, or had no recipient on file. Update this test to assert the check.",
    ).toBe(false);
  });

  it("the bell it would raise carries the facts the live path does not", () => {
    // Worth pinning because it is the concrete cost of the retirement, and it is
    // easy to assume "the trigger covers it" means "nothing was lost".
    const src = blankComments(readRepoSource(FN_FILE));
    for (const field of [
      "booking_ref",
      "envelope_id",
      "customer_name",
      "vehicle_reg",
      "signed_at",
      "document_url",
    ]) {
      expect(
        present(src, `${field}:`),
        `${FN}'s bell metadata no longer carries ${field}.`,
      ).toBe(true);
    }

    // The trigger that actually runs carries three, and the email built from it
    // is composed from the notification's title/message/link alone.
    const sql = blankSqlComments(readRepoSource(SIGNING_TRIGGER_MIGRATION));
    expect(
      present(sql, "jsonb_build_object('agreement_id', NEW.id, 'rental_id', NEW.rental_id, 'dedupe_key', NEW.id::text)"),
      "the live signing trigger no longer records agreement_id / rental_id / dedupe_key",
    ).toBe(true);
    expect(
      sql.includes("vehicle") || sql.includes("envelope"),
      "The live signing trigger has grown vehicle or envelope detail. That closes the\n" +
        "  gap this test records — the operator email built from the notifications row\n" +
        "  used to carry only 'Rental agreement signed by <customer> for booking <ref>',\n" +
        "  with no vehicle, no reg, no signed-at time and no link to the document.\n" +
        "  Re-word this test around whatever it carries now.",
    ).toBe(false);
  });
});

// ===========================================================================
// The gaps. Neither is blessed: each SKIPS with the finding while the defect
// stands, and arms itself into a real assertion the moment it is fixed.
// ===========================================================================
describe("boldsign/notify — the delivery gaps", () => {
  it("BoldSign's Completed event writes exactly the status the trigger fires on", () => {
    // The one link in the chain that is pure string agreement between a Deno
    // function and a plpgsql trigger, with nothing to enforce it. This is a
    // HARD assertion: it holds today and must keep holding.
    const webhook = blankComments(readRepoSource("supabase/functions/boldsign-webhook/index.ts"));
    expect(
      present(webhook, "'Completed': 'completed'"),
      "boldsign-webhook no longer maps BoldSign's 'Completed' event to 'completed'.\n" +
        "  That literal is the only thing connecting a finished signature to the\n" +
        "  database trigger that tells the operator about it.",
    ).toBe(true);

    const sql = blankSqlComments(readRepoSource(SIGNING_TRIGGER_MIGRATION));
    expect(
      present(sql, "NEW.document_status = 'completed'"),
      "The signing trigger no longer fires on document_status = 'completed'.\n" +
        "  It and boldsign-webhook agree on that one literal and nothing enforces it —\n" +
        "  change either side alone and every operator stops being told that agreements\n" +
        "  have been signed, with no error anywhere.",
    ).toBe(true);

    // The status route writes the same column from the other direction.
    expect(
      present(
        blankComments(readRepoSource("apps/portal/src/app/api/esign/status/route.ts")),
        "'Completed': 'completed'",
      ),
      "/api/esign/status no longer maps 'Completed' to 'completed'. It writes\n" +
        "  document_status too, so it is a second producer for the same trigger.",
    ).toBe(true);
  });

  it("WATCHDOG: an agreement that ends at 'signed' also notifies the operator", (ctx) => {
    // FINDING: it does not.
    //
    // The trigger fires on ONE terminal literal, 'completed'. The application
    // treats TWO as terminal — every read path in the e-sign surface is written
    // `status === 'completed' || status === 'signed'` — and boldsign-webhook
    // maps BoldSign's per-signer `Signed` event to 'signed'. So an agreement
    // whose last delivered event is `Signed` is, to every screen in the portal,
    // fully signed and un-voidable, while the operator's bell and email never
    // fire and nothing turns red.
    //
    // This test does NOT assert that today's behaviour is correct. It skips
    // with the finding, and arms itself the moment the trigger learns 'signed'.
    const sql = blankSqlComments(readRepoSource(SIGNING_TRIGGER_MIGRATION));
    const triggerBlock = sql.slice(
      sql.indexOf("FUNCTION public.notify_signing_completed"),
      sql.indexOf("FUNCTION public.notify_identity_verified"),
    );
    const handlesSigned = /'signed'/.test(triggerBlock);

    // Evidence, gathered either way so the skip message is specific.
    const webhook = blankComments(readRepoSource("supabase/functions/boldsign-webhook/index.ts"));
    const mapsSignedEvent = webhook.includes("'Signed': 'signed'");
    const terminalPairSites = [
      "apps/portal/src/app/api/esign/void/route.ts",
      "apps/portal/src/app/api/esign/sign/route.ts",
      "apps/portal/src/app/api/esign/signing-redirect/route.ts",
      "apps/portal/src/components/rentals/AgreementTimeline.tsx",
    ].filter((f) =>
      /['"]signed['"]/.test(blankComments(readRepoSource(f))) &&
      /['"]completed['"]/.test(blankComments(readRepoSource(f))),
    );

    if (!handlesSigned) {
      ctx.skip(
        [
          "",
          "FINDING — the operator bell recognises only ONE of the two terminal statuses.",
          "",
          `  ${SIGNING_TRIGGER_MIGRATION}`,
          "  fires public.notify_signing_completed only when document_status = 'completed'.",
          "",
          `  boldsign-webhook maps BoldSign's per-signer 'Signed' event to 'signed': ${mapsSignedEvent}`,
          `  Files that treat 'signed' as equally terminal: ${terminalPairSites.length}`,
          ...terminalPairSites.map((f) => `    - ${f}`),
          "",
          "  CONSEQUENCE: an agreement whose last delivered BoldSign event is `Signed`",
          "  reads as fully signed everywhere in the portal — /api/esign/void refuses to",
          "  void it, /api/esign/sign refuses to re-open it, the timeline shows a tick —",
          "  and the operator is never told. No bell, no email, no red row. The customer",
          "  is at the desk and the rental still looks unsigned to the operator's inbox.",
          "",
          "  NOTHING HERE BLESSES THAT. This case is SKIPPED, not passed. Add 'signed'",
          "  to the trigger's condition (dedupe already protects against the double",
          "  fire when 'completed' follows) and this test arms itself automatically.",
          "",
        ].join("\n"),
      );
      return;
    }

    // Armed: the fix landed. Now hold it to the whole shape.
    expect(
      present(triggerBlock, "'completed'"),
      "The signing trigger mentions 'signed' but no longer fires on 'completed' too.\n" +
        "  Both are terminal in this codebase; recognising one is the bug being fixed.",
    ).toBe(true);
    expect(
      /COALESCE\(OLD\.document_status,''\)/.test(triggerBlock),
      "The signing trigger no longer compares against the OLD status. Without that,\n" +
        "  a 'signed' -> 'completed' transition raises a SECOND bell for one signature.",
    ).toBe(true);
  });

  it("WATCHDOG: the operator-email dispatch does not hardcode one project's URL", (ctx) => {
    // FINDING: it hardcodes the production project ref.
    const sql = blankSqlComments(readRepoSource(DISPATCH_TRIGGER_MIGRATION));
    const PROD_REF = "hviqoaokxvlancmftwuo";
    const hardcoded = sql.includes(PROD_REF);

    if (hardcoded) {
      ctx.skip(
        [
          "",
          "FINDING — the operator-email dispatch trigger posts to a hardcoded project.",
          "",
          `  ${DISPATCH_TRIGGER_MIGRATION}`,
          `  PERFORM net.http_post(url := 'https://${PROD_REF}.supabase.co/functions/v1/notify-operator-email', ...)`,
          "",
          "  That ref is the PRODUCTION database (tests/README.md §6, and the reason",
          "  Layer 2 refuses it outright). The URL is baked into the trigger body, so",
          "  every database restored or branched from these migrations — the",
          "  ksmreaadhbirzakkxqrq clone scripts/db-switch.mjs knows about, a preview",
          "  branch, a local stack — dispatches its operator emails INTO PRODUCTION.",
          "",
          "  Two consequences, both quiet:",
          "    * the clone's own operator emails never arrive (the production function",
          "      re-reads the notification id from the PRODUCTION notifications table",
          "      and answers `{ skipped: true, reason: 'notification not found' }` — a",
          "      200, which pg_net discards anyway)",
          "    * a uuid that does exist in production emails a real operator about an",
          "      event that happened in a test database",
          "",
          "  FIX: build the url from current_setting('app.settings.supabase_url') or a",
          "  per-database GUC. This test arms itself the moment the literal ref is gone.",
          "",
        ].join("\n"),
      );
      return;
    }

    // Armed: no hardcoded ref. Hold the replacement to being a real dispatch.
    expect(
      present(sql, "net.http_post"),
      "The hardcoded project ref is gone, but so is the pg_net call — the operator\n" +
        "  email dispatch has no transport at all.",
    ).toBe(true);
    expect(
      present(sql, "/functions/v1/notify-operator-email"),
      "The dispatch no longer targets notify-operator-email.",
    ).toBe(true);
  });

  it("the dispatch is fire-and-forget and swallows every error — which is WHY a lost email is invisible", () => {
    // Not a watchdog: this is deliberate and, for the INSERT, correct. A failed
    // email must never roll back a recorded signature. It is asserted because it
    // is the mechanism that makes every other failure in this file silent, and
    // because a reader deciding "surely something would alert us" needs to see
    // that nothing would.
    const sql = blankSqlComments(readRepoSource(DISPATCH_TRIGGER_MIGRATION));

    expect(
      present(sql, /PERFORM\s+net\.http_post/),
      "The dispatch no longer uses PERFORM. If it now captures the response, the\n" +
        "  outcome is observable and this test should assert what is done with it.",
    ).toBe(true);
    expect(
      present(sql, "EXCEPTION WHEN OTHERS THEN"),
      "The dispatch no longer swallows exceptions. That may be a deliberate\n" +
        "  tightening — but check it cannot roll back the notifications INSERT it\n" +
        "  hangs off, because a signature must be recorded even when nobody can be\n" +
        "  emailed about it.",
    ).toBe(true);

    // pg_net is asynchronous: the request id it returns is discarded by PERFORM,
    // and no table in this repo records the outcome.
    const anyDispatchLog = ["notification_email_log", "operator_email_log", "net_http_log"].filter((t) =>
      sql.includes(t),
    );
    expect(
      anyDispatchLog,
      "A dispatch log table has appeared. Good — the failure would stop being silent.\n" +
        "  Assert against it here instead of against the absence.",
    ).toEqual([]);
  });
});

// ===========================================================================
// LAYER 2 — live.
//
// One case, and it is chosen for being provably side-effect free rather than
// for being interesting: a body notify-signing-completed cannot parse is
// answered by its outer catch, above every branch that could email anyone or
// write anything. Both delivery branches are gated on `data.tenantId`, which
// this request never reaches.
//
// Skipped by default, and the production refusal in tests/helpers/live-call.ts
// is inherited unchanged — there is no override flag.
// ===========================================================================
describe("boldsign/notify — live (Layer 2)", () => {
  it("live: notify-signing-completed answers an unparseable body without notifying anyone", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip(
        "D247_LIVE_ANON_KEY is not set. notify-signing-completed has no config.toml\n" +
          "  entry, so verify_jwt defaults to TRUE and the gateway 401s a request with\n" +
          "  no apikey before the function runs — this probe would measure the gateway.",
      );
      return;
    }

    // Proven side-effect-free before the call, not asserted after it: both the
    // email and the bell sit behind `data.tenantId`, and `await req.json()`
    // throws before `data` exists.
    const src = blankComments(readRepoSource(FN_FILE));
    expect(
      src.indexOf("await req.json()"),
      "notify-signing-completed no longer parses its body before doing anything else.\n" +
        "  This live case is only safe while the parse is the FIRST thing that can\n" +
        "  fail; if a write now happens above it, delete this case rather than running it.",
    ).toBeLessThan(src.indexOf("isOperatorEmailEnabled("));

    const res = await liveCall(FN, "{not json", { token: status.target.anonKey });

    expect(
      res.status,
      "Expected 500 from notify-signing-completed's outer catch on an unparseable body.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  A 200 would mean the function accepted a body it cannot read, which is worse\n" +
        "  than the failure: it would have gone on to the tenant branches.\n" +
        classifyLive(res).explain,
    ).toBe(500);

    expect(
      res.json?.success,
      "notify-signing-completed returned an error without success:false. Its two\n" +
        "  response shapes are { success:true, results } and { success:false, error }.",
    ).toBe(false);
  });
});

// A single reference to the baseline reader so a stale snapshot surfaces here
// rather than as an unexplained failure inside a trigger assertion.
describe("boldsign/notify — the snapshot these assertions lean on", () => {
  it("the deployed-schema snapshot still covers rental_agreements and notifications", () => {
    const b = readBaseline();
    expect(
      b.schema.tables.rental_agreements,
      "rental_agreements is missing from scripts/v1-check/baseline.json — the trigger\n" +
        "  assertions above have nothing to stand on. Re-snapshot (npm run v1:snapshot).",
    ).toBeTruthy();
    expect(
      b.schema.tables.notifications,
      "notifications is missing from the deployed-schema snapshot.",
    ).toBeTruthy();
    expect(
      b.schema.tables.notifications.rls,
      "notifications has had RLS switched ON. The operator bell is written by a\n" +
        "  SECURITY DEFINER trigger so it still lands, but every portal read of it now\n" +
        "  goes through policies — check the bell still renders before assuming this is\n" +
        "  only a hardening change.",
    ).toBe(false);
  });
});
