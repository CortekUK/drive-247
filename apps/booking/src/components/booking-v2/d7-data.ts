/**
 * Static content for the booking-v2 landing design.
 * Nothing here is fetched, persisted or validated — this folder is design only.
 *
 * Currency is USD to match the codebase default (`formatCurrency` in
 * `@/lib/format-utils` falls back to 'USD'), NOT the PKR in the reference
 * comp. The rest of the copy follows the comp.
 */

export const money = (n: number) => `$${n.toLocaleString("en-US")}`;

/** Real photography from /public/carousel-images. The names below match what
 *  each photo actually shows — a mislabelled car reads as fake immediately. */
export const SHOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `/carousel-images/car${n}.jpeg`);

export const HERO_SHOT = SHOTS[0];  // silver Honda Civic, downtown skyline
export const CTA_SHOT  = SHOTS[3];  // black Honda Accord, dusk

export type Car = {
  id: string; name: string; klass: string; seats: number;
  gear: string; rate: number; img: string; tag?: string;
};

/** The fleet rail. `klass` is the small grey line under the name in the comp. */
export const FLEET: Car[] = [
  { id: "civic",   name: "Honda Civic",      klass: "Sedan",        seats: 5, gear: "Automatic", rate: 68,  img: SHOTS[0], tag: "Popular" },
  { id: "fusion",  name: "Ford Fusion",      klass: "Sedan",        seats: 5, gear: "Automatic", rate: 74,  img: SHOTS[1] },
  { id: "malibu",  name: "Chevrolet Malibu", klass: "Sedan",        seats: 5, gear: "Automatic", rate: 79,  img: SHOTS[2] },
  { id: "accord",  name: "Honda Accord",     klass: "Premium Sedan",seats: 5, gear: "Automatic", rate: 89,  img: SHOTS[3], tag: "Premium" },
  { id: "elantra", name: "Hyundai Elantra",  klass: "Compact",      seats: 5, gear: "Automatic", rate: 62,  img: SHOTS[4] },
  { id: "sentra",  name: "Nissan Sentra",    klass: "Compact",      seats: 5, gear: "Automatic", rate: 58,  img: SHOTS[5], tag: "Best value" },
  { id: "camry",   name: "Toyota Camry",     klass: "Sedan",        seats: 5, gear: "Automatic", rate: 71,  img: SHOTS[6] },
  { id: "corolla", name: "Toyota Corolla",   klass: "Compact",      seats: 5, gear: "Automatic", rate: 65,  img: SHOTS[7] },
];

/** The three pill badges under the hero paragraph. */
export const HERO_POINTS = [
  { icon: "shield", label: "No Hidden Charges" },
  { icon: "check",  label: "Well Maintained Cars" },
  { icon: "head",   label: "24/7 Support" },
];

/** Four-up strip under the search panel. */
export const STRIP = [
  { icon: "car",    title: "200+ Premium Cars",    sub: "Wide range of vehicles" },
  { icon: "tag",    title: "Best Price Guarantee", sub: "Unbeatable daily rates" },
  { icon: "bolt",   title: "Easy Booking",         sub: "Quick & hassle-free" },
  { icon: "head",   title: "24/7 Roadside Support",sub: "We're here anytime" },
];

/** The stats panel beside "Why Choose Drive247". */
export const STATS = [
  { icon: "pin",   n: 10,    suffix: "+", label: "Cities" },
  { icon: "car",   n: 200,   suffix: "+", label: "Vehicles" },
  { icon: "users", n: 25,    suffix: "K+", label: "Happy Customers" },
  { icon: "star",  n: 99,    suffix: "%", label: "Satisfaction Rate" },
];

/** The three tiles inside the violet offers card. */
export const OFFERS = [
  { icon: "gift", title: "Weekend Getaway",  amount: "Flat 15% OFF",  sub: "On all premium bookings", code: "WEEKEND15" },
  { icon: "cal",  title: "Long Term Saver",  amount: "Up to 25% OFF", sub: "On monthly rentals",      code: "MONTHLY25" },
  { icon: "bolt", title: "Early Bird",       amount: "10% OFF",       sub: "Book 7 days in advance",  code: "EARLY10" },
];

export const REVIEWS = [
  { quote: "Excellent service! The car was in perfect condition and the booking process was super easy. Highly recommended.",
    name: "Alex Rivera", city: "London, UK", stars: 5 },
  { quote: "Transparent pricing and great support throughout the rental. We will definitely book again with Drive247.",
    name: "Sarah Chen", city: "Dubai, UAE", stars: 5 },
  { quote: "Smooth booking process and the Camry was a joy on the long drive. Amazing experience all round.",
    name: "Marcus Bell", city: "Phoenix, USA", stars: 5 },
  { quote: "Picked up in ten minutes flat. No queues, no upsell, no hidden fees. Exactly what was quoted.",
    name: "Priya Nair", city: "Manchester, UK", stars: 5 },
  { quote: "Needed to extend mid-trip and support sorted it in one call. That is why I keep coming back.",
    name: "Daniel Okafor", city: "Abu Dhabi, UAE", stars: 5 },
];

/** "Latest From Drive247" cards. */
export const POSTS = [
  { tag: "Travel Guide", title: "Top 5 Road Trip Destinations in the UAE", img: SHOTS[5],
    read: "6 min read" },
  { tag: "Car Care",     title: "How to Take Care of Your Rental Car",     img: SHOTS[2],
    read: "4 min read" },
];

export const NAV = [
  { label: "Home",    href: "#top" },
  { label: "Cars",    href: "#fleet" },
  { label: "Fleet",   href: "#fleet" },
  { label: "Offers",  href: "#offers" },
  { label: "About",   href: "#why" },
  { label: "Reviews", href: "#reviews" },
  { label: "Contact", href: "#contact" },
];

/** Trust ribbon between the hero and the fleet. */
export const TICKER = [
  "No hidden charges", "Free cancellation", "24/7 roadside support",
  "Unlimited mileage", "Fully insured", "Instant confirmation", "Airport delivery",
];

export const FOOTER_LINKS = [
  { head: "Services", items: ["Cars", "Fleet", "Offers", "Monthly Rentals", "Airport Transfers"] },
  { head: "Company",  items: ["About Us", "Reviews", "Promotions", "Blog", "Careers"] },
  { head: "Support",  items: ["FAQ", "Contact Us", "24/7 Support", "Terms & Conditions", "Privacy Policy"] },
];

export const CONTACT = [
  { icon: "phone", label: "Call us anytime", value: "0800 123 4567" },
  { icon: "mail",  label: "Email us",        value: "hello@drive247.com" },
  { icon: "pin",   label: "Head office",     value: "123 Business Bay, Dubai, UAE" },
];

/* Kept short so they fit the one-line search bar without ellipsis. */
export const LOCATIONS = [
  "Downtown Depot", "Airport T1", "Central Station", "Harbour Point", "Business Park",
];
export const VEHICLE_TYPES = ["Any Type", "Compact", "Sedan", "Premium Sedan", "Estate"];
export const TIMES = ["08:00 AM", "09:00 AM", "10:00 AM", "10:30 AM", "12:00 PM", "02:00 PM", "05:00 PM", "07:30 PM"];
