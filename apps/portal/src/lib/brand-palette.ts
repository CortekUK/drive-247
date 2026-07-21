// =============================================================================
// Brand palette — dark-mode derivation (portal copy).
//
// WHY THIS FILE EXISTS / WHY IT MUST STAY IN LOCKSTEP
// ---------------------------------------------------
// When a tenant is provisioned (sales onboarding / `extract-brand-colors`), the
// dark_* colour columns are derived from the light_* ones by
// `buildTenantPalette()` in `supabase/functions/_shared/brand-colors.ts`
// (itself ported verbatim from `scripts/tenant-onboarding.mjs`).
//
// The portal's Branding settings UI needs the SAME derivation client-side so it
// can:
//   1. auto-fill / keep-in-sync the dark colour when an operator edits a light
//      colour, and
//   2. tell whether an existing dark_* value is still the auto-derived one
//      (safe to overwrite) or something the operator deliberately picked
//      (must not be clobbered).
//
// This matters because the BOOKING site renders in dark mode and therefore
// reads the dark_* columns. An operator who edits only "Light Accent" sees no
// change on booking — the silent no-op this module exists to prevent.
//
// Portal cannot import Deno edge-function code, so the maths is duplicated.
// IF YOU CHANGE THE LIGHTENING RULE IN `_shared/brand-colors.ts`, CHANGE IT
// HERE TOO — otherwise the portal will believe hand-picked dark colours are
// auto-derived (and overwrite them), or believe auto-derived colours are
// hand-picked (and refuse to sync them).
//
// Pure functions only. No imports, no app/state dependencies.
//
// Sanity check (real prod data, tenant 'haseeb-rentals') — note these derive
// from the BASE columns, not the light ones, because the light values were
// edited after provisioning (see `isAutoDerivedDark` for why that matters):
//   lightenForDark('#2563EB') === '#608DF0'   // accent_color  -> dark_accent
//   lightenForDark('#008000') === '#52FF52'   // primary_color -> dark_primary
// =============================================================================

/** Fields whose dark counterpart is derived from the light value. */
export type BrandField = "primary" | "secondary" | "accent";

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

/** True when `v` is a valid 6-digit `#RRGGBB` string (leading/trailing space ok). */
function isHex6(v: unknown): v is string {
  return typeof v === "string" && HEX6_RE.test(v.trim());
}

// ---- HSL helpers (verbatim port of _shared/brand-colors.ts) ------------------

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let h = hex.replace("#", "");
  // NOTE: this 3-digit-hex branch is unreachable from this module — every caller
  // goes through `isHex6()`, whose /^#[0-9a-fA-F]{6}$/ rejects `#abc` first. It
  // is kept verbatim for line-for-line parity with the edge-function source
  // (`_shared/brand-colors.ts`); delete it there before deleting it here.
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

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const to = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`.toUpperCase();
}

// ---- Public API -------------------------------------------------------------

/**
 * Lighten a brand colour enough to read as text/button on a dark background
 * (booking/portal dark surface is `#0B1120`).
 *
 * Rule (identical to `_shared/brand-colors.ts`):
 *   - saturation: near-greys (< 12%) stay grey; anything coloured is floored at 45%
 *   - lightness: floored at 66% so it is never dark-on-dark
 *
 * Returns the input unchanged if it is not a valid 6-digit hex, so callers can
 * pass through whatever is in the DB without guarding first.
 *
 * NOT IDEMPOTENT — `lightenForDark(lightenForDark(x)) !== lightenForDark(x)` for
 * roughly 19% of the RGB cube (measured: 19.1% over 100k uniform-random colours).
 * The HSL round-trip re-quantises to 8 bits per channel, so a colour that already
 * satisfies the s>=45 / l>=66 floors can still drift by a step on re-derivation.
 * Therefore NEVER feed an already-derived dark value back into `deriveDark()` —
 * always derive from the light (or base) colour, never from the current dark.
 */
export function lightenForDark(hex: string): string {
  if (!isHex6(hex)) return hex;
  const { h, s, l } = hexToHsl(hex.trim());
  const ns = s < 12 ? s : Math.max(s, 45); // near-grey stays grey; coloured stays vivid
  return hslToHex(h, ns, Math.max(l, 66)); // floor lightness so it's never dark-on-dark
}

/**
 * Derive the dark-theme value for `field` from its light-theme value.
 *
 * MIRRORS `buildTenantPalette()` EXACTLY:
 *   - `primary`   -> lightenForDark(light)
 *   - `accent`    -> lightenForDark(light)
 *   - `secondary` -> light, UNCHANGED (buildTenantPalette does NOT lighten it)
 *
 * The secondary asymmetry is deliberate — do not "fix" it here without also
 * changing `_shared/brand-colors.ts`, or every existing tenant's secondary will
 * read as hand-picked and stop syncing.
 */
export function deriveDark(field: BrandField, lightHex: string): string {
  if (field === "secondary") return lightHex;
  return lightenForDark(lightHex);
}

/**
 * Is the stored dark value still the auto-derived one (i.e. safe to update when
 * the operator edits the light colour), or did someone deliberately choose it?
 *
 * True when:
 *   - `darkHex` is null/undefined/empty/whitespace (nothing chosen yet), OR
 *   - `darkHex` equals `deriveDark(field, lightHex)` (case-insensitive), OR
 *   - `baseHex` was supplied and `darkHex` equals `deriveDark(field, baseHex)`.
 *
 * WHY THE BASE COMPARISON EXISTS (do not remove it):
 * At provisioning time onboarding writes ONE extracted colour into BOTH the base
 * column (`primary_color`) and the light column (`light_primary`), then derives
 * dark from that single value. The two comparisons are equivalent while the row
 * is untouched. But the moment an operator edits the LIGHT colour on its own,
 * `light_*` drifts away from `base_*` and the light comparison stops matching —
 * even though the dark value is still 100% machine-generated and has never been
 * touched by a human. After that drift the base comparison is the ONLY remaining
 * evidence that the dark was auto-generated. Checking light alone made the
 * save-time sync a permanent no-op for exactly the tenants who edited their
 * light colours — i.e. the ones who reported the bug.
 *
 * Real prod row, tenant 'haseeb-rentals' (base / light / dark):
 *   primary   #008000 / #84CC16 / #52FF52  -> deriveDark(base) = #52FF52  => TRUE  (auto)
 *   accent    #2563EB / #F97316 / #608DF0  -> deriveDark(base) = #608DF0  => TRUE  (auto)
 *   secondary #EF4444 / #EF4444 / #0000FF  -> neither matches #EF4444     => FALSE (hand-picked)
 *
 * False (= hand-picked, leave alone) in every other case — including when
 * NEITHER `lightHex` nor `baseHex` is provided: with no reference colour we
 * cannot prove a derivation, so we assume deliberate intent and never clobber.
 *
 * `baseHex` is optional only for backwards compatibility; pass it whenever the
 * base column is in hand, which is every real call site.
 */
export function isAutoDerivedDark(
  field: BrandField,
  darkHex: string | null | undefined,
  lightHex: string | null | undefined,
  baseHex?: string | null | undefined,
): boolean {
  const dark = typeof darkHex === "string" ? darkHex.trim() : "";
  if (!dark) return true;
  const target = dark.toLowerCase();

  const light = typeof lightHex === "string" ? lightHex.trim() : "";
  if (light && target === deriveDark(field, light).toLowerCase()) return true;

  const base = typeof baseHex === "string" ? baseHex.trim() : "";
  if (base && target === deriveDark(field, base).toLowerCase()) return true;

  return false;
}
