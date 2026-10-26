import { Manrope } from "next/font/google";

import { loadBlogEnabled, loadPageSections, resolveTenant } from "@nw/lib/cms/server";
import { SiteV2Footer } from "@nw/site-v2/site-footer";
import { SiteV2Shell } from "@nw/site-v2/site-shell";

/**
 * Northwind booking site v2 — the public pages' frame (header, footer, brand
 * wash), in the operator portal v2's design language. Components live in
 * src/northwind-site/site-v2/. The customer portal v2 (portal-v2/) has its own
 * frame and is not under this group.
 *
 * Seeds the same three reads v1's (booking)/layout.tsx does, for the same
 * reasons: the logo and the name in the first HTML (no flash of a placeholder),
 * and no Blog link while the operator has the blog switched off. All three are
 * `cache()`d, so the footer's own reads on this request cost nothing extra.
 */

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export default async function SiteV2Layout({ children }: { children: React.ReactNode }) {
  const [siteSettings, tenant, blogEnabled] = await Promise.all([
    loadPageSections("site-settings"),
    resolveTenant(),
    loadBlogEnabled(),
  ]);
  const tenantName = tenant?.app_name || tenant?.company_name || null;

  return (
    <SiteV2Shell
      fontClass={manrope.variable}
      tenantName={tenantName}
      tenantLogoUrl={tenant?.logo_url?.trim() || null}
      siteSettings={siteSettings}
      blogEnabled={blogEnabled}
      footer={<SiteV2Footer tenantName={tenantName} />}
    >
      {children}
    </SiteV2Shell>
  );
}
