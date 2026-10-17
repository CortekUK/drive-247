import { Footer } from "@nw/components/layout/footer";
import { Navbar } from "@nw/components/layout/navbar";
import { DEFAULT_HOME_HERO } from "@nw/lib/cms/defaults";
import { loadBlogEnabled, loadPageSections, loadSection, resolveTenant } from "@nw/lib/cms/server";

import { InviteRegistration } from "./_components/invite-registration";

/**
 * A customer invite link — `/register/<token>` — in the NEW booking design.
 *
 * Oct 7 2026 (Ghulam: "Northwind themed, a full blown page, max effort"): a
 * real page of the operator's site rather than a card on a blank background —
 * the site's own navbar and footer around a hero, the sign-up card, why an
 * account helps, and a few quick answers. The navbar, footer and hero car are
 * the same ones every other page of this site uses, so the page is in the
 * operator's colours, logo and photography with nothing new to configure.
 *
 * The operator sends this from Customers → Invite. The original design's page
 * (`(legacy)/register/[token]`) still serves every other tenant, unchanged;
 * northwind reaches this one because `register` is no longer in
 * ORIGINAL_ONLY_SEGMENTS (lib/booking-design.ts).
 *
 * Same edge functions, same order, same payloads as the original page:
 * validate-customer-invite → (optional) create-ai-verification-session and a
 * poll of identity_verifications → submit-customer-registration. Only the
 * presentation is new.
 */
export const metadata = { title: "You're invited" };

export default async function RegisterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // The same three reads the (booking) layout makes for its navbar — all
  // `cache()`d, so the footer's own read of site-settings costs nothing extra.
  const [siteSettings, tenant, blogEnabled, hero] = await Promise.all([
    loadPageSections("site-settings"),
    resolveTenant(),
    loadBlogEnabled(),
    loadSection("home", "home_hero", DEFAULT_HOME_HERO),
  ]);
  const tenantName = tenant?.app_name || tenant?.company_name || null;

  return (
    <div className="flex min-h-svh flex-col bg-brand-cream">
      <Navbar siteSettings={siteSettings} tenantName={tenantName} blogEnabled={blogEnabled} />
      <main className="flex-1">
        <InviteRegistration
          token={token}
          companyFallback={tenantName}
          heroImage={hero.hero_image || DEFAULT_HOME_HERO.hero_image}
          heroImageAlt={hero.hero_image_alt || DEFAULT_HOME_HERO.hero_image_alt}
        />
      </main>
      <Footer />
    </div>
  );
}
