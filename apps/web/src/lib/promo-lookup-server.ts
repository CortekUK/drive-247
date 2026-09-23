import { headers } from "next/headers";
import type { PromoOffer } from "@/lib/promo-offer";

/**
 * Server-side: what a Drive247 promo / referral code gives, or null if it is
 * not usable. Never throws — the landing page must render with or without it.
 *
 * The visitor's own IP is forwarded, so the lookup's per-IP rate limit counts
 * visitors rather than this server (every page render comes from our host).
 */
export async function lookupPromoOffer(code: string, planKey?: string): Promise<PromoOffer | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || !code) return null;
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "";
    const res = await fetch(`${url}/functions/v1/promo-code-lookup`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
        ...(ip ? { "x-forwarded-for": ip } : {}),
      },
      body: JSON.stringify({ code, ...(planKey ? { planKey } : {}) }),
      cache: "no-store",
    });
    const body = await res.json();
    return body?.valid === true ? (body as PromoOffer) : null;
  } catch {
    return null;
  }
}
