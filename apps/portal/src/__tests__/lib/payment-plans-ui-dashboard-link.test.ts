/**
 * The Stripe dashboard link for a plan attempt — the rules TRAX support
 * already applies (supabase/functions/trax-support/support/payment-routing.ts):
 * a verified per-payment URL only on the tenant's OWN (Standard) account; a
 * plain-English route for Express; never a guessed URL; never a platform
 * `/connect/accounts/…` page (see __tests__/hooks/use-trax-support.test.tsx).
 */
import { describe, expect, it } from 'vitest';
import { LINK_TEXT, dashboardLinkFor, isSafeDashboardHref, type AttemptReference, type DashboardAccounts } from '@/lib/payment-plans-ui/dashboard-link';

const accounts: DashboardAccounts = { ownLive: 'acct_OwnLive1234', ownTest: 'acct_OwnTest5678', managed: 'acct_Managed9999', sharedTest: 'acct_SharedTest0000' };
const stripe = (over: Partial<AttemptReference>): AttemptReference => ({
  provider: 'stripe',
  providerAccount: 'acct_OwnLive1234',
  providerMode: 'live',
  providerRef: 'pi_3Abc',
  ...over,
});

describe('dashboardLinkFor', () => {
  it('links a live payment on the tenant\'s own Standard account to that exact payment', () => {
    const r = dashboardLinkFor(stripe({}), accounts);
    expect(r).toMatchObject({ kind: 'link', reference: 'pi_3Abc', href: 'https://dashboard.stripe.com/payments/pi_3Abc' });
    expect(r.kind === 'link' && r.note).toContain('1234');
  });

  it('links a test payment on the own test account under /test/', () => {
    const r = dashboardLinkFor(stripe({ providerAccount: 'acct_OwnTest5678', providerMode: 'test' }), accounts);
    expect(r).toMatchObject({ kind: 'link', href: 'https://dashboard.stripe.com/test/payments/pi_3Abc' });
  });

  it('gives an Express (Drive247-managed) payment its reference and a route, never a URL', () => {
    const r = dashboardLinkFor(stripe({ providerAccount: 'acct_Managed9999' }), accounts);
    expect(r).toEqual({ kind: 'route', reference: 'pi_3Abc', text: LINK_TEXT.express });
  });

  it('never guesses: an account that is not the tenant\'s, an unrecorded mode, the shared test account', () => {
    expect(dashboardLinkFor(stripe({ providerAccount: 'acct_Stranger' }), accounts).kind).toBe('route');
    expect(dashboardLinkFor(stripe({ providerAccount: null }), accounts).kind).toBe('route');
    expect(dashboardLinkFor(stripe({ providerMode: null }), accounts)).toMatchObject({ kind: 'route', text: LINK_TEXT.modeUnknown });
    expect(dashboardLinkFor(stripe({ providerAccount: 'acct_SharedTest0000', providerMode: 'test' }), accounts)).toMatchObject({
      kind: 'route',
      text: LINK_TEXT.sharedTest,
    });
    // A live attempt claiming the TEST own account is not proof of anything.
    expect(dashboardLinkFor(stripe({ providerAccount: 'acct_OwnTest5678', providerMode: 'live' }), accounts).kind).toBe('route');
    // No accounts known at all.
    expect(dashboardLinkFor(stripe({}), null).kind).toBe('route');
  });

  it('a Checkout Session with no PaymentIntent has nothing to open', () => {
    expect(dashboardLinkFor(stripe({ providerRef: 'cs_live_abc123' }), accounts)).toEqual({
      kind: 'none',
      reference: 'cs_live_abc123',
      text: LINK_TEXT.sessionOnly,
    });
  });

  it('manual, simulated and Square payments never get a Stripe URL', () => {
    expect(dashboardLinkFor({ provider: 'manual', providerAccount: null, providerMode: null, providerRef: null }, accounts).kind).toBe('none');
    expect(dashboardLinkFor({ provider: 'simulated', providerAccount: 'acct_sim', providerMode: 'test', providerRef: 'sim_pi_1' }, accounts)).toMatchObject({
      kind: 'none',
      reference: 'sim_pi_1',
    });
    expect(dashboardLinkFor({ provider: 'square', providerAccount: null, providerMode: 'live', providerRef: 'sq_123' }, accounts)).toMatchObject({
      kind: 'route',
      reference: 'sq_123',
    });
  });

  it('never emits anything but a dashboard payment page — no connect/accounts URL for any input', () => {
    const refs = ['pi_1', 'cs_live_1', 'acct_1', 'ch_1', null];
    const accts = ['acct_OwnLive1234', 'acct_OwnTest5678', 'acct_Managed9999', 'acct_SharedTest0000', 'nonsense', null];
    const modes = ['live', 'test', null] as const;
    for (const providerRef of refs)
      for (const providerAccount of accts)
        for (const providerMode of modes) {
          const r = dashboardLinkFor({ provider: 'stripe', providerRef, providerAccount, providerMode }, accounts);
          if (r.kind === 'link') {
            expect(isSafeDashboardHref(r.href)).toBe(true);
            expect(r.href).not.toContain('/connect/');
          }
        }
  });

  it('the href guard refuses every other shape', () => {
    expect(isSafeDashboardHref('https://dashboard.stripe.com/payments/pi_Ok1')).toBe(true);
    expect(isSafeDashboardHref('https://dashboard.stripe.com/connect/accounts/acct_1/payments/pi_Ok1')).toBe(false);
    expect(isSafeDashboardHref('https://evil.invalid/payments/pi_Ok1')).toBe(false);
    expect(isSafeDashboardHref('https://checkout.stripe.com/c/pay/cs_live_1')).toBe(false);
    expect(isSafeDashboardHref('https://dashboard.stripe.com/payments/ch_1')).toBe(false);
  });
});
