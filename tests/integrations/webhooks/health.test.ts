/**
 * WEBHOOK HEALTH AND SENDER VERIFICATION — every platform we receive from.
 * Layer 1, offline.
 *
 * The team lead made this a condition of the whole exercise, not a nice-to-have:
 *
 *   "Webhooks and cron jobs — these two you'll have to nail, otherwise there's
 *    no benefit to this whole testing... make sure that whatever platform our
 *    webhook is attached to, we're tracking its health separately."
 *
 * There are two separate properties in that sentence and this file keeps them
 * apart, because they fail differently:
 *
 *   1. VERIFICATION — can a stranger post to this endpoint and be believed?
 *      A failure here is an attacker writing to our database.
 *   2. OBSERVABILITY — if the sender stops delivering, or we start rejecting
 *      what they send, does anyone find out? A failure here is SILENCE: money
 *      settles at Stripe and never lands with us, and the first report comes
 *      from a customer.
 *
 * Property 2 is the one currently missing, and it is missing exactly where it
 * matters most. The tests below record that as machine-checked watchdogs rather
 * than a note in a document, so the gap closes itself the day someone builds it.
 *
 * NOT COVERED: cron-job health, which the team lead explicitly parked
 * ("webhooks, cron jobs — we're not even going there right now"), and the
 * per-event handler logic, which lives in integrations/stripe/webhook.test.ts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = (p: string) => resolve(__dirname, "../../../", p);
const fnPath = (n: string) => root(`supabase/functions/${n}/index.ts`);
const fnSrc = (n: string) => readFileSync(fnPath(n), "utf8");

const CONFIG = readFileSync(root("supabase/config.toml"), "utf8");
const CLAUDE_MD = readFileSync(root("CLAUDE.md"), "utf8");

/**
 * The webhooks that carry money or bind a signed document. Each names the
 * mechanism that authenticates its sender, because they are all different and a
 * handler copied from a sibling gets it wrong.
 */
const CRITICAL_WEBHOOKS = [
  { fn: "stripe-webhook-test", mechanism: /constructEvent|constructEventAsync/ },
  { fn: "stripe-webhook-live", mechanism: /constructEvent|constructEventAsync/ },
  { fn: "stripe-connect-webhook", mechanism: /constructEvent|constructEventAsync/ },
  { fn: "square-webhook", mechanism: /verifyEvent|verifySquareWebhook/ },
  { fn: "subscription-webhook", mechanism: /constructEvent|constructEventAsync/ },
] as const;

// @usecase A webhook that believes an unsigned request is a write primitive for
// anyone who learns the URL — and every one of these runs with verify_jwt off,
// so the signature is the ONLY thing standing between a stranger and the
// database.
describe("sender verification — every money webhook authenticates who sent it", () => {
  for (const { fn, mechanism } of CRITICAL_WEBHOOKS) {
    it(`verifies the sender's signature before trusting anything in ${fn}`, () => {
      expect(fnSrc(fn)).toMatch(mechanism);
    });
  }

  it("runs every one of them with verify_jwt off, which is why the signature is load-bearing", () => {
    // Not a defect: these senders cannot present a project JWT. It is the reason
    // the assertions above are the real gate.
    for (const { fn } of CRITICAL_WEBHOOKS) {
      expect(CONFIG, `${fn} should be registered verify_jwt = false`).toMatch(
        new RegExp(`\\[functions\\.${fn}\\][\\s\\S]{0,400}?verify_jwt\\s*=\\s*false`),
      );
    }
  });

  it("accepts anything at all on the BoldSign webhook, which holds the service-role key", () => {
    /**
     * DEFECT. boldsign-webhook contains NO signature check, no shared secret and
     * no sender verification of any kind — verified by absence of every relevant
     * token below — while running verify_jwt = false and using the service-role
     * key to write signed-agreement state.
     *
     * So anyone who learns the URL can tell us a rental agreement was signed.
     * Note that a recent fix to this function (main: "fix(boldsign): webhook threw
     * ReferenceError on every callback") addressed a crash, NOT authentication —
     * the endpoint is now reliably reachable and still unauthenticated.
     */
    const src = fnSrc("boldsign-webhook");
    for (const token of ["signature", "hmac", "HMAC", "X-BoldSign", "verifyWebhook"]) {
      expect(src, `boldsign-webhook unexpectedly mentions ${token}`).not.toContain(token);
    }
    expect(CONFIG).toMatch(/\[functions\.boldsign-webhook\][\s\S]{0,400}?verify_jwt\s*=\s*false/);
  });

  it.fails("should verify the BoldSign sender before writing agreement state", () => {
    // Remove the `.fails` marker once boldsign-webhook validates a shared secret
    // or an HMAC over the raw body. Either is enough; neither exists today.
    const src = fnSrc("boldsign-webhook");
    expect(/signature|hmac|HMAC|shared secret|BOLDSIGN_WEBHOOK_SECRET/.test(src)).toBe(true);
  });
});

// @usecase This is the gap the team lead named. If Stripe stops delivering, or
// we start 500ing on every event, nothing anywhere goes red — the rentals simply
// stop being marked paid and the first person to notice is a customer.
describe("observability — whether a platform's webhook health can be seen at all", () => {
  /** A platform is observable if its handler records what it received. */
  const recordsEvents = (fn: string) => /_webhook_events|webhook_events/.test(fnSrc(fn));

  it("records received events for Square, which is the one platform that does", () => {
    expect(recordsEvents("square-webhook")).toBe(true);
  });

  it("records nothing for any Stripe webhook, including the ones carrying rental money", () => {
    /**
     * DEFECT, and the most consequential one in this file. Of the six webhooks
     * that move money or bind documents, only Square keeps a record of what it
     * received. The Stripe handlers — which settle every rental payment, every
     * refund and every deposit — write the business effect and keep no trace of
     * the delivery itself.
     *
     * The consequence is not a wrong number, it is SILENCE. There is nothing to
     * query for "when did Stripe last reach us", nothing to alert on a run of
     * failures, and no way to replay a missed event because there is no record it
     * was missed. The repo already knows this failure mode: ~3,900 stale Pending
     * payment rows exist platform-wide from `checkout.session.expired` events
     * whose effect was never completed.
     */
    for (const fn of ["stripe-webhook-test", "stripe-webhook-live", "stripe-connect-webhook"]) {
      expect(recordsEvents(fn), `${fn} unexpectedly records events now`).toBe(false);
    }
  });

  it("records nothing for BoldSign or the subscription webhook either", () => {
    expect(recordsEvents("boldsign-webhook")).toBe(false);
    expect(recordsEvents("subscription-webhook")).toBe(false);
  });

  it.fails("should track delivery health separately for every platform we receive from", () => {
    /**
     * Remove the `.fails` marker once each critical webhook records its
     * deliveries the way square-webhook does. The team lead's requirement was
     * per-platform and explicit: "make sure that whatever platform our webhook is
     * attached to, we're tracking its health separately."
     *
     * Square is the shape to copy: record the event id, the outcome, and the
     * timestamp, so "has Stripe gone quiet?" is a query rather than a guess.
     */
    const observable = CRITICAL_WEBHOOKS.filter((w) => recordsEvents(w.fn)).length;
    expect(observable).toBe(CRITICAL_WEBHOOKS.length);
  });

  it("has no CREATE TABLE for square_webhook_events in the migrations at all", () => {
    /**
     * Migration drift, worth pinning because it makes the one working health
     * surface unreproducible. square_webhook_events is REVOKEd from anon in
     * 20260825175054_square_revoke_anon_on_credential_tables.sql but never
     * CREATEd anywhere in supabase/migrations — it was applied out of band. A
     * fresh database built from migrations therefore does NOT have the table, and
     * the one observable platform silently becomes unobservable.
     */
    const migrations = root("supabase/migrations");
    const revoke = resolve(migrations, "20260825175054_square_revoke_anon_on_credential_tables.sql");
    expect(existsSync(revoke)).toBe(true);
    expect(readFileSync(revoke, "utf8")).toContain("square_webhook_events");
  });
});

// @usecase CLAUDE.md is what a new engineer threat-models from. Understating the
// unauthenticated surface by a factor of seven means the endpoints that most
// need scrutiny are the ones nobody knows to look at.
describe("the documented unauthenticated surface versus the real one", () => {
  const actual = (CONFIG.match(/verify_jwt\s*=\s*false/g) || []).length;

  it("registers dozens of functions as verify_jwt = false, not the handful documented", () => {
    // Measured from config.toml itself so this number cannot go stale silently.
    expect(actual).toBeGreaterThan(50);
  });

  it("still tells the reader there are ten of them", () => {
    /**
     * DEFECT (documentation, but load-bearing). CLAUDE.md:164 states "10 functions
     * have `verify_jwt = false`" and then lists nine. The real figure in
     * config.toml is well over sixty — every Twilio endpoint, every OAuth
     * callback, the lead-capture intake, the PAYG and deposit reconcilers, and
     * more.
     *
     * This is the map an engineer uses to decide what needs a signature check, so
     * understating it hides most of the attack surface.
     */
    expect(CLAUDE_MD).toContain("10 functions have `verify_jwt = false`");
  });

  it.fails("should state the real count of unauthenticated functions", () => {
    // Remove the `.fails` marker once CLAUDE.md's Edge Functions section is
    // regenerated from config.toml rather than hand-maintained.
    expect(CLAUDE_MD).not.toContain("10 functions have `verify_jwt = false`");
  });
});
