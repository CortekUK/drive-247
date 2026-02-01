import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

// Default carousel images for fallback (defined early to avoid hoisting issues)
export const defaultHomeCarouselImages = [
  '/carousel-images/car1.jpeg',
  '/carousel-images/car2.jpeg',
  '/carousel-images/car3.jpeg',
  '/carousel-images/car8.jpeg',
  '/carousel-images/car6.jpeg',
];

export const defaultFleetCarouselImages = [
  '/carousel-images/car2.jpeg',
  '/carousel-images/car8.jpeg',
  '/carousel-images/car5.jpeg',
  '/carousel-images/car1.jpeg',
  '/carousel-images/car6.jpeg',
];

export const defaultPromotionsCarouselImages = [
  '/carousel-images/car5.jpeg',
  '/carousel-images/car9.jpeg',
  '/carousel-images/car7.jpeg',
  '/carousel-images/car2.jpeg',
  '/carousel-images/car3.jpeg',
];

// CMS Content Types
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

export interface PWAInstallContent {
  title: string;
  description: string;
}

export interface SEOContent {
  title: string;
  description: string;
  keywords: string;
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

export interface PricingExtraItem {
  name: string;
  price: number;
  description: string;
}

export interface ExtrasContent {
  items: PricingExtraItem[];
  footer_text: string;
}

// Carousel Media Item for mixed image/video carousel
export interface CarouselMediaItem {
  url: string;
  type: 'image' | 'video';
  alt?: string;
  thumbnail?: string;
}

// Home Page Content Types
export interface HomeHeroContent {
  headline: string;
  subheading: string;
  background_image?: string;
  carousel_images?: string[]; // Kept for backwards compatibility
  carousel_media?: CarouselMediaItem[]; // New: mixed media array
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

export interface FooterSettingsContent {
  copyright_text: string;
  tagline?: string;
}

export interface PageContent {
  hero?: HeroContent;
  contact_info?: ContactInfoContent;
  contact_form?: ContactFormContent;
  trust_badges?: TrustBadgesContent;
  seo?: SEOContent;
  pwa_install?: PWAInstallContent;
  feedback_cta?: FeedbackCTAContent;
  about_story?: AboutStoryContent;
  why_choose_us?: WhyChooseUsContent;
  stats?: StatsContent;
  faq_cta?: CTAContent;
  final_cta?: CTAContent;
  // Promotions page
  promotions_hero?: PromotionsHeroContent;
  how_it_works?: HowItWorksContent;
  empty_state?: EmptyStateContent;
  terms?: TermsContent;
  // Fleet page
  fleet_hero?: FleetHeroContent;
  rental_rates?: RentalRatesContent;
  inclusions?: InclusionsContent;
  extras?: ExtrasContent;
  // Home page
  home_hero?: HomeHeroContent;
  promo_badge?: PromoBadgeContent;
  home_cta?: HomeCTAContent;
  service_highlights?: ServiceHighlightsContent;
  booking_header?: BookingHeaderContent;
  testimonials_header?: TestimonialsHeaderContent;
  contact_card?: ContactCardContent;
  // Privacy/Terms pages
  privacy_content?: PrivacyPolicyContent;
  terms_content?: TermsOfServiceContent;
  // Site settings
  logo?: LogoContent;
  site_contact?: SiteContactContent;
  social?: SocialLinksContent;
  footer_settings?: FooterSettingsContent;
  [key: string]: any;
}

interface CMSPage {
  id: string;
  slug: string;
  status: string;
  cms_page_sections: Array<{
    section_key: string;
    content: any;
    is_visible: boolean;
  }>;
}

export const usePageContent = (slug: string) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["cms-page-content", slug, tenant?.id],
    queryFn: async (): Promise<PageContent | null> => {
      try {
        // Helper function to fetch page with optional tenant filter
        // TEMP: Also fetch draft pages for development testing
        const isDev = typeof window !== 'undefined' && window.location.hostname.includes('localhost');

        const fetchPage = async (tenantId: string | null) => {
          let query = supabase
            .from("cms_pages")
            .select(`
              id,
              slug,
              status,
              tenant_id,
              cms_page_sections(
                section_key,
                content,
                is_visible
              )
            `)
            .eq("slug", slug);

          // In dev mode, fetch both draft and published; in prod, only published
          if (!isDev) {
            query = query.eq("status", "published");
          }

          // Filter by tenant if provided
          if (tenantId) {
            query = query.eq("tenant_id", tenantId);
          }

          return query.single();
        };

        let result;

        // Strategy: Try tenant-specific content first, then fallback to global (NULL tenant_id only)
        if (tenant?.id) {
          // 1. Try tenant-specific content
          result = await fetchPage(tenant.id);
          console.log(`[CMS] Loaded content for ${slug} (tenant: ${tenant.id}):`, result.data ? 'found' : 'not found');

          // 2. If not found, try global content (tenant_id IS NULL) - NOT content from other tenants
          if (result.error?.code === "PGRST116") {
            console.log(`[CMS] No tenant-specific content for ${slug}, trying global (tenant_id IS NULL)...`);
            let globalQuery = supabase
              .from("cms_pages")
              .select(`
                id,
                slug,
                status,
                tenant_id,
                cms_page_sections(
                  section_key,
                  content,
                  is_visible
                )
              `)
              .eq("slug", slug)
              .is("tenant_id", null);

            if (!isDev) {
              globalQuery = globalQuery.eq("status", "published");
            }

            result = await globalQuery.single();
          }

          // Note: We intentionally do NOT fall back to content from other tenants.
          // If there's no tenant-specific content and no global content, return null.
          // The page will use default/fallback content defined in the app.
        } else {
          // No tenant context - only fetch global content (tenant_id IS NULL)
          console.log(`[CMS] No tenant context, fetching global content for ${slug}...`);
          let noTenantQuery = supabase
            .from("cms_pages")
            .select(`
              id,
              slug,
              status,
              tenant_id,
              cms_page_sections(
                section_key,
                content,
                is_visible
              )
            `)
            .eq("slug", slug)
            .is("tenant_id", null);

          if (!isDev) {
            noTenantQuery = noTenantQuery.eq("status", "published");
          }

          result = await noTenantQuery.single();
        }

        const { data: page, error } = result;

        if (error) {
          if (error.code === "PGRST116") {
            console.log(`[CMS] No published content for page: ${slug}`);
            return null;
          }
          throw error;
        }

        if (!page) return null;

        // Transform sections array to object
        const sections: PageContent = {};
        (page as CMSPage).cms_page_sections?.forEach((section) => {
          if (section.is_visible) {
            sections[section.section_key] = section.content;
          }
        });

        console.log(`[CMS] Loaded content for ${slug} (tenant: ${(page as any).tenant_id || 'global'}):`, Object.keys(sections));
        return sections;
      } catch (err) {
        console.error("[CMS] Error fetching content:", err);
        return null;
      }
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 1, // Only retry once on failure
    enabled: true, // Always enabled, will work with or without tenant
  });
};

// Default content for Contact page (used as fallback)
export const defaultContactContent: PageContent = {
  hero: {
    title: "Contact Drive917",
    subtitle: "Get in touch for premium vehicle rentals, chauffeur services, and exclusive offers in Los Angeles.",
  },
  contact_info: {
    phone: {
      number: "+1 800 123 4567",
      availability: "24 hours a day, 7 days a week, 365 days a year",
    },
    email: {
      address: "info@drive247.com",
      response_time: "Response within 2 hours during business hours (CST)",
    },
    office: {
      address: "123 Luxury Lane, Dallas, TX",
    },
    whatsapp: {
      number: "+18001234567",
      description: "Quick response for urgent inquiries",
    },
  },
  contact_form: {
    title: "Send Us a Message",
    subtitle: "We typically reply within 2 hours during business hours.",
    success_message: "Thank you for contacting Drive247. Our concierge team will respond within 2 hours during business hours (CST).",
    gdpr_text: "I consent to being contacted regarding my inquiry.",
    submit_button_text: "Send Message",
    subject_options: ["General Inquiry", "Corporate Rental", "Vehicle Availability", "Partnerships"],
  },
  trust_badges: {
    badges: [
      {
        icon: "shield",
        label: "Secure",
        tooltip: "Your data and booking details are encrypted and secure",
      },
      {
        icon: "lock",
        label: "Confidential",
        tooltip: "All information is kept strictly confidential",
      },
      {
        icon: "clock",
        label: "24/7 Support",
        tooltip: "Our concierge team is available around the clock",
      },
    ],
  },
  seo: {
    title: "Contact Drive917 — Los Angeles Luxury Car Rentals",
    description: "Get in touch with Drive917 for premium vehicle rentals, chauffeur services, and exclusive offers in Los Angeles.",
    keywords: "contact Drive917, luxury car rental Los Angeles, premium vehicle rental contact, chauffeur service inquiry",
  },
  pwa_install: {
    title: "Install Drive917",
    description: "Scan the QR code to add Drive917 to your home screen for fast, seamless bookings in Los Angeles and beyond.",
  },
};
// Default content for Reviews page (used as fallback)
export const defaultReviewsContent: PageContent = {
  hero: {
    title: "Customer Reviews",
    subtitle: "What our customers say about their luxury vehicle rental experience.",
  },
  feedback_cta: {
    title: "Would you like to share your experience?",
    description: "We value your feedback and would love to hear about your rental experience with Drive917.",
    button_text: "Submit Feedback",
    empty_state_message: "Be the first to share your Drive917 experience.",
  },
  seo: {
    title: "Drive917 — Customer Reviews",
    description: "Read verified customer reviews of Drive917's luxury car rentals. Real experiences from our distinguished clientele.",
    keywords: "Drive917 reviews, luxury car rental reviews, customer testimonials, verified reviews",
  },
};


// Default content for About page (used as fallback)
export const defaultAboutContent: PageContent = {
  hero: {
    title: "About Drive247",
    subtitle: "Setting the standard for premium luxury vehicle rentals across the United States.",
  },
  about_story: {
    title: "Excellence in Every Rental",
    founded_year: "2010",
    content: `<p>Drive247 was founded with a simple vision: to provide the highest standard of premium vehicle rentals with unmatched flexibility and service.</p>
<p>What began as a boutique rental service has grown into the trusted choice for executives, professionals, and discerning clients who demand the finest vehicles with exceptional service.</p>
<p>Our founders recognized the need for a rental service that truly understood the unique requirements of premium vehicle hire—offering flexible daily, weekly, and monthly rates without compromising on quality.</p>
<p>Discretion, reliability, and uncompromising quality became the pillars upon which Drive247 was built.</p>
<p>Drive247 operates a fleet of the finest vehicles, each maintained to the highest standards and equipped with premium amenities. From Rolls-Royce to Range Rover, every vehicle represents automotive excellence.</p>
<p>We offer flexible rental periods tailored to your needs—whether it's a day, a week, or a month, we provide premium vehicles with transparent pricing and exceptional service.</p>
<p>Our commitment extends beyond just providing vehicles. We ensure every rental includes comprehensive insurance, 24/7 support, and meticulous vehicle preparation.</p>
<p>We will never claim to be the biggest company — but what we are, is the pinnacle of excellence in luxury vehicle rentals.</p>
<p>This commitment creates a service that is second to none:</p>
<ul>
<li>Flexible daily, weekly, and monthly rental options</li>
<li>The finest luxury vehicles in the USA</li>
<li>Transparent pricing with no hidden fees</li>
<li>24/7 customer support and roadside assistance</li>
<li>Immaculate vehicles delivered to your door</li>
</ul>
<p>This is more than a rental service — it's a new standard in luxury vehicle hire.</p>`,
  },
  stats: {
    items: [
      {
        icon: "clock",
        label: "YEARS EXPERIENCE",
        value: "",
        suffix: "+",
        use_dynamic: true,
        dynamic_source: "years_experience",
      },
      {
        icon: "car",
        label: "RENTALS COMPLETED",
        value: "",
        suffix: "+",
        use_dynamic: true,
        dynamic_source: "total_rentals",
      },
      {
        icon: "crown",
        label: "PREMIUM VEHICLES",
        value: "",
        suffix: "+",
        use_dynamic: true,
        dynamic_source: "active_vehicles",
      },
      {
        icon: "star",
        label: "CLIENT RATING",
        value: "",
        suffix: "",
        use_dynamic: true,
        dynamic_source: "avg_rating",
      },
    ],
  },
  why_choose_us: {
    title: "Why Choose Us",
    items: [
      {
        icon: "lock",
        title: "Privacy & Discretion",
        description: "Your rental details remain completely private. We maintain strict confidentiality for all our distinguished clients.",
      },
      {
        icon: "crown",
        title: "Premium Fleet",
        description: "From the Rolls-Royce Phantom to the Range Rover Autobiography, every vehicle represents automotive excellence and comfort.",
      },
      {
        icon: "shield",
        title: "Flexible Terms",
        description: "Choose from daily, weekly, or monthly rental periods. Competitive rates with no hidden fees or surprises.",
      },
      {
        icon: "clock",
        title: "24/7 Availability",
        description: "Whether weekday or weekend, we're ready to respond at a moment's notice — anywhere across the USA.",
      },
    ],
  },
  faq_cta: {
    title: "Still have questions?",
    description: "Our team is here to help. Contact us for personalized assistance.",
    button_text: "Call Us",
  },
  final_cta: {
    title: "Ready to Experience Premium Luxury?",
    description: "Join our distinguished clients and enjoy world-class vehicle rental service.",
    tagline: "Professional • Discreet • 24/7 Availability",
  },
  seo: {
    title: "About Drive247 — Premium Luxury Car Rentals",
    description: "Discover Drive247 — the USA's trusted name in premium car rentals, offering unmatched quality, flexibility, and discretion.",
    keywords: "about Drive247, luxury car rental USA, premium vehicle hire, executive car rental, luxury fleet",
  },
};

// Default content for Promotions page (used as fallback)
export const defaultPromotionsContent: PageContent = {
  promotions_hero: {
    headline: "Promotions & Offers",
    subheading: "Exclusive rental offers with transparent savings.",
    primary_cta_text: "View Fleet & Pricing",
    primary_cta_href: "/fleet",
    secondary_cta_text: "Book Now",
    carousel_images: defaultPromotionsCarouselImages,
  },
  how_it_works: {
    title: "How Promotions Work",
    subtitle: "Simple steps to save on your luxury car rental",
    steps: [
      {
        number: "1",
        title: "Select Offer",
        description: "Browse active promotions and choose your preferred deal",
      },
      {
        number: "2",
        title: "Choose Vehicle",
        description: "Select from eligible vehicles in our premium fleet",
      },
      {
        number: "3",
        title: "Apply at Checkout",
        description: "Discount automatically applied with promo code",
      },
    ],
  },
  empty_state: {
    title_active: "No active promotions right now",
    title_default: "No promotions found",
    description: "Check back soon or browse our Fleet & Pricing.",
    button_text: "Browse Fleet & Pricing",
  },
  terms: {
    title: "Terms & Conditions",
    terms: [
      "Promotions are subject to availability and vehicle eligibility",
      "Discounts cannot be combined with other offers",
      "Valid for new bookings only during the promotional period",
      "Promo codes must be applied at the time of booking",
      "Drive 917 reserves the right to modify or cancel promotions at any time",
      "Standard rental terms and conditions apply",
    ],
  },
  seo: {
    title: "Promotions & Offers | Drive 917 - Exclusive Luxury Car Rental Deals",
    description: "Exclusive deals on luxury car rentals with daily, weekly, and monthly rates. Limited-time Drive 917 offers with transparent savings.",
    keywords: "luxury car rental deals, car rental promotions, exclusive offers, discount car hire, Drive 917 deals",
  },
};

// Default content for Fleet & Pricing page
export const defaultFleetContent: PageContent = {
  fleet_hero: {
    headline: "Fleet & Pricing",
    subheading: "Browse our premium vehicles with clear daily, weekly, and monthly rates.",
    background_image: "",
    carousel_images: defaultFleetCarouselImages,
    primary_cta_text: "Book Now",
    secondary_cta_text: "View Fleet Below",
  },
  rental_rates: {
    section_title: "Flexible Rental Rates",
    daily: { title: "Daily", description: "Ideal for short stays and one-day hires." },
    weekly: { title: "Weekly", description: "Perfect balance of flexibility and value." },
    monthly: { title: "Monthly", description: "Exclusive long-term rates for regular clients." },
  },
  inclusions: {
    section_title: "Every Drive917 Rental Includes",
    section_subtitle: "Peace of mind and premium service come standard with every vehicle.",
    standard_title: "Standard Inclusions",
    standard_items: [
      { icon: "Shield", title: "Comprehensive Insurance Coverage" },
      { icon: "Phone", title: "24/7 Roadside Assistance" },
      { icon: "MapPin", title: "Unlimited Mileage" },
      { icon: "Fuel", title: "Full Tank of Premium Fuel" },
      { icon: "User", title: "Professional Vehicle Handover" },
      { icon: "Sparkles", title: "Vehicle Valeting & Cleaning" },
    ],
    premium_title: "Premium Add-ons",
    premium_items: [
      { icon: "User", title: "Chauffeur Service (per hour)" },
      { icon: "Plane", title: "Airport Meet & Greet" },
      { icon: "User", title: "Additional Driver" },
      { icon: "MapPin", title: "GPS Navigation System" },
    ],
  },
  extras: {
    items: [
      { name: "Child Safety Seat", price: 15, description: "Per day" },
      { name: "Mobile WiFi Hotspot", price: 10, description: "Per day" },
      { name: "Delivery & Collection", price: 50, description: "Within 25 miles" },
      { name: "Extended Insurance", price: 25, description: "Per day" },
    ],
    footer_text: "All add-ons can be selected and customized during booking.",
  },
  seo: {
    title: "Fleet & Pricing | Drive 917 - Premium Luxury Car Rentals",
    description: "Browse our exclusive fleet of luxury vehicles including Rolls-Royce, Bentley, and Range Rover. Transparent daily, weekly, and monthly rental rates.",
    keywords: "luxury car rental pricing, Rolls-Royce rental rates, premium vehicle hire, executive car rental",
  },
};

// Default content for Home page
export const defaultHomeContent: PageContent = {
  home_hero: {
    headline: "Reliable Car Rentals You Can Count On",
    subheading: "Quality vehicles. Transparent pricing. Exceptional service.",
    background_image: "",
    carousel_images: defaultHomeCarouselImages,
    phone_number: "08001234567",
    phone_cta_text: "Call 0800 123 4567",
    book_cta_text: "Book Now",
    trust_line: "Premium Fleet • Flexible Rates • 24/7 Support",
  },
  promo_badge: {
    enabled: true,
    discount_amount: "20%",
    discount_label: "OFF",
    line1: "When You Book",
    line2: "Online",
  },
  service_highlights: {
    title: "Why Choose Drive917",
    subtitle: "Delivering excellence through premium vehicle rentals and exceptional service.",
    services: [
      { icon: "ThumbsUp", title: "Outstanding Services", description: "Experience top-tier car rental services tailored for your convenience. Our well-maintained vehicles, transparent pricing, and seamless booking process ensure a hassle-free journey every time." },
      { icon: "Users", title: "Name for Quality Vehicles", description: "Our high-quality rental vehicles are regularly maintained to provide you with a smooth and reliable driving experience." },
      { icon: "MapPin", title: "GPS on Every Vehicle!", description: "Never lose your way with our built-in GPS navigation system. Every rental car comes equipped with GPS to ensure a smooth, stress-free journey." },
      { icon: "Baby", title: "Baby Chairs/Booster Seats", description: "Your child's safety is our priority! We provide baby chairs and booster seats to ensure a secure and comfortable ride for your little ones." },
      { icon: "Settings", title: "AT/MT Transmission", description: "Choose the driving experience that suits you best! We offer both Automatic (AT) and Manual (MT) transmission vehicles." },
      { icon: "Headphones", title: "24 Hours Support", description: "We're here for you anytime, anywhere! Our dedicated support team is available 24/7 to assist you with bookings, inquiries, and roadside assistance." },
    ],
  },
  booking_header: {
    title: "Book Your Rental",
    subtitle: "Quick, easy, and affordable car rentals in Dallas — from pickup to drop-off, we've got you covered.",
    trust_points: ["Dallas–Fort Worth Area", "Transparent Rates", "24/7 Support"],
  },
  testimonials_header: {
    title: "Why Dallas Drivers Choose Drive917",
  },
  home_cta: {
    title: "Ready to Book Your Dallas Rental?",
    description: "Quick, easy, and affordable car rentals across Dallas and the DFW area. Friendly service, transparent pricing, and clean vehicles every time.",
    primary_cta_text: "Book Now",
    secondary_cta_text: "Get in Touch",
    trust_points: ["Reliable Service", "Clean Vehicles", "24/7 Support"],
  },
  contact_card: {
    title: "Have Questions About Your Rental?",
    description: "We're here to help 7 days a week. Reach out to our Dallas team for quick answers and booking support.",
    phone_number: "+19725156635",
    email: "info@drive917.com",
    call_button_text: "Call Now",
    email_button_text: "Email Us",
  },
  seo: {
    title: "Premium Luxury Car Rentals",
    description: "Rent premium luxury vehicles with Drive917. Flexible daily, weekly, and monthly rates. Top-tier fleet and exceptional service.",
    keywords: "luxury car rental, premium vehicle hire, exotic car rental, Dallas car rental",
  },
};

// Default content for Privacy Policy page
export const defaultPrivacyContent: PageContent = {
  privacy_content: {
    title: "Privacy Policy",
    content: `<h2>Introduction</h2>
<p>Drive917 is committed to protecting your privacy and ensuring the security of your personal information. This policy outlines how we collect, use, and safeguard your data.</p>

<h2>Information We Collect</h2>
<p>We collect information necessary to provide our services, including:</p>
<ul>
<li>Contact details (name, email, phone number)</li>
<li>Booking information (pickup/drop-off locations, dates, times)</li>
<li>Payment information (processed securely through third-party providers)</li>
<li>Service preferences and special requirements</li>
</ul>

<h2>How We Use Your Information</h2>
<p>Your information is used exclusively for:</p>
<ul>
<li>Providing and managing our rental services</li>
<li>Processing bookings and payments</li>
<li>Communicating with you about your bookings</li>
<li>Improving our services based on your feedback</li>
<li>Complying with legal obligations</li>
</ul>

<h2>Data Security</h2>
<p>We implement industry-standard security measures to protect your personal information from unauthorized access, disclosure, or misuse. All data is encrypted both in transit and at rest.</p>

<h2>Your Rights</h2>
<p>You have the right to:</p>
<ul>
<li>Access your personal data</li>
<li>Correct inaccurate data</li>
<li>Request deletion of your data</li>
<li>Object to processing of your data</li>
<li>Data portability</li>
</ul>

<h2>Contact Us</h2>
<p>For any privacy-related questions or requests, please contact us at <a href="mailto:privacy@drive917.com">privacy@drive917.com</a></p>`,
    last_updated: new Date().toISOString().split('T')[0],
  },
  seo: {
    title: "Privacy Policy | Drive 917",
    description: "Learn about how Drive917 collects, uses, and protects your personal information.",
    keywords: "privacy policy, data protection, Drive917 privacy",
  },
};

// Default content for Terms of Service page
export const defaultTermsContent: PageContent = {
  terms_content: {
    title: "Terms of Service",
    content: `<h2>Service Agreement</h2>
<p>By booking our services, you agree to these terms and conditions. Drive917 reserves the right to modify these terms at any time, with changes effective immediately upon posting.</p>

<h2>Booking and Payment</h2>
<ul>
<li>All bookings are subject to availability</li>
<li>Payment is required at the time of booking unless credit terms have been agreed</li>
<li>Cancellations made less than 24 hours before pickup may incur a 50% cancellation fee</li>
<li>No-shows will be charged the full booking amount</li>
</ul>

<h2>Service Standards</h2>
<p>We are committed to providing the highest standards of service:</p>
<ul>
<li>All vehicles are maintained to the highest standards</li>
<li>Comprehensive insurance coverage is maintained on all vehicles</li>
<li>24/7 roadside assistance is included with every rental</li>
</ul>

<h2>Client Responsibilities</h2>
<ul>
<li>Provide accurate pickup and destination information</li>
<li>Be ready at the agreed pickup time</li>
<li>Treat our vehicles with respect</li>
<li>Report any issues immediately</li>
<li>Return the vehicle in the same condition as received</li>
</ul>

<h2>Liability</h2>
<p>While we take every precaution to ensure your safety and comfort, Drive917's liability is limited to the value of the service provided. We are not liable for delays caused by circumstances beyond our control, including traffic, weather, or road conditions.</p>

<h2>Confidentiality</h2>
<p>All client information is kept strictly confidential unless disclosure is required by law.</p>`,
    last_updated: new Date().toISOString().split('T')[0],
  },
  seo: {
    title: "Terms of Service | Drive 917",
    description: "Read the terms and conditions for Drive917 car rental services.",
    keywords: "terms of service, rental terms, Drive917 terms",
  },
};

// Default content for Site Settings
export const defaultSiteSettings: PageContent = {
  logo: {
    logo_url: "",
    logo_alt: "Drive 917",
    favicon_url: "",
  },
  site_contact: {
    phone: "+19725156635",
    phone_display: "(972) 515-6635",
    email: "info@drive917.com",
    address_line1: "",
    address_line2: "",
    city: "Dallas",
    state: "TX",
    zip: "",
    country: "USA",
    google_maps_url: "",
  },
  social: {
    facebook: "",
    instagram: "",
    twitter: "",
    linkedin: "",
    youtube: "",
    tiktok: "",
  },
  footer_settings: {
    copyright_text: `© ${new Date().getFullYear()} Drive 917. All rights reserved.`,
    tagline: "Premium Car Rentals in Dallas",
  },
};

// Helper to merge CMS content with defaults
export const mergeWithDefaults = (
  cmsContent: PageContent | null | undefined,
  defaults: PageContent
): PageContent => {
  if (!cmsContent) return defaults;

  return {
    hero: cmsContent.hero || defaults.hero,
    contact_info: cmsContent.contact_info || defaults.contact_info,
    contact_form: cmsContent.contact_form || defaults.contact_form,
    trust_badges: cmsContent.trust_badges || defaults.trust_badges,
    seo: cmsContent.seo || defaults.seo,
    pwa_install: cmsContent.pwa_install || defaults.pwa_install,
    feedback_cta: cmsContent.feedback_cta || defaults.feedback_cta,
    about_story: cmsContent.about_story || defaults.about_story,
    stats: cmsContent.stats || defaults.stats,
    why_choose_us: cmsContent.why_choose_us || defaults.why_choose_us,
    faq_cta: cmsContent.faq_cta || defaults.faq_cta,
    final_cta: cmsContent.final_cta || defaults.final_cta,
    // Promotions page
    promotions_hero: cmsContent.promotions_hero || defaults.promotions_hero,
    how_it_works: cmsContent.how_it_works || defaults.how_it_works,
    empty_state: cmsContent.empty_state || defaults.empty_state,
    terms: cmsContent.terms || defaults.terms,
    // Fleet page
    fleet_hero: cmsContent.fleet_hero || defaults.fleet_hero,
    rental_rates: cmsContent.rental_rates || defaults.rental_rates,
    inclusions: cmsContent.inclusions || defaults.inclusions,
    extras: cmsContent.extras || defaults.extras,
    // Home page
    home_hero: cmsContent.home_hero || defaults.home_hero,
    promo_badge: cmsContent.promo_badge || defaults.promo_badge,
    home_cta: cmsContent.home_cta || defaults.home_cta,
    service_highlights: cmsContent.service_highlights || defaults.service_highlights,
    booking_header: cmsContent.booking_header || defaults.booking_header,
    testimonials_header: cmsContent.testimonials_header || defaults.testimonials_header,
    contact_card: cmsContent.contact_card || defaults.contact_card,
    // Privacy/Terms pages
    privacy_content: cmsContent.privacy_content || defaults.privacy_content,
    terms_content: cmsContent.terms_content || defaults.terms_content,
    // Site settings
    logo: cmsContent.logo || defaults.logo,
    site_contact: cmsContent.site_contact || defaults.site_contact,
    social: cmsContent.social || defaults.social,
    footer_settings: cmsContent.footer_settings || defaults.footer_settings,
  };
};
