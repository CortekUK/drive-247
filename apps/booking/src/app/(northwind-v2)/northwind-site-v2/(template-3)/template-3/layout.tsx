import { Hanken_Grotesk, Instrument_Serif } from "next/font/google";

import { loadPageSections, resolveTenant } from "@nw/lib/cms/server";
import { Template3Shell } from "@nw/template-3/shell";

/**
 * Template 3 ("Cinematic") — the booking site's third design, on a temporary
 * preview link (/template-3) while it is built. Components live in
 * src/northwind-site/template-3/.
 *
 * Light, quiet and type-led: a tall thin serif for statements, a plain grotesk
 * for everything you read or press, and one accent in the tenant's brand
 * colour. The movement comes from the scroll, never from decoration.
 */

const display = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-t3-display",
  display: "swap",
});
const body = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-t3-body", display: "swap" });

export const metadata = { robots: { index: false, follow: false } };

export default async function Template3Layout({ children }: { children: React.ReactNode }) {
  const [siteSettings, tenant] = await Promise.all([loadPageSections("site-settings"), resolveTenant()]);
  return (
    <Template3Shell
      fontClass={`${display.variable} ${body.variable}`}
      tenantName={tenant?.app_name || tenant?.company_name || null}
      tenantLogoUrl={tenant?.logo_url?.trim() || null}
      siteSettings={siteSettings}
    >
      {children}
    </Template3Shell>
  );
}
