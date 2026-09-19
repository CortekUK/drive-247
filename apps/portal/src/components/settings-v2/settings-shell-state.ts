/**
 * v2 Settings shell: the state decisions around the pages, as pure functions.
 *
 * v2 ONLY (northwind). `settings/page.tsx` calls these inside its
 * `if (v2Chrome)` branch, the index and `/settings/blacklist` call them from
 * v2-only components. Nothing here renders, so every branch is unit-tested.
 *
 * Order of decisions for a `?tab=` deep link, first match wins:
 *   1. no `?tab=`                         -> the index, no notice
 *   2. a v2 page, manager grants loading  -> wait (skeleton, never the index)
 *   3. a v2 page the user may view        -> the page (a General section's
 *                                            old tab: General, scrolled to it)
 *   4. a v2 page the user may NOT view    -> index + "You don't have access"
 *   5. a tab with a home elsewhere        -> none (the page's redirect runs)
 *   6. a hidden tab the board owns        -> none (hand-off to /integrations)
 *   7. a known tab this workspace hides   -> index + "isn't available"
 *      (anything in V2_HIDDEN_SETTINGS_PAGES, and the global blacklist)
 *   8. anything else                      -> index + "doesn't exist"
 */

export type SettingsTabNotice =
  | { kind: "none" }
  | { kind: "wait" }
  | { kind: "no-access"; label: string }
  | { kind: "unavailable"; label: string }
  | { kind: "unknown"; value: string };

/** Human names for v1 tab values that have no v2 page, for the notices. */
export const SETTINGS_TAB_LABELS: Record<string, string> = {
  accounting: "Accounting",
  inshur: "INSHUR",
  tesla: "Tesla",
  payments: "Payments",
  messaging: "Messaging",
  esign: "E-signatures",
  branding: "Branding",
  blacklist: "Global blacklist",
  subscription: "Subscription",
  promos: "Promo codes",
  extras: "Extras",
  installments: "Installments",
  payg: "Pay as you go",
  "auto-extend": "Auto-extension",
};

/* -------------------------------------------------------------------------- */
/* Which page a `?tab=` opens                                                  */
/* -------------------------------------------------------------------------- */

/**
 * v2 settings pages taken out of Settings (front end only). A page listed here
 * keeps its entry and render case in `settings/page.tsx`, but the index does
 * not list it and a `?tab=` link to one lands on the index with "isn't part of
 * your workspace". Hiding a page again is adding its tab here.
 *
 * NOTHING IS HIDDEN NOW. Promo codes, Extras, Installments, Pay as you go and
 * Auto-extension were hidden from Sep 17 2026 and are back on the index (Sep
 * 19 2026). The set and the notice path stay so the next page can be hidden
 * with one line.
 */
export const V2_HIDDEN_SETTINGS_PAGES: ReadonlySet<string> = new Set<string>([]);

export interface V2GeneralSection {
  /** The element id is `settings-<anchor>` (see `settingsSectionId`). */
  anchor: string;
  title: string;
  description: string;
  /** The settings tab whose manager permission this section follows. */
  permTab: string;
  /** The old `?tab=` value this section answers to, if it had its own page. */
  tab: string | null;
}

/**
 * The General page, top to bottom. Six small pages became sections of it; each
 * keeps its old `?tab=` value (setup guide and bookmark links), which opens
 * General and scrolls to that section, and each keeps its own permission.
 */
export const V2_GENERAL_SECTIONS: readonly V2GeneralSection[] = [
  { anchor: "regional", title: "Regional", description: "The currency and distance unit used across prices, invoices and mileage.", permTab: "general", tab: "general" },
  { anchor: "driver-requirements", title: "Driver requirements", description: "Who can rent from you, and the ID they must verify.", permTab: "requirements", tab: "requirements" },
  { anchor: "booking-rules", title: "Booking rules", description: "How far ahead customers book, how long a rental can be, and the gap between rentals.", permTab: "duration", tab: "duration" },
  { anchor: "key-handover", title: "Key handover", description: "Leave the keys in a lockbox and email the code to the customer.", permTab: "lockbox", tab: "lockbox" },
  { anchor: "tax-and-fees", title: "Tax and fees", description: "Charges added on top of the rental price.", permTab: "fees", tab: "fees" },
  { anchor: "security-deposit", title: "Security deposit", description: "A refundable amount taken on online bookings.", permTab: "preauth", tab: "preauth" },
  { anchor: "booking-site", title: "Booking site", description: "What customers see when they book on your website.", permTab: "general", tab: "booking-site" },
  { anchor: "optional-modules", title: "Optional modules", description: "Each one adds a page to your sidebar and saves as soon as you flip it. Switching one off hides the page and deletes nothing.", permTab: "general", tab: null },
];

/** The DOM id of a settings section, the target of a deep link or `#hash`. */
export const settingsSectionId = (anchor: string) => `settings-${anchor}`;

/** Every permission a General section follows, once each: General opens when ANY of them is viewable. */
export const V2_GENERAL_PERM_TABS: readonly string[] = Array.from(new Set(V2_GENERAL_SECTIONS.map((s) => s.permTab)));

export interface V2SettingsRoute {
  /** The v2 page to render, or null for the index. Not permission-checked. */
  page: string | null;
  /** The section to scroll to once the page has loaded (never for `?tab=general`, which is the top). */
  anchor: string | null;
  /** The permission(s) the route needs: one tab, or any of several (General itself). */
  permTab: string | readonly string[] | null;
}

const NO_ROUTE: V2SettingsRoute = { page: null, anchor: null, permTab: null };
const hasOwn = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/**
 * Which v2 page a `?tab=` value opens. A tab that is now a section of General
 * opens General at that section and needs that section's permission; plain
 * `?tab=general` needs any General section's. Hidden pages and unknown values
 * open the index (the notice says why).
 */
export function resolveV2SettingsRoute(
  tabParam: string | null,
  pages: Record<string, { permTab: string }>,
): V2SettingsRoute {
  const tab = tabParam?.trim() ?? "";
  if (!tab) return NO_ROUTE;
  if (tab === "general") return { page: "general", anchor: null, permTab: V2_GENERAL_PERM_TABS };
  const section = V2_GENERAL_SECTIONS.find((s) => s.tab === tab);
  if (section) return { page: "general", anchor: section.anchor, permTab: section.permTab };
  if (V2_HIDDEN_SETTINGS_PAGES.has(tab) || !hasOwn(pages, tab)) return NO_ROUTE;
  return { page: tab, anchor: null, permTab: pages[tab].permTab };
}

/** A route's permission, one tab or any of several. */
export function canViewAny(permTab: string | readonly string[], canView: (tab: string) => boolean): boolean {
  return typeof permTab === "string" ? canView(permTab) : permTab.some(canView);
}

/**
 * The pages map `resolveSettingsTabNotice` reads: every page that is not
 * hidden, General with its any-of permission, and each General section under
 * its old tab, so `?tab=fees` without access still says "You don't have
 * access to Tax and fees".
 */
export function v2NoticePages(
  pages: Record<string, { title: string; permTab: string }>,
): Record<string, { title: string; permTab: string | readonly string[] }> {
  const out: Record<string, { title: string; permTab: string | readonly string[] }> = {};
  for (const [tab, page] of Object.entries(pages)) {
    if (V2_HIDDEN_SETTINGS_PAGES.has(tab)) continue;
    out[tab] = { title: page.title, permTab: page.permTab };
  }
  if (out.general) out.general = { ...out.general, permTab: V2_GENERAL_PERM_TABS };
  for (const section of V2_GENERAL_SECTIONS) {
    if (section.tab && section.tab !== "general") out[section.tab] = { title: section.title, permTab: section.permTab };
  }
  return out;
}

export function resolveSettingsTabNotice({
  tabParam,
  pages,
  redirects,
  allTabs,
  canView,
  isHidden,
  boardCard,
  permissionsLoading,
}: {
  tabParam: string | null;
  /** `permTab` may list several tabs: the page is viewable when any of them is. */
  pages: Record<string, { title: string; permTab: string | readonly string[] }>;
  redirects: Record<string, string>;
  allTabs: readonly string[];
  canView: (tab: string) => boolean;
  isHidden: (tab: string) => boolean;
  boardCard: (tab: string) => string | null;
  permissionsLoading: boolean;
}): SettingsTabNotice {
  const tab = tabParam?.trim() ?? "";
  if (!tab) return { kind: "none" };

  const page = hasOwn(pages, tab) ? pages[tab] : undefined;
  if (page) {
    if (canViewAny(page.permTab, canView)) return { kind: "none" };
    if (permissionsLoading) return { kind: "wait" };
    return { kind: "no-access", label: page.title };
  }

  if (Object.prototype.hasOwnProperty.call(redirects, tab)) return { kind: "none" };
  if (isHidden(tab) && boardCard(tab) !== null) return { kind: "none" };
  if (allTabs.includes(tab)) {
    return { kind: "unavailable", label: SETTINGS_TAB_LABELS[tab] ?? tab };
  }
  return { kind: "unknown", value: tab };
}

/** The sentence each notice shows. `null` for kinds that show nothing. */
export function settingsTabNoticeCopy(notice: SettingsTabNotice): { title: string; body: string } | null {
  switch (notice.kind) {
    case "no-access":
      return {
        title: `You don't have access to ${notice.label}`,
        body: "Ask a head admin to share it with you. Everything you can open is listed below.",
      };
    case "unavailable":
      return {
        title: `${notice.label} isn't part of your workspace`,
        body: "The link you followed points at a setting you don't have. Everything you can change is listed below.",
      };
    case "unknown":
      return {
        title: "That settings page doesn't exist",
        body: "The link may be old or mistyped. Everything you can change is listed below.",
      };
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Data a page reads before it may render its form                             */
/* -------------------------------------------------------------------------- */

/**
 * v2 pages whose controls are filled from the org settings edge function.
 *
 * General is not listed: it reads the org settings, the rental settings and
 * the branding, and each of its sections gates itself (the regional panel, the
 * rental sections' `BusinessRentalGate` / `ReadGate`), so a failed org read no
 * longer hides Driver requirements, Tax and fees and the rest.
 */
export const V2_PAGES_READING_ORG_SETTINGS: ReadonlySet<string> = new Set(["reminders"]);

/**
 * v2 pages whose controls are filled from the tenants row (`useRentalSettings`)
 * and wait for it at page level.
 *
 * Custom pricing and General also read that row but are not listed: each
 * section gates itself on the cached read (`ReadGate` in pricing-money-parts,
 * `BusinessRentalGate` in business-rules-pages), so a first load shows
 * skeletons shaped like those sections, and a failed rental read no longer
 * hides the sections that have reads of their own.
 */
export const V2_PAGES_READING_RENTAL_SETTINGS: ReadonlySet<string> = new Set([
  "payg",
  "auto-extend",
  "templates",
]);

export type SettingsPageDataState =
  | { kind: "ready" }
  | { kind: "loading" }
  | { kind: "error"; source: "org" | "rental"; error: unknown };

/**
 * Whether a v2 page may render its form yet.
 *
 * Both settings hooks serve PLACEHOLDER defaults while they load, and the
 * rental hook keeps returning defaults after a failed read. A form filled from
 * either looks like the tenant's real configuration, and one Save would write
 * those defaults over it. So a page that reads one of them renders its form
 * only once a real row is in hand:
 *
 *  - org settings: the placeholder carries `org_id: 'placeholder'`; a failed
 *    read leaves `settings` undefined.
 *  - rental settings: only a row that came back from the database carries
 *    `_paygMigrationReady` (the hook adds it to real rows, never to defaults).
 *
 * A stale real row with a later refetch error counts as ready: the data shown
 * is still the tenant's own.
 */
export function resolveSettingsPageData({
  page,
  org,
  rental,
}: {
  page: string | null;
  org: { settings: unknown; error: unknown };
  rental: { settings: unknown; error: unknown };
}): SettingsPageDataState {
  if (!page) return { kind: "ready" };

  if (V2_PAGES_READING_ORG_SETTINGS.has(page)) {
    const s = org.settings as { org_id?: unknown } | null | undefined;
    const real = !!s && s.org_id !== "placeholder";
    if (!real) return org.error ? { kind: "error", source: "org", error: org.error } : { kind: "loading" };
  }

  if (V2_PAGES_READING_RENTAL_SETTINGS.has(page)) {
    const s = rental.settings;
    const real = !!s && typeof s === "object" && "_paygMigrationReady" in (s as object);
    if (!real) return rental.error ? { kind: "error", source: "rental", error: rental.error } : { kind: "loading" };
  }

  return { kind: "ready" };
}

/* -------------------------------------------------------------------------- */
/* Unsaved changes                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Can "Save & Leave" / "Save & Switch" actually save what is dirty?
 *
 * `saveAllDirtyForms` persists only the General and Branding forms. Offering
 * the button while the rental form, locations or pricing rules are dirty
 * saves nothing for them, reports success and navigates away, so the edits
 * are lost while the operator believes they were kept. Offer only Cancel and
 * Don't Save in that case.
 */
export function canSaveAllDirty(dirty: {
  rental: boolean;
  locations: boolean;
  pricing: boolean;
}): boolean {
  return !dirty.rental && !dirty.locations && !dirty.pricing;
}

/**
 * v2: does the settings page hold a GENUINE unsaved edit? Driven by what each
 * section registered (sections register only while their own number-aware
 * check says dirty), not by the page-wide `rentalFormDirty`, whose strict
 * comparison counts a typed "10" over a saved 10 as a change.
 *
 *   sections         keys registered with the page (`registerV2SectionSave`);
 *                    the General panel and the booking-site colours are among
 *                    them, so the page's own General and Branding flags (which
 *                    read dirty for one render while a tenant loads) are not used
 *   locations        Locations reports unsaved edits (it saves on its own page)
 *   pricing          Weekend pricing reports unsaved edits
 *   rentalUncovered  a rental-form field no registered section saves differs
 */
export function v2HasUnsavedEdits(state: {
  sections: readonly string[];
  locations: boolean;
  pricing: boolean;
  rentalUncovered: boolean;
}): boolean {
  return state.sections.length > 0 || state.locations || state.pricing || state.rentalUncovered;
}

/**
 * v2: can the page's one Save (its save bar, or "Save" in the leave dialog)
 * save EVERYTHING unsaved? Saving runs every registered section save plus the
 * General form, so an edit counts as saveable when its section registered:
 * weekend pricing under "pricing-weekend", Locations under "locations". A
 * rental-form edit no registered section covers (`rentalEditsCoveredBySections`)
 * makes it false, so Save is never offered over an edit it would drop.
 */
export function canSaveV2Edits(state: {
  registered: readonly string[];
  locations: boolean;
  pricing: boolean;
  rentalUncovered: boolean;
}): boolean {
  if (state.rentalUncovered) return false;
  if (state.locations && !state.registered.includes("locations")) return false;
  if (state.pricing && !state.registered.includes("pricing-weekend")) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Index search: where a setting that is not on the index lives                */
/* -------------------------------------------------------------------------- */

export interface SettingsSearchHandoff {
  /** What the operator was looking for, as a noun: "Payments". */
  label: string;
  /** Where it lives now. */
  where: string;
  href: string;
}

const HANDOFFS: { words: string[]; handoff: SettingsSearchHandoff }[] = [
  {
    words: ["stripe", "square", "payment", "payments", "payout", "connect"],
    handoff: { label: "Payments", where: "Integrations", href: "/integrations" },
  },
  {
    words: ["twilio", "sms", "text message", "whatsapp", "calling", "phone number", "messaging"],
    handoff: { label: "Text messages and calling", where: "Integrations", href: "/integrations" },
  },
  {
    words: ["bonzah", "insurance", "inshur", "cover"],
    handoff: { label: "Insurance", where: "Integrations", href: "/integrations?open=Bonzah" },
  },
  {
    words: ["boldsign", "e-sign", "esign", "signature", "signing"],
    handoff: { label: "E-signatures", where: "Integrations", href: "/integrations?open=BoldSign" },
  },
  {
    words: ["xero", "zoho", "accounting", "quickbooks", "ledger"],
    handoff: { label: "Accounting", where: "Integrations", href: "/integrations" },
  },
  {
    words: ["tesla", "supercharger"],
    handoff: { label: "Tesla", where: "Integrations", href: "/integrations?open=Tesla" },
  },
  {
    words: ["subscription", "billing", "invoice", "plan", "pay drive247"],
    handoff: { label: "Your Drive247 subscription", where: "Billing", href: "/subscription" },
  },
  // Team members, roles and passwords are the index's own Team entry now (head
  // admins only), so they are found by the search, not handed off.
];

/**
 * The hand-off for a search that names something managed elsewhere, or null.
 * Matches a whole word ("sms"), or a prefix of one once 4+ characters are typed
 * ("stri" finds Stripe) so a short word like "car" does not suggest Payments.
 */
export function findSettingsSearchHandoff(query: string): SettingsSearchHandoff | null {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return null;
  for (const { words, handoff } of HANDOFFS) {
    if (words.some((w) => w === q || (q.length >= 4 && w.startsWith(q)) || q.split(/\s+/).includes(w))) return handoff;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* /settings/blacklist                                                         */
/* -------------------------------------------------------------------------- */

export type BlacklistViewState = "loading" | "error" | "error-stale" | "empty" | "no-match" | "rows";

export function resolveBlacklistView({
  isLoading,
  error,
  total,
  filtered,
}: {
  isLoading: boolean;
  error: unknown;
  /** Rows in the cache, or null when nothing was ever loaded. */
  total: number | null;
  filtered: number;
}): BlacklistViewState {
  if (total === null) {
    if (error) return "error";
    return "loading";
  }
  if (isLoading && total === 0 && !error) return "loading";
  if (total === 0) return error ? "error" : "empty";
  if (filtered === 0) return "no-match";
  return error ? "error-stale" : "rows";
}

/**
 * A block count that is really blocking: a whole number above zero. The only
 * counts the Total blocks tile adds up and the Status column shows in red.
 */
export function isPositiveCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

/**
 * "1 company", "3 companies". "0 companies" is a real value: a row stays on the
 * list once its blocks are lifted, and the count is updated to what is left
 * (`check_and_update_global_blacklist`). A missing, negative or fractional
 * count cannot come from that function, so it reads "—" rather than
 * "-3 companies".
 */
export function formatCompanyCount(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return "—";
  return `${n.toLocaleString("en-US")} ${n === 1 ? "company" : "companies"}`;
}

/** Search across email, company names and reasons; null-safe on every field. */
export function matchesBlacklistSearch(
  entry: {
    email?: string | null;
    blocking_tenants?: { tenant_name?: string | null; reason?: string | null }[] | null;
  },
  search: string,
): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  if ((entry.email ?? "").toLowerCase().includes(q)) return true;
  return (entry.blocking_tenants ?? []).some(
    (t) => (t?.tenant_name ?? "").toLowerCase().includes(q) || (t?.reason ?? "").toLowerCase().includes(q),
  );
}
