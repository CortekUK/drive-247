/**
 * Static content for the booking-v2 landing.
 *
 * This page is a design, not an integration: nothing here is fetched, and no
 * value on the page comes from a tenant's database. The product screenshots
 * further down are markup, not images, so they stay crisp at any zoom.
 */

/** Photography from /public/carousel-images. */
export const CAR_SHOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `/carousel-images/car${n}.jpeg`);

export const NAV = ["Product", "Solutions", "Resources", "Pricing", "About"];

export const BUSINESS_TYPES = ["Car rental", "Fleet leasing", "Car sharing", "Chauffeur service", "Dealership"];
export const BOOKING_RANGES = ["Under 50", "50 – 200", "200 – 500", "500 – 1,000", "1,000+"];

/** The five numbered modules. `mock` selects which screenshot to render. */
export const MODULES = [
  { n: "01", icon: "calendar", title: "Bookings",
    copy: "Create, manage and track bookings across channels in real time.", mock: "bookings" },
  { n: "02", icon: "car", title: "Fleet",
    copy: "Manage availability, maintenance, documents and costs.", mock: "fleet" },
  { n: "03", icon: "users", title: "Customers",
    copy: "Centralize customer profiles, history and communication.", mock: "customers" },
  { n: "04", icon: "card", title: "Payments",
    copy: "Invoices, payments and refunds — all reconciled.", mock: "payments" },
  { n: "05", icon: "chart", title: "Reports",
    copy: "Real-time reports that help you act with confidence.", mock: "reports" },
] as const;

/** Rows inside the Bookings mockup. */
export const MOCK_BOOKINGS = [
  { ref: "BK-10482", customer: "John Smith", vehicle: "Toyota Yaris", from: "May 24, 10:00", to: "May 27, 10:00", status: "Confirmed" },
];

export const MOCK_FLEET = [
  { name: "Toyota Yaris", spec: "2023 · Compact · AT", status: "Available", tone: "ok" as const, img: CAR_SHOTS[0] },
  { name: "Honda City",   spec: "2022 · Sedan · AT",   status: "Rented",    tone: "stop" as const, img: CAR_SHOTS[3] },
];

export const MOCK_PAYMENTS = [
  { inv: "INV-2024-1057", customer: "John Smith", date: "May 20, 2024", amount: "SGD 420.00", status: "Paid",    tone: "ok" as const },
  { inv: "INV-2024-1056", customer: "John Smith", date: "May 18, 2024", amount: "SGD 380.00", status: "Pending", tone: "warn" as const },
];

export const MOCK_REPORTS = [
  { label: "Total Bookings",   value: "128",         delta: "+14.2%" },
  { label: "Revenue",          value: "SGD 245,560", delta: "+18.6%" },
  { label: "Fleet Utilization",value: "72%",         delta: "+5.4%"  },
  { label: "Repeat Customers", value: "48%",         delta: "+8.7%"  },
];

/** The dashboard showcase. */
export const DASH_NAV = ["Dashboard", "Bookings", "Fleet", "Customers", "Payments", "Reports", "Settings"];

export const DASH_STATS = [
  { label: "Bookings",         value: "128",         delta: "+14.2%" },
  { label: "Revenue",          value: "SGD 245,560", delta: "+18.6%" },
  { label: "Fleet Utilization",value: "68%",         delta: "+5.4%"  },
  { label: "Active Rentals",   value: "96",          delta: "+12.1%" },
];

export const DASH_TOP_VEHICLES = [
  { name: "Toyota Yaris",   share: "41%" },
  { name: "Honda City",     share: "26%" },
  { name: "Toyota Corolla", share: "14%" },
  { name: "Others",         share: "19%" },
];

/** Twelve months of the bookings trend line, as percentages of the chart height. */
export const DASH_TREND = [28, 34, 30, 44, 39, 52, 47, 63, 56, 71, 64, 78];

/** The fleet showcase strip. */
export const FLEET_SHOWCASE = [
  { name: "Toyota Yaris",   type: "Compact",  img: CAR_SHOTS[0] },
  { name: "Honda City",     type: "Sedan",    img: CAR_SHOTS[3] },
  { name: "Toyota Corolla", type: "Sedan",    img: CAR_SHOTS[7] },
  { name: "Toyota Innova",  type: "7 Seater", img: CAR_SHOTS[5] },
];

export const OUTCOMES = [
  { icon: "trend",  title: "Increase revenue", copy: "Capture more bookings and improve conversion." },
  { icon: "shield", title: "Reduce risk",      copy: "Stay compliant and protect your business." },
  { icon: "clock",  title: "Save time",        copy: "Automate work and simplify daily operations." },
  { icon: "smile",  title: "Delight customers",copy: "Deliver a seamless experience every time." },
];
