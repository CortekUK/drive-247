"use client";

import { BookingSection } from "./d7-booking";
import { CtaBand, Footer } from "./d7-close";
import { Fleet, Ticker } from "./d7-fleet";
import { Hero } from "./d7-hero";
import { Cursor, SmoothScroll } from "./d7-motion";
import { D7Nav } from "./d7-nav";
import { OffersRow } from "./d7-offers";
import { ScrollProgress } from "./d7-ui";
import { WhyChoose } from "./d7-why";
import { footerColumns } from "./d7-data";
import { useHasFaqs } from "@/hooks/useHasFaqs";
import { useD7Content } from "./use-d7-content";
import "./v2.css";

/**
 * booking-v2 landing.
 *
 * The design is fixed; the content is the tenant's. Every string, vehicle,
 * rate, review and contact detail comes from `useD7Content` — the same CMS
 * rows, tenant record and tables the legacy home page reads — so this page is
 * a re-skin of a tenant's home page, not a brochure about someone else.
 *
 * The `#booking` section runs the real MultiStepBookingWidget. That matters:
 * `next.config.ts` redirects /booking here because the home-page widget is the
 * only booking path in this app, so a home page without it cannot take money.
 *
 * hero + promise strip → trust ticker → fleet rail → why choose →
 * booking flow → offer + reviews → cta → footer
 *
 * Everything is namespaced under `.d7`, which also remaps the shadcn tokens the
 * booking widget is styled from, so the embedded widget adopts this palette.
 */
export default function BookingV2Landing() {
  const c = useD7Content();
  const hasFaqs = useHasFaqs();

  const services = (c.services.services ?? []) as { icon?: string; title: string; description?: string }[];

  const avgRating = c.reviews.length
    ? c.reviews.reduce((sum, r) => sum + r.stars, 0) / c.reviews.length
    : null;

  /* Only the channels this tenant actually filled in. */
  const contact = [
    (c.contact.phone_number || c.tenant?.phone) && {
      icon: "phone", label: "Call us",
      value: (c.contact.phone_number || c.tenant?.phone) as string,
      href: `tel:${String(c.contact.phone_number || c.tenant?.phone).replace(/[^+\d]/g, "")}`,
    },
    (c.contact.email || c.tenant?.contact_email) && {
      icon: "mail", label: "Email us",
      value: (c.contact.email || c.tenant?.contact_email) as string,
      href: `mailto:${c.contact.email || c.tenant?.contact_email}`,
    },
    c.tenant?.address && { icon: "pin", label: "Visit us", value: c.tenant.address },
  ].filter(Boolean) as { icon: string; label: string; value: string; href?: string }[];

  const socials = [
    c.tenant?.facebook_url && { name: "facebook", href: c.tenant.facebook_url },
    c.tenant?.instagram_url && { name: "instagram", href: c.tenant.instagram_url },
    c.tenant?.twitter_url && { name: "x", href: c.tenant.twitter_url },
    c.tenant?.linkedin_url && { name: "linkedin", href: c.tenant.linkedin_url },
  ].filter(Boolean) as { name: string; href: string }[];

  /* The `.d7` wrapper, fonts and theme restore come from D7SiteShell in the
     root layout, which covers every page — not just this one. */
  return (
    <>
      <Cursor>
        <SmoothScroll />
        <ScrollProgress />

        <D7Nav
          appName={c.appName}
          logoUrl={c.logoUrl}
          phone={c.hero.phone}
          bookCta={c.hero.bookCta}
        />

        <main>
          <Hero content={c.hero} appName={c.appName} services={services} promo={c.promo} />

          <Ticker />

          {c.hasVehicles && (
            <Fleet vehicles={c.vehicles} currency={c.tenant?.currency_code ?? null} />
          )}

          <WhyChoose
            services={c.services}
            vehicleCount={c.vehicles.length}
            reviewCount={c.reviews.length}
            avgRating={avgRating}
          />

          {/* the real booking flow */}
          <BookingSection
            title={c.bookingHeader.title}
            subtitle={c.bookingHeader.subtitle}
            trustPoints={c.bookingHeader.trust_points}
          />

          <OffersRow
            promo={c.promo}
            reviews={c.reviews}
            reviewsTitle={c.testimonialsHeader.title}
            bookCta={c.hero.bookCta}
          />

          <CtaBand cta={c.cta} image={c.hero.still} bookCta={c.hero.bookCta} />
        </main>

        <Footer
          appName={c.appName}
          logoUrl={c.darkLogoUrl}
          blurb={c.contact.description || c.hero.subheading}
          contact={contact}
          socials={socials}
          columns={footerColumns({ hasFaqs, blogEnabled: !!c.tenant?.blog_enabled })}
        />
      </Cursor>
    </>
  );
}
