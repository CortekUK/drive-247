import type {
  AboutStoryContent,
  BookingHeaderContent,
  ContactInfoContent,
  FaqItem,
  FaqSectionContent,
  HeroContent,
  HomeCTAContent,
  HomeHeroContent,
  HowItWorksContent,
  EmptyStateContent,
  LogoContent,
  PromoItem,
  RentalRatesContent,
  SafetyVerificationContent,
  SiteContactContent,
  SocialLinksContent,
  StatsContent,
  TermsListContent,
  TestimonialItem,
  TestimonialsHeaderContent,
  TrustBadgesContent,
  WhyChooseUsContent,
} from "./types";

/**
 * What the site renders when the CMS has nothing to say.
 *
 * This is the OLD `lib/fixtures` copy, retyped into the portal's own content
 * shapes. That is the whole point: a tenant nobody has configured — and every
 * tenant, for the moment between the request starting and the query landing —
 * gets the designed page, not a blank one. `mergeContent` lays the operator's
 * fields over the top one at a time, so a half-filled section keeps the rest of
 * this copy underneath rather than blanking it.
 *
 * A blank string here is deliberate and means "this slot does not exist in the
 * shipped design; render it only if an operator fills it in". `home_hero`'s
 * subheading and the testimonials heading are both that.
 */

/* -------------------------------------------------------------------- home */

export const DEFAULT_HOME_HERO: HomeHeroContent = {
  headline: "Rent the Exact Car You See with Absolute Certainty Every Time",
  // No subheading in the Figma hero — the search form sits directly under the
  // headline. Rendered only when an operator writes one (or when the portal's
  // editor is open, where an empty slot is the only way to fill one in).
  subheading: "",
  background_image: "",
  phone_number: "",
  phone_cta_text: "",
  book_cta_text: "",
  trust_line:
    "Every car in our fleet is digitally inspected and safety-certified in real-time to ensure a flawless driving experience.",
  /* The car, the form's labels and the readiness card — every one of these was
     a string literal inside `hero-section.tsx` / `location-search-form.tsx` /
     `readiness-card.tsx` until they were bound here. The values are those
     literals verbatim, so binding them changed nothing on screen. */
  hero_image: "/booking_landingpage/hero-car.webp",
  hero_image_alt: "Black luxury SUV, three-quarter front view",
  pickup_label: "Pick-up Location",
  dropoff_label: "Drop-off Location",
  address_placeholder: "Enter Address",
  readiness_status: "Ready for Pickup",
  readiness_cta: "View Details",
  readiness_metrics: [
    { label: "Pristine", value: 90 },
    { label: "Mechanical Health", value: 97 },
    { label: "Hygiene & Sanitization Score", value: 99 },
  ],
};

export const DEFAULT_BOOKING_HEADER: BookingHeaderContent = {
  title: "Our Fleet",
  subtitle:
    "Browse our curated selection of premium vehicles, each maintained to perfection and ready for immediate pickup",
  trust_points: [],
  // Formerly the `ITEMS` constant in `marquee-strip.tsx`.
  marquee_items: [
    "PICK UP ANYTIME",
    "NO COUNTER LINES",
    "NO HIDDEN FEES",
    "100% TRANSPARENCY",
    "DRIVING THE MOVE",
  ],
  all_makes_label: "All",
  view_all_text: "View all vehicles",
  empty_text: "New vehicles are being added to this fleet.",
  error_text: "We could not load the fleet just now — please try again shortly.",
};

export const DEFAULT_TESTIMONIALS_HEADER: TestimonialsHeaderContent = {
  // The Figma testimonial band has no heading. Empty = nothing renders.
  title: "",
};

export const DEFAULT_HOME_CTA: HomeCTAContent = {
  title: "Your Verified Drive is Just a Click Away",
  description:
    "Secure your exact vehicle from our verified fleet today. Experience high-performance rental with absolute certainty.",
  primary_cta_text: "Get Started",
  secondary_cta_text: "",
  trust_points: [],
  background_image: "/booking_landingpage/tesla-bg.png",
};

/**
 * The banner's footnote when the operator has written no trust points.
 *
 * Left as a fallback rather than seeded into `trust_points` above: an empty
 * array there is what tells `mergeContent` "the operator has not filled this
 * in", and seeding it would make the claim below indistinguishable from one
 * they typed. It is still editable — the section marks it as
 * `home_cta.trust_points.0`, so writing over it CREATES the first point.
 */
export const HOME_CTA_FOOTNOTE_FALLBACK =
  "14 cars available for pickup today in Los Angeles.";

/**
 * The diagnostics band, formerly hardcoded in `safety-verification-section.tsx`.
 * Word for word what that component rendered before it was bound to the CMS.
 */
export const DEFAULT_SAFETY_VERIFICATION: SafetyVerificationContent = {
  title: "Safety Verification is Easier than Ever",
  description:
    "With real-time diagnostic sync, we ensure every car is safety-certified and sanitized before you even arrive. Experience the certainty of a perfectly maintained fleet.",
  cta_text: "Book a Car now",
  image: "/booking_landingpage/safety-car.webp",
  image_alt: "Black sports coupe, three-quarter front view",
  cards: [
    {
      label: "Engine Oil",
      value: "25% Remaining",
      footnote: "2,500 km / 10,000 km",
      footnote_right: "Critical",
      bar_value: 25,
    },
    {
      label: "Tire Pressure (TPMS)",
      value: "32",
      footnote: "Normal",
      footnote_right: "",
      bar_value: 0,
    },
    {
      label: "Brake Life",
      value: "85% Remaining",
      footnote: "12,790 km / 19,000 km",
      footnote_right: "Healthy",
      bar_value: 85,
    },
  ],
};

/** The FAQ band's heading, formerly hardcoded in `faq-section.tsx`. */
export const DEFAULT_FAQ_SECTION: FaqSectionContent = {
  title: "Frequently asked questions",
  subtitle:
    "Don’t Let Final Doubts Stop You. Get the Complete Information You Need for a Confident and Stress-Free Booking Experience.",
};

/* ----------------------------------------------------------------- reviews */

/** `reviews / hero`. Neutral: it describes the page, and claims nothing. */
export const DEFAULT_REVIEWS_HERO = {
  title: "What our customers say",
  subtitle: "",
};

/** `reviews / feedback_cta`. Empty: every field is the operator's to write. */
export const DEFAULT_FEEDBACK_CTA = {
  title: "",
  description: "",
  button_text: "",
  empty_state_message: "",
};

/* ------------------------------------------------------------------- about */

export const DEFAULT_ABOUT_HERO: HeroContent = {
  title: "The Pinnacle of Luxury Mobility.",
  subtitle:
    "Founded in 2010 to provide the highest standard of premium vehicle rentals with unmatched flexibility and discretion.",
};

export const DEFAULT_ABOUT_STORY: AboutStoryContent = {
  title: "Uncompromising Standards",
  founded_year: "",
  content:
    "“What began as a boutique service has grown into the trusted choice for executives and discerning clients. We recognized a need for a service that truly understood the unique requirements of premium hire — offering flexible terms without compromising on quality.”",
};

export const DEFAULT_WHY_CHOOSE_US: WhyChooseUsContent = {
  title: "Why Choose Us?",
  // Formerly the `SUBTITLE` constant in `why-choose-us-section.tsx`, which was
  // commented "a design constant: the portal has no field for it". It has one now.
  subtitle:
    "Experience a new standard of mobility where luxury meets absolute convenience.",
  items: [
    {
      icon: "star",
      title: "Premium Fleet",
      description:
        "From the Rolls-Royce Phantom to the Range Rover Autobiography, every vehicle represents automotive excellence and comfort.",
      // Only the first item renders as the tall image card — see the section.
      image: "/booking_landingpage/feature-car.webp",
      image_alt: "White executive saloon, three-quarter front view",
    },
    {
      icon: "clipboard-check",
      title: "Flexible Terms",
      description:
        "Choose from daily, weekly, or monthly rental periods. Competitive rates with no hidden fees or surprises.",
    },
    {
      icon: "calendar-days",
      title: "24/7 Availability",
      description:
        "Whether weekday or weekend, we’re ready to respond at a moment’s notice — anywhere across the USA.",
    },
    {
      icon: "shield",
      title: "Privacy & Discretion",
      description:
        "Your rental details remain completely private. We maintain strict confidentiality for all our distinguished clients.",
    },
  ],
};

export const DEFAULT_STATS: StatsContent = {
  items: [
    { icon: "calendar", value: "15+", suffix: "", label: "Years of Excellence." },
    { icon: "car", value: "28+", suffix: "", label: "Premium Assets." },
    { icon: "route", value: "1,500+", suffix: "", label: "Journeys Completed." },
    { icon: "star", value: "4.9/5", suffix: "", label: "Client Rating." },
  ],
};

/* -------------------------------------------------------------- promotions */

export const DEFAULT_HOW_IT_WORKS: HowItWorksContent = {
  title: "How It Works",
  subtitle:
    "We’ve redesigned the rental experience to get you from planning to driving in record time.",
  steps: [
    { number: "1", title: "Plan", description: "Define your trip dates and destination." },
    { number: "2", title: "Select", description: "Pick the perfect ride from our premium fleet." },
    { number: "3", title: "Verify", description: "Quick, secure ID and insurance check." },
    { number: "4", title: "Personalize", description: "Add your details and any trip extras." },
    { number: "5", title: "Drive", description: "Review, confirm, and unlock your vehicle." },
  ],
};

/**
 * Icons for the step badges, by position.
 *
 * The portal's step shape carries a `number`, not an icon, but the Figma card
 * is an amber icon badge. Rather than change the card (which is not this
 * agent's to change) the position picks the icon and the operator's words fill
 * the rest. Steps past the fifth reuse the last icon.
 */
export const STEP_ICONS: readonly string[] = [
  "map-pin",
  "car",
  "shield-check",
  "user-round",
  "key",
];

export const DEFAULT_PROMOTIONS_EMPTY_STATE: EmptyStateContent = {
  title_active: "No Active Promotions",
  title_default: "Check Back Soon",
  description:
    "We’re always cooking up new deals. Check back shortly for the next round of offers.",
  button_text: "Browse Our Fleet",
};

export const DEFAULT_PROMOTIONS_TERMS: TermsListContent = {
  // No terms block in the shipped design — renders only once an operator adds one.
  title: "",
  terms: [],
};

/* ----------------------------------------------------------------- contact */

export const DEFAULT_CONTACT_HERO: HeroContent = {
  title: "What can we help you with?",
  subtitle:
    "Whether you have questions about a specific vehicle’s vitals or need assistance with a custom booking, our fleet specialists are here to help.",
};

/**
 * Drive247's own office — the address already shipping on the contact map.
 *
 * The prototype carried TWO addresses that disagreed: a New York street in the
 * details list and this Dubai one on the map directly below it. One is now the
 * fallback for both, so an unconfigured tenant's contact page at least tells a
 * consistent story.
 */
/**
 * Our own registered office. Kept as a NAMED constant purely so it is greppable
 * and obvious, and deliberately no longer used as any tenant's fallback
 * address — see `DEFAULT_CONTACT_INFO` and `ContactMapSection`.
 */
export const DRIVE247_OFFICE_ADDRESS =
  "IFZA - Building A1 DDP - Dubai Silicon Oasis - Industrial Area - Dubai - United Arab Emirates";

/**
 * EMPTY, and that is the whole point.
 *
 * This used to ship a phone number (`+133-394-3439-1435`), a support inbox
 * (`support@carrentals.io`) and our own Dubai office as the DEFAULT contact
 * details for the contact page. `ContactDetailsSection` is written to omit any
 * row the operator left blank — but a non-empty default meant it never saw a
 * blank, so every tenant who had not filled the form published a phone number
 * that reaches nobody and an address that is not theirs. A customer who calls
 * it does not reach the company they are trying to rent from.
 *
 * With the fields empty the section's existing "blank means absent" logic
 * finally applies, and `site-settings / contact` becomes the real source, which
 * is where a tenant enters these once for the whole site.
 */
export const DEFAULT_CONTACT_INFO: ContactInfoContent = {
  phone: { number: "", availability: "" },
  email: { address: "", response_time: "" },
  office: { address: "" },
  whatsapp: { number: "", description: "" },
};

/**
 * The same shape with nothing in it, for the one caller that must distinguish
 * "the operator set this" from "we fell back": the map builds a Google embed
 * from the address, and a fallback address must not silently become the
 * query — see `contact-map-section.tsx`.
 */
export const EMPTY_CONTACT_INFO: ContactInfoContent = {
  phone: { number: "", availability: "" },
  email: { address: "", response_time: "" },
  office: { address: "" },
  whatsapp: { number: "", description: "" },
};

export const DEFAULT_TRUST_BADGES: TrustBadgesContent = {
  // Not in the shipped contact page; renders only when configured.
  badges: [],
};

/* ------------------------------------------------------------------- fleet */

export const DEFAULT_RENTAL_RATES: RentalRatesContent = {
  section_title: "Browse the fleet",
  daily: { title: "", description: "" },
  weekly: { title: "", description: "" },
  monthly: { title: "", description: "" },
};

/* ----------------------------------------------------------- site settings */

/* `logo_alt` is the text a screen reader announces in place of the logo, and it
   defaulted to "Drive247" — so a tenant who had uploaded their own logo but not
   typed alt text had their mark announced as OUR company. Blank instead: every
   consumer already treats an empty value as "fall back to the tenant's name". */
export const DEFAULT_SITE_LOGO: LogoContent = {
  logo_url: "",
  logo_alt: "",
  favicon_url: "",
};

/**
 * Site settings are genuinely EMPTY by default.
 *
 * Unlike the page sections above, there is no "shipped copy" for an operator's
 * own address — the one on the contact map today is Drive247's own office, and
 * it belongs to that section as its designed fallback, not here where it would
 * be silently attributed to whichever tenant is rendering.
 */
export const DEFAULT_SITE_CONTACT: SiteContactContent = {
  phone: "",
  phone_display: "",
  email: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  zip: "",
  country: "",
  google_maps_url: "",
};

export const DEFAULT_SITE_SOCIAL: SocialLinksContent = {
  facebook: "",
  instagram: "",
  twitter: "",
  linkedin: "",
  youtube: "",
  tiktok: "",
};

/* ------------------------------------------ table-backed content fallbacks */

/* `DEFAULT_TESTIMONIALS` held the two example quotes the home band fell
   back to — invented customers praising Drive247 on someone else's site.
   Deleted for the same reason as `DEFAULT_STORIES` above. */

/* `DEFAULT_STORIES` held ten invented five-star reviews, every one signed
   "Jhon Doe", used to fill the /reviews wall for any tenant without their
   own. Deleted rather than left unused: a constant like this gets picked
   up again by the next person filling an empty-looking page. */

/** Formerly `FAQS` in `lib/fixtures/landing.ts`. */
export const DEFAULT_FAQS: readonly FaqItem[] = [
  {
    id: "exact-car",
    question: "How can I be sure the car I see on the screen is the exact one I will drive?",
    answer:
      "We have eliminated the ‘or similar’ bait-and-switch. Because our fleet is digitally integrated, every listing you see is tied to a specific VIN and license plate. When you book a silver Aston Martin Vanquish with ID DEV-F3O11, our system locks that exact asset for you.",
  },
  {
    id: "real-time-monitoring",
    question: "What does ‘Real-Time Health Monitoring’ actually mean for my safety during the rental?",
    answer:
      "Each vehicle streams live diagnostics — tire pressure, brake life, fluid levels and engine health — to our operations team. If anything drifts outside healthy thresholds we are alerted immediately and can intervene before it affects your trip.",
  },
  {
    id: "sanitized",
    question: "How do you verify that a vehicle has been sanitized and fully fueled before my pickup?",
    answer:
      "Every vehicle goes through a digital pickup checklist. Sanitization, fueling and interior condition are signed off by our team and time-stamped. The verification record is attached to your booking before keys are released.",
  },
  {
    id: "documents",
    question: "What documents do I need to provide, and can the car be delivered directly to my hotel or airport?",
    answer:
      "A valid driver’s license, proof of insurance and a payment method are all that’s required. We deliver to most major hotels and airports — pricing and ETA are confirmed during checkout.",
  },
  {
    id: "health-alert",
    question: "What happens if the car detects a ‘Health Alert’ or mechanical issue while I am on the road?",
    answer:
      "You’ll receive an in-app notification and our 24/7 concierge will contact you. If a swap is needed we will deliver a replacement vehicle to your location and handle the logistics end-to-end.",
  },
];

/* `DEFAULT_PROMOTIONS` held four invented offers — Early Bird, EV Explorer,
   Weekend Escape, Business Class — each with a badge and a discount label,
   shown to any tenant who had never created a promotion. They are commercial
   claims a customer can act on, so they are deleted rather than left unused. */
