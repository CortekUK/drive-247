function configuredHttpsUrl(value: string | undefined, fallback: string): string {
  try {
    const url = new URL(value || fallback);
    return url.protocol === "https:" ? url.toString().replace(/\/$/, "") : fallback;
  } catch {
    return fallback;
  }
}

export const SITE_URL = configuredHttpsUrl(
  process.env.NEXT_PUBLIC_SITE_URL,
  "https://drive-247.com",
);

export const GHL_BOOKING_URL = configuredHttpsUrl(
  process.env.NEXT_PUBLIC_GHL_BOOKING_URL,
  "https://api.leadconnectorhq.com/widget/booking/5IaMFcRJ2O4R589QF89C",
);

export const SITE_META = {
  title: "Drive247 — Direct Booking Platform for Independent Car Rental Operators",
  description:
    "A branded booking site, operator portal and renter portal, with Trax built in. For US operators who want more control than Turo.",
  ogImage: "/og.png",
};

export const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export const PROBLEM_POINTS = [
  {
    icon: "UserX",
    title: "You don't own the customer",
    description:
      "Every booking goes through the marketplace, and the renter relationship stays with it. Loyalty, follow-up and repeat business all happen on its terms.",
  },
  {
    icon: "DollarSign",
    title: "You pay for every booking",
    description:
      "Turo's US plans keep 10–30% of each trip's price, depending on the plan. The cost rises with your revenue: the more you rent, the more you hand over.",
  },
  {
    icon: "EyeOff",
    title: "Your brand stays hidden",
    description:
      "Renters see the marketplace first. Your reputation lives on its listing, and your own ads have no site of yours to send people to.",
  },
];

export const TESTIMONIALS = [
  {
    before: "We went from juggling spreadsheets and three different apps to running everything from one dashboard. We finally have a system that matches how we actually operate. ",
    bold: "Bookings doubled within the first quarter.",
    after: "",
    name: "Marcus Thompson",
    initials: "MT",
    role: "Owner",
    fleetSize: "12-vehicle fleet",
    location: "Atlanta",
    stars: 5,
  },
  {
    before: "",
    bold: "The branded website alone paid for itself.",
    after: " Customers trust us more when they book on our own site instead of a marketplace listing.",
    name: "Sarah Alvarez",
    initials: "SA",
    role: "Operations Manager",
    fleetSize: "28-vehicle fleet",
    location: "Miami",
    stars: 5,
  },
  {
    before: "Setup was painless — ",
    bold: "we were live in five days.",
    after: " The team actually understands what independent operators need.",
    name: "James Reilly",
    initials: "JR",
    role: "Founder",
    fleetSize: "8-vehicle fleet",
    location: "Phoenix",
    stars: 5,
  },
];

export const FAQ_ITEMS = [
  {
    question: "Do you generate bookings like Turo?",
    answer:
      "Drive247 is not a marketplace, so bookings don\u2019t come from shared listings like Turo. You get your own booking site and customer flow, and traffic comes from your brand, your repeat customers and any ads you choose to run.",
  },
  {
    question: "Do you help with marketing and paid traffic?",
    answer:
      "Drive247 is your booking system, and ad management isn’t part of a plan. Your site runs on your own domain, so you can point Google and Meta ads at it through your own accounts. Bring your ad questions to your strategy call.",
  },
  {
    question: "Can I keep my current domain?",
    answer:
      "Yes. Your booking site can run on your own domain, connected from your portal with two DNS records, or on a Drive247 subdomain. Your brand stays front and centre, and customers book through your own site.",
  },
  {
    question: "How quickly can we go live?",
    answer:
      "Your portal and booking site are ready the day you sign up. Going live means adding your fleet and connecting payments, and we aim to have you taking bookings within 7 days. Stripe or Square approval is part of that timing.",
  },
  {
    question: "What do I need before getting started?",
    answer:
      "To sign up, you need a card and your business details. To talk first, you need nothing ready: we\u2019ll review your fleet size, booking process and payment requirements, then show you the clearest route to launch.",
  },
  {
    question: "Is Drive247 only for Turo hosts?",
    answer:
      "No. Drive247 is built for independent rental operators, whether you currently use Turo, take bookings through social media, manage rentals manually, or already have a website.",
  },
  {
    question: "Will I still own my customers?",
    answer:
      "Yes. Your customer details, booking history, payments, agreements and communication stay within your own rental operation instead of sitting inside a marketplace.",
  },
  {
    question: "What happens on the strategy call?",
    answer:
      "We review your current setup, understand how your bookings work today, explain what your direct booking system could look like, and give you a tailored 7-day launch plan.",
  },
];

export const PLATFORM_FEATURES = [
  "Branded booking website on your domain",
  "Full fleet management & tracking",
  "Online booking & payments via Stripe",
  "Customer management & verification",
  "Automated invoicing & reminders",
  "Real-time customer chat",
  "Reports & P&L dashboard",
  "Dedicated onboarding & setup",
  "Fully custom branding",
  "Multi-user access with roles",
  "Growth strategy & optimisation",
  "Insurance integrations (Bonzah)",
];
