import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useTenantBranding, type TenantBranding } from './use-tenant-branding';
import { V2_BRAND_VAR_NAMES, v2BrandVars } from '@/lib/appearance/color';
import { PLATFORM_TAB_ICON, resolveBrandIcon } from '@/lib/appearance/logo';

// Default theme colors - must match index.css
const DEFAULT_COLORS = {
  light: {
    background: '42 30% 96%',      // Light Ivory/Cream
    foreground: '159 21% 20%',     // Dark Forest Green Text
    card: '42 30% 98%',
    cardForeground: '159 21% 20%',
    muted: '159 15% 88%',
    mutedForeground: '159 15% 35%',
    popover: '42 30% 98%',
    popoverForeground: '159 21% 20%',
    primary: '41 49% 56%',         // Muted Gold
    primaryForeground: '0 0% 100%',
    secondary: '41 49% 56%',
    secondaryForeground: '0 0% 100%',
    accent: '41 49% 56%',
    accentForeground: '0 0% 100%',
    sidebarBackground: '42 30% 98%',
    sidebarForeground: '159 21% 20%',
    sidebarPrimary: '41 49% 56%',
    sidebarPrimaryForeground: '0 0% 100%',
    sidebarAccent: '159 15% 92%',
    sidebarAccentForeground: '159 21% 20%',
  },
  dark: {
    background: '159 21% 8%',      // Dark forest green
    foreground: '42 30% 92%',      // Bright ivory
    card: '159 21% 12%',
    cardForeground: '42 30% 92%',
    muted: '159 15% 20%',
    mutedForeground: '42 20% 75%',
    popover: '159 21% 12%',
    popoverForeground: '42 30% 92%',
    primary: '41 49% 60%',         // Brighter gold
    primaryForeground: '159 21% 8%',
    secondary: '41 49% 60%',
    secondaryForeground: '159 21% 8%',
    accent: '41 49% 60%',
    accentForeground: '159 21% 8%',
    sidebarBackground: '159 21% 10%',
    sidebarForeground: '42 30% 92%',
    sidebarPrimary: '41 49% 60%',
    sidebarPrimaryForeground: '159 21% 8%',
    sidebarAccent: '41 49% 25%',
    sidebarAccentForeground: '42 30% 92%',
  }
};

// Convert hex to HSL values (just the numbers, not the full string)
function hexToHSL(hex: string): { h: number; s: number; l: number } | null {
  if (!hex || !hex.startsWith('#')) return null;

  hex = hex.replace('#', '');

  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

// Format HSL for CSS variable (without the hsl() wrapper, just "h s% l%")
function formatHSL(hsl: { h: number; s: number; l: number }): string {
  return `${hsl.h} ${hsl.s}% ${hsl.l}%`;
}

// Generate color variants from hex
function generateColorVariants(hex: string) {
  const hsl = hexToHSL(hex);
  if (!hsl) return null;

  return {
    base: formatHSL(hsl),
    hover: formatHSL({ ...hsl, l: Math.max(0, hsl.l - 8) }),
    light: formatHSL({ ...hsl, l: 95 }),
    dark: formatHSL({ ...hsl, l: Math.max(0, hsl.l - 15) }),
    // Use white text unless color is very light (pastel). Threshold 70 ensures good contrast.
    foreground: hsl.l > 70 ? '0 0% 0%' : '0 0% 100%',
  };
}

/**
 * Write the v2 brand parameters onto <body>, or clear them.
 *
 * The v2 theme is the `v2-theme` class on <body>, and styles/v2-theme.css
 * redeclares every colour token there. A token set inline on <html>, as the v1
 * path below does, is inherited by <body> and then overridden by that class,
 * so it never reaches a v2 element. The stylesheet instead derives its
 * brand-coloured tokens from `--brand-h` / `--brand-s` / `--brand-l`, and this
 * sets only those (plus the few extras `v2BrandVars` decides) on <body> itself.
 * Nothing else: background, card, muted and the sidebar ground stay the
 * stylesheet's, and nothing is cached for the v1 anti-flash script — the root
 * layout paints these same vars on first byte instead.
 */
export function applyV2BrandVars(body: HTMLElement, hex: string | null | undefined) {
  for (const name of V2_BRAND_VAR_NAMES) body.style.removeProperty(name);
  const vars = v2BrandVars(hex);
  if (!vars) return;
  for (const [name, value] of Object.entries(vars)) body.style.setProperty(name, value);
}

export function useDynamicTheme({ v2Theme = false }: { v2Theme?: boolean } = {}) {
  // `brandName` and not `branding.app_name`: `tenants.app_name` is optional and
  // is null for most tenants, and the sidebar badge draws its initials from the
  // resolved display name (app_name -> company_name -> "Portal"). Handing the
  // raw column to the tab mark gave the badge "NR" and the tab "O" on the same
  // screen, which is the very disagreement this chain exists to remove.
  const { branding, brandName, hasBrandingData } = useTenantBranding();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Always false for v1, so the v1 effect below re-runs on exactly what it did.
  const v2Ready = v2Theme && hasBrandingData;

  // Wait for client-side mount to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Only run on client after mount to avoid hydration mismatch
    if (!mounted || !branding) return;

    if (v2Theme) {
      // Wait for the real row. Until it arrives `branding` is a placeholder
      // built from the tenant context, whose missing colour defaults to the
      // v1 platform green; applying that would repaint the page green and back
      // between the server's first paint and the fetch. The Appearance try-on
      // writes real query data, so it passes straight through.
      if (v2Ready) {
        applyV2BrandVars(document.body, branding.light_primary_color || branding.primary_color);
      }
      applyDocumentMeta(branding, 'v2', v2Ready, brandName);
      return;
    }

    const root = document.documentElement;
    const isDarkMode = resolvedTheme === 'dark';
    const defaults = isDarkMode ? DEFAULT_COLORS.dark : DEFAULT_COLORS.light;

    // Get the appropriate colors for current theme
    const primaryColorHex = isDarkMode
      ? (branding.dark_primary_color || branding.primary_color)
      : (branding.light_primary_color || branding.primary_color);

    const secondaryColorHex = isDarkMode
      ? (branding.dark_secondary_color || branding.secondary_color)
      : (branding.light_secondary_color || branding.secondary_color);

    const accentColorHex = isDarkMode
      ? (branding.dark_accent_color || branding.accent_color)
      : (branding.light_accent_color || branding.accent_color);

    const backgroundColorHex = isDarkMode
      ? branding.dark_background_color
      : branding.light_background_color;

    // Apply primary color
    if (primaryColorHex) {
      const primary = generateColorVariants(primaryColorHex);
      if (primary) {
        root.style.setProperty('--primary', primary.base);
        root.style.setProperty('--primary-hover', primary.hover);
        root.style.setProperty('--primary-light', primary.light);
        root.style.setProperty('--primary-foreground', primary.foreground);
        root.style.setProperty('--sidebar-primary', primary.base);
        root.style.setProperty('--sidebar-primary-foreground', primary.foreground);
        root.style.setProperty('--ring', primary.base);

        const hsl = hexToHSL(primaryColorHex);
        if (hsl) {
          root.style.setProperty(
            '--gradient-primary',
            `linear-gradient(135deg, hsl(${hsl.h} ${hsl.s}% ${hsl.l}%) 0%, hsl(${hsl.h} ${hsl.s}% ${Math.max(0, hsl.l - 10)}%) 100%)`
          );
        }
      }
    } else {
      // Use defaults
      root.style.setProperty('--primary', defaults.primary);
      root.style.setProperty('--primary-foreground', defaults.primaryForeground);
      root.style.setProperty('--sidebar-primary', defaults.sidebarPrimary);
      root.style.setProperty('--sidebar-primary-foreground', defaults.sidebarPrimaryForeground);
      root.style.setProperty('--ring', defaults.primary);
      root.style.removeProperty('--primary-hover');
      root.style.removeProperty('--primary-light');
      root.style.removeProperty('--gradient-primary');
    }

    // Apply secondary color
    if (secondaryColorHex) {
      const secondary = generateColorVariants(secondaryColorHex);
      if (secondary) {
        root.style.setProperty('--secondary', secondary.base);
        root.style.setProperty('--secondary-foreground', secondary.foreground);
      }
    } else {
      root.style.setProperty('--secondary', defaults.secondary);
      root.style.setProperty('--secondary-foreground', defaults.secondaryForeground);
    }

    // Apply accent color
    if (accentColorHex) {
      const accent = generateColorVariants(accentColorHex);
      if (accent) {
        root.style.setProperty('--accent', accent.base);
        root.style.setProperty('--accent-foreground', accent.foreground);
        root.style.setProperty('--sidebar-accent', accent.base);
        root.style.setProperty('--sidebar-accent-foreground', accent.foreground);
      }
    } else {
      root.style.setProperty('--accent', defaults.accent);
      root.style.setProperty('--accent-foreground', defaults.accentForeground);
      root.style.setProperty('--sidebar-accent', defaults.sidebarAccent);
      root.style.setProperty('--sidebar-accent-foreground', defaults.sidebarAccentForeground);
    }

    // Apply background color - ALWAYS set, either custom or default
    if (backgroundColorHex) {
      const bgHsl = hexToHSL(backgroundColorHex);
      if (bgHsl) {
        const bgFormatted = formatHSL(bgHsl);
        root.style.setProperty('--background', bgFormatted);

        // Calculate appropriate foreground color based on background lightness
        const fgLightness = bgHsl.l > 50 ? 20 : 92;
        root.style.setProperty('--foreground', `${bgHsl.h} ${Math.min(bgHsl.s, 25)}% ${fgLightness}%`);

        // Update card background (slightly lighter/darker than main background)
        const cardLightness = isDarkMode
          ? Math.min(bgHsl.l + 3, 100)
          : Math.max(bgHsl.l + 2, 0);
        root.style.setProperty('--card', `${bgHsl.h} ${bgHsl.s}% ${cardLightness}%`);
        root.style.setProperty('--card-foreground', `${bgHsl.h} ${Math.min(bgHsl.s, 25)}% ${fgLightness}%`);

        // Update muted colors
        const mutedLightness = isDarkMode
          ? Math.min(bgHsl.l + 8, 100)
          : Math.max(bgHsl.l - 8, 0);
        root.style.setProperty('--muted', `${bgHsl.h} ${Math.max(bgHsl.s - 5, 0)}% ${mutedLightness}%`);
        root.style.setProperty('--muted-foreground', defaults.mutedForeground);

        // Update sidebar background
        root.style.setProperty('--sidebar-background', bgFormatted);
        root.style.setProperty('--sidebar-foreground', `${bgHsl.h} ${Math.min(bgHsl.s, 25)}% ${fgLightness}%`);

        // Update popover
        root.style.setProperty('--popover', bgFormatted);
        root.style.setProperty('--popover-foreground', `${bgHsl.h} ${Math.min(bgHsl.s, 25)}% ${fgLightness}%`);
      }
    } else {
      // No custom background - use theme defaults explicitly
      root.style.setProperty('--background', defaults.background);
      root.style.setProperty('--foreground', defaults.foreground);
      root.style.setProperty('--card', defaults.card);
      root.style.setProperty('--card-foreground', defaults.cardForeground);
      root.style.setProperty('--muted', defaults.muted);
      root.style.setProperty('--muted-foreground', defaults.mutedForeground);
      root.style.setProperty('--popover', defaults.popover);
      root.style.setProperty('--popover-foreground', defaults.popoverForeground);
      root.style.setProperty('--sidebar-background', defaults.sidebarBackground);
      root.style.setProperty('--sidebar-foreground', defaults.sidebarForeground);
    }

    applyDocumentMeta(branding);

    // Cache CSS variables for instant load on next visit
    try {
      const cssVars = Array.from(root.style)
        .filter(prop => prop.startsWith('--'))
        .map(prop => `${prop}: ${root.style.getPropertyValue(prop)};`)
        .join(' ');
      if (cssVars) {
        localStorage.setItem('portal-tenant-branding-css', `:root { ${cssVars} }`);
      }
    } catch (e) {
      // localStorage might not be available
    }

  }, [branding, brandName, resolvedTheme, mounted, v2Theme, v2Ready]);

  return { branding, mounted };
}

/**
 * Title, favicon, description and share tags. The same for both themes except
 * the favicon: v1 keeps its original first-link update, v2 uses
 * `applyV2Favicon` (below), which reaches every icon link the page carries.
 */
function applyDocumentMeta(
  branding: TenantBranding,
  theme: 'v1' | 'v2' = 'v1',
  v2Ready = false,
  /** The resolved display name the sidebar badge uses, NOT `branding.app_name`. */
  markName?: string | null
) {
  // Update document title
  if (branding.meta_title) {
    document.title = branding.meta_title;
  } else if (branding.app_name) {
    document.title = `${branding.app_name} - Portal`;
  }

  if (theme === 'v2') {
    // The one chain Settings → Branding previews: the square icon, else a mark
    // drawn from the portal name's initials in the brand colour, else (only
    // where that cannot be drawn) the platform icon the branch below restores.
    // `applyV2BrandVars` has already written --brand-* on <body>, so the mark
    // is painted in exactly what the sidebar badge is.
    const icon = resolveBrandIcon(branding.favicon_url, markName ?? branding.app_name, {
      brandColor: branding.light_primary_color || branding.primary_color,
      // No mark until the real row is in. Until then `branding` is a
      // placeholder built from the tenant context, which does not select
      // `favicon_url` — drawing from it would replace a tenant's OWN icon,
      // already in the tab from the server, with their initials, and put it
      // back a moment later.
      generate: v2Ready,
    });
    applyV2Favicon(document.head, icon.src);
  } else if (branding.favicon_url) {
    // Update favicon if provided
    const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (link) {
      link.href = branding.favicon_url;
    } else {
      const newLink = document.createElement('link');
      newLink.rel = 'icon';
      newLink.href = branding.favicon_url;
      document.head.appendChild(newLink);
    }
  }

  // Update meta description
  if (branding.meta_description) {
    let metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    if (metaDesc) {
      metaDesc.content = branding.meta_description;
    } else {
      metaDesc = document.createElement('meta');
      metaDesc.name = 'description';
      metaDesc.content = branding.meta_description;
      document.head.appendChild(metaDesc);
    }
  }

  // Update OG meta tags
  if (branding.meta_title) {
    updateMetaTag('og:title', branding.meta_title);
    updateMetaTag('twitter:title', branding.meta_title);
  }

  if (branding.meta_description) {
    updateMetaTag('og:description', branding.meta_description);
    updateMetaTag('twitter:description', branding.meta_description);
  }

  if (branding.og_image_url) {
    updateMetaTag('og:image', branding.og_image_url);
    updateMetaTag('twitter:image', branding.og_image_url);
  }
}

/** Marks an icon link this code added because the page had none. */
const V2_ICON_ADDED_ATTR = 'data-v2-icon-added';
/** On a server-rendered icon link: its own href, type and sizes, to put back later. */
const V2_ICON_ORIGINAL_ATTR = 'data-v2-icon-original';

/**
 * What the tab shows with no square icon AND no drawable initials mark: the
 * platform icon the server falls back to (app/layout.tsx `PLATFORM_FAVICONS`,
 * the light one).
 */
const V2_PLATFORM_ICON: Record<string, string | null> = { href: PLATFORM_TAB_ICON, type: 'image/png', sizes: null };

/** One of the platform's own icons (served from /icons/ on this site), not a tenant's upload. */
function isPlatformIconHref(href: unknown): boolean {
  if (typeof href !== 'string') return false;
  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/icons/');
  } catch {
    return false;
  }
}

/**
 * The tenant's icon URL with a short version tag, so a browser that cached
 * the tab icon fetches the new one. The tag is a hash of the URL, so the same
 * icon keeps the same href (no refetch, no flicker) and a new one always gets
 * a new href. Only for web URLs: a `data:` or `blob:` URL cannot carry a query.
 */
export function versionedIconHref(url: string): string {
  if (!/^(https?:)?\/\//i.test(url) && !url.startsWith('/')) return url;
  let hash = 5381;
  for (let i = 0; i < url.length; i++) hash = ((hash * 33) ^ url.charCodeAt(i)) >>> 0;
  const [base, fragment] = url.split('#', 2);
  const tagged = `${base}${base.includes('?') ? '&' : '?'}v=${hash.toString(36)}`;
  return fragment === undefined ? tagged : `${tagged}#${fragment}`;
}

/**
 * v2: the browser tab icon follows the tenant's square icon without a reload.
 *
 * The server renders SEVERAL icon links: with a tenant icon, `icon` and
 * `shortcut icon`; without one, a light and a dark platform icon plus an .ico.
 * Browsers pick among all of them (Chrome takes the last, and a dark tab strip
 * takes the dark one), so v1's update of only the FIRST link left the tab on
 * the old icon after a save. Every `rel~="icon"` link is pointed at the new
 * icon instead, with its `type` and `sizes` lifted (they described the old
 * file). What the page loaded with is kept on the link, and put back when the
 * square icon is removed; a link this code had to add is removed again. When
 * what the page loaded with was the tenant's own icon (the one now removed),
 * the platform icon goes back instead, as the server would render it on the
 * next load. `apple-touch-icon` is not an icon link here and is never touched.
 *
 * `iconHref` is what `resolveBrandIcon` decided, NOT `favicon_url` itself:
 * with the square icon removed it is the drawn initials mark, a `data:` URL,
 * and the null branch below is reached only where that could not be drawn.
 */
export function applyV2Favicon(head: HTMLElement, iconHref: string | null | undefined) {
  const links = Array.from(head.querySelectorAll<HTMLLinkElement>("link[rel~='icon']"));

  if (!iconHref) {
    for (const link of links) {
      if (link.hasAttribute(V2_ICON_ADDED_ATTR)) {
        link.remove();
        continue;
      }
      const saved = link.getAttribute(V2_ICON_ORIGINAL_ATTR);
      if (saved === null) continue;
      let original: Record<string, string | null> | null = null;
      try {
        original = JSON.parse(saved);
      } catch {
        // Unreadable: the platform icon below, the same as with no square icon on a fresh load.
      }
      // The page loaded with the tenant's own icon, which is exactly what was
      // just removed: putting that back would keep it in the tab until a reload.
      const restore = original && isPlatformIconHref(original.href) ? original : V2_PLATFORM_ICON;
      for (const name of ['href', 'type', 'sizes']) {
        const value = restore[name];
        if (typeof value === 'string') link.setAttribute(name, value);
        else if (name !== 'href') link.removeAttribute(name);
      }
      link.removeAttribute(V2_ICON_ORIGINAL_ATTR);
    }
    return;
  }

  const href = versionedIconHref(iconHref);
  if (links.length === 0) {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.setAttribute(V2_ICON_ADDED_ATTR, '');
    head.appendChild(link);
    links.push(link);
  }
  for (const link of links) {
    if (!link.hasAttribute(V2_ICON_ADDED_ATTR) && !link.hasAttribute(V2_ICON_ORIGINAL_ATTR)) {
      link.setAttribute(
        V2_ICON_ORIGINAL_ATTR,
        JSON.stringify({
          href: link.getAttribute('href'),
          type: link.getAttribute('type'),
          sizes: link.getAttribute('sizes'),
        })
      );
    }
    link.removeAttribute('type');
    link.removeAttribute('sizes');
    // Only on a change: re-setting the same href can make a browser refetch.
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }
}

function updateMetaTag(property: string, content: string) {
  const isOg = property.startsWith('og:') || property.startsWith('twitter:');
  const selector = isOg ? `meta[property="${property}"]` : `meta[name="${property}"]`;

  let meta = document.querySelector(selector) as HTMLMetaElement;
  if (meta) {
    meta.content = content;
  } else {
    meta = document.createElement('meta');
    if (isOg) {
      meta.setAttribute('property', property);
    } else {
      meta.name = property;
    }
    meta.content = content;
    document.head.appendChild(meta);
  }
}

export default useDynamicTheme;
