// =============================================================================
// Brand colour extraction + palette builder (shared by create-sales-onboarding
// and extract-brand-colors).
//
// Turns George's free-text "Business Colours" answer ("Black and Gold
// minimalistic", "yellow and pink", "#047857 and white", "none preference")
// into a concrete set of tenants.* colour columns for BOTH light and dark
// themes. Uses OpenAI (forced tool-call, auto-logged) with a deterministic
// word/hex fallback so we never block provisioning on the model.
//
// The column mapping + dark-mode lightening is ported verbatim from
// scripts/tenant-onboarding.mjs so the runtime theme (portal + booking) renders
// identically to a script-onboarded tenant.
// =============================================================================

import { chatCompletion, type ToolDefinition } from "./openai.ts";

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
  palette: string[];
  style: string;
}

// Named-colour fallback map (mirrors scripts/tenant-onboarding.mjs COLOR_WORDS)
const COLOR_WORDS: Record<string, string> = {
  black: "#111111", white: "#FFFFFF", gray: "#6B7280", grey: "#6B7280", silver: "#9CA3AF",
  blue: "#2563EB", navy: "#1E3A8A", sky: "#0EA5E9", teal: "#0D9488", cyan: "#06B6D4",
  green: "#16A34A", lime: "#65A30D", emerald: "#059669", red: "#DC2626", crimson: "#B91C1C",
  orange: "#F97316", amber: "#F59E0B", yellow: "#EAB308", gold: "#D4AF37",
  purple: "#7C3AED", violet: "#8B5CF6", indigo: "#6366F1", pink: "#DB2777",
  brown: "#92400E", maroon: "#7F1D1D",
};

const DEFAULT_PALETTE: BrandColors = {
  primary: "#1E293B", secondary: "#334155", accent: "#6366F1", // pro slate + indigo
  palette: ["#1E293B", "#334155", "#6366F1"], style: "",
};

const NONE_RE = /^(none|default|no preference|none preference|any|tbd|n\/?a)/i;
const HEX_RE = /#[0-9a-fA-F]{6}/g;

function isBlankBranding(text: string | null | undefined): boolean {
  return !text || !text.trim() || NONE_RE.test(text.trim());
}

// -------- HSL helpers so dark-mode colours stay readable on a dark bg ---------
function hexToHsl(hex: string) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255,
    g = parseInt(h.slice(2, 4), 16) / 255,
    b = parseInt(h.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let hue = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    hue = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue *= 60;
  }
  return { h: hue, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const to = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`.toUpperCase();
}

// Lighten a brand colour enough to read as text/button on dark (#0B1120).
function lightenForDark(hex: string) {
  const { h, s, l } = hexToHsl(hex);
  const ns = s < 12 ? s : Math.max(s, 45); // near-grey stays grey; coloured stays vivid
  return hslToHex(h, ns, Math.max(l, 66)); // floor lightness so it's never dark-on-dark
}

function isHex6(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

// Deterministic fallback (no OpenAI): parse hex codes + mapped colour words.
function paletteFromWords(branding: string): BrandColors {
  const hexes = branding.match(HEX_RE) || [];
  const words = branding.toLowerCase().split(/[,\/&]|\sand\s|\s+/).map((w) => w.trim()).filter(Boolean);
  const mapped = words.map((w) => COLOR_WORDS[w]).filter(Boolean);
  const colors = [...hexes, ...mapped];
  if (!colors.length) return { ...DEFAULT_PALETTE };
  const nonWhite = colors.filter((c) => c.toUpperCase() !== "#FFFFFF");
  const primary = nonWhite[0] || colors[0];
  const accent = colors.find((c) => c !== primary) || primary;
  const secondary = nonWhite[1] || "#374151";
  return { primary, secondary, accent, palette: colors, style: "" };
}

const COLOR_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "record_brand_colors",
    description:
      "Convert a free-text brand colour/style description into concrete web hex colors.",
    parameters: {
      type: "object",
      properties: {
        primary: { type: "string", description: "Primary brand color as #RRGGBB hex." },
        secondary: { type: "string", description: "Secondary color as #RRGGBB hex." },
        accent: { type: "string", description: "Accent/highlight color as #RRGGBB hex." },
        palette: {
          type: "array",
          items: { type: "string" },
          description: "All distinct colors mentioned, each as #RRGGBB hex, ordered by prominence.",
        },
        style: { type: "string", description: "One or two words for the vibe (e.g. 'minimalistic'), or empty string." },
      },
      required: ["primary", "secondary", "accent", "palette"],
    },
  },
};

/**
 * Extract a { primary, secondary, accent, palette, style } set from free text.
 * Falls back to word/hex parsing (or the default palette) if the input is blank
 * or the OpenAI call fails — provisioning must never be blocked by branding.
 */
export async function extractBrandColorsFromText(
  description: string | null | undefined,
  tenantId?: string | null,
): Promise<BrandColors> {
  if (isBlankBranding(description)) return { ...DEFAULT_PALETTE };
  const text = description!.trim();

  try {
    const ai = await chatCompletion(
      [
        {
          role: "system",
          content:
            "You convert short brand descriptions into concrete web hex colors. " +
            "Map named or implied colors to sensible #RRGGBB values (e.g. gold -> #D4AF37, " +
            "pink -> #EC4899, navy -> #1E3A8A). Prefer the colors the text names; do not invent " +
            "colors the text does not imply. Always call the record_brand_colors tool. " +
            "Every color you return MUST be a valid 6-digit #RRGGBB hex.",
        },
        { role: "user", content: `Brand color description: "${text}"` },
      ],
      {
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 250,
        tools: [COLOR_TOOL],
        tool_choice: { type: "function", function: { name: "record_brand_colors" } },
      },
      { functionName: "extract-brand-colors", tenantId: tenantId ?? null, metadata: { description: text } },
    );

    const toolCall = ai.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("no tool call");
    const parsed = JSON.parse(toolCall.function.arguments) as Partial<BrandColors>;

    const wordFallback = paletteFromWords(text);
    const primary = isHex6(parsed.primary) ? parsed.primary!.toUpperCase() : wordFallback.primary;
    const secondary = isHex6(parsed.secondary) ? parsed.secondary!.toUpperCase() : wordFallback.secondary;
    const accent = isHex6(parsed.accent) ? parsed.accent!.toUpperCase() : wordFallback.accent;
    const palette = (Array.isArray(parsed.palette) ? parsed.palette : [])
      .filter(isHex6).map((c) => c.toUpperCase());
    return {
      primary,
      secondary,
      accent,
      palette: palette.length ? palette : [primary, secondary, accent],
      style: typeof parsed.style === "string" ? parsed.style : "",
    };
  } catch (err) {
    console.error("[brand-colors] OpenAI extraction failed, using word fallback:", err);
    return paletteFromWords(text);
  }
}

/**
 * Map { primary, secondary, accent } to the FULL set of tenants.* colour
 * columns (light + dark), matching scripts/tenant-onboarding.mjs exactly.
 */
export function buildTenantPalette(colors: Pick<BrandColors, "primary" | "secondary" | "accent">) {
  const { primary, secondary, accent } = colors;
  return {
    primary_color: primary,
    secondary_color: secondary,
    accent_color: accent,
    light_primary_color: primary,
    light_secondary_color: secondary,
    light_accent_color: accent,
    light_background_color: "#F8FAFC",
    light_header_footer_color: primary,
    dark_primary_color: lightenForDark(primary),
    dark_secondary_color: secondary,
    dark_accent_color: lightenForDark(accent),
    dark_background_color: "#0B1120",
    dark_header_footer_color: "#0F172A",
  };
}
