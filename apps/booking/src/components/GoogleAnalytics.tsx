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
 * SECURITY: the ID is operator-controlled data rendered into a <script>, so it
 * is validated against a strict allow-list of Google tag formats (GA4 `G-`,
 * Google tag `GT-`, Ads `AW-`, GTM `GTM-`, legacy UA `UA-…-…`, DoubleClick
 * `DC-`). Anything that does not match is dropped — nothing arbitrary can reach
 * the script body, so a stray value cannot inject markup.
 */
const VALID_MEASUREMENT_ID = /^(G|GT|AW|UA|GTM|DC)-[A-Z0-9]+(-[A-Z0-9]+)?$/;

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
