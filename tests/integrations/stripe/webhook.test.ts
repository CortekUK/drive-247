// =============================================================================
// integrations/stripe — THE WEBHOOKS.
//
// The team lead, verbatim: "webhooks and cron jobs you'll have to nail,
// otherwise there's no benefit to this whole testing." And, separately, that
// webhook HEALTH is to be tracked per platform rather than assumed.
//
// SCOPE: axis 1 — the rental operator collecting money from their renter, and
// the four endpoints Stripe delivers that money's events to:
//
//   stripe-webhook-live      the moded booking fork, LIVE keys
//   stripe-webhook-test      the moded booking fork, TEST keys
//   stripe-webhook           a third, UNMODED booking fork, still gateway-open
//   stripe-connect-webhook   Connect account lifecycle (onboarding, deauth)
//
// plus the reconciliation tail that exists because a webhook can miss:
//
//   recover-pending-stripe-payments   pg_cron, every minute
//   audit-stripe-payment              read-only ops tool
//   notify-payment-failed             deployed, and called by nothing
//
// OUT OF SCOPE, deliberately: the PLATFORM subscription axis — Drive247 billing
// its own tenants through `subscription-webhook`, a different Stripe account
// with its own keys — which tests/integrations/stripe/checkout.test.ts already
// covers. Nothing here asserts anything about that webhook's behaviour. It is
// referenced in exactly one place, as the in-repo PRECEDENT for an event-id
// claim table, because the table it uses is the one the booking forks lack.
// Extensions, auto-extension, pay-as-you-go and instalments are parked.
//
// THREE LAYERS, as everywhere else in this suite:
//
//   LAYER 1  source-derived. Reads supabase/functions/<fn>/index.ts as TEXT
//            through helpers/edge-contract, and supabase/config.toml and the
//            migrations tree the same way. No network, runs in CI, cannot lie
//            about what the deployed file says — but also cannot run it. Most
//            of this file, on purpose: a webhook's guards, its dispatch table
//            and the ORDER of the two are textual properties, and the order is
//            the whole game (a guard below a write is not a guard).
//   LAYER 2  real HTTP through helpers/live-call. OFF unless D247_LIVE_TESTS=1,
//            and the helper refuses the production ref (hviqoaokxvlancmftwuo)
//            before the first fetch. One case, read-only, and it is the one
//            probe that can detect a fail-OPEN regression — see its comment.
//   LAYER 3  pure arithmetic, every expected value derived BY HAND with the
//            sum written in the comment. Nothing copied out of a program's
//            output.
//
// HOW A DEFECT IS RECORDED HERE (read this before editing anything below)
//
// Where the code is wrong there are TWO tests:
//
//   * one plain test titled "PINS TODAY'S BEHAVIOUR", which asserts the ACTUAL,
//     wrong shape so the size of the bug is on record; and
//   * one `it.fails(...)` asserting the CORRECT behaviour. `it.fails` PASSES
//     while the bug exists and turns RED the day someone fixes it, which forces
//     a human back here to delete the pin and drop the marker.
//
// A plain test asserting the broken shape would go red on the FIX instead. That
// mistake has been made five times in this repo and had to be undone each time.
// Every `it.fails` below carries the "remove .fails when fixed" note.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  blankComments,
  readEdgeFunctionSource,
  REPO_ROOT,
} from "../../helpers/edge-contract";
import { classifyLive, liveCall, liveStatus } from "../../helpers/live-call";
import { capabilitiesFor } from "@fn/_shared/payments/capabilities.ts";

// ---------------------------------------------------------------------------
// The endpoints, named once.
// ---------------------------------------------------------------------------

/** The three forks that receive a RENTAL's money events. */
const BOOKING_FORKS = ["stripe-webhook-live", "stripe-webhook-test", "stripe-webhook"] as const;

/** The two moded forks — the pair a healthy deployment actually routes to. */
const MODED_FORKS = ["stripe-webhook-live", "stripe-webhook-test"] as const;

/** Every Stripe webhook, booking money plus Connect lifecycle. */
const ALL_WEBHOOKS = [...BOOKING_FORKS, "stripe-connect-webhook"] as const;

/**
 * The reconciliation tail. These are NOT webhooks — they must stay closed at
 * the gateway, which is asserted below.
 */
const RECONCILERS = [
  "recover-pending-stripe-payments",
  "audit-stripe-payment",
  "backfill-payment-intent-ids",
  "notify-payment-failed",
] as const;

// ---------------------------------------------------------------------------
// Reading source. Two flavours, and the difference matters.
// ---------------------------------------------------------------------------

/**
 * Source with every comment blanked to same-length spaces (offsets preserved,
 * so index comparisons still mean line order).
 *
 * Load-bearing, not tidiness. `stripe-webhook-live` carries the sentence
 *
 *     // FAIL CLOSED. This branch used to do `event = JSON.parse(body)`, ...
 *
 * so the regression watchdog below — "no fork parses the body into an event" —
 * would fail against its own changelog if it read raw text. Same for
 * `invoice.paid`, which appears in prose and in no `case` label.
 */
const src = (fn: string) => blankComments(readEdgeFunctionSource(fn));

/** Source WITH its comments, for the two cases that assert what the prose says. */
const prose = (fn: string) => readEdgeFunctionSource(fn);

/** Only the request handler — module-level helpers above it are not the handler. */
function handlerOf(text: string): string {
  const m = /(?:Deno\.serve|\bserve)\s*\(\s*async/.exec(text);
  return m ? text.slice(m.index) : text;
}

/**
 * The body of one `case "<eventType>":` block, up to the next `case` or
 * `default:`.
 *
 * Safe here because none of these four files nests a switch: a grep for
 * `^\s*case ["']` returns 7 labels in each moded fork, 6 in the legacy one and
 * 2 in the Connect one, all at one indent level. If a nested switch ever
 * appears this throws no error and simply returns too much — so the assertions
 * built on it are all of the form "this string is ABSENT from the block", which
 * an over-large block can only make harder to pass, never easier.
 */
function caseBlock(text: string, eventType: string): string {
  const at = text.search(new RegExp(`case\\s+["']${eventType.replace(/\./g, "\\.")}["']\\s*:`));
  if (at === -1) return "";
  const rest = text.slice(at + eventType.length);
  const end = /\n\s*(?:case\s+["']|default\s*:)/.exec(rest);
  return rest.slice(0, end ? end.index : rest.length);
}

/**
 * Every Stripe event type this file dispatches on.
 *
 * Matched on the DOT that every Stripe event type contains, so a `case
 * "Completed":` in a status mapper (which is how `square-webhook` is written)
 * could never be counted as a handled webhook event.
 */
function handledEvents(fn: string): string[] {
  const out = [...src(fn).matchAll(/case\s+["']([a-z_]+(?:\.[a-z_]+)+)["']\s*:/g)].map((m) => m[1]);
  return [...new Set(out)].sort();
}

const configToml = readFileSync(join(REPO_ROOT, "supabase", "config.toml"), "utf8");
const generatedTypes = readFileSync(
  join(REPO_ROOT, "apps", "portal", "src", "integrations", "supabase", "types.ts"),
  "utf8",
);

/** Does `supabase/config.toml` declare this function open at the gateway? */
function declaredOpenAtGateway(fn: string): boolean {
  const m = new RegExp(`\\[functions\\.${fn}\\]\\s*\\n\\s*verify_jwt\\s*=\\s*(\\w+)`).exec(configToml);
  return m?.[1] === "false";
}

/** Is there a generated type for this table, i.e. does the table exist? */
const hasTable = (name: string) => new RegExp(`^      ${name}: \\{`, "m").test(generatedTypes);

// ===========================================================================
// A. WEBHOOK HEALTH — tracked per platform, as asked, and reported honestly.
//
// The finding this section exists to record: THERE IS NO STRIPE WEBHOOK HEALTH
// SURFACE. Not a delivery log, not an attempt counter, not a last-seen
// timestamp, not a portal or admin screen. The Square rail has one; the
// platform-subscription rail has an event-id claim table; the booking Stripe
// rail has neither, so a Stripe endpoint that Stripe has auto-disabled looks
// from inside this system exactly like a quiet weekend.
//
// One correction to the brief, on record because it changes the fix: the gap is
// NOT "no such table exists". `processed_stripe_events` exists in the schema
// today, with exactly the columns a claim needs, and `subscription-webhook`
// already uses it. The booking forks simply do not. (There is no
// `subscription-webhook-events` TABLE — `_shared/subscription-webhook-events.ts`
// is a constant LIST of event names that gets pushed to Stripe endpoints.)
// ===========================================================================
describe("stripe/webhook — health: can anyone tell whether Stripe is still being heard", () => {
  it("declares all four Stripe webhooks open at the gateway, with the reason written beside them", () => {
    // verify_jwt = false is correct and necessary here: Stripe holds no Supabase
    // JWT, so with the default on, the gateway 401s before the function runs and
    // the endpoint looks silently dead. What makes that safe is that each
    // function then authenticates the caller ITSELF, which section B asserts.
    for (const fn of ALL_WEBHOOKS) {
      expect(
        declaredOpenAtGateway(fn),
        `supabase/config.toml no longer declares [functions.${fn}] verify_jwt = false.\n` +
          `  Stripe cannot present a Supabase JWT, so the gateway will 401 every delivery\n` +
          `  before ${fn} runs — and Stripe reports that as a delivery failure, not as a\n` +
          `  rejection, so the endpoint looks alive right up to the auto-disable notice.`,
      ).toBe(true);
    }
    expect(
      configToml,
      "The rationale comment above the Stripe webhook block is gone. It is the only " +
        "place that records WHY these four are open, which is the first thing a " +
        "security review asks.",
    ).toContain("SIGNATURE VERIFICATION");
  });

  it("keeps the reconciliation tail behind the gateway, so only Stripe's own deliveries are unauthenticated", () => {
    // The recovery cron commits money. It carries the service-role key as a
    // Bearer token from pg_cron, so it does not need — and must not have — an
    // open door.
    for (const fn of RECONCILERS) {
      expect(
        configToml,
        `${fn} has been added to supabase/config.toml. If that is verify_jwt = false it ` +
          `is now anonymously callable, and recover-pending-stripe-payments in particular ` +
          `writes payments rows to Completed and runs the FIFO allocator.`,
      ).not.toContain(`[functions.${fn}]`);
    }
  });

  it("PINS TODAY'S BEHAVIOUR: no Stripe booking webhook records a delivery anywhere", () => {
    // ON RECORD. Nothing in any of the four writes an event row, a counter or a
    // timestamp, so there is no answer to "when did Stripe last reach us", per
    // platform or at all.
    for (const fn of ALL_WEBHOOKS) {
      const s = src(fn);
      for (const table of ["processed_stripe_events", "stripe_webhook_events", "cron_runs"]) {
        expect(
          s,
          `${fn} now writes ${table} — that is the FIX landing. Delete this pin and drop ` +
            `the .fails marker from the companion case below.`,
        ).not.toContain(table);
      }
    }
    // And there is no table waiting to be filled, either.
    for (const table of ["webhook_health", "webhook_deliveries", "webhook_log"]) {
      expect(hasTable(table), `${table} now exists in the schema.`).toBe(false);
    }
  });

  it("shows the Square rail doing it properly, which is why the Stripe gap is a gap and not a design", () => {
    // The precedent, green today, in this same repository. `square-webhook`
    // inserts one row per delivery before it mutates anything, so "is the
    // Square subscription still alive" is a SELECT.
    expect(hasTable("square_webhook_events")).toBe(true);
    const s = src("square-webhook");
    expect(s).toContain('.from("square_webhook_events")');
    expect(
      s,
      "square-webhook no longer refuses an event with no event id. Without a dedupe " +
        "key there is no replay defence at all, which is the state the Stripe forks " +
        "are in permanently.",
    ).toContain("refusing to process");
  });

  it("finds the claim table the booking forks need already in the schema, used by a different Stripe rail", () => {
    // This is the correction that changes the fix. `processed_stripe_events`
    // exists — event_id / event_type / processed_at / stripe_account — and the
    // platform-subscription webhook already claims into it. So the booking
    // forks need no migration, only the four lines that use it.
    //
    // Scope note: this asserts ONLY that the table and one writer exist. It
    // makes no claim about subscription-webhook's behaviour, which is the other
    // axis and belongs to checkout.test.ts.
    expect(hasTable("processed_stripe_events")).toBe(true);
    for (const column of ["event_id", "event_type", "processed_at", "stripe_account"]) {
      expect(generatedTypes.slice(generatedTypes.indexOf("processed_stripe_events: {"))).toContain(column);
    }
    expect(src("subscription-webhook")).toContain('.from("processed_stripe_events")');
  });

  it.fails("every Stripe webhook platform records its deliveries, so health can be read per platform", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // The smallest sufficient fix: claim `event.id` into the existing
    // `processed_stripe_events` table before the dispatch switch, exactly as
    // square-webhook claims into square_webhook_events. That buys BOTH the
    // health surface asked for here and the replay defence section D is about,
    // from one insert.
    const anyRecorded = ALL_WEBHOOKS.some((fn) =>
      /processed_stripe_events|stripe_webhook_events/.test(src(fn)),
    );
    expect(
      anyRecorded,
      "No Stripe booking or Connect webhook records a delivery. A Stripe endpoint that " +
        "has been auto-disabled after 84 consecutive failures — which has already " +
        "happened to stripe-webhook-live, see the constructEventAsync comment in it — " +
        "is indistinguishable from an endpoint nobody happened to pay through.",
    ).toBe(true);
  });

  it("PINS TODAY'S BEHAVIOUR: the only Stripe money-recovery cron writes no heartbeat", () => {
    // ON RECORD, and this is the second half of the same blindness. When the
    // webhook misses, this every-minute job is the only thing that commits the
    // payment. It returns its counters in an HTTP body that pg_cron's
    // net.http_post discards, and persists nothing — so a job that has been
    // dead for a week reports the same "no alerts" as a job with nothing to do.
    const s = src("recover-pending-stripe-payments");
    expect(
      s,
      "recover-pending-stripe-payments now writes cron_runs — the FIX. Delete this pin " +
        "and drop the .fails marker below.",
    ).not.toContain("cron_runs");
    // It does compute exactly the numbers a heartbeat would carry.
    for (const counter of ["scanned", "paid", "unchanged", "errors", "creditHealed"]) {
      expect(s, `The recovery cron no longer reports \`${counter}\`.`).toContain(counter);
    }
    // The in-repo precedent, so "nobody does this here" cannot be the excuse.
    expect(src("refresh-deposit-holds")).toContain("cron_runs");
    expect(hasTable("cron_runs")).toBe(true);
  });

  it.fails("the every-minute Stripe recovery cron writes a heartbeat, so a dead job is visible", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // Write the `{scanned, paid, unchanged, errors, creditHealed}` counters it
    // already computes to cron_runs, and alert on a non-zero `errors` or a
    // missed heartbeat — the treatment refresh-deposit-holds already gets, and
    // for the same reason it got it: "a chain that died on day 45 of a 90-day
    // rental was discovered when the car came back."
    expect(
      src("recover-pending-stripe-payments"),
      "The only Stripe webhook-miss recovery in the system leaves no trace of having run.",
    ).toContain("cron_runs");
  });
});

// ===========================================================================
// B. SIGNATURE VERIFICATION — and it must FAIL CLOSED.
//
// verify_jwt = false means the gateway lets anyone in, so this is the ONLY
// gate. It has already been open once: the else-branch below used to do
// `event = JSON.parse(body)`, and because the guard is an AND, simply OMITTING
// the stripe-signature header short-circuited it and landed there — confirmed
// exploitable against production, HTTP 200, with a service_role client in hand.
// A forged checkout.session.completed could mint account credit, mark invoices
// paid, or insert a captured payment.
//
// So these cases assert three separate things, and all three are needed:
// verification is PRESENT, it uses the real constructor rather than a
// hand-rolled comparison, and it is ABOVE every database touch.
// ===========================================================================
describe("stripe/webhook — signature verification, and that it fails closed", () => {
  it("reads the stripe-signature header and verifies it through Stripe's own constructor, in every fork", () => {
    for (const fn of ALL_WEBHOOKS) {
      const s = src(fn);
      expect(
        /headers\s*\.\s*get\(\s*["']stripe-signature["']\s*\)/.test(s),
        `${fn} no longer reads the stripe-signature header. With verify_jwt = false at ` +
          `the gateway, that header is the entire authentication story.`,
      ).toBe(true);
      expect(
        s,
        `${fn} no longer calls stripe.webhooks.constructEventAsync. Verifying a Stripe ` +
          `signature by hand means re-implementing the timestamped HMAC and its replay ` +
          `window, and a hand-rolled comparison is also where timing leaks live.`,
      ).toContain("constructEventAsync");
    }
  });

  it("never uses the synchronous constructEvent, which cannot work on Deno at all", () => {
    // Not style. `constructEvent()` throws "SubtleCryptoProvider cannot be used
    // in a synchronous context" on Deno because WebCrypto there is async-only —
    // so it threw for EVERY candidate secret, verification always fell through
    // to 400, and Stripe read that as a hard failure: 84 consecutive failures
    // and a pending auto-disable notice on the LIVE endpoint. The bug looked
    // exactly like a misconfigured secret.
    for (const fn of ALL_WEBHOOKS) {
      expect(
        /constructEvent\s*\(/.test(src(fn)),
        `${fn} calls the synchronous constructEvent(). On Deno it throws for every ` +
          `secret, so EVERY delivery 400s and the endpoint is auto-disabled — which stops ` +
          `checkout.session.completed for every tenant on that platform account.`,
      ).toBe(false);
    }
  });

  it("never parses the request body into an event, which is the fail-open branch that was exploitable", () => {
    // The regression watchdog. Comments are blanked first, so the changelog
    // sentence in stripe-webhook-live that QUOTES `JSON.parse(body)` cannot fail
    // this — only real code can.
    for (const fn of ALL_WEBHOOKS) {
      expect(
        /JSON\s*\.\s*parse\s*\(\s*body\s*\)/.test(src(fn)),
        `${fn} parses the raw request body as a Stripe event again. That is the exact ` +
          `fail-OPEN branch that was live in production: no signature, no secret, no ` +
          `check, HTTP 200, service_role client. A forged checkout.session.completed ` +
          `mints credit or inserts a captured payment.`,
      ).toBe(false);
    }
  });

  it("answers 400 for a missing header and 500 for a missing secret, which are different faults", () => {
    // The distinction is deliberate and is about Stripe's retry behaviour: a
    // missing header is the CALLER's fault (Stripe always sends one) and must
    // not be retried, while a missing secret is OUR misconfiguration and must
    // be, so the deliveries are still there to replay once the secret is set.
    for (const fn of ALL_WEBHOOKS) {
      expect(
        src(fn),
        `${fn} no longer distinguishes a missing signature from a missing secret. ` +
          `Collapsing both to 400 loses every delivery that arrived while a secret was ` +
          `unset; collapsing both to 500 invites Stripe to retry a forged POST 15 times.`,
      ).toContain("missingSignature ? 400 : 500");
      expect(src(fn)).toContain("Missing stripe-signature header");
    }
  });

  it("finishes verifying before it touches the database, so an unsigned POST can write nothing", () => {
    // THE ORDER IS THE POINT. Both forks build a service_role Supabase client
    // BEFORE verifying — which is fine, a client is not a query — but not one
    // `.from(...)` may sit above the refusal. This is the assertion that makes
    // "no DB write on a bad signature" true rather than hopeful.
    for (const fn of ALL_WEBHOOKS) {
      const handler = handlerOf(src(fn));
      const refusalAt = handler.indexOf("missingSignature ? 400 : 500");
      const firstQueryAt = handler.indexOf(".from(");
      expect(refusalAt, `${fn}: could not find the fail-closed refusal in the handler.`).toBeGreaterThan(-1);
      expect(firstQueryAt, `${fn}: found no database access at all in the handler.`).toBeGreaterThan(-1);
      expect(
        refusalAt < firstQueryAt,
        `${fn} touches the database BEFORE it has verified the signature.\n` +
          `  refusal@${refusalAt}  first .from()@${firstQueryAt}\n` +
          `  Every query above that line runs for an unauthenticated caller, with the\n` +
          `  service_role key, on an endpoint that is open at the gateway by design.`,
      ).toBe(true);
    }
  });

  it("refuses a present-but-wrong signature only after every candidate secret has been tried", () => {
    // During the UK -> UAE migration the same endpoint URL is registered on BOTH
    // platform accounts, so the first secret failing is not the event failing.
    // Rejecting on the first failure would drop every UAE delivery.
    for (const fn of MODED_FORKS) {
      const s = src(fn);
      expect(s).toContain("for (const secret of secretCandidates)");
      const loopAt = s.indexOf("for (const secret of secretCandidates)");
      const refuseAt = s.indexOf("if (!verified)");
      expect(refuseAt, `${fn} no longer has an all-secrets-failed branch.`).toBeGreaterThan(-1);
      expect(
        loopAt < refuseAt,
        `${fn} rejects before it has finished trying the candidate secrets. During the ` +
          `platform migration that silently drops every delivery signed by the other ` +
          `account.`,
      ).toBe(true);
      expect(s).toContain('error: "Invalid signature"');
    }
  });

  it("builds its candidate secret list without ever calling Deno.env.get on an empty string", () => {
    // A real outage, and a subtle one: `Deno.env.get('')` throws "TypeError: Key
    // is an empty string", and it throws WHILE the array literal is being built
    // — before `.filter()` can discard it. A ternary falling back to '' for the
    // live-only Connect secret therefore took down every TEST-mode webhook
    // delivery with an HTTP 500. The conditional spread is the fix.
    const shared = blankComments(
      readFileSync(join(REPO_ROOT, "supabase", "functions", "_shared", "stripe-client.ts"), "utf8"),
    );
    expect(
      /Deno\.env\.get\(\s*['"]['"]\s*\)/.test(shared),
      "_shared/stripe-client.ts calls Deno.env.get('') somewhere. It throws at array- " +
        "construction time, so one unset variable 500s every delivery on that fork.",
    ).toBe(false);
    expect(shared).toContain("...(mode === 'live' ? [Deno.env.get('STRIPE_LIVE_CONNECT_WEBHOOK_SECRET')] : [])");
  });
});

// ===========================================================================
// B2. LAYER 2 — the one live probe worth making, and why it is the one.
//
// WHAT IT DOES IF ENABLED: POSTs a JSON body at stripe-webhook-test with no
// stripe-signature header, and expects to be refused. It writes nothing, moves
// no money and needs no fixture — the refusal happens before the handler's
// first query, which the ordering case above asserts from source.
//
// WHY THIS PROBE AND NOT AN INVALID-SIGNATURE ONE: an invalid signature is
// still a PRESENT signature, so it takes the verify path and 400s whether the
// function fails open or closed. Only a MISSING-header probe reaches the
// else-branch that was once `JSON.parse(body)`. The function's own comment says
// so. A 200 here means the fail-open branch is back in production.
//
// Needs only D247_LIVE_TESTS=1 and a target that is not production; the helper
// throws on the production ref before any fetch.
// ===========================================================================
describe("stripe/webhook — live (Layer 2)", () => {
  it("live: an unsigned POST is refused rather than acked", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }

    // liveCall sends Content-Type, apikey and Authorization and no
    // stripe-signature — which is exactly the shape this probe needs. It is
    // deliberately not extended with a custom-header option: adding one would
    // let a future case forge a signature header, and this suite has no
    // business holding a signing secret.
    const res = await liveCall(
      "stripe-webhook-test",
      { id: "evt_drive247_spine_suite", type: "checkout.session.completed", data: { object: {} } },
      { token: status.target.anonKey },
    );

    expect(
      res.status,
      "AN UNSIGNED POST WAS ACKNOWLEDGED.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  This is not a stale test. It means the fail-open branch is live again: an\n" +
        "  unauthenticated caller can hand this endpoint a forged Stripe event and a\n" +
        "  service_role client will act on it. Treat as an incident, not a red build.\n" +
        `  ${classifyLive(res).explain}`,
    ).not.toBe(200);

    expect(
      res.status,
      "The endpoint refused, but not with the 400 its fail-closed branch writes.\n" +
        `  ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  A 401 means the gateway refused first — check verify_jwt in config.toml, and\n" +
        "  note that Stripe would be 401'd too, so deliveries are being lost. A 500\n" +
        "  means no webhook secret is configured on this project.",
    ).toBe(400);
    expect(String(res.json?.error ?? res.text)).toMatch(/missing stripe-signature/i);
  });
});

// ===========================================================================
// C. WHICH PLATFORM ACCOUNT A VERIFIED EVENT IS STAMPED WITH.
//
// `platformAccount` is not cosmetic: it is written to payments.platform_account
// and rentals.platform_account, and every later operation on that money —
// a refund, a capture, an audit — resolves its Stripe credentials FROM that
// column via getStripeClientForRecord. Stamp it wrong and the refund goes to
// the wrong Stripe account and 404s on "No such payment_intent".
// ===========================================================================
describe("stripe/webhook — which platform account a verified event is attributed to", () => {
  it("PINS TODAY'S BEHAVIOUR: only one of the three UAE-capable secrets flips the account to uae", () => {
    // ON RECORD. The candidate list a moded fork verifies against contains three
    // secrets that can belong to the UAE platform:
    //   STRIPE_UAE_{LIVE,TEST}_WEBHOOK_SECRET   (per mode)
    //   STRIPE_UAE_CONNECT_WEBHOOK_SECRET       (spread into BOTH lists)
    // and the fork compares the winning secret against exactly one of them.
    const shared = blankComments(
      readFileSync(join(REPO_ROOT, "supabase", "functions", "_shared", "stripe-client.ts"), "utf8"),
    );
    expect(shared).toContain("Deno.env.get('STRIPE_UAE_CONNECT_WEBHOOK_SECRET')");

    for (const fn of MODED_FORKS) {
      const s = src(fn);
      // The single comparison that decides the account.
      expect(
        s,
        `${fn} no longer decides platformAccount by comparing the winning secret to ` +
          `uaeSecret — either this is the fix, or the decision moved somewhere this pin ` +
          `cannot see.`,
      ).toContain("secret === uaeSecret");
      // And nothing else is consulted: the connect secret never sets the account.
      expect(
        /uaeConnect|STRIPE_UAE_CONNECT_WEBHOOK_SECRET/.test(s),
        `${fn} now names the UAE Connect secret. If it is used to resolve the account, ` +
          `delete this pin and drop the .fails marker below.`,
      ).toBe(false);
    }
  });

  it.fails("every UAE-named secret that can verify also resolves the platform account to uae", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // The account decision must come from the SAME table that produced the
    // candidate — `getWebhookSecretCandidates` returning `{secret, account,
    // mode}` tuples, so the verifying candidate carries its own account and the
    // two sets cannot drift. Comparing against one env var by name is a
    // second, hand-maintained copy of that table.
    //
    // Today, a connected-account event verified by STRIPE_UAE_CONNECT_WEBHOOK_SECRET
    // is stamped platform_account = 'uk'. The refund that later reads that
    // column then asks the wrong Stripe account for the charge.
    const candidateAware = MODED_FORKS.every((fn) =>
      /account\s*[:=]\s*['"]uae['"][\s\S]{0,400}CONNECT_WEBHOOK_SECRET|secret\.account/.test(src(fn)),
    );
    expect(
      candidateAware,
      "A UAE Connect-secret verification still resolves platformAccount to 'uk', because " +
        "the fork checks one env var by name instead of asking the candidate which " +
        "account it came from.",
    ).toBe(true);
  });
});

// ===========================================================================
// D. A REDELIVERY OF THE SAME EVENT ID.
//
// Stripe retries a non-2xx roughly 15 times over ~3 days, and a human can
// replay any event from the dashboard at will. So "the same event id arrives
// twice" is not an edge case, it is the normal operating condition of a webhook.
// ===========================================================================
describe("stripe/webhook — a redelivery of the same event id", () => {
  it("PINS TODAY'S BEHAVIOUR: verification runs straight into the dispatch switch with no event-id claim between", () => {
    // ON RECORD, and it is the largest structural gap in this subsystem. There
    // is nothing between "this signature is genuine" and "run the handler" — no
    // claim, no lookup, no `event.id` anywhere near the switch — so a replay
    // re-runs every write the handler performs.
    for (const fn of ALL_WEBHOOKS) {
      const handler = handlerOf(src(fn));
      const verifiedAt = handler.indexOf("missingSignature ? 400 : 500");
      const switchAt = handler.search(/switch\s*\(\s*event\.type\s*\)/);
      expect(switchAt, `${fn} no longer dispatches on event.type.`).toBeGreaterThan(-1);
      const between = handler.slice(verifiedAt, switchAt);
      expect(
        /processed_stripe_events|webhook_events|duplicate/i.test(between),
        `${fn} now does something with the event id before dispatching — that is the FIX ` +
          `landing. Delete this pin and drop the .fails marker below.`,
      ).toBe(false);
    }
  });

  it("shows the claim-then-release shape the Stripe forks are missing, working on the Square rail", () => {
    // The reference implementation, in this repo, green. Two halves, and both
    // matter: the claim insert BEFORE any mutation, and the release on failure
    // — because leaving the claim behind after a failed run makes the dedupe
    // swallow every retry, and the money is then never applied at all.
    const s = src("square-webhook");
    const claimAt = s.indexOf('.from("square_webhook_events")');
    const switchAt = s.search(/switch\s*\(\s*eventType\s*\)/);
    expect(claimAt).toBeGreaterThan(-1);
    expect(switchAt).toBeGreaterThan(-1);
    expect(
      claimAt < switchAt,
      "square-webhook's claim insert has moved below its dispatch. The claim only " +
        "defends a replay if it happens first.",
    ).toBe(true);
    expect(s).toContain("duplicate: true");
    expect(s).toContain("releaseClaim");
  });

  it.fails("every Stripe booking webhook claims the event id before it dispatches", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // Insert `event.id` into the existing `processed_stripe_events` table above
    // the switch; return 200 `{duplicate: true}` on a unique violation; delete
    // the claim if processing then fails, so a genuine retry can still do the
    // work. That is square-webhook's shape and it needs no new migration —
    // section A shows the table is already there.
    for (const fn of BOOKING_FORKS) {
      const handler = handlerOf(src(fn));
      const switchAt = handler.search(/switch\s*\(\s*event\.type\s*\)/);
      expect(
        /processed_stripe_events/.test(handler.slice(0, switchAt)),
        `${fn} has no replay defence whatsoever. Stripe's own retries and any dashboard ` +
          `replay re-run every write in the handler.`,
      ).toBe(true);
    }
  });

  it("leans entirely on the FIFO allocator to keep a replayed rental payment from being applied twice", () => {
    // With no dedupe, the ONLY thing standing between a replayed
    // checkout.session.completed and a second allocation of the same money is
    // that payment_apply_fifo_v2 subtracts what it has already applied before
    // deciding what is left. That one line is load-bearing far beyond its
    // migration, so it is pinned here as well as wherever the accounting tests
    // pin it.
    for (const file of [
      "20260420140000_fix_payment_fifo_all_categories.sql",
      "20260603120000_fifo_v2_generic_pays_extension.sql",
    ]) {
      const sql = readFileSync(join(REPO_ROOT, "supabase", "migrations", file), "utf8");
      expect(
        sql,
        `${file} no longer computes the allocator's remaining amount as ` +
          `"this payment minus what it has already allocated". Without that subtraction, ` +
          `a replayed webhook allocates the same money a second time — and there is no ` +
          `dedupe upstream to stop the replay.`,
      ).toContain("v_left := v_amt - v_already");
    }
    // CAVEAT, recorded rather than hidden: CLAUDE.md notes some DB changes are
    // applied through the Management API with no migration file kept, so the
    // live body of this function could differ from the newest file in the tree.
    // This asserts the repo, which is all a source-derived test can honestly do.
  });

  it("PINS TODAY'S BEHAVIOUR: a replayed payment_intent.succeeded rewrites the row's status unconditionally", () => {
    // ON RECORD. The write is a bare UPDATE to status 'Applied' with no
    // comparison against what the row currently says. A replay of an old event
    // is therefore not a no-op — see section E for what that costs when the row
    // has moved on since.
    const block = caseBlock(src("stripe-webhook-live"), "payment_intent.succeeded");
    expect(block).toContain('status: "Applied"');
    expect(
      /rankOf|STATUS_RANK|advances/.test(block),
      "payment_intent.succeeded now compares against the row's current status — the FIX. " +
        "Delete this pin and drop the .fails marker in section E.",
    ).toBe(false);
  });
});

// ===========================================================================
// E. OUT-OF-ORDER DELIVERY.
//
// Stripe does not promise order. Two events about one PaymentIntent can arrive
// reversed, and a retried event can land hours after the event that superseded
// it. Every write below is a last-write-wins overwrite, so late is the same as
// current.
// ===========================================================================
describe("stripe/webhook — out-of-order delivery", () => {
  it("PINS TODAY'S BEHAVIOUR: no Stripe status write is compared against the row it is overwriting", () => {
    // ON RECORD across all three money-status branches. Each reads the row, then
    // writes a status without asking whether that status is ahead of what is
    // there. A late payment_intent.succeeded can therefore pull a refunded or
    // reversed row back to 'Applied' — which also makes its remaining_amount
    // allocatable again.
    for (const fn of MODED_FORKS) {
      const s = src(fn);
      expect(
        /rankOf|STATUS_RANK|captureRankOf/.test(s),
        `${fn} now ranks statuses before writing them — the FIX. Delete this pin and ` +
          `drop the .fails marker below.`,
      ).toBe(false);
      for (const event of ["payment_intent.succeeded", "payment_intent.canceled", "charge.refunded"]) {
        const block = caseBlock(s, event);
        expect(block, `${fn} no longer handles ${event}.`).not.toBe("");
        expect(
          /status:\s*["'`]|status:\s*isFullRefund/.test(block),
          `${fn}'s ${event} branch no longer writes a status at all — check whether the ` +
            `write moved somewhere this pin cannot see.`,
        ).toBe(true);
      }
    }
  });

  it("shows the Square rail moving a payments row forward only, and zeroing it when it goes terminal", () => {
    // The precedent, green, and worth reading before writing the fix: the rank
    // comparison and the two consequences that hang off it — paid_at taken from
    // the PROVIDER's clock (so a redelivery hours later does not record the
    // money as arriving now) and remaining_amount zeroed on a terminal status
    // (so a row that will never become money is not left allocatable).
    const s = src("square-webhook");
    expect(s).toContain("rankOf(nextStatus) > rankOf(row.status)");
    expect(s).toContain("captureRankOf(capture) > captureRankOf(row.capture_status)");
    expect(s).toContain("update.remaining_amount = 0");
  });

  it.fails("Stripe status writes are monotonic against the row they are updating", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // One shared rank table for the eight members of payments_status_check, and
    // every Stripe status write gated on `rank(next) > rank(current)` — the
    // shape square-webhook already has. Until then, ordering is luck.
    for (const fn of MODED_FORKS) {
      expect(
        /rankOf|STATUS_RANK/.test(src(fn)),
        `${fn} has no forward-only guard, so a late or replayed event overwrites a newer ` +
          `state — including pulling a Refunded row back to Applied.`,
      ).toBe(true);
    }
  });

  it("PINS TODAY'S BEHAVIOUR: account.updated applies whatever the last delivery said, without reading event.created", () => {
    // ON RECORD on the Connect fork. Onboarding fires a burst of account.updated
    // events; delivered out of order, a stale one can overwrite fresh Connect
    // health and put a tenant back on a charge path they have already left.
    const block = caseBlock(src("stripe-connect-webhook"), "account.updated");
    expect(block, "stripe-connect-webhook no longer handles account.updated.").not.toBe("");
    expect(
      /event\.created/.test(block),
      "account.updated now consults event.created — the FIX. Delete this pin and drop " +
        "the .fails marker below.",
    ).toBe(false);
  });

  it.fails("account.updated applies a Connect health patch only when the event is newer than what is stored", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // Persist `event.created` alongside the health columns and apply the patch
    // only when it is newer — and set the synced-at stamp FROM event.created
    // rather than from now(), so the stored value can be compared against the
    // next event at all.
    expect(
      /event\.created/.test(src("stripe-connect-webhook")),
      "stripe-connect-webhook is last-write-wins on Connect account health.",
    ).toBe(true);
  });

  it("PINS TODAY'S BEHAVIOUR: the legacy fork's PaymentIntent backfill re-captures capture_status on every redelivery", () => {
    // ON RECORD, and this is the clearest single example of what missing
    // ordering costs. Both moded forks guard the backfill with
    // `.is("stripe_payment_intent_id", null)`, so a replay writes nothing. The
    // legacy fork has no such filter AND also writes capture_status — so a
    // redelivery of an old checkout.session.completed sets capture_status back
    // to 'captured' on a row that has since been cancelled or refunded.
    for (const fn of MODED_FORKS) {
      expect(src(fn)).toContain('.is("stripe_payment_intent_id", null)');
    }
    const legacy = src("stripe-webhook");
    expect(
      legacy,
      "The legacy fork now guards its backfill — the FIX, or the fork was rewritten. " +
        "Check the .fails marker in section H.",
    ).not.toContain('.is("stripe_payment_intent_id", null)');
    expect(legacy).toContain("capture_status: captureStatus");
  });
});

// ===========================================================================
// F. AN EVENT TYPE NOBODY HANDLES, AND AN INTERNAL FAILURE.
//
// The two status codes are opposite obligations and both are load-bearing:
//
//   unknown event   -> 200. Anyone can widen an endpoint's enabled-events list
//                     in the Stripe dashboard, and a 500 on the new type would
//                     make Stripe retry it ~15 times, book every attempt
//                     against the endpoint's auto-disable budget, and take the
//                     endpoint down for the events that DO matter.
//   internal error  -> 500. That is the only way to ask for a redelivery, and
//                     the money has not been recorded yet.
// ===========================================================================
describe("stripe/webhook — an unrecognised event, and an internal failure", () => {
  it("acks an unrecognised event type with a log line and a 200 rather than an error", () => {
    for (const fn of ALL_WEBHOOKS) {
      const s = src(fn);
      expect(
        /default\s*:/.test(s),
        `${fn} has no default branch. An event type it does not know now falls out of ` +
          `the switch — and if that throws, Stripe retries it ~15 times and spends this ` +
          `endpoint's auto-disable budget on an event nobody wanted.`,
      ).toBe(true);
      expect(/Unhandled event type/i.test(s), `${fn} no longer logs the events it drops.`).toBe(true);
      expect(s).toContain("received: true");
    }
  });

  it("answers 500 from the booking forks' outer catch, which is the only way to ask Stripe again", () => {
    for (const fn of BOOKING_FORKS) {
      const s = src(fn);
      const tail = s.slice(s.lastIndexOf("catch"));
      expect(
        tail,
        `${fn}'s outer catch no longer answers 500. A transient failure — a DB blip mid- ` +
          `handler — would then be acknowledged as success and the money never recorded, ` +
          `with no delivery left to replay.`,
      ).toContain("status: 500");
    }
  });

  it("PINS TODAY'S BEHAVIOUR: the Connect fork answers 400 from its outer catch, telling Stripe not to retry", () => {
    // ON RECORD, and it contradicts the model the three booking forks state and
    // follow. account.application.deauthorized is the event that reverts a
    // tenant's charge path; swallowing a transient failure on it as 400 means
    // the tenant is left on a payment model with no account and no redelivery
    // is coming.
    const s = src("stripe-connect-webhook");
    const tail = s.slice(s.lastIndexOf("catch"));
    expect(
      tail,
      "stripe-connect-webhook's outer catch now answers something other than 400 — if it " +
        "is 500, that is the FIX. Delete this pin and drop the .fails marker below.",
    ).toContain("status: 400");
  });

  it.fails("every Stripe webhook answers 500 on an internal failure, reserving 400 for a bad request", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // 400 belongs to a malformed or unsigned request — a fault Stripe cannot fix
    // by trying again. Everything the handler itself gets wrong is a 500, so the
    // delivery survives to be retried.
    for (const fn of ALL_WEBHOOKS) {
      const s = src(fn);
      expect(
        s.slice(s.lastIndexOf("catch")),
        `${fn} answers a non-500 from its outer catch, so a transient internal failure is ` +
          `acknowledged and the delivery is gone.`,
      ).toContain("status: 500");
    }
  });
});

// ===========================================================================
// G. WHICH EVENTS ARE HANDLED, AND WHICH ARE SILENTLY DROPPED.
//
// The allowlist below is written down BY HAND and asserted in both directions,
// which is the only version of this test worth having: a snapshot of whatever
// the switch says today would go green on a handler being deleted.
// ===========================================================================
describe("stripe/webhook — which events are handled and which are dropped", () => {
  /** Reviewed, by hand, against the switch in each moded fork. */
  const MODED_ALLOWLIST = [
    "charge.refunded",
    "checkout.session.completed",
    "checkout.session.expired",
    "payment_intent.amount_capturable_updated",
    "payment_intent.canceled",
    "payment_intent.payment_failed",
    "payment_intent.succeeded",
  ];

  it("handles exactly seven event types in each moded booking fork, no more and no fewer", () => {
    for (const fn of MODED_FORKS) {
      expect(
        handledEvents(fn),
        `${fn}'s handled-event set has drifted from the reviewed allowlist in this file.\n` +
          `  A NEW entry means an event is now being acted on that nobody here has read.\n` +
          `  A MISSING entry means a money handler was deleted and Stripe is still\n` +
          `  delivering that event, which now falls to the default 200 and is dropped.`,
      ).toEqual(MODED_ALLOWLIST);
    }
  });

  it("handles six of those seven in the legacy fork, which never learned the pre-auth deadline event", () => {
    // Recorded rather than fixed, because the honest answer to "should this fork
    // exist at all" is section H. The missing event is the one that corrects
    // payments.preauth_expires_at from a value Stripe actually published, so on
    // this fork that column keeps whatever guess create-preauth-checkout wrote.
    expect(handledEvents("stripe-webhook")).toEqual(
      MODED_ALLOWLIST.filter((e) => e !== "payment_intent.amount_capturable_updated"),
    );
  });

  it("handles exactly the two Connect account-lifecycle events, and no money events", () => {
    // A money event arriving here would be dropped silently, so the split
    // between this endpoint and the booking forks is itself part of the contract.
    expect(handledEvents("stripe-connect-webhook")).toEqual([
      "account.application.deauthorized",
      "account.updated",
    ]);
  });

  it("PINS TODAY'S BEHAVIOUR: a disputed charge, a failed refund and an invoice event are dropped with a log line", () => {
    // ON RECORD. Three absences, in descending order of cost:
    //   charge.dispute.created   a chargeback. Money is being pulled back out of
    //                            the operator's balance and nothing in this
    //                            system will ever know.
    //   charge.refund.updated    a refund that FAILED after being accepted.
    //                            process-refund has already written the row as
    //                            refunded, so the customer is recorded as repaid.
    //   invoice.paid             named in this fork's own prose as an event it
    //                            serves (see the next case).
    for (const fn of BOOKING_FORKS) {
      const handled = handledEvents(fn);
      for (const missing of ["charge.dispute.created", "charge.refund.updated", "invoice.paid"]) {
        expect(
          handled,
          `${fn} now handles ${missing} — the FIX. Add it to MODED_ALLOWLIST above, delete ` +
            `this pin, and drop the .fails marker below.`,
        ).not.toContain(missing);
      }
    }
  });

  it("PINS TODAY'S BEHAVIOUR: the forks' own prose names invoice.paid as an event they serve, and no such handler exists", () => {
    // ON RECORD as a documentation defect with teeth. Read WITH comments, on
    // purpose: this is a claim about what the file tells the next reader. The
    // sentence weighing up 500-vs-200 warns that a disabled endpoint "stops
    // checkout.session.completed, invoice.paid and installment settlement for
    // ALL tenants" — two of those three are real cases in the switch and one is
    // not, so anyone reasoning from this comment about invoice handling is
    // reasoning about code that does not exist.
    for (const fn of MODED_FORKS) {
      expect(prose(fn)).toContain("invoice.paid");
      expect(handledEvents(fn)).not.toContain("invoice.paid");
    }
  });

  it.fails("a disputed charge reaches a handler rather than the default log line", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // `charge.dispute.created` is money leaving the operator's Stripe balance
    // against a rental this system believes is paid. At minimum it needs to mark
    // the payments row disputed and ring the operator bell, and the allowlist
    // above needs the new entry so the pair stays honest.
    const handled = handledEvents("stripe-webhook-live");
    expect(
      handled.includes("charge.dispute.created"),
      "No Stripe fork handles a chargeback. The operator finds out from Stripe's email, " +
        "and the rental still reads as settled.",
    ).toBe(true);
  });
});

// ===========================================================================
// H. THE TEST / LIVE / LEGACY SPLIT.
//
// Three booking webhook URLs are deployed and all three are open at the
// gateway. WHICH ONE Stripe actually delivers to is registered in the Stripe
// dashboard and is not knowable from this repository — I looked in config.toml,
// scripts/, ops/, docs/, .env.example and every *.md. That unknown is why the
// legacy fork's divergence is recorded as a defect rather than shrugged off.
// ===========================================================================
describe("stripe/webhook — the test, live and legacy split", () => {
  it("keys each moded fork to its own Stripe mode, from the API key to the signing secrets", () => {
    const live = src("stripe-webhook-live");
    expect(live).toContain('Deno.env.get("STRIPE_LIVE_SECRET_KEY")');
    expect(live).toContain('getWebhookSecretCandidates("live")');

    const test = src("stripe-webhook-test");
    expect(test).toContain('Deno.env.get("STRIPE_TEST_SECRET_KEY")');
    expect(test).toContain('getWebhookSecretCandidates("test")');

    // The cross-check that matters: neither may reach for the other's key. A
    // live event processed with test keys writes DB rows while every Stripe
    // retrieve 404s.
    expect(
      live,
      "stripe-webhook-live now references a TEST Stripe key. A live PaymentIntent cannot " +
        "be read with test credentials, so every Stripe call in the handler fails while " +
        "the DB writes land.",
    ).not.toContain("STRIPE_TEST_SECRET_KEY");
    expect(test).not.toContain("STRIPE_LIVE_SECRET_KEY");
  });

  it("PINS TODAY'S BEHAVIOUR: the legacy fork is mode-agnostic and keyed on the variable .env.example documents as a test key", () => {
    // ON RECORD. It builds ONE Stripe client from `STRIPE_SECRET_KEY` and
    // verifies against ONE `STRIPE_WEBHOOK_SECRET`, with no notion of mode at
    // all — and .env.example's only line for that variable is `sk_test_...`.
    // It is nonetheless open at the gateway, so if a live endpoint is still
    // registered against it, live events are being processed with test keys.
    const s = src("stripe-webhook");
    expect(s).toContain('Deno.env.get("STRIPE_SECRET_KEY")');
    expect(s).toContain('Deno.env.get("STRIPE_WEBHOOK_SECRET")');
    expect(s).not.toContain("getWebhookSecretCandidates");
    const envExample = readFileSync(join(REPO_ROOT, ".env.example"), "utf8");
    expect(envExample).toContain("STRIPE_SECRET_KEY=sk_test_");
    expect(declaredOpenAtGateway("stripe-webhook")).toBe(true);
  });

  it("PINS TODAY'S BEHAVIOUR: the legacy fork never allocates a rental payment and never stamps the platform account", () => {
    // ON RECORD, and it is the reason the fork's existence is a live question
    // rather than a tidy-up. Where the moded forks advance the pre-created
    // Pending row and then invoke apply-payment to run FIFO, this one inserts a
    // Completed row and stops. Balance Due never drops, and
    // payments.platform_account is left NULL — which every later refund reads as
    // 'uk'.
    const legacy = src("stripe-webhook");
    for (const marker of ["apply-payment", "payment_apply_fifo", "platform_account"]) {
      expect(
        legacy,
        `stripe-webhook now contains "${marker}" — the FIX, or a rewrite. Delete this pin ` +
          `and drop the .fails marker below.`,
      ).not.toContain(marker);
    }
    // The moded forks do all three, so this is divergence and not a missing feature.
    for (const fn of MODED_FORKS) {
      expect(src(fn)).toContain("apply-payment");
      expect(src(fn)).toContain("platform_account");
    }
  });

  it.fails("the legacy fork either reaches parity on the simple-rental path or is retired", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // Two acceptable fixes and this passes on either:
    //   (a) retire it — drop [functions.stripe-webhook] from config.toml and
    //       delete the directory, after confirming in the Stripe dashboard that
    //       no endpoint points at it; or
    //   (b) bring its simple-rental branch to parity with the moded forks —
    //       advance the existing row, stamp platform_account, invoke apply-payment.
    const retired = !declaredOpenAtGateway("stripe-webhook");
    const atParity = src("stripe-webhook").includes("apply-payment");
    expect(
      retired || atParity,
      "stripe-webhook is still gateway-open and still cannot allocate a rental payment. " +
        "Which endpoint Stripe delivers to is not knowable from this repo, so this is " +
        "either dead code that should be deleted or a live money bug.",
    ).toBe(true);
  });

  it("PINS TODAY'S BEHAVIOUR: one UAE Connect secret is offered to both the test and the live fork", () => {
    // ON RECORD as an unresolved question rather than a confirmed bug, because
    // resolving it needs the Stripe dashboard. STRIPE_UAE_CONNECT_WEBHOOK_SECRET
    // is spread into BOTH candidate lists while the comment beside it says "Only
    // a LIVE connect secret exists" of its sibling. If it is a live-mode secret,
    // a LIVE connected-account event can verify on stripe-webhook-TEST and then
    // be processed with test API keys. It is not in .env.example at all.
    const shared = blankComments(
      readFileSync(join(REPO_ROOT, "supabase", "functions", "_shared", "stripe-client.ts"), "utf8"),
    );
    const fn = shared.slice(shared.indexOf("export function getWebhookSecretCandidates"));
    const body = fn.slice(0, fn.indexOf("export function getConnectWebhookSecretCandidates"));
    expect(
      /mode === 'live'[^\n]*STRIPE_UAE_CONNECT_WEBHOOK_SECRET/.test(body),
      "The UAE Connect secret is now mode-gated — that resolves the question this pin " +
        "records. Delete the pin.",
    ).toBe(false);
    expect(body).toContain("Deno.env.get('STRIPE_UAE_CONNECT_WEBHOOK_SECRET')");
    const envExample = readFileSync(join(REPO_ROOT, ".env.example"), "utf8");
    expect(envExample).not.toContain("STRIPE_UAE_CONNECT_WEBHOOK_SECRET");
  });
});

// ===========================================================================
// I. checkout.session.expired — THE STALE PENDING ROWS.
//
// The named known issue, and it is CONFIRMED against source in all three
// booking forks: the handler cancels the rental and never touches the payments
// row, so the row create-checkout-session pre-created stays Pending for ever.
//
// ONE CORRECTION TO THE BRIEF, recorded because a wrong number is worse than
// none: the ~3,900 figure could not be confirmed. The only in-repo data point
// is supabase/migrations/20260825200000_payments_recovery_index.sql, which
// describes the whole payments table as 1,026 rows as of 2026-08-25 — so that
// count cannot be 3,900 stale Pending rows on this table on that date. The
// MECHANISM below is exact; the magnitude needs a production count.
// ===========================================================================
describe("stripe/webhook — an expired checkout session", () => {
  it("PINS TODAY'S BEHAVIOUR: the expired handler writes only the rentals table, in all three booking forks", () => {
    // ON RECORD, and this is the highest-value pin in the file. The entire
    // handler reads `rentals`, writes `rentals`, and breaks. The payments row
    // that create-checkout-session inserted as Pending / requires_capture is
    // never advanced, so it stays in the Pending population for ever — showing
    // in operator screens as money still expected against a rental that has
    // been Cancelled.
    for (const fn of BOOKING_FORKS) {
      const block = caseBlock(src(fn), "checkout.session.expired");
      expect(block, `${fn} no longer handles checkout.session.expired.`).not.toBe("");
      expect(block).toContain('.from("rentals")');
      expect(
        block,
        `${fn}'s checkout.session.expired branch now touches the payments table — that is ` +
          `the FIX landing. Delete this pin and drop the .fails marker below.`,
      ).not.toContain("payments");
    }
  });

  it("does correctly refuse to cancel a rental that is no longer Pending", () => {
    // The half that IS right, and worth pinning so a fix to the payments half
    // does not lose it. An expired session on a rental that has since been
    // activated must not cancel the rental — Stripe sessions expire 24 hours
    // after creation, which is long enough for the booking to have started.
    for (const fn of BOOKING_FORKS) {
      const block = caseBlock(src(fn), "checkout.session.expired");
      expect(block).toContain('rental?.status === "Pending"');
      expect(block).toContain('status: "Cancelled"');
    }
  });

  it("shows nothing downstream terminalising the row either, so Pending is genuinely permanent", () => {
    // The three candidates, and why each one leaves the row alone:
    //   the recovery cron        commits only what Stripe reports as `paid`, and
    //                            `continue`s on everything else — it never marks
    //                            a row dead;
    //   its 24-hour window       stops it looking at the row at all after a day;
    //   void-payment-link        is a manual staff action on a caller-supplied
    //                            paymentId, not a sweeper.
    const cron = src("recover-pending-stripe-payments");
    expect(cron).toContain("session.payment_status !== 'paid'");
    expect(cron).toContain("unchanged++; continue;");
    expect(cron).toContain("24 * 60 * 60 * 1000");
    expect(
      cron,
      "The recovery cron now writes a terminal status. If it terminalises expired " +
        "sessions, that is one valid fix for the case below.",
    ).not.toContain("'Reversed'");
    expect(src("void-payment-link")).toContain('status: "Reversed"');
  });

  it("finds the terminal status the expired branch needs already defined, and already meaning exactly this", () => {
    // So the fix needs no migration and no new vocabulary. 'Reversed' is a
    // member of payments_status_check, void-payment-link writes it with the pair
    // that makes it safe, and square-webhook writes the same pair for the same
    // meaning — "this payment row will never become money".
    const migration = readFileSync(
      join(REPO_ROOT, "supabase", "migrations", "20260121100000_add_reversed_payment_status.sql"),
      "utf8",
    );
    expect(migration).toContain("'Reversed'");
    expect(migration).toContain("payments_status_check");

    // The exact triple both existing writers use.
    const voidLink = src("void-payment-link");
    expect(voidLink).toContain('status: "Reversed"');
    expect(voidLink).toContain('capture_status: "cancelled"');
    expect(voidLink).toContain("remaining_amount: 0");
  });

  it.fails("an expired checkout session leaves its payments row terminal rather than Pending for ever", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // In the checkout.session.expired branch, for a payments row matching this
    // session that is still Pending and uncaptured, write the same triple
    // void-payment-link and square-webhook already write:
    //     status = 'Reversed', capture_status = 'cancelled', remaining_amount = 0
    // Guard it on the row still being Pending (an expired session must never
    // reverse money that was captured by another path), and prefer the event's
    // own clock for any timestamp.
    //
    // This is asserted as "the branch writes payments at all", not as an exact
    // string, so any reasonable implementation of the above turns it red.
    for (const fn of BOOKING_FORKS) {
      const block = caseBlock(src(fn), "checkout.session.expired");
      expect(
        /payments/.test(block),
        `${fn} cancels the rental on an expired checkout and never touches the payments ` +
          `row, so every expired session leaves a permanent Pending row against a ` +
          `Cancelled rental. This is the stale-Pending population.`,
      ).toBe(true);
    }
  });

  it("leaves a zero-minute overlap between a session's life and the recovery cron's window (Layer 3)", () => {
    // WHY THIS IS ARITHMETIC AND NOT AN OPINION.
    //
    // No rental checkout creator passes `expires_at`, so every session lives
    // Stripe's default 24 hours — 24 x 60 = 1440 minutes. The recovery cron's
    // cutoff is `now - 24h`, i.e. it only considers rows created within the last
    // 1440 minutes.
    //
    // A session created at minute 0 expires at minute 1440. The cron's last look
    // at that row is also at minute 1440. So:
    //
    //     1440 (row still in the cron's window) - 1440 (session's life) = 0
    //
    // ZERO minutes of overlap in which the cron could see an EXPIRED session.
    // There is no margin at all: the delivery that says "expired" arrives at the
    // very edge of the window, and one minute of Stripe delivery latency puts
    // the row permanently out of reach. Even if the cron were taught to
    // terminalise, it could not reach these rows — which is why the fix has to
    // be in the webhook branch above, not in the cron.
    const SESSION_LIFETIME_MIN = 24 * 60; // Stripe's default, no expires_at set
    const CRON_WINDOW_MIN = 24 * 60; // cutoffIso = now - 24h
    expect(SESSION_LIFETIME_MIN).toBe(1440);
    expect(CRON_WINDOW_MIN).toBe(1440);
    expect(CRON_WINDOW_MIN - SESSION_LIFETIME_MIN).toBe(0);

    // Both halves of that sum, pinned to source so the arithmetic cannot rot.
    expect(src("recover-pending-stripe-payments")).toContain("24 * 60 * 60 * 1000");
    expect(
      /expires_at/.test(src("create-checkout-session")),
      "create-checkout-session now sets expires_at. The session lifetime above is no " +
        "longer Stripe's 24-hour default and this arithmetic needs redoing.",
    ).toBe(false);
  });
});

// ===========================================================================
// J. payment_intent.canceled — a cancelled authorisation.
// ===========================================================================
describe("stripe/webhook — a cancelled authorisation", () => {
  it("recognises a cancelled security-deposit hold and never mistakes it for a cancelled booking", () => {
    // Green, and the guard is why. Deposit holds are cancelled ROUTINELY —
    // released at the end of a rental, rolled over after a partial capture,
    // voided by the network on expiry — and before this guard existed any of
    // those took a live rental down with it.
    const s = src("stripe-webhook-live");
    expect(s).toContain('const DEPOSIT_HOLD_PI_TYPES = ["deposit_hold", "deposit_hold_rollover", "security_deposit_hold"]');
    const block = caseBlock(s, "payment_intent.canceled");
    expect(block).toContain("isDepositHoldPi");
    // The guard must break BEFORE the payments write, or it is only a log line.
    const guardAt = block.indexOf("if (isDepositHoldPi)");
    const writeAt = block.indexOf('capture_status: "cancelled"');
    expect(guardAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(
      guardAt < writeAt,
      "The deposit-hold guard has moved BELOW the payments update. A routine hold " +
        "release would then mark a booking's money cancelled.",
    ).toBe(true);
  });

  it("cancels only a rental still awaiting payment, and cancels nothing when the status read fails", () => {
    // Both halves are deliberate. The rental read uses maybeSingle and its error
    // is logged rather than swallowed, and because an errored read leaves the
    // row null the `=== "Pending"` check is fail-safe: no read, no cancellation.
    const block = caseBlock(src("stripe-webhook-live"), "payment_intent.canceled");
    expect(block).toContain('cancelRental?.status === "Pending"');
    expect(block).toContain(".maybeSingle()");
    expect(block).toContain("leaving rental untouched");
  });

  it("PINS TODAY'S BEHAVIOUR: a never-captured authorisation is recorded 'Refunded' with its balance still allocatable", () => {
    // ON RECORD, two wrongs in one write. 'Refunded' means money went back to a
    // cardholder; nothing was ever taken here, so the row now claims a refund
    // that never happened and will be counted as one by anything reading refund
    // totals. And remaining_amount is left untouched, so the FIFO allocator can
    // still spend a balance that does not exist.
    const block = caseBlock(src("stripe-webhook-live"), "payment_intent.canceled");
    expect(block).toContain('status: "Refunded"');
    expect(
      block,
      "payment_intent.canceled now zeroes remaining_amount — the FIX. Delete this pin and " +
        "drop the .fails marker below.",
    ).not.toContain("remaining_amount: 0");
  });

  it.fails("a cancelled, never-captured PaymentIntent is recorded Reversed with nothing left to allocate", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // Write the established triple — status 'Reversed', capture_status
    // 'cancelled', remaining_amount 0 — exactly as void-payment-link and
    // square-webhook do. 'Refunded' must be reserved for money that actually
    // went back.
    const block = caseBlock(src("stripe-webhook-live"), "payment_intent.canceled");
    expect(
      /status:\s*"Reversed"/.test(block) && /remaining_amount:\s*0/.test(block),
      "A cancelled authorisation is filed as a refund and its phantom balance stays " +
        "allocatable by the FIFO engine.",
    ).toBe(true);
  });
});

// ===========================================================================
// K. THE LOOKUPS THAT DECIDE WHOSE MONEY THIS IS.
//
// Every handler starts by resolving one payments row. Four of those lookups use
// `.single()` and discard the error, which turns a transient read failure into
// "no row found" — and in one case into an INSERT.
// ===========================================================================
describe("stripe/webhook — the lookups that decide whose money this is", () => {
  it("PINS TODAY'S BEHAVIOUR: the simple-rental lookup throws its read error away and then inserts", () => {
    // ON RECORD, and this is the one that costs money rather than accuracy.
    // `.single()` errors when it finds no row — and also when the read itself
    // fails — and the error is destructured away entirely (`const { data:
    // existingPayment } = ...`). A blip therefore looks identical to "this
    // session has no payments row", and the else-branch inserts a second
    // Completed row for the same session and hands it to the allocator.
    for (const fn of MODED_FORKS) {
      const s = src(fn);
      expect(
        s,
        `${fn}'s session lookup no longer uses the bare .single() form — check whether ` +
          `this is the fix and drop the .fails marker below.`,
      ).toContain('const { data: existingPayment } = await supabase');
      expect(s).toContain('.eq("stripe_checkout_session_id", session.id)');
      expect(s).toContain("No existing payment");
    }
  });

  it("shows the same fork doing the same lookup safely a few hundred lines earlier, so the unsafe form is not house style", () => {
    // The hold_as_credit branch reads the same column with `.maybeSingle()`,
    // which returns null for "no row" and reserves the error for a real failure.
    // Same file, same table, same column — so the fix below is a three-character
    // change plus an error check, not a redesign.
    const s = src("stripe-webhook-live");
    const creditBlock = s.slice(s.indexOf('hold_as_credit === "true"'), s.indexOf("SECURITY DEPOSIT HOLD"));
    expect(creditBlock).toContain('.eq("stripe_checkout_session_id", session.id)');
    expect(creditBlock).toContain(".maybeSingle()");
  });

  it.fails("no money-path lookup in a Stripe webhook discards its read error before inserting", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // Use `.maybeSingle()`, capture the error, and on a non-null error return
    // 500 so Stripe redelivers — never fall through to the insert. "I could not
    // read the row" and "there is no row" must not take the same branch when one
    // of them ends in an INSERT.
    for (const fn of MODED_FORKS) {
      const s = src(fn);
      const at = s.indexOf('const { data: existingPayment }');
      const decl = s.slice(at, at + 200);
      expect(
        /error:\s*\w*[Ee]rror/.test(decl),
        `${fn} still reads the existing payments row without capturing the error, so a ` +
          `transient read failure inserts a duplicate Completed row and allocates it.`,
      ).toBe(true);
    }
  });

  it("PINS TODAY'S BEHAVIOUR: payments.stripe_checkout_session_id carries no unique index, though its Square counterpart does", () => {
    // ON RECORD as the missing backstop. If the column were unique, the
    // duplicate insert above would be refused by the database instead of
    // allocated — which is precisely the protection the Square rail added for
    // the same failure mode.
    const migrations = join(REPO_ROOT, "supabase", "migrations");
    const squareIdx = readFileSync(join(migrations, "20260826120000_square_checkout_idempotency.sql"), "utf8");
    expect(squareIdx).toContain("CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_square_idempotency_key");

    const stripeIdx = readFileSync(join(migrations, "20260825200000_payments_recovery_index.sql"), "utf8");
    expect(
      /CREATE UNIQUE INDEX[\s\S]*stripe_checkout_session_id/.test(stripeIdx),
      "A unique index on stripe_checkout_session_id has appeared — the FIX. Delete this " +
        "pin and drop the .fails marker below.",
    ).toBe(false);
    // What does exist: two non-unique partial indexes, for the cron's scans.
    expect(stripeIdx).toContain("CREATE INDEX IF NOT EXISTS idx_payments_pending_stripe_recovery");
  });

  it.fails("payments.stripe_checkout_session_id is protected by a unique index, the way the Square key is", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // A partial unique index mirroring ux_payments_square_idempotency_key —
    // unique where the column is not null — so a second row for one Stripe
    // session is refused by the database rather than inserted and allocated. The
    // webhook's error handling should stop the duplicate; this is what catches
    // it when the webhook is wrong.
    const migrations = join(REPO_ROOT, "supabase", "migrations");
    const all = readFileSync(join(migrations, "20260825200000_payments_recovery_index.sql"), "utf8");
    expect(
      /CREATE UNIQUE INDEX[\s\S]*stripe_checkout_session_id/.test(all),
      "Nothing at the database level stops two payments rows sharing one Stripe checkout " +
        "session id.",
    ).toBe(true);
  });

  it("PINS TODAY'S BEHAVIOUR: the refund and cancel handlers resolve a row with .single() on a column that is not unique", () => {
    // ON RECORD. stripe_payment_intent_id is a plain text column and more than
    // one row can legitimately carry the same PaymentIntent — the deposit-hold
    // code says so explicitly and uses `.limit(1)` for exactly this reason. With
    // `.single()`, two matches is an error, the error is discarded, and the
    // handler logs "No payment found" and returns 200. A refund then goes
    // unrecorded while Stripe reports success.
    const s = src("stripe-webhook-live");
    for (const event of ["charge.refunded", "payment_intent.canceled"]) {
      const block = caseBlock(s, event);
      expect(block).toContain('.eq("stripe_payment_intent_id",');
      expect(
        block,
        `${event} no longer uses .single() on the PaymentIntent lookup — check whether ` +
          `this is the fix.`,
      ).toContain(".single()");
    }
    expect(caseBlock(s, "charge.refunded")).toContain("No payment found for payment_intent");
  });
});

// ===========================================================================
// L. TELLING THE CUSTOMER THEIR CARD WAS DECLINED.
// ===========================================================================
describe("stripe/webhook — a declined card", () => {
  it("PINS TODAY'S BEHAVIOUR: payment_intent.payment_failed rings the operator bell and tells the customer nothing", () => {
    // ON RECORD. The handler fetches the customer's name, email AND phone, logs
    // the email to the console, and then notifies only the operators. The
    // customer — whose card was declined and whose booking is now going nowhere
    // — is never contacted.
    const block = caseBlock(src("stripe-webhook-live"), "payment_intent.payment_failed");
    expect(block).toContain("customer:customers(name, email, phone)");
    expect(block).toContain("notifyOperatorsInApp");
    expect(
      block,
      "payment_intent.payment_failed now invokes notify-payment-failed — the FIX. Delete " +
        "this pin and drop the .fails marker below.",
    ).not.toContain("notify-payment-failed");
  });

  it("finds a deployed function built for exactly this and called by nothing in the repository", () => {
    // `notify-payment-failed` is 357 lines: a customer email with a Try Again
    // button, an operator email behind the operator-email preference, and an
    // in-app bell. It has no caller — not in supabase/functions, not in any app.
    //
    // NOTE, and a correction to this file's own brief: the contract helper
    // CANNOT parse this function. It knows three body-parsing shapes, all of
    // which name the variable `body` or destructure; this one writes
    // `const data: NotifyRequest = await req.json()`, so readEdgeFunction throws
    // rather than silently returning zero fields. The interface is therefore
    // read as text here — deliberately, rather than teaching the parser a fourth
    // shape from inside a test file.
    const s = src("notify-payment-failed");
    expect(s).toContain("const data: NotifyRequest = await req.json()");
    for (const field of ["customerName", "customerEmail", "bookingRef", "amount", "rentalId", "tenantId"]) {
      expect(s, `notify-payment-failed no longer declares ${field}.`).toContain(field);
    }
    // Nothing calls it. Asserted against every edge function's source, which is
    // where an invocation would have to be.
    const callers = ALL_WEBHOOKS.filter((fn) => src(fn).includes("notify-payment-failed"));
    expect(
      callers,
      `notify-payment-failed has acquired a caller (${callers.join(", ")}). If that is the ` +
        `payment_failed branch, this is the FIX — drop the .fails marker below.`,
    ).toEqual([]);
  });

  it.fails("payment_intent.payment_failed invokes notify-payment-failed with the fields it declares", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // The branch already reads the customer's name, email and phone and knows
    // the amount and the rental — which is most of NotifyRequest. Either wire it
    // up, or delete the function: a deployed, gateway-reachable no-op is the
    // worst of the three states, because it reads as covered.
    const block = caseBlock(src("stripe-webhook-live"), "payment_intent.payment_failed");
    expect(
      block.includes("notify-payment-failed"),
      "A customer whose card is declined is told nothing, by any channel, while a " +
        "purpose-built notifier sits deployed and unreferenced.",
    ).toBe(true);
  });
});

// ===========================================================================
// M. LAYER 3 — the arithmetic, by hand.
//
// Every number below was derived with a pencil from the formula transcribed out
// of the source above it, and the sum is written in the comment. None came from
// running the code.
// ===========================================================================
describe("stripe/webhook — the arithmetic (Layer 3)", () => {
  /**
   * charge.refunded, transcribed verbatim from stripe-webhook-live:
   *
   *     const refundAmount = charge.amount_refunded / 100;
   *     const isFullRefund = refundAmount >= payment.amount;
   *     ... update({ refund_amount: refundAmount,
   *                  status: isFullRefund ? "Refunded" : "Partial Refund" })
   *
   * Two properties matter and they pull in opposite directions: the write is a
   * SET of a cumulative field (good — replay-safe) and the comparison is against
   * the row's NOMINAL amount (bad — see the second case).
   */
  const refundWrite = (amountRefundedMinor: number, rowAmount: number) => {
    const refundAmount = amountRefundedMinor / 100;
    return { refundAmount, status: refundAmount >= rowAmount ? "Refunded" : "Partial Refund" };
  };

  it("converges on a replay, because Stripe's amount_refunded is cumulative and the handler SETS it", () => {
    // Two partial refunds of 25.00 on a 100.00 charge. Stripe reports the
    // RUNNING TOTAL on the charge, so the second event carries 5000 minor units,
    // not another 2500.
    //
    //   after refund 1:  amount_refunded = 2500  ->  2500 / 100 = 25.00
    //   after refund 2:  amount_refunded = 5000  ->  5000 / 100 = 50.00
    //
    // The handler writes refund_amount = that value, so:
    //   * a REPLAY of event 1 after event 2 writes 25.00 — WRONG, but it is a
    //     regression to an earlier truth, not a doubling;
    //   * a replay of event 2 writes 50.00 again — a no-op.
    // Had it been `refund_amount + 25.00` instead, the same two deliveries plus
    // one retry would have recorded 75.00 of refunds against 50.00 of money.
    expect(refundWrite(2500, 100).refundAmount).toBe(25.0); // 2500 / 100 = 25.00
    expect(refundWrite(5000, 100).refundAmount).toBe(50.0); // 5000 / 100 = 50.00
    // Idempotent on a repeat of the same event.
    expect(refundWrite(5000, 100).refundAmount).toBe(refundWrite(5000, 100).refundAmount);
    // And the source really does SET rather than increment.
    const block = caseBlock(src("stripe-webhook-live"), "charge.refunded");
    expect(block).toContain("charge.amount_refunded / 100");
    expect(block).toContain("refund_amount: refundAmount");
  });

  it("PINS TODAY'S BEHAVIOUR: measures full-vs-partial against the row's nominal amount, not against money captured", () => {
    // ON RECORD with the arithmetic that makes it wrong.
    //
    // payments.amount is what the rental was BILLED. What Stripe can refund is
    // what was CAPTURED, and the two differ whenever a pre-auth was captured
    // short — capture 80.00 of a 100.00 authorisation, a routine thing on a
    // deposit or an adjusted booking.
    //
    // Refund all 80.00 of it:
    //     amount_refunded = 8000  ->  8000 / 100 = 80.00
    //     80.00 >= 100.00 ?  NO
    //     ->  status = "Partial Refund"
    //
    // Every penny that was ever taken has gone back, and the row says the refund
    // was partial. Anything reading that status believes 20.00 is still held.
    expect(refundWrite(8000, 100).status).toBe("Partial Refund"); // 80.00 >= 100.00 is false
    // The exact-match case is right, which is why this hides.
    expect(refundWrite(10000, 100).status).toBe("Refunded"); // 100.00 >= 100.00 is true
    // And the operand is the row's nominal amount, straight from source.
    const block = caseBlock(src("stripe-webhook-live"), "charge.refunded");
    expect(block).toContain("refundAmount >= payment.amount");
    expect(
      block,
      "The threshold now reads something other than payment.amount — if it reads the " +
        "captured amount, that is the FIX. Delete this pin and drop the .fails marker.",
    ).toContain("select(\"id, rental_id, tenant_id, amount\")");
  });

  it.fails("measures the full-vs-partial refund threshold against money actually captured", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // Compare `charge.amount_refunded` against `charge.amount_captured` — both
    // are on the object the handler already has, so this needs no extra read.
    // A charge fully refunded is 'Refunded' whatever the payments row was billed.
    const block = caseBlock(src("stripe-webhook-live"), "charge.refunded");
    expect(
      /amount_captured/.test(block),
      "A fully refunded short capture is still filed as a Partial Refund, so the row " +
        "reads as if money is still held.",
    ).toBe(true);
  });

  it("abandons its deposit-hold sync well inside Stripe's acknowledgement budget", () => {
    // The arithmetic, by hand, from the capability manifest and the fork's own
    // constant:
    //
    //     Stripe's ack budget      30_000 ms   (capabilitiesFor("stripe"))
    //     HOLD_SYNC_TIMEOUT_MS     15_000 ms   (stripe-webhook-live)
    //     headroom          30_000 - 15_000 = 15_000 ms
    //
    // The headroom has to cover TLS, a Deno cold start and the response write.
    // If the sync call is still running when Stripe's budget lapses, Stripe
    // books the delivery as FAILED — and a run of those disables an endpoint
    // that carries every tenant's checkout events on that platform account.
    const budget = capabilitiesFor("stripe").webhookAckBudgetMs;
    expect(budget).toBe(30_000);
    const HOLD_SYNC_TIMEOUT_MS = 15_000; // read from stripe-webhook-live, asserted next
    expect(src("stripe-webhook-live")).toContain("const HOLD_SYNC_TIMEOUT_MS = 15_000");
    expect(budget - HOLD_SYNC_TIMEOUT_MS).toBe(15_000);
    expect(HOLD_SYNC_TIMEOUT_MS).toBeLessThan(budget);
  });

  it("PINS TODAY'S BEHAVIOUR: that budget is a hand-typed literal, where the Square rail derives its own from the manifest", () => {
    // ON RECORD — and one correction to how this was described to me. The Stripe
    // literal does NOT duplicate the manifest value: 15_000 is not 30_000. What
    // is duplicated is the JUDGEMENT — the comment beside it says "Stripe
    // abandons a delivery at ~30s", which is the manifest number written out in
    // prose, and the 15_000 is a headroom decision taken by hand and recorded
    // nowhere else.
    //
    // Square, for contrast, computes it:
    //     ACK_BUDGET_MS       = capabilitiesFor("square").webhookAckBudgetMs = 10_000
    //     PROCESSING_BUDGET   = max(2_000, 10_000 - 2_500) = 7_500
    // so raising Square's manifest value moves its timeout with it, and raising
    // Stripe's moves nothing.
    expect(src("stripe-webhook-live")).not.toContain('capabilitiesFor("stripe")');
    const square = src("square-webhook");
    expect(square).toContain('capabilitiesFor("square").webhookAckBudgetMs');
    expect(square).toContain("Math.max(2_000, ACK_BUDGET_MS - 2_500)");
    expect(capabilitiesFor("square").webhookAckBudgetMs).toBe(10_000);
    expect(Math.max(2_000, capabilitiesFor("square").webhookAckBudgetMs - 2_500)).toBe(7_500);
  });

  it.fails("derives the Stripe hold-sync budget from the capability manifest rather than typing it twice", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // `HOLD_SYNC_TIMEOUT_MS = Math.max(..., capabilitiesFor("stripe").webhookAckBudgetMs - headroom)`,
    // the shape square-webhook already uses. Then the manifest is the single
    // place the number lives, and the classifier and the three copies of it that
    // exist across the booking forks cannot drift apart from it independently.
    expect(
      /capabilitiesFor\(["']stripe["']\)/.test(src("stripe-webhook-live")),
      "stripe-webhook-live's ack budget is a hand-typed 15_000 with the manifest's 30s " +
        "restated in a comment beside it.",
    ).toBe(true);
  });
});
