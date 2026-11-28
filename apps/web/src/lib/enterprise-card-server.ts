// The Enterprise card on the pricing grid: always last, contact only, edited on
// the admin Signup Plans page (admin_settings.enterprise_card), read through
// `public.public_enterprise_card()` so the public site never reads the table.
//
// Never throws: any failure, or the card being switched off, returns null and
// the grid simply shows the plans without it.

import { PLANS_REVALIDATE_SECONDS } from "@/lib/plans-server";

export interface EnterpriseCard {
  name: string;
  fleetBand: string;
  priceLabel: string;
  tagline: string;
  ctaLabel: string;
  ctaHref: string;
  bullets: string[];
}

const FETCH_TIMEOUT_MS = 3000;

/**
 * The card as the admin_settings migration seeds it (20261017150000). Shown when
 * the database has no settings row at all, which is the case on staging: the
 * card belongs on the grid (Ghulam, review 1, V1), and an empty settings table
 * is not "switched off". A row with is_visible false still hides it.
 */
export const DEFAULT_ENTERPRISE_CARD: EnterpriseCard = {
  name: "Enterprise",
  fleetBand: "40+ vehicles",
  priceLabel: "Let's talk",
  tagline: "For large and multi-location fleets that need custom terms.",
  ctaLabel: "Contact us",
  ctaHref: "/strategy-call",
  bullets: [
    "Sized for fleets of 40+ vehicles",
    "Custom pricing and contract terms",
    "Hands-on onboarding and data migration",
    "Priority support with a named contact",
  ],
};

/** Only a site path, an https link or a mailto reaches an href. */
function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^\/[^\s]*$/.test(v) || /^https:\/\/[^\s]+$/.test(v) || /^mailto:[^\s@]+@[^\s@]+$/.test(v) ? v : null;
}

export async function fetchEnterpriseCard(): Promise<EnterpriseCard | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) return null;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/rest/v1/rpc/public_enterprise_card`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      next: { revalidate: PLANS_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    // No settings row (staging): the default card, not nothing.
    if (raw === null) return DEFAULT_ENTERPRISE_CARD;
    if (typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (r.is_visible === false) return null;
    const str = (k: string): string => (typeof r[k] === "string" ? (r[k] as string).trim() : "");
    const href = safeHref(r.cta_href);
    if (!str("name") || !href) return null;
    return {
      name: str("name"),
      fleetBand: str("fleet_band"),
      priceLabel: str("price_label") || "Let's talk",
      tagline: str("tagline"),
      ctaLabel: str("cta_label") || "Contact us",
      ctaHref: href,
      bullets: Array.isArray(r.bullets)
        ? r.bullets.filter((b): b is string => typeof b === "string" && b.trim() !== "")
        : [],
    };
  } catch {
    return null;
  }
}
