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

import { applyV2Favicon, useDynamicTheme, versionedIconHref } from '@/hooks/use-dynamic-theme';
import { BRAND_MARK_FONT_STACK, clearBrandMarkCache } from '@/lib/appearance/logo';
import { expectedMarkUrl, installCanvas, type CanvasStub } from '../helpers/canvas-stub';

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

/* -------------------------------------------------------------------------- */
/* The browser tab icon follows a saved (or tried-on) square icon, no reload   */
/* -------------------------------------------------------------------------- */

/** The <link>s app/layout.tsx renders, in its order. */
function serverIcons(kind: 'tenant' | 'platform') {
  const add = (attrs: Record<string, string>) => {
    const link = document.createElement('link');
    for (const [name, value] of Object.entries(attrs)) link.setAttribute(name, value);
    document.head.appendChild(link);
    return link;
  };
  const apple = () => add({ rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' });
  if (kind === 'tenant') {
    return {
      icon: add({ rel: 'icon', href: 'https://cdn.test/old.png' }),
      shortcut: add({ rel: 'shortcut icon', href: 'https://cdn.test/old.png' }),
      apple: apple(),
    };
  }
  return {
    light: add({ rel: 'icon', href: '/icons/favicon-light.png', media: '(prefers-color-scheme: light)', type: 'image/png' }),
    dark: add({ rel: 'icon', href: '/icons/favicon-dark.png', media: '(prefers-color-scheme: dark)', type: 'image/png' }),
    ico: add({ rel: 'icon', href: '/icons/favicon.ico', sizes: 'any' }),
    apple: apple(),
  };
}

describe('versionedIconHref', () => {
  it('tags a web URL with a hash of itself (djb2 with xor, base 36), worked by hand for "/a"', () => {
    // h = 5381. "/" (47): 5381 × 33 = 177573 = 0x2B5A5, xor 0x2F = 0x2B58A = 177546.
    // "a" (97): 177546 × 33 = 5859018 = 0x5966CA, xor 0x61 = 0x5966AB = 5858987.
    // 5858987 in base 36 = 3·36⁴ + 17·36³ + 20·36² + 29·36 + 23 -> "3hktn".
    expect(versionedIconHref('/a')).toBe('/a?v=3hktn');
  });

  it('is stable for one URL, new for another, joins an existing query, keeps a fragment, and leaves data: alone', () => {
    const a = versionedIconHref('https://cdn.test/t1/favicon-1.png');
    expect(versionedIconHref('https://cdn.test/t1/favicon-1.png')).toBe(a);
    expect(versionedIconHref('https://cdn.test/t1/favicon-2.png')).not.toBe(a);
    expect(a).toMatch(/^https:\/\/cdn\.test\/t1\/favicon-1\.png\?v=[0-9a-z]+$/);
    expect(versionedIconHref('https://cdn.test/f.png?token=x')).toMatch(/^https:\/\/cdn\.test\/f\.png\?token=x&v=[0-9a-z]+$/);
    expect(versionedIconHref('https://cdn.test/f.svg#mark')).toMatch(/^https:\/\/cdn\.test\/f\.svg\?v=[0-9a-z]+#mark$/);
    expect(versionedIconHref('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });
});

describe('applyV2Favicon', () => {
  afterEach(() => {
    document.head.querySelectorAll('link').forEach((link) => link.remove());
  });

  it("points EVERY icon link at the tenant's icon (the old code moved only the first), and never the apple-touch-icon", () => {
    const links = serverIcons('tenant');
    applyV2Favicon(document.head, 'https://cdn.test/new.png');
    const href = versionedIconHref('https://cdn.test/new.png');
    expect(links.icon.getAttribute('href')).toBe(href);
    expect(links.shortcut.getAttribute('href')).toBe(href);
    expect(links.apple.getAttribute('href')).toBe('/icons/apple-touch-icon.png');
  });

  it('repoints the light, dark and .ico platform icons, dropping the type and sizes that described them', () => {
    const links = serverIcons('platform');
    applyV2Favicon(document.head, 'https://cdn.test/new.png');
    for (const link of [links.light, links.dark, links.ico]) {
      expect(link.getAttribute('href')).toBe(versionedIconHref('https://cdn.test/new.png'));
      expect(link.hasAttribute('type')).toBe(false);
      expect(link.hasAttribute('sizes')).toBe(false);
    }
    expect(links.dark.getAttribute('media')).toBe('(prefers-color-scheme: dark)');
  });

  it('puts back exactly what the page loaded with when the square icon is removed', () => {
    const links = serverIcons('platform');
    applyV2Favicon(document.head, 'https://cdn.test/one.png');
    applyV2Favicon(document.head, 'https://cdn.test/two.png'); // a second change keeps the first originals
    applyV2Favicon(document.head, null);
    expect(links.light.getAttribute('href')).toBe('/icons/favicon-light.png');
    expect(links.light.getAttribute('type')).toBe('image/png');
    expect(links.dark.getAttribute('href')).toBe('/icons/favicon-dark.png');
    expect(links.ico.getAttribute('href')).toBe('/icons/favicon.ico');
    expect(links.ico.getAttribute('sizes')).toBe('any');
    expect(links.ico.hasAttribute('type')).toBe(false);
    expect(document.head.querySelectorAll('link[data-v2-icon-original]')).toHaveLength(0);
  });

  it("shows the platform icon, not the removed one, when the page loaded with the tenant's own icon", () => {
    // The server rendered icon + shortcut icon for https://cdn.test/old.png. The
    // tenant removes the square icon and saves: putting old.png back would keep
    // the removed icon in the tab until a reload.
    const links = serverIcons('tenant');
    applyV2Favicon(document.head, 'https://cdn.test/old.png'); // the real row lands
    applyV2Favicon(document.head, null); // removed and saved
    for (const link of [links.icon, links.shortcut]) {
      expect(link.getAttribute('href')).toBe('/icons/favicon-light.png');
      expect(link.getAttribute('type')).toBe('image/png');
      expect(link.hasAttribute('sizes')).toBe(false);
      expect(link.hasAttribute('data-v2-icon-original')).toBe(false);
    }
    expect(links.apple.getAttribute('href')).toBe('/icons/apple-touch-icon.png');
    // A new icon after that is tagged as usual, and removing it again gives the platform icon back.
    applyV2Favicon(document.head, 'https://cdn.test/new.png');
    expect(links.icon.getAttribute('href')).toBe(versionedIconHref('https://cdn.test/new.png'));
    applyV2Favicon(document.head, null);
    expect(links.icon.getAttribute('href')).toBe('/icons/favicon-light.png');
    expect(links.icon.getAttribute('type')).toBe('image/png');
  });

  it('an unreadable saved original falls back to the platform icon too', () => {
    const links = serverIcons('tenant');
    applyV2Favicon(document.head, 'https://cdn.test/new.png');
    links.icon.setAttribute('data-v2-icon-original', '{not json');
    applyV2Favicon(document.head, null);
    expect(links.icon.getAttribute('href')).toBe('/icons/favicon-light.png');
    expect(links.shortcut.getAttribute('href')).toBe('/icons/favicon-light.png');
  });

  it('adds one icon link when the page has none, and takes it away again', () => {
    applyV2Favicon(document.head, 'https://cdn.test/new.png');
    const added = document.head.querySelectorAll("link[rel~='icon']");
    expect(added).toHaveLength(1);
    expect(added[0].getAttribute('href')).toBe(versionedIconHref('https://cdn.test/new.png'));
    applyV2Favicon(document.head, null);
    expect(document.head.querySelectorAll("link[rel~='icon']")).toHaveLength(0);
  });

  it('does not touch the links when there is no icon and nothing was changed', () => {
    const links = serverIcons('tenant');
    applyV2Favicon(document.head, null);
    expect(links.icon.getAttribute('href')).toBe('https://cdn.test/old.png');
    expect(links.shortcut.getAttribute('href')).toBe('https://cdn.test/old.png');
  });
});

describe('useDynamicTheme — the tab icon after a save', () => {
  afterEach(() => {
    document.head.querySelectorAll('link').forEach((link) => link.remove());
  });

  it('v2: a new favicon_url in the branding cache reaches every icon link, no reload', async () => {
    const links = serverIcons('tenant');
    mockBranding.mockReturnValue({ branding: branding({ favicon_url: 'https://cdn.test/old.png' }), hasBrandingData: true });
    const { rerender } = renderHook(() => useDynamicTheme({ v2Theme: true }));
    await waitFor(() => expect(links.shortcut.getAttribute('href')).toBe(versionedIconHref('https://cdn.test/old.png')));

    // Save (or the Branding try-on) writes the new row into the cache.
    mockBranding.mockReturnValue({ branding: branding({ favicon_url: 'https://cdn.test/new.png' }), hasBrandingData: true });
    rerender();
    await waitFor(() => expect(links.icon.getAttribute('href')).toBe(versionedIconHref('https://cdn.test/new.png')));
    expect(links.shortcut.getAttribute('href')).toBe(versionedIconHref('https://cdn.test/new.png'));
  });

  it('v1 is unchanged: only the first icon link moves, untagged', async () => {
    const links = serverIcons('platform');
    mockBranding.mockReturnValue({ branding: branding({ primary_color: TEAL, favicon_url: 'https://cdn.test/new.png' }), hasBrandingData: true });
    renderHook(() => useDynamicTheme());
    await waitFor(() => expect(links.light.getAttribute('href')).toBe('https://cdn.test/new.png'));
    expect(links.light.getAttribute('type')).toBe('image/png');
    expect(links.dark.getAttribute('href')).toBe('/icons/favicon-dark.png');
    expect(links.ico.getAttribute('href')).toBe('/icons/favicon.ico');
  });
});

/* -------------------------------------------------------------------------- */
/* With no square icon, the tab shows the tenant's own initials                */
/*                                                                             */
/* The reported defect: removing the square icon left the Drive247 platform    */
/* icon in the tab, while the sidebar beside it showed the tenant's initials.  */
/* Both now take `resolveBrandIcon` (lib/appearance/logo.ts), so the picture   */
/* in Settings › Branding and the real tab cannot say different things.        */
/* -------------------------------------------------------------------------- */

describe('useDynamicTheme — the tab with no square icon', () => {
  let canvas: CanvasStub | null = null;

  beforeEach(() => {
    clearBrandMarkCache();
  });

  afterEach(() => {
    canvas?.restore();
    canvas = null;
    document.head.querySelectorAll('link').forEach((link) => link.remove());
  });

  /** The mark for this branding: initials from app_name, drawn in the primary. */
  const markFor = (initials: string, background: string, foreground: string) =>
    expectedMarkUrl({ initials, background, foreground, fontFamily: BRAND_MARK_FONT_STACK });

  it('v2: removing the square icon puts the initials mark in every icon link, no reload', async () => {
    canvas = installCanvas();
    const links = serverIcons('tenant');
    mockBranding.mockReturnValue({
      branding: branding({ favicon_url: 'https://cdn.test/old.png', light_primary_color: TEAL }),
      hasBrandingData: true,
    });
    const { rerender } = renderHook(() => useDynamicTheme({ v2Theme: true }));
    await waitFor(() => expect(links.icon.getAttribute('href')).toBe(versionedIconHref('https://cdn.test/old.png')));

    // Remove and save: the row comes back with no favicon_url.
    mockBranding.mockReturnValue({ branding: branding({ light_primary_color: TEAL }), hasBrandingData: true });
    rerender();

    // "Northwind" is one word: its first two letters. TEAL is dark, so white letters.
    const mark = markFor('NO', TEAL, '#FFFFFF');
    await waitFor(() => expect(links.icon.getAttribute('href')).toBe(mark));
    expect(links.shortcut.getAttribute('href')).toBe(mark);
    // Not the platform icon, and not the removed file. (`old.png` is still on
    // the link in `data-v2-icon-original`, which is what the page loaded with
    // and is only ever restored when it was a platform icon — so check hrefs.)
    const hrefs = Array.from(document.head.querySelectorAll("link[rel~='icon']")).map((l) => l.getAttribute('href'));
    expect(hrefs).toEqual([mark, mark]);
    // A data: URL carries no query, so it is never version-tagged.
    expect(mark).not.toContain('?v=');
    expect(links.apple.getAttribute('href')).toBe('/icons/apple-touch-icon.png');
  });

  it('draws the mark in the brand colour the page is painted in, not a fixed one', async () => {
    canvas = installCanvas();
    const links = serverIcons('platform');
    mockBranding.mockReturnValue({ branding: branding({ light_primary_color: PALE }), hasBrandingData: true });
    renderHook(() => useDynamicTheme({ v2Theme: true }));
    // PALE (#FDE68A) is too light for white letters: near-black instead.
    await waitFor(() => expect(links.light.getAttribute('href')).toBe(markFor('NO', PALE, '#0A0A0A')));
    expect(links.dark.getAttribute('href')).toBe(markFor('NO', PALE, '#0A0A0A'));
  });

  it("leaves the server's own icon alone until the real branding row is in", async () => {
    canvas = installCanvas();
    const links = serverIcons('tenant');
    // The placeholder built from the tenant context does not carry favicon_url:
    // a mark drawn from it would push the tenant's own icon out of the tab and
    // then put it straight back.
    mockBranding.mockReturnValue({ branding: branding({ light_primary_color: TEAL }), hasBrandingData: false });
    const { rerender } = renderHook(() => useDynamicTheme({ v2Theme: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(links.icon.getAttribute('href')).toBe('https://cdn.test/old.png');
    expect(canvas.drawn).toHaveLength(0);

    mockBranding.mockReturnValue({
      branding: branding({ favicon_url: 'https://cdn.test/old.png', light_primary_color: TEAL }),
      hasBrandingData: true,
    });
    rerender();
    await waitFor(() => expect(links.icon.getAttribute('href')).toBe(versionedIconHref('https://cdn.test/old.png')));
  });

  it('leaves the platform icon alone where the mark cannot be drawn at all', async () => {
    // No canvas stub: this is the server-render case, and the platform icon the
    // server already rendered is exactly right for it.
    const links = serverIcons('platform');
    mockBranding.mockReturnValue({ branding: branding({ light_primary_color: TEAL }), hasBrandingData: true });
    renderHook(() => useDynamicTheme({ v2Theme: true }));
    await waitFor(() => expect(document.body.style.getPropertyValue('--brand-h')).toBe('175'));
    expect(links.light.getAttribute('href')).toBe('/icons/favicon-light.png');
    expect(links.dark.getAttribute('href')).toBe('/icons/favicon-dark.png');
    expect(links.ico.getAttribute('href')).toBe('/icons/favicon.ico');
  });

  it('draws the initials the SIDEBAR badge draws, not the raw app_name column', async () => {
    canvas = installCanvas();
    const links = serverIcons('platform');
    // `tenants.app_name` is optional and is null for most tenants; the badge
    // falls back to the company name (`useTenantBranding`'s `brandName`).
    // Reading the column straight gave the badge "NR" and the tab "O".
    mockBranding.mockReturnValue({
      branding: branding({ app_name: null, light_primary_color: TEAL }),
      brandName: 'Northwind Rentals',
      hasBrandingData: true,
    });
    renderHook(() => useDynamicTheme({ v2Theme: true }));
    await waitFor(() => expect(links.light.getAttribute('href')).toBe(markFor('NR', TEAL, '#FFFFFF')));
    expect(links.light.getAttribute('href')).not.toBe(markFor('O', TEAL, '#FFFFFF'));
  });

  it('v1 never gets a mark: with no favicon_url it leaves every link where it was', async () => {
    canvas = installCanvas();
    const links = serverIcons('platform');
    mockBranding.mockReturnValue({ branding: branding({ primary_color: TEAL }), hasBrandingData: true });
    renderHook(() => useDynamicTheme());
    await waitFor(() => expect(htmlVar('--primary')).toBe('175 77% 26%'));
    expect(links.light.getAttribute('href')).toBe('/icons/favicon-light.png');
    expect(links.dark.getAttribute('href')).toBe('/icons/favicon-dark.png');
    expect(links.ico.getAttribute('href')).toBe('/icons/favicon.ico');
    expect(canvas.drawn).toHaveLength(0);
  });
});
