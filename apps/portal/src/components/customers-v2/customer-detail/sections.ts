/**
 * The sections of a customer record, and the one place they are defined.
 *
 * Imported by BOTH the left rail (`shared/layout/app-sidebar-v2.tsx`) and the
 * screen (`customer-detail-v2.tsx`). That is the whole point of the file: the
 * rail and the panel cannot disagree about what sections exist, what they are
 * called, or which one is showing, because neither of them owns the list.
 *
 * ── why a section is NOT a stage ────────────────────────────────────────────
 *
 * The rental rail next door renders each row as the ANSWER the rental carries,
 * because a rental is assembled out of nothing and every row is a decision
 * still to be made. A customer record already exists. There are no decisions to
 * echo, and eleven rows each reporting their own little status turns navigation
 * into a second, worse summary competing with the real one — which has a column
 * of its own on the far side of the screen (`overview-rail.tsx`).
 *
 * So these rows carry a label and an icon and nothing else. That is deliberate,
 * it was corrected into place once already, and it should not drift back.
 */

import type { ComponentType } from "react";
import {
  Car,
  Clock,
  CreditCard,
  FileText,
  Gavel,
  IdCard,
  MessageSquare,
  ShieldCheck,
  Star,
  User,
  UserCog,
} from "lucide-react";
import type { CustomerRecord, EditableColumn } from "./types";

export type SectionId =
  // The person — what an operator types in
  | "identity"
  | "licence"
  | "documents"
  // Standing — what has been decided about them
  | "verification"
  | "account"
  | "consent"
  // History — what they have actually done
  | "rentals"
  | "money"
  | "fines"
  | "reviews"
  | "activity";

export type Section = {
  id: SectionId;
  /** Shown in the rail, and as the panel's title. */
  label: string;
  icon: ComponentType<{ className?: string }>;
};

/**
 * The three groups are the shape of the record, and they hold whether or not
 * anything is filled in: what the person told us, what has been decided about
 * them, and what they have actually done.
 */
export const SECTION_GROUPS: readonly { label: string; items: readonly Section[] }[] = [
  {
    label: "The person",
    items: [
      { id: "identity", label: "Identity", icon: User },
      { id: "licence", label: "Licence & driving", icon: IdCard },
      { id: "documents", label: "Documents", icon: FileText },
    ],
  },
  {
    label: "Standing",
    items: [
      { id: "verification", label: "Verification", icon: ShieldCheck },
      { id: "account", label: "Account", icon: UserCog },
      { id: "consent", label: "Consent", icon: MessageSquare },
    ],
  },
  {
    label: "History",
    items: [
      { id: "rentals", label: "Rentals", icon: Car },
      { id: "money", label: "Money", icon: CreditCard },
      { id: "fines", label: "Fines", icon: Gavel },
      { id: "reviews", label: "Reviews", icon: Star },
      { id: "activity", label: "Activity", icon: Clock },
    ],
  },
] as const;

/** Flat, in rail order. Derived, so the groups stay the single definition. */
export const SECTIONS: readonly Section[] = SECTION_GROUPS.flatMap((g) => g.items);

/** The section a record opens on when the URL says nothing. */
export const DEFAULT_SECTION: SectionId = "identity";

const SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

/**
 * v1's `?tab=` vocabulary, where it still means something here.
 *
 * The v1 page and this one are the SAME route, so a link an operator bookmarked
 * — or one another screen still generates — arrives carrying `?tab=payments`.
 * Dropping it on Identity would be silently wrong: it looks like the deep link
 * worked. Anything genuinely unrecognised still falls back to the default.
 */
const V1_TAB_ALIASES: Record<string, SectionId> = {
  payments: "money",
  "gig-driver": "licence",
  vehicles: "rentals",
};

/**
 * `?section=…` → a section, or the default.
 *
 * Never throws and never renders a blank screen for a typo'd or stale link: an
 * unrecognised value resolves to Identity, exactly as an absent one does.
 */
export function readSection(param: string | null | undefined): SectionId {
  if (!param) return DEFAULT_SECTION;
  if (SECTION_IDS.has(param)) return param as SectionId;
  return V1_TAB_ALIASES[param] ?? DEFAULT_SECTION;
}

/**
 * The section this URL is asking for.
 *
 * `?section=` is what this screen writes. `?tab=` is only read, and only
 * because v1 wrote it on the same route for years — so both the rail and the
 * page go through here rather than reading the param themselves, which is what
 * stops the two of them disagreeing about which one wins.
 *
 * Takes the two values rather than a `URLSearchParams`, so it stays a pure
 * function and the rail's `ReadonlyURLSearchParams` needs no cast.
 */
export function readSectionFrom(
  section: string | null | undefined,
  tab: string | null | undefined
): SectionId {
  return readSection(section ?? tab);
}

/**
 * Where a section lives.
 *
 * The section is in the URL rather than in React state, and that is a decision
 * with three consequences worth keeping: the rail and the page read the same
 * `?section=` with no shared context between them; a section is deep-linkable
 * and survives a refresh; and both Settings (`?tab=`) and the rental control
 * centre (`?stage=`) already work exactly this way, so all three scoped screens
 * behave identically.
 */
export function sectionHref(customerId: string, section: SectionId): string {
  return `/customers/${customerId}?section=${section}`;
}

/**
 * What EVERY section component is handed. This is the contract, so it is small
 * on purpose.
 *
 * It lives here rather than in `customer-detail-v2.tsx` for one boring reason:
 * a section importing its props type from the screen that renders it is a
 * module cycle, which survives only as long as everybody remembers to write
 * `import type`. Here there is nothing to remember.
 *
 * `c` is non-null. The screen resolves loading and not-found BEFORE it mounts a
 * section, so no section has to render a skeleton or guard for a missing
 * customer.
 */
export type SectionProps = {
  /** The assembled record. Sections never touch Supabase for it themselves. */
  c: CustomerRecord;
  /** Applies immediately on screen, then persists. There is no Save. */
  set: (patch: Partial<Record<EditableColumn, string | boolean | null>>) => void;
  /** Move to another section. The URL is the source of truth; this just sets it. */
  onJump: (s: SectionId) => void;
  /** False for a manager with viewer-only access to Customers. */
  canEdit: boolean;
  currency: string;
};

/**
 * Is this path a customer record, and whose?
 *
 * Lives here rather than in the sidebar because it is a fact about the customer
 * route, and both this screen's rail and anything else that needs it should read
 * one copy of it.
 *
 * Matches a UUID only. `/customers` and `/customers/analytics` are both real
 * routes and every one of them still wants the ordinary nav, so a stricter test
 * is also the safe one: an unrecognised path falls through to the normal
 * sidebar, which is a working screen, whereas a false positive is a rail with no
 * customer behind it.
 */
export function customerIdFromPath(pathname: string | null | undefined): string | null {
  return (
    pathname?.match(
      /^\/customers\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/
    )?.[1] ?? null
  );
}
