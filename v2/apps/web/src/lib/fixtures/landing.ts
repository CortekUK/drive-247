import {
  BadgeCheck,
  CalendarRange,
  Car,
  Key,
  MapPin,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type Brand = {
  id: string;
  name: string;
};

export const BRANDS: Brand[] = [
  { id: "bentley", name: "Bentley" },
  { id: "aston-martin", name: "Aston Martin" },
  { id: "audi", name: "Audi" },
  { id: "bmw", name: "BMW" },
  { id: "chevrolet", name: "Chevrolet" },
  { id: "lexus", name: "Lexus" },
];

export type Vehicle = {
  id: string;
  name: string;
  year: number;
  trim: string;
  brandId: Brand["id"];
  seats: number;
  transmission: "auto" | "manual";
  rangeLiters: number;
  pricePerDay: number;
  status: "ready" | "queued";
  image: string;
};

const VANQUISH_IMG = "/booking_landingpage/vanquish.png";

export const FLEET: Vehicle[] = [
  { id: "v1", name: "Vanquish", year: 2024, trim: "Silver Birch", brandId: "aston-martin", seats: 2, transmission: "auto", rangeLiters: 100, pricePerDay: 500, status: "ready", image: VANQUISH_IMG },
  { id: "v2", name: "Vanquish", year: 2024, trim: "Silver Birch", brandId: "aston-martin", seats: 2, transmission: "auto", rangeLiters: 100, pricePerDay: 500, status: "ready", image: VANQUISH_IMG },
  { id: "v3", name: "Vanquish", year: 2024, trim: "Silver Birch", brandId: "aston-martin", seats: 2, transmission: "auto", rangeLiters: 100, pricePerDay: 500, status: "ready", image: VANQUISH_IMG },
  { id: "v4", name: "Vanquish", year: 2024, trim: "Silver Birch", brandId: "aston-martin", seats: 2, transmission: "auto", rangeLiters: 100, pricePerDay: 500, status: "ready", image: VANQUISH_IMG },
  { id: "v5", name: "Vanquish", year: 2024, trim: "Silver Birch", brandId: "aston-martin", seats: 2, transmission: "auto", rangeLiters: 100, pricePerDay: 500, status: "ready", image: VANQUISH_IMG },
  { id: "v6", name: "Vanquish", year: 2024, trim: "Silver Birch", brandId: "aston-martin", seats: 2, transmission: "auto", rangeLiters: 100, pricePerDay: 500, status: "ready", image: VANQUISH_IMG },
];

export type ChooseUsFeature = {
  id: string;
  title: string;
  description: string;
  variant: "feature" | "small" | "muted";
};

export const CHOOSE_US: ChooseUsFeature[] = [
  {
    id: "premium",
    variant: "feature",
    title: "Premium Fleet",
    description:
      "From the Rolls-Royce Phantom to the Range Rover Autobiography, every vehicle represents automotive excellence and comfort.",
  },
  {
    id: "flexible",
    variant: "small",
    title: "Flexible Terms",
    description:
      "Choose from daily, weekly, or monthly rental periods. Competitive rates with no hidden fees or surprises.",
  },
  {
    id: "availability",
    variant: "small",
    title: "24/7 Availability",
    description:
      "Whether weekday or weekend, we’re ready to respond at a moment’s notice — anywhere across the USA.",
  },
  {
    id: "privacy",
    variant: "muted",
    title: "Privacy & Discretion",
    description:
      "Your rental details remain completely private. We maintain strict confidentiality for all our distinguished clients.",
  },
];

export type Stat = { id: string; value: string; label: string };

export const STATS: Stat[] = [
  { id: "years", value: "15+", label: "Years of Excellence." },
  { id: "assets", value: "28+", label: "Premium Assets." },
  { id: "journeys", value: "1,500+", label: "Journeys Completed." },
  { id: "rating", value: "4.9/5", label: "Client Rating." },
];

export type Step = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

export const STEPS: Step[] = [
  { id: "plan", title: "Plan", description: "Define your trip dates and destination.", icon: MapPin },
  { id: "select", title: "Select", description: "Pick the perfect ride from our premium fleet.", icon: Car },
  { id: "verify", title: "Verify", description: "Quick, secure ID and insurance check.", icon: ShieldCheck },
  { id: "personalize", title: "Personalize", description: "Add your details and any trip extras.", icon: UserRound },
  { id: "drive", title: "Drive", description: "Review, confirm, and unlock your vehicle.", icon: Key },
];

export type Testimonial = {
  id: string;
  quote: string;
  author: string;
};

export const TESTIMONIALS: Testimonial[] = [
  {
    id: "marcus",
    author: "Marcus J.",
    quote:
      "Finally, a rental service that values precision. I was skeptical about the ‘Exact Car’ promise, but the Porsche 911 I booked was the exact one waiting for me — fully fueled, spotless, and with the maintenance vitals exactly as shown on the site. It’s a level of transparency I’ve never seen in the industry.",
  },
  {
    id: "sarah",
    author: "Sarah L.",
    quote:
      "I rented the Aston Martin for a weekend trip, and the ‘Readiness Pulse’ wasn’t just a marketing gimmick. You can tell these cars are digitally monitored; the engine felt tight, the brakes were sharp, and the cabin was showroom-clean. Drive247 has completely removed the ‘what if’ from renting high-performance vehicles.",
  },
];

export type Faq = {
  id: string;
  question: string;
  answer: string;
};

export const FAQS: Faq[] = [
  {
    id: "exact-car",
    question: "How can I be sure the car I see on the screen is the exact one I will drive?",
    answer:
      "We have eliminated the ‘or similar’ bait-and-switch. Because our fleet is digitally integrated, every listing you see is tied to a specific VIN and license plate. When you book a silver Aston Martin Vanquish with ID DEV-F3O11, our system locks that exact asset for you.",
  },
  {
    id: "real-time-monitoring",
    question: "What does ‘Real-Time Health Monitoring’ actually mean for my safety during the rental?",
    answer:
      "Each vehicle streams live diagnostics — tire pressure, brake life, fluid levels and engine health — to our operations team. If anything drifts outside healthy thresholds we are alerted immediately and can intervene before it affects your trip.",
  },
  {
    id: "sanitized",
    question: "How do you verify that a vehicle has been sanitized and fully fueled before my pickup?",
    answer:
      "Every vehicle goes through a digital pickup checklist. Sanitization, fueling and interior condition are signed off by our team and time-stamped. The verification record is attached to your booking before keys are released.",
  },
  {
    id: "documents",
    question: "What documents do I need to provide, and can the car be delivered directly to my hotel or airport?",
    answer:
      "A valid driver’s license, proof of insurance and a payment method are all that’s required. We deliver to most major hotels and airports — pricing and ETA are confirmed during checkout.",
  },
  {
    id: "health-alert",
    question: "What happens if the car detects a ‘Health Alert’ or mechanical issue while I am on the road?",
    answer:
      "You’ll receive an in-app notification and our 24/7 concierge will contact you. If a swap is needed we will deliver a replacement vehicle to your location and handle the logistics end-to-end.",
  },
];

export type FooterIcon = {
  id: string;
  Icon: LucideIcon;
  href: string;
  label: string;
};

export const READINESS_METRICS = [
  { id: "pristine", label: "Pristine", value: 90, Icon: BadgeCheck },
  { id: "mechanical", label: "Mechanical Health", value: 97, Icon: ShieldCheck },
  { id: "hygiene", label: "Hygiene & Sanitization Score", value: 99, Icon: CalendarRange },
] as const;
