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
import { recordWebhookDelivery } from "@fn/_shared/webhook-health.ts";

const root = (p: string) => resolve(__dirname, "../../../", p);
const fnPath = (n: string) => root(`supabase/functions/${n}/index.ts`);
const fnSrc = (n: string) => readFileSync(fnPath(n), "utf8");

const CONFIG = readFileSync(root("supabase/config.toml"), "utf8");
const CLAUDE_MD = readFileSync(root("CLAUDE.md"), "utf8");
const HEALTH_HELPER = readFileSync(root("supabase/functions/_shared/webhook-health.ts"), "utf8");
const MIGRATION_PATH = "supabase/migrations/PENDING_20260912_webhook_delivery_health.sql.txt";
const MIGRATION = readFileSync(root(MIGRATION_PATH), "utf8");
const ROLLBACK = readFileSync(
  root("supabase/migrations/PENDING_20260912_webhook_delivery_health.rollback.sql.txt"),
  "utf8",
);

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

// @usecase This is the gap the team lead named, and it is now closed. If a
// platform stops delivering, or we start rejecting it, webhook_deliveries is
// what makes that visible — these tests keep the recorder wired in.
describe("observability — every platform records its deliveries", () => {
  /** A handler is observable if it records deliveries through the shared recorder. */
  const recordsHealth = (fn: string) => /recordWebhookDelivery\(/.test(fnSrc(fn));

  for (const { fn } of CRITICAL_WEBHOOKS) {
    it(`records delivery health for ${fn}`, () => {
      expect(recordsHealth(fn)).toBe(true);
    });
  }

  it("records delivery health for the BoldSign webhook too, which verifies nothing", () => {
    // The endpoint with no sender verification is the one whose delivery RATE is
    // most worth watching, because unparseable bodies from scanners are expected
    // traffic and a change in that rate is the only signal available.
    expect(recordsHealth("boldsign-webhook")).toBe(true);
  });

  it("records an outcome on every terminal path, not only the happy one", () => {
    /**
     * A recorder wired only to the success path is worse than none: it would show
     * a healthy last_seen_at while every delivery was being rejected. Each handler
     * records at its rejection paths, its success path and its catch.
     */
    for (const fn of ["stripe-webhook-test", "stripe-webhook-live", "stripe-connect-webhook", "boldsign-webhook"]) {
      const calls = (fnSrc(fn).match(/recordWebhookDelivery\(/g) || []).length;
      expect(calls, `${fn} should record on rejection, success and failure`).toBeGreaterThanOrEqual(4);
    }
    expect((fnSrc("subscription-webhook").match(/recordWebhookDelivery\(/g) || []).length)
      .toBeGreaterThanOrEqual(3);
  });

  it("builds its own client in the catch, where the handler's is out of scope", () => {
    /**
     * A real trap, and the reason this is asserted rather than assumed: in the
     * Stripe handlers `supabase` is declared with const INSIDE the try block, so
     * it is NOT visible from the sibling catch. A recorder that referenced it
     * there would throw a ReferenceError inside the error path — turning a
     * handled failure into an unhandled one.
     */
    for (const fn of ["stripe-webhook-test", "stripe-webhook-live", "stripe-connect-webhook"]) {
      const src = fnSrc(fn);
      const catchAt = src.lastIndexOf("catch (error)");
      expect(src.slice(catchAt), `${fn} catch must build its own client`).toContain("healthClient");
    }
  });

  it("keeps Square's own event table, because that is its only replay defence", () => {
    /**
     * square_webhook_events must NOT be replaced by the health table. Its
     * event_id PRIMARY KEY, inserted before any mutation, is the only thing
     * stopping a Square redelivery from being processed twice — Square's
     * signature carries no timestamp, so unlike Stripe's 300s tolerance there is
     * no replay window doing that work for free.
     */
    expect(fnSrc("square-webhook")).toContain("square_webhook_events");
  });
});

// @usecase Observability must never cost a payment. If the recorder can throw,
// a full table or an unmigrated database turns a monitoring gap into an outage,
// because a 500 makes the processor retry.
describe("the health recorder is fail-open by construction", () => {
  it("returns void rather than a success flag, so no caller can branch on it", () => {
    /**
     * Deliberate: a caller able to see that logging failed would eventually be
     * tempted to fail the webhook with it, which is the exact inversion this
     * module exists to prevent.
     */
    expect(HEALTH_HELPER).toMatch(/Promise<void>/);
  });

  it("swallows a rejected insert instead of propagating it", () => {
    expect(HEALTH_HELPER).toMatch(/console\.warn/);
    expect(HEALTH_HELPER).toMatch(/catch \(err\)/);
  });

  it("bounds the insert with a short deadline so it cannot eat a handler budget", () => {
    // Square's handler runs to a 7.5s budget; a hung insert must not consume it.
    expect(HEALTH_HELPER).toMatch(/WEBHOOK_HEALTH_TIMEOUT_MS\s*=\s*1_?500/);
    expect(HEALTH_HELPER).toContain("AbortController");
  });

  it("never echoes a raw provider error, which can carry request fields", () => {
    expect(HEALTH_HELPER).toMatch(/function describe\(/);
    expect(HEALTH_HELPER).toMatch(/slice\(0, 200\)/);
  });

  it("truncates over-long ids rather than letting the insert fail", () => {
    expect(HEALTH_HELPER).toMatch(/function trim\(/);
  });
});

// @usecase The table is the thing an alert queries. If anon could read it, the
// public booking bundle's key would expose which processors we use and how often
// they fail; if it were unique on event_id, a genuine redelivery would be lost.
describe("the health table migration", () => {
  it("is drafted as PENDING and not applied, so nothing reaches production unreviewed", () => {
    expect(MIGRATION).toContain("PENDING — NOT APPLIED");
    // The .txt suffix is what keeps `supabase db push` from picking it up.
    expect(MIGRATION_PATH.endsWith(".sql.txt")).toBe(true);
  });

  it("is additive — one new table and one new view, altering nothing that exists", () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.webhook_deliveries/);
    expect(MIGRATION).not.toMatch(/ALTER TABLE public\.(payments|rentals|tenants)/);
    expect(MIGRATION).not.toMatch(/DROP TABLE/);
  });

  it("revokes the public and signed-in roles, because this is platform-ops data", () => {
    // The anon key ships in the booking bundle, so a grant here would be public.
    expect(MIGRATION).toMatch(/REVOKE ALL ON public\.webhook_deliveries FROM anon, authenticated/);
    expect(MIGRATION).toMatch(/ENABLE ROW LEVEL SECURITY/);
  });

  it("creates no permissive policy, so a restored grant still reads nothing", () => {
    expect(MIGRATION).not.toMatch(/CREATE POLICY/);
  });

  it("does not make event_id unique, because a redelivery is a fact worth recording", () => {
    expect(MIGRATION).not.toMatch(/UNIQUE\s*\(\s*event_id/);
    expect(MIGRATION).toContain("NOT a replay guard");
  });

  it("allows a null event_id, because a rejected delivery is the most worth recording", () => {
    // We will not have parsed an id out of a body we refused.
    expect(MIGRATION).toMatch(/event_id\s+text CHECK \(event_id IS NULL/);
  });

  it("answers 'when did this platform last reach us' as one query", () => {
    expect(MIGRATION).toMatch(/CREATE OR REPLACE VIEW public\.v_webhook_health/);
    expect(MIGRATION).toMatch(/max\(received_at\)\s+AS last_seen_at/);
    expect(MIGRATION).toMatch(/failures_24h/);
  });

  it("ships a rollback that leaves the webhooks working, only unobservable", () => {
    expect(ROLLBACK).toMatch(/DROP TABLE IF EXISTS public\.webhook_deliveries/);
    expect(ROLLBACK).toMatch(/DROP VIEW\s+IF EXISTS public\.v_webhook_health/);
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

// @usecase The fail-open guarantee is the whole safety argument for adding a
// database write to six money handlers. Asserting it from source text only
// proves the words are there; these EXECUTE the recorder against clients that
// misbehave in each of the ways a real one can.
describe("the health recorder, executed against clients that misbehave", () => {
  it("resolves without throwing when the insert returns an error", async () => {
    // The realistic case on a database where the migration has not been applied:
    // PostgREST answers 42P01 undefined_table.
    const client = {
      from: () => ({
        insert: () => Promise.resolve({ error: { message: 'relation "webhook_deliveries" does not exist' } }),
      }),
    };
    await expect(
      recordWebhookDelivery(client, { platform: "stripe", outcome: "handled" }),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing when the insert REJECTS rather than returning an error", async () => {
    // supabase-js normally resolves with {error}, but a transport failure can
    // reject. Both must be survivable.
    const client = { from: () => ({ insert: () => Promise.reject(new Error("socket hang up")) }) };
    await expect(
      recordWebhookDelivery(client, { platform: "square", outcome: "failed" }),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing when the client itself is missing or malformed", async () => {
    for (const bad of [null, undefined, {}, 42, "client"]) {
      await expect(
        recordWebhookDelivery(bad, { platform: "boldsign", outcome: "handled" }),
      ).resolves.toBeUndefined();
    }
  });

  it("resolves without throwing when .from() throws synchronously", async () => {
    const client = { from: () => { throw new Error("client torn down"); } };
    await expect(
      recordWebhookDelivery(client, { platform: "stripe", outcome: "handled" }),
    ).resolves.toBeUndefined();
  });

  it("writes the delivery as one row with the fields an alert needs", async () => {
    let captured: Record<string, unknown> | null = null;
    const client = {
      from: (t: string) => {
        expect(t).toBe("webhook_deliveries");
        return { insert: (row: Record<string, unknown>) => { captured = row; return Promise.resolve({ error: null }); } };
      },
    };
    await recordWebhookDelivery(client, {
      platform: "stripe", mode: "live", outcome: "handled",
      eventId: "evt_123", eventType: "checkout.session.completed",
      httpStatus: 200, tenantId: "t-1", durationMs: 42.7,
    });
    expect(captured).toMatchObject({
      platform: "stripe", mode: "live", outcome: "handled",
      event_id: "evt_123", event_type: "checkout.session.completed",
      http_status: 200, tenant_id: "t-1",
    });
    // Rounded, because the column is an integer and a float would be rejected.
    expect((captured as Record<string, unknown>).duration_ms).toBe(43);
  });

  it("truncates an over-long event id instead of letting the insert fail", async () => {
    let captured: Record<string, unknown> | null = null;
    const client = {
      from: () => ({ insert: (row: Record<string, unknown>) => { captured = row; return Promise.resolve({ error: null }); } }),
    };
    await recordWebhookDelivery(client, {
      platform: "square", outcome: "handled", eventId: "e".repeat(400),
    });
    // The column's CHECK caps event_id at 255; truncating keeps the row.
    expect(String((captured as Record<string, unknown>).event_id)).toHaveLength(255);
  });

  it("normalises absent optional fields to null rather than undefined", async () => {
    // undefined would be dropped from the JSON body, leaving the column at its
    // default instead of an explicit null — a silent difference when querying.
    let captured: Record<string, unknown> | null = null;
    const client = {
      from: () => ({ insert: (row: Record<string, unknown>) => { captured = row; return Promise.resolve({ error: null }); } }),
    };
    await recordWebhookDelivery(client, { platform: "boldsign", outcome: "ignored" });
    const row = captured as Record<string, unknown>;
    for (const k of ["mode", "event_id", "event_type", "http_status", "failure_code", "tenant_id", "duration_ms"]) {
      expect(row[k], `${k} should be null, not undefined`).toBeNull();
    }
  });

  it("refuses a non-finite duration rather than sending NaN to an integer column", async () => {
    let captured: Record<string, unknown> | null = null;
    const client = {
      from: () => ({ insert: (row: Record<string, unknown>) => { captured = row; return Promise.resolve({ error: null }); } }),
    };
    await recordWebhookDelivery(client, {
      platform: "stripe", outcome: "handled", durationMs: Number.NaN,
    });
    expect((captured as Record<string, unknown>).duration_ms).toBeNull();
  });
});
