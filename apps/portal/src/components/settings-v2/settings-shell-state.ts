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
 *   3. a v2 page the user may view        -> the page (a section's old tab:
 *                                            the page that holds it now, at
 *                                            that section — scrolled to it on
 *                                            a stacked page, its tab picked on
 *                                            a tabbed one; see
 *                                            V2_SECTIONED_PAGES)
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

/** One titled section of a v2 settings page that holds several (General, Tax and deposit, Notifications). */
export interface V2PageSection {
  /** The element id is `settings-<anchor>` (see `settingsSectionId`). */
  anchor: string;
  title: string;
  description: string;
  /** The settings tab whose manager permission this section follows. */
  permTab: string;
  /**
   * The `?tab=` value this section answers to, if it once had a page (or a
   * place) of its own: that link opens the page holding it now, scrolled to it.
   * A section whose `tab` is its own page's key is simply the top of the page.
   */
  tab: string | null;
  /**
   * This section IS the top of its page: nothing but the page title precedes
   * it, so its `tab` opens the page rather than scrolling to it. Scrolling
   * would put the section's own heading under the sticky top bar and take the
   * page title off screen, for no gain. A first section that DOES have
   * something above it (Notifications draws its notice and its Channels
   * heading first) leaves this off, so its old tab still scrolls.
   */
  atPageTop?: boolean;
}

/** The name General's sections had first; every section of a sectioned page has this shape. */
export type V2GeneralSection = V2PageSection;

/**
 * The General page, top to bottom (team lead review, Sep 19 2026).
 *
 * Regional (currency, distance unit), then Driver requirements, then Monthly
 * rate. It is a STACKED page: the three sections are headings one under
 * another, not a tab strip — the lead settled that at transcript 00:54
 * ("Regional comes here, Driver requirements comes here, then put the monthly
 * one somewhere under these"). `?tab=general` opens the page and
 * `?tab=requirements` scrolls to Driver requirements (the setup guide and the
 * platform checklist link there); each section keeps its own permission.
 *
 * Booking rules, Lockbox (was Key handover), Tax and deposit (Tax and fees
 * plus Security deposit), Booking site and Optional modules were sections of
 * General from Sep 17 and are pages of their own on the index now. Their old
 * `?tab=` values (duration, lockbox, fees, preauth, booking-site) still work.
 *
 * Monthly rate moved here from the pricing page (Sep 19 2026). It keeps the
 * `pricing` permission, so exactly the people who could change it before can
 * change it now; `?tab=pricing` still opens Weekend and holiday pricing, so it
 * has no `tab` of its own. Its title and description are `MONTHLY_RATE_SECTION`
 * in pricing-rules-v2 (a test keeps the two copies equal).
 */
export const V2_GENERAL_SECTIONS: readonly V2PageSection[] = [
  { anchor: "regional", title: "Regional", description: "The currency and distance unit used across prices, invoices and mileage.", permTab: "general", tab: "general", atPageTop: true },
  { anchor: "driver-requirements", title: "Driver requirements", description: "Who can rent from you, and the ID they must verify.", permTab: "requirements", tab: "requirements" },
  { anchor: "monthly-rate", title: "Monthly rate", description: "When a rental is long enough to be priced at your monthly rate instead of the daily or weekly one.", permTab: "pricing", tab: null },
];

/**
 * The Tax and deposit page (`?tab=tax-and-deposit`), top to bottom: the two
 * former pages, each under its own permission. `?tab=fees` opens the page at
 * the top (Tax and fees is first) and `?tab=preauth` scrolls to the deposit.
 */
export const V2_TAX_AND_DEPOSIT_SECTIONS: readonly V2PageSection[] = [
  { anchor: "tax-and-fees", title: "Tax and fees", description: "Charges added on top of the rental price.", permTab: "fees", tab: "fees", atPageTop: true },
  { anchor: "security-deposit", title: "Security deposit", description: "A refundable amount taken on online bookings.", permTab: "preauth", tab: "preauth" },
];

/**
 * The Notifications page (`?tab=notifications`), the parts of it an old link
 * points at. It replaced Team emails and Push notifications on the index (Sep
 * 19 2026, build-spec D7): `?tab=reminders` opens it at the email setup and
 * `?tab=push` at "Push on this device". Neither is `atPageTop` — the page
 * draws its notice and its Channels heading above both cards, so each old tab
 * scrolls. Every part follows the one Notifications permission
 * (`notifications`, `reminders` and `push` all map to settings.reminders,
 * lib/permissions), so access is exactly what it was. The titles are what a
 * "You don't have access to …" notice names; the page draws its own headings
 * (notifications-page-v2).
 */
export const V2_NOTIFICATIONS_SECTIONS: readonly V2PageSection[] = [
  { anchor: "notifications-email", title: "Email notifications", description: "Who your emails come from, and where your team's alert emails go.", permTab: "notifications", tab: "reminders" },
  { anchor: "notifications-push", title: "Push notifications", description: "Alerts on your team's phones and computers, and how to turn them on.", permTab: "notifications", tab: "push" },
];

function hasOwn(record: object, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Every v2 page made of sections, keyed by the page's own `?tab=`. The page
 * opens for anyone who may view ANY of its sections, each section's old `?tab=`
 * opens the page at that section, and an old `#settings-<anchor>` link lands on
 * whichever page holds that anchor now (`v2SectionHomePage`). Moving a section
 * between pages is moving its row.
 *
 * `stack`: every section on the page, one under another, and the link to a
 * section scrolls to it. `tabs`: one section at a time behind a tab strip, and
 * the link to a section picks its tab instead.
 *
 * NOTHING IS TABBED NOW. General was tabs for a day and is stacked again on the
 * lead's decision (see V2_GENERAL_SECTIONS); the two layouts and everything
 * that reads them stay, so the next page can be tabs with one word.
 */
export const V2_SECTIONED_PAGES: Readonly<Record<string, { layout: "tabs" | "stack"; sections: readonly V2PageSection[] }>> = {
  general: { layout: "stack", sections: V2_GENERAL_SECTIONS },
  "tax-and-deposit": { layout: "stack", sections: V2_TAX_AND_DEPOSIT_SECTIONS },
  notifications: { layout: "stack", sections: V2_NOTIFICATIONS_SECTIONS },
};

/** The sections of a sectioned page, or none. */
export function v2PageSections(page: string | null | undefined): readonly V2PageSection[] {
  return page && hasOwn(V2_SECTIONED_PAGES, page) ? V2_SECTIONED_PAGES[page].sections : [];
}

/** A page whose sections are tabs: a link to a section opens its tab instead of scrolling. */
export function isTabbedV2Page(page: string | null | undefined): boolean {
  return !!page && hasOwn(V2_SECTIONED_PAGES, page) && V2_SECTIONED_PAGES[page].layout === "tabs";
}

/** The DOM id of a settings section, the target of a deep link or `#hash`. */
export const settingsSectionId = (anchor: string) => `settings-${anchor}`;

/** Every permission a page's sections follow, once each, in page order: the page opens when ANY of them is viewable. */
const permTabsOf = (sections: readonly V2PageSection[]) => Array.from(new Set(sections.map((s) => s.permTab)));

/** Regional, Driver requirements, Monthly rate: General opens when any of the three is viewable. */
export const V2_GENERAL_PERM_TABS: readonly string[] = permTabsOf(V2_GENERAL_SECTIONS);

/** Tax and deposit opens when either half is viewable. */
export const V2_TAX_AND_DEPOSIT_PERM_TABS: readonly string[] = permTabsOf(V2_TAX_AND_DEPOSIT_SECTIONS);

/** Every part of Notifications follows the one permission, so this is one tab long. */
export const V2_NOTIFICATIONS_PERM_TABS: readonly string[] = permTabsOf(V2_NOTIFICATIONS_SECTIONS);

export interface V2SettingsRoute {
  /** The v2 page to render, or null for the index. Not permission-checked. */
  page: string | null;
  /**
   * The section the link points at, or null for the top of the page (the
   * page's own `?tab=`, and a link to a section marked `atPageTop`). On a
   * stacked page the page scrolls to it; on a tabbed one it picks the tab.
   */
  anchor: string | null;
  /** The permission(s) the route needs: one tab, or any of several (a sectioned page itself). */
  permTab: string | readonly string[] | null;
}

const NO_ROUTE: V2SettingsRoute = { page: null, anchor: null, permTab: null };

/** A sectioned page the route may open: listed in `pages` and not hidden. */
const isOpenablePage = (page: string, pages: Record<string, unknown>) =>
  hasOwn(pages, page) && !V2_HIDDEN_SETTINGS_PAGES.has(page);

/**
 * Which v2 page a `?tab=` value opens.
 *  - A sectioned page's own tab (`general`, `tax-and-deposit`,
 *    `notifications`) opens it at the top, for anyone who may view any of its
 *    sections.
 *  - A tab that is now a section of one of them (`?tab=requirements`,
 *    `?tab=preauth`, `?tab=push`) opens that page at the section, under the
 *    section's own permission. A section marked `atPageTop` (`?tab=fees`)
 *    opens the page with no anchor: it is already the top.
 *  - Any other listed page opens as itself.
 *
 * A sectioned page the caller does not list (or a hidden one) opens nothing
 * itself, and its sections' old tabs fall through to the rest of the rules —
 * so with Notifications gone, `?tab=push` still finds a `push` page if the
 * caller has one.
 *
 * Hidden pages and unknown values open the index (the notice says why).
 */
export function resolveV2SettingsRoute(
  tabParam: string | null,
  pages: Record<string, { permTab: string }>,
): V2SettingsRoute {
  const tab = tabParam?.trim() ?? "";
  if (!tab) return NO_ROUTE;
  for (const [page, { sections }] of Object.entries(V2_SECTIONED_PAGES)) {
    if (!isOpenablePage(page, pages)) continue;
    if (tab === page) return { page, anchor: null, permTab: permTabsOf(sections) };
    const section = sections.find((s) => s.tab === tab);
    if (section) return { page, anchor: section.atPageTop ? null : section.anchor, permTab: section.permTab };
  }
  if (V2_HIDDEN_SETTINGS_PAGES.has(tab) || !hasOwn(pages, tab)) return NO_ROUTE;
  return { page: tab, anchor: null, permTab: pages[tab].permTab };
}

/**
 * The sectioned page that holds the section with this DOM id (`settings-<anchor>`),
 * or null when no sectioned page has it. An old link such as
 * `?tab=general#settings-tax-and-fees` is sent on to that page.
 */
export function v2SectionHomePage(sectionId: string | null | undefined): string | null {
  if (!sectionId) return null;
  for (const [page, { sections }] of Object.entries(V2_SECTIONED_PAGES)) {
    if (sections.some((s) => settingsSectionId(s.anchor) === sectionId)) return page;
  }
  return null;
}

/** A route's permission, one tab or any of several. */
export function canViewAny(permTab: string | readonly string[], canView: (tab: string) => boolean): boolean {
  return typeof permTab === "string" ? canView(permTab) : permTab.some(canView);
}

/**
 * The pages map `resolveSettingsTabNotice` reads: every page that is not
 * hidden, each sectioned page (General, Tax and deposit, Notifications) with
 * its any-of permission, and each of their sections under its old tab, so
 * `?tab=preauth` without access still says "You don't have access to Security
 * deposit".
 */
export function v2NoticePages(
  pages: Record<string, { title: string; permTab: string }>,
): Record<string, { title: string; permTab: string | readonly string[] }> {
  const out: Record<string, { title: string; permTab: string | readonly string[] }> = {};
  for (const [tab, page] of Object.entries(pages)) {
    if (V2_HIDDEN_SETTINGS_PAGES.has(tab)) continue;
    out[tab] = { title: page.title, permTab: page.permTab };
  }
  for (const [page, { sections }] of Object.entries(V2_SECTIONED_PAGES)) {
    // A sectioned page missing from `pages` (or hidden) opens nothing, so its
    // sections' old tabs fall through to the other notices too — the same rule
    // `resolveV2SettingsRoute` follows, so the notice matches what happened.
    if (!hasOwn(out, page) || V2_HIDDEN_SETTINGS_PAGES.has(page)) continue;
    out[page] = { ...out[page], permTab: permTabsOf(sections) };
    // As in the route, a section's old tab wins over anything else by that name.
    for (const section of sections) {
      if (section.tab && section.tab !== page) out[section.tab] = { title: section.title, permTab: section.permTab };
    }
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
 * General is not listed: it reads the org settings and the rental settings,
 * and each of its tabs gates itself (the regional panel, Driver requirements'
 * `BusinessRentalGate`), so a failed org read no longer hides Driver
 * requirements.
 */
export const V2_PAGES_READING_ORG_SETTINGS: ReadonlySet<string> = new Set(["reminders"]);

/**
 * v2 pages whose controls are filled from the tenants row (`useRentalSettings`)
 * and wait for it at page level.
 *
 * Weekend and holiday pricing, General, Booking rules, Lockbox and Tax and
 * deposit also read that row but are not listed: each section gates itself on
 * the cached read (`ReadGate` in pricing-money-parts, `BusinessRentalGate` in
 * business-rules-pages), so a first load shows skeletons shaped like those
 * sections, and a failed rental read no longer hides the sections that have
 * reads of their own.
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
