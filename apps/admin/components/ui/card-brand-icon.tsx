"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Card-network artwork for "payment method on file" surfaces.
 *
 * Drawn as inline SVG rather than loaded from /public or a CDN so it:
 *  - needs no network request (these render inside a paywalled billing screen
 *    that a tenant may be hitting precisely because something is failing),
 *  - survives `window.print()` on the receipt, where remote images routinely
 *    do not resolve in time to appear in the printed output,
 *  - scales to any size without a second asset, and
 *  - carries no dark/light-mode variant to keep in sync.
 *
 * The marks are recognisable simplifications, not pixel-exact trademark
 * reproductions — legible at 36×24, which is the size these actually render at.
 */

export type CardBrand =
  | "visa"
  | "mastercard"
  | "amex"
  | "discover"
  | "diners"
  | "jcb"
  | "unionpay"
  | "link"
  | "unknown";

/**
 * Stripe sends lowercase, underscore-free brands (`visa`, `mastercard`, `amex`,
 * `diners`, `discover`, `jcb`, `unionpay`, `link`, `unknown`), but the same
 * column is also written from Checkout and the Billing Portal, and older rows
 * carry display-cased values like "MasterCard" / "American Express". Normalise
 * on the way in so a casing difference never silently downgrades a known brand
 * to the generic card.
 */
const BRAND_ALIASES: Record<string, CardBrand> = {
  visa: "visa",
  visadebit: "visa",
  visaelectron: "visa",
  mastercard: "mastercard",
  mc: "mastercard",
  maestro: "mastercard",
  amex: "amex",
  americanexpress: "amex",
  discover: "discover",
  diners: "diners",
  dinersclub: "diners",
  jcb: "jcb",
  unionpay: "unionpay",
  chinaunionpay: "unionpay",
  link: "link",
};

const BRAND_NAMES: Record<CardBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  link: "Link",
  unknown: "Card",
};

export function normalizeCardBrand(brand?: string | null): CardBrand {
  if (!brand) return "unknown";
  return BRAND_ALIASES[brand.toLowerCase().replace(/[^a-z]/g, "")] ?? "unknown";
}

/**
 * Human label for a brand. An unrecognised brand keeps its own name rather than
 * being flattened to "Card" — a tenant paying with, say, an Eftpos card should
 * still see what we have on file, even though we have no artwork for it.
 */
export function cardBrandLabel(brand?: string | null): string {
  const normalized = normalizeCardBrand(brand);
  if (normalized !== "unknown") return BRAND_NAMES[normalized];
  if (!brand || brand.toLowerCase() === "unknown") return BRAND_NAMES.unknown;
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

/** "Visa •••• 4242" — for text-only contexts that cannot take the artwork. */
export function formatMaskedCard(
  brand?: string | null,
  last4?: string | null,
): string | null {
  if (!last4) return null;
  return `${cardBrandLabel(brand)} •••• ${last4}`;
}

/** True once the card's expiry month has fully passed. */
export function isCardExpired(
  expMonth?: number | null,
  expYear?: number | null,
): boolean {
  if (!expMonth || !expYear) return false;
  const now = new Date();
  // A card is valid through the LAST day of its expiry month, so compare
  // against the first instant of the following month.
  return new Date(expYear, expMonth, 1).getTime() <= now.getTime();
}

export function formatCardExpiry(
  expMonth?: number | null,
  expYear?: number | null,
): string | null {
  if (!expMonth || !expYear) return null;
  return `${String(expMonth).padStart(2, "0")}/${expYear}`;
}

// Locked with textLength/lengthAdjust below, so a missing webfont shifts glyph
// spacing but can never push a wordmark outside the card.
const FONT = "'DM Sans','Inter',system-ui,-apple-system,'Segoe UI',sans-serif";

const CARD_FILL = "#ffffff";
const CARD_STROKE = "#DDE1E8";

const Frame = ({ fill = CARD_FILL, stroke = CARD_STROKE }: { fill?: string; stroke?: string }) => (
  <rect x="0.5" y="0.5" width="35" height="23" rx="3" fill={fill} stroke={stroke} />
);

const BRAND_ART: Record<CardBrand, React.ReactNode> = {
  visa: (
    <>
      <Frame />
      <text
        x="18"
        y="16.2"
        textAnchor="middle"
        textLength="23"
        lengthAdjust="spacingAndGlyphs"
        fontFamily={FONT}
        fontSize="11"
        fontWeight="700"
        fontStyle="italic"
        fill="#1434CB"
      >
        VISA
      </text>
    </>
  ),

  mastercard: (
    <>
      <Frame />
      <circle cx="13.5" cy="12" r="7" fill="#EB001B" />
      <circle cx="22.5" cy="12" r="7" fill="#F79E1B" />
      {/* Lens where the two discs overlap. */}
      <path d="M18 6.64a7 7 0 0 1 0 10.72 7 7 0 0 1 0-10.72Z" fill="#FF5F00" />
    </>
  ),

  amex: (
    <>
      <Frame fill="#1F72CD" stroke="#1A66BB" />
      <text
        x="18"
        y="15.6"
        textAnchor="middle"
        textLength="24"
        lengthAdjust="spacingAndGlyphs"
        fontFamily={FONT}
        fontSize="8.5"
        fontWeight="700"
        fill="#ffffff"
      >
        AMEX
      </text>
    </>
  ),

  discover: (
    <>
      <Frame />
      <circle cx="28" cy="12" r="5" fill="#F26E21" />
      <text
        x="4"
        y="14"
        textAnchor="start"
        textLength="17"
        lengthAdjust="spacingAndGlyphs"
        fontFamily={FONT}
        fontSize="5.6"
        fontWeight="700"
        fill="#111827"
      >
        DISCOVER
      </text>
    </>
  ),

  diners: (
    <>
      <Frame />
      <circle cx="18" cy="12" r="7" fill="#0079BE" />
      <circle cx="18" cy="12" r="4.4" fill="#ffffff" />
      <path d="M18 7.6a4.4 4.4 0 0 1 0 8.8Z" fill="#0079BE" />
    </>
  ),

  jcb: (
    <>
      <Frame />
      <rect x="4.2" y="4.5" width="8.6" height="15" rx="1.8" fill="#0E4C96" />
      <rect x="13.7" y="4.5" width="8.6" height="15" rx="1.8" fill="#BE0028" />
      <rect x="23.2" y="4.5" width="8.6" height="15" rx="1.8" fill="#007B40" />
      {(["J", "C", "B"] as const).map((letter, i) => (
        <text
          key={letter}
          x={8.5 + i * 9.5}
          y="15"
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="8"
          fontWeight="700"
          fill="#ffffff"
        >
          {letter}
        </text>
      ))}
    </>
  ),

  unionpay: (
    <>
      <Frame />
      <path d="M8.3 4.5h7.4l-3.2 15H5.1Z" fill="#E21836" />
      <path d="M15.9 4.5h7.4l-3.2 15h-7.4Z" fill="#00447C" />
      <path d="M23.5 4.5h7.4l-3.2 15h-7.4Z" fill="#007B84" />
    </>
  ),

  link: (
    <>
      <Frame fill="#00D66F" stroke="#00C264" />
      <text
        x="18"
        y="15.6"
        textAnchor="middle"
        textLength="16"
        lengthAdjust="spacingAndGlyphs"
        fontFamily={FONT}
        fontSize="9"
        fontWeight="700"
        fill="#011E0F"
      >
        link
      </text>
    </>
  ),

  // Neutral placeholder in currentColor, so it reads correctly on both the light
  // and dark portal themes without a second variant.
  unknown: (
    <>
      <rect
        x="0.5"
        y="0.5"
        width="35"
        height="23"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
      />
      <rect x="0.5" y="6.5" width="35" height="4" fill="currentColor" fillOpacity="0.2" />
      <rect x="4" y="14" width="11" height="3" rx="1.5" fill="currentColor" fillOpacity="0.28" />
    </>
  ),
};

export function CardBrandIcon({
  brand,
  className,
  title,
}: {
  brand?: string | null;
  className?: string;
  /** Overrides the accessible name; defaults to the resolved brand. */
  title?: string;
}) {
  const normalized = normalizeCardBrand(brand);
  const label = title ?? cardBrandLabel(brand);

  return (
    <svg
      viewBox="0 0 36 24"
      role="img"
      aria-label={label}
      // 36×24 viewBox — h-6/w-9 keeps the aspect exact at the default size.
      className={cn("h-6 w-9 shrink-0", className)}
    >
      <title>{label}</title>
      {BRAND_ART[normalized]}
    </svg>
  );
}

/**
 * The full "card on file" block: artwork, masked number and expiry.
 *
 * Used by every surface that shows the subscription's payment method, so the
 * portal cannot drift into three different renderings of the same fact.
 */
export function CardOnFile({
  brand,
  last4,
  expMonth,
  expYear,
  className,
  iconClassName,
}: {
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  className?: string;
  iconClassName?: string;
}) {
  if (!last4) return null;

  const expiry = formatCardExpiry(expMonth, expYear);
  const expired = isCardExpired(expMonth, expYear);

  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <CardBrandIcon brand={brand} className={iconClassName} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          <span className="sr-only">{cardBrandLabel(brand)} ending in {last4}</span>
          <span aria-hidden="true" className="tabular-nums">
            •••• •••• •••• {last4}
          </span>
        </p>
        {expiry && (
          <p
            className={cn(
              "text-xs",
              // An expired card is not trivia on this screen — it is the reason
              // the next renewal is going to fail, and the Update button is
              // right beside it.
              expired ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {expired ? `Expired ${expiry}` : `Expires ${expiry}`}
          </p>
        )}
      </div>
    </div>
  );
}
