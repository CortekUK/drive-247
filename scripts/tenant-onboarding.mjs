/**
 * Tenant Onboarding Script
 * ------------------------------------------------------------------
 * One-shot populate of a NEW tenant's information + branding + content
 * across BOTH the operator portal and the customer-facing booking site,
 * straight from the info captured in the onboarding Google Sheet.
 *
 * It fills, for a given tenant slug:
 *   1. tenants row .......... identity, contact, address, locale, branding
 *                            palette (light+dark+header/footer), SEO meta,
 *                            business hours, location mode, sensible rental
 *                            rules + feature flags.
 *   2. cms_page_sections .... all 10 booking pages (home/about/contact/fleet/
 *                            promotions/reviews/privacy/terms/site-settings)
 *                            with branded copy — then publishes the pages.
 *   3. pickup_locations ..... one "Main Office" location.
 *   4. faqs ................. a starter set of common rental FAQs.
 *   5. testimonials ......... a few professional 5-star testimonials.
 *   6. rental_extras ........ common add-ons (GPS, child seat, etc.).
 *
 * The script is IDEMPOTENT: the tenants row is updated in place, CMS sections
 * are upserted, and the seed tables (locations/faqs/testimonials/extras) are
 * only seeded when the tenant has none — so re-running is safe.
 *
 * Usage:
 *   node scripts/tenant-onboarding.mjs <slug> [<slug> ...]
 *   node scripts/tenant-onboarding.mjs --all          # every slug in config
 *
 * Client info lives in scripts/tenant-onboarding-config.json keyed by slug.
 * Connection: auto-discovers NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * from env vars, then .env / .env.local / apps/portal/.env.local.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------- env loader
function loadEnvFile(p) {
  const out = {};
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}
function resolveCreds() {
  const candidates = [
    process.env,
    loadEnvFile(join(ROOT, '.env')),
    loadEnvFile(join(ROOT, '.env.local')),
    loadEnvFile(join(ROOT, 'apps/portal/.env.local')),
    loadEnvFile(join(ROOT, 'apps/booking/.env.local')),
  ];
  let url, key;
  for (const c of candidates) {
    url = url || c.SUPABASE_URL || c.NEXT_PUBLIC_SUPABASE_URL;
    key = key || c.SUPABASE_SERVICE_ROLE_KEY;
  }
  return { url, key };
}

const { url: SUPABASE_URL, key: SERVICE_KEY } = resolveCreds();
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Could not find SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env or .env files.');
  console.error('   Set them inline:  SUPABASE_SERVICE_ROLE_KEY=... node scripts/tenant-onboarding.mjs <slug>');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// STRICT by default: only the tenants row (real data from config) is written.
// Pass --demo-content to ALSO generate placeholder marketing content (CMS copy,
// FAQs, testimonials, add-ons, a sample location). That content is invented and
// must be reviewed/replaced before publishing — never use it as factual claims.
const DEMO = process.argv.includes('--demo-content');

// ----------------------------------------------------------- derivation maps
const STATE = {
  // abbrev -> { name, tz }
  AL:['Alabama','America/Chicago'], AK:['Alaska','America/Anchorage'], AZ:['Arizona','America/Phoenix'],
  AR:['Arkansas','America/Chicago'], CA:['California','America/Los_Angeles'], CO:['Colorado','America/Denver'],
  CT:['Connecticut','America/New_York'], DE:['Delaware','America/New_York'], FL:['Florida','America/New_York'],
  GA:['Georgia','America/New_York'], HI:['Hawaii','Pacific/Honolulu'], ID:['Idaho','America/Boise'],
  IL:['Illinois','America/Chicago'], IN:['Indiana','America/Indiana/Indianapolis'], IA:['Iowa','America/Chicago'],
  KS:['Kansas','America/Chicago'], KY:['Kentucky','America/New_York'], LA:['Louisiana','America/Chicago'],
  ME:['Maine','America/New_York'], MD:['Maryland','America/New_York'], MA:['Massachusetts','America/New_York'],
  MI:['Michigan','America/Detroit'], MN:['Minnesota','America/Chicago'], MS:['Mississippi','America/Chicago'],
  MO:['Missouri','America/Chicago'], MT:['Montana','America/Denver'], NE:['Nebraska','America/Chicago'],
  NV:['Nevada','America/Los_Angeles'], NH:['New Hampshire','America/New_York'], NJ:['New Jersey','America/New_York'],
  NM:['New Mexico','America/Denver'], NY:['New York','America/New_York'], NC:['North Carolina','America/New_York'],
  ND:['North Dakota','America/Chicago'], OH:['Ohio','America/New_York'], OK:['Oklahoma','America/Chicago'],
  OR:['Oregon','America/Los_Angeles'], PA:['Pennsylvania','America/New_York'], RI:['Rhode Island','America/New_York'],
  SC:['South Carolina','America/New_York'], SD:['South Dakota','America/Chicago'], TN:['Tennessee','America/Chicago'],
  TX:['Texas','America/Chicago'], UT:['Utah','America/Denver'], VT:['Vermont','America/New_York'],
  VA:['Virginia','America/New_York'], WA:['Washington','America/Los_Angeles'], WV:['West Virginia','America/New_York'],
  WI:['Wisconsin','America/Chicago'], WY:['Wyoming','America/Denver'], DC:['District of Columbia','America/New_York'],
};

const COLOR_WORDS = {
  black:'#111111', white:'#FFFFFF', gray:'#6B7280', grey:'#6B7280', silver:'#9CA3AF',
  blue:'#2563EB', navy:'#1E3A8A', sky:'#0EA5E9', teal:'#0D9488', cyan:'#06B6D4',
  green:'#16A34A', lime:'#65A30D', emerald:'#059669', red:'#DC2626', crimson:'#B91C1C',
  orange:'#F97316', amber:'#F59E0B', yellow:'#EAB308', gold:'#D4AF37',
  purple:'#7C3AED', violet:'#8B5CF6', indigo:'#6366F1', pink:'#DB2777', brown:'#92400E', maroon:'#7F1D1D',
};
const DEFAULT_PALETTE = { primary:'#1E293B', secondary:'#334155', accent:'#6366F1' }; // pro slate + indigo

// --- HSL helpers so dark-mode colors stay READABLE on a dark background ---
function hexToHsl(hex) {
  let h = hex.replace('#',''); if (h.length===3) h = h.split('').map(c=>c+c).join('');
  const r=parseInt(h.slice(0,2),16)/255, g=parseInt(h.slice(2,4),16)/255, b=parseInt(h.slice(4,6),16)/255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b); let hue=0,s=0,l=(mx+mn)/2;
  if (mx!==mn){const d=mx-mn; s=l>0.5?d/(2-mx-mn):d/(mx+mn);
    hue = mx===r ? (g-b)/d+(g<b?6:0) : mx===g ? (b-r)/d+2 : (r-g)/d+4; hue*=60;}
  return { h:hue, s:s*100, l:l*100 };
}
function hslToHex(h,s,l){ s/=100; l/=100;
  const k=n=>(n+h/30)%12, a=s*Math.min(l,1-l);
  const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,9-k(n),1));
  const to=x=>Math.round(255*x).toString(16).padStart(2,'0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`.toUpperCase();
}
// Lighten a brand color enough to read as text/button on a dark (#0B1120) bg.
function lightenForDark(hex){
  const {h,s,l}=hexToHsl(hex);
  const ns = s < 12 ? s : Math.max(s, 45);   // near-grey stays grey; coloured stays vivid
  return hslToHex(h, ns, Math.max(l, 66));    // floor lightness so it's never dark-on-dark
}

function buildPalette(branding) {
  let primary, secondary, accent;
  if (Array.isArray(branding) && branding.length) {
    [primary, secondary, accent] = [branding[0], branding[1] || branding[0], branding[2] || branding[0]];
  } else if (typeof branding === 'string' && branding.trim() &&
             !/^(none|default|no preference|none preference|tbd)/i.test(branding.trim())) {
    const hexes = (branding.match(/#[0-9a-fA-F]{6}/g) || []);
    const words = branding.toLowerCase().split(/[,\/&]|\sand\s|\s+/).map(w => w.trim()).filter(Boolean);
    const mapped = words.map(w => COLOR_WORDS[w]).filter(Boolean);
    const colors = [...hexes, ...mapped];
    if (colors.length) {
      // primary = first non-white/non-light; accent = a vivid one if present
      const nonWhite = colors.filter(c => c.toUpperCase() !== '#FFFFFF');
      primary = nonWhite[0] || colors[0];
      // accent = a 2nd named/hex color if one was given; otherwise reuse primary
      // (do NOT invent an accent that wasn't specified — strict to input)
      const vivid = colors.find(c => c !== primary);
      accent = vivid || primary;
      secondary = nonWhite[1] || '#374151';
    }
  }
  primary = primary || DEFAULT_PALETTE.primary;
  secondary = secondary || DEFAULT_PALETTE.secondary;
  accent = accent || DEFAULT_PALETTE.accent;
  return {
    primary_color: primary, secondary_color: secondary, accent_color: accent,
    light_primary_color: primary, light_secondary_color: secondary, light_accent_color: accent,
    light_background_color: '#F8FAFC', light_header_footer_color: primary,
    // dark-mode primary/accent are lightened so links/buttons stay readable on the dark bg
    dark_primary_color: lightenForDark(primary), dark_secondary_color: secondary, dark_accent_color: lightenForDark(accent),
    dark_background_color: '#0B1120', dark_header_footer_color: '#0F172A',
  };
}

function parseTime(s) {
  const m = String(s).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10); const min = m[2] || '00';
  const pm = /p/i.test(m[3]);
  if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0;
  return `${String(h).padStart(2,'0')}:${min}:00`;
}
function parseHours(hoursText) {
  const text = (hoursText || '').trim();
  const dayCols = (open, close, alwaysOpen, enabledAll = true) => {
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const o = {};
    for (const d of days) { o[`${d}_enabled`] = enabledAll; o[`${d}_open`] = open; o[`${d}_close`] = close; }
    return { ...o, working_hours_enabled: true, working_hours_always_open: alwaysOpen,
             working_hours_open: open, working_hours_close: close };
  };
  if (!text) return {}; // no hours given → don't fabricate; leave tenant defaults
  if (/24\s*\/\s*7|24x7|always|round the clock/i.test(text)) {
    return { business_hours: 'Open 24/7', ...dayCols('00:00:00','23:59:00', true) };
  }
  const range = text.match(/(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)\s*[-–to]+\s*(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)/i);
  if (range) {
    const open = parseTime(range[1]) || '09:00:00';
    const close = parseTime(range[2]) || '18:00:00';
    return { business_hours: text, ...dayCols(open, close, false) };
  }
  return { business_hours: text, ...dayCols('09:00:00','18:00:00', false) };
}

const titleCase = s => String(s).replace(/\b\w/g, c => c.toUpperCase());
function shortNameOf(name) {
  return name.replace(/\b(LLC|Inc|Corp|Ltd|Co|Company|Rentals?|Auto|Cars?|Motors?)\b\.?/gi, '').trim().split(/\s+/)[0] || name;
}
function fmtPhoneDisplay(phone) {
  const d = String(phone).replace(/[^0-9]/g, '').replace(/^1/, '');
  return d.length === 10 ? `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}` : phone;
}

// ----------------------------------------------------------- CMS content gen
// (structure ported from scripts/update-cms-content.js — exact section keys
//  and JSON shapes the booking site expects, parametrised by tenant info)
const generateContent = (t) => ({
  home: {
    home_hero: { headline:`Affordable Car Rentals with ${t.name}`, subheading:`${t.specialty}. Quality vehicles at competitive rates in the ${t.location} area.`, background_image:'', phone_number:t.phone, phone_cta_text:`Call ${t.phoneDisplay}`, book_cta_text:'Book Your Ride', trust_line:'Quality Fleet • Competitive Rates • Reliable Service' },
    promo_badge: { enabled:false, discount_amount:'10%', discount_label:'OFF', line1:'First-Time Customer', line2:'Special Discount' },
    service_highlights: { title:`Why Choose ${t.name}?`, subtitle:'Delivering value through quality vehicles and exceptional service.', services:[
      { icon:'ThumbsUp', title:'Quality Vehicles', description:'Well-maintained, reliable vehicles perfect for daily driving and long trips.' },
      { icon:'DollarSign', title:'Competitive Pricing', description:'Affordable rates without hidden fees. Transparent pricing you can trust.' },
      { icon:'MapPin', title:`${t.location} Coverage`, description:`Convenient service throughout ${t.location} and surrounding areas.` },
      { icon:'Fuel', title:'Modern Fleet', description:'A well-kept fleet to suit every trip and budget.' },
      { icon:'Settings', title:'Flexible Options', description:'Daily, weekly and monthly rentals to fit your schedule.' },
      { icon:'Headphones', title:'Personal Support', description:"Friendly, responsive customer service. We're here to help." },
    ] },
    booking_header: { title:'Book Your Rental', subtitle:`Easy and affordable car rentals in ${t.location} — from pickup to drop-off, we've got you covered.`, trust_points:[t.location, 'Transparent Rates', 'Quality Vehicles'] },
    testimonials_header: { title:`Why Drivers Choose ${t.name}` },
    home_cta: { title:`Ready to Book with ${t.name}?`, description:`Affordable, reliable car rentals in ${t.location}. Quality vehicles, honest pricing, and friendly service.`, primary_cta_text:'Book Now', secondary_cta_text:'Get in Touch', trust_points:['Reliable Service','Clean Vehicles','Great Rates'] },
    contact_card: { title:'Have Questions?', description:"We're here to help. Reach out to our team for quick answers and booking support.", phone_number:t.phone, email:t.email, call_button_text:'Call Now', email_button_text:'Email Us' },
    seo: { title:`${t.name} - ${t.tagline}`, description:`Affordable car rentals in ${t.location}. ${t.name} offers quality vehicles at competitive rates.`, keywords:`car rental ${t.region}, ${t.location} car rental, affordable car hire, ${t.name}` },
  },
  about: {
    hero: { title:`About ${t.name}`, subtitle:`Your trusted partner for affordable car rentals in ${t.location}.` },
    about_story: { title:'Quality Rentals, Fair Prices', founded_year:String(t.foundedYear), content:`<p>${t.name} was founded with a simple mission: to provide reliable, affordable car rentals to the ${t.location} community.</p>
<p>We offer a range of well-maintained vehicles that are perfect for everyday use — whether you need a car for commuting, running errands, or taking a road trip.</p>
<p>We believe renting a car shouldn't break the bank. That's why we offer competitive rates with no hidden fees, so you always know exactly what you're paying.</p>
<p>Based in ${t.location}, we serve the surrounding area with convenient pickup and return options.</p>
<p>Our commitment is simple: quality vehicles, fair prices, and friendly service for every customer.</p>` },
    stats: { items:[
      { icon:'clock', label:'YEARS EXPERIENCE', value:'', suffix:'+', use_dynamic:true, dynamic_source:'years_experience' },
      { icon:'car', label:'RENTALS COMPLETED', value:'', suffix:'+', use_dynamic:true, dynamic_source:'total_rentals' },
      { icon:'crown', label:'VEHICLES', value:'', suffix:'+', use_dynamic:true, dynamic_source:'active_vehicles' },
      { icon:'star', label:'CLIENT RATING', value:'', suffix:'', use_dynamic:true, dynamic_source:'avg_rating' },
    ] },
    why_choose_us: { title:`Why Choose ${t.name}`, items:[
      { icon:'car', title:'Quality Fleet', description:'Well-maintained vehicles you can rely on.' },
      { icon:'dollar-sign', title:'Fair Pricing', description:'Competitive rates with no hidden fees. What you see is what you pay.' },
      { icon:'clock', title:'Flexible Hours', description: t.hours ? `${/^\s*open\b/i.test(t.hours) ? t.hours : 'Open ' + t.hours}. We work around your schedule.` : 'Flexible hours to suit your schedule — get in touch to arrange a time.' },
      { icon:'map-pin', title:'Local Service', description:`Proudly serving ${t.location} and surrounding areas.` },
    ] },
    faq_cta: { title:'Still have questions?', description:'Our team is happy to help. Give us a call!', button_text:`Call ${t.phoneDisplay}` },
    final_cta: { title:`Ready to Rent with ${t.name}?`, description:'Book your affordable rental today and experience the difference.', tagline:'Reliable • Affordable • Local' },
    seo: { title:`About Us - ${t.name}`, description:`Learn about ${t.name}'s mission to provide affordable, reliable car rentals in ${t.location}.`, keywords:`about ${t.name}, ${t.location} car rental company` },
  },
  contact: {
    hero: { title:`Contact ${t.name}`, subtitle:`Get in touch for affordable car rentals in ${t.location}.` },
    contact_info: { phone:{ number:t.phone, availability:t.hours || 'Contact us for availability' }, email:{ address:t.email, response_time:'We respond within a few hours' }, office:{ address:t.location }, whatsapp:{ number:t.phone.replace(/[^0-9+]/g,''), description:'Text us for quick responses' } },
    contact_form: { title:'Send Us a Message', subtitle:"We'll get back to you as soon as possible.", success_message:`Thank you for contacting ${t.name}. We'll respond shortly!`, gdpr_text:'I consent to being contacted regarding my enquiry.', submit_button_text:'Send Message', subject_options:['General Enquiry','Booking Question','Vehicle Availability','Pricing','Feedback'] },
    trust_badges: { badges:[ { icon:'shield', label:'Trusted', tooltip:`Trusted by ${t.location} drivers` }, { icon:'clock', label:'Quick Response', tooltip:'We respond quickly to all inquiries' }, { icon:'star', label:'5-Star Service', tooltip:'Rated 5 stars by our customers' } ] },
    pwa_install: { title:`Install ${t.name}`, description:`Add ${t.name} to your home screen for quick access to bookings.` },
    seo: { title:`Contact Us - ${t.name}`, description:`Get in touch with ${t.name} for car rentals in ${t.location}. Call ${t.phoneDisplay} or email us.`, keywords:`contact ${t.name}, ${t.location} car rental phone` },
  },
  fleet: {
    fleet_hero: { headline:'Our Fleet & Pricing', subheading:'Browse our selection of vehicles with transparent daily, weekly, and monthly rates.', background_image:'', primary_cta_text:'Book Now', secondary_cta_text:'View Fleet Below' },
    rental_rates: { section_title:'Flexible Rental Rates', daily:{ title:'Daily', description:'Perfect for short trips and day use.' }, weekly:{ title:'Weekly', description:'Great value for week-long rentals.' }, monthly:{ title:'Monthly', description:'Best rates for extended rentals.' } },
    inclusions: { section_title:`Every ${t.name} Rental Includes`, section_subtitle:'Standard features with every rental.', standard_title:'Standard Inclusions', standard_items:[ { icon:'Shield', title:'Basic Insurance Coverage' }, { icon:'Phone', title:'Roadside Assistance' }, { icon:'MapPin', title:'Unlimited Mileage' }, { icon:'Sparkles', title:'Clean Vehicle' }, { icon:'User', title:'Friendly Service' }, { icon:'Clock', title:'Flexible Pickup' } ], premium_title:'Available Add-ons', premium_items:[ { icon:'User', title:'Additional Driver' }, { icon:'Baby', title:'Child Safety Seat' }, { icon:'MapPin', title:'GPS Navigation' }, { icon:'Shield', title:'Extended Coverage' } ] },
    extras: { items:[ { name:'Child Safety Seat', price:10, description:'Per day' }, { name:'GPS Navigation', price:8, description:'Per day' }, { name:'Additional Driver', price:10, description:'Per day' }, { name:'Extended Insurance', price:15, description:'Per day' } ], footer_text:'All add-ons can be selected during booking.' },
    seo: { title:`Fleet & Pricing - ${t.name}`, description:`Browse ${t.name}'s fleet of vehicles with transparent pricing.`, keywords:`car rental fleet, ${t.location}, rental pricing, ${t.name} vehicles` },
  },
  promotions: {
    promotions_hero: { headline:'Deals & Promotions', subheading:'Save on your next rental with our special offers.', primary_cta_text:'View Fleet & Pricing', primary_cta_href:'/fleet', secondary_cta_text:'Book Now' },
    how_it_works: { title:'How Promotions Work', subtitle:'Simple steps to save on your rental', steps:[ { number:'1', title:'Select Offer', description:'Browse our active promotions' }, { number:'2', title:'Choose Vehicle', description:'Pick from our fleet' }, { number:'3', title:'Apply at Checkout', description:'Savings applied automatically' } ] },
    empty_state: { title_active:'No active promotions right now', title_default:'No promotions found', description:'Check back soon or browse our Fleet & Pricing for great everyday rates.', button_text:'Browse Fleet & Pricing' },
    terms: { title:'Terms & Conditions', terms:['Promotions are subject to availability','Discounts cannot be combined with other offers','Valid for new bookings only','Promo codes must be applied at booking',`${t.name} reserves the right to modify promotions`,'Standard rental terms apply'] },
    seo: { title:`Deals & Promotions - ${t.name}`, description:`Save on car rentals with ${t.name} promotions in ${t.location}.`, keywords:`car rental deals, ${t.location} rental promotions, ${t.name} offers` },
  },
  reviews: {
    hero: { title:'Customer Reviews', subtitle:`What our customers say about ${t.name}.` },
    feedback_cta: { title:'Share your experience', description:`We'd love to hear about your rental experience with ${t.name}.`, button_text:'Leave a Review', empty_state_message:`Be the first to review ${t.name}!` },
    seo: { title:`Customer Reviews - ${t.name}`, description:`Read customer reviews of ${t.name} car rentals in ${t.location}.`, keywords:`${t.name} reviews, ${t.location} car rental reviews` },
  },
  privacy: {
    privacy_content: { title:'Privacy Policy', content:`<h2>Introduction</h2>
<p>${t.name} is committed to protecting your privacy. This policy explains how we handle your information.</p>
<h2>Information We Collect</h2>
<ul><li>Contact details (name, email, phone)</li><li>Booking information (dates, vehicle preferences)</li><li>Payment information (processed securely)</li></ul>
<h2>How We Use Your Information</h2>
<ul><li>Processing your rental bookings</li><li>Communicating about your reservations</li><li>Improving our services</li></ul>
<h2>Contact Us</h2>
<p>For privacy questions, contact us at <a href="mailto:${t.email}">${t.email}</a></p>`, last_updated:t.today },
    seo: { title:`Privacy Policy - ${t.name}`, description:`${t.name} privacy policy - how we protect your information.`, keywords:'privacy policy, data protection' },
  },
  terms: {
    terms_content: { title:'Terms of Service', content:`<h2>Rental Agreement</h2>
<p>By booking with ${t.name}, you agree to these terms.</p>
<h2>Booking and Payment</h2>
<ul><li>Bookings are subject to availability</li><li>Payment required at time of booking</li><li>24-hour cancellation policy applies</li></ul>
<h2>Vehicle Use</h2>
<ul><li>Valid driver's license required</li><li>Vehicles must be returned in the same condition</li><li>Report any issues immediately</li></ul>
<h2>Contact</h2>
<p>Questions? Call us at ${t.phoneDisplay} or email <a href="mailto:${t.email}">${t.email}</a></p>`, last_updated:t.today },
    seo: { title:`Terms of Service - ${t.name}`, description:`${t.name} rental terms and conditions.`, keywords:'terms of service, rental terms' },
  },
  'site-settings': {
    logo: { logo_url:t.logo_url || '', logo_alt:t.name, favicon_url:t.logo_url || '' },
    contact: { phone:t.phone.replace(/[^0-9+]/g,''), phone_display:t.phoneDisplay, email:t.email, address_line1:'', address_line2:'', city:t.city, state:t.stateName, zip:'', country:'USA', google_maps_url:'' },
    social: {},
    footer: { copyright_text:`© ${t.year} ${t.name}. All rights reserved.`, tagline:t.tagline },
    pwa_install: { title:`Install ${t.name}`, description:`Add ${t.name} to your home screen for quick bookings.` },
  },
});

function starterFaqs() {
  return [
    ['What do I need to rent a car?','A valid driver\'s license, a credit or debit card in your name, and you must meet our minimum age requirement.'],
    ['How old do I have to be to rent?','Renters must be at least 21 years old. Some vehicles may have a higher minimum age.'],
    ['Is a security deposit required?','Yes, a refundable security deposit is held at the start of your rental and released after the vehicle is returned in good condition.'],
    ['Do you offer delivery?','We offer flexible pickup and return options. Contact us to arrange delivery in our service area.'],
    ['What is your cancellation policy?','Bookings can be cancelled up to 24 hours before pickup. Please reach out and we\'ll be happy to help.'],
    ['Is insurance included?','Basic coverage is included with every rental. Extended coverage can be added during booking.'],
    ['Can I extend my rental?','Yes — just contact us before your return date and we\'ll arrange an extension if the vehicle is available.'],
    ['What forms of payment do you accept?','We accept all major credit and debit cards through our secure online checkout.'],
  ].map((f, i) => ({ question:f[0], answer:f[1], display_order:i, is_active:true }));
}
function starterTestimonials(name) {
  return [
    ['Marcus J.', 5, `Smooth booking and a spotless car. ${name} made the whole process effortless — highly recommend!`],
    ['Priya S.', 5, 'Great rates and friendly service. Pickup was quick and the car was exactly as described.'],
    ['David R.', 5, 'Reliable and professional. I\'ve rented twice now and both times were excellent.'],
    ['Aisha M.', 5, 'Transparent pricing, no surprises, and the team answered all my questions fast.'],
    ['Tom B.', 5, 'Clean vehicle, easy return, and fair pricing. Will definitely rent again.'],
  ].map(t => ({ author:t[0], company_name:name, stars:t[1], review:t[2] }));
}
function starterExtras() {
  return [
    ['GPS Navigation','In-car GPS with live traffic.',8,0],
    ['Child Safety Seat','Infant / toddler car seat.',10,1],
    ['Additional Driver','Add a second authorised driver.',10,2],
    ['Extended Coverage','Reduce your liability with extra protection.',15,3],
    ['Toll Pass','Worry-free toll road access.',6,4],
  ].map(e => ({ name:e[0], description:e[1], price:e[2], sort_order:e[3], is_active:true, pricing_type:'global' }));
}

// ----------------------------------------------------------------- main flow
async function onboard(slug, cfg) {
  console.log(`\n========================================\n  Onboarding: ${cfg.company_name} (${slug})\n========================================`);

  const { data: tenant, error: tErr } = await supabase
    .from('tenants').select('id, slug, company_name').eq('slug', slug).single();
  if (tErr || !tenant) { console.error(`  ❌ Tenant "${slug}" not found — create it in admin first. Skipping.`); return; }
  const tid = tenant.id;

  const stateAbbr = (cfg.state || '').toUpperCase();
  const [stateName, tz] = STATE[stateAbbr] || [cfg.state || '', cfg.timezone || 'America/New_York'];
  const city = cfg.city || '';
  // service_area: optional label for a multi-area operator (e.g. "New Jersey & New York").
  // When given it drives all customer-facing prose/tagline/meta, while city/state stay
  // split so the structured footer address still reads cleanly.
  const serviceArea = (cfg.service_area && String(cfg.service_area).trim()) || '';
  const location = serviceArea || [city, stateName].filter(Boolean).join(', ');
  const phoneDisplay = fmtPhoneDisplay(cfg.phone);
  const palette = buildPalette(cfg.branding);
  const hours = parseHours(cfg.hours);
  const year = cfg.year || new Date().getFullYear();
  const name = cfg.company_name;

  // ---- 1) tenants row ----
  const update = {
    app_name: name,
    contact_email: cfg.contact_email || undefined,
    contact_phone: cfg.phone || undefined,
    phone: cfg.phone || undefined,
    address: location || undefined,
    ...(cfg.logo_url ? { logo_url: cfg.logo_url, dark_logo_url: cfg.logo_url, auth_logo_url: cfg.logo_url } : {}),
    ...palette,
    meta_title: `${name} — Car Rentals in ${serviceArea || city || stateName}`,
    meta_description: `Car rental services from ${name} in ${location}.`,
    currency_code: 'USD', distance_unit: 'miles', date_format: 'MM/DD/YYYY', timezone: tz,
    ...hours,
    status: 'active',
    // Operator rules are NEVER guessed — set only when explicitly given in config:
    ...(cfg.minimum_rental_age != null ? { minimum_rental_age: cfg.minimum_rental_age } : {}),
    ...(cfg.deposit != null ? { security_deposit_enabled: true, deposit_mode: 'global', global_deposit_amount: cfg.deposit } : {}),
  };
  Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);
  const { error: upErr } = await supabase.from('tenants').update(update).eq('id', tid);
  if (upErr) { console.error('  ❌ tenants update failed:', upErr.message); return; }
  console.log(`  ✅ tenants row updated  (palette ${palette.primary_color}/${palette.accent_color}, tz ${tz}, hours "${hours.business_hours}")`);

  if (!DEMO) {
    console.log('  ↷ strict mode: skipped placeholder content (CMS/FAQs/testimonials/extras/location). Pass --demo-content to generate it.');
    console.log(`  🎉 Done: https://${slug}.drive-247.com  |  https://${slug}.portal.drive-247.com`);
    return;
  }

  // ---- 2) CMS content ----
  const t = {
    name, shortName: shortNameOf(name), tagline: `Car Rentals in ${serviceArea || city || stateName}`,
    phone: cfg.phone, phoneDisplay, email: cfg.contact_email, location, region: serviceArea || city || stateName,
    hours: hours.business_hours || '', specialty: cfg.specialty || 'Economy and premium vehicles',
    city, stateName, foundedYear: cfg.foundedYear || (year - 3), year, today: new Date().toISOString().split('T')[0],
    logo_url: cfg.logo_url || '',
  };
  const CONTENT = generateContent(t);
  // ensure a 'site-settings' page exists so the footer/logo/social CMS layer applies
  const { data: existingPages } = await supabase.from('cms_pages').select('id, slug').eq('tenant_id', tid);
  if (!existingPages?.some(p => p.slug === 'site-settings')) {
    await supabase.from('cms_pages').insert({ tenant_id:tid, slug:'site-settings', name:'Site Settings', status:'published', published_at:new Date().toISOString() });
    console.log('  ✅ created cms_pages "site-settings"');
  }
  const { data: pages } = await supabase.from('cms_pages').select('id, slug, name').eq('tenant_id', tid);
  let secCount = 0;
  for (const page of (pages || [])) {
    const pageContent = CONTENT[page.slug];
    if (!pageContent) continue;
    const { data: existing } = await supabase.from('cms_page_sections')
      .select('id, section_key').eq('page_id', page.id).eq('tenant_id', tid);
    let i = 0;
    for (const [section_key, content] of Object.entries(pageContent)) {
      const ex = existing?.find(s => s.section_key === section_key);
      if (ex) {
        await supabase.from('cms_page_sections').update({ content, updated_at:new Date().toISOString() }).eq('id', ex.id);
      } else {
        await supabase.from('cms_page_sections').insert({ page_id:page.id, section_key, content, display_order:i, is_visible:true, tenant_id:tid });
      }
      i++; secCount++;
    }
    await supabase.from('cms_pages').update({ status:'published', published_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('id', page.id);
  }
  console.log(`  ✅ CMS: ${secCount} sections written across ${pages?.length || 0} pages (published)`);

  // ---- 3) pickup_locations (seed if none) ----
  const { count: locCount } = await supabase.from('pickup_locations').select('id', { count:'exact', head:true }).eq('tenant_id', tid);
  if (!locCount) {
    await supabase.from('pickup_locations').insert({ tenant_id:tid, name:'Main Office', address: location || city || 'Main Location', description:'Primary pickup & return location.', delivery_fee:0, is_pickup_enabled:true, is_return_enabled:true, is_active:true, sort_order:0 });
    console.log('  ✅ pickup_locations: seeded "Main Office"');
  } else { console.log(`  ↷ pickup_locations: ${locCount} already present — skipped`); }

  // ---- 4) faqs (seed if none) ----
  const { count: faqCount } = await supabase.from('faqs').select('id', { count:'exact', head:true }).eq('tenant_id', tid);
  if (!faqCount) {
    await supabase.from('faqs').insert(starterFaqs().map(f => ({ ...f, tenant_id:tid })));
    console.log('  ✅ faqs: seeded starter set');
  } else { console.log(`  ↷ faqs: ${faqCount} already present — skipped`); }

  // ---- 5) testimonials (seed if none) ----
  const { count: tCount } = await supabase.from('testimonials').select('id', { count:'exact', head:true }).eq('tenant_id', tid);
  if (!tCount) {
    await supabase.from('testimonials').insert(starterTestimonials(name).map(x => ({ ...x, tenant_id:tid })));
    console.log('  ✅ testimonials: seeded starter set');
  } else { console.log(`  ↷ testimonials: ${tCount} already present — skipped`); }

  // ---- 6) rental_extras (seed if none) ----
  const { count: eCount } = await supabase.from('rental_extras').select('id', { count:'exact', head:true }).eq('tenant_id', tid);
  if (!eCount) {
    await supabase.from('rental_extras').insert(starterExtras().map(x => ({ ...x, tenant_id:tid })));
    console.log('  ✅ rental_extras: seeded common add-ons');
  } else { console.log(`  ↷ rental_extras: ${eCount} already present — skipped`); }

  console.log(`  🎉 Done: https://${slug}.drive-247.com  |  https://${slug}.portal.drive-247.com`);
}

async function main() {
  const args = process.argv.slice(2);
  const configPath = join(__dirname, 'tenant-onboarding-config.json');
  if (!existsSync(configPath)) { console.error(`❌ Missing config: ${configPath}`); process.exit(1); }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const all = config.tenants || config;
  const slugs = args.includes('--all') ? Object.keys(all) : args.filter(a => !a.startsWith('--'));
  if (!slugs.length) { console.error('Usage: node scripts/tenant-onboarding.mjs <slug> [<slug> ...] | --all'); process.exit(1); }
  for (const slug of slugs) {
    const cfg = all[slug];
    if (!cfg) { console.error(`❌ No config entry for "${slug}" in tenant-onboarding-config.json — skipping.`); continue; }
    await onboard(slug, cfg);
  }
  console.log('\nAll requested tenants processed.\n');
}
main().catch(e => { console.error('Fatal:', e); process.exit(1); });
