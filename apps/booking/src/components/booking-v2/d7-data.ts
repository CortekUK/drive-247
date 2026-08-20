/**
 * Static chrome for the booking-v2 landing.
 *
 * Everything the customer reads — copy, vehicles, rates, reviews, contact
 * details — now comes from the tenant via `use-d7-content.ts`. What remains
 * here is navigation and site chrome, which is the same on every tenant
 * because it maps to real routes in this app.
 */

/** Top navigation. Anchors are in-page; the rest are real routes. */
export const NAV = [
  { label: "Home",    href: "#top" },
  { label: "Fleet",   href: "/fleet" },
  { label: "Book",    href: "#booking" },
  { label: "Reviews", href: "#offers" },
  { label: "About",   href: "/about" },
  { label: "Contact", href: "/contact" },
];

/** Trust ribbon between the hero and the fleet. */
export const TICKER = [
  "Transparent pricing", "Well-maintained vehicles", "24/7 support",
  "Flexible rates", "Fully insured", "Fast confirmation",
];

/**
 * Footer columns. Mirrors the legacy footer's link set: `/#booking` rather
 * than a bare `#booking` (dead from every page but the home page), and no
 * `/offer` — that route is `/offer/[code]` and 404s without one.
 *
 * FAQ and Blog are conditional, exactly as they are in the header.
 */
export function footerColumns({ hasFaqs, blogEnabled }: { hasFaqs: boolean; blogEnabled: boolean }) {
  return [
    { head: "Rentals", items: [
      { label: "Our Fleet",  href: "/fleet" },
      { label: "Book Now",   href: "/#booking" },
      { label: "Promotions", href: "/promotions" },
    ]},
    { head: "Company", items: [
      { label: "About Us",     href: "/about" },
      { label: "Reviews",      href: "/testimonials" },
      { label: "Contact",      href: "/contact" },
      ...(blogEnabled ? [{ label: "Blog", href: "/blog" }] : []),
    ]},
    { head: "Support", items: [
      ...(hasFaqs ? [{ label: "FAQ", href: "/faq" }] : []),
      { label: "My Account",         href: "/portal" },
      { label: "Terms & Conditions", href: "/terms" },
      { label: "Privacy Policy",     href: "/privacy" },
    ]},
  ];
}

/** Bottom bar. */
export const LEGAL_LINKS = [
  { label: "Privacy Policy",   href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
  { label: "SMS Terms",        href: "/sms-opt-in" },
];
