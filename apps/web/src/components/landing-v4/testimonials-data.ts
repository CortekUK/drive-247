/*
 * The testimonials on the v2 landing page. The section shows nine at a time
 * and keeps swapping them for ones not already on screen, so add as many as
 * you like — each is one entry here, text or video, in any order.
 *
 *   text   { kind: "text",  name, role, quote, … }
 *          `quote` is a string, or an array of strings for separate paragraphs.
 *   video  { kind: "video", name, role, company, title, video, photo, … }
 *          `photo` is the still the card shows before and around the clip;
 *          `video` (an .mp4 under public/, or any URL a <video> can play) plays
 *          over it; `title` is the headline.
 *
 * `avatar` is optional; without one the card shows the initials on `color`.
 *
 * PLACEHOLDERS: every text entry below is demo content. The video cards are
 * REAL footage used as stand-ins until customer videos exist: short cuts of
 * the founder's strategy-call videos (public/strategy-call/videos, cut to
 * public/landing-v4/testimonials/founder-*.mp4), labelled as the founder, not
 * as customers. Replace them with real customer videos before this page goes live.
 */

type Base = {
  name: string;
  role: string;
  avatar?: string;
  color: string;
};

export type TextTestimonial = Base & { kind: "text"; quote: string | string[] };
export type VideoTestimonial = Base & { kind: "video"; company: string; title: string; video: string; photo: string };
export type Testimonial = TextTestimonial | VideoTestimonial;

const T = "/landing-v4/testimonials";
const founder = (slug: string) => ({ video: `${T}/${slug}.mp4`, photo: `${T}/${slug}.webp` });

export const TESTIMONIALS: Testimonial[] = [
  { kind: "video", name: "From the founder", role: "Founder", company: "Drive247", color: "#442dd7", title: "If your Turo account went tomorrow, how much would go with it?", ...founder("founder-turo") },
  { kind: "video", name: "From the founder", role: "Founder", company: "Drive247", color: "#442dd7", title: "On a marketplace, the customer isn\u2019t yours", ...founder("founder-own-customers") },
  { kind: "video", name: "From the founder", role: "Founder", company: "Drive247", color: "#442dd7", title: "Why renters trust your own booking site", ...founder("founder-trust") },
  { kind: "video", name: "From the founder", role: "Founder", company: "Drive247", color: "#442dd7", title: "Who Drive247 is built for", ...founder("founder-who-for") },

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
];
