/**
 * use-dynamic-theme on the v2 theme.
 *
 * The bug: the hook wrote the brand tokens (--primary and friends) inline on
 * <html>, but the v2 theme is a class on <body> whose stylesheet redeclares
 * every one of those tokens, so a saved colour (and the Appearance try-on
 * preview) never reached a single v2 element.
 *
 * The v2 path now writes only the brand parameters, on <body>, and nothing
 * else; the v1 path is unchanged. Expected values are the hand-worked ones
 * from __tests__/lib/v2-brand-vars.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockBranding = vi.fn();

vi.mock('@/hooks/use-tenant-branding', () => ({
  useTenantBranding: () => mockBranding(),
}));
vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

import { useDynamicTheme } from '@/hooks/use-dynamic-theme';

const TEAL = '#0F766E'; // 175 77% 26%, near-black text on the dark-mode primary
const PALE = '#FDE68A'; // 48 97% 77%, link lightness 28%

function branding(over: Record<string, string | null> = {}) {
  return {
    app_name: 'Northwind',
    primary_color: null,
    light_primary_color: null,
    dark_primary_color: null,
    secondary_color: null,
    accent_color: null,
    light_secondary_color: null,
    light_accent_color: null,
    light_background_color: null,
    dark_secondary_color: null,
    dark_accent_color: null,
    dark_background_color: null,
    meta_title: null,
    meta_description: null,
    favicon_url: null,
    og_image_url: null,
    ...over,
  };
}

const bodyVar = (name: string) => document.body.style.getPropertyValue(name);
const htmlVar = (name: string) => document.documentElement.style.getPropertyValue(name);

function resetInlineStyles() {
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');
}

beforeEach(resetInlineStyles);
afterEach(() => {
  resetInlineStyles();
  vi.clearAllMocks();
});

describe('useDynamicTheme — v2 theme', () => {
  it('writes the brand parameters to <body> and nothing to <html>', async () => {
    mockBranding.mockReturnValue({ branding: branding({ light_primary_color: TEAL }), hasBrandingData: true });
    renderHook(() => useDynamicTheme({ v2Theme: true }));

    await waitFor(() => expect(bodyVar('--brand-h')).toBe('175'));
    expect(bodyVar('--brand-s')).toBe('77%');
    expect(bodyVar('--brand-l')).toBe('26%');
    expect(bodyVar('--brand-fg-dark')).toBe('0 0% 3.9%');
    expect(bodyVar('--brand-fg')).toBe('');
    expect(bodyVar('--brand-link-l')).toBe('');

    // Never the tokens themselves: the stylesheet derives those, and the
    // neutral grounds are not the brand's to change.
    for (const token of ['--primary', '--background', '--card', '--muted', '--sidebar-background', '--accent']) {
      expect(bodyVar(token), token).toBe('');
    }
    expect(document.documentElement.getAttribute('style')).toBeNull();
  });

  it('prefers light_primary_color over primary_color, as v1 does in light mode', async () => {
    mockBranding.mockReturnValue({
      branding: branding({ primary_color: '#442DD7', light_primary_color: PALE }),
      hasBrandingData: true,
    });
    renderHook(() => useDynamicTheme({ v2Theme: true }));

    await waitFor(() => expect(bodyVar('--brand-h')).toBe('48'));
    expect(bodyVar('--brand-link-l')).toBe('28%');
    expect(bodyVar('--brand-fg')).toBe('0 0% 3.9%');
  });

  it('waits for the real branding row instead of painting the placeholder', async () => {
    // The placeholder is built from the tenant context, where a missing colour
    // becomes the v1 platform green; painting it would flash.
    mockBranding.mockReturnValue({ branding: branding({ primary_color: '#223331' }), hasBrandingData: false });
    const { rerender } = renderHook(() => useDynamicTheme({ v2Theme: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(bodyVar('--brand-h')).toBe('');

    mockBranding.mockReturnValue({ branding: branding({ light_primary_color: TEAL }), hasBrandingData: true });
    rerender();
    await waitFor(() => expect(bodyVar('--brand-h')).toBe('175'));
  });

  it('follows a try-on preview and clears every brand var when the colour goes', async () => {
    mockBranding.mockReturnValue({ branding: branding({ light_primary_color: PALE }), hasBrandingData: true });
    const { rerender } = renderHook(() => useDynamicTheme({ v2Theme: true }));
    await waitFor(() => expect(bodyVar('--brand-link-l')).toBe('28%'));

    // The try-on writes new branding into the query cache; the hook re-runs.
    mockBranding.mockReturnValue({ branding: branding({ light_primary_color: TEAL }), hasBrandingData: true });
    rerender();
    await waitFor(() => expect(bodyVar('--brand-h')).toBe('175'));
    // The pale colour's extras must not linger on the teal.
    expect(bodyVar('--brand-link-l')).toBe('');
    expect(bodyVar('--brand-fg')).toBe('');

    mockBranding.mockReturnValue({ branding: branding(), hasBrandingData: true });
    rerender();
    await waitFor(() => expect(bodyVar('--brand-h')).toBe(''));
    for (const name of ['--brand-s', '--brand-l', '--brand-fg-dark']) expect(bodyVar(name), name).toBe('');
  });
});

describe('useDynamicTheme — v1 is unchanged', () => {
  it('still writes the tokens on <html>, and nothing on <body>', async () => {
    mockBranding.mockReturnValue({ branding: branding({ primary_color: TEAL }), hasBrandingData: true });
    renderHook(() => useDynamicTheme());

    // v1's own conversion of #0F766E, by hand: 175 77% 26%; hover is l-8 = 18%,
    // light is l=95, and the label is white because l <= 70.
    await waitFor(() => expect(htmlVar('--primary')).toBe('175 77% 26%'));
    expect(htmlVar('--primary-hover')).toBe('175 77% 18%');
    expect(htmlVar('--primary-light')).toBe('175 77% 95%');
    expect(htmlVar('--primary-foreground')).toBe('0 0% 100%');
    // No custom background: the gold-and-forest defaults are written explicitly.
    expect(htmlVar('--background')).toBe('42 30% 96%');
    expect(document.body.getAttribute('style')).toBeNull();
  });
});
