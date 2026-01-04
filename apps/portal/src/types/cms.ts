// CMS Type Definitions

export interface CMSPage {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published';
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
  tenant_id: string | null; // Multi-tenant support
}

export interface CMSPageSection {
  id: string;
  page_id: string;
  section_key: string;
  content: Record<string, any>;
  display_order: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface CMSPageVersion {
  id: string;
  page_id: string;
  version_number: number;
  content: CMSPageSection[];
  created_by: string | null;
  created_at: string;
  notes: string | null;
  tenant_id: string | null; // Multi-tenant support
}

export interface CMSMedia {
  id: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  mime_type: string | null;
  alt_text: string | null;
  folder: string;
  uploaded_by: string | null;
  created_at: string;
  tenant_id: string | null; // Multi-tenant support
}

// Content Types for Contact Page Sections

export interface HeroContent {
  title: string;
  subtitle: string;
}

export interface ContactInfoContent {
  phone: {
    number: string;
    availability: string;
  };
  email: {
    address: string;
    response_time: string;
  };
  office: {
    address: string;
  };
  whatsapp: {
    number: string;
    description: string;
  };
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

export interface SEOContent {
  title: string;
  description: string;
  keywords: string;
}
export interface PWAInstallContent {
  title: string;
  description: string;
}

export interface FeedbackCTAContent {
  title: string;
  description: string;
  button_text: string;
  empty_state_message: string;
}


// About Page Content Types
export interface AboutStoryContent {
  title: string;
  founded_year: string;
  content: string; // Rich text HTML content
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

export interface CTAContent {
  title: string;
  description: string;
  button_text?: string;
  tagline?: string;
}

export interface StatItem {
  icon: string;
  label: string;
  value: string;
  suffix?: string;
  use_dynamic?: boolean;
  dynamic_source?: string;
}

export interface StatsContent {
  items: StatItem[];
}

// Combined Contact Page Content
export interface ContactPageContent {
  hero: HeroContent;
  contact_info: ContactInfoContent;
  contact_form: ContactFormContent;
  trust_badges: TrustBadgesContent;
  seo: SEOContent;
}

// Promotions Page Content Types
export interface PromotionsHeroContent {
  headline: string;
  subheading: string;
  primary_cta_text: string;
  primary_cta_href: string;
  secondary_cta_text: string;
  background_image?: string;
  carousel_images?: string[];
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

export interface TermsContent {
  title: string;
  terms: string[];
}

// Fleet & Pricing Page Content Types
export interface FleetHeroContent {
  headline: string;
  subheading: string;
  background_image?: string;
  carousel_images?: string[];
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

export interface ServiceInclusion {
  icon: string;
  title: string;
}

export interface InclusionsContent {
  section_title: string;
  section_subtitle: string;
  standard_title: string;
  standard_items: ServiceInclusion[];
  premium_title: string;
  premium_items: ServiceInclusion[];
}

export interface PricingExtra {
  name: string;
  price: number;
  description: string;
}

export interface ExtrasContent {
  items: PricingExtra[];
  footer_text: string;
}

export interface AssuranceContent {
  text: string;
}

export interface FleetCTAContent {
  primary_text: string;
  primary_href: string;
  secondary_text: string;
  secondary_href: string;
}

// Home Page Content Types
export interface HomeHeroContent {
  headline: string;
  subheading: string;
  background_image?: string;
  carousel_images?: string[];
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

export interface HomeCTAContent {
  title: string;
  description: string;
  primary_cta_text: string;
  secondary_cta_text: string;
  trust_points: string[];
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

export interface ContactCardContent {
  title: string;
  description: string;
  phone_number: string;
  email: string;
  call_button_text: string;
  email_button_text: string;
}

// Privacy Policy Page Content Types
export interface PrivacyPolicyContent {
  title: string;
  content: string;
  last_updated: string;
}

// Terms of Service Page Content Types
export interface TermsOfServiceContent {
  title: string;
  content: string;
  last_updated: string;
}

// Site Settings Content Types
export interface LogoContent {
  logo_url: string;
  logo_alt: string;
  favicon_url?: string;
}

export interface SiteContactContent {
  phone: string;
  phone_display: string;
  email: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  google_maps_url?: string;
}

export interface SocialLinksContent {
  facebook?: string;
  instagram?: string;
  twitter?: string;
  linkedin?: string;
  youtube?: string;
  tiktok?: string;
}

export interface FooterContent {
  copyright_text: string;
  tagline?: string;
}

// Page with sections included
export interface CMSPageWithSections extends CMSPage {
  cms_page_sections: CMSPageSection[];
}
