/**
 * The plate/VIN suppression chokepoint.
 *
 * Douglas Barboza (DB Car Rentals) asked for plate numbers to be kept off his
 * public site. The audit that followed found the plate in ~77 places in this app
 * alone, and something worse underneath: the public vehicle queries were
 * `select('*')` against a table with RLS disabled and a table-level SELECT grant
 * to `anon`. RLS filters rows, never columns — so every column reached the
 * browser, including `lockbox_code` and `lockbox_instructions`, the key-safe
 * code and where the safe is hidden. Verified live: 42 vehicles across 5 tenants.
 *
 * These tests therefore guard two different promises:
 *
 *   1. We do not SERVE what a customer must not have (the allowlist).
 *   2. We do not SHOW the plate for a tenant who hides it — including via the
 *      fallbacks and the search box, which are how a "hidden" field leaks.
 */

import { describe, it, expect } from 'vitest';
import {
  isRegistrationHidden,
  vehiclePublicColumns,
  vehiclePublicColumnsNested,
  displayRegistration,
  vehicleDisplayName,
  vehicleDisplayLabel,
  canSearchByRegistration,
} from '@/lib/vehicle-identity';

const showing = { hide_vehicle_registration: false };
const hiding = { hide_vehicle_registration: true };
const car = { make: 'BMW', model: 'X5', reg: 'AB12 XYZ' };

describe('isRegistrationHidden — hiding must be opt-in', () => {
  it('defaults to showing when the tenant has never set it', () => {
    expect(isRegistrationHidden({})).toBe(false);
    expect(isRegistrationHidden(null)).toBe(false);
    expect(isRegistrationHidden(undefined)).toBe(false);
  });

  it('treats null as not-hidden — a backfilled NULL is not a request for privacy', () => {
    expect(isRegistrationHidden({ hide_vehicle_registration: null })).toBe(false);
  });

  it('requires literal true, so a stringy value from PostgREST cannot flip it', () => {
    for (const v of ['true', 'false', 1, 0, {}] as unknown[]) {
      expect(isRegistrationHidden({ hide_vehicle_registration: v as never })).toBe(false);
    }
    expect(isRegistrationHidden(hiding)).toBe(true);
  });
});

describe('vehiclePublicColumns — an allowlist, because RLS cannot hide a column', () => {
  const secrets = [
    'lockbox_code',
    'lockbox_instructions',
    'purchase_price',
    'monthly_payment',
    'balloon',
    'initial_payment',
    'security_notes',
    'spare_key_holder',
    'spare_key_notes',
    'owner_id',
    'vin',
    'disposal_notes',
    'sale_proceeds',
  ];

  it('never serves the lockbox code or any other operator secret', () => {
    for (const tenant of [showing, hiding]) {
      const cols = vehiclePublicColumns(tenant).split(',').map(c => c.trim());
      for (const secret of secrets) {
        expect(cols).not.toContain(secret);
      }
    }
  });

  it('never serves the VIN, even to a tenant who shows plates', () => {
    // VIN is not displayed on any customer surface, and it is the identity key
    // INSHUR binds cover against. There is no reason to publish it.
    expect(vehiclePublicColumns(showing).split(',').map(c => c.trim())).not.toContain('vin');
  });

  it('serves the plate only when the tenant permits it', () => {
    expect(vehiclePublicColumns(showing).split(',').map(c => c.trim())).toContain('reg');
    expect(vehiclePublicColumns(hiding).split(',').map(c => c.trim())).not.toContain('reg');
  });

  it('still serves what the booking flow genuinely needs', () => {
    const cols = vehiclePublicColumns(hiding).split(',').map(c => c.trim());
    for (const needed of [
      'id', 'tenant_id', 'make', 'model', 'year', 'status', 'photo_url',
      'daily_rent', 'weekly_rent', 'monthly_rent',
      'available_daily', 'available_weekly', 'available_monthly',
    ]) {
      expect(cols).toContain(needed);
    }
  });

  it('appends related-table selections without disturbing the allowlist', () => {
    const sel = vehiclePublicColumns(hiding, 'vehicle_photos ( photo_url, display_order )');
    expect(sel).toContain('vehicle_photos ( photo_url, display_order )');
    expect(sel.split(',').map(c => c.trim())).not.toContain('reg');
  });

  it('ignores empty extras rather than emitting a trailing comma', () => {
    // A stray comma makes PostgREST reject the whole query, which would take
    // the public fleet page down rather than fail quietly.
    const sel = vehiclePublicColumns(showing, '');
    expect(sel).not.toMatch(/,\s*$/);
    expect(sel).not.toMatch(/,\s*,/);
  });

  it('nests under an alias for joined selects', () => {
    const nested = vehiclePublicColumnsNested(hiding, 'vehicles:vehicle_id');
    expect(nested.startsWith('vehicles:vehicle_id (')).toBe(true);
    expect(nested.endsWith(')')).toBe(true);
    expect(nested).not.toMatch(/\breg\b/);
  });
});

describe('displayRegistration', () => {
  it('returns the plate when allowed, null when hidden', () => {
    expect(displayRegistration(car, showing)).toBe('AB12 XYZ');
    expect(displayRegistration(car, hiding)).toBeNull();
  });

  it('returns null rather than empty string when there is no plate', () => {
    // Callers use this to decide whether to render the element at all; an empty
    // string would leave a dangling "Reg:" label with nothing after it.
    expect(displayRegistration({ make: 'BMW' }, showing)).toBeNull();
    expect(displayRegistration(null, showing)).toBeNull();
  });
});

describe('vehicleDisplayName — the fallback trap', () => {
  it('prefers make and model', () => {
    expect(vehicleDisplayName(car, showing)).toBe('BMW X5');
    expect(vehicleDisplayName(car, hiding)).toBe('BMW X5');
  });

  it('falls back to the plate only when the tenant shows plates', () => {
    const nameless = { reg: 'AB12 XYZ' };
    expect(vehicleDisplayName(nameless, showing)).toBe('AB12 XYZ');
    expect(vehicleDisplayName(nameless, hiding)).toBe('Vehicle');
  });

  it('never returns an empty label', () => {
    // ~10 screens used the plate as the fallback name. Suppressing the plate
    // without this would have left customers looking at a blank heading for the
    // car they are booking.
    expect(vehicleDisplayName({ reg: 'AB12 XYZ' }, hiding)).not.toBe('');
    expect(vehicleDisplayName({}, hiding)).toBe('Vehicle');
    expect(vehicleDisplayName(null, hiding)).toBe('Vehicle');
    expect(vehicleDisplayName(undefined, hiding)).toBe('Vehicle');
  });

  it('copes with partial and whitespace-only names', () => {
    expect(vehicleDisplayName({ make: 'BMW' }, hiding)).toBe('BMW');
    expect(vehicleDisplayName({ model: 'X5' }, hiding)).toBe('X5');
    expect(vehicleDisplayName({ make: '  ', model: '  ', reg: 'AB12 XYZ' }, hiding)).toBe('Vehicle');
  });

  it('honours a caller-supplied fallback', () => {
    expect(vehicleDisplayName({}, hiding, 'Your car')).toBe('Your car');
  });
});

describe('vehicleDisplayLabel', () => {
  it('adds the plate in brackets only when permitted', () => {
    expect(vehicleDisplayLabel(car, showing)).toBe('BMW X5 (AB12 XYZ)');
    expect(vehicleDisplayLabel(car, hiding)).toBe('BMW X5');
  });

  it('never leaves empty brackets behind', () => {
    expect(vehicleDisplayLabel({ make: 'BMW', model: 'X5' }, showing)).toBe('BMW X5');
    expect(vehicleDisplayLabel({}, hiding)).toBe('Vehicle');
  });

  it('does not print the plate twice when it IS the name', () => {
    expect(vehicleDisplayLabel({ reg: 'AB12 XYZ' }, showing)).toBe('AB12 XYZ');
  });
});

describe('canSearchByRegistration — a searchable hidden field is not hidden', () => {
  it('disables plate search exactly when plates are hidden', () => {
    expect(canSearchByRegistration(showing)).toBe(true);
    expect(canSearchByRegistration(hiding)).toBe(false);
  });

  it('matches isRegistrationHidden so the two can never drift apart', () => {
    for (const t of [showing, hiding, {}, null, undefined]) {
      expect(canSearchByRegistration(t)).toBe(!isRegistrationHidden(t));
    }
  });
});
