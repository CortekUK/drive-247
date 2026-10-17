import { Manrope } from "next/font/google";

import { resolveTenant } from "@nw/lib/cms/server";
import { SiteV2Shell } from "@nw/site-v2/site-shell";

/**
 * Northwind booking site v2 — the public pages' frame (header, footer, brand
 * wash), in the operator portal v2's design language. Components live in
 * src/northwind-site/site-v2/. The customer portal v2 (portal-v2/) has its own
 * frame and is not under this group.
 */

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export default async function SiteV2Layout({ children }: { children: React.ReactNode }) {
  const tenant = await resolveTenant();
  const tenantName = tenant?.app_name || tenant?.company_name || null;

  return (
    <SiteV2Shell fontClass={manrope.variable} tenantName={tenantName}>
      {children}
    </SiteV2Shell>
  );
}
