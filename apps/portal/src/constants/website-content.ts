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

  /** Maximum file size for images in carousel (10 MB) */
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024,

  /** Maximum file size for videos in carousel (50 MB) */
  MAX_VIDEO_SIZE_BYTES: 50 * 1024 * 1024,

  /** Maximum items in carousel (images + videos combined) */
  MAX_CAROUSEL_ITEMS: 10,

  /** Allowed image types */
  ALLOWED_IMAGE_TYPES: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/svg+xml',
  ] as const,

  /** Allowed video types (includes GIF as it behaves like video) */
  ALLOWED_VIDEO_TYPES: [
    'video/mp4',
    'video/webm',
    'image/gif',
  ] as const,

  /** Allowed carousel media types (images + videos) */
  ALLOWED_CAROUSEL_TYPES: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'image/gif',
  ] as const,

  /** Video file extensions for URL detection */
  VIDEO_EXTENSIONS: ['.mp4', '.webm', '.gif'] as const,

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
// Default CMS content for Drive 247 landing page

// ============================================
// HOME PAGE DEFAULTS
// ============================================

export const DEFAULT_HOME_HERO: HomeHeroContent = {
  headline: "Premium Car Rentals",
  subheading: "Experience luxury and reliability with our handpicked fleet. Flexible daily, weekly, and monthly rentals tailored to your needs.",
  background_image: "",
  phone_number: "+19725156635",
  phone_cta_text: "Call Now",
  book_cta_text: "Book Your Ride",
  trust_line: "Trusted by 500+ happy customers",
};

export const DEFAULT_PROMO_BADGE: PromoBadgeContent = {
  enabled: true,
  discount_amount: "15%",
  discount_label: "OFF",
  line1: "First Week Rental",
  line2: "Limited Time Offer",
};

export const DEFAULT_SERVICE_HIGHLIGHTS: ServiceHighlightsContent = {
  title: "Why Choose Drive 247?",
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
  description: "Join hundreds of satisfied customers who trust Drive 247 for their transportation needs. Book your vehicle today and experience the difference.",
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
  email: "info@drive247.com",
  call_button_text: "Call Us",
  email_button_text: "Email Us",
};

export const DEFAULT_HOME_SEO: SEOContent = {
  title: "Drive 247 | Premium Car Rentals",
  description: "Rent premium vehicles. Daily, weekly & monthly rentals. Competitive rates, flexible terms, and exceptional service. Book online today!",
  keywords: "premium car rental, weekly car rental, monthly car rental, drive 247",
};

// ============================================
// SITE SETTINGS DEFAULTS
// ============================================

export const DEFAULT_LOGO: LogoContent = {
  logo_url: "",
  logo_alt: "Drive 247",
  favicon_url: "",
};

export const DEFAULT_SITE_CONTACT: SiteContactContent = {
  phone: "+19725156635",
  phone_display: "(972) 515-6635",
  email: "info@drive247.com",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  zip: "",
  country: "USA",
  google_maps_url: "",
};

export const DEFAULT_SOCIAL_LINKS: SocialLinksContent = {
  facebook: "https://facebook.com/drive247",
  instagram: "https://instagram.com/drive247",
  twitter: "",
  linkedin: "",
  youtube: "",
  tiktok: "",
};

export const DEFAULT_FOOTER: FooterContent = {
  copyright_text: `© ${new Date().getFullYear()} Drive 247. All rights reserved.`,
  tagline: "Premium Car Rentals",
};

// ============================================
// ABOUT PAGE DEFAULTS
// ============================================

export const DEFAULT_ABOUT_HERO: HeroContent = {
  title: "About Drive 247",
  subtitle: "Your trusted partner for premium car rentals",
};

export const DEFAULT_ABOUT_STORY: AboutStoryContent = {
  title: "Our Story",
  founded_year: "2020",
  content: `<p>Drive 247 was founded with a simple mission: to provide residents and visitors with reliable, affordable, and premium vehicle rentals.</p>
<p>What started as a small fleet of carefully selected vehicles has grown into one of the most trusted car rental services in the region. Our commitment to quality, transparency, and customer satisfaction has earned us a loyal customer base and a reputation for excellence.</p>
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
  title: "About Us | Drive 247 - Premium Car Rentals",
  description: "Learn about Drive 247, a trusted car rental company. Quality vehicles, transparent pricing, and exceptional service since 2020.",
  keywords: "about drive 247, car rental company, car rental about us",
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
    address: "info@drive247.com",
    response_time: "We respond within 2 hours",
  },
  office: {
    address: "",
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
  title: "Contact Us | Drive 247 - Premium Car Rentals",
  description: "Get in touch with Drive 247 for all your car rental needs. Call us, email, or visit our location. We're here to help!",
  keywords: "contact drive 247, car rental contact, car rental phone number",
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
  title: "Our Fleet | Drive 247 - Premium Car Rentals",
  description: "Browse our premium fleet of rental vehicles. Sedans, SUVs, and luxury cars available for daily, weekly, and monthly rentals.",
  keywords: "rental cars, premium car fleet, rent sedan, rent suv, luxury car rental",
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
    "Drive 247 reserves the right to modify or cancel promotions at any time",
  ],
};

export const DEFAULT_PROMOTIONS_SEO: SEOContent = {
  title: "Promotions & Deals | Drive 247 - Car Rental Discounts",
  description: "Save on your next car rental with Drive 247's special promotions and deals. Exclusive discounts on daily, weekly, and monthly rentals.",
  keywords: "car rental deals, rental car discounts, drive 247 promotions, cheap car rental",
};

// ============================================
// PRIVACY & TERMS DEFAULTS
// ============================================

export const DEFAULT_PRIVACY_POLICY: PrivacyPolicyContent = {
  title: "Privacy Policy",
  last_updated: new Date().toISOString().split('T')[0],
  content: `<h2>1. Introduction</h2>
<p>Drive 247 ("we," "our," or "us") respects your privacy and is committed to protecting the personal information you share with us. This Privacy Policy explains what information we collect, how we use it, who we share it with, and the rights you have over your information when you visit our website, create an account, or rent a vehicle from us.</p>
<p>By using our website or services, you agree to the collection and use of information in accordance with this Policy. If you do not agree with our practices, please do not use our services.</p>

<h2>2. Information We Collect</h2>
<p>We collect several categories of information to provide and improve our services:</p>

<h3>Personal Information You Provide</h3>
<ul>
<li>Full name, date of birth, and contact details (email address, phone number, mailing address)</li>
<li>Driver's license number, issuing authority, expiration date, and a copy of the license</li>
<li>Government-issued identification (passport, national ID) where required</li>
<li>Payment information including credit/debit card details, billing address, and bank account details (processed securely through our payment partners)</li>
<li>Insurance policy details, where applicable</li>
<li>Emergency contact information</li>
</ul>

<h3>Rental & Transaction Information</h3>
<ul>
<li>Booking details, pickup and return locations, rental dates, and vehicle preferences</li>
<li>Rental history, extensions, modifications, and cancellations</li>
<li>Photographs and videos of vehicle condition at pickup and return</li>
<li>Toll, fuel, mileage, and damage records</li>
<li>Communications with our customer service team (chat, email, phone)</li>
</ul>

<h3>Identity Verification & Compliance Data</h3>
<ul>
<li>Selfie photographs and biometric data used for identity verification</li>
<li>Results of fraud, sanctions, and driving record checks</li>
<li>Records collected to comply with applicable anti-money laundering and "know your customer" obligations</li>
</ul>

<h3>Vehicle & Telematics Data</h3>
<ul>
<li>GPS location data when permitted by law and authorized for the rental</li>
<li>Vehicle telemetry such as speed, mileage, fuel/charge level, and diagnostic information</li>
<li>Toll, parking, and traffic violation records associated with the vehicle during your rental</li>
</ul>

<h3>Information We Collect Automatically</h3>
<ul>
<li>Device information (IP address, browser type, operating system, device identifiers)</li>
<li>Usage data (pages viewed, links clicked, referring URLs, time spent on pages)</li>
<li>Cookies, pixels, and similar tracking technologies (see "Cookies & Tracking" below)</li>
</ul>

<h2>3. How We Use Your Information</h2>
<p>We use the information we collect for the following purposes:</p>
<ul>
<li><strong>Service delivery:</strong> Process reservations, payments, deposits, refunds, extensions, and damage claims</li>
<li><strong>Identity & eligibility verification:</strong> Confirm your identity, validate your driver's license, and assess rental eligibility</li>
<li><strong>Communication:</strong> Send booking confirmations, reminders, receipts, contract documents, and customer service responses</li>
<li><strong>Safety & security:</strong> Locate vehicles, prevent fraud, investigate accidents, recover lost or stolen vehicles, and protect our customers, employees, and property</li>
<li><strong>Legal compliance:</strong> Meet our regulatory, tax, accounting, and reporting obligations, and respond to lawful requests from authorities</li>
<li><strong>Marketing:</strong> Send promotional offers, newsletters, and product updates where you have consented or where permitted by law (you can opt out at any time)</li>
<li><strong>Analytics & improvement:</strong> Understand how customers use our services and improve the website, fleet, pricing, and customer experience</li>
</ul>

<h2>4. Legal Bases for Processing</h2>
<p>Where applicable law (including the EU/UK GDPR and similar regulations) requires it, we rely on one or more of the following legal bases when processing your personal information:</p>
<ul>
<li><strong>Contract:</strong> Processing necessary to provide the rental services you requested</li>
<li><strong>Legal obligation:</strong> Processing required by laws and regulations applicable to us</li>
<li><strong>Legitimate interests:</strong> Operating, securing, and improving our business in a way that does not override your rights</li>
<li><strong>Consent:</strong> Where you have given explicit consent (for example, to receive marketing communications)</li>
</ul>

<h2>5. How We Share Your Information</h2>
<p>We do not sell your personal information. We share your information only with the following categories of recipients:</p>
<ul>
<li><strong>Service providers:</strong> Payment processors, identity verification providers, telematics providers, email and SMS delivery services, e-signature services, customer support tools, and cloud hosting providers</li>
<li><strong>Insurance partners:</strong> When you purchase optional insurance coverage or in the event of a claim</li>
<li><strong>Tolling and traffic authorities:</strong> When tolls, fines, or violations are incurred during your rental</li>
<li><strong>Law enforcement and regulators:</strong> Where required by law, court order, or to protect our legal rights</li>
<li><strong>Business transfers:</strong> In connection with a merger, acquisition, financing, or sale of all or part of our business</li>
<li><strong>With your consent:</strong> For any other purpose disclosed to you at the point of collection</li>
</ul>

<h2>6. Cookies & Tracking Technologies</h2>
<p>We use cookies and similar technologies to operate our website, remember your preferences, analyze traffic, and personalize content and advertising. Categories include:</p>
<ul>
<li><strong>Strictly necessary cookies:</strong> Required for core site functions such as login and booking</li>
<li><strong>Performance & analytics cookies:</strong> Help us understand how visitors use the site</li>
<li><strong>Functional cookies:</strong> Remember your preferences such as language and currency</li>
<li><strong>Marketing cookies:</strong> Used to deliver relevant ads and measure campaign performance</li>
</ul>
<p>You can manage cookie preferences through your browser settings or our cookie banner where available. Disabling some cookies may limit site functionality.</p>

<h2>7. Data Retention</h2>
<p>We retain personal information only for as long as necessary to fulfill the purposes outlined in this Policy, unless a longer retention period is required by law (for example, tax, accounting, or contract-related obligations). When information is no longer needed, we securely delete or anonymize it.</p>

<h2>8. Data Security</h2>
<p>We implement administrative, technical, and physical safeguards designed to protect your information against unauthorized access, disclosure, alteration, or destruction. These include encryption in transit, access controls, and regular security assessments. However, no method of transmission or storage is 100% secure, and we cannot guarantee absolute security.</p>

<h2>9. International Data Transfers</h2>
<p>Your information may be transferred to and processed in countries other than the one in which you reside. Where such transfers occur, we put appropriate safeguards in place (such as standard contractual clauses) to ensure your information remains protected.</p>

<h2>10. Your Rights</h2>
<p>Depending on your jurisdiction, you may have the following rights regarding your personal information:</p>
<ul>
<li><strong>Access:</strong> Request a copy of the personal information we hold about you</li>
<li><strong>Correction:</strong> Request that we correct inaccurate or incomplete information</li>
<li><strong>Deletion:</strong> Request that we delete your personal information, subject to legal exceptions</li>
<li><strong>Restriction & objection:</strong> Restrict or object to certain processing activities</li>
<li><strong>Portability:</strong> Receive your information in a structured, machine-readable format</li>
<li><strong>Withdraw consent:</strong> Withdraw any consent you previously provided</li>
<li><strong>Lodge a complaint:</strong> Contact your local data protection authority</li>
</ul>
<p>To exercise any of these rights, please contact us using the details below. We may need to verify your identity before fulfilling your request.</p>

<h2>11. Children's Privacy</h2>
<p>Our services are not directed to individuals under the age of 18. We do not knowingly collect personal information from children. If you believe a child has provided us with personal information, please contact us and we will take appropriate steps to delete it.</p>

<h2>12. Third-Party Links</h2>
<p>Our website may contain links to third-party websites or services that are not operated by us. We are not responsible for the privacy practices of those third parties and encourage you to review their privacy policies before providing any personal information.</p>

<h2>13. Changes to This Privacy Policy</h2>
<p>We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. When we make material changes, we will notify you by updating the "Last updated" date at the top of this page and, where appropriate, by sending a notice through our services or by email.</p>

<h2>14. Contact Us</h2>
<p>If you have any questions, concerns, or requests regarding this Privacy Policy or our handling of your personal information, please contact us at:</p>
<ul>
<li><strong>Email:</strong> info@drive247.com</li>
<li><strong>Mail:</strong> Drive 247, Privacy Office</li>
</ul>
<p>We will respond to your inquiry within a reasonable timeframe and in accordance with applicable law.</p>`,
};

export const DEFAULT_TERMS_OF_SERVICE: TermsOfServiceContent = {
  title: "Terms of Service",
  last_updated: new Date().toISOString().split('T')[0],
  content: `<h2>1. Agreement to Terms</h2>
<p>These Terms of Service ("Terms") govern your access to and use of Drive 247's website, mobile services, and vehicle rental services (collectively, the "Services"). By creating an account, making a reservation, or renting a vehicle from us, you agree to be bound by these Terms, our Privacy Policy, and any rental agreement signed at the time of pickup. If you do not agree to these Terms, please do not use our Services.</p>

<h2>2. Eligibility & Rental Requirements</h2>
<p>To rent a vehicle from Drive 247, you must:</p>
<ul>
<li>Be at least 21 years of age (some vehicle classes may require a higher minimum age)</li>
<li>Hold a valid, unexpired driver's license that you have held for at least one year</li>
<li>Present a valid government-issued photo ID</li>
<li>Provide a valid credit card in the renter's name to cover the rental charges and security deposit</li>
<li>Pass our identity verification, fraud, and driving record checks</li>
<li>Meet any additional eligibility requirements that may apply to specific vehicles or locations</li>
</ul>
<p>Drivers under 25 may be subject to a young driver surcharge and additional restrictions. International renters must present a valid driver's license from their country of residence and, where required, an International Driving Permit.</p>

<h2>3. Reservations, Modifications & Cancellations</h2>
<p>All reservations are subject to vehicle availability and confirmation. We make every reasonable effort to honor confirmed reservations, but we reserve the right to substitute a vehicle of similar or higher class if the specific vehicle reserved is unavailable.</p>
<p>You may modify or cancel your reservation in accordance with the cancellation policy displayed at the time of booking. Cancellation fees may apply depending on how close to the pickup date the cancellation is made and the type of rate selected.</p>

<h2>4. Pricing, Fees & Payment</h2>
<p>Rental rates are quoted at the time of booking and may include a base rate, taxes, surcharges, and optional add-ons. The total amount payable will be presented to you before you confirm your reservation. Additional charges that may apply include:</p>
<ul>
<li>Late return fees</li>
<li>Mileage overage charges (where applicable)</li>
<li>Fuel or charging fees if the vehicle is returned with less fuel/charge than at pickup</li>
<li>Cleaning fees for excessive dirt, smoke, or odor</li>
<li>Tolls, parking fines, traffic violations, and related administrative fees</li>
<li>Damage charges, including loss of use, diminished value, and administrative fees</li>
<li>Lost key, lost remote, or lost document replacement fees</li>
</ul>
<p>You authorize us to charge your payment method for all amounts due under your rental agreement, including charges discovered or assessed after the vehicle is returned.</p>

<h2>5. Security Deposit</h2>
<p>A security deposit (or pre-authorization hold) is required at the start of your rental. The amount will be communicated to you in advance and held against potential damage, fines, or other charges. The deposit (or any unused portion) is released or refunded after the vehicle is returned and inspected, typically within 5–14 business days, subject to the policies of your card issuer or bank.</p>

<h2>6. Insurance & Liability</h2>
<p>Basic liability coverage may be included with your rental as required by applicable law. Optional coverage products (collision damage waiver, supplemental liability, personal accident, etc.) may be available for purchase at the time of booking or pickup. You are responsible for understanding the scope and limitations of any coverage, including deductibles and exclusions.</p>
<p>You agree to be financially responsible for any damage to the vehicle or third-party property, and any injury caused, that is not covered by insurance, including damage caused by negligent or unauthorized use.</p>

<h2>7. Authorized Drivers & Vehicle Use</h2>
<p>Only the renter and additional drivers listed on the rental agreement are authorized to operate the vehicle. Allowing an unauthorized person to drive the vehicle voids any insurance coverage and is a material breach of these Terms.</p>
<p>You agree that the vehicle will not be used:</p>
<ul>
<li>For any illegal purpose or in violation of any law or regulation</li>
<li>To carry passengers or property for hire</li>
<li>For racing, speed testing, off-roading (unless the vehicle is designated for off-road use), or any motorsport activity</li>
<li>To tow or push another vehicle, trailer, or object</li>
<li>To transport hazardous, flammable, toxic, or contraband materials</li>
<li>While the driver is under the influence of alcohol, drugs, or any substance that impairs driving ability</li>
<li>Outside of the geographic area authorized in the rental agreement</li>
<li>By anyone other than an authorized driver</li>
</ul>

<h2>8. Fuel, Charging & Mileage</h2>
<p>The vehicle must be returned with the same fuel level (or charge level for electric vehicles) as at the time of pickup, unless you have purchased a fuel/charging package. If returned with less, you will be charged a refueling/recharging fee plus an administrative fee at our then-current rate.</p>
<p>Mileage allowances, if any, are stated in your rental agreement. Excess mileage charges apply per mile/kilometer over the included allowance.</p>

<h2>9. Vehicle Condition, Maintenance & Return</h2>
<p>You agree to inspect the vehicle at pickup and report any pre-existing damage before driving away. You are expected to operate the vehicle responsibly, maintain proper tire pressure and fluid levels during long rentals, and respond to any warning lights promptly.</p>
<p>The vehicle must be returned to the agreed location, on the agreed date and time, in the same condition as at pickup (normal wear and tear excepted). Late returns are subject to additional charges and may be treated as unauthorized use if not communicated in advance.</p>

<h2>10. Accidents, Damage & Theft</h2>
<p>In the event of an accident, theft, vandalism, fire, or any other incident involving the vehicle, you must:</p>
<ul>
<li>Notify the local police and obtain a written report</li>
<li>Notify Drive 247 immediately and follow our instructions</li>
<li>Not admit liability or release any party from responsibility on our behalf</li>
<li>Cooperate fully in any investigation, claim, or legal proceeding</li>
</ul>
<p>Failure to report an incident promptly or follow these procedures may result in loss of insurance coverage and full personal liability for damages.</p>

<h2>11. Tolls, Fines & Traffic Violations</h2>
<p>You are responsible for all tolls, congestion charges, parking fines, traffic violations, and other charges incurred during your rental. We may pay these on your behalf and recover the amount from your payment method, together with an administrative fee.</p>

<h2>12. Roadside Assistance</h2>
<p>Roadside assistance may be available either as a standard inclusion or as an optional add-on. Charges may apply for service calls caused by negligence (e.g. lost keys, fuel run-out, lockouts, or driver error). Details are provided in your rental agreement.</p>

<h2>13. Indemnification</h2>
<p>You agree to indemnify, defend, and hold harmless Drive 247, its officers, directors, employees, agents, affiliates, and partners from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or related to your use of the Services, your breach of these Terms, your operation of the rental vehicle, or your violation of any law or third-party right.</p>

<h2>14. Limitation of Liability</h2>
<p>To the maximum extent permitted by law, Drive 247 will not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, use, goodwill, or other intangible losses, arising out of or related to your use of the Services. Our aggregate liability for any direct damages will not exceed the total amount paid by you for the rental giving rise to the claim.</p>
<p>Nothing in these Terms excludes or limits liability that cannot be excluded under applicable law (such as liability for death or personal injury caused by negligence, or for fraud).</p>

<h2>15. Termination</h2>
<p>We may suspend or terminate your account, refuse a rental, or repossess a vehicle (at your expense) if you breach these Terms, misuse the vehicle, provide false information, or engage in any conduct that we reasonably believe is fraudulent, dangerous, or harmful to us or others.</p>

<h2>16. Privacy</h2>
<p>Your use of the Services is also governed by our Privacy Policy, which describes how we collect, use, and disclose your personal information. By using the Services, you consent to our processing of your information in accordance with the Privacy Policy.</p>

<h2>17. Intellectual Property</h2>
<p>All content on our website and within our Services, including logos, trademarks, text, images, and software, is owned by Drive 247 or its licensors and is protected by copyright, trademark, and other intellectual property laws. You may not copy, reproduce, modify, or distribute any of our content without our prior written permission.</p>

<h2>18. Governing Law & Dispute Resolution</h2>
<p>These Terms are governed by the laws of the jurisdiction in which the rental originates, without regard to its conflict-of-laws principles. Any dispute arising out of or related to these Terms or the Services will first be addressed through good-faith negotiation. If unresolved, disputes may be submitted to binding arbitration or to the competent courts of that jurisdiction, except where prohibited by law.</p>

<h2>19. Changes to These Terms</h2>
<p>We may update these Terms from time to time to reflect changes in our Services, legal requirements, or business practices. When we make material changes, we will update the "Last updated" date and, where appropriate, notify you through the Services or by email. Your continued use of the Services after the updated Terms take effect constitutes acceptance of the changes.</p>

<h2>20. Contact Us</h2>
<p>If you have any questions about these Terms or your rental, please contact us at:</p>
<ul>
<li><strong>Email:</strong> info@drive247.com</li>
<li><strong>Mail:</strong> Drive 247, Customer Service</li>
</ul>`,
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
  blog: {
    hero: {
      title: "Blog",
      subtitle: "Latest news, tips and insights from our team",
    } as HeroContent,
    seo: {
      title: "Blog — Latest Articles & News",
      description: "Read the latest articles, tips, and news from our team.",
      keywords: "blog, news, tips, car rental guide",
    } as SEOContent,
  },
};
