import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * "Connect Stripe" offers the accounts that match the tenant's mode.
 *
 * Stripe decides which of your accounts its chooser will even list, and it
 * decides from the credentials that signed the link. A LIVE link greys out
 * every sandbox — "Test accounts cannot be connected to live accounts" — so a
 * tenant kept in test mode could never link its test account, however many
 * times its operator pressed the button.
 *
 * WHY THIS IS NOT FOR EVERYONE, which is the part worth protecting:
 *
 * A real operator is in test mode on their FIRST DAY. Following the mode for
 * them would offer a sandbox at the exact moment they are trying to get paid,
 * and it would look like it worked — stripe-oauth-callback files a test
 * connection under own_stripe_test_* and changes no routing at all. They would
 * walk away believing they were set up, with every booking still settling
 * nowhere near their account. So the allow-list is the feature, not a detail of
 * it, and widening it is a decision rather than a tidy-up.
 */

const ROOT = resolve(__dirname, '../../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const panel = read('apps/portal/src/app/(dashboard)/integrations/_panels/stripe-connect.tsx');
const code = strip(panel);
const callback = strip(read('supabase/functions/stripe-oauth-callback/index.ts'));

describe('the handshake follows the tenant, for the allow-listed tenants only', () => {
  it('names the tenants in one place, keyed on slug', () => {
    expect(code).toMatch(/const STRIPE_CONNECT_FOLLOWS_MODE: readonly string\[\] = \["northwind"\]/);
    // V2_PLAN §2 — a tenant id here would be unreadable and would rot.
    expect(code).not.toMatch(/STRIPE_CONNECT_FOLLOWS_MODE[\s\S]{0,160}[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('uses test ONLY when allow-listed AND the tenant trades in test', () => {
    expect(code).toMatch(
      /STRIPE_CONNECT_FOLLOWS_MODE\.includes\(tenant\.slug\) && view\.mode === "test" \? "test" : "live"/,
    );
  });

  it('passes that mode to the handshake rather than a hardcoded one', () => {
    const own = code.slice(code.indexOf('"stripe-oauth-start"'), code.indexOf('"stripe-oauth-start"') + 260);
    expect(own).toMatch(/mode: connectMode/);
    expect(own).not.toMatch(/mode: "live"/);
  });

  it('still falls back to live for every other tenant', () => {
    // The ternary's else branch is the guarantee: no allow-list entry, no test
    // link, whatever mode the tenant happens to be in.
    expect(code).toMatch(/\? "test" : "live"/);
  });
});

describe('what a test connection does on the backend', () => {
  it('is filed separately and changes no routing', () => {
    // This is why offering it to the wrong tenant would be quietly harmful:
    // nothing about where money goes changes, so it looks like success.
    expect(callback).toMatch(/own_stripe_test_account_id: connectedAccountId/);
    const testBranch = callback.slice(callback.indexOf('own_stripe_test_account_id'));
    expect(testBranch).not.toMatch(/stripe_mode: 'live'/);
    expect(testBranch).not.toMatch(/payment_model: 'own'/);
  });
});

describe('the first-run demo is gone', () => {
  it('leaves nothing of itself behind', () => {
    for (const ghost of ['useDemoRow', 'demoStore', 'demoRow', 'DemoStage', 'STRIPE_FIRST_RUN_DEMO_SLUGS']) {
      expect(code).not.toContain(ghost);
    }
  });

  it('no longer fakes a connection instead of making one', () => {
    // It opened Stripe's sign-up page and reported success 2.6s later, so
    // northwind's Connect button never reached the handshake above at all.
    expect(code).not.toMatch(/dashboard\.stripe\.com\/register/);
    expect(code).not.toMatch(/setTimeout[\s\S]{0,120}2600/);
  });

  it('draws the chip and the panel from the real row', () => {
    expect(code).toMatch(/const \{ data, isLoading, isError \} = useStripeConnect\(tenant\)/);
    expect(code).toMatch(/const \{ data, isLoading, isError, error, refetch \} = useStripeConnect\(tenant\)/);
  });
});
