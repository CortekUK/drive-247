import { describe, expect, it } from 'vitest';
import { ownPortalName, portalAppName, portalAppShortName, pwaIconPath, pwaIconVersion } from '@/lib/pwa-manifest';

describe('the installed portal app is named after the portal name (QA B2.11)', () => {
  it('uses the portal name when the tenant set one, with the Ops suffix', () => {
    expect(portalAppName('Northwind QA', 'Northwind Rentals')).toBe('Northwind QA Ops');
    expect(portalAppShortName('Northwind QA', 'Northwind Rentals')).toBe('Northwind QA');
  });

  it('falls back to the company name when there is no portal name, exactly as before', () => {
    expect(portalAppName(null, 'Northwind Rentals')).toBe('Northwind Rentals Ops');
    expect(portalAppName('   ', 'Northwind Rentals')).toBe('Northwind Rentals Ops');
    expect(portalAppShortName(null, 'Northwind Rentals')).toBe('Northwind Re');
  });

  it("ignores the platform's old default app name", () => {
    expect(ownPortalName('Drive 917')).toBeNull();
    expect(portalAppName('Drive 917', 'Northwind Rentals')).toBe('Northwind Rentals Ops');
  });

  it('does not double the suffix for a portal already called something Ops', () => {
    expect(portalAppName('Northwind Ops', 'Northwind Rentals')).toBe('Northwind Ops');
    expect(portalAppName('Northwind ops', 'Northwind Rentals')).toBe('Northwind ops');
  });

  it('has nothing to say for a tenant with no names at all', () => {
    expect(portalAppName(null, null)).toBeNull();
    expect(portalAppShortName(null, '')).toBeNull();
  });
});

describe('a changed icon is a new URL, an unchanged one keeps its cached copy', () => {
  const inputs = ['https://x/storage/company-logos/t/favicon-1.png', '#442DD7', 'Northwind'];

  it('is stable for the same inputs and short enough for a URL', () => {
    const v = pwaIconVersion(inputs);
    expect(v).toMatch(/^[0-9a-f]{8}$/);
    expect(pwaIconVersion([...inputs])).toBe(v);
    expect(pwaIconPath('192.png', v)).toBe(`/pwa-icon/192.png?v=${v}`);
  });

  it('changes when the icon file, the colour or the initial changes', () => {
    const v = pwaIconVersion(inputs);
    expect(pwaIconVersion(['https://x/storage/company-logos/t/favicon-2.png', '#442DD7', 'Northwind'])).not.toBe(v);
    expect(pwaIconVersion([inputs[0], '#0F766E', 'Northwind'])).not.toBe(v);
    expect(pwaIconVersion([inputs[0], '#442DD7', 'Northwind QA'])).not.toBe(v);
  });

  it('treats a missing value and an empty one alike, so a null column never flips the URL', () => {
    expect(pwaIconVersion([null, '#442DD7', 'Northwind'])).toBe(pwaIconVersion(['', '#442DD7', 'Northwind']));
  });
});
