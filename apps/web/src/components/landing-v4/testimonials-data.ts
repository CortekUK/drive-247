/*
 * The testimonials on the v2 landing page. The section shows nine at a time
 * and keeps swapping them for ones not already on screen, so add as many as
 * you like — each is one entry here, text or video, in any order.
 *
 *   text   { kind: "text",  name, role, quote, … }
 *          `quote` is a string, or an array of strings for separate paragraphs.
 *   video  { kind: "video", name, role, company, title, video, poster, … }
 *          `video` is an .mp4 under public/ (or any URL a <video> can play),
 *          shown muted and swapped out when it ends; `poster` is the still
 *          shown while it loads; `title` is the headline over it.
 *
 * `avatar` is optional; without one the card shows the initials on `color`.
 *
 * PLACEHOLDERS: every entry below is demo content, and the videos are
 * generated stand-in clips (public/landing-v4/testimonials/clip-*.mp4).
 * Replace them with real customers before this page goes live.
 */

type Base = {
  name: string;
  role: string;
  avatar?: string;
  color: string;
};

export type TextTestimonial = Base & { kind: "text"; quote: string | string[] };
export type VideoTestimonial = Base & { kind: "video"; company: string; title: string; video: string; poster: string };
export type Testimonial = TextTestimonial | VideoTestimonial;

const clip = (n: number) => ({ video: `/landing-v4/testimonials/clip-${n}.mp4`, poster: `/landing-v4/testimonials/clip-${n}.jpg` });

export const TESTIMONIALS: Testimonial[] = [
  { kind: "video", name: "Marcus Thompson", role: "Owner", company: "Peachtree Rentals", color: "#442dd7", title: "How Marcus moved his bookings off the marketplace", ...clip(1) },
  { kind: "video", name: "Sarah Alvarez", role: "Operations manager", company: "Bayside Car Hire", color: "#12a594", title: "Running checks and handovers without a counter", ...clip(2) },
  { kind: "video", name: "Kwame Mensah", role: "Founder", company: "Mensah Motors", color: "#e5484d", title: "From spreadsheets to one portal in a weekend", ...clip(3) },
  { kind: "video", name: "Elena Petrova", role: "Co-owner", company: "Desert Drive Co.", color: "#f76b15", title: "Why insurance at checkout changed our bookings", ...clip(4) },
  { kind: "video", name: "Ravi Kapoor", role: "General manager", company: "Harbor Fleet", color: "#0090ff", title: "Letting Trax chase the late payments", ...clip(5) },
  { kind: "video", name: "Hannah Brooks", role: "Owner", company: "Brooks EV Rentals", color: "#8e4ec6", title: "Lockbox pickups, any hour of the day", ...clip(6) },

  {
    kind: "text",
    name: "Maya Okafor",
    role: "Owner · 14-car fleet, LA",
    avatar: "/landing-v3/avatars/a1.webp",
    color: "#5b5bd6",
    quote: [
      "Drive247 replaced a spreadsheet, two inboxes and a very tired phone.",
      "I check one screen in the morning and the day just runs: bookings, deposits, keys, all of it.",
    ],
  },
  {
    kind: "text",
    name: "Daniel Reyes",
    role: "Founder · Luxury rentals, Miami",
    avatar: "/landing-v3/avatars/a2.webp",
    color: "#12a594",
    quote: "Customers book at 2am and I wake up to a signed agreement and a paid deposit. My team finally gets weekends back.",
  },
  {
    kind: "text",
    name: "Priya Shah",
    role: "Operations lead · 32 cars, Dallas",
    avatar: "/landing-v3/avatars/a3.webp",
    color: "#e5484d",
    quote: [
      "Trax tells me who owes money before I even open my laptop.",
      "I stopped chasing late payments. It chases for me, politely, every single time.",
    ],
  },
  {
    kind: "text",
    name: "Tom Lindqvist",
    role: "General manager · Airport fleet, Phoenix",
    avatar: "/landing-v3/avatars/a4.webp",
    color: "#f76b15",
    quote: "We moved our bookings over in an afternoon. The team was taking payments on the new booking site the same day.",
  },
  {
    kind: "text",
    name: "Aisha Bello",
    role: "Co-owner · Van hire, Austin",
    avatar: "/landing-v3/avatars/a5.webp",
    color: "#8e4ec6",
    quote: "Lockbox handovers changed our weekends. No one waits at the counter any more. The code arrives by text and the van is gone.",
  },
  {
    kind: "text",
    name: "Jonas Weber",
    role: "Owner · 9 EVs, Denver",
    avatar: "/landing-v3/avatars/a6.webp",
    color: "#0090ff",
    quote: "The ID checks are the quiet hero. Licence and selfie verified before pickup means fewer awkward conversations at the car.",
  },
  {
    kind: "text",
    name: "Carlos Mendes",
    role: "Owner · 20 cars, San Diego",
    color: "#2c1aa8",
    quote: [
      "Insurance used to be a phone call and a PDF.",
      "Now renters add Bonzah cover right at checkout and the policy is attached to the booking before I see it.",
    ],
  },
  {
    kind: "text",
    name: "Grace Liu",
    role: "Bookkeeper · Coastal Car Hire",
    color: "#12a594",
    quote: "Invoices and payments sync to Xero on their own. Month end went from two days of copy-paste to a quick review.",
  },
  {
    kind: "text",
    name: "Omar Haddad",
    role: "Founder · Rideshare rentals, Houston",
    color: "#f76b15",
    quote: [
      "Most of our renters drive for Uber and Lyft.",
      "Weekly plans with auto-charge mean the money lands every week without me sending a single reminder.",
    ],
  },
  {
    kind: "text",
    name: "Lucy Fairbanks",
    role: "Operations · 45 cars, Orlando",
    color: "#e5484d",
    quote: "The booking calendar is the first thing my team opens. Every car, every rental, every gap, all on one line.",
  },
  {
    kind: "text",
    name: "Ben Okoro",
    role: "Owner · 7 cars, Atlanta",
    color: "#5b5bd6",
    quote: "Agreements go out for e-signature the moment someone books. I haven't printed a contract since we switched.",
  },
  {
    kind: "text",
    name: "Sofia Romano",
    role: "Co-founder · Boutique rentals, Las Vegas",
    color: "#8e4ec6",
    quote: [
      "Our booking site looks like us, not like a marketplace listing.",
      "Our colours, our cars, our domain, and repeat customers book direct instead of paying someone else's fees.",
    ],
  },
  {
    kind: "text",
    name: "James Whitfield",
    role: "Owner · Trucks & vans, Nashville",
    color: "#0090ff",
    quote: "Weekend and holiday pricing runs by itself now. I set the surcharge once and stopped editing rates every Friday night.",
  },
  {
    kind: "text",
    name: "Nadia Rahman",
    role: "Customer service lead · Seattle",
    color: "#12a594",
    quote: "Renters log into their own portal for receipts, agreements and payments. Half of our 'can you resend…' emails just disappeared.",
  },
  {
    kind: "text",
    name: "Victor Alvarez",
    role: "Owner · 26 cars, El Paso",
    color: "#2c1aa8",
    quote: [
      "Deposits are held on the card and released when the car comes back clean.",
      "No more cash in a drawer and no more chasing refunds by hand.",
    ],
  },
  {
    kind: "text",
    name: "Emily Carter",
    role: "Finance · Prairie Car Rentals",
    color: "#f76b15",
    quote: "The P&L view finally showed us which cars were actually making money. We sold two and bought three better ones.",
  },
  {
    kind: "text",
    name: "Hugo Lambert",
    role: "Owner · Exotic fleet, Scottsdale",
    color: "#e5484d",
    quote: "Face match against the licence gives me confidence handing over a six-figure car to someone I've never met.",
  },
  {
    kind: "text",
    name: "Rachel Kim",
    role: "Manager · 18 cars, Portland",
    color: "#5b5bd6",
    quote: "I can give my staff exactly the tabs they need and nothing else. Setting up a new hire takes two minutes.",
  },
];
