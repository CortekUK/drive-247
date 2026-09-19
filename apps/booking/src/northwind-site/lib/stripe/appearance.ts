import type { Appearance } from "@stripe/stripe-js";

/**
 * Making Stripe's card form look like the rest of the page.
 *
 * The Payment Element renders inside a cross-origin iframe, so NOTHING of ours
 * reaches it: not `globals.css`, not the `--brand-*` custom properties, not the
 * self-hosted DM Sans that `next/font` puts on the document. The only channel
 * is the Appearance API, which takes literal CSS values in a JSON object.
 *
 * That would normally mean copying a dozen hex codes out of `globals.css` and
 * watching them rot. Instead every colour below is READ OFF the live document
 * at mount time, so `globals.css` stays the one source of truth and a token
 * edit reaches the card form for free. If a token is ever renamed the read
 * returns empty, the whole branded block is skipped, and Stripe falls back to
 * its own neutral theme — an unbranded form, never a broken one.
 *
 * The tokens read here are all declared as literal hex in `globals.css`. That
 * matters: `getComputedStyle` on a custom property whose value is itself a
 * `var()` chain is not reliably substituted, so `--utility-danger` is read via
 * the `--extra-red-600` it points at.
 */

const TOKEN_NAMES = [
  "--brand-forest",
  "--brand-text",
  "--brand-text-soft",
  "--brand-text-subtle",
  "--brand-placeholder",
  "--brand-border",
  "--brand-border-soft",
  "--brand-stone",
  "--main-white",
  "--extra-red-600",
] as const;

type TokenName = (typeof TOKEN_NAMES)[number];
type BrandTokens = Record<TokenName, string>;

/** 12px — matches `text-xs`, the size every label in the booking form uses. */
const LABEL_SIZE = "12px";
/** 14px — `text-sm`, the size of every `FIELD_INPUT_CLASS` field beside it. */
const INPUT_SIZE = "14px";
/**
 * 12px of vertical padding on a 14px/20px line gives a 44px control, which is
 * the same height as `h-11` on our own inputs AND the touch-target floor the
 * rest of the booking form is built to. Do not shrink it.
 */
const INPUT_PADDING = "12px";
/** `rounded-md` = `calc(var(--radius) - 2px)` = 12px - 2px. */
const INPUT_RADIUS = "10px";

/**
 * DM Sans, fetched by the IFRAME.
 *
 * `next/font` self-hosts the family under our origin and exposes it as a CSS
 * variable — neither of which the iframe can see. Stripe's `fonts: [{ cssSrc }]`
 * is the documented way in, and it only accepts a public stylesheet URL. The
 * `system-ui` tail in `fontFamily` means a blocked or slow font request costs
 * the brand face, not the layout.
 */
const DM_SANS_CSS_SRC =
  "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap";

const FONT_STACK = "'DM Sans', system-ui, -apple-system, sans-serif";

/**
 * What Stripe gets when the tokens cannot be read — during SSR, or if a token
 * is renamed. Typography only: an unstyled-but-legible form.
 */
const FALLBACK_APPEARANCE: Appearance = {
  theme: "stripe",
  variables: {
    fontFamily: FONT_STACK,
    fontSizeBase: INPUT_SIZE,
    borderRadius: INPUT_RADIUS,
  },
};

function readBrandTokens(): BrandTokens | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  const computed = window.getComputedStyle(document.documentElement);
  const out: Partial<Record<TokenName, string>> = {};

  for (const name of TOKEN_NAMES) {
    const value = computed.getPropertyValue(name).trim();
    // One missing token means the palette moved. Take the neutral fallback
    // rather than shipping a form that is half-branded.
    if (value === "") return null;
    out[name] = value;
  }

  return out as BrandTokens;
}

/**
 * A 25%-opacity version of a `#rrggbb` token, or null if it is not one.
 *
 * Used for the focus ring, to match `focus-visible:ring-brand-forest/25` on our
 * own fields. `color-mix()` would be tidier but Stripe validates every value in
 * the appearance object and silently drops what it does not recognise, so the
 * literal 8-digit hex is the reliable spelling.
 */
function withQuarterAlpha(hex: string): string | null {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}40` : null;
}

/**
 * Build the Appearance for the booking payment form.
 *
 * Call it at mount, not at module scope — it reads the live document.
 */
export function buildBookingAppearance(): Appearance {
  const token = readBrandTokens();
  if (!token) return FALLBACK_APPEARANCE;

  const forest = token["--brand-forest"];
  const focusRing = withQuarterAlpha(forest);
  const focusShadow = focusRing === null ? "none" : `0 0 0 3px ${focusRing}`;

  return {
    // 'stripe' rather than 'flat': its base already puts a 1px border and a
    // white fill on every input, which is what our own fields do. 'flat' would
    // have to be un-flattened rule by rule.
    theme: "stripe",

    variables: {
      /* Type */
      fontFamily: FONT_STACK,
      fontSizeBase: INPUT_SIZE,
      fontWeightNormal: "400",
      fontWeightMedium: "500",
      fontWeightBold: "600",

      /* Colour */
      colorPrimary: forest,
      colorBackground: token["--main-white"],
      colorText: token["--brand-text"],
      colorTextSecondary: token["--brand-text-soft"],
      colorTextPlaceholder: token["--brand-placeholder"],
      colorDanger: token["--extra-red-600"],
      colorIcon: token["--brand-text-subtle"],
      colorIconTab: token["--brand-text-subtle"],
      colorIconTabSelected: forest,

      /* Shape */
      borderRadius: INPUT_RADIUS,
      spacingUnit: "4px",
      focusBoxShadow: focusShadow,
      focusOutline: "none",
    },

    rules: {
      ".Input": {
        border: `1px solid ${token["--brand-border"]}`,
        boxShadow: "none",
        padding: INPUT_PADDING,
        fontSize: INPUT_SIZE,
        lineHeight: "20px",
      },
      ".Input:hover": {
        borderColor: token["--brand-text-subtle"],
      },
      ".Input:focus": {
        borderColor: forest,
        boxShadow: focusShadow,
        outline: "none",
      },
      ".Input--invalid": {
        borderColor: token["--extra-red-600"],
        boxShadow: "none",
      },
      ".Label": {
        fontSize: LABEL_SIZE,
        fontWeight: "500",
        color: token["--brand-text-soft"],
        marginBottom: "6px",
      },
      ".Error": {
        fontSize: LABEL_SIZE,
        lineHeight: "16px",
        color: token["--extra-red-600"],
        marginTop: "6px",
      },
      /* The payment-method chooser (card / wallet / bank), when more than one
         is enabled on the account. Same pill-ish, borderless-until-selected
         treatment as `ModeCard` in the booking form. */
      ".Tab": {
        border: `1px solid ${token["--brand-border-soft"]}`,
        boxShadow: "none",
        color: token["--brand-text-soft"],
        // 44px: 12 + 12 + a 20px line, the same floor as the inputs.
        padding: INPUT_PADDING,
      },
      ".Tab:hover": {
        backgroundColor: token["--brand-stone"],
        color: token["--brand-text"],
      },
      ".Tab--selected": {
        border: `1px solid ${forest}`,
        boxShadow: focusShadow,
        color: token["--brand-text"],
      },
      ".TabLabel": {
        fontSize: LABEL_SIZE,
        fontWeight: "500",
      },
      ".CheckboxInput": {
        borderColor: token["--brand-border"],
      },
      ".CheckboxInput--checked": {
        backgroundColor: forest,
        borderColor: forest,
      },
    },
  };
}

/**
 * The `fonts` half of `<Elements options>`. Separate from the appearance
 * because Stripe takes them as sibling keys, not nested.
 */
export const BOOKING_ELEMENTS_FONTS = [{ cssSrc: DM_SANS_CSS_SRC }] as const;
