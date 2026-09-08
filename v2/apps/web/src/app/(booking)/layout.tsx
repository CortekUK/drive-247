import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { loadBlogEnabled, loadPageSections, resolveTenant } from "@/lib/cms/server";

export default async function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /**
   * The header's logo, fetched on the SERVER.
   *
   * `BrandMark` is a client component, so on its own its first render has no
   * CMS data and it paints the shipped asterisk, swapping to the operator's
   * logo only after hydration — a visible flash of OUR mark on every page load,
   * and nothing at all in the HTML a crawler reads. Seeding it is the same
   * trick `fleet-seed.ts` uses for the vehicle list.
   *
   * `loadPageSections` is wrapped in React's `cache()`, so the footer's own
   * read of `site-settings` on this same request costs nothing extra.
   */
  const [siteSettings, tenant, blogEnabled] = await Promise.all([
    loadPageSections("site-settings"),
    /* The name is the header's fallback when there is no logo, and it comes
       from the tenant record rather than the CMS — so it needs seeding too, or
       the server renders the placeholder glyph and only swaps to the name once
       the client tenant context arrives. Cached, so this is not a second
       query. */
    resolveTenant(),
    /* "Show blog on website". The header must not link to a section the
       operator has switched off — and /blog 404s in that state, so a link
       would be a dead one. */
    loadBlogEnabled(),
  ]);
  const tenantName = tenant?.app_name || tenant?.company_name || null;

  return (
    <div className="flex min-h-svh flex-col">
      <Navbar siteSettings={siteSettings} tenantName={tenantName} blogEnabled={blogEnabled} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
