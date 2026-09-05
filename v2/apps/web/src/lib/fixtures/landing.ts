import { BadgeCheck, CalendarRange, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * What is left of the landing-page fixtures.
 *
 * `TESTIMONIALS`, `FAQS`, `CHOOSE_US`, `STATS` and `STEPS` used to live here.
 * They are not deleted so much as PROMOTED: their copy is now the typed
 * fallback in `src/lib/cms/defaults.ts`, where the CMS layer merges the
 * operator's own content over it field by field. Keeping a second copy here
 * would guarantee the two drifted.
 *
 * What remains is design data with no CMS counterpart and no operator who
 * would ever edit it.
 */

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

/**
 * The six identical prototype cars. No longer rendered anywhere — both the home
 * strip and the /fleet browser read the tenant's real `vehicles` rows — and
 * kept only as the reference for what the Figma cards were drawn against.
 */
export const FLEET: Vehicle[] = [
  { id: "v1", name: "Vanquish", year: 2024, trim: "Silver Birch", brandId: "aston-martin", seats: 2, transmission: "auto", rangeLiters: 100, pricePerDay: 500, status: "ready", image: VANQUISH_IMG },
  { id: "v2", name: "Vanquish", year: 2024, trim: "Silver Birch", brandId: "aston-martin", seats: 2, transmission: "auto", rangeLiters: 100, pricePerDay: 500, status: "ready", image: VANQUISH_IMG },
  { id: "v3", name: "Vanquish", year: 2024, trim: "Silver Birch", brandId: "aston-martin", seats: 2, transmission: "auto", rangeLiters: 100, pricePerDay: 500, status: "ready", image: VANQUISH_IMG },
  { id: "v4", name: "Vanquish", year: 2024, trim: "Silver Birch", brandId: "aston-martin", seats: 2, transmission: "auto", rangeLiters: 100, pricePerDay: 500, status: "ready", image: VANQUISH_IMG },
  { id: "v5", name: "Vanquish", year: 2024, trim: "Silver Birch", brandId: "aston-martin", seats: 2, transmission: "auto", rangeLiters: 100, pricePerDay: 500, status: "ready", image: VANQUISH_IMG },
  { id: "v6", name: "Vanquish", year: 2024, trim: "Silver Birch", brandId: "aston-martin", seats: 2, transmission: "auto", rangeLiters: 100, pricePerDay: 500, status: "ready", image: VANQUISH_IMG },
];

export type FooterIcon = {
  id: string;
  Icon: LucideIcon;
  href: string;
  label: string;
};

/**
 * The readiness dial on the hero card. A design constant on purpose: these are
 * the illustration's own numbers, not a claim about any tenant's fleet, and the
 * portal has no field for them.
 */
export const READINESS_METRICS = [
  { id: "pristine", label: "Pristine", value: 90, Icon: BadgeCheck },
  { id: "mechanical", label: "Mechanical Health", value: 97, Icon: ShieldCheck },
  { id: "hygiene", label: "Hygiene & Sanitization Score", value: 99, Icon: CalendarRange },
] as const;
