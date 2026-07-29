"use client";

import Script from "next/script";
import { useTenant } from "@/contexts/TenantContext";

/**
 * Injects the tenant's own Google tag (gtag.js) into the booking site.
 *
 * The measurement ID is set per-tenant in the portal (Settings → SEO). When
 * present, this loads gtag.js and runs the standard config snippet, which
 * defines `window.gtag` — the function the booking flow's existing
 * gtag('event', 'checkout_submitted', ...) etc. calls rely on. Without a
 * configured ID this renders nothing and those event calls stay inert (they are
 * already guarded by `if (window.gtag)`), so analytics is strictly opt-in.
 *
 * Deliberately GA4-only. This loader is gtag.js, which serves GA4 measurement
 * ids (`G-…`) and the unified Google tag (`GT-…`). It does NOT bootstrap a Google
 * Tag Manager container (`GTM-…` needs gtm.js), and Universal Analytics (`UA-…`)
 * was shut down in 2023 — accepting those would inject a script that loads and
 * defines window.gtag but forwards ZERO data, which reads to the operator as
 * "it's set up" while nothing is tracked. So we accept only what this pipeline
 * actually reports through.
 *
 * SECURITY: the ID is operator-controlled data interpolated into a <script>, so
 * it is validated against this strict allow-list (after trim + toUpperCase).
 * Anything that does not match is dropped — every accepted value is [A-Z0-9-]
 * plus a fixed prefix, so nothing arbitrary can reach the script body.
 */
const VALID_MEASUREMENT_ID = /^(G|GT)-[A-Z0-9]+$/;

export function GoogleAnalytics() {
  const { tenant } = useTenant();

  const raw = (tenant as { ga_measurement_id?: string | null } | null)
    ?.ga_measurement_id;
  const id = raw?.trim().toUpperCase();

  if (!id || !VALID_MEASUREMENT_ID.test(id)) {
    return null;
  }

  return (
    <>
      <Script
        id="ga-lib"
        src={`https://www.googletagmanager.com/gtag/js?id=${id}`}
        strategy="afterInteractive"
        onError={() => {
          // Almost always a client-side ad/tracking blocker, not a
          // misconfiguration — window.gtag is still defined by ga-init, so
          // events "fire" but never reach Google. Logging it lets support tell
          // "blocked by the visitor" apart from "wrong ID / not configured".
          // Validate a live tag in a clean browser via GA4 Realtime, not by
          // checking typeof window.gtag.
          console.warn(
            `[GoogleAnalytics] gtag.js for ${id} failed to load — likely blocked by a browser extension or privacy setting.`
          );
        }}
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${id}');`}
      </Script>
    </>
  );
}
