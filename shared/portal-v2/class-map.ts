/**
 * Operator semantic colour classes → their shared `v2-*` twins.
 *
 * `text-muted-foreground` → `text-v2-muted-fg`, `hover:bg-primary/80` →
 * `hover:bg-v2-primary/80`, `rounded-4xl` → `rounded-[var(--v2-radius-4xl,2rem)]`
 * (what the operator's `rounded-4xl` resolves to). Each twin computes to the
 * same colour inside `.v2-theme` and falls back to the semantic one outside it
 * (theme.json), so a mapped class list paints exactly as the original.
 *
 * Used by the operator's drift tests to prove a shared copy (search field,
 * filter panel, button styles) still equals the operator source it was made
 * from. Arbitrary values (`bg-[hsl(var(--v2-hover,var(--muted)))]`) are left
 * alone: they already name their own fallbacks.
 */

const COLOURS: ReadonlyArray<[string, string]> = [
  // Longest first, so `primary-foreground` is not read as `primary`.
  ["primary-foreground", "v2-primary-fg"],
  ["muted-foreground", "v2-muted-fg"],
  ["card-foreground", "v2-card-fg"],
  ["popover-foreground", "v2-popover-fg"],
  ["accent-foreground", "v2-accent-fg"],
  ["foreground", "v2-fg"],
  ["primary", "v2-primary"],
  ["muted", "v2-muted"],
  ["card", "v2-card"],
  ["popover", "v2-popover"],
  ["background", "v2-bg"],
  ["border", "v2-border"],
  ["ring", "v2-ring"],
  ["destructive", "v2-destructive"],
  ["input", "v2-input"],
];

const RADIUS_FALLBACK: Record<string, string> = { xl: "0.75rem", "2xl": "1rem", "3xl": "1.5rem", "4xl": "2rem" };

const PREFIXES ="text|bg|border|ring|outline|fill|stroke|divide|placeholder";

export function toSharedClasses(classes: string): string {
  return classes
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s*$/.test(token)) return token;
      const at = token.lastIndexOf(":");
      // The utility after the last variant colon, unless that colon sits inside [..].
      const variant = at >= 0 && !token.slice(at).includes("]") ? token.slice(0, at + 1) : "";
      let utility = variant ? token.slice(at + 1) : token;
      const bang = utility.startsWith("!") ? "!" : "";
      if (bang) utility = utility.slice(1);
      // The operator's radius ramp (tailwind.config.ts borderRadius): each step
      // reads its --v2-radius-* token with the Tailwind default as fallback.
      const radius = utility.match(/^(rounded(?:-[tblrse]{1,2})?)-(xl|2xl|3xl|4xl)$/);
      if (radius) {
        return `${variant}${bang}${radius[1]}-[var(--v2-radius-${radius[2]},${RADIUS_FALLBACK[radius[2]]})]`;
      }
      // lg / md / sm are --radius based (the shadcn steps). The customer site
      // has its own, larger --radius, so they read --v2-radius, falling back
      // to --radius outside the v2 theme.
      const small = utility.match(/^(rounded(?:-[tblrse]{1,2})?)-(lg|md|sm)$/);
      if (small) {
        const offset = { lg: "", md: "_-_2px", sm: "_-_4px" }[small[2] as "lg" | "md" | "sm"];
        const value = offset ? `calc(var(--v2-radius,var(--radius))${offset})` : "var(--v2-radius,var(--radius))";
        return `${variant}${bang}${small[1]}-[${value}]`;
      }
      for (const [from, to] of COLOURS) {
        const m = utility.match(new RegExp(`^(${PREFIXES})-${from}(\\/[\\w.[\\]]+)?$`));
        if (m) return `${variant}${bang}${m[1]}-${to}${m[2] ?? ""}`;
      }
      return token;
    })
    .join("");
}
