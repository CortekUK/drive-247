// Whether drive-247.com shows its pricing tier section.
//
// Controlled by the super-admin switch on the Signup Plans tab
// (`admin_settings.landing_pricing_enabled`). The team turns it on to test the
// live signup journey on the main domain and off again afterwards.
//
// Read through `public.landing_pricing_enabled()`, a security-definer function
// that returns that one boolean. `admin_settings` holds staff email addresses
// and is meant to be staff-only (its policies say so, though RLS is currently
// disabled on it in production), so the public site never reads the table.
//
// FAILS CLOSED. Missing env, an HTTP error, a timeout or anything but a literal
// `true` hides the section, so an outage can never put an untested signup flow
// in front of the public.
//
// READ FRESH ON EVERY REQUEST (`cache: "no-store"`), which renders the landing
// page per request. It used to share the plan catalogue's 10-second ISR window,
// and Vercel serves the STALE copy to the first visitor after that window: an
// admin flipped the switch, reloaded once, still saw the old page and reported
// the toggle as broken. Now a flip shows on the very next page load. The plan
// catalogue keeps its own 10-second cache; only this one boolean is uncached.
//
// The timeout is short on purpose: this read now sits in front of every landing
// page render, so a slow Supabase must cost at most 1.5s and then hide pricing,
// never hang the page.

const FETCH_TIMEOUT_MS = 1500;

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
    // GET works because the function is STABLE.
    const res = await fetch(
      `${baseUrl.replace(/\/$/, "")}/rest/v1/rpc/landing_pricing_enabled`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
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
