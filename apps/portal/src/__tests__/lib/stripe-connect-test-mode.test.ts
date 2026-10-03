import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * The Stripe panel tells the truth now, and can link a sandbox.
 *
 * TWO THINGS LANDED TOGETHER, AND BOTH NEED HOLDING DOWN.
 *
 * 1. THE DEMO IS GONE. northwind's panel used to be a sales prop: a stand-in
 *    row with the account columns emptied, and a Connect button that opened
 *    Stripe's public sign-up page, waited 2.6 seconds and then PRETENDED the
 *    account was linked. Nothing was written and nothing was connected, which
 *    made the one screen you would want to trust while testing payments the
 *    least trustworthy in the portal.
 *
 * 2. A REAL TEST CONNECT EXISTS. Stripe refuses a sandbox through a live
 *    Connect handshake — "Test accounts cannot be connected to live accounts"
 *    — so linking one needs the platform's TEST credentials, which is what
 *    `mode: 'test'` selects.
 *
 * The danger worth a test rather than a comment: a LIVE connect writes
 * `stripe_mode: 'live'` and `payment_model: 'own'`, so it is the go-live moment
 * for real customer money. If the test link ever regressed to `mode: 'live'`,
 * pressing "Connect a test account" would take a tenant live — a rehearsal
 * button with the consequences of the real one, and nothing on screen to say so.
 */

const ROOT = resolve(__dirname, '../../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const panel = read('apps/portal/src/app/(dashboard)/integrations/_panels/stripe-connect.tsx');
const code = strip(panel);
const callback = strip(read('supabase/functions/stripe-oauth-callback/index.ts'));

describe('the first-run demo is gone', () => {
  it('leaves no demo machinery behind in the panel', () => {
    for (const ghost of ['useDemoRow', 'demoStore', 'demoRow', 'DemoStage', 'STRIPE_FIRST_RUN_DEMO_SLUGS']) {
      expect(code).not.toContain(ghost);
    }
  });

  it('no longer fakes a connection with a timer', () => {
    // The tell was `setTimeout(… 2600)` after opening Stripe's register page.
    expect(code).not.toMatch(/dashboard\.stripe\.com\/register/);
    expect(code).not.toMatch(/setTimeout[\s\S]{0,120}2600/);
  });

  it('draws the chip and the panel from the real row', () => {
    // Both call sites took the stand-in row; they take the query's data now.
    expect(code).toMatch(/const \{ data, isLoading, isError \} = useStripeConnect\(tenant\)/);
    expect(code).toMatch(/const \{ data, isLoading, isError, error, refetch \} = useStripeConnect\(tenant\)/);
  });
});

describe('connecting a test account', () => {
  it('is offered to the allow-listed slugs only', () => {
    expect(code).toMatch(/const STRIPE_TEST_CONNECT_SLUGS: readonly string\[\] = \["northwind"\]/);
    expect(code).toMatch(/STRIPE_TEST_CONNECT_SLUGS\.includes\(tenant\.slug\)/);
  });

  it('is keyed on the slug, never on a tenant id', () => {
    // V2_PLAN §2, and the same rule the removed demo followed.
    expect(code).not.toMatch(/STRIPE_TEST_CONNECT_SLUGS[\s\S]{0,200}[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('needs the manage permission and the own model', () => {
    expect(code).toMatch(/canManage && view\.model === "own" && STRIPE_TEST_CONNECT_SLUGS/);
  });

  it("signs the handshake with the platform's TEST credentials", () => {
    const fn = code.slice(code.indexOf('const connectTest'), code.indexOf('const connectTest') + 700);
    expect(fn).toMatch(/"stripe-oauth-start"/);
    expect(fn).toMatch(/mode: "test"/);
    // The whole point. 'live' here would take the tenant live from a button
    // labelled as a rehearsal.
    expect(fn).not.toMatch(/mode: "live"/);
  });

  it('leaves the real Connect button on live, where it belongs', () => {
    const fn = code.slice(code.indexOf('const connect ='), code.indexOf('const connectTest'));
    expect(fn).toMatch(/mode: "live"/);
  });
});

describe('what the backend does with a test connection', () => {
  it('stores it in the test columns and changes no routing', () => {
    // This is what makes the button safe to offer at all.
    expect(callback).toMatch(/own_stripe_test_account_id: connectedAccountId/);
    const testBranch = callback.slice(callback.indexOf('own_stripe_test_account_id'));
    expect(testBranch).not.toMatch(/stripe_mode: 'live'/);
    expect(testBranch).not.toMatch(/payment_model: 'own'/);
  });

  it('still flips a LIVE connection to live, which is why the two are separate', () => {
    expect(callback).toMatch(/stripe_mode: 'live'/);
    expect(callback).toMatch(/payment_model: 'own'/);
  });
});
