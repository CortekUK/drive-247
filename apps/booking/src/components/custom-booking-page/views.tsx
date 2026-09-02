"use client";

import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { createTenantContactRequest } from "@/lib/tenantQueries";
import { sanitizeEmail, sanitizeName, sanitizePhone, sanitizeTextArea } from "@/lib/sanitize";
import { BookingPanel } from "./booking-bar";
import { BenefitRow, Hero } from "./hero";
import { CtaBanner, FleetStrip, OffersReviewsArticles, WhyChoose } from "./home";
import { ArticlePage, BlogPage, FaqPage, PromotionsPage } from "./content-pages";
import { AboutPage, ContactPage, FleetPage, LegalPage, ReviewsPage } from "./pages";
import { PageHeader } from "./shell";
import { useSite } from "./site-shell";

/* ========================================================================== *
 * One view per route.
 *
 * These exist because the routes themselves are server components — they await
 * the tenant seed — and a server component cannot hand a function across the
 * boundary. Each view is a thin client component that reads the resolved
 * content from context and lays the page out.
 * ========================================================================== */

export function HomeView() {
  const c = useSite();
  return (
    <>
      {/* The booking panel is passed INTO the hero: it spans the section's
          bottom and overlaps into the band below, as the approved design
          shows, so it stays inside the first desktop screen. */}
      <Hero c={c}>
        <BookingPanel c={c} />
      </Hero>
      <BenefitRow c={c} />
      <FleetStrip c={c} />
      <WhyChoose c={c} />
      <OffersReviewsArticles c={c} />
      <CtaBanner c={c} />
    </>
  );
}

export function AboutView() {
  const c = useSite();
  return (
    <>
      <PageHeader
        eyebrow="About us"
        title={c.about.heroTitle || `About ${c.name}`}
        subtitle={c.about.heroSubtitle || c.tagline || undefined}
      />
      <AboutPage c={c} />
    </>
  );
}

export function FleetView() {
  const c = useSite();
  return (
    <>
      <PageHeader
        eyebrow="Our fleet"
        title={c.fleetPage.title || "Fleet & Pricing"}
        subtitle={c.fleetPage.subtitle || undefined}
      />
      <FleetPage c={c} />
    </>
  );
}

export function ReviewsView() {
  const c = useSite();
  return (
    <>
      <PageHeader
        eyebrow="Reviews"
        title="What Our Customers Say"
        subtitle={c.name ? `Real reviews from people who have rented with ${c.name}.` : undefined}
      />
      <ReviewsPage c={c} />
    </>
  );
}

export function PromotionsView() {
  const c = useSite();
  return (
    <>
      <PageHeader
        eyebrow="Offers"
        title={c.offersPage.title || "Promotions & Offers"}
        subtitle={c.offersPage.subtitle || undefined}
      />
      <PromotionsPage c={c} />
    </>
  );
}

/**
 * Contact and enquiry. The form posts through the app's existing
 * `createTenantContactRequest`, so submissions land in the same
 * `contact_requests` table the operator already reads in the portal — no new
 * endpoint and no new table.
 */
export function ContactView() {
  const c = useSite();
  const { tenant } = useTenant();

  const submit = async (v: { name: string; email: string; phone: string; message: string }) => {
    if (!tenant?.id) {
      toast.error("We could not identify this site. Please try again in a moment.");
      throw new Error("no tenant");
    }
    // The same sanitisers the existing contact form uses, so what reaches the
    // operator is shaped identically however the enquiry was sent.
    const { error } = await createTenantContactRequest(tenant.id, {
      name: sanitizeName(v.name),
      email: sanitizeEmail(v.email),
      phone: v.phone ? sanitizePhone(v.phone) : undefined,
      message: sanitizeTextArea(v.message),
    });
    if (error) {
      toast.error("Your enquiry could not be sent. Please try again or call us.");
      throw error;
    }
    toast.success("Enquiry sent — we'll be in touch shortly.");
  };

  return (
    <>
      <PageHeader
        eyebrow="Contact"
        title={c.contact.title || "Get in touch"}
        subtitle={c.contact.subtitle || (c.name ? `The ${c.name} team is here to help.` : undefined)}
      />
      <ContactPage c={c} onSubmit={submit} />
    </>
  );
}

export function PrivacyView() {
  const c = useSite();
  return (
    <>
      <PageHeader title="Privacy Policy" subtitle={c.legalName || c.name || undefined} />
      <LegalPage html={c.legal.privacy} fallbackHref="/privacy" />
    </>
  );
}

export function TermsView() {
  const c = useSite();
  return (
    <>
      <PageHeader title="Terms & Conditions" subtitle={c.legalName || c.name || undefined} />
      <LegalPage html={c.legal.terms} fallbackHref="/terms" />
    </>
  );
}

export function FaqView() {
  const c = useSite();
  return (
    <>
      <PageHeader
        eyebrow="Help"
        title="Frequently Asked Questions"
        subtitle={c.name ? `Everything you need to know before renting with ${c.name}.` : undefined}
      />
      <FaqPage c={c} />
    </>
  );
}

export function BlogView() {
  const c = useSite();
  return (
    <>
      {/* Hero copy comes from the "blog" CMS page, the same section the
          existing listing reads. */}
      <PageHeader
        eyebrow="Blog"
        title={c.blogPage.title || "Blog"}
        subtitle={c.blogPage.subtitle || undefined}
      />
      <BlogPage c={c} />
    </>
  );
}

export function ArticleView({ slug }: { slug: string }) {
  const c = useSite();
  return <ArticlePage slug={slug} c={c} />;
}
