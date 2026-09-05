// ---------------------------------------------------------------------------
// COPIED from supabase/functions/create-sales-onboarding/index.ts (lines
// 449-868).
//
// These helpers are byte-faithful copies, not a fork. They were duplicated
// rather than extracted because create-sales-onboarding is the deployed,
// battle-tested provisioner behind the Sales tab and the extraction could not
// be deployed or smoke-tested in the environment this was written in — an
// untested refactor of that function is a larger risk than this duplication.
//
// FOLLOW-UP (do this once both functions can be deployed and smoke-tested
// together): delete the local copies in create-sales-onboarding/index.ts and
// import from here instead. Until then, ANY FIX MADE IN ONE FILE MUST BE MADE
// IN THE OTHER. The source line range for each function is on its own comment.
//
// The ONLY edits made while copying: the three top-level declarations are
// exported, and the `ServiceClient` alias (which needed a supabase-js import
// purely to name a type) became `any`. No copy string, no section key and no
// control-flow line was touched.
// ---------------------------------------------------------------------------

export interface ContentVars {
  name: string;
  location: string | null;
  phoneHref: string;  // tel: target — "" when no phone was given
  phoneLabel: string; // as the client wrote it — "" when no phone was given
  email: string;
  hours: string;      // business_hours as stored — "" when none
  logoUrl: string;
  year: number;
  today: string;      // YYYY-MM-DD
}

export function buildCmsContent(t: ContentVars): Record<string, Record<string, unknown>> {
  const at = t.location ? ` in ${t.location}` : "";
  const serving = t.location ? ` throughout ${t.location} and the surrounding area` : " in the areas we serve";
  // Every phone CTA is rendered unconditionally by the booking components, and a
  // blank one falls back to Drive247's number — so when no phone was given we
  // point the customer at the booking flow instead.
  const callCta = t.phoneLabel ? `Call ${t.phoneLabel}` : "Book Online";

  return {
    home: {
      home_hero: {
        headline: `Car Rentals with ${t.name}`,
        subheading: `Quality vehicles and straightforward pricing${at}.`,
        background_image: "",
        phone_number: t.phoneHref,
        phone_cta_text: callCta,
        book_cta_text: "Book Your Ride",
        trust_line: "Quality Fleet • Clear Pricing • Local Service",
      },
      // Off by default — the app's fallback badge advertises "20% OFF when you
      // book online", a discount the operator never agreed to and checkout will
      // not honour. They switch it on from the CMS once they have a real offer.
      promo_badge: { enabled: false, discount_amount: "", discount_label: "OFF", line1: "", line2: "" },
      service_highlights: {
        title: `Why Choose ${t.name}?`,
        subtitle: "Straightforward rentals, handled by a local team.",
        // Icon names must exist in the booking components' icon maps, otherwise
        // they silently fall back to a generic one.
        services: [
          { icon: "Car", title: "Well-Maintained Vehicles", description: "Our fleet is looked after so it is ready when you are." },
          { icon: "CheckCircle", title: "Transparent Pricing", description: "The rate you see at booking is the rate you pay." },
          { icon: "MapPin", title: t.location ? `${t.location} and Nearby` : "Local Service", description: `Convenient service${serving}.` },
          { icon: "Clock", title: "Flexible Durations", description: "Daily, weekly and monthly rentals to fit your schedule." },
          { icon: "Shield", title: "Book Online Securely", description: "Reserve, pay and manage your rental online." },
          { icon: "Headphones", title: "Personal Support", description: "Talk to the people who actually run the fleet." },
        ],
      },
      booking_header: {
        title: "Book Your Rental",
        subtitle: `Pick your dates and vehicle — we'll take care of the rest${at}.`,
        trust_points: [t.location || "Local Service", "Transparent Rates", "Quality Vehicles"],
      },
      testimonials_header: { title: `What Customers Say About ${t.name}` },
      home_cta: {
        title: `Ready to Book with ${t.name}?`,
        description: `Reliable car rentals${at} with clear pricing and friendly service.`,
        primary_cta_text: "Book Now",
        secondary_cta_text: "Get in Touch",
        trust_points: ["Reliable Service", "Clean Vehicles", "Clear Rates"],
      },
      contact_card: {
        title: "Have Questions?",
        description: "We're here to help. Reach out for quick answers and booking support.",
        phone_number: t.phoneHref,
        email: t.email,
        call_button_text: "Call Now",
        email_button_text: "Email Us",
      },
      seo: {
        title: `${t.name} — Car Rentals${at}`,
        description: `Rent a car with ${t.name}${at}. Quality vehicles, clear pricing and easy online booking.`,
        keywords: [`${t.name}`, "car rental", t.location ? `car rental ${t.location}` : "", "car hire"].filter(Boolean).join(", "),
      },
    },
    about: {
      hero: { title: `About ${t.name}`, subtitle: `Car rentals${at}, run by a team that knows the area.` },
      about_story: {
        title: "Quality Rentals, Fair Prices",
        // The About component renders "Founded in {founded_year}" and hard-codes
        // "2010" when this is blank — so it cannot be left empty. We write the
        // year the operator came online rather than inventing a history; they
        // correct it in the CMS if the business is older.
        founded_year: String(t.year),
        content: `<p>${t.name} provides car rentals${at} for everyday driving, work trips and longer stays.</p>
<p>We keep it simple: a clear rate, a vehicle that is ready when you arrive, and someone to talk to if anything changes.</p>
<p>Daily, weekly and monthly rentals are available, and you can book, pay and manage your rental online.</p>
<p>Questions before you book? Get in touch — we're happy to help you pick the right vehicle.</p>`,
      },
      // All four tiles read live data (rentals, vehicles, ratings) — nothing here
      // is a hard-coded number.
      stats: {
        items: [
          { icon: "clock", label: "YEARS EXPERIENCE", value: "", suffix: "+", use_dynamic: true, dynamic_source: "years_experience" },
          { icon: "car", label: "RENTALS COMPLETED", value: "", suffix: "+", use_dynamic: true, dynamic_source: "total_rentals" },
          { icon: "crown", label: "VEHICLES", value: "", suffix: "+", use_dynamic: true, dynamic_source: "active_vehicles" },
          { icon: "star", label: "CLIENT RATING", value: "", suffix: "", use_dynamic: true, dynamic_source: "avg_rating" },
        ],
      },
      why_choose_us: {
        title: `Why Choose ${t.name}`,
        items: [
          { icon: "car", title: "Quality Fleet", description: "Well-maintained vehicles you can rely on." },
          { icon: "check", title: "Clear Pricing", description: "The rate you see at booking is the rate you pay." },
          {
            icon: "clock",
            title: "Convenient Hours",
            description: t.hours
              ? `${/^\s*open\b/i.test(t.hours) ? t.hours : "Open " + t.hours}. We work around your schedule.`
              : "Get in touch to arrange a pickup time that suits you.",
          },
          { icon: "phone", title: "Local Service", description: `Proudly serving${serving}.` },
        ],
      },
      faq_cta: { title: "Still have questions?", description: "Our team is happy to help.", button_text: callCta },
      final_cta: {
        title: `Ready to Rent with ${t.name}?`,
        description: "Book your rental today and see how easy it can be.",
        tagline: "Reliable • Local • Straightforward",
      },
      seo: {
        title: `About Us — ${t.name}`,
        description: `Learn about ${t.name} and our car rental service${at}.`,
        keywords: [`about ${t.name}`, t.location ? `${t.location} car rental company` : "car rental company"].join(", "),
      },
    },
    contact: {
      hero: { title: `Contact ${t.name}`, subtitle: `Get in touch about your rental${at}.` },
      contact_info: {
        phone: { number: t.phoneHref, availability: t.hours || "Contact us for availability" },
        email: { address: t.email, response_time: "We reply as quickly as we can" },
        office: { address: t.location || "" },
        whatsapp: { number: t.phoneHref, description: "Message us for a quick reply" },
      },
      contact_form: {
        title: "Send Us a Message",
        subtitle: "We'll get back to you as soon as possible.",
        success_message: `Thanks for contacting ${t.name} — we'll respond shortly.`,
        gdpr_text: "I consent to being contacted regarding my inquiry.",
        submit_button_text: "Send Message",
        subject_options: ["General Inquiry", "Booking Question", "Vehicle Availability", "Pricing", "Feedback"],
      },
      // No star-rating or "trusted by" badge — we have no reviews to back it up.
      trust_badges: {
        badges: [
          { icon: "lock", label: "Secure Booking", tooltip: "Your details and payment are handled securely" },
          { icon: "clock", label: "Quick Response", tooltip: "We reply to inquiries as quickly as we can" },
          { icon: "shield", label: "Local Team", tooltip: `Managed by the ${t.name} team` },
        ],
      },
      pwa_install: { title: `Install ${t.name}`, description: `Add ${t.name} to your home screen for quick access to bookings.` },
      seo: {
        title: `Contact Us — ${t.name}`,
        description: `Contact ${t.name} about car rentals${at}.`,
        keywords: [`contact ${t.name}`, t.location ? `${t.location} car rental contact` : "car rental contact"].join(", "),
      },
    },
    fleet: {
      fleet_hero: {
        headline: "Our Fleet & Pricing",
        subheading: "Browse our vehicles with daily, weekly and monthly rates.",
        background_image: "",
        primary_cta_text: "Book Now",
        secondary_cta_text: "View Fleet Below",
      },
      rental_rates: {
        section_title: "Flexible Rental Rates",
        daily: { title: "Daily", description: "Ideal for short trips and day use." },
        weekly: { title: "Weekly", description: "Better value for week-long rentals." },
        monthly: { title: "Monthly", description: "Our best rates for extended rentals." },
      },
      // Only platform-level facts. The app's fallback promises "Comprehensive
      // Insurance Coverage", "Full Tank of Premium Fuel" and "Unlimited Mileage"
      // under the operator's name — commitments we cannot make on their behalf.
      inclusions: {
        section_title: `Every ${t.name} Rental Includes`,
        section_subtitle: "What comes as standard when you book with us.",
        standard_title: "Standard Inclusions",
        standard_items: [
          { icon: "Phone", title: "Online Booking & Confirmation" },
          { icon: "Shield", title: "Secure Online Payment" },
          { icon: "FileCheck", title: "Digital Rental Agreement" },
          { icon: "Clock", title: "Daily, Weekly & Monthly Rates" },
          { icon: "Sparkles", title: "Vehicle Prepared for Handover" },
          { icon: "User", title: "Direct Support from Our Team" },
        ],
        premium_title: "Optional Add-ons",
        // Left as a pointer rather than a priced list: the operator has not set
        // up any rental_extras yet, and inventing add-ons at invented prices is
        // worse than showing none.
        premium_items: [{ icon: "Sparkles", title: "Any available extras are shown during booking" }],
      },
      extras: { items: [], footer_text: "Add-ons can be selected during booking." },
      seo: {
        title: `Fleet & Pricing — ${t.name}`,
        description: `Browse the ${t.name} fleet and rental rates${at}.`,
        keywords: [`${t.name} fleet`, "rental pricing", t.location ? `car rental ${t.location}` : "car rental"].join(", "),
      },
    },
    promotions: {
      promotions_hero: {
        headline: "Deals & Promotions",
        subheading: "Any current offers will appear here.",
        primary_cta_text: "View Fleet & Pricing",
        primary_cta_href: "/fleet",
        secondary_cta_text: "Book Now",
      },
      how_it_works: {
        title: "How Promotions Work",
        subtitle: "Three steps to save on your rental",
        steps: [
          { number: "1", title: "Select Offer", description: "Browse our active promotions" },
          { number: "2", title: "Choose Vehicle", description: "Pick from our fleet" },
          { number: "3", title: "Apply at Checkout", description: "Savings are applied automatically" },
        ],
      },
      empty_state: {
        title_active: "No active promotions right now",
        title_default: "No promotions found",
        description: "Check back soon, or browse our Fleet & Pricing for our everyday rates.",
        button_text: "Browse Fleet & Pricing",
      },
      terms: {
        title: "Terms & Conditions",
        terms: [
          "Promotions are subject to availability",
          "Discounts cannot be combined with other offers",
          "Valid for new bookings only",
          "Promo codes must be applied at the time of booking",
          `${t.name} reserves the right to modify or withdraw promotions`,
          "Standard rental terms apply",
        ],
      },
      seo: {
        title: `Deals & Promotions — ${t.name}`,
        description: `Current car rental offers from ${t.name}${at}.`,
        keywords: [`${t.name} deals`, "car rental promotions", "car rental offers"].join(", "),
      },
    },
    reviews: {
      hero: { title: "Customer Reviews", subtitle: `What our customers say about ${t.name}.` },
      feedback_cta: {
        title: "Share your experience",
        description: `We'd love to hear about your rental with ${t.name}.`,
        button_text: "Leave a Review",
        empty_state_message: `Be the first to review ${t.name}!`,
      },
      seo: {
        title: `Customer Reviews — ${t.name}`,
        description: `Read customer reviews of ${t.name}${at}.`,
        keywords: [`${t.name} reviews`, "car rental reviews"].join(", "),
      },
    },
    // Legal pages: a neutral starting point in the OPERATOR's name. The app's
    // fallback puts "Drive247 is committed to protecting your privacy" on their
    // site — the wrong legal entity in the client's own policy. The booking site
    // appends the required SMS disclosure to whatever is stored here.
    privacy: {
      privacy_content: {
        title: "Privacy Policy",
        content: `<h2>Introduction</h2>
<p>${t.name} is committed to protecting your privacy. This policy explains how we handle your information.</p>
<h2>Information We Collect</h2>
<ul><li>Contact details (name, email, phone)</li><li>Booking information (dates, vehicle preferences)</li><li>Identity and licence documents where required to rent</li><li>Payment information (processed securely by our payment provider)</li></ul>
<h2>How We Use Your Information</h2>
<ul><li>Processing and managing your rental bookings</li><li>Communicating with you about your reservation</li><li>Meeting our legal and insurance obligations</li><li>Improving our service</li></ul>
<h2>Sharing</h2>
<p>We do not sell your information. We share it only with the providers needed to deliver your rental (for example payment, e-signature and verification providers) and where the law requires it.</p>
<h2>Contact Us</h2>
<p>For any privacy question, contact us at <a href="mailto:${t.email}">${t.email}</a>.</p>`,
        last_updated: t.today,
      },
      seo: {
        title: `Privacy Policy — ${t.name}`,
        description: `How ${t.name} collects, uses and protects your information.`,
        keywords: "privacy policy, data protection",
      },
    },
    terms: {
      terms_content: {
        title: "Terms of Service",
        content: `<h2>Rental Agreement</h2>
<p>By booking with ${t.name} you agree to these terms and to the rental agreement you sign before collecting a vehicle.</p>
<h2>Booking and Payment</h2>
<ul><li>All bookings are subject to vehicle availability</li><li>Payment is taken through our secure online checkout</li><li>Cancellation and amendment terms are set out in your rental agreement</li></ul>
<h2>Vehicle Use</h2>
<ul><li>A valid driving licence is required for every driver</li><li>Only drivers named on the agreement may drive the vehicle</li><li>The vehicle must be returned in the condition it was collected in</li><li>Please report any damage, fault or incident to us immediately</li></ul>
<h2>Contact</h2>
<p>Questions about these terms? Email <a href="mailto:${t.email}">${t.email}</a>${t.phoneLabel ? ` or call ${t.phoneLabel}` : ""}.</p>`,
        last_updated: t.today,
      },
      seo: {
        title: `Terms of Service — ${t.name}`,
        description: `${t.name} rental terms and conditions.`,
        keywords: "terms of service, rental terms",
      },
    },
    // Header/footer/logo layer. useSiteSettings only applies these when the page
    // is PUBLISHED, otherwise the operator's own CMS edits appear to do nothing.
    // City/state/zip stay blank so the footer keeps tenants.address rather than
    // us splitting a free-text location into fields it may not map to.
    "site-settings": {
      logo: { logo_url: t.logoUrl, logo_alt: t.name, favicon_url: t.logoUrl },
      contact: {
        phone: t.phoneHref,
        phone_display: t.phoneLabel,
        email: t.email,
        address_line1: "",
        address_line2: "",
        city: "",
        state: "",
        zip: "",
        country: "",
        google_maps_url: "",
      },
      social: {},
      footer: {
        copyright_text: `© ${t.year} ${t.name}. All rights reserved.`,
        tagline: t.location ? `Car Rentals in ${t.location}` : "Car Rentals",
      },
      pwa_install: { title: `Install ${t.name}`, description: `Add ${t.name} to your home screen for quick bookings.` },
    },
    // NOTE: 'blog' is intentionally absent — it stays a draft shell so an empty
    // blog page never reaches the live site (same as scripts/tenant-onboarding.mjs).
  };
}

// The service-role Supabase client. Typed `any` here rather than
// `ReturnType<typeof createClient>` so this module does not have to import
// supabase-js just to name a type — the caller always passes a real client.

/**
 * Write the generated sections onto the trigger-created page shells and publish
 * them. Throws on the first hard failure; the caller treats content as
 * non-fatal (a provisioned tenant with fallback copy beats no tenant at all).
 *
 * `missing` lists the slugs we generated copy for but found no page shell to
 * write it onto. It is what makes the caller's success flag honest: if only the
 * 'site-settings' shell exists we still write sections and publish a page, but
 * every real content page (home, about, contact…) was skipped and the booking
 * site is still serving Drive247's own copy under the client's name.
 */
export async function seedTenantCmsContent(
  supabase: any,
  tenantId: string,
  content: Record<string, Record<string, unknown>>,
): Promise<{ pages: number; sections: number; missing: string[] }> {
  const now = new Date().toISOString();

  const { data: existing, error: pagesError } = await supabase
    .from("cms_pages")
    .select("id, slug")
    .eq("tenant_id", tenantId);
  if (pagesError) throw pagesError;

  const pageIdBySlug = new Map<string, string>(
    (existing || []).map((p: { id: string; slug: string }): [string, string] => [p.slug, p.id]),
  );

  // seed_cms_pages_for_tenant creates all ten shells, but a project still on the
  // pre-20260720 version of that function has no 'site-settings' page — create
  // it so the footer/logo layer applies either way.
  if (!pageIdBySlug.has("site-settings")) {
    const { data: created, error } = await supabase
      .from("cms_pages")
      .insert({
        tenant_id: tenantId,
        slug: "site-settings",
        name: "Site Settings",
        description: "Global header, footer, logo and social links",
        status: "draft",
      })
      .select("id")
      .single();
    if (error) throw error;
    pageIdBySlug.set("site-settings", created.id);
  }

  const rows: Array<Record<string, unknown>> = [];
  const publishIds: string[] = [];
  const missing: string[] = [];

  for (const [slug, sections] of Object.entries(content)) {
    const pageId = pageIdBySlug.get(slug);
    if (!pageId) {
      // Page shell missing — skip rather than invent one, but report it so the
      // caller never claims the site was seeded when this page was not.
      missing.push(slug);
      continue;
    }
    Object.entries(sections).forEach(([section_key, sectionContent], i) => {
      rows.push({
        page_id: pageId,
        section_key,
        content: sectionContent,
        display_order: i,
        is_visible: true,
        tenant_id: tenantId,
      });
    });
    publishIds.push(pageId);
  }

  // The tenant is brand new, so these are always fresh inserts — one round trip.
  if (rows.length) {
    const { error } = await supabase.from("cms_page_sections").insert(rows);
    if (error) throw error;
  }

  // Publishing is the half that matters: the booking site filters on
  // status='published' in production, so draft pages render the app defaults.
  if (publishIds.length) {
    const { error } = await supabase
      .from("cms_pages")
      .update({ status: "published", published_at: now, updated_at: now })
      .in("id", publishIds);
    if (error) throw error;
  }

  return { pages: publishIds.length, sections: rows.length, missing };
}
