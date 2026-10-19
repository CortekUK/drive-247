// Which drive-247.com landing page is live: "v1" (current) or "v2" (redesign).
//
// Controlled by the super-admin switch on the Signup Plans tab
// (`admin_settings.landing_version`), read through `public.landing_version()`,
// a security-definer function that returns that one value — same shape and
// reasons as the other landing-page reads.
//
// FAILS TO v1. Missing env, an HTTP error, a timeout or anything but a literal
// "v2" serves the current page, so an outage can never put an unfinished
// redesign in front of the public.
//
// Read fresh on every request, so a flip shows on the very next page load.

import { cache } from "react";

export type LandingVersion = "v1" | "v2";

const FETCH_TIMEOUT_MS = 1500;

export const fetchLandingVersion = cache(async (): Promise<LandingVersion> => {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) return "v1";

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/rest/v1/rpc/landing_version`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[landing-version] read failed (HTTP ${res.status}) — serving v1. ${detail.slice(0, 300)}`);
      return "v1";
    }
    const body: unknown = await res.json();
    return body === "v2" ? "v2" : "v1";
  } catch (error) {
    console.error("[landing-version] read failed — serving v1.", error);
    return "v1";
  }
});

/**
 * `?landing=v1|v2` previews a version without flipping the switch, so the
 * redesign can be looked at on the real domain while v1 stays live.
 */
export function parseLandingPreview(value: string | undefined): LandingVersion | null {
  return value === "v1" || value === "v2" ? value : null;
}
