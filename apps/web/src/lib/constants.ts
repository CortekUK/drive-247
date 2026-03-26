export const SITE_URL = "https://drive247.co";
export const CALENDLY_URL = "https://calendly.com/neemaghanbarinia/30min";

export const SITE_META = {
  title: "Drive247 — Direct Booking Platform for Independent Car Rental Operators",
  description:
    "A branded booking site, admin system, and renter portal — built for US operators who want more control than Turo.",
  ogImage: "/og.png",
};

export const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#timeline" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export const PROBLEM_POINTS = [
  {
    icon: "DollarSign",
    title: "High platform fees",
    description:
      "Marketplace commissions cut into your margin — often 15–30% before payment processing.",
  },
  {
    icon: "Palette",
    title: "Limited brand control",
    description:
      "Your fleet sits beside competitors with no differentiation or long-term brand equity.",
  },
  {
    icon: "Users",
    title: "You don't own the customer relationship",
    description:
      "The platform controls communication, limiting retention and repeat bookings.",
  },
  {
    icon: "ShieldAlert",
    title: "Policy and algorithm changes",
    description:
      "Marketplace rules, pricing limits, and search rankings can shift overnight — without your input or consent.",
  },
  {
    icon: "TrendingDown",
    title: "Traffic concentration risk",
    description:
      "One algorithm change can cut your visibility overnight. Relying on a single channel puts your entire business at risk.",
  },
];


export const DASHBOARD_SLIDES = [
  {
    id: "fleet",
    trigger: "Fleet Management",
    title: "Fleet Management",
    description: "Real-time visibility across your entire fleet.",
    bullets: [
      "Availability calendar and blackout controls",
      "Vehicle status tracking (available, rented, maintenance)",
      "Add and manage vehicles with photos, pricing, and rules",
      "Location and working-hour configuration",
    ],
    image: "/fleet-management-v3.png",
    imageDark: "/fleet-management-v3-dark.png",
  },
  {
    id: "bookings",
    trigger: "Bookings & Extensions",
    title: "Bookings & Extensions",
    description: "Control every booking from creation to completion.",
    bullets: [
      "View, edit, and approve bookings in one queue",
      "Process extension requests and automatically calculate differences",
      "Booking timeline with full renter activity history",
      "Direct renter communication inside the booking",
    ],
    image: "/bookings-management-v2.png",
    imageDark: "/bookings-management-v2-dark.png",
  },
  {
    id: "payments",
    trigger: "Payments & Documents",
    title: "Payments & Documents",
    description: "Centralised payment processing and document management.",
    bullets: [
      "Collect deposits and rental payments",
      "Track payment status and transaction history",
      "Upload and verify renter documents",
      "Store agreements and booking files securely",
    ],
    image: "/payments-management-v2.png",
    imageDark: "/payments-management-v2-dark.png",
  },
  {
    id: "revenue",
    trigger: "Revenue & Analytics",
    title: "Revenue & Analytics",
    description: "Understand performance across your fleet.",
    bullets: [
      "Revenue tracking by vehicle and date range",
      "Utilisation and booking trends",
      "P&L visibility across the fleet",
      "Downloadable reporting",
    ],
    image: "/revenue-analytics-v2.png",
    imageDark: "/revenue-analytics-v2-dark.png",
  },
  {
    id: "ai",
    trigger: "AI Copilot",
    title: "AI Copilot",
    description:
      "Ask your dashboard anything — revenue trends, occupancy gaps, booking anomalies — and get answers in plain English.",
    body: "Drive247's AI Copilot analyses live booking, revenue, and fleet data to surface what matters. No more digging through reports — just ask.",
    bullets: [
      "\"What was my utilisation last week?\" — instant answers",
      "Automated daily revenue and booking summaries",
      "Intelligent alerts when trends or anomalies appear",
      "Natural-language queries across all your rental data",
    ],
    image: "/og.png",
    video: "/ai-copilot-video-v2.mp4",
    videoDark: "/ai-copilot-video-v2-dark.mp4",
  },
];

export const TESTIMONIALS = [
  {
    before: "We went from juggling spreadsheets and three different apps to running everything from one dashboard. We finally have a system that matches how we actually operate. ",
    bold: "Bookings doubled within the first quarter.",
    after: "",
    name: "Marcus T.",
    initials: "MT",
    role: "Owner",
    fleet: "12-vehicle fleet, Atlanta",
    stars: 5,
  },
  {
    before: "",
    bold: "The branded website alone paid for itself.",
    after: " Customers trust us more when they book on our own site instead of a marketplace listing.",
    name: "Sarah K.",
    initials: "SK",
    role: "Operations Manager",
    fleet: "28-vehicle fleet, Miami",
    stars: 5,
  },
  {
    before: "Setup was painless — ",
    bold: "we were live in five days.",
    after: " The team actually understands what independent operators need.",
    name: "James R.",
    initials: "JR",
    role: "Founder",
    fleet: "8-vehicle fleet, Phoenix",
    stars: 5,
  },
];

export const FAQ_ITEMS = [
  {
    question: "Do you generate demand like Turo?",
    answer:
      "No — Drive247 gives you the tools to run direct, but you bring your own traffic. The upside: every customer is yours. No commissions, no shared listings, full brand control. Most operators already have repeat customers, social media, and referrals — Drive247 makes it easy to convert that traffic into bookings.",
  },
  {
    question: "Do you help with marketing and paid traffic?",
    answer:
      "Drive247 provides the infrastructure to own your bookings. For operators ready to scale, we offer optional paid acquisition management — structured through your own ad accounts, ensuring you retain control and ownership.",
  },
  {
    question: "What about insurance and claims?",
    answer:
      "Drive247 is integration-ready for Bonzah, a rental-specific insurance provider. You can offer coverage at checkout and manage claims through their platform. We help you get set up, but the insurance relationship is between you and the provider. Timeline depends on partner onboarding.",
  },
  {
    question: "How quickly can I go live?",
    answer:
      "Most operators are live within a week of kickoff. The biggest variable is third-party setup — insurance (Bonzah) and ID verification (CheckMyDriver) have their own onboarding timelines. We move fast on our side.",
  },
  {
    question: "Can I keep my current domain?",
    answer:
      "Absolutely. You point your domain to us, and your booking site runs on your own URL. Your brand, your domain, your customer experience.",
  },
  {
    question: "Do I own my data and can I leave anytime?",
    answer:
      "Drive247 is a SaaS platform — you subscribe and use it, but the code isn't yours to take. However, your data is always yours. You can export customer data, booking history, and documents at any time. No lock-in tricks.",
  },
  {
    question: "How much does Drive247 cost?",
    answer:
      "Plans start at $200/mo for small fleets and scale with your vehicle count. Every plan includes a one-time $2,500 onboarding fee. See the pricing section above for a full breakdown — no hidden fees, no long-term contracts.",
  },
];

export const PRICING_TIERS = [
  {
    name: "Pilot",
    price: 200,
    setupFee: 2500,
    vehicleLimit: "Up to 10 vehicles",
    popular: false,
    features: [
      "Full fleet management & tracking",
      "Online booking & payments",
      "Customer management & verification",
      "Automated invoicing & reminders",
      "Real-time customer chat",
      "Reports & P&L dashboard",
      "Stripe payment processing",
      "Insurance integrations (Bonzah)",
    ],
  },
  {
    name: "Growth",
    price: 350,
    setupFee: 2500,
    vehicleLimit: "Up to 40 vehicles",
    popular: true,
    features: [
      "Everything in Pilot",
      "Multi-user access with roles",
      "Dedicated onboarding & growth strategy session",
      "Fully custom branding",
      "Fleet & content setup support",
      "Website & content management",
      "Ongoing growth strategy & optimisation",
      "Optional Meta ads management & optimisation",
      "Verification Partner Access (Paid)",
    ],
  },
  {
    name: "Enterprise",
    price: 650,
    setupFee: 2500,
    vehicleLimit: "Unlimited vehicles",
    popular: false,
    features: [
      "Everything in Growth",
      "Unlimited vehicles",
      "Priority support",
      "Dedicated account manager",
      "Custom feature requests",
      "Tailored infrastructure & scaling support",
    ],
  },
];
