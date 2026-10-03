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

describe('the two connect buttons', () => {
  const block = code.slice(code.indexOf('const action = showConnectChoice'), code.indexOf('const links = ['));

  it('names the rehearsal tenants in one place, keyed on slug', () => {
    expect(code).toContain('const STRIPE_CONNECT_CHOICE_SLUGS: readonly string[] = ["northwind"];');
    // V2_PLAN §2 — a tenant id here would be unreadable and would rot.
    const decl = code.slice(code.indexOf('STRIPE_CONNECT_CHOICE_SLUGS'), code.indexOf('STRIPE_CONNECT_CHOICE_SLUGS') + 160);
    expect(decl).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('offers both doors, named', () => {
    expect(block).toContain('Connect live account');
    expect(block).toContain('Connect test account');
  });

  it('wires each button to its own mode, not to the other', () => {
    const live = block.indexOf('Connect live account');
    const test = block.indexOf('Connect test account');
    // Swapped, both would still open a Stripe chooser and both would look
    // like they worked — and the cost is a tenant going live from a button
    // marked "test".
    expect(block.lastIndexOf('connectWith("live")', live)).toBeGreaterThan(-1);
    expect(block.lastIndexOf('connectWith("test")', test)).toBeGreaterThan(
      block.lastIndexOf('connectWith("live")', live),
    );
  });

  it('warns that the live one goes live', () => {
    expect(block).toMatch(/switches this tenant to live/);
    expect(block).toMatch(/real customer money/);
  });

  it('does NOT gate on view.model, which a disconnect flips', () => {
    // The first version gated on `view.model === "own"`. stripe-disconnect-v2
    // reverts payment_model to 'managed', so disconnecting removed the very
    // buttons needed to connect again — and the ordinary button that replaced
    // them created a new Drive247 Express account instead.
    expect(code).toContain(
      'const showConnectChoice = canManage && STRIPE_CONNECT_CHOICE_SLUGS.includes(tenant.slug);',
    );
    const gate = code.slice(code.indexOf('const showConnectChoice'), code.indexOf('const showConnectChoice') + 140);
    expect(gate).not.toContain('view.model');
  });

  it('always takes the OAuth hand-off, never the Express path', () => {
    // connectWith does not branch on view.model at all, so a managed tenant
    // on the allow-list still connects rather than having an account minted.
    const fn = code.slice(code.indexOf('const connectWith'), code.indexOf('const connect ='));
    expect(fn).toMatch(/"stripe-oauth-start"/);
    expect(fn).toMatch(/mode,/);
    expect(fn).not.toMatch(/create-connected-account/);
    expect(fn).not.toMatch(/view.model/);
  });

  it('leaves every other tenant the single live button', () => {
    const fn = code.slice(code.indexOf('const connect ='), code.indexOf('const connect =') + 900);
    expect(fn).toMatch(/mode: "live"/);
    expect(code).toContain(') : primaryLabel ? (');
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
