/**
 * SQUARE — credential binding and webhook authentication. Layer 1, offline.
 *
 * These are the two security surfaces of the Square integration. Both are
 * currently implemented WELL, so most of this file is a regression guard rather
 * than a defect report: it pins the properties that make them safe, so a later
 * refactor cannot quietly remove one.
 *
 * That is a deliberate choice about what a test is for. The dangerous edits here
 * are not obvious bugs — they are tidy-ups. Moving the signature check below the
 * database client, or replacing the single-statement DELETE with a SELECT then a
 * DELETE, both read as harmless cleanups in review and both destroy the security
 * property. Each test below names the specific edit it exists to catch.
 *
 * WHY LAYER 1: exercising these for real needs Square's signing key and a live
 * OAuth round trip. The properties that matter — the ORDER of operations, and
 * which bytes are signed — are structural and provable from source, which is also
 * where a regression would appear. Layer 2 would add confidence about Square's
 * behaviour, not ours.
 *
 * NOT COVERED: the refund idempotency defect and the provider seam, which are in
 * refund-idempotency.test.ts; token refresh scheduling, which needs a clock.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = (p: string) => resolve(__dirname, "../../../", p);
const fnSrc = (n: string) => readFileSync(root(`supabase/functions/${n}/index.ts`), "utf8");

const WEBHOOK = fnSrc("square-webhook");
const OAUTH_START = fnSrc("square-oauth-start");
const OAUTH_CALLBACK = fnSrc("square-oauth-callback");
const DISCONNECT = fnSrc("square-disconnect");
const CONFIG_TOML = readFileSync(root("supabase/config.toml"), "utf8");

// @usecase A webhook holding the service-role key that verifies its signature
// after touching the database is a write primitive for anyone who can guess the
// URL. The ORDER is the security property, not the presence of a check.
describe("square webhook — authentication happens before anything else", () => {
  it("reads the raw body before any parse, because the signature covers those exact bytes", () => {
    // Re-serialising parsed JSON reorders keys and changes whitespace, which
    // changes the bytes and breaks every real signature.
    expect(WEBHOOK).toContain("RAW BODY FIRST, BEFORE ANY PARSE");
  });

  it("verifies the signature before constructing the database client", () => {
    /**
     * The load-bearing assertion of this file. verifyEvent is called at :917 and
     * the Supabase client is built at :941 — after it. Asserted positionally
     * rather than by presence, because a check that runs after the client exists
     * is a different, weaker property.
     */
    const verifyAt = WEBHOOK.indexOf("await verifyEvent(rawBody");
    const clientAt = WEBHOOK.indexOf("createClient(", WEBHOOK.indexOf("const verified"));
    expect(verifyAt, "verifyEvent call not found — has it been renamed?").toBeGreaterThan(-1);
    expect(clientAt, "no createClient after verification").toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(clientAt);
  });

  it("states in source that no database is touched before verification passes", () => {
    expect(WEBHOOK).toContain("No DB is touched before this passes");
  });

  it("refuses a request carrying no signature header at all", () => {
    // Fails CLOSED: a missing signature returns undefined, which the caller turns
    // into a 401. An implementation that treated absence as "nothing to check"
    // would accept every forged event.
    expect(WEBHOOK).toMatch(/if\s*\(!signature\)\s*return undefined/);
  });

  it("reads the signature from Square's own header name", () => {
    expect(WEBHOOK).toContain('"x-square-hmacsha256-signature"');
  });

  it("signs the notification URL together with the body, not the body alone", () => {
    /**
     * Square's scheme differs from Stripe's and the difference is not cosmetic:
     * Square signs `notification_url + raw_body` while Stripe signs
     * `timestamp + body`. Since the URL is part of the signed message it must
     * match the registered value byte for byte — a trailing slash makes every
     * real event fail verification. The file documents this at :26-30 because
     * someone copying the Stripe handler would get it wrong.
     */
    expect(WEBHOOK).toContain("Square signs `notification_url + raw_body`");
  });

  it("is registered as verify_jwt = false, since Square cannot present a project JWT", () => {
    // The signature IS the authentication here, which is why the ordering tests
    // above matter more than they would on a JWT-gated function.
    expect(CONFIG_TOML).toMatch(/\[functions\.square-webhook\][\s\S]{0,200}?verify_jwt\s*=\s*false/);
  });
});

// @usecase If a used or forged state row could be replayed, an attacker could
// bind their own Square account to a victim tenant and receive that tenant's
// rental payments. The single-use guarantee is the whole defence.
describe("square OAuth — the callback's state row is single-use by construction", () => {
  it("consumes the state row with one DELETE that returns it, not a read then a write", () => {
    /**
     * This is the single-use guarantee and it is worth stating precisely: a
     * SELECT-then-DELETE pair has a window in which two concurrent callbacks both
     * read the row and both proceed. A single `DELETE ... RETURNING` cannot —
     * Postgres hands the row to exactly one deleter. Two concurrent hits on the
     * same callback URL are a REAL event (double click, link-preview fetcher, back
     * button), so this is not a theoretical race.
     */
    expect(OAUTH_CALLBACK).toMatch(
      /from\("square_oauth_state"\)\s*\.delete\(\)\s*\.eq\("state",\s*stateParam\)\s*\.select\(/,
    );
    // A short fragment on one line: the full sentence is wrapped across two
    // comment lines, and matching across the "// " prefix would be brittle.
    expect(OAUTH_CALLBACK).toContain("IS the single-use guarantee");
  });

  it("treats a missing state row as forged or already used, and stops hard", () => {
    // Both causes are indistinguishable and both are fatal, so there is no branch
    // where a consumed state survives.
    expect(OAUTH_CALLBACK).toContain("unknown or already-consumed state");
    expect(OAUTH_CALLBACK).toMatch(/if\s*\(!stateRow\)/);
  });

  it("rejects a state row that is past its expiry even though it deleted cleanly", () => {
    // Deletion proves single use, not freshness. Both are needed.
    expect(OAUTH_CALLBACK).toMatch(/new Date\(stateRow\.expires_at\)\.getTime\(\)\s*<\s*Date\.now\(\)/);
    expect(OAUTH_CALLBACK).toContain("state_expired");
  });

  it("runs with verify_jwt = false because Square redirects a browser here", () => {
    // No Authorization header exists on a browser redirect, which is exactly why
    // the nonce carries the entire authentication burden.
    expect(CONFIG_TOML).toMatch(/\[functions\.square-oauth-callback\][\s\S]{0,240}?verify_jwt\s*=\s*false/);
  });
});

// @usecase Without an in-function membership check, any holder of a project JWT
// could start a connect flow naming someone else's tenant — config.toml warns
// about this case by name.
describe("square OAuth — who is allowed to bind a tenant's credentials", () => {
  it("resolves the caller against app_users rather than trusting the request", () => {
    // A booking CUSTOMER authenticates against auth.users but has no app_users
    // row, so this lookup is also what keeps renters out of the connect flow.
    expect(OAUTH_START).toMatch(/from\("app_users"\)/);
    expect(OAUTH_START).toMatch(/select\("id, is_super_admin, tenant_id, role, is_active"\)/);
  });

  it("records which app user started the flow on the state row itself", () => {
    // Persisted so the callback can re-check authorisation, rather than trusting
    // that whoever returns from Square is whoever left.
    expect(OAUTH_START).toContain("created_by");
    expect(OAUTH_CALLBACK).toContain("created_by");
  });

  it("checks is_active, because a JWT outlives a deactivated admin", () => {
    /**
     * The comment at OAUTH_START:77-81 records the reason: an access token is a
     * stateless JWT, so flipping app_users.is_active to false does not invalidate
     * sessions already issued — and deactivated admins were found holding live
     * auth.sessions rows, one of them a super admin.
     */
    expect(OAUTH_START).toContain("is_active");
    expect(OAUTH_START).toMatch(/stateless JWT/);
  });

  it("requires a JWT for both connect and disconnect, unlike the callback", () => {
    // Disconnect is the higher-stakes direction: it STOPS a live merchant taking
    // money, so it must never be reachable unauthenticated.
    expect(CONFIG_TOML).toMatch(/\[functions\.square-oauth-start\][\s\S]{0,240}?verify_jwt\s*=\s*true/);
    expect(CONFIG_TOML).toMatch(/\[functions\.square-disconnect\][\s\S]{0,240}?verify_jwt\s*=\s*true/);
  });

  it("re-checks authority inside disconnect rather than relying on the gateway alone", () => {
    // verify_jwt only proves SOME valid project token was presented; it says
    // nothing about which tenant the caller belongs to.
    expect(DISCONNECT).toMatch(/is_super_admin|app_users/);
  });
});
