/**
 * Curated portal themes.
 *
 * Why presets exist at all: a bare colour picker lets a tenant choose something
 * that makes their own portal unreadable, and the support ticket lands on us.
 * A preset is a complete, pre-checked palette — pick one, done in ten seconds.
 * The custom picker stays available underneath for the operator who insists.
 *
 * Deliberately schema-free: a preset is just a bundle of hex values written
 * into branding columns that already exist on `tenants`. Nothing here needs a
 * migration, and "which preset is active" is derived by matching the tenant's
 * saved colours back against this list (see `matchPreset`).
 */

import { sameColor } from "./color";

/**
 * The subset of tenant branding columns a theme owns.
 *
 * Logos, favicon, app name and every SEO field are excluded on purpose —
 * switching theme must never touch a tenant's identity, only its palette.
 */
export interface ThemePalette {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  light_primary_color: string;
  light_secondary_color: string;
  light_accent_color: string;
  light_background_color: string;
  dark_primary_color: string;
  dark_secondary_color: string;
  dark_accent_color: string;
  dark_background_color: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  /** One short line, written for a rental operator rather than a designer. */
  description: string;
  palette: ThemePalette;
}

/**
 * `light_*` drives the portal in light mode, `dark_*` in dark mode, and the
 * unprefixed trio is the fallback the booking site and older code paths read.
 * Every primary here has been checked to carry legible text on top.
 */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "drive-gold",
    name: "Drive Gold",
    description: "The classic Drive247 look — warm gold on deep green.",
    palette: {
      primary_color: "#C6A256",
      secondary_color: "#223331",
      accent_color: "#E9B63E",
      light_primary_color: "#A8863C",
      light_secondary_color: "#223331",
      light_accent_color: "#C6A256",
      light_background_color: "#FAFAF8",
      dark_primary_color: "#C6A256",
      dark_secondary_color: "#2F4542",
      dark_accent_color: "#E9B63E",
      dark_background_color: "#141F1E",
    },
  },
  {
    id: "indigo",
    name: "Indigo",
    description: "Clean and modern. Reads well in long working sessions.",
    palette: {
      primary_color: "#6366F1",
      secondary_color: "#1E1B4B",
      accent_color: "#818CF8",
      light_primary_color: "#4F46E5",
      light_secondary_color: "#312E81",
      light_accent_color: "#6366F1",
      light_background_color: "#F8FAFC",
      dark_primary_color: "#818CF8",
      dark_secondary_color: "#312E81",
      dark_accent_color: "#A5B4FC",
      dark_background_color: "#0F1117",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Confident blue. A safe choice for most rental brands.",
    palette: {
      primary_color: "#2563EB",
      secondary_color: "#0C2A5B",
      accent_color: "#38BDF8",
      light_primary_color: "#1D4ED8",
      light_secondary_color: "#0C2A5B",
      light_accent_color: "#0EA5E9",
      light_background_color: "#F8FAFC",
      dark_primary_color: "#60A5FA",
      dark_secondary_color: "#1E3A8A",
      dark_accent_color: "#38BDF8",
      dark_background_color: "#0B1220",
    },
  },
  {
    id: "emerald",
    name: "Emerald",
    description: "Fresh green. Pairs well with eco or EV fleets.",
    palette: {
      primary_color: "#059669",
      secondary_color: "#064E3B",
      accent_color: "#34D399",
      light_primary_color: "#047857",
      light_secondary_color: "#064E3B",
      light_accent_color: "#10B981",
      light_background_color: "#F7FBF9",
      dark_primary_color: "#34D399",
      dark_secondary_color: "#065F46",
      dark_accent_color: "#6EE7B7",
      dark_background_color: "#0B1614",
    },
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Neutral and understated. Lets your logo do the talking.",
    palette: {
      primary_color: "#334155",
      secondary_color: "#0F172A",
      accent_color: "#64748B",
      light_primary_color: "#1E293B",
      light_secondary_color: "#0F172A",
      light_accent_color: "#475569",
      light_background_color: "#F8FAFC",
      dark_primary_color: "#94A3B8",
      dark_secondary_color: "#1E293B",
      dark_accent_color: "#CBD5E1",
      dark_background_color: "#0B1120",
    },
  },
  {
    id: "crimson",
    name: "Crimson",
    description: "Bold red. High energy, strong on a dark sidebar.",
    palette: {
      primary_color: "#DC2626",
      secondary_color: "#450A0A",
      accent_color: "#F87171",
      light_primary_color: "#B91C1C",
      light_secondary_color: "#450A0A",
      light_accent_color: "#DC2626",
      light_background_color: "#FDF9F9",
      dark_primary_color: "#F87171",
      dark_secondary_color: "#7F1D1D",
      dark_accent_color: "#FCA5A5",
      dark_background_color: "#170B0B",
    },
  },
  {
    id: "violet",
    name: "Violet",
    description: "Premium and distinctive. Good for luxury fleets.",
    palette: {
      primary_color: "#7C3AED",
      secondary_color: "#2E1065",
      accent_color: "#A78BFA",
      light_primary_color: "#6D28D9",
      light_secondary_color: "#2E1065",
      light_accent_color: "#8B5CF6",
      light_background_color: "#FAF9FE",
      dark_primary_color: "#A78BFA",
      dark_secondary_color: "#4C1D95",
      dark_accent_color: "#C4B5FD",
      dark_background_color: "#120B1F",
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm orange. Friendly and approachable.",
    palette: {
      primary_color: "#EA580C",
      secondary_color: "#431407",
      accent_color: "#FB923C",
      light_primary_color: "#C2410C",
      light_secondary_color: "#431407",
      light_accent_color: "#EA580C",
      light_background_color: "#FEFAF7",
      dark_primary_color: "#FB923C",
      dark_secondary_color: "#7C2D12",
      dark_accent_color: "#FDBA74",
      dark_background_color: "#170D07",
    },
  },
];

/** The palette a tenant lands on if they hit "Reset to default". */
export const DEFAULT_PRESET_ID = "drive-gold";

export function getPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}

/**
 * Work out which preset (if any) the tenant's saved colours correspond to.
 *
 * Derived rather than stored: it keeps this whole feature migration-free, and
 * it self-heals if colours were set from the old branding tab or the admin
 * side. Only the three colours a human actually perceives are compared —
 * backgrounds are near-identical across presets and would cause false misses.
 */
export function matchPreset(
  branding: Partial<ThemePalette> | null | undefined
): ThemePreset | null {
  if (!branding) return null;
  return (
    THEME_PRESETS.find(
      (preset) =>
        sameColor(branding.primary_color, preset.palette.primary_color) &&
        sameColor(branding.light_primary_color, preset.palette.light_primary_color) &&
        sameColor(branding.dark_primary_color, preset.palette.dark_primary_color)
    ) ?? null
  );
}
