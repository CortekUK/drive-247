/**
 * The sections of a vehicle record, and the one place they are defined.
 *
 * Imported by BOTH the left rail (`shared/layout/app-sidebar-v2.tsx`) and the
 * screen (`vehicle-detail-v2.tsx`). That is the whole point of the file: the
 * rail and the panel cannot disagree about what sections exist, what they are
 * called, or which one is showing, because neither of them owns the list.
 *
 * This mirrors `rentals-v2/rental-detail/stages.ts` deliberately — the two
 * scoped screens are the same piece of furniture — but the contents differ in
 * kind, and the difference is worth stating. A rental's rail lists DECISIONS,
 * so each row shows the rental's answer where it has one. A vehicle's rail
 * lists PLACES: nine groups of settings on one record that already exists.
 * There is no answer to show, so the rail reads no record state at all and
 * looks identical every time an operator glances at it. How the car is DOING
 * is the right rail's job, in `overview-rail.tsx`.
 */

import type { ComponentType } from "react";
import {
  Banknote,
  CalendarDays,
  Car,
  Globe,
  KeyRound,
  MapPin,
  Package,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

export type SectionId =
  | "vehicle"
  | "rates"
  | "addons"
  | "availability"
  | "pickup"
  | "upkeep"
  | "keys"
  | "listing"
  | "money";

export type VehicleSection = {
  id: SectionId;
  /** Shown in the rail, and as the panel's own heading. */
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export type VehicleSectionGroup = {
  label: string;
  items: readonly VehicleSection[];
};

/**
 * Grouped in the order an operator sets a car up: what it IS, what it COSTS,
 * how it OPERATES, and last the two things produced from all of the above —
 * the public listing and the money it has made.
 *
 * `Record` is last because neither of its sections is an input: both are
 * readouts of the seven above them.
 */
export const SECTION_GROUPS: readonly VehicleSectionGroup[] = [
  {
    label: "The car",
    items: [{ id: "vehicle", label: "Vehicle", icon: Car }],
  },
  {
    label: "Pricing",
    items: [
      { id: "rates", label: "Rates & mileage", icon: Banknote },
      { id: "addons", label: "Extras & surcharges", icon: Package },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "availability", label: "Availability", icon: CalendarDays },
      { id: "pickup", label: "Pickup & handover", icon: MapPin },
      { id: "upkeep", label: "Compliance & servicing", icon: ShieldCheck },
      { id: "keys", label: "Keys & documents", icon: KeyRound },
    ],
  },
  {
    label: "Record",
    items: [
      { id: "listing", label: "Listing", icon: Globe },
      { id: "money", label: "Money", icon: TrendingUp },
    ],
  },
] as const;

/** Flat, in rail order — for the collapsed rail and for lookups. */
export const SECTIONS: readonly VehicleSection[] = SECTION_GROUPS.flatMap((g) => g.items);

/** The section a vehicle opens on when the URL says nothing. */
export const DEFAULT_SECTION: SectionId = "vehicle";

const SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

/**
 * `?section=…` → a section, or the default.
 *
 * Never throws and never renders a blank screen for a typo'd or stale link: an
 * unrecognised value resolves to Vehicle, exactly as an absent one does.
 */
export function readSection(param: string | null | undefined): SectionId {
  return param && SECTION_IDS.has(param) ? (param as SectionId) : DEFAULT_SECTION;
}

/**
 * Where a section lives.
 *
 * The section is in the URL rather than in React state, and that is what lets
 * the rail and the panel agree without sharing anything: they are siblings in
 * the tree, with no provider between them, so the address bar is the only
 * channel they both already have. It pays for itself twice over — a section is
 * deep-linkable, and it survives a refresh. Settings works this way (`?tab=`)
 * and so does the rental control centre (`?stage=`).
 *
 * This replaced a `history.replaceState` mirror of local component state. That
 * was cheaper per click — no RSC round trip — but it wrote the address bar
 * WITHOUT re-rendering anything subscribed to `useSearchParams`, so the moment
 * the rail moved out of this page and into the sidebar the two would have
 * disagreed about which section was open. Correctness over the round trip.
 */
export function sectionHref(vehicleId: string, section: SectionId): string {
  return `/vehicles/${vehicleId}?section=${section}`;
}

/**
 * The path of a vehicle detail page, and nothing else.
 *
 * A UUID rather than "anything after /vehicles/", because `/vehicles` and
 * `/vehicles/analytics` are both real routes and each still wants the ordinary
 * nav. The strict test is also the safe one: an unrecognised path falls through
 * to the normal sidebar, which is a working screen, whereas a false positive is
 * a rail with no vehicle behind it.
 */
const VEHICLE_DETAIL_PATH =
  /^\/vehicles\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

/** The vehicle id this path names, or null if it does not name one. */
export function vehicleIdFromPath(pathname: string | null | undefined): string | null {
  return pathname?.match(VEHICLE_DETAIL_PATH)?.[1] ?? null;
}
