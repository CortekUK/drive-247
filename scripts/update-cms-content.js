/**
 * CMS Content Update Script
 *
 * Updates all CMS page sections with branded content
 *
 * Usage: node scripts/update-cms-content.js [tenant-slug]
 * Example: node scripts/update-cms-content.js globalmotiontransport
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required environment variables!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Get tenant slug from command line or default
const TENANT_SLUG = process.argv[2] || 'globalmotiontransport';

// Tenant-specific content configurations
const TENANT_CONTENT = {
  // GLOBAL MOTION TRANSPORT
  globalmotiontransport: {
    name: "Global Motion Transport",
    shortName: "Global Motion",
    tagline: "Economy Car Rentals in Nashville",
    phone: "+1 (615) 659-7333",
    phoneDisplay: "(615) 659-7333",
    email: "globalmotiontransport@gmail.com",
    location: "Madison, Tennessee",
    hours: "8AM - 9PM Daily",
    specialty: "Economy car specialists - Ford Fusions, Prius & more"
  },

  // FLEETVANA
  fleetvana: {
    name: "FLEETVANA",
    shortName: "FLEETVANA",
    tagline: "Premium Car Rentals",
    phone: "+1 (555) 123-4567",
    phoneDisplay: "(555) 123-4567",
    email: "hello@fleetvana.com",
    location: "Your City",
    hours: "24/7",
    specialty: "Premium vehicle rentals",
    region: "Your Area"
  },

  // AMG ROADSIDE
  amgroadside: {
    name: "AMG Roadside",
    shortName: "AMG Roadside",
    tagline: "Economy & Hybrid Car Rentals in Maryland",
    phone: "+1 (000) 000-0000",
    phoneDisplay: "(000) 000-0000",
    email: "amgroadside1@gmail.com",
    location: "Maryland",
    hours: "9AM - 7PM Daily",
    specialty: "Economy & hybrid specialists - Prius, SUVs & more",
    region: "Maryland"
  },

  // KEDIC SERVICES
  "kedic-services": {
    name: "Kedic Services",
    shortName: "KEDIC",
    tagline: "Car Rentals in Las Vegas",
    phone: "+1 (702) 918-3945",
    phoneDisplay: "(702) 918-3945",
    email: "a1lasvegasauto1@gmail.com",
    location: "Las Vegas",
    hours: "8AM - 10PM (Pickup) • 24/7 Requests",
    specialty: "Reliable car rentals with flexible booking options",
    region: "Las Vegas"
  },

  // SAN DIEGO WEEKLY CAR RENTALS
  sdrentals: {
    name: "San Diego Weekly Car Rentals",
    shortName: "SD Rentals",
    tagline: "Weekly & Monthly Car Rentals in San Diego",
    phone: "+1 (619) 555-0100",
    phoneDisplay: "(619) 555-0100",
    email: "info@sdrentals.com",
    location: "San Diego, California",
    hours: "8AM - 8PM Daily",
    specialty: "Weekly and monthly rental specialists - Economy cars, SUVs & more",
    region: "San Diego"
  },

  // THOMCELL
  thomcell: {
    name: "Thomcell",
    shortName: "Thomcell",
    tagline: "Premium Car Rentals in Houston",
    phone: "+1 (833) 846-6235",
    phoneDisplay: "(833) 846-6235",
    email: "lexx@thomcellconsulting.com",
    location: "Houston, Texas",
    hours: "24/7",
    specialty: "Premium vehicles - Mercedes EQE, SUVs, Ford Bronco & more",
    region: "Houston"
  },

  // ALL IN ONE CONNECTIONS
  allinoneconnections: {
    name: "All in One Connections",
    shortName: "All in One",
    tagline: "Car Rentals in Atlanta",
    phone: "+1 (470) 474-3020",
    phoneDisplay: "(470) 474-3020",
    email: "all_in_1connections@yahoo.com",
    location: "Atlanta, Georgia",
    hours: "24/7",
    specialty: "Economy cars and select premium vehicles like Mustang",
    region: "Atlanta"
  },

  // AIN CONNECTIONS (same as allinoneconnections)
  ainconnections: {
    name: "All in One Connections",
    shortName: "All in One",
    tagline: "Car Rentals in Atlanta",
    phone: "+1 (470) 474-3020",
    phoneDisplay: "(470) 474-3020",
    email: "all_in_1connections@yahoo.com",
    location: "Atlanta, Georgia",
    hours: "24/7",
    specialty: "Economy cars and select premium vehicles like Mustang",
    region: "Atlanta"
  },

  // DB CAR RENTALS
  dbcarrentals: {
    name: "DB Car Rentals",
    shortName: "DB Rentals",
    tagline: "Premium Car Rentals in Miami",
    phone: "+1 (786) 301-3621",
    phoneDisplay: "(786) 301-3621",
    email: "dbcargosolutionscorp@gmail.com",
    location: "Miami, Florida",
    hours: "24/7",
    specialty: "Full fleet - Economy, SUV, Minivan & Luxury vehicles including Audi & BMW",
    region: "Miami"
  }
};

// Get tenant info
const tenant = TENANT_CONTENT[TENANT_SLUG];
if (!tenant) {
  console.error(`No content configuration found for tenant: ${TENANT_SLUG}`);
  console.error(`Available tenants: ${Object.keys(TENANT_CONTENT).join(', ')}`);
  process.exit(1);
}

// Generate CMS content based on tenant
const generateContent = (t) => ({
  home: {
    home_hero: {
      headline: `Affordable Car Rentals with ${t.name}`,
      subheading: `${t.specialty}. Quality vehicles at competitive rates in the ${t.location} area.`,
      background_image: "",
      phone_number: t.phone,
      phone_cta_text: `Call ${t.phoneDisplay}`,
      book_cta_text: "Book Your Ride",
      trust_line: "Economy Fleet • Competitive Rates • Reliable Service"
    },
    promo_badge: {
      enabled: false,
      discount_amount: "10%",
      discount_label: "OFF",
      line1: "First-Time Customer",
      line2: "Special Discount"
    },
    service_highlights: {
      title: `Why Choose ${t.name}?`,
      subtitle: "Delivering value through quality economy vehicles and exceptional service.",
      services: [
        { icon: "ThumbsUp", title: "Quality Economy Cars", description: "Well-maintained Prius, SUVs, and other fuel-efficient vehicles perfect for daily driving and long trips." },
        { icon: "DollarSign", title: "Competitive Pricing", description: "Affordable rates without hidden fees. Get the best value for your money with our transparent pricing." },
        { icon: "MapPin", title: `${t.location} Coverage`, description: `Convenient service throughout ${t.location} and surrounding areas.` },
        { icon: "Fuel", title: "Fuel Efficient Fleet", description: "Save money at the pump with our selection of economy and hybrid vehicles." },
        { icon: "Settings", title: "AT/MT Available", description: "Choose between Automatic and Manual transmission vehicles based on your preference." },
        { icon: "Headphones", title: "Personal Support", description: "Friendly, responsive customer service. We're here to help with all your rental needs." }
      ]
    },
    booking_header: {
      title: "Book Your Rental",
      subtitle: `Easy and affordable car rentals in ${t.location} — from pickup to drop-off, we've got you covered.`,
      trust_points: [t.location, "Transparent Rates", "Quality Vehicles"]
    },
    testimonials_header: {
      title: `Why Drivers Choose ${t.name}`
    },
    home_cta: {
      title: `Ready to Book with ${t.name}?`,
      description: `Affordable, reliable car rentals in ${t.location}. Quality vehicles, honest pricing, and friendly service.`,
      primary_cta_text: "Book Now",
      secondary_cta_text: "Get in Touch",
      trust_points: ["Reliable Service", "Clean Vehicles", "Great Rates"]
    },
    contact_card: {
      title: "Have Questions?",
      description: "We're here to help. Reach out to our team for quick answers and booking support.",
      phone_number: t.phone,
      email: t.email,
      call_button_text: "Call Now",
      email_button_text: "Email Us"
    },
    seo: {
      title: `${t.name} - ${t.tagline}`,
      description: `Affordable economy car rentals in ${t.location}. ${t.name} offers quality vehicles like Ford Fusions and Prius at competitive rates.`,
      keywords: `car rental Nashville, economy car rental, ${t.location} car rental, affordable car hire, ${t.name}`
    }
  },

  about: {
    hero: {
      title: `About ${t.name}`,
      subtitle: `Your trusted partner for affordable car rentals in ${t.location}.`
    },
    about_story: {
      title: "Quality Rentals, Fair Prices",
      founded_year: "2020",
      content: `<p>${t.name} was founded with a simple mission: to provide reliable, affordable car rentals to the ${t.location} community.</p>
<p>We specialize in economy and hybrid vehicles that are perfect for everyday use — whether you need a car for commuting, running errands, or taking a road trip.</p>
<p>Our fleet includes popular models like the Toyota Prius and fuel-efficient SUVs, chosen for their reliability, fuel efficiency, and comfort.</p>
<p>We believe that renting a car shouldn't break the bank. That's why we offer competitive rates with no hidden fees, so you always know exactly what you're paying.</p>
<p>Based in ${t.location}, we serve the surrounding area with convenient pickup and return options.</p>
<p>Our commitment is simple: provide quality vehicles, fair prices, and friendly service to every customer.</p>`
    },
    stats: {
      items: [
        { icon: "clock", label: "YEARS EXPERIENCE", value: "", suffix: "+", use_dynamic: true, dynamic_source: "years_experience" },
        { icon: "car", label: "RENTALS COMPLETED", value: "", suffix: "+", use_dynamic: true, dynamic_source: "total_rentals" },
        { icon: "crown", label: "VEHICLES", value: "", suffix: "+", use_dynamic: true, dynamic_source: "active_vehicles" },
        { icon: "star", label: "CLIENT RATING", value: "", suffix: "", use_dynamic: true, dynamic_source: "avg_rating" }
      ]
    },
    why_choose_us: {
      title: `Why Choose ${t.name}`,
      items: [
        { icon: "car", title: "Economy Fleet", description: "Fuel-efficient vehicles like Prius and SUVs that save you money at the pump." },
        { icon: "dollar-sign", title: "Fair Pricing", description: "Competitive rates with no hidden fees. What you see is what you pay." },
        { icon: "clock", title: "Flexible Hours", description: `Open ${t.hours}. We work around your schedule.` },
        { icon: "map-pin", title: "Local Service", description: `Proudly serving ${t.location} and surrounding areas.` }
      ]
    },
    faq_cta: {
      title: "Still have questions?",
      description: "Our team is happy to help. Give us a call!",
      button_text: `Call ${t.phoneDisplay}`
    },
    final_cta: {
      title: `Ready to Rent with ${t.name}?`,
      description: "Book your affordable rental today and experience the difference.",
      tagline: "Reliable • Affordable • Local"
    },
    seo: {
      title: `About Us - ${t.name}`,
      description: `Learn about ${t.name}'s mission to provide affordable, reliable car rentals in ${t.location}.`,
      keywords: `about ${t.name}, ${t.location} car rental company, economy car rental`
    }
  },

  contact: {
    hero: {
      title: `Contact ${t.name}`,
      subtitle: `Get in touch for affordable car rentals in ${t.location}.`
    },
    contact_info: {
      phone: { number: t.phone, availability: `${t.hours}` },
      email: { address: t.email, response_time: "We respond within a few hours" },
      office: { address: `${t.location}` },
      whatsapp: { number: t.phone.replace(/[^0-9+]/g, ''), description: "Text us for quick responses" }
    },
    contact_form: {
      title: "Send Us a Message",
      subtitle: "We'll get back to you as soon as possible.",
      success_message: `Thank you for contacting ${t.name}. We'll respond shortly!`,
      gdpr_text: "I consent to being contacted regarding my enquiry.",
      submit_button_text: "Send Message",
      subject_options: ["General Enquiry", "Booking Question", "Vehicle Availability", "Pricing", "Feedback"]
    },
    trust_badges: {
      badges: [
        { icon: "shield", label: "Trusted", tooltip: `Trusted by ${t.location} drivers` },
        { icon: "clock", label: "Quick Response", tooltip: "We respond quickly to all inquiries" },
        { icon: "star", label: "5-Star Service", tooltip: "Rated 5 stars by our customers" }
      ]
    },
    pwa_install: {
      title: `Install ${t.name}`,
      description: `Add ${t.name} to your home screen for quick access to bookings.`
    },
    seo: {
      title: `Contact Us - ${t.name}`,
      description: `Get in touch with ${t.name} for car rentals in ${t.location}. Call ${t.phoneDisplay} or email us.`,
      keywords: `contact ${t.name}, ${t.location} car rental phone, ${t.location} car rental`
    }
  },

  fleet: {
    fleet_hero: {
      headline: "Our Fleet & Pricing",
      subheading: "Browse our selection of economy vehicles with transparent daily, weekly, and monthly rates.",
      background_image: "",
      primary_cta_text: "Book Now",
      secondary_cta_text: "View Fleet Below"
    },
    rental_rates: {
      section_title: "Flexible Rental Rates",
      daily: { title: "Daily", description: "Perfect for short trips and day use." },
      weekly: { title: "Weekly", description: "Great value for week-long rentals." },
      monthly: { title: "Monthly", description: "Best rates for extended rentals." }
    },
    inclusions: {
      section_title: `Every ${t.name} Rental Includes`,
      section_subtitle: "Standard features with every rental.",
      standard_title: "Standard Inclusions",
      standard_items: [
        { icon: "Shield", title: "Basic Insurance Coverage" },
        { icon: "Phone", title: "Roadside Assistance" },
        { icon: "MapPin", title: "Unlimited Mileage" },
        { icon: "Sparkles", title: "Clean Vehicle" },
        { icon: "User", title: "Friendly Service" },
        { icon: "Clock", title: "Flexible Pickup" }
      ],
      premium_title: "Available Add-ons",
      premium_items: [
        { icon: "User", title: "Additional Driver" },
        { icon: "Baby", title: "Child Safety Seat" },
        { icon: "MapPin", title: "GPS Navigation" },
        { icon: "Shield", title: "Extended Coverage" }
      ]
    },
    extras: {
      items: [
        { name: "Child Safety Seat", price: 10, description: "Per day" },
        { name: "GPS Navigation", price: 8, description: "Per day" },
        { name: "Additional Driver", price: 10, description: "Per day" },
        { name: "Extended Insurance", price: 15, description: "Per day" }
      ],
      footer_text: "All add-ons can be selected during booking."
    },
    seo: {
      title: `Fleet & Pricing - ${t.name}`,
      description: `Browse ${t.name}'s fleet of economy and hybrid vehicles. Prius, SUVs and more with transparent pricing.`,
      keywords: `car rental fleet, economy cars ${t.location}, rental pricing, ${t.name} vehicles`
    }
  },

  promotions: {
    promotions_hero: {
      headline: "Deals & Promotions",
      subheading: "Save on your next rental with our special offers.",
      primary_cta_text: "View Fleet & Pricing",
      primary_cta_href: "/fleet",
      secondary_cta_text: "Book Now"
    },
    how_it_works: {
      title: "How Promotions Work",
      subtitle: "Simple steps to save on your rental",
      steps: [
        { number: "1", title: "Select Offer", description: "Browse our active promotions" },
        { number: "2", title: "Choose Vehicle", description: "Pick from our economy fleet" },
        { number: "3", title: "Apply at Checkout", description: "Savings applied automatically" }
      ]
    },
    empty_state: {
      title_active: "No active promotions right now",
      title_default: "No promotions found",
      description: "Check back soon or browse our Fleet & Pricing for great everyday rates.",
      button_text: "Browse Fleet & Pricing"
    },
    terms: {
      title: "Terms & Conditions",
      terms: [
        "Promotions are subject to availability",
        "Discounts cannot be combined with other offers",
        "Valid for new bookings only",
        "Promo codes must be applied at booking",
        `${t.name} reserves the right to modify promotions`,
        "Standard rental terms apply"
      ]
    },
    seo: {
      title: `Deals & Promotions - ${t.name}`,
      description: `Save on car rentals with ${t.name} promotions. Special offers on economy vehicles in ${t.location}.`,
      keywords: `car rental deals, ${t.location} rental promotions, discount car hire, ${t.name} offers`
    }
  },

  reviews: {
    hero: {
      title: "Customer Reviews",
      subtitle: `What our customers say about ${t.name}.`
    },
    feedback_cta: {
      title: "Share your experience",
      description: `We'd love to hear about your rental experience with ${t.name}.`,
      button_text: "Leave a Review",
      empty_state_message: `Be the first to review ${t.name}!`
    },
    seo: {
      title: `Customer Reviews - ${t.name}`,
      description: `Read customer reviews of ${t.name} car rentals in ${t.location}.`,
      keywords: `${t.name} reviews, ${t.location} car rental reviews, customer testimonials`
    }
  },

  privacy: {
    privacy_content: {
      title: "Privacy Policy",
      content: `<h2>Introduction</h2>
<p>${t.name} is committed to protecting your privacy. This policy explains how we handle your information.</p>

<h2>Information We Collect</h2>
<ul>
<li>Contact details (name, email, phone)</li>
<li>Booking information (dates, vehicle preferences)</li>
<li>Payment information (processed securely)</li>
</ul>

<h2>How We Use Your Information</h2>
<ul>
<li>Processing your rental bookings</li>
<li>Communicating about your reservations</li>
<li>Improving our services</li>
</ul>

<h2>Contact Us</h2>
<p>For privacy questions, contact us at <a href="mailto:${t.email}">${t.email}</a></p>`,
      last_updated: new Date().toISOString().split('T')[0]
    },
    seo: {
      title: `Privacy Policy - ${t.name}`,
      description: `${t.name} privacy policy - how we protect your information.`,
      keywords: "privacy policy, data protection"
    }
  },

  terms: {
    terms_content: {
      title: "Terms of Service",
      content: `<h2>Rental Agreement</h2>
<p>By booking with ${t.name}, you agree to these terms.</p>

<h2>Booking and Payment</h2>
<ul>
<li>Bookings are subject to availability</li>
<li>Payment required at time of booking</li>
<li>24-hour cancellation policy applies</li>
</ul>

<h2>Vehicle Use</h2>
<ul>
<li>Valid driver's license required</li>
<li>Vehicles must be returned in same condition</li>
<li>Report any issues immediately</li>
</ul>

<h2>Contact</h2>
<p>Questions? Call us at ${t.phoneDisplay} or email <a href="mailto:${t.email}">${t.email}</a></p>`,
      last_updated: new Date().toISOString().split('T')[0]
    },
    seo: {
      title: `Terms of Service - ${t.name}`,
      description: `${t.name} rental terms and conditions.`,
      keywords: "terms of service, rental terms"
    }
  },

  "site-settings": {
    logo: {
      logo_url: "",
      logo_alt: t.name,
      favicon_url: ""
    },
    contact: {
      phone: t.phone.replace(/[^0-9+]/g, ''),
      phone_display: t.phoneDisplay,
      email: t.email,
      address_line1: "",
      address_line2: "",
      city: t.location.split(',')[0]?.trim() || t.location,
      state: t.location.split(',')[1]?.trim() || "",
      zip: "",
      country: "USA",
      google_maps_url: ""
    },
    social: {},
    footer: {
      copyright_text: `© ${new Date().getFullYear()} ${t.name}. All rights reserved.`,
      tagline: t.tagline
    },
    pwa_install: {
      title: `Install ${t.name}`,
      description: `Add ${t.name} to your home screen for quick bookings.`
    }
  }
});

async function main() {
  console.log('\n========================================');
  console.log(`  ${tenant.name} CMS Content Update`);
  console.log('========================================\n');

  // Find tenant
  const { data: tenantData, error: tenantError } = await supabase
    .from('tenants')
    .select('id, slug, company_name')
    .eq('slug', TENANT_SLUG)
    .single();

  if (tenantError || !tenantData) {
    console.error(`Error: Tenant "${TENANT_SLUG}" not found!`);
    process.exit(1);
  }

  console.log(`Found tenant: ${tenantData.company_name} (ID: ${tenantData.id})\n`);

  // Generate content for this tenant
  const SECTION_MAPPING = generateContent(tenant);

  // Get all CMS pages for this tenant
  const { data: pages, error: pagesError } = await supabase
    .from('cms_pages')
    .select('id, slug, name')
    .eq('tenant_id', tenantData.id);

  if (pagesError) {
    console.error('Error fetching CMS pages:', pagesError.message);
    process.exit(1);
  }

  console.log(`Found ${pages.length} CMS pages\n`);

  // Update each page's sections
  for (const page of pages) {
    const pageContent = SECTION_MAPPING[page.slug];

    if (!pageContent) {
      console.log(`Skipping ${page.slug} - no content defined`);
      continue;
    }

    console.log(`\nUpdating ${page.name} (${page.slug})...`);

    // Get existing sections for this page
    const { data: existingSections } = await supabase
      .from('cms_page_sections')
      .select('id, section_key')
      .eq('page_id', page.id)
      .eq('tenant_id', tenantData.id);

    // Update or insert each section
    for (const [sectionKey, content] of Object.entries(pageContent)) {
      const existingSection = existingSections?.find(s => s.section_key === sectionKey);

      if (existingSection) {
        const { error: updateError } = await supabase
          .from('cms_page_sections')
          .update({ content, updated_at: new Date().toISOString() })
          .eq('id', existingSection.id);

        if (updateError) {
          console.error(`  Error updating ${sectionKey}: ${updateError.message}`);
        } else {
          console.log(`  Updated: ${sectionKey}`);
        }
      } else {
        const { error: insertError } = await supabase
          .from('cms_page_sections')
          .insert({
            page_id: page.id,
            section_key: sectionKey,
            content,
            display_order: Object.keys(pageContent).indexOf(sectionKey),
            is_visible: true,
            tenant_id: tenantData.id
          });

        if (insertError) {
          console.error(`  Error inserting ${sectionKey}: ${insertError.message}`);
        } else {
          console.log(`  Created: ${sectionKey}`);
        }
      }
    }

    // Publish the page
    await supabase
      .from('cms_pages')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', page.id);

    console.log(`  Published!`);
  }

  console.log('\n========================================');
  console.log('  CMS Content Update Complete!');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
