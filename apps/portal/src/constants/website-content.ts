/**
 * Website Content (CMS) Constants
 *
 * Constants specific to the Website Content/CMS page and CMS default content
 */

// Type imports for CMS defaults
import type {
  HomeHeroContent,
  PromoBadgeContent,
  HomeCTAContent,
  SEOContent,
  ServiceHighlightsContent,
  BookingHeaderContent,
  TestimonialsHeaderContent,
  ContactCardContent,
  LogoContent,
  SiteContactContent,
  SocialLinksContent,
  FooterContent,
  AboutStoryContent,
  WhyChooseUsContent,
  CTAContent,
  StatsContent,
  HeroContent,
  ContactInfoContent,
  ContactFormContent,
  TrustBadgesContent,
  FleetHeroContent,
  RentalRatesContent,
  InclusionsContent,
  FleetCTAContent,
  PromotionsHeroContent,
  HowItWorksContent,
  EmptyStateContent,
  TermsContent,
  PrivacyPolicyContent,
  TermsOfServiceContent,
} from "@/types/cms";

// ============================================
// CMS SECTION CONSTANTS
// ============================================

export const CMS_SECTION = {
  HOME: 'home',
  ABOUT: 'about',
  CONTACT: 'contact',
  FLEET: 'fleet',
  PROMOTIONS: 'promotions',
  TESTIMONIALS: 'testimonials',
  PRIVACY: 'privacy',
  TERMS: 'terms',
  FAQ: 'faq',
  SITE_SETTINGS: 'site_settings',
} as const;

export type CmsSection = typeof CMS_SECTION[keyof typeof CMS_SECTION];

// ============================================
// CMS CONTENT TYPE CONSTANTS
// ============================================

export const CMS_CONTENT_TYPE = {
  TEXT: 'text',
  RICH_TEXT: 'rich_text',
  IMAGE: 'image',
  VIDEO: 'video',
  LINK: 'link',
  BUTTON: 'button',
  SECTION: 'section',
  BANNER: 'banner',
  CARD: 'card',
  LIST: 'list',
} as const;

export type CmsContentType = typeof CMS_CONTENT_TYPE[keyof typeof CMS_CONTENT_TYPE];

// ============================================
// CMS STATUS CONSTANTS
// ============================================

export const CMS_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  SCHEDULED: 'scheduled',
  ARCHIVED: 'archived',
} as const;

export type CmsStatus = typeof CMS_STATUS[keyof typeof CMS_STATUS];

// ============================================
// CMS MEDIA UPLOAD CONSTANTS
// ============================================

export const CMS_MEDIA = {
  /** Maximum file size for CMS media (5 MB) */
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,

  /** Allowed image types */
  ALLOWED_IMAGE_TYPES: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/svg+xml',
  ] as const,

  /** Allowed video types */
  ALLOWED_VIDEO_TYPES: [
    'video/mp4',
    'video/webm',
    'video/ogg',
  ] as const,

  /** Storage bucket name */
  BUCKET: 'cms-media',

  /** Image optimization */
  OPTIMIZATION: {
    QUALITY: 85,
    MAX_WIDTH: 1920,
    MAX_HEIGHT: 1080,
  },
} as const;

// ============================================
// CMS VALIDATION
// ============================================

export const CMS_VALIDATION = {
  /** Maximum content length */
  MAX_CONTENT_LENGTH: 10000,

  /** Maximum headline length */
  MAX_HEADLINE_LENGTH: 100,

  /** Minimum headline length */
  MIN_HEADLINE_LENGTH: 5,

  /** Maximum URL length */
  MAX_URL_LENGTH: 500,

  /** Maximum meta description length */
  MAX_META_DESCRIPTION: 160,

  /** Maximum meta keywords */
  MAX_META_KEYWORDS: 10,
} as const;

// ============================================
// CMS PAGE TYPES
// ============================================

export const CMS_PAGE_TYPE = {
  HOME: 'home',
  LANDING: 'landing',
  CONTENT: 'content',
  BLOG_POST: 'blog_post',
  LEGAL: 'legal',
  CUSTOM: 'custom',
} as const;

export type CmsPageType = typeof CMS_PAGE_TYPE[keyof typeof CMS_PAGE_TYPE];

// ============================================
// CMS FILTER OPTIONS
// ============================================

export const CMS_FILTER = {
  ALL: 'all',
  PUBLISHED: 'published',
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  BY_SECTION: 'by_section',
  BY_TYPE: 'by_type',
} as const;

export type CmsFilter = typeof CMS_FILTER[keyof typeof CMS_FILTER];

// ============================================
// CMS SORT OPTIONS
// ============================================

export const CMS_SORT = {
  TITLE_ASC: 'title_asc',
  TITLE_DESC: 'title_desc',
  DATE_ASC: 'date_asc',
  DATE_DESC: 'date_desc',
  MODIFIED_ASC: 'modified_asc',
  MODIFIED_DESC: 'modified_desc',
  STATUS_ASC: 'status_asc',
  STATUS_DESC: 'status_desc',
} as const;

export type CmsSort = typeof CMS_SORT[keyof typeof CMS_SORT];

// ============================================
// CMS PAGINATION
// ============================================

export const CMS_PAGINATION = {
  /** Default page size for CMS listings */
  DEFAULT_PAGE_SIZE: 25,

  /** Available page size options */
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100] as const,
} as const;

// ============================================
// CMS VERSIONING
// ============================================

export const CMS_VERSIONING = {
  /** Enable versioning */
  ENABLED: true,

  /** Maximum versions to keep */
  MAX_VERSIONS: 10,

  /** Auto-save interval (seconds) */
  AUTO_SAVE_INTERVAL: 30,
} as const;

// ============================================
// CMS SEO SETTINGS
// ============================================

export const CMS_SEO = {
  /** Default meta robots */
  DEFAULT_ROBOTS: 'index, follow',

  /** Default OG type */
  DEFAULT_OG_TYPE: 'website',

  /** Enable sitemap generation */
  GENERATE_SITEMAP: true,

  /** Sitemap priority */
  DEFAULT_PRIORITY: 0.8,

  /** Change frequency */
  DEFAULT_CHANGE_FREQ: 'weekly',
} as const;

// ============================================
// CMS DEFAULT CONTENT
// ============================================
// Default CMS content for Drive 917 landing page

// ============================================
// HOME PAGE DEFAULTS
// ============================================

export const DEFAULT_HOME_HERO: HomeHeroContent = {
  headline: "Premium Car Rentals in Dallas",
  subheading: "Experience luxury and reliability with our handpicked fleet. Flexible daily, weekly, and monthly rentals tailored to your needs.",
  background_image: "",
  phone_number: "+19725156635",
  phone_cta_text: "Call Now",
  book_cta_text: "Book Your Ride",
  trust_line: "Trusted by 500+ customers in the Dallas-Fort Worth area",
};

export const DEFAULT_PROMO_BADGE: PromoBadgeContent = {
  enabled: true,
  discount_amount: "15%",
  discount_label: "OFF",
  line1: "First Week Rental",
  line2: "Limited Time Offer",
};

export const DEFAULT_SERVICE_HIGHLIGHTS: ServiceHighlightsContent = {
  title: "Why Choose Drive 917?",
  subtitle: "We deliver exceptional service with every rental",
  services: [
    {
      icon: "car",
      title: "Premium Fleet",
      description: "Late-model vehicles maintained to the highest standards",
    },
    {
      icon: "clock",
      title: "Flexible Terms",
      description: "Daily, weekly, or monthly rentals to fit your schedule",
    },
    {
      icon: "shield",
      title: "Full Insurance",
      description: "Comprehensive coverage included with every rental",
    },
    {
      icon: "headphones",
      title: "24/7 Support",
      description: "Round-the-clock assistance whenever you need it",
    },
  ],
};

export const DEFAULT_BOOKING_HEADER: BookingHeaderContent = {
  title: "Find Your Perfect Ride",
  subtitle: "Browse our available vehicles and book in minutes",
  trust_points: [
    "No hidden fees",
    "Free cancellation",
    "Instant confirmation",
  ],
};

export const DEFAULT_TESTIMONIALS_HEADER: TestimonialsHeaderContent = {
  title: "What Our Customers Say",
};

export const DEFAULT_HOME_CTA: HomeCTAContent = {
  title: "Ready to Hit the Road?",
  description: "Join hundreds of satisfied customers who trust Drive 917 for their transportation needs. Book your vehicle today and experience the difference.",
  primary_cta_text: "Browse Vehicles",
  secondary_cta_text: "Contact Us",
  trust_points: [
    "Competitive rates",
    "Well-maintained vehicles",
    "Excellent customer service",
  ],
};

export const DEFAULT_CONTACT_CARD: ContactCardContent = {
  title: "Need Help?",
  description: "Our team is ready to assist you with any questions about our rental services.",
  phone_number: "+19725156635",
  email: "info@drive917.com",
  call_button_text: "Call Us",
  email_button_text: "Email Us",
};

export const DEFAULT_HOME_SEO: SEOContent = {
  title: "Drive 917 | Premium Car Rentals in Dallas, TX",
  description: "Rent premium vehicles in Dallas-Fort Worth. Daily, weekly & monthly rentals. Competitive rates, flexible terms, and exceptional service. Book online today!",
  keywords: "car rental dallas, rent a car dallas tx, premium car rental, weekly car rental, monthly car rental, drive 917",
};

// ============================================
// SITE SETTINGS DEFAULTS
// ============================================

export const DEFAULT_LOGO: LogoContent = {
  logo_url: "",
  logo_alt: "Drive 917",
  favicon_url: "",
};

export const DEFAULT_SITE_CONTACT: SiteContactContent = {
  phone: "+19725156635",
  phone_display: "(972) 515-6635",
  email: "info@drive917.com",
  address_line1: "1234 Main Street",
  address_line2: "Suite 100",
  city: "Dallas",
  state: "TX",
  zip: "75201",
  country: "USA",
  google_maps_url: "",
};

export const DEFAULT_SOCIAL_LINKS: SocialLinksContent = {
  facebook: "https://facebook.com/drive917",
  instagram: "https://instagram.com/drive917",
  twitter: "",
  linkedin: "",
  youtube: "",
  tiktok: "",
};

export const DEFAULT_FOOTER: FooterContent = {
  copyright_text: `© ${new Date().getFullYear()} Drive 917. All rights reserved.`,
  tagline: "Premium Car Rentals in Dallas",
};

// ============================================
// ABOUT PAGE DEFAULTS
// ============================================

export const DEFAULT_ABOUT_HERO: HeroContent = {
  title: "About Drive 917",
  subtitle: "Your trusted partner for premium car rentals in Dallas-Fort Worth",
};

export const DEFAULT_ABOUT_STORY: AboutStoryContent = {
  title: "Our Story",
  founded_year: "2020",
  content: `<p>Drive 917 was founded with a simple mission: to provide Dallas-Fort Worth residents and visitors with reliable, affordable, and premium vehicle rentals.</p>
<p>What started as a small fleet of carefully selected vehicles has grown into one of the most trusted car rental services in the metroplex. Our commitment to quality, transparency, and customer satisfaction has earned us a loyal customer base and a reputation for excellence.</p>
<p>Every vehicle in our fleet is handpicked, thoroughly inspected, and maintained to the highest standards. We believe that renting a car should be a seamless experience, from booking to returning the keys.</p>`,
};

export const DEFAULT_WHY_CHOOSE_US: WhyChooseUsContent = {
  title: "Why Choose Us",
  items: [
    {
      icon: "star",
      title: "Quality Vehicles",
      description: "Every car in our fleet is late-model, well-maintained, and thoroughly cleaned before each rental.",
    },
    {
      icon: "dollar-sign",
      title: "Transparent Pricing",
      description: "No hidden fees or surprise charges. The price you see is the price you pay.",
    },
    {
      icon: "users",
      title: "Personal Service",
      description: "Our dedicated team provides personalized attention to every customer.",
    },
    {
      icon: "clock",
      title: "Flexible Options",
      description: "Daily, weekly, and monthly rentals to accommodate any schedule or budget.",
    },
  ],
};

export const DEFAULT_ABOUT_CTA: CTAContent = {
  title: "Ready to Experience the Difference?",
  description: "Browse our fleet and find the perfect vehicle for your needs.",
  button_text: "View Our Fleet",
};

export const DEFAULT_ABOUT_STATS: StatsContent = {
  items: [
    { icon: "car", label: "Vehicles in Fleet", value: "50", suffix: "+", use_dynamic: true, dynamic_source: "vehicles" },
    { icon: "users", label: "Happy Customers", value: "500", suffix: "+", use_dynamic: true, dynamic_source: "customers" },
    { icon: "star", label: "5-Star Reviews", value: "200", suffix: "+", use_dynamic: false },
    { icon: "calendar", label: "Years in Business", value: "4", suffix: "+", use_dynamic: false },
  ],
};

export const DEFAULT_ABOUT_SEO: SEOContent = {
  title: "About Us | Drive 917 - Premium Car Rentals Dallas",
  description: "Learn about Drive 917, Dallas's trusted car rental company. Quality vehicles, transparent pricing, and exceptional service since 2020.",
  keywords: "about drive 917, dallas car rental company, car rental dallas about us",
};

// ============================================
// CONTACT PAGE DEFAULTS
// ============================================

export const DEFAULT_CONTACT_HERO: HeroContent = {
  title: "Contact Us",
  subtitle: "We're here to help with all your rental needs",
};

export const DEFAULT_CONTACT_INFO: ContactInfoContent = {
  phone: {
    number: "+19725156635",
    availability: "Mon-Sat: 9AM-7PM, Sun: 10AM-5PM",
  },
  email: {
    address: "info@drive917.com",
    response_time: "We respond within 2 hours",
  },
  office: {
    address: "1234 Main Street, Suite 100, Dallas, TX 75201",
  },
  whatsapp: {
    number: "+19725156635",
    description: "Quick responses via WhatsApp",
  },
};

export const DEFAULT_CONTACT_FORM: ContactFormContent = {
  title: "Send Us a Message",
  subtitle: "Fill out the form below and we'll get back to you shortly",
  success_message: "Thank you for your message! We'll be in touch soon.",
  gdpr_text: "By submitting this form, you agree to our Privacy Policy and consent to being contacted regarding your inquiry.",
  submit_button_text: "Send Message",
  subject_options: [
    "General Inquiry",
    "Booking Question",
    "Vehicle Availability",
    "Pricing Information",
    "Feedback",
    "Other",
  ],
};

export const DEFAULT_TRUST_BADGES: TrustBadgesContent = {
  badges: [
    { icon: "shield-check", label: "Fully Insured", tooltip: "All rentals include comprehensive insurance coverage" },
    { icon: "clock", label: "24/7 Support", tooltip: "Round-the-clock customer assistance" },
    { icon: "star", label: "5-Star Rated", tooltip: "Consistently rated 5 stars by our customers" },
    { icon: "award", label: "Licensed & Bonded", tooltip: "Fully licensed car rental service" },
  ],
};

export const DEFAULT_CONTACT_SEO: SEOContent = {
  title: "Contact Us | Drive 917 - Premium Car Rentals Dallas",
  description: "Get in touch with Drive 917 for all your car rental needs in Dallas. Call us, email, or visit our location. We're here to help!",
  keywords: "contact drive 917, dallas car rental contact, car rental phone number dallas",
};

// ============================================
// FLEET PAGE DEFAULTS
// ============================================

export const DEFAULT_FLEET_HERO: FleetHeroContent = {
  headline: "Our Premium Fleet",
  subheading: "Choose from our carefully curated selection of quality vehicles",
  background_image: "",
  primary_cta_text: "View Available Cars",
  secondary_cta_text: "Contact Us",
};

export const DEFAULT_RENTAL_RATES: RentalRatesContent = {
  section_title: "Flexible Rental Options",
  daily: {
    title: "Daily Rentals",
    description: "Perfect for short trips and day-to-day needs. Minimum 1 day rental.",
  },
  weekly: {
    title: "Weekly Rentals",
    description: "Save more with our weekly rates. Ideal for vacations and extended trips.",
  },
  monthly: {
    title: "Monthly Rentals",
    description: "Best value for long-term needs. Great for business or temporary transportation.",
  },
};

export const DEFAULT_INCLUSIONS: InclusionsContent = {
  section_title: "What's Included",
  section_subtitle: "Every rental comes with these standard features",
  standard_title: "Standard Inclusions",
  standard_items: [
    { icon: "shield", title: "Basic Insurance" },
    { icon: "fuel", title: "Full Tank Policy" },
    { icon: "map", title: "Unlimited Miles" },
    { icon: "headphones", title: "24/7 Roadside Assistance" },
  ],
  premium_title: "Premium Add-ons",
  premium_items: [
    { icon: "shield-check", title: "Premium Insurance" },
    { icon: "wifi", title: "Mobile Hotspot" },
    { icon: "baby", title: "Child Seat" },
    { icon: "navigation", title: "GPS Navigation" },
  ],
};

export const DEFAULT_FLEET_CTA: FleetCTAContent = {
  primary_text: "Book Now",
  primary_href: "/book",
  secondary_text: "Call Us",
  secondary_href: "tel:+19725156635",
};

export const DEFAULT_FLEET_SEO: SEOContent = {
  title: "Our Fleet | Drive 917 - Premium Car Rentals Dallas",
  description: "Browse our premium fleet of rental vehicles in Dallas. Sedans, SUVs, and luxury cars available for daily, weekly, and monthly rentals.",
  keywords: "rental cars dallas, premium car fleet, rent sedan dallas, rent suv dallas, luxury car rental",
};

// ============================================
// PROMOTIONS PAGE DEFAULTS
// ============================================

export const DEFAULT_PROMOTIONS_HERO: PromotionsHeroContent = {
  headline: "Special Offers & Promotions",
  subheading: "Take advantage of our exclusive deals and save on your next rental",
  primary_cta_text: "View Current Deals",
  primary_cta_href: "#promotions",
  secondary_cta_text: "Browse Fleet",
  background_image: "",
};

export const DEFAULT_HOW_IT_WORKS: HowItWorksContent = {
  title: "How to Redeem",
  subtitle: "Getting your discount is easy",
  steps: [
    { number: "1", title: "Choose Your Vehicle", description: "Browse our fleet and select the perfect car for your needs" },
    { number: "2", title: "Select a Promotion", description: "Pick an active promotion that applies to your rental" },
    { number: "3", title: "Book & Save", description: "Complete your booking and enjoy the discount automatically applied" },
  ],
};

export const DEFAULT_EMPTY_STATE: EmptyStateContent = {
  title_active: "No Active Promotions",
  title_default: "Check Back Soon",
  description: "We're always cooking up new deals. Sign up for our newsletter to be the first to know about upcoming promotions.",
  button_text: "Browse Our Fleet",
};

export const DEFAULT_PROMO_TERMS: TermsContent = {
  title: "Terms & Conditions",
  terms: [
    "Promotions cannot be combined with other offers unless specified",
    "Valid ID and credit card required at time of rental",
    "Subject to vehicle availability",
    "Drive 917 reserves the right to modify or cancel promotions at any time",
  ],
};

export const DEFAULT_PROMOTIONS_SEO: SEOContent = {
  title: "Promotions & Deals | Drive 917 - Car Rental Discounts Dallas",
  description: "Save on your next car rental with Drive 917's special promotions and deals. Exclusive discounts on daily, weekly, and monthly rentals in Dallas.",
  keywords: "car rental deals dallas, rental car discounts, drive 917 promotions, cheap car rental dallas",
};

// ============================================
// PRIVACY & TERMS DEFAULTS
// ============================================

export const DEFAULT_PRIVACY_POLICY: PrivacyPolicyContent = {
  title: "Privacy Policy",
  last_updated: new Date().toISOString().split('T')[0],
  content: `<h2>Introduction</h2>
<p>Drive 917 ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website or use our services.</p>

<h2>Information We Collect</h2>
<p>We collect information that you provide directly to us, such as:</p>
<ul>
<li>Name, email address, and phone number</li>
<li>Driver's license information</li>
<li>Payment information</li>
<li>Rental history and preferences</li>
</ul>

<h2>How We Use Your Information</h2>
<p>We use the information we collect to:</p>
<ul>
<li>Process rental reservations and payments</li>
<li>Communicate with you about your rentals</li>
<li>Send promotional communications (with your consent)</li>
<li>Improve our services</li>
</ul>

<h2>Contact Us</h2>
<p>If you have questions about this Privacy Policy, please contact us at info@drive917.com.</p>`,
};

export const DEFAULT_TERMS_OF_SERVICE: TermsOfServiceContent = {
  title: "Terms of Service",
  last_updated: new Date().toISOString().split('T')[0],
  content: `<h2>Agreement to Terms</h2>
<p>By accessing or using Drive 917's services, you agree to be bound by these Terms of Service and all applicable laws and regulations.</p>

<h2>Rental Requirements</h2>
<ul>
<li>You must be at least 21 years of age to rent a vehicle</li>
<li>A valid driver's license is required</li>
<li>A valid credit card in the renter's name is required</li>
<li>Proof of insurance may be required</li>
</ul>

<h2>Vehicle Use</h2>
<p>Rented vehicles may only be operated by authorized drivers listed on the rental agreement. Vehicles may not be used for:</p>
<ul>
<li>Any illegal purpose</li>
<li>Racing or speed testing</li>
<li>Towing or pushing other vehicles</li>
<li>Transportation of hazardous materials</li>
</ul>

<h2>Contact Us</h2>
<p>For questions about these Terms, please contact us at info@drive917.com.</p>`,
};

// ============================================
// COMBINED DEFAULTS EXPORT
// ============================================

export const CMS_DEFAULTS = {
  home: {
    home_hero: DEFAULT_HOME_HERO,
    promo_badge: DEFAULT_PROMO_BADGE,
    service_highlights: DEFAULT_SERVICE_HIGHLIGHTS,
    booking_header: DEFAULT_BOOKING_HEADER,
    testimonials_header: DEFAULT_TESTIMONIALS_HEADER,
    home_cta: DEFAULT_HOME_CTA,
    contact_card: DEFAULT_CONTACT_CARD,
    seo: DEFAULT_HOME_SEO,
  },
  siteSettings: {
    logo: DEFAULT_LOGO,
    contact: DEFAULT_SITE_CONTACT,
    social: DEFAULT_SOCIAL_LINKS,
    footer: DEFAULT_FOOTER,
  },
  about: {
    hero: DEFAULT_ABOUT_HERO,
    story: DEFAULT_ABOUT_STORY,
    why_choose_us: DEFAULT_WHY_CHOOSE_US,
    stats: DEFAULT_ABOUT_STATS,
    cta: DEFAULT_ABOUT_CTA,
    seo: DEFAULT_ABOUT_SEO,
  },
  contact: {
    hero: DEFAULT_CONTACT_HERO,
    contact_info: DEFAULT_CONTACT_INFO,
    contact_form: DEFAULT_CONTACT_FORM,
    trust_badges: DEFAULT_TRUST_BADGES,
    seo: DEFAULT_CONTACT_SEO,
  },
  fleet: {
    hero: DEFAULT_FLEET_HERO,
    rental_rates: DEFAULT_RENTAL_RATES,
    inclusions: DEFAULT_INCLUSIONS,
    cta: DEFAULT_FLEET_CTA,
    seo: DEFAULT_FLEET_SEO,
  },
  promotions: {
    hero: DEFAULT_PROMOTIONS_HERO,
    how_it_works: DEFAULT_HOW_IT_WORKS,
    empty_state: DEFAULT_EMPTY_STATE,
    terms: DEFAULT_PROMO_TERMS,
    seo: DEFAULT_PROMOTIONS_SEO,
  },
  privacy: DEFAULT_PRIVACY_POLICY,
  terms: DEFAULT_TERMS_OF_SERVICE,
};
