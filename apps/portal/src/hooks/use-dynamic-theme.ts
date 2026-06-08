import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useTenantBranding } from './use-tenant-branding';

// Default theme colors — MUST match the Bento palette in global.css (DESIGN_SYSTEM.md §3).
// Used when a tenant has no custom branding colors (and as the floor everywhere).
const DEFAULT_COLORS = {
  light: {
    background: '248.6 46.7% 97.1%',
    foreground: '249.2 36.1% 14.1%',
    card: '0 0% 100%',
    cardForeground: '249.2 36.1% 14.1%',
    muted: '253.3 52.9% 96.7%',
    mutedForeground: '251.1 14.6% 63.7%',
    popover: '0 0% 100%',
    popoverForeground: '249.2 36.1% 14.1%',
    primary: '262 84% 63%',  // CORTEK violet #a470ff
    primaryForeground: '0 0% 100%',
    secondary: '253.3 52.9% 96.7%',
    secondaryForeground: '250 14% 42%',
    accent: '262 91% 96%',
    accentForeground: '262 70% 56%',
    sidebarBackground: '0 0% 100%',
    sidebarForeground: '250 14% 42%',
    sidebarPrimary: '262 84% 63%',
    sidebarPrimaryForeground: '0 0% 100%',
    sidebarAccent: '262 91% 96%',
    sidebarAccentForeground: '262 70% 56%',
  },
  dark: {
    background: '246.7 27.3% 6.5%',
    foreground: '252 65.2% 95.5%',
    card: '248.2 35.5% 12.2%',
    cardForeground: '252 65.2% 95.5%',
    muted: '248.9 33.3% 15.9%',
    mutedForeground: '248.1 14.9% 48.8%',
    popover: '248.2 35.5% 12.2%',
    popoverForeground: '252 65.2% 95.5%',
    primary: '262 100% 72%',  // CORTEK violet #a470ff
    primaryForeground: '0 0% 100%',
    secondary: '248.9 33.3% 15.9%',
    secondaryForeground: '249.7 24.5% 70.4%',
    accent: '262 40% 22%',
    accentForeground: '262 100% 82%',
    sidebarBackground: '251.3 32% 9.8%',
    sidebarForeground: '249.7 24.5% 70.4%',
    sidebarPrimary: '262 100% 72%',
    sidebarPrimaryForeground: '0 0% 100%',
    sidebarAccent: '262 40% 22%',
    sidebarAccentForeground: '262 100% 82%',
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

export function useDynamicTheme() {
  const { branding } = useTenantBranding();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Wait for client-side mount to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Only run on client after mount to avoid hydration mismatch
    if (!mounted || !branding) return;

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

    // Update document title
    if (branding.meta_title) {
      document.title = branding.meta_title;
    } else if (branding.app_name) {
      document.title = `${branding.app_name} - Portal`;
    }

    // Update favicon if provided
    if (branding.favicon_url) {
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

  }, [branding, resolvedTheme, mounted]);

  return { branding, mounted };
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
