export const BASE_DOMAIN = "drive247.com";

export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "admin",
  "portal",
  "api",
  "app",
]);

export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/fleet", label: "Fleet and Pricing" },
  { href: "/reviews", label: "Reviews" },
  { href: "/promotions", label: "Promotions" },
  { href: "/contact", label: "Contact" },
] as const;

export const FOOTER_LINKS = {
  Company: [
    { href: "/about", label: "About us" },
    { href: "/contact", label: "Contact us" },
    { href: "/careers", label: "Careers" },
    { href: "/press", label: "Press" },
  ],
  "Popular Models": [
    { href: "/fleet/audi-a4", label: "Audi A4" },
    { href: "/fleet/porsche-911", label: "Porsche 911 Carrera" },
    { href: "/fleet/mercedes-e-class", label: "Mercedes-Benz E-Class" },
    { href: "/fleet/bmw-m4", label: "BMW M4" },
    { href: "/fleet/lexus-es-350", label: "Lexus ES 350" },
  ],
  Services: [
    { href: "/fleet", label: "Fleet and Pricing" },
    { href: "/booking", label: "Book a Vehicle" },
    { href: "/promotions", label: "Promotions" },
  ],
  Legal: [
    { href: "/privacy", label: "Privacy Policy" },
    { href: "/terms", label: "Terms & Conditions" },
    { href: "/return-policy", label: "Return Policy" },
  ],
} as const;

export const CONTACT_INFO = {
  email: "support@carrentals.io",
  phone: "+133-394-3439-1435",
} as const;
