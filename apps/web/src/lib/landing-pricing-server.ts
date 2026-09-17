// Whether drive-247.com shows its pricing tier section.
//
// Controlled by the super-admin switch on the Signup Plans tab
// (`admin_settings.landing_pricing_enabled`). The team turns it on to test the
// live signup journey on the main domain and off again afterwards.
//
// Read through `public.landing_pricing_enabled()`, a security-definer function
// that returns that one boolean: `admin_settings` itself is authenticated-only
// and holds staff email addresses, so the anon key cannot and must not read it.
//
// FAILS CLOSED. Missing env, an HTTP error, a timeout or anything but a literal
// `true` hides the section, so an outage can never put an untested signup flow
// in front of the public. Cached for the same ~10s as the plan catalogue, so a
// flip reaches the page on the same schedule as a plan edit.

import { PLANS_REVALIDATE_SECONDS } from "@/lib/plans-server";

const FETCH_TIMEOUT_MS = 5000;

export async function fetchLandingPricingEnabled(): Promise<boolean> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) {
    console.error(
      "[landing-pricing] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set — " +
        "hiding the pricing section.",
    );
    return false;
  }

  try {
    // GET works because the function is STABLE, and it lets Next cache the read.
    const res = await fetch(
      `${baseUrl.replace(/\/$/, "")}/rest/v1/rpc/landing_pricing_enabled`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        next: { revalidate: PLANS_REVALIDATE_SECONDS },
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[landing-pricing] read failed (HTTP ${res.status}) — hiding the pricing section. ${detail.slice(0, 300)}`,
      );
      return false;
    }
    const body: unknown = await res.json();
    return body === true;
  } catch (error) {
    console.error("[landing-pricing] read failed — hiding the pricing section.", error);
    return false;
  }
}
