/**
 * Stored sidebar arrangements across the Finances merge (design §1).
 *
 * An operator who arranged their sidebar before the merge has `/payments`,
 * `/invoices` and `/fines` in their saved order and maybe in `hidden`. On the
 * canary those rows no longer exist, so:
 *   - no ghost rows (the overlay only ever matches rows that exist);
 *   - a hidden OLD row never hides Finances;
 *   - Finances takes the place the user gave the first of the old rows.
 * For every other tenant the three rows still exist and nothing changes.
 */
import { describe, expect, it } from 'vitest';
import { applyNavPreferences, EMPTY_NAV_PREFERENCES, type OverlayNavItem } from '@/lib/nav-preferences';
import { repointLegacyFinanceOrder } from '@/lib/finances-nav';

const row = (name: string, href: string): OverlayNavItem => ({ name, href, icon: null });

const OLD_MORE = [
  row('Agreements', '/agreements'),
  row('Availability', '/blocked-dates'),
  row('Payments', '/payments'),
  row('Invoices', '/invoices'),
  row('Fines', '/fines'),
  row('Support', '/support'),
];
const CANARY_MORE = [
  row('Agreements', '/agreements'),
  row('Availability', '/blocked-dates'),
  row('Finances', '/finances'),
  row('Support', '/support'),
];

const more = (items: OverlayNavItem[], prefs: Partial<typeof EMPTY_NAV_PREFERENCES>) =>
  applyNavPreferences({ topLevel: [], groups: [], more: items, preferences: { ...EMPTY_NAV_PREFERENCES, ...prefs } }).more.map(
    (i) => i.href,
  );

describe('everyone but the canary: exactly as before', () => {
  it('keeps a stored order that names the three rows', () => {
    expect(more(OLD_MORE, { moreOrder: ['/support', '/fines', '/payments'] })).toEqual([
      '/support',
      '/fines',
      '/payments',
      '/agreements',
      '/blocked-dates',
      '/invoices',
    ]);
  });

  it('still hides a row the user hid', () => {
    expect(more(OLD_MORE, { hidden: ['/invoices'] })).not.toContain('/invoices');
  });

  it('repointing is a no-op while no Finances row is on screen', () => {
    const order = ['/support', '/payments', '/fines'];
    expect(repointLegacyFinanceOrder(order, new Set(OLD_MORE.map((r) => r.href)))).toEqual(order);
  });
});

describe('the canary', () => {
  it('grows no ghost rows from a stored order', () => {
    expect(more(CANARY_MORE, { moreOrder: ['/payments', '/invoices', '/fines'] })).toEqual([
      '/finances',
      '/agreements',
      '/blocked-dates',
      '/support',
    ]);
  });

  it('cannot have Finances hidden by an old row being hidden', () => {
    expect(more(CANARY_MORE, { hidden: ['/payments', '/invoices', '/fines'] })).toContain('/finances');
  });

  it('gives Finances the place of the first old row in the order', () => {
    expect(more(CANARY_MORE, { moreOrder: ['/support', '/invoices', '/agreements', '/payments'] })).toEqual([
      '/support',
      '/finances',
      '/agreements',
      '/blocked-dates',
    ]);
  });

  it('leaves an order that already places Finances alone', () => {
    expect(repointLegacyFinanceOrder(['/finances', '/payments'], new Set(['/finances']))).toEqual(['/finances', '/payments']);
  });

  it('still lets the user hide Finances itself', () => {
    expect(more(CANARY_MORE, { hidden: ['/finances'] })).not.toContain('/finances');
  });
});
