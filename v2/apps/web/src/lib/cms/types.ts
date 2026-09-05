/**
 * The shapes of the JSON already sitting in `cms_page_sections.content`.
 *
 * These are NOT a design: they are a transcription of what the portal writes.
 * The portal's CMS editor (apps/portal/src/constants/website-content.ts) and
 * v1's reader (apps/booking/src/hooks/usePageContent.ts) are the two ends of
 * the same contract; this file is the v2 end of it, ported field for field so
 * a section here reads exactly the key an operator edited over there.
 *
 * Every field is REQUIRED even where the operator may leave it blank. A blank
 * string is a real value that the merge in `merge.ts` treats as "not set" and
 * replaces with the fallback — which is why nothing here is optional unless the
 * portal genuinely omits the key.
 */

/** Page slugs in `cms_pages`. One row per slug per tenant. */
export type CmsPageSlug =
  | "home"
  | "about"
  | "contact"
  | "fleet"
  | "promotions"
  | "reviews"
  | "blog"
  | "privacy"
  | "terms"
  | "site-settings";

/**
 * `section_key -> content` for one page, already filtered to visible sections
 * and ordered by `display_order`. The values are raw JSON: use
 * `getSection()` to pull one out against a typed fallback.
 */
export type PageSections = Readonly<Record<string, unknown>>;

/* ------------------------------------------------------------------ shared */

export interface HeroContent {
  title: string;
  subtitle: string;
}

export interface CTAContent {
  title: string;
  description: string;
  button_text: string;
}

export interface SEOContent {
  title: string;
  description: string;
  keywords: string;
}

/* -------------------------------------------------------------------- home */

export interface HomeHeroContent {
  headline: string;
  subheading: string;
  background_image: string;
  phone_number: string;
  phone_cta_text: string;
  book_cta_text: string;
  trust_line: string;
}

export interface PromoBadgeContent {
  enabled: boolean;
  discount_amount: string;
  discount_label: string;
  line1: string;
  line2: string;
}

export interface ServiceHighlightItem {
  icon: string;
  title: string;
  description: string;
}

export interface ServiceHighlightsContent {
  title: string;
  subtitle: string;
  services: ServiceHighlightItem[];
}

export interface BookingHeaderContent {
  title: string;
  subtitle: string;
  trust_points: string[];
}

export interface TestimonialsHeaderContent {
  title: string;
}

export interface HomeCTAContent {
  title: string;
  description: string;
  primary_cta_text: string;
  secondary_cta_text: string;
  trust_points: string[];
}

export interface ContactCardContent {
  title: string;
  description: string;
  phone_number: string;
  email: string;
  call_button_text: string;
  email_button_text: string;
}

/* ------------------------------------------------------------------- about */

export interface AboutStoryContent {
  title: string;
  founded_year: string;
  /** Rich text written in the portal's Tiptap editor. See `html.ts`. */
  content: string;
}

export interface WhyChooseUsItem {
  icon: string;
  title: string;
  description: string;
}

export interface WhyChooseUsContent {
  title: string;
  items: WhyChooseUsItem[];
}

export interface StatItem {
  icon: string;
  label: string;
  value: string;
  suffix: string;
  /**
   * The portal offers "count this live from the database" per stat. v2 does not
   * resolve it yet — see the coverage note in the section — so the operator's
   * typed `value` is what renders either way.
   */
  use_dynamic?: boolean;
  dynamic_source?: string;
}

export interface StatsContent {
  items: StatItem[];
}

/* ----------------------------------------------------------------- contact */

export interface ContactInfoContent {
  phone: { number: string; availability: string };
  email: { address: string; response_time: string };
  office: { address: string };
  whatsapp: { number: string; description: string };
}

export interface ContactFormContent {
  title: string;
  subtitle: string;
  success_message: string;
  gdpr_text: string;
  submit_button_text: string;
  subject_options: string[];
}

export interface TrustBadge {
  icon: string;
  label: string;
  tooltip: string;
}

export interface TrustBadgesContent {
  badges: TrustBadge[];
}

/* ------------------------------------------------------------------- fleet */

export interface FleetHeroContent {
  headline: string;
  subheading: string;
  background_image: string;
  primary_cta_text: string;
  secondary_cta_text: string;
}

export interface RentalRateCard {
  title: string;
  description: string;
}

export interface RentalRatesContent {
  section_title: string;
  daily: RentalRateCard;
  weekly: RentalRateCard;
  monthly: RentalRateCard;
}

export interface ServiceInclusionItem {
  icon: string;
  title: string;
}

export interface InclusionsContent {
  section_title: string;
  section_subtitle: string;
  standard_title: string;
  standard_items: ServiceInclusionItem[];
  premium_title: string;
  premium_items: ServiceInclusionItem[];
}

/* -------------------------------------------------------------- promotions */

export interface PromotionsHeroContent {
  headline: string;
  subheading: string;
  background_image: string;
  primary_cta_text: string;
  primary_cta_href: string;
  secondary_cta_text: string;
}

export interface HowItWorksStep {
  number: string;
  title: string;
  description: string;
}

export interface HowItWorksContent {
  title: string;
  subtitle: string;
  steps: HowItWorksStep[];
}

export interface EmptyStateContent {
  title_active: string;
  title_default: string;
  description: string;
  button_text: string;
}

export interface TermsListContent {
  title: string;
  terms: string[];
}

/* ---------------------------------------------------------- site settings */

export interface LogoContent {
  logo_url: string;
  logo_alt: string;
  favicon_url: string;
}

export interface SiteContactContent {
  phone: string;
  phone_display: string;
  email: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  google_maps_url: string;
}

export interface SocialLinksContent {
  facebook: string;
  instagram: string;
  twitter: string;
  linkedin: string;
  youtube: string;
  tiktok: string;
}

export interface FooterSettingsContent {
  copyright_text: string;
  tagline: string;
}

/* ------------------------------------------- view models for table content */

/**
 * One customer quote, from the `testimonials` table.
 *
 * `source` is the table's `company_name`, which the portal labels "company /
 * context" — on the seeded rows it holds "Verified rental", so it is rendered
 * as the card's sub-line rather than as an employer.
 */
export interface TestimonialItem {
  id: string;
  quote: string;
  author: string;
  source: string;
  stars: number;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

/** Accent ramps the promo cards cycle through. Purely presentational. */
export type PromoAccent = "amber" | "forest" | "stone" | "deep";

/**
 * A promotion, already flattened for the card.
 *
 * The `promotions` table stores a machine-readable discount
 * (`discount_type` + `discount_value`) and one free-text `title`; the card
 * needs a short badge, a label line and a big discount string. `format.ts`
 * derives all three so the server render and the client refetch cannot
 * disagree about them.
 */
export interface PromoItem {
  id: string;
  badge: string;
  label: string;
  discount: string;
  caption: string;
  validUntil: string;
  image: string;
  imageAlt: string;
  accent: PromoAccent;
}
