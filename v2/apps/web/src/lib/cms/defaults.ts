import type {
  AboutStoryContent,
  BookingHeaderContent,
  ContactInfoContent,
  FaqItem,
  HeroContent,
  HomeCTAContent,
  HomeHeroContent,
  HowItWorksContent,
  EmptyStateContent,
  LogoContent,
  PromoItem,
  RentalRatesContent,
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
  // headline. Rendered only when an operator writes one.
  subheading: "",
  background_image: "",
  phone_number: "",
  phone_cta_text: "",
  book_cta_text: "",
  trust_line:
    "Every car in our fleet is digitally inspected and safety-certified in real-time to ensure a flawless driving experience.",
};

export const DEFAULT_BOOKING_HEADER: BookingHeaderContent = {
  title: "Our Fleet",
  subtitle:
    "Browse our curated selection of premium vehicles, each maintained to perfection and ready for immediate pickup",
  trust_points: [],
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
  items: [
    {
      icon: "star",
      title: "Premium Fleet",
      description:
        "From the Rolls-Royce Phantom to the Range Rover Autobiography, every vehicle represents automotive excellence and comfort.",
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
export const FALLBACK_OFFICE_ADDRESS =
  "IFZA - Building A1 DDP - Dubai Silicon Oasis - Industrial Area - Dubai - United Arab Emirates";

export const DEFAULT_CONTACT_INFO: ContactInfoContent = {
  phone: { number: "+133-394-3439-1435", availability: "" },
  email: { address: "support@carrentals.io", response_time: "" },
  office: { address: FALLBACK_OFFICE_ADDRESS },
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

export const DEFAULT_SITE_LOGO: LogoContent = {
  logo_url: "",
  logo_alt: "Drive247",
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

/**
 * The two long-form quotes the home/about/fleet band shows. Formerly
 * `TESTIMONIALS` in `lib/fixtures/landing.ts`.
 */
export const DEFAULT_TESTIMONIALS: readonly TestimonialItem[] = [
  {
    id: "marcus",
    author: "Marcus J.",
    source: "",
    stars: 5,
    quote:
      "Finally, a rental service that values precision. I was skeptical about the ‘Exact Car’ promise, but the Porsche 911 I booked was the exact one waiting for me — fully fueled, spotless, and with the maintenance vitals exactly as shown on the site. It’s a level of transparency I’ve never seen in the industry.",
  },
  {
    id: "sarah",
    author: "Sarah L.",
    source: "",
    stars: 5,
    quote:
      "I rented the Aston Martin for a weekend trip, and the ‘Readiness Pulse’ wasn’t just a marketing gimmick. You can tell these cars are digitally monitored; the engine felt tight, the brakes were sharp, and the cabin was showroom-clean. Drive247 has completely removed the ‘what if’ from renting high-performance vehicles.",
  },
];

/** The /reviews wall. Formerly `REVIEWS` in `lib/fixtures/reviews.ts`. */
export const DEFAULT_STORIES: readonly TestimonialItem[] = [
  { id: "r1", author: "Jhon Doe", source: "Tesla Model 3", stars: 5, quote: "The car was spotless and the pricing was exactly what I saw online — no hidden insurance fees or surprise taxes at checkout. Refreshingly honest." },
  { id: "r2", author: "Jhon Doe", source: "Tesla Model 3", stars: 5, quote: "Landing at 2 AM is usually a nightmare for car rentals. With Drive 247, I was in my Tesla and out of the lot in 5 minutes. No lines, no desk, just drive." },
  { id: "r3", author: "Jhon Doe", source: "Tesla Model 3", stars: 5, quote: "Drive247 has revolutionized our travel documentation, making it super easy to share our adventures!" },
  { id: "r4", author: "Jhon Doe", source: "Tesla Model 3", stars: 5, quote: "Drive247 has revolutionized our travel documentation, making it super easy to share our adventures!" },
  { id: "r5", author: "Jhon Doe", source: "Tesla Model 3", stars: 5, quote: "Great rates and even better service. I appreciate the transparency regarding fuel and tolls. It makes business travel much easier to expense." },
  { id: "r6", author: "Jhon Doe", source: "Tesla Model 3", stars: 5, quote: "The most tech-forward rental I've ever used. Unlocking the car with my phone felt like the future. I'm never going back to traditional rental counters." },
  { id: "r7", author: "Jhon Doe", source: "Tesla Model 3", stars: 5, quote: "Clean, reliable, and modern. You can tell these cars are well-maintained. The peace of mind alone is worth the switch to Drive 247." },
  { id: "r8", author: "Jhon Doe", source: "Tesla Model 3", stars: 5, quote: "I needed a last-minute van for a family trip. The booking process was seamless on my phone and the customer support team was live when I had a question." },
  { id: "r9", author: "Jhon Doe", source: "Tesla Model 3", stars: 5, quote: "Pickup was a breeze and the car was exactly as advertised. The 'No Hidden Fees' promise really delivered — I paid the price I saw on screen." },
  { id: "r10", author: "Jhon Doe", source: "Tesla Model 3", stars: 5, quote: "From my first booking to my fifth, Drive 247 has been consistent. Same level of cleanliness, same friendly support, same fair pricing every time." },
];

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

/** Formerly `PROMOTIONS` in `lib/fixtures/promotions.ts`. */
export const DEFAULT_PROMOTIONS: readonly PromoItem[] = [
  {
    id: "early-bird",
    badge: "Early Bird",
    label: "Save",
    discount: "15%",
    caption: "Book 30 days in advance and save 15%.",
    validUntil: "",
    image: "/booking_landingpage/promo-early-bird.jpg",
    imageAlt: "White Range Rover at sunrise",
    accent: "amber",
  },
  {
    id: "ev-explorer",
    badge: "EV Explorer",
    label: "Deal",
    discount: "20% OFF",
    caption: "Drive electric on weekday rentals and save 20%.",
    validUntil: "",
    image: "/booking_landingpage/promo-ev-explorer.jpg",
    imageAlt: "BMW electric SUV at a charging point",
    accent: "forest",
  },
  {
    id: "weekend-escape",
    badge: "Weekend Escape",
    label: "Friday → Monday",
    discount: "10% OFF",
    caption: "Pick up Friday, return Monday — three days, one fixed rate.",
    validUntil: "",
    image: "/booking_landingpage/promo-weekend-escape.jpg",
    imageAlt: "Black Toyota Land Cruiser with roof rack",
    accent: "stone",
  },
  {
    id: "business-class",
    badge: "Business Class",
    label: "Loyalty",
    discount: "25% OFF",
    caption: "Five rentals or more this quarter unlocks a premium tier rate.",
    validUntil: "",
    image: "/booking_landingpage/promo-business-class.jpg",
    imageAlt: "Black Porsche Panamera at dusk",
    accent: "deep",
  },
];
