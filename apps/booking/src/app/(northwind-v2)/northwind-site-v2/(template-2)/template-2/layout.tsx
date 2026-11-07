import { Inter_Tight } from "next/font/google";

import { loadPageSections, resolveTenant } from "@nw/lib/cms/server";
import { Template2Footer } from "@nw/template-2/footer";
import { Template2Shell } from "@nw/template-2/shell";

/**
 * Template 2 ("Glass") — the booking site's second design, on a temporary
 * preview link (/template-2) while it is built. Components live in
 * src/northwind-site/template-2/; the glass materials in styles/site.css.
 *
 * Inter Tight, not site-v2's Manrope: the iOS-style glass wants a tighter,
 * lighter display face, and the two templates should not read as one site.
 */

const interTight = Inter_Tight({ subsets: ["latin"], variable: "--font-g2", display: "swap" });

export const metadata = { robots: { index: false, follow: false } };

export default async function Template2Layout({ children }: { children: React.ReactNode }) {
  const [siteSettings, tenant] = await Promise.all([loadPageSections("site-settings"), resolveTenant()]);
  const tenantName = tenant?.app_name || tenant?.company_name || null;
  return (
    <Template2Shell
      fontClass={interTight.variable}
      tenantName={tenantName}
      tenantLogoUrl={tenant?.logo_url?.trim() || null}
      siteSettings={siteSettings}
      footer={<Template2Footer tenantName={tenantName} tenantLogoUrl={tenant?.logo_url?.trim() || null} siteSettings={siteSettings} />}
    >
      {children}
    </Template2Shell>
  );
}
