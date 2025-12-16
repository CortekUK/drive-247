'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useBrandingSettings } from './useBrandingSettings';

// Default theme colors for Drive917 Client - matches index.css
const DEFAULT_COLORS = {
  light: {
    background: '0 0% 95%',
    foreground: '0 0% 20%',
    card: '0 0% 100%',
    cardForeground: '0 0% 20%',
    muted: '0 0% 90%',
    mutedForeground: '0 0% 40%',
    popover: '0 0% 100%',
    popoverForeground: '0 0% 20%',
    primary: '165 20% 17%',          // Dark green
    primaryForeground: '0 0% 95%',
    secondary: '0 0% 92%',
    secondaryForeground: '0 0% 20%',
    accent: '42 80% 58%',            // Gold
    accentForeground: '0 0% 20%',
    border: '0 0% 85%',
    input: '0 0% 88%',
    ring: '165 20% 17%',
    navBg: '165 20% 17%',
    navForeground: '0 0% 95%',
  },
  dark: {
    background: '0 0% 15%',
    foreground: '0 0% 95%',
    card: '0 0% 18%',
    cardForeground: '0 0% 95%',
    muted: '0 0% 17%',
    mutedForeground: '0 0% 65%',
    popover: '0 0% 16%',
    popoverForeground: '0 0% 95%',
    primary: '0 0% 95%',
    primaryForeground: '0 0% 15%',
    secondary: '0 0% 20%',
    secondaryForeground: '0 0% 95%',
    accent: '45 100% 60%',           // Brighter gold
    accentForeground: '0 0% 15%',
    border: '0 0% 25%',
    input: '0 0% 20%',
    ring: '0 0% 85%',
    navBg: '165 20% 17%',
    navForeground: '0 0% 95%',
  }
};

// Convert hex to HSL values
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

// Format HSL for CSS variable
function formatHSL(hsl: { h: number; s: number; l: number }): string {
  return `${hsl.h} ${hsl.s}% ${hsl.l}%`;
}

// Generate color variants
function generateColorVariants(hex: string) {
  const hsl = hexToHSL(hex);
  if (!hsl) return null;

  return {
    base: formatHSL(hsl),
    hover: formatHSL({ ...hsl, l: Math.max(0, hsl.l - 8) }),
    light: formatHSL({ ...hsl, l: Math.min(95, hsl.l + 30) }),
    dark: formatHSL({ ...hsl, l: Math.max(0, hsl.l - 15) }),
    foreground: hsl.l > 50 ? '0 0% 15%' : '0 0% 95%',
    glow: `0 0 40px hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, 0.3)`,
    shadow: `0 4px 20px hsla(${hsl.h}, ${hsl.s}%, ${Math.max(0, hsl.l - 20)}%, 0.25)`,
  };
}

export function useDynamicTheme() {
  const { branding } = useBrandingSettings();
  const { theme, resolvedTheme } = useTheme();

  // Use resolvedTheme which handles 'system' preference
  const isDarkMode = resolvedTheme === 'dark';

  // Apply theme colors - runs when branding OR isDarkMode changes
  useEffect(() => {
    if (!branding) return;

    const root = document.documentElement;
    const defaults = isDarkMode ? DEFAULT_COLORS.dark : DEFAULT_COLORS.light;

    // Get theme-specific colors or fall back to base colors
    const primaryColorHex = isDarkMode
      ? (branding.dark_primary_color || branding.primary_color)
      : (branding.light_primary_color || branding.primary_color);

    const secondaryColorHex = isDarkMode
      ? (branding.dark_secondary_color || branding.secondary_color)
      : (branding.light_secondary_color || branding.secondary_color);

    const accentColorHex = isDarkMode
      ? (branding.dark_accent_color || branding.accent_color)
      : (branding.light_accent_color || branding.accent_color);

    // Debug logging
    console.log('[DynamicTheme] Theme changed:', {
      isDarkMode,
      'branding.light_accent_color': branding.light_accent_color,
      'branding.dark_accent_color': branding.dark_accent_color,
      'branding.accent_color': branding.accent_color,
      'resolved accentColorHex': accentColorHex,
    });

    const backgroundColorHex = isDarkMode
      ? branding.dark_background_color
      : branding.light_background_color;

    // For client site: PRIMARY buttons should use ACCENT color (gold)
    // This ensures CTA buttons are gold, not the branding primary color
    // We'll set --primary to match --accent so default buttons are gold
    if (accentColorHex) {
      const accent = generateColorVariants(accentColorHex);
      if (accent) {
        // Make primary buttons use the gold accent color
        root.style.setProperty('--primary', accent.base);
        root.style.setProperty('--primary-foreground', accent.foreground);
        root.style.setProperty('--ring', accent.base);
      }
    } else {
      // Default to gold for primary buttons
      root.style.setProperty('--primary', defaults.accent);
      root.style.setProperty('--primary-foreground', defaults.accentForeground);
      root.style.setProperty('--ring', defaults.accent);
    }

    // Navigation/footer uses theme-specific header/footer colors
    // Check for actual hex values, not empty strings
    const isValidHex = (color: string | null | undefined): boolean => {
      return !!color && color.trim() !== '' && color.startsWith('#');
    };

    // Use theme-specific header/footer color, default to #1A2B25 (dark forest green)
    const navColorHex = isDarkMode
      ? (isValidHex(branding.dark_header_footer_color) ? branding.dark_header_footer_color! : '#1A2B25')
      : (isValidHex(branding.light_header_footer_color) ? branding.light_header_footer_color! : '#1A2B25');


    if (navColorHex) {
      const navColor = generateColorVariants(navColorHex);
      if (navColor) {
        root.style.setProperty('--nav-bg', navColor.base);
        root.style.setProperty('--nav-foreground', navColor.foreground);
        root.style.setProperty('--sidebar-background', navColor.base);
        root.style.setProperty('--sidebar-foreground', navColor.foreground);
        root.style.setProperty('--bk-bg', navColorHex);
      }
    } else {
      root.style.setProperty('--nav-bg', defaults.navBg);
      root.style.setProperty('--nav-foreground', defaults.navForeground);
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

    // Apply accent color (gold highlights, buttons, badges)
    if (accentColorHex) {
      const accent = generateColorVariants(accentColorHex);
      if (accent) {
        root.style.setProperty('--accent', accent.base);
        root.style.setProperty('--accent-foreground', accent.foreground);
        root.style.setProperty('--sidebar-primary', accent.base);
        root.style.setProperty('--sidebar-primary-foreground', accent.foreground);
        root.style.setProperty('--sidebar-ring', accent.base);

        // Update gold-specific variables
        root.style.setProperty('--bk-gold', accentColorHex);
        root.style.setProperty('--bk-gold-soft', `${accentColorHex}33`); // 20% opacity

        // Update gradients
        const hsl = hexToHSL(accentColorHex);
        if (hsl) {
          root.style.setProperty(
            '--gradient-accent',
            `linear-gradient(135deg, hsl(${hsl.h} ${hsl.s}% ${hsl.l}%), hsl(${hsl.h} ${hsl.s}% ${Math.min(100, hsl.l + 7)}%))`
          );
          root.style.setProperty(
            '--shadow-glow',
            `0 0 40px hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, 0.3)`
          );
        }
      }
    } else {
      root.style.setProperty('--accent', defaults.accent);
      root.style.setProperty('--accent-foreground', defaults.accentForeground);
    }

    // Apply background color
    if (backgroundColorHex) {
      const bgHsl = hexToHSL(backgroundColorHex);
      if (bgHsl) {
        const bgFormatted = formatHSL(bgHsl);
        root.style.setProperty('--background', bgFormatted);

        // Calculate foreground based on background lightness
        const fgLightness = bgHsl.l > 50 ? 20 : 95;
        root.style.setProperty('--foreground', `0 0% ${fgLightness}%`);

        // Update card colors
        const cardLightness = isDarkMode
          ? Math.min(bgHsl.l + 3, 100)
          : Math.max(bgHsl.l + 5, 0);
        root.style.setProperty('--card', `${bgHsl.h} ${bgHsl.s}% ${cardLightness}%`);
        root.style.setProperty('--card-foreground', `0 0% ${fgLightness}%`);

        // Update muted colors
        const mutedLightness = isDarkMode
          ? Math.min(bgHsl.l + 2, 100)
          : Math.max(bgHsl.l - 5, 0);
        root.style.setProperty('--muted', `${bgHsl.h} ${bgHsl.s}% ${mutedLightness}%`);

        // Update popover
        root.style.setProperty('--popover', bgFormatted);
        root.style.setProperty('--popover-foreground', `0 0% ${fgLightness}%`);

        // Update gradient-dark
        root.style.setProperty(
          '--gradient-dark',
          `linear-gradient(180deg, hsl(${bgHsl.h} ${bgHsl.s}% ${bgHsl.l}%), hsl(${bgHsl.h} ${bgHsl.s}% ${Math.max(0, bgHsl.l - 5)}%))`
        );
      }
    } else {
      // Use defaults
      root.style.setProperty('--background', defaults.background);
      root.style.setProperty('--foreground', defaults.foreground);
      root.style.setProperty('--card', defaults.card);
      root.style.setProperty('--card-foreground', defaults.cardForeground);
      root.style.setProperty('--muted', defaults.muted);
      root.style.setProperty('--muted-foreground', defaults.mutedForeground);
      root.style.setProperty('--popover', defaults.popover);
      root.style.setProperty('--popover-foreground', defaults.popoverForeground);
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

    // Update document title
    if (branding.app_name) {
      // Only update if on home page or if title doesn't have a specific page name
      const currentTitle = document.title;
      if (!currentTitle || currentTitle === 'Drive 917' || currentTitle.includes('Drive917')) {
        document.title = branding.app_name;
      }
    }

  }, [branding, isDarkMode]);

  return { branding, isDarkMode };
}

export default useDynamicTheme;
