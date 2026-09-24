/**
 * Everything in the portal you can GO TO, for the global search (⌘K).
 *
 * Records (customers, rentals, payments…) come from the database through
 * `lib/search-service.ts`. This file is the other half: the portal's own pages,
 * every settings section and every integration, so typing "support",
 * "deposit", "stripe" or "promo codes" takes you there.
 *
 * NOTHING HERE MAY OFFER A PLACE THE USER CANNOT OPEN. Every destination is
 * filtered by the same rules the navigation itself uses:
 *   - the manager route permission (`canAccessRoute`, lib/permissions.ts);
 *   - settings permissions (`canViewSettings`) and the lean settings-tab gate;
 *   - the lean-tenant hidden areas (`isAreaHiddenForLean`, lib/lean-areas.ts);
 *   - the tenant's own feature switches (leads, vehicle owners, fleet health…);
 *   - head-admin-only pages;
 *   - which portal the tenant is on (the v2 chrome has its own settings index
 *     and the Integrations board; everyone else has the original settings tabs).
 * The settings lists are the navigation's own lists where they are exported
 * (SETTINGS_INDEX_SECTIONS, V2_SECTIONED_PAGES); the rest are mirrored here and
 * pinned to their sources by src/__tests__/lib/portal-search.test.ts.
 */
import { isAreaHiddenForLean, isSettingsTabHiddenForLean, type LeanHiddenArea } from "@/lib/lean-areas";
import { SETTINGS_INDEX_SECTIONS } from "@/components/settings-v2/settings-index";
import { V2_SECTIONED_PAGES } from "@/components/settings-v2/settings-shell-state";
import { SUPPORT_ROUTE } from "@/lib/support-route";

export type DestinationGroup = "pages" | "settings" | "integrations";

/** Tenant switches that add a page to the navigation. */
export type DestinationFlag =
  | "lead_management_enabled"
  | "automations_enabled"
  | "vehicle_owners_enabled"
  | "fleet_health_enabled"
  | "turo_sync_enabled"
  | "pending_bookings"
  | "custom_site_enabled"
  | "referrals_enabled";

export interface DestinationGate {
  /** Hidden for a lean tenant when this area is. */
  leanArea?: LeanHiddenArea;
  /** Settings permission: shown when ANY of these tabs may be viewed. The first also drives the lean settings-tab gate. */
  settingsTabs?: readonly string[];
  /** Only on this portal. */
  experience?: "v2" | "v1";
  /** Needs the Integrations board (v2). */
  integrationsBoard?: boolean;
  /** The credit wallet: not for a tenant whose plan includes e-signing (integration billing). */
  creditWallet?: boolean;
  headAdminOnly?: boolean;
  /** Every listed switch must be on. */
  flags?: readonly DestinationFlag[];
}

export interface PortalDestination {
  id: string;
  group: DestinationGroup;
  title: string;
  description: string;
  href: string;
  keywords?: string;
  /** Icon name understood by components/shared/layout/global-search.tsx. */
  icon: string;
  gate?: DestinationGate;
}

export interface DestinationContext {
  /** The tenant is on the v2 portal chrome (useV2('chrome')). */
  v2Chrome: boolean;
  /** The Integrations board is available (useV2('appearance')). */
  integrationsBoard: boolean;
  lean: boolean;
  /** Integration billing: no credits (docs/integration-billing, D3). Absent means false. */
  creditsRetired?: boolean;
  isHeadAdmin: boolean;
  flags: Partial<Record<DestinationFlag, boolean>>;
  canAccessRoute: (pathname: string) => boolean;
  canViewSettings: (tab: string) => boolean;
}

/* -------------------------------------------------------------------------- */
/* Pages                                                                       */
/* -------------------------------------------------------------------------- */

const page = (
  href: string,
  title: string,
  description: string,
  icon: string,
  keywords = "",
  gate?: DestinationGate,
): PortalDestination => ({ id: `page:${href}`, group: "pages", title, description, href, keywords, icon, gate });

/**
 * Every page the sidebars, the account section and the top bar link to, with
 * the same conditions they are shown under (components/shared/layout/
 * app-sidebar.tsx and app-sidebar-v2.tsx). A page the v2 rail deliberately
 * dropped (Insurances, Messages…) is `experience: "v1"`.
 */
export const PAGE_DESTINATIONS: readonly PortalDestination[] = [
  page("/", "Dashboard", "Your desk: what needs attention today, reminders and money in play.", "dashboard", "home desk overview today start"),
  page("/customers", "Customers", "Everyone who has rented from you, their documents, verification and history.", "user", "clients renters drivers people"),
  page("/vehicles", "Vehicles", "Your fleet: each car's details, photos, pricing, documents and service state.", "car", "fleet cars vans"),
  page("/rentals", "Rentals", "Every booking, its dates, payments, agreement and handover.", "calendar", "bookings reservations trips hires"),
  page("/rentals/new", "New rental", "Create a booking for a customer.", "calendar", "new booking create rental add reservation"),
  page("/blocked-dates", "Availability", "Which cars are free when, and the dates you have blocked.", "calendar-days", "availability blocked dates calendar unavailable schedule"),
  page("/payments", "Payments", "Money received and refunded, and how each payment was taken.", "credit-card", "payments money received refunds transactions"),
  page("/invoices", "Invoices", "Invoices sent to customers and whether they are paid.", "receipt", "invoices bills billing"),
  page("/fines", "Fines", "Parking, speeding and toll fines, and who they are charged to.", "alert-triangle", "fines tickets pcn parking speeding tolls penalties"),
  // Both exist on the v2 portal only: /support is notFound() elsewhere and the
  // TRAX provider is mounted only under the v2 chrome (app/(dashboard)/layout.tsx).
  page(SUPPORT_ROUTE, "Support", "Your conversations with the Drive247 support team, and a new request.", "life-buoy", "support help ticket tickets contact request problem issue team", { experience: "v2" }),
  page("/trax", "Help (TRAX)", "Ask TRAX, the assistant, about anything in your portal.", "sparkles", "help trax assistant ai ask question how", { experience: "v2" }),
  page("/settings", "Settings", "Your business, pricing, payment plans and notifications.", "settings", "settings configuration preferences options setup"),
  page("/credits", "Credits", "The Drive247 credit balance used for SMS, checks and other paid features.", "credit-card", "credits balance wallet top up sms", { creditWallet: true }),
  page("/cms", "Website content", "The pages of your customer booking site.", "globe", "website cms site pages content booking site"),
  page("/cms/site-settings", "Website settings", "Logo, business name, footer, social links, phone and address on your site.", "globe", "website site settings footer social links logo phone address"),
  // The public "apply to rent" form. Its page calls notFound() where Leads is
  // hidden, which is the gate its sidebar row uses too.
  page("/settings/apply-form", "Apply form", "The apply-to-rent form on your website, and the details it asks for.", "file-text", "apply form application rent website leads", { leanArea: "leads" }),
  page("/cms/new-website", "New Website Content", "The content of your new customer website.", "sparkles", "new website content custom site v2", { flags: ["custom_site_enabled"] }),
  page("/welcome", "Welcome", "Getting started with Drive247.", "compass", "welcome getting started setup guide onboarding", { leanArea: "welcome" }),

  // Shown only when the tenant has the feature (same switches as the sidebars).
  page("/pending-bookings", "Pending Bookings", "Online bookings waiting for you to approve them.", "clock", "pending approval approve bookings requests queue", { flags: ["pending_bookings"] }),
  page("/quotes", "Fleet Quotes", "Price quotes for customers renting several vehicles.", "receipt", "quotes quote fleet price estimate", { leanArea: "quotes" }),
  page("/fleet-health", "Fleet Health", "Services and inspections that are due across your fleet.", "wrench", "fleet health service maintenance inspection mot", { leanArea: "fleet-health", flags: ["fleet_health_enabled"] }),
  page("/turo-bridge", "Turo Sync", "Your Turo trips alongside your own bookings.", "car", "turo sync bridge trips", { flags: ["turo_sync_enabled"] }),
  page("/leads", "Leads", "People who applied to rent, and where each is in your pipeline.", "user-plus", "leads applications pipeline prospects", { leanArea: "leads", flags: ["lead_management_enabled"] }),
  page("/automations", "Automations", "Messages sent to leads automatically.", "workflow", "automations automatic follow up sequences", { leanArea: "automations", flags: ["lead_management_enabled", "automations_enabled"] }),
  page("/vehicle-owners", "Vehicle Owners", "People whose cars you manage, and their commission.", "users", "vehicle owners investors partners commission", { leanArea: "owners", flags: ["vehicle_owners_enabled"] }),
  page("/owner-payouts", "Owner Payouts", "What you owe each vehicle owner, and what you have paid.", "credit-card", "owner payouts commission payments owners", { leanArea: "owners", flags: ["vehicle_owners_enabled"] }),
  page("/expenses", "Expenses", "What your business spends, per vehicle and overall.", "wallet", "expenses costs spending", { leanArea: "expenses" }),
  page("/reminders", "Reminders", "Things due soon: documents expiring, returns, payments.", "bell", "reminders due expiring alerts tasks", { leanArea: "reminders" }),
  page("/reports", "Reports", "Reports on bookings, revenue, vehicles and customers.", "bar-chart", "reports analytics statistics export", { leanArea: "reports" }),
  page("/pl-dashboard", "P&L Dashboard", "Profit and loss for your business and each vehicle.", "trending-up", "profit loss p&l pnl revenue costs margin", { leanArea: "pl-dashboard" }),

  // v2 only: the account section of the v2 rail.
  page("/integrations", "Integrations", "Stripe, Square, Twilio, Bonzah, BoldSign, Tesla, Xero, Zoho, Turo and your custom domain.", "plug", "integrations apps connect connections stripe square twilio bonzah boldsign tesla xero zoho", { integrationsBoard: true }),
  page("/subscription", "Billing", "Your Drive247 plan, your next bill and past invoices.", "crown", "billing subscription plan drive247 invoice upgrade", { experience: "v2" }),
  // Off the v2 rail by default and offered in the sidebar customiser — but the
  // page is live for every v2 tenant (its own gate resolves both the slug list
  // and `portal_experience`), so the search is the other way in and must know
  // about it.
  page("/insights", "Insights", "One screen of honest money: what came in, what is owed, and what it cost.", "trending-up", "insights money revenue profit margin honest reports", { experience: "v2" }),
  // A default rail row again (Agreements v2, D2): individual agreements are
  // sent from it and the agreement templates live on it. Its own entry rather
  // than lifting the v1 one's gate, because on v1 the page has no templates and
  // its entry must keep saying what that page is. The two are never visible
  // together, so sharing an href (and so an id) never lists it twice.
  page("/agreements", "Agreements", "Agreements sent for signature, their signed copies, and your agreement templates.", "file-signature", "agreements contracts signed signatures esign e-sign send agreement templates", { experience: "v2" }),
  page("/referrals", "Referrals", "Your Drive247 referral code and link, your reward, and who you referred.", "gift", "referrals refer invite referral code link reward discount friend operator", { flags: ["referrals_enabled"] }),

  // The original portal only: pages the v2 rail deliberately does not list.
  page("/blocked-customers", "Blocked Customers", "Customers you have blocked from renting.", "user", "blocked banned blacklist customers", { experience: "v1" }),
  page("/messages", "Messages", "Chat with your customers.", "message-square", "messages chat conversations inbox", { experience: "v1" }),
  page("/insurances", "Insurances", "Customers' insurance documents.", "shield", "insurance documents certificates cover", { experience: "v1" }),
  page("/agreements", "Agreements", "Rental agreements sent and signed.", "file-signature", "agreements contracts signed signatures", { experience: "v1" }),
  page("/audit-logs", "Audit Logs", "Who changed what in your portal, and when.", "history", "audit logs history activity changes", { experience: "v1" }),
  page("/users", "Manage Users", "Your team: who can sign in and what each person can see.", "users", "users team staff members roles permissions invite", { experience: "v1", headAdminOnly: true }),
];

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The original settings screen's tabs, as its menu lists them
 * (`settingsTabGroups` in components/shared/layout/app-sidebar.tsx), each opened
 * with `/settings?tab=<value>`. Descriptions and keywords are for search only.
 */
export const V1_SETTINGS_TABS: readonly { value: string; label: string; section: string; description: string; keywords: string }[] = [
  { value: "general", label: "General", section: "Business", description: "Currency, distance unit and your business details.", keywords: "currency distance miles km business" },
  { value: "locations", label: "Locations", section: "Business", description: "Pick-up and return locations, and delivery areas.", keywords: "pickup return delivery address" },
  { value: "branding", label: "Branding", section: "Business", description: "Your logo, name and colours.", keywords: "logo colour color theme appearance name favicon" },
  { value: "requirements", label: "Requirements", section: "Booking Rules", description: "Who can rent from you and the ID they must verify.", keywords: "driver requirements age licence license passport id verification" },
  { value: "duration", label: "Duration & Timing", section: "Booking Rules", description: "Notice, minimum and maximum rental length, and gaps between rentals.", keywords: "booking rules notice lead time duration minimum maximum buffer" },
  { value: "lockbox", label: "Delivery & Lockbox", section: "Booking Rules", description: "Key handover by lockbox and delivery.", keywords: "key handover lockbox keys code delivery" },
  { value: "pricing", label: "Pricing Rules", section: "Pricing & Money", description: "Weekend, holiday and monthly pricing.", keywords: "custom pricing dynamic seasonal weekend holiday surcharge monthly" },
  { value: "fees", label: "Fees & Tax", section: "Pricing & Money", description: "Tax and fees added to the rental price.", keywords: "tax vat service fee fees" },
  { value: "preauth", label: "Deposit", section: "Pricing & Money", description: "The refundable security deposit.", keywords: "security deposit hold pre-authorisation preauth" },
  { value: "installments", label: "Installments", section: "Pricing & Money", description: "Weekly or monthly payment plans.", keywords: "installment instalment split payment plan" },
  { value: "payg", label: "Pay As You Go", section: "Pricing & Money", description: "Bill long rentals day by day.", keywords: "payg pay as you go daily billing" },
  { value: "promos", label: "Promo Codes", section: "Pricing & Money", description: "Discount codes and automatic discounts.", keywords: "promo promotion discount coupon voucher code" },
  { value: "extras", label: "Extras", section: "Pricing & Money", description: "Add-ons customers can buy with a rental.", keywords: "extras add-ons addons child seat gps" },
  { value: "payments", label: "Payments", section: "Pricing & Money", description: "Your payment processor: Stripe or Square.", keywords: "stripe square connect payment processor payouts card" },
  { value: "reminders", label: "Notifications", section: "Communication", description: "Which emails your team receives.", keywords: "email notifications alerts" },
  { value: "push", label: "Push Notifications", section: "Communication", description: "Alerts on your team's phones and browsers.", keywords: "push mobile browser alerts" },
  { value: "templates", label: "Templates", section: "Communication", description: "The emails, reminders and agreement your customers receive.", keywords: "templates email agreement contract sms" },
  { value: "accounting", label: "Accounting", section: "Integrations", description: "Sync invoices and payments to Xero or Zoho Books.", keywords: "xero zoho accounting books ledger" },
  { value: "messaging", label: "Messaging", section: "Integrations", description: "Text messages and calling through Twilio.", keywords: "twilio sms text messages whatsapp calling phone" },
  { value: "insurance", label: "Insurance", section: "Integrations", description: "Bonzah insurance at checkout.", keywords: "bonzah insurance cover" },
  { value: "esign", label: "E-Signatures", section: "Integrations", description: "BoldSign e-signatures for rental agreements.", keywords: "boldsign esign e-sign signature signing" },
  { value: "tesla", label: "Tesla Fleet", section: "Integrations", description: "Tesla Supercharging and vehicle data.", keywords: "tesla supercharger" },
  { value: "blacklist", label: "Blacklist", section: "Integrations", description: "Customers blocked across the platform.", keywords: "blacklist blocked banned" },
  { value: "subscription", label: "Subscription", section: "Account", description: "Your Drive247 plan and invoices.", keywords: "subscription billing plan drive247" },
];

const setting = (
  id: string,
  title: string,
  description: string,
  href: string,
  keywords: string,
  gate: DestinationGate,
): PortalDestination => ({ id: `setting:${id}`, group: "settings", title, description, href, keywords, icon: "settings", gate });

/**
 * What people call each section of a v2 settings page, for searching.
 *
 * Keyed by the section's ANCHOR, not by the page holding it, so the words
 * follow a section that changes page — Tax and fees and Security deposit were
 * General's on Sep 17 2026 and belong to the Tax and deposit page from Sep 20.
 * Booking rules, Key handover (now Lockbox), Booking site and Optional modules
 * are not sections any more: they are index pages, whose words are the index
 * entry's own `keywords`.
 */
const SECTION_KEYWORDS: Record<string, string> = {
  "driver-requirements": "driver requirements age licence license passport id verification waiver",
  "tax-and-fees": "tax vat service fee fees charges surcharge",
  "security-deposit": "security deposit hold pre-authorisation preauth authorisation",
  "notifications-email": "email notifications sender from address reply to team emails alerts reminders",
  "notifications-push": "push notifications phone browser device alerts install home screen",
};

/**
 * The v2 settings index, plus the SECTIONS of every page made of several.
 *
 * A section is a place of its own: it has its own `?tab=` link, its own
 * permission and its own name, and that name is what a tenant types — "security
 * deposit" or "vat", not the page that happens to hold it today. Reading
 * `V2_SECTIONED_PAGES` (General, Tax and deposit, Notifications) rather than one
 * page's list is what keeps that true when a section moves: Tax and fees and
 * Security deposit left General for the new Tax and deposit page on Sep 20 2026,
 * and a loop over General alone dropped both out of the search silently.
 */
function v2SettingsDestinations(): PortalDestination[] {
  const out: PortalDestination[] = [];
  /** Index entry title by href: the page a section names in its breadcrumb. */
  const pageTitles = new Map<string, string>();
  for (const section of SETTINGS_INDEX_SECTIONS) {
    for (const item of section.items) {
      pageTitles.set(item.href, item.title);
      out.push(
        setting(`v2:${item.tab}`, item.title, item.description, item.href, `${section.title} ${item.keywords ?? ""}`, {
          experience: "v2",
          settingsTabs: item.anyOfTabs ?? [item.tab],
          headAdminOnly: item.headAdminOnly,
        }),
      );
    }
  }
  /*
   * Customer messages, mirrored here instead of read from the list above.
   *
   * The Templates card came off the settings index on Sep 24 2026: each
   * message is edited from the screen that sends it (Lockbox has its own
   * Templates link), so a second door from the index only asked people to
   * guess which one was current. The PAGE is untouched and still opens at
   * `?tab=templates` under the same `templates` permission — so search must
   * still take you there. The index list is what the index shows; it is not
   * the list of pages that exist, and letting a card come off the index
   * silently delete its search entry is the same failure as reading General
   * alone (see the comment above).
   */
  out.push(
    setting(
      "v2:templates",
      "Customer messages",
      "The reminders, emails and agreement your customers receive, including the lockbox code email.",
      "/settings?tab=templates",
      "Templates template email templates sms message reminder lockbox code agreement",
      { experience: "v2", settingsTabs: ["templates"] },
    ),
  );
  for (const [page, { sections }] of Object.entries(V2_SECTIONED_PAGES)) {
    const pageTitle = pageTitles.get(`/settings?tab=${page}`) ?? page;
    for (const s of sections) {
      // The section whose `?tab=` IS the page's own key is the page: "Regional"
      // is simply what `/settings?tab=general` opens, and the index lists it
      // above as General. Every other section has a link of its own.
      if (s.tab === page) continue;
      out.push(
        setting(
          `v2-section:${s.anchor}`,
          s.title,
          `${s.description} (Settings › ${pageTitle})`,
          `/settings?tab=${s.tab ?? page}`,
          `${pageTitle} ${SECTION_KEYWORDS[s.anchor] ?? ""}`,
          { experience: "v2", settingsTabs: [s.permTab] },
        ),
      );
    }
  }
  return out;
}

function v1SettingsDestinations(): PortalDestination[] {
  return V1_SETTINGS_TABS.map((t) =>
    setting(`v1:${t.value}`, t.label, `${t.description} (Settings › ${t.section})`, `/settings?tab=${t.value}`, `${t.section} ${t.keywords}`, {
      experience: "v1",
      settingsTabs: [t.value],
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Integrations (the v2 board)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The Integrations board's cards (app/(dashboard)/integrations/integrations-board.tsx).
 * `/integrations?open=<name>` opens the card's panel; the name must match the
 * board exactly, which the tests check against _panels/registry.ts.
 */
export const INTEGRATION_CARDS: readonly { name: string; category: string; description: string; keywords: string }[] = [
  { name: "Turo Sync", category: "Fleet", description: "Pull your Turo trips in and stop double-booking.", keywords: "turo sync trips calendar" },
  { name: "Stripe Connect", category: "Payments", description: "Accept booking payments, deposits and payouts.", keywords: "stripe payments card payouts connect deposit" },
  { name: "Square", category: "Payments", description: "Take booking payments through your Square account.", keywords: "square payments card" },
  { name: "Bonzah", category: "Insurance", description: "Per-rental insurance coverage at checkout.", keywords: "bonzah insurance cover checkout" },
  { name: "Inshur", category: "Insurance", description: "Fleet insurance for your vehicles between rentals.", keywords: "inshur insurance fleet cover" },
  { name: "BoldSign", category: "Documents", description: "E-signature for rental agreements.", keywords: "boldsign esign e-sign signature agreement contract" },
  { name: "CheckMyDriver", category: "Verification", description: "Verify driver's licences and identity.", keywords: "checkmydriver verification licence license identity id check" },
  { name: "Twilio Messages", category: "Messaging", description: "SMS notifications, reminders and two-way chat.", keywords: "twilio sms text messages whatsapp" },
  { name: "Twilio Calling", category: "Calling", description: "Call forwarding, voicemail and recordings.", keywords: "twilio calling phone calls voicemail forwarding" },
  { name: "Tesla", category: "Fleet", description: "Supercharging and vehicle data via the Fleet API.", keywords: "tesla supercharger fleet api" },
  { name: "Custom Domain", category: "Website", description: "Use your own domain for booking and portal.", keywords: "custom domain dns website url" },
  { name: "Xero", category: "Accounting", description: "Sync invoices and payments to Xero.", keywords: "xero accounting books" },
  { name: "Zoho", category: "Accounting", description: "Sync books and CRM with Zoho.", keywords: "zoho accounting books crm" },
];

function integrationDestinations(): PortalDestination[] {
  return INTEGRATION_CARDS.map((c) => ({
    id: `integration:${c.name}`,
    group: "integrations" as const,
    title: c.name,
    description: `${c.description} (${c.category})`,
    href: `/integrations?open=${encodeURIComponent(c.name)}`,
    keywords: `${c.category} ${c.keywords}`,
    icon: "plug",
    gate: { integrationsBoard: true },
  }));
}

export const ALL_DESTINATIONS: readonly PortalDestination[] = [
  ...PAGE_DESTINATIONS,
  ...v2SettingsDestinations(),
  ...v1SettingsDestinations(),
  ...integrationDestinations(),
];

/* -------------------------------------------------------------------------- */
/* Visibility and matching                                                     */
/* -------------------------------------------------------------------------- */

const pathOf = (href: string) => href.split(/[?#]/)[0] || "/";

/** May this user open this destination? The same rules the navigation applies. */
export function isDestinationVisible(d: PortalDestination, ctx: DestinationContext): boolean {
  const g = d.gate ?? {};
  if (g.experience === "v2" && !ctx.v2Chrome) return false;
  if (g.experience === "v1" && ctx.v2Chrome) return false;
  if (g.integrationsBoard && !ctx.integrationsBoard) return false;
  if (g.creditWallet && ctx.creditsRetired) return false;
  if (g.headAdminOnly && !ctx.isHeadAdmin) return false;
  if (g.leanArea && isAreaHiddenForLean(g.leanArea, ctx.lean)) return false;
  if (g.flags && !g.flags.every((f) => ctx.flags[f] === true)) return false;
  if (g.settingsTabs) {
    if (!g.settingsTabs.some((t) => ctx.canViewSettings(t))) return false;
    if (isSettingsTabHiddenForLean(g.settingsTabs[0], ctx.lean)) return false;
  }
  return ctx.canAccessRoute(pathOf(d.href));
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);

/**
 * How well `query` matches. 0 = not at all.
 * Title matches rank above keyword matches, which rank above description
 * matches. Every word typed must be found (as the start of a word) somewhere.
 */
export function scoreDestination(d: PortalDestination, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const title = d.title.toLowerCase();
  if (title === q) return 100;
  if (title.startsWith(q)) return 90;
  const titleWords = words(d.title);
  const qWords = words(q);
  if (qWords.length === 0) return 0;
  const inWords = (pool: string[]) => qWords.every((w) => pool.some((p) => p.startsWith(w)));
  if (inWords(titleWords)) return 80;
  if (title.includes(q)) return 70;
  const keywordWords = words(d.keywords ?? "");
  if (inWords([...titleWords, ...keywordWords])) return 60;
  if (inWords([...titleWords, ...keywordWords, ...words(d.description)])) return 40;
  return 0;
}

export interface DestinationMatches {
  pages: PortalDestination[];
  settings: PortalDestination[];
  integrations: PortalDestination[];
}

const LIMITS: Record<DestinationGroup, number> = { pages: 6, settings: 6, integrations: 5 };

/**
 * What to offer before anything is typed: the places people open most, in the
 * order the sidebar lists them, minus any this user cannot open.
 */
const SUGGESTED_HREFS: readonly string[] = ["/customers", "/vehicles", "/rentals", "/payments", "/blocked-dates", "/settings", "/integrations", "/support"];

export function suggestedDestinations(ctx: DestinationContext, limit = 6): PortalDestination[] {
  return SUGGESTED_HREFS.map((href) => PAGE_DESTINATIONS.find((d) => d.href === href))
    .filter((d): d is PortalDestination => !!d && isDestinationVisible(d, ctx))
    .slice(0, limit);
}

/** The destinations matching `query` that this user may open, best first. */
export function searchPortalDestinations(query: string, ctx: DestinationContext): DestinationMatches {
  const out: DestinationMatches = { pages: [], settings: [], integrations: [] };
  if (!query.trim()) return out;
  const scored = ALL_DESTINATIONS.map((d) => ({ d, score: scoreDestination(d, query) }))
    .filter((x) => x.score > 0 && isDestinationVisible(x.d, ctx))
    .sort((a, b) => b.score - a.score || a.d.title.localeCompare(b.d.title));
  const seen = new Set<string>();
  for (const { d } of scored) {
    const bucket = out[d.group];
    // One row per place: two settings entries can share a link (General's sections).
    const key = `${d.group}:${d.href}:${d.title}`;
    if (seen.has(key) || bucket.length >= LIMITS[d.group]) continue;
    seen.add(key);
    bucket.push(d);
  }
  return out;
}
