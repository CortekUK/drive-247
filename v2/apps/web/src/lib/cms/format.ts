import { formatMoney } from "@/components/fleet/format";

import type { PromoAccent } from "./types";

/**
 * Derivations that turn a `promotions` row into the four strings the promo
 * card renders, plus the grid helper the count-driven sections share.
 *
 * All of it lives here rather than in the sections because the SAME functions
 * run on the server (first paint) and in the browser (React Query refetch). If
 * the two derived different badges from the same row, hydration would mismatch
 * and React would throw away the server HTML.
 */

/** Accent ramp, cycled by position. Presentation only — no CMS field for it. */
const ACCENTS: readonly PromoAccent[] = ["amber", "forest", "stone", "deep"];

export function promoAccent(index: number): PromoAccent {
  return ACCENTS[index % ACCENTS.length];
}

/**
 * Fallback artwork, cycled the same way. `promotions.image_url` is nullable and
 * blank on plenty of real rows; a promo card with no image is a black box.
 */
const FALLBACK_IMAGES: readonly string[] = [
  "/booking_landingpage/promo-early-bird.jpg",
  "/booking_landingpage/promo-ev-explorer.jpg",
  "/booking_landingpage/promo-weekend-escape.jpg",
  "/booking_landingpage/promo-business-class.jpg",
];

export function promoImage(url: string | null | undefined, index: number): string {
  const trimmed = (url ?? "").trim();
  return trimmed === "" ? FALLBACK_IMAGES[index % FALLBACK_IMAGES.length] : trimmed;
}

/**
 * True for anything that is not a same-origin path.
 *
 * `next.config.ts` declares no `images.remotePatterns`, so `next/image` throws
 * on a remote host. An operator pasting a Supabase Storage URL into the portal
 * must not take the page down, so those render unoptimised instead.
 */
export function isRemoteImage(src: string): boolean {
  return !src.startsWith("/");
}

/** Drop a trailing amount so "Save 15%" reads "Save" above the big number. */
const TRAILING_AMOUNT = /\s*(?:[$£€]\s*)?\d[\d.,]*\s*%?\s*(?:off)?\s*$/i;

/** Separators an operator uses between a promo's name and its pitch. */
const TITLE_SPLIT = /\s+[—–|]\s+|\s+-\s+/;

/**
 * `promotions.title` is one free-text field ("Early Bird — Save 15%"), but the
 * card has two slots: a short pill and a label line above the discount.
 * Splitting on the dash recovers both; a title with no dash keeps the whole
 * string as the pill and falls back to a generic label.
 */
export function splitPromoTitle(title: string): { badge: string; label: string } {
  const parts = title.split(TITLE_SPLIT).map((part) => part.trim()).filter(Boolean);

  const badge = parts[0] ?? "Offer";
  const remainder = parts.slice(1).join(" — ");
  const stripped = remainder.replace(TRAILING_AMOUNT, "").trim();

  return { badge, label: stripped === "" ? "Save" : stripped };
}

export function formatDiscount(
  discountType: string,
  discountValue: number,
  currencyCode: string | null | undefined,
): string {
  if (!Number.isFinite(discountValue) || discountValue <= 0) return "Offer";

  const rounded = Number.isInteger(discountValue)
    ? String(discountValue)
    : discountValue.toFixed(2).replace(/0$/, "");

  switch (discountType.trim().toLowerCase()) {
    case "percentage":
    case "percent":
      return `${rounded}% OFF`;
    case "fixed":
    case "fixed_amount":
    case "amount":
      return `${formatMoney(discountValue, currencyCode)} OFF`;
    default:
      return `${rounded} OFF`;
  }
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

/**
 * "Valid till 31st December 2027", or "" when there is no end date.
 *
 * Formatted from the UTC parts, never the viewer's locale: `toLocaleDateString`
 * would render a different day on the server than in a browser west of UTC, and
 * that mismatch is a hydration error on every promo card.
 */
export function formatValidUntil(endDate: string | null | undefined): string {
  if (!endDate) return "";
  const parsed = new Date(endDate);
  if (Number.isNaN(parsed.getTime())) return "";
  return `Valid till ${ordinal(parsed.getUTCDate())} ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

/**
 * Column classes for a row whose length the OPERATOR decides.
 *
 * The shipped strips hardcoded `sm:grid-cols-4` (stats) and `lg:grid-cols-5`
 * (steps) because the fixtures had exactly that many items. A tenant with three
 * stats would have left a hole. Tailwind cannot build a class name at runtime,
 * so this is a lookup of complete, static strings.
 */
export function evenGridCols(count: number): string {
  switch (count) {
    case 1: return "grid-cols-1";
    case 2: return "grid-cols-1 sm:grid-cols-2";
    case 3: return "grid-cols-1 sm:grid-cols-3";
    case 4: return "grid-cols-1 sm:grid-cols-4";
    case 5: return "grid-cols-1 sm:grid-cols-3 lg:grid-cols-5";
    case 6: return "grid-cols-1 sm:grid-cols-3 lg:grid-cols-6";
    default: return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
  }
}
