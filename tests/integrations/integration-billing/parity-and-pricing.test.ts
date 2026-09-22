/**
 * Integration billing — the copies that must never drift, and the super
 * admin's price parser (docs/integration-billing/build-spec.md, D1, D4, D12).
 *
 *  - WHO: the northwind-only list exists three times (portal, booking, edge
 *    function) because each runs in a different runtime. Widening one and not
 *    the others would put northwind's booking-site sends back on credits, or
 *    let the portal offer a Subscribe the function then refuses.
 *  - WHAT: the integration keys exist three times (portal board, edge function,
 *    admin page). A key missing from one is a card the admin cannot price, or a
 *    price the function cannot name on the bill.
 *  - HOW MUCH: dollars typed by a super admin become cents with no floating
 *    point anywhere — "20.20" must be 2020, never 2019.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTEGRATIONS as EDGE_INTEGRATIONS, PREVIEW_ONLY_KEYS as EDGE_PREVIEW } from '@fn/integration-billing/catalog.ts';
import { INTEGRATION_BILLING_TENANTS as EDGE_TENANTS } from '@fn/integration-billing/gate.ts';
import {
  DEFAULT_PREMIUM_KEYS as PORTAL_DEFAULT_PREMIUM,
  INTEGRATION_KEYS as PORTAL_KEYS,
  PREVIEW_ONLY_KEYS as PORTAL_PREVIEW,
} from '../../../apps/portal/src/lib/integration-billing/catalog';
import {
  INTEGRATION_BILLING_TENANTS as BOOKING_TENANTS,
  creditsRetiredForSend as bookingCreditsRetired,
} from '../../../apps/booking/src/lib/integration-billing-gate';
import {
  ADMIN_INTEGRATIONS,
  DEFAULT_PREMIUM_KEYS as ADMIN_DEFAULT_PREMIUM,
  PREVIEW_ONLY_KEYS as ADMIN_PREVIEW,
  centsToDollarsInput,
  parseDollarsToCents,
  premiumPriceProblem,
} from '../../../apps/admin/lib/integration-pricing';

const root = path.resolve(__dirname, '../../..');

describe('the northwind-only list', () => {
  it('is the same in the portal, the booking app and the edge function', () => {
    // The portal copy imports NORTHWIND from lib/v2 (path aliases do not resolve
    // here), so it is read as source and must name exactly that constant.
    const portal = readFileSync(path.join(root, 'apps/portal/src/lib/integration-billing/gate.ts'), 'utf8');
    expect(portal).toMatch(/INTEGRATION_BILLING_TENANTS: readonly string\[\] = \[NORTHWIND\];/);
    const v2 = readFileSync(path.join(root, 'apps/portal/src/lib/v2.ts'), 'utf8');
    expect(v2).toMatch(/export const NORTHWIND = 'northwind';/);

    expect([...EDGE_TENANTS]).toEqual(['northwind']);
    expect([...BOOKING_TENANTS]).toEqual(['northwind']);
  });

  it('agreements-v2 asks the edge copy, not a list of its own', () => {
    const core = readFileSync(path.join(root, 'supabase/functions/agreements-v2/core.ts'), 'utf8');
    expect(core).toContain("import { isIntegrationBillingTenant } from '../integration-billing/gate.ts';");
    expect(core).toContain('if (!isIntegrationBillingTenant(tenant.slug)) {');
  });
});

describe('who skips credits on a send', () => {
  it('only the tenant that OWNS the rental, and only when it is northwind', () => {
    const nw = 'nw-id';
    expect(bookingCreditsRetired({ requestTenantId: nw, rentalTenantId: nw, tenantSlug: 'northwind' })).toBe(true);
    // Naming northwind's id for someone else's rental: credits as usual.
    expect(bookingCreditsRetired({ requestTenantId: nw, rentalTenantId: 'other', tenantSlug: 'northwind' })).toBe(false);
    // No rental found: credits as usual.
    expect(bookingCreditsRetired({ requestTenantId: nw, rentalTenantId: null, tenantSlug: 'northwind' })).toBe(false);
    // Every other tenant: credits as usual.
    expect(bookingCreditsRetired({ requestTenantId: 'g', rentalTenantId: 'g', tenantSlug: 'goniko' })).toBe(false);
  });
});

describe('the integration keys', () => {
  it('are the same on the board, in the edge function and on the admin page', () => {
    const edge = EDGE_INTEGRATIONS.map((i) => [i.key, i.name]);
    expect(PORTAL_KEYS.map((i) => [i.key, i.name])).toEqual(edge);
    expect(ADMIN_INTEGRATIONS.map((i) => [i.key, i.name])).toEqual(edge);
  });

  it('mark the same "coming soon" previews as not for sale everywhere', () => {
    expect([...PORTAL_PREVIEW]).toEqual([...EDGE_PREVIEW]);
    expect([...ADMIN_PREVIEW]).toEqual([...EDGE_PREVIEW]);
    // Each is a board card whose panel really is a preview that connects nothing.
    for (const key of EDGE_PREVIEW) {
      const file = { turo_sync: 'turo-sync', inshur: 'inshur', checkmydriver: 'checkmydriver' }[key as 'inshur'];
      const panel = readFileSync(path.join(root, `apps/portal/src/app/(dashboard)/integrations/_panels/${file}.tsx`), 'utf8');
      expect(panel).toMatch(/preview only/i);
    }
  });

  it('start the same three as premium on the board and on the admin page', () => {
    expect([...PORTAL_DEFAULT_PREMIUM]).toEqual(['turo_sync', 'inshur', 'checkmydriver']);
    expect([...ADMIN_DEFAULT_PREMIUM]).toEqual([...PORTAL_DEFAULT_PREMIUM]);
  });

  it('match the board’s own card names', () => {
    const board = readFileSync(path.join(root, 'apps/portal/src/app/(dashboard)/integrations/integrations-board.tsx'), 'utf8');
    const names = [...board.matchAll(/\{ name: "([^"]+)", category:/g)].map((m) => m[1]);
    expect(names).toEqual(PORTAL_KEYS.map((i) => i.name));
  });
});

describe('the admin price parser', () => {
  it('turns dollars into cents without floating point', () => {
    expect(parseDollarsToCents('20')).toBe(2000);
    expect(parseDollarsToCents('20.2')).toBe(2020);
    expect(parseDollarsToCents('20.20')).toBe(2020);
    expect(parseDollarsToCents('0.29')).toBe(29);
    expect(parseDollarsToCents('$1,250.00')).toBe(125000);
    expect(parseDollarsToCents(' 200 ')).toBe(20000);
  });

  it('refuses what it cannot read exactly', () => {
    expect(parseDollarsToCents('20.205')).toBeNull();
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(parseDollarsToCents('-5')).toBeNull();
    expect(parseDollarsToCents('1e3')).toBeNull();
  });

  it('holds the Stripe floor and a sane ceiling', () => {
    expect(premiumPriceProblem('0.49')).toMatch(/at least \$0\.50/);
    expect(premiumPriceProblem('0.50')).toBeNull();
    expect(premiumPriceProblem('10000')).toBeNull();
    expect(premiumPriceProblem('10000.01')).toMatch(/\$10,000 or less/);
    expect(premiumPriceProblem('twenty')).toMatch(/in dollars/);
    // Blank is allowed: "Price to be announced", not on sale.
    expect(premiumPriceProblem('')).toBeNull();
    expect(premiumPriceProblem('   ')).toBeNull();
  });

  it('shows stored cents back the way they are typed', () => {
    expect(centsToDollarsInput(2020)).toBe('20.20');
    expect(centsToDollarsInput(2000)).toBe('20.00');
    expect(centsToDollarsInput(5)).toBe('0.05');
    expect(centsToDollarsInput(null)).toBe('');
  });
});
