/**
 * The first-run ORIENTATION — its steps, its gate, its anchor resolver, and the
 * two things it remembers: that a user has seen it, and where they got to.
 *
 * THE PRODUCT DECISION, restated here because the shape of this file follows
 * from it, and because this file has already been the wrong size twice.
 *
 * History: three coach marks, then an eleven-step WALKTHROUGH through the New
 * Rental form (ruled out: "woh abhi woh tour nahi hai"), then an eight-step
 * ORIENTATION that visited Vehicles, Customers, Rentals and Settings.
 *
 * v4 (Ghulam, 23 Nov 2026) is the BIG PICTURE in SEVEN cards: about five
 * stops is what people finish (completion falls fast past five), so the six
 * things a rental is made of are grouped, not given a card each.
 *
 *   Hello                 what the tour is, and what a first rental needs at
 *                         least (a car, a customer, Stripe), illustrated
 *   1 Car and customer    the two rows together, plus the driver check
 *   2 Paperwork and money agreement, insurance, payments
 *   3 The rental          all of it put together
 *   4 Your booking site   the site, and the Website editor (CMS)
 *   5 Trax                help, any time
 *   The last card         the one must-do, connect Stripe (under Integrations,
 *                         with Turo, accounting and the rest), with the free
 *                         onboarding call with Bryan beside it
 *
 * The counter counts the five stops only ("2 of 5"); the hello and last cards
 * carry none.
 *
 * The last card is the one people act on, so it carries buttons (Connect
 * Stripe, Book a free call) and its words follow the company's real state
 * (`bodyFor` / `actionsFor`, read from `useFirstSteps`).
 *
 * Every stop is on the DASHBOARD and points at the sidebar row (or chrome
 * control) where that thing lives. No navigation at all: nothing to wait for,
 * nothing that depends on a page having data, and it reads the same on an
 * empty account as on a busy one. On a phone the sidebar is an off-canvas
 * sheet, so those stops become centred cards (`centerOnMobile`); a row a user
 * cannot see (Insurances is opt-in, a manager lacks a grant, the rail is
 * collapsed) degrades to a centred card instead of a skip (`centerIfMissing`).
 *
 * The depth lives in the TAB TOURS (`lib/tab-tours/*`), launched from a button
 * on each tab. Anything you are tempted to add here belongs there.
 *
 * Required once for every staff member of a company created after go-live
 * (no close, no Skip, no Esc; see REQUIRED_QUICK_TOUR_SINCE), optional for
 * everyone else. Replayable from the Help menu, and a replay can be closed.
 * No videos inside it: videos live in the setup checklist and the empty states.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LOGIC IS IN A .ts FILE AND NOT IN THE COMPONENT
 *
 * Everything here is pure and injectable, so the things that can actually
 * break — the gate, the step filter, the anchor resolver and the progress
 * store — are unit-testable without a DOM, without a tenant, and without
 * React. Portal builds with `ignoreBuildErrors: true`, so a type error in a
 * .tsx file ships; a test is the only thing that catches a wrong answer.
 *
 * THE TWO FAILURE MODES THIS FILE EXISTS TO PREVENT
 *
 *  - A step pointing at NOTHING. Anchors appear late (every page fetches its
 *    data), are permission-gated, and are hidden per tenant. A card anchored
 *    to nowhere is what killed the previous attempt at a tour. So a step is
 *    dropped BEFORE the tour starts when its destination is gated for this
 *    user (`buildTour`), and skipped cleanly at runtime when its anchor never
 *    mounts (the hook's wait-then-skip). A step whose anchor is absent never
 *    renders.
 *  - A tour that re-fires. "Seen" is written UP FRONT at launch; progress is
 *    written on every step change and cleared on finish, skip or dismiss.
 */

import { noteTourWrite } from '@/lib/tour-sync';

/**
 * Bump when the STEPS change in a way that makes re-showing the tour the right
 * call. The version is part of the storage key, so bumping it re-arms the tour
 * for everyone; leaving it alone keeps every operator who has already seen it
 * from meeting it twice.
 *
 * v1 → v2: the three-stop tour became the eleven-step walkthrough. Different
 * shape, worth one more run.
 * v2 → v3: the walkthrough became the eight-step orientation. Half the stops
 * are gone and the survivors say different things on different pages, so
 * anyone who sat through v2 is being offered a genuinely different tour rather
 * than a repeat — and anyone stranded mid-v2 has their saved step discarded by
 * `isProgress` rather than resumed onto a route this list no longer visits.
 * v3 → v4: the orientation became the big-picture tour (what a rental needs,
 * Stripe, the booking site, integrations, Trax), all on the dashboard.
 *
 * Older keys are not cleaned up here — the reset path in `lib/dev-actions.ts`
 * matches on the `d247.tour.` namespace, so it clears every version at once.
 */
export const FIRST_RENTAL_TOUR_VERSION = 4;

/**
 * Companies created on or after this moment get the quick tour as a REQUIRED
 * first step: no close button, no Skip, no Esc, only Back and Next, and the
 * last card is the way out. Companies that existed before keep the old
 * behaviour (offered once, closable). Every staff member of a new company
 * takes it once, on their first visit. A replay from Help is always closable.
 */
export const REQUIRED_QUICK_TOUR_SINCE = '2026-11-27T00:00:00Z';

/** Is a company created at `createdAt` one that must take the quick tour? */
export function isRequiredTourCompany(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && t >= Date.parse(REQUIRED_QUICK_TOUR_SINCE);
}

/** Every key this module writes starts with this. */
const KEY_PREFIX = 'd247.tour.first-rental';

function keyFor(appUserId: string | null | undefined, kind: 'seen' | 'progress'): string {
  const who = appUserId && appUserId.length > 0 ? appUserId : 'anon';
  return kind === 'seen'
    ? `${KEY_PREFIX}.v${FIRST_RENTAL_TOUR_VERSION}.${who}`
    : `${KEY_PREFIX}.v${FIRST_RENTAL_TOUR_VERSION}.progress.${who}`;
}

/**
 * Where "seen" is remembered, per USER rather than per browser profile.
 *
 * Autostart is specified as once per user, and a portal login is shared far
 * more often than it should be — an operator and their ops staff on one
 * machine. Keying on the app user's id means the second person to sign in on
 * that machine still gets their own run, and the first person is not re-prompted
 * when they come back.
 *
 * A missing id yields a shared fallback key rather than `null`. Refusing to
 * store anything would make the tour re-fire on every dashboard mount, which is
 * the single worst failure mode available to a first-run surface.
 */
export function tourSeenKey(appUserId: string | null | undefined): string {
  return keyFor(appUserId, 'seen');
}

/** Where "how far did this user get" is remembered. Same per-user rule. */
export function tourProgressKey(appUserId: string | null | undefined): string {
  return keyFor(appUserId, 'progress');
}

/** A quiet supporting line on a step. Rendered only if its anchor is present. */
export interface TourNote {
  text: string;
  /**
   * Ordered candidate selectors for the thing this line points at. A note whose
   * anchor is nowhere on screen is DROPPED rather than shown — "invoices sit
   * under More → Finance" is a lie to a manager whose permissions hide Finance.
   * Omit entirely for a line that points at nothing in particular.
   */
  anchors?: readonly string[];
}

/** Which side of the anchor the card prefers. `center` is for anchorless steps. */
export type TourSide = 'right' | 'left' | 'bottom' | 'top' | 'center';

/**
 * What has to be true for a step to be OFFERED to this user.
 *
 * Route access is implied by `route` itself (`canAccessRoute`); these are the
 * extra conditions. Evaluated once, at launch, by `buildTour` — a step that
 * fails is dropped before the tour starts, so the operator is never sent to a
 * page that bounces them or shown a button they do not have.
 */
export interface TourRequirement {
  /** Manager tab key the step's action needs an EDITOR grant on. */
  tab?: string;
  /** The step points at a mutation control (Add Vehicle…); needs `canEdit(tab)`. */
  edit?: boolean;
  /** Settings sub-tab the step lands on; needs `canViewSettings(value)`. */
  settingsTab?: string;
  /** Not on a phone — the sidebar is an off-canvas Sheet there. */
  desktop?: boolean;
  /**
   * This step needs a real record to exist — a row to point at, or a record to
   * walk into. Dropped when the tab is empty.
   *
   * THE PROBLEM THIS SOLVES, because it is the whole point of an onboarding
   * tour and it is easy to get backwards. A brand-new operator has NO
   * customers, NO vehicles and NO rentals — that is what "new" means. But the
   * things worth teaching (what a record holds, weekend pricing, why a car
   * cannot be booked) all live inside a record they do not have yet.
   *
   * Without this, a step pointing at "the first row" waits the full
   * `ANCHOR_WAIT_MS` on a page whose table has been replaced by a teaching
   * empty state, then skips — so the operator watches a six-second pause at
   * nothing. Record steps at least drop cleanly via `routeFor`; a row step has
   * a perfectly valid route and no way to know its anchor is never coming.
   *
   * Names the key in `TourBuildContext.sampleIds`.
   */
  record?: 'vehicleId' | 'customerId' | 'rentalId';
  /**
   * This step only applies when the named TAB has data — and, its mirror below,
   * only when it is empty.
   *
   * The same job as `record`/`noRecord`, for a tab that has no record id to key
   * on. Payments is the case: there is no `/payments/<id>` route, so nothing on
   * the page names a payment, and a guard looking for an id would report an
   * empty tab on a busy account. Emptiness is read instead from whether the
   * page has swapped its table for a teaching empty state.
   *
   * Names a tab id ('payments'), not a field.
   */
  tabHasData?: string;
  tabIsEmpty?: string;
  /**
   * The mirror image: this step is ONLY for the empty tab.
   *
   * It is how a tour still has something to say to the operator it was built
   * for. When there is nothing to look at, the tour stops describing records
   * and starts pointing at the way to make one — which is the honest thing to
   * do, and the thing that tab is for that day.
   */
  noRecord?: 'vehicleId' | 'customerId' | 'rentalId';
}

/** What `buildTour` and the `detail` lines are given. All injectable. */
export interface TourBuildContext {
  canAccessRoute: (pathname: string) => boolean;
  canEdit: (tabKey: string) => boolean;
  canViewSettings: (tabValue: string) => boolean;
  isMobile: boolean;
  /**
   * The lean product's New Rental gate: a canary without a usable Stripe
   * Connect account gets a "connect Stripe first" dialog INSTEAD of the rental
   * form. The three in-flow steps have nothing to point at in that state, so
   * the walkthrough reroutes them — see `buildTour`.
   */
  rentalCreationBlocked: boolean;
  /** The tenant's public booking site, for the step that names it. */
  bookingUrl?: string | null;
  /**
   * One real record id per tab, for the tab tours that walk INTO a detail page.
   *
   * The brief for the tab tours is explicit that they must not stop at the
   * "Add" button — the vehicle RECORD is where the things a first-time operator
   * cannot guess actually live (rate tiers, weekend pricing, the availability
   * blockers). But a detail route is `/vehicles/<uuid>`, and `TourStep.route`
   * is a fixed string with nowhere to put the uuid.
   *
   * So the caller hands in one id it has already loaded, and a step with
   * `routeFor` turns it into a real path at BUILD time (see `buildTour`).
   *
   * Every one of these is legitimately null on a tenant with an empty tab —
   * which is the normal state of the brand-new tenant this whole feature is
   * about. A step that needs an id it does not get is DROPPED, exactly like a
   * step whose permission is missing, rather than navigating to `/vehicles/null`.
   */
  sampleIds?: {
    vehicleId?: string | null;
    customerId?: string | null;
    rentalId?: string | null;
  };
  /**
   * Tab ids whose teaching empty state is currently on screen — the tabs that
   * genuinely have nothing in them.
   *
   * Read from the DOM at launch (see `readEmptyTabs`). Absent means "not
   * known", which `stepAllowed` treats as "not empty": on a tour that never
   * populates this, a `tabHasData` step is kept and a `tabIsEmpty` step is
   * dropped, so the ordinary tour is what runs.
   */
  emptyTabs?: readonly string[];
  /**
   * A new company's first steps (`useFirstSteps`): is Stripe connected, and
   * where the free onboarding call with Bryan stands. Read by the quick
   * tour's last card. Absent means "not known", which the card treats as
   * Stripe connected and no call, so it never nags on a missing read.
   */
  firstSteps?: {
    stripeConnected: boolean;
    call: 'offer' | 'booked' | 'none';
    callTime: string | null;
  };
}

/** A button on a tour card that DOES something, and ends the tour. */
export interface TourAction {
  id: 'connect-stripe' | 'book-call' | 'next-topic';
  label: string;
}

export interface TourStep {
  /** Stable key. Used for React keys, persisted progress, and test assertions. */
  id: string;
  /** Short name — the transit pill ("Heading to Vehicles…") and the outline. */
  label: string;
  title: string;
  body: string;
  /**
   * The route this step lives on, as a pathname with an optional query string
   * (`/settings?tab=branding`). `null` means "wherever you already are" — the
   * finale does not drag anyone back to the dashboard.
   */
  route: string | null;
  /**
   * Ordered candidate selectors, most specific first. EMPTY means an
   * anchorless step: a centred card with no spotlight, which is how Welcome
   * and Done are drawn.
   *
   * More than one on purpose wherever a fallback makes sense. The explicit
   * `data-tour` attributes are the intended anchor, but they live in files
   * under concurrent edit, and an anchor that goes missing does not fail
   * loudly. The fallbacks resolve against markup the page cannot render
   * without, so losing the attribute costs the tour nothing.
   */
  anchors: readonly string[];
  side: TourSide;
  notes?: readonly TourNote[];
  requires?: TourRequirement;
  /**
   * Clicking the anchor is the operator DOING the thing (opening Add Vehicle),
   * not acknowledging it. The tour steps aside — pauses — rather than sitting
   * on top of the dialog that just opened, and offers to resume from the
   * dashboard.
   */
  pauseOnAnchorClick?: boolean;
  /** The Welcome card lists what the walkthrough will cover. */
  showOutline?: boolean;
  /** An optional extra line computed from context — the booking URL, say. */
  detail?: (ctx: TourBuildContext) => string | null;
  /**
   * A route computed from context, for steps that live inside a specific
   * record — `/vehicles/<uuid>?section=addons`.
   *
   * Resolved ONCE, by `buildTour`, and written back over `route`, so every
   * consumer downstream (the hook's navigation, `stepIsOnRoute`, the renderer)
   * goes on seeing a plain string and needs no change. Returning null drops the
   * step, which is the correct behaviour when the tenant has no such record yet.
   *
   * When present this WINS over `route`; set `route` to the list page anyway so
   * the step still reads sensibly in the source.
   */
  routeFor?: (ctx: TourBuildContext) => string | null;
  /**
   * On a phone, draw this step as a centred card with no spotlight. For stops
   * anchored in the sidebar, which is an off-canvas sheet below `md`: waiting
   * for an anchor that is never on screen would stall every step. Applied by
   * `buildTour`.
   */
  centerOnMobile?: boolean;
  /**
   * If the anchor is not on screen after a short wait, show the card centred
   * instead of skipping the step. For stops whose message stands on its own
   * even when the thing it points at is hidden (an opt-in sidebar row, a
   * collapsed rail). Applied by the hook.
   */
  centerIfMissing?: boolean;
  /**
   * More selectors whose element (first visible match of each) is taken in
   * with the anchor, so one card can point at neighbouring rows together:
   * Customers and Vehicles, or the money and paperwork rows. The cursor and
   * the clear area cover the lot. Missing ones are simply left out.
   */
  span?: readonly string[];
  /**
   * Words that depend on the company's state, worked out when the card is
   * drawn (so a read that lands mid-tour is still used). Wins over `body`;
   * keep `body` as the version a reader of this file sees.
   */
  bodyFor?: (ctx: TourBuildContext) => string;
  /** Buttons on the card. Each one ends the tour and then does its thing. */
  actionsFor?: (ctx: TourBuildContext) => readonly TourAction[];
  /**
   * On a phone, point here instead (the bottom tab bar, the menu button),
   * because the sidebar these steps point at is hidden there. Applied by
   * `buildTour`; wins over `centerOnMobile`.
   */
  mobileAnchors?: readonly string[];
  /** `span` on a phone, with `mobileAnchors`. */
  mobileSpan?: readonly string[];
  /** The words on a phone, where they name a different control. */
  mobileBody?: string;
  /** The last card's "every tab has its own tour" box. */
  tabTourHint?: boolean;
  /**
   * The step lives inside a dialog. Before its anchor is looked for, the
   * dialog is opened by clicking the first visible `trigger`, unless an
   * element matching `dialog` is already on screen. Tab tours only.
   */
  opens?: { trigger: readonly string[]; dialog: string };
  /** Close any open dialog before this step shows (a step back out of one). */
  closesDialogs?: boolean;
}

/**
 * Below this many ANCHORED steps the tour does not run at all.
 *
 * Welcome and Done point at nothing and do not count. A "walkthrough" that
 * shows a manager an intro, one card, and a finale is not a walkthrough;
 * showing one to a viewer-role user who can see neither Vehicles nor
 * Customers would be worse than showing nothing.
 */
export const MIN_TOUR_STOPS = 2;

/**
 * A beat after the dashboard paints before the Welcome card comes up.
 *
 * Lives here, in the pure module, rather than in `use-first-rental-tour`
 * because it is not only the tour's business: the first-run ARRIVAL — the
 * confetti in `lib/first-run-arrival.ts` — has to be finished inside this
 * window, and a constant two modules must agree on should be importable
 * by both without dragging a React hook into the second one's tests. Both
 * modules must keep importing this same exported constant, never a locally
 * redefined duplicate, or the confetti and the tour drift out of step.
 */
export const AUTOSTART_DELAY_MS = 700;

const SIDEBAR = '[data-sidebar="sidebar"]';

/** A sidebar row, by the `data-tour` the v2 rail stamps on every item. */
const nav = (href: string) => `${SIDEBAR} [data-tour="nav-${href}"]`;

/** The Portal / Website switch at the top of the v2 rail. */
const WEBSITE_SWITCH = '[data-tour="website-switch"]';

/** Trax's Help button in the v2 top bar. */
const TRAX_HELP = '[data-tour="trax-help"]';

/** The phone's bottom tab bar and its menu button (the sidebar is a sheet there). */
const TAB_BAR = (href: string) => `[data-mobile-tab-bar] a[href="${href}"]`;
const PHONE_MENU = 'button[aria-label="Open menu"]';

/**
 * Every stop in the middle of the tour shares these: it lives on the
 * dashboard, it is a centred card on a phone, it is a centred card when its
 * row is hidden, and clicking the row (which navigates away) pauses the tour
 * cleanly instead of advancing it onto a page that is leaving.
 */
const STOP = {
  route: '/',
  side: 'right' as TourSide,
  centerOnMobile: true,
  centerIfMissing: true,
  pauseOnAnchorClick: true,
};

/**
 * The canonical step list. `buildTour` filters and swaps it per user; this is
 * what a head admin on a desktop with Stripe connected sees.
 *
 * Trax speaks in the first person, no emoji anywhere. Every body is one or two
 * short sentences: this tour names things, the tab tours explain them.
 */
export const FIRST_RENTAL_TOUR: readonly TourStep[] = [
  {
    id: 'welcome',
    label: 'Welcome',
    // The card draws the three things a first rental needs, illustrated
    // (`RentalNeeds` in the component), under this line.
    title: 'I am Trax. Here is what a rental needs.',
    body: 'Five quick stops and you will know your way around. To take your first rental, you need at least these three:',
    route: '/',
    anchors: [],
    side: 'center',
  },

  // ── 1. What a rental is made of ────────────────────────────────────────
  {
    ...STOP,
    id: 'car-customer',
    label: 'Car and customer',
    title: 'A car, and someone to rent it',
    body: 'Your cars live in Vehicles and the people who rent them in Customers. Before anyone drives, I check their licence and that their face matches it.',
    anchors: [nav('customers'), nav('vehicles')],
    span: [nav('vehicles')],
    mobileAnchors: [TAB_BAR('/vehicles'), TAB_BAR('/customers')],
    mobileSpan: [TAB_BAR('/customers')],
  },
  {
    ...STOP,
    id: 'paperwork-money',
    label: 'Paperwork and money',
    title: 'The paperwork and the money',
    body: 'Each rental gets an agreement signed online and, if you like, Bonzah insurance priced for its dates. Every payment, deposit and refund is kept here, and card payments go through Stripe.',
    // Finances (or Payments), Agreements and Insurances where shown: the
    // "Money & paperwork" block of the rail, as one.
    anchors: [nav('agreements'), nav('finances'), nav('payments')],
    span: [nav('finances'), nav('payments'), nav('insurances')],
    mobileAnchors: [PHONE_MENU],
    mobileBody: 'Each rental gets an agreement signed online and, if you like, Bonzah insurance priced for its dates. Every payment, deposit and refund is kept in Finances. All three are in this menu.',
  },

  // ── 2. Put together ────────────────────────────────────────────────────
  {
    ...STOP,
    id: 'rental',
    label: 'Rental',
    title: 'Put together, that is a rental',
    body: 'Pick the car and the customer, and the driver check, agreement, insurance and payment follow in one flow. New Rental on the Rentals page starts one.',
    anchors: [nav('rentals')],
    mobileAnchors: [TAB_BAR('/rentals/new')],
    mobileBody: 'Pick the car and the customer, and the driver check, agreement, insurance and payment follow in one flow. This button starts one. Your rentals are listed in the menu.',
  },

  // ── 3. Where customers find you ────────────────────────────────────────
  {
    ...STOP,
    id: 'booking-site',
    label: 'Booking site',
    title: 'Your booking site is already live',
    body: 'Your cars appear on it as you add them, and customers book and pay there. This switch opens the Website side, where you change its pages, words, photos and colours yourself.',
    anchors: [WEBSITE_SWITCH],
    mobileAnchors: [PHONE_MENU],
    mobileBody: 'Your cars appear on it as you add them, and customers book and pay there. The Portal and Website switch at the top of this menu opens the Website side, where you change its pages, words, photos and colours yourself.',
    detail: (ctx) => (ctx.bookingUrl ? ctx.bookingUrl.replace(/^https?:\/\//, '') : null),
  },

  // ── 4. Help ────────────────────────────────────────────────────────────
  {
    ...STOP,
    id: 'trax',
    label: 'Trax',
    title: 'And I am always here',
    body: 'Ask me how to do something, or anything about your business. Press Help whenever you need me.',
    anchors: [TRAX_HELP],
    bodyFor: (ctx) => {
      const base = 'Ask me how to do something, or anything about your business. Press Help whenever you need me.';
      const call = ctx.firstSteps?.call;
      if (call === 'offer') return `${base} Would you rather talk to a person? Book a free onboarding call with Bryan from the card at the foot of your sidebar.`;
      if (call === 'booked') return `${base} Your onboarding call with Bryan is on the card at the foot of your sidebar.`;
      return base;
    },
    side: 'bottom',
    // The Help button is in the top bar on a phone too.
    centerOnMobile: false,
  },

  // ── The last card: the one must-do ─────────────────────────────────────
  {
    id: 'done',
    label: 'Done',
    title: 'That is the big picture',
    body: 'One thing to do before a real rental: connect Stripe under Integrations, where Turo, accounting and your other tools plug in too. You do not have to do it alone: Bryan will set it all up with you on a free 30-minute call.',
    bodyFor: finaleBody,
    actionsFor: finaleActions,
    route: null,
    anchors: [],
    side: 'center',
    // The handover to the tab tours, drawn as its own box on the card.
    tabTourHint: true,
  },
];

/**
 * The last card's words. Six versions: Stripe missing or connected, times the
 * call on offer, booked, or not on offer. Stripe is always the one must-do;
 * the call is always offered as help, never as a step.
 */
export function finaleBody(ctx: TourBuildContext): string {
  const fs = ctx.firstSteps ?? { stripeConnected: true, call: 'none' as const, callTime: null };
  const when = fs.callTime ? ` on ${fs.callTime}` : ' booked';
  const tools = 'Turo, accounting and your other tools plug in under Integrations too.';
  if (!fs.stripeConnected) {
    const stripe = 'One thing to do before a real rental: connect your Stripe account, so your customers pay you directly into it. It is under Integrations, where Turo, accounting and your other tools plug in too.';
    if (fs.call === 'offer') return `${stripe} You do not have to do it alone: Bryan will set it all up with you on a free 30-minute call.`;
    if (fs.call === 'booked') return `${stripe} Your call with Bryan is${when}, and he can do it with you.`;
    return `${stripe} It takes 30 seconds.`;
  }
  const ready = `Stripe is connected, so you can take real rentals today. ${tools}`;
  if (fs.call === 'offer') return `${ready} Want a hand with the rest? Bryan will go through it all with you on a free 30-minute call.`;
  if (fs.call === 'booked') return `${ready} Your call with Bryan is${when}.`;
  return ready;
}

/** The last card's buttons, first one primary. */
export function finaleActions(ctx: TourBuildContext): readonly TourAction[] {
  const fs = ctx.firstSteps ?? { stripeConnected: true, call: 'none' as const, callTime: null };
  const out: TourAction[] = [];
  if (!fs.stripeConnected) out.push({ id: 'connect-stripe', label: 'Connect Stripe' });
  if (fs.call === 'offer') out.push({ id: 'book-call', label: 'Book onboarding call' });
  return out;
}

/** `/settings?tab=branding` → `/settings`. */
export function routePathname(route: string): string {
  const q = route.indexOf('?');
  return q === -1 ? route : route.slice(0, q);
}

/** `/settings?tab=branding` → `?tab=branding`; `/vehicles` → ``. */
export function routeSearch(route: string): string {
  const q = route.indexOf('?');
  return q === -1 ? '' : route.slice(q);
}

/** Is this step at home on `pathname`? A `null` route is at home anywhere. */
export function stepIsOnRoute(step: Pick<TourStep, 'route'>, pathname: string | null | undefined): boolean {
  if (step.route === null) return true;
  return routePathname(step.route) === pathname;
}

/**
 * May this step be OFFERED to this user? Every rule fails CLOSED: a step whose
 * requirement cannot be confirmed is dropped, because the alternative is
 * sending an operator to a page that bounces them, or spotlighting a button
 * they do not have.
 */
export function stepAllowed(step: TourStep, ctx: TourBuildContext): boolean {
  if (step.route !== null && !ctx.canAccessRoute(routePathname(step.route))) return false;
  const req = step.requires;
  if (!req) return true;
  if (req.desktop && ctx.isMobile) return false;
  if (req.edit && req.tab && !ctx.canEdit(req.tab)) return false;
  if (req.settingsTab && !ctx.canViewSettings(req.settingsTab)) return false;
  // Data presence. `sampleIds` is only populated for tab tours, so a step
  // carrying `record`/`noRecord` in a tour that never sets it is treated as
  // "no record" — which is the safe direction: it drops the steps that would
  // point at nothing rather than admitting steps that would stall.
  if (req.record && !ctx.sampleIds?.[req.record]) return false;
  if (req.noRecord && ctx.sampleIds?.[req.noRecord]) return false;
  // Tab-level emptiness, for tabs with no record id to key on. An absent
  // `emptyTabs` means "not known", which resolves to NOT empty — so a tour that
  // never populates it behaves exactly as it did before these two existed.
  const empty = ctx.emptyTabs ?? [];
  if (req.tabHasData && empty.includes(req.tabHasData)) return false;
  if (req.tabIsEmpty && !empty.includes(req.tabIsEmpty)) return false;
  return true;
}

/**
 * The walkthrough THIS user will actually get — filtered and rerouted.
 *
 * Runs once, at launch. The gates it reads (`permissions.ts` via
 * `canAccessRoute`/`canEdit`/`canViewSettings`, the lean-areas gate through
 * the sidebar's own filtering, the phone breakpoint, the Stripe gate) are all
 * settled by then, so the tour that starts is the tour that can finish.
 */
export function buildTour(ctx: TourBuildContext, steps: readonly TourStep[] = FIRST_RENTAL_TOUR): TourStep[] {
  // v3 swapped the rental step for a "connect Stripe first" version here. v4
  // has no swap: the Stripe line is on the last card, which reads
  // `ctx.firstSteps` when it is drawn (`finaleBody`), so it is right even if
  // the read lands after the tour starts.
  const out: TourStep[] = [];
  for (const raw of steps) {
    let step = raw;
    // A sidebar stop on a phone: the rail is an off-canvas sheet there, so
    // draw the card centred rather than wait for a row that is never shown.
    if (ctx.isMobile && step.mobileAnchors) {
      step = {
        ...step,
        anchors: step.mobileAnchors,
        span: step.mobileSpan ?? [],
        body: step.mobileBody ?? step.body,
        side: 'top',
      };
    } else if (ctx.isMobile && step.centerOnMobile) {
      step = { ...step, anchors: [], side: 'center' };
    }
    // Resolve a record-scoped route into a real path, and drop the step if the
    // tenant has no such record. This runs BEFORE `stepAllowed` so the route
    // that gets permission-checked is the one the tour will actually navigate
    // to, not the list page standing in for it.
    if (step.routeFor) {
      const resolved = step.routeFor(ctx);
      if (!resolved) continue;
      step = { ...step, route: resolved };
    }
    if (!stepAllowed(step, ctx)) continue;
    out.push(step);
  }
  return out;
}

/**
 * Is this a real stop, as opposed to the Welcome or Done card? A stop that
 * `buildTour` centred for a phone still counts: it was pointing at something.
 */
export function isTourStop(step: TourStep): boolean {
  return step.anchors.length > 0 || !!step.centerOnMobile;
}

/** Steps that point at something on screen. Welcome and Done do not count. */
export function countAnchoredSteps(steps: readonly TourStep[]): number {
  return steps.filter(isTourStop).length;
}

/** Enough of a walkthrough to be worth starting? */
export function isTourWorthRunning(steps: readonly TourStep[]): boolean {
  return countAnchoredSteps(steps) >= MIN_TOUR_STOPS;
}

/** A step resolved against the live DOM. `element` is null for anchorless steps. */
export interface ResolvedStep {
  step: TourStep;
  element: Element | null;
  /** Only the notes whose own anchors resolved. */
  notes: readonly string[];
}

/** @deprecated name kept for the three-stop tour's callers; same shape. */
export type ResolvedStop = ResolvedStep;

/**
 * Is this element genuinely on screen?
 *
 * `querySelector` finding a node proves nothing about whether the operator can
 * see it. The v2 sidebar renders a desktop rail AND a mobile Sheet from the
 * same primitives, both carrying `data-sidebar="sidebar"`, and a collapsed rail
 * keeps its labels in the tree as `sr-only`. Spotlighting a zero-area node
 * draws a hole in the middle of nowhere.
 */
export function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  // Laid out is not the same as shown. The v2 overview card turns over to show
  // its filters, and the face it turns away keeps its full box, so the stat
  // cards on it still measure. That face is `inert` straight away and
  // `visibility: hidden` once the turn settles. Without these checks, a tour
  // started with the filters open spotlights an empty patch and never falls
  // back to the heading its step names next.
  if (el.closest("[inert]")) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

/**
 * First VISIBLE element matching any candidate selector, in order.
 *
 * Selector order is preference order, and every match for a selector is
 * considered before moving to the next one — so a hidden duplicate never
 * shadows the real thing.
 */
export function findAnchor(
  anchors: readonly string[],
  root: ParentNode,
  visible: (el: Element) => boolean = isVisible,
): Element | null {
  for (const selector of anchors) {
    let matches: NodeListOf<Element>;
    try {
      matches = root.querySelectorAll(selector);
    } catch {
      // A malformed selector must not take the whole tour down with it.
      continue;
    }
    for (const el of Array.from(matches)) {
      if (visible(el)) return el;
    }
  }
  return null;
}

function resolveNotes(step: TourStep, root: ParentNode, visible: (el: Element) => boolean): string[] {
  return (step.notes ?? [])
    .filter((n) => !n.anchors || findAnchor(n.anchors, root, visible) !== null)
    .map((n) => n.text);
}

/**
 * Resolve ONE step against the live DOM.
 *
 * Returns null when the step points at something and that something is not on
 * screen — the hook keeps asking for a short while (anchors mount late, after
 * the page's data lands) and then SKIPS the step. An anchorless step resolves
 * immediately with `element: null`.
 */
export function resolveStep(
  step: TourStep,
  root: ParentNode,
  visible: (el: Element) => boolean = isVisible,
): ResolvedStep | null {
  if (step.anchors.length === 0) {
    return { step, element: null, notes: resolveNotes(step, root, visible) };
  }
  const element = findAnchor(step.anchors, root, visible);
  if (!element) return null;
  return { step, element, notes: resolveNotes(step, root, visible) };
}

/**
 * Resolve every step against the live DOM and DROP the ones pointing at
 * nothing. The three-stop tour's launch-time filter; kept because it is the
 * cheapest way to ask "which of these are on THIS screen right now".
 */
export function resolveStops(
  steps: readonly TourStep[],
  root: ParentNode,
  visible: (el: Element) => boolean = isVisible,
): ResolvedStep[] {
  const resolved: ResolvedStep[] = [];
  for (const step of steps) {
    const r = resolveStep(step, root, visible);
    if (r) resolved.push(r);
  }
  return resolved;
}

/** Everything that has to be true before the tour may autostart. */
export interface TourGateInput {
  /** `isLeanTenant(tenant.slug)` — the canary, keyed on SLUG and never on id. */
  isCanary: boolean;
  /**
   * Is this tenant on the v2 chrome? Every sidebar anchor lives in
   * `app-sidebar-v2.tsx`; under v1 chrome the walkthrough would be pointing at
   * a different building. Checking explicitly makes that intent legible
   * rather than accidental.
   */
  hasV2Chrome: boolean;
  /** Dashboard route only. */
  onDashboard: boolean;
  /** Auth and the app user have settled. */
  authReady: boolean;
  /**
   * Any blocking gate is up — the subscription paywall in its `setup`,
   * `expired` or `past_due` variant. A tour spotlighting the sidebar behind a
   * non-dismissible paywall is nonsense the operator cannot act on.
   */
  blockingGateOpen: boolean;
  /**
   * The first-run wizard is showing, or has not yet said whether it will.
   *
   * This is step 7 of a flow whose step 6 is the wizard, and the two must never
   * be on screen together. "Not yet resolved" counts as pending on purpose: the
   * wizard's query settles a beat after mount, and starting during that beat is
   * exactly how two full-screen surfaces end up stacked.
   */
  wizardPending: boolean;
  /** This user has already been through it (or skipped it). */
  alreadySeen: boolean;
  /**
   * The saved tour state has come back from the database (or the wait for it
   * ran out). Absent means not tracked, which counts as ready.
   */
  syncReady?: boolean;
}

/**
 * Should the tour AUTOSTART?
 *
 * Fails CLOSED on every unknown, which is the only safe direction for a
 * surface that covers the screen. Note in particular that an unresolved tenant
 * slug arrives here as `isCanary: false` — `isLeanTenant` returns false for
 * null/undefined — so the brief tick before TenantContext resolves the hostname
 * cannot flash the tour, and a bogus subdomain never resolves a tenant at all.
 *
 * Replay is deliberately NOT routed through here. Asking for the tour from the
 * user menu is an explicit act; it bypasses `alreadySeen` and `onDashboard`
 * (the menu item only exists on the canary's v2 chrome in the first place).
 * Resuming an interrupted run is not routed through here either — that is
 * `decideResume`, below.
 */
export function shouldAutostartTour(input: TourGateInput): boolean {
  return (
    input.isCanary &&
    input.hasV2Chrome &&
    input.onDashboard &&
    input.authReady &&
    !input.blockingGateOpen &&
    !input.wizardPending &&
    !input.alreadySeen &&
    input.syncReady !== false
  );
}

/**
 * Has this user seen the tour?
 *
 * Every access is wrapped: `localStorage` THROWS on access (not just returns
 * null) in Safari's private mode and wherever site data is blocked, and an
 * uncaught throw here happens during the dashboard's first paint. Fails to
 * `true` — "assume seen" — because the cost of wrongly staying quiet is one
 * operator who has to replay from the menu, while the cost of wrongly starting
 * is an unskippable-feeling tour that returns on every single page load.
 */
export function hasSeenTour(
  appUserId: string | null | undefined,
  storage: Pick<Storage, 'getItem'> | null = safeStorage(),
): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(tourSeenKey(appUserId)) !== null;
  } catch {
    return true;
  }
}

/**
 * Record that this user has seen the tour.
 *
 * Called UP FRONT, the moment the tour is about to start — never on finish.
 * Writing at the end leaves a window in which a re-render, a route change or a
 * second tab re-fires the autostart, and a first-run surface that appears twice
 * reads as broken. Skipping and finishing therefore need no separate bookkeeping
 * at all: both are already recorded.
 */
export function markTourSeen(
  appUserId: string | null | undefined,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(tourSeenKey(appUserId), new Date().toISOString());
    noteTourWrite(tourSeenKey(appUserId));
  } catch {
    // Storage full or blocked. The tour still runs this once; the only loss is
    // that it may offer itself again next load. Never worth throwing for.
  }
}

// ── Progress: where the operator got to ────────────────────────────────────

export type TourProgressStatus = 'active' | 'paused';

/**
 * Where an interrupted walkthrough was.
 *
 *  - `active`  the tour was running when the page went away — a reload, a
 *              closed tab, the tour's OWN navigation between steps. Landing
 *              back on that step's route resumes it silently.
 *  - `paused`  the operator stepped out on purpose — clicked the thing being
 *              pointed at, wandered to another page, or the paywall came up.
 *              The dashboard offers Resume / Start over / Dismiss.
 *
 * `prompts` counts how many times the dashboard has offered to resume. Past
 * `MAX_RESUME_PROMPTS` the record is dropped: an operator who keeps ignoring
 * the offer has answered it.
 */
export interface TourProgress {
  version: number;
  stepId: string;
  status: TourProgressStatus;
  updatedAt: string;
  prompts: number;
  /** A required run: it comes back on its own, and it is never dropped. */
  required?: boolean;
}

export const MAX_RESUME_PROMPTS = 3;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isProgress(value: unknown): value is TourProgress {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === FIRST_RENTAL_TOUR_VERSION &&
    typeof v.stepId === 'string' &&
    v.stepId.length > 0 &&
    (v.status === 'active' || v.status === 'paused') &&
    typeof v.updatedAt === 'string' &&
    typeof v.prompts === 'number' &&
    (v.required === undefined || typeof v.required === 'boolean')
  );
}

/**
 * The saved progress, or null. Null for anything unreadable — a different
 * version, a hand-edited value, a throwing store — because the only thing a
 * bad record could do is resume the wrong tour.
 */
export function readTourProgress(
  appUserId: string | null | undefined,
  storage: Pick<Storage, 'getItem'> | null = safeStorage(),
): TourProgress | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(tourProgressKey(appUserId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isProgress(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Save progress. Never throws; a failed write just means no resume offer. */
export function writeTourProgress(
  appUserId: string | null | undefined,
  progress: { stepId: string; status: TourProgressStatus; prompts?: number; required?: boolean },
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  if (!storage) return;
  const record: TourProgress = {
    version: FIRST_RENTAL_TOUR_VERSION,
    stepId: progress.stepId,
    status: progress.status,
    updatedAt: new Date().toISOString(),
    prompts: progress.prompts ?? 0,
    ...(progress.required ? { required: true } : {}),
  };
  try {
    storage.setItem(tourProgressKey(appUserId), JSON.stringify(record));
    noteTourWrite(tourProgressKey(appUserId));
  } catch {
    // Storage full or blocked. The tour keeps running in memory.
  }
}

export function clearTourProgress(
  appUserId: string | null | undefined,
  storage: Pick<Storage, 'removeItem'> | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(tourProgressKey(appUserId));
    noteTourWrite(tourProgressKey(appUserId));
  } catch {
    // Nothing to do; the record simply survives until the next clear.
  }
}

/** Never throws. Storage is a real `Storage`, never a partial, when present. */
export function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

// ── Resume ─────────────────────────────────────────────────────────────────

export type ResumeDecision =
  /** Pick up silently, right here, at `index`. */
  | { kind: 'resume'; index: number }
  /** Offer Resume / Start over / Dismiss (dashboard only). */
  | { kind: 'prompt'; index: number }
  /** Nothing to do on this page. */
  | { kind: 'none' };

/**
 * Given saved progress and where the operator is now, what should happen?
 *
 *  - `active` progress whose step lives on THIS route: the page reloaded (or
 *    the tour itself navigated here). Resume without asking.
 *  - anything else, on the DASHBOARD: ask. Never anywhere else — a resume
 *    offer popping up on the invoice they came back to pay is a nag.
 *  - anything else, elsewhere: nothing.
 *
 * A step id the eligible list no longer contains (a grant was revoked between
 * visits) resumes from the first step at or after where it would have been,
 * which is the next thing they had not yet seen.
 */
export function decideResume(
  progress: TourProgress | null,
  pathname: string | null | undefined,
  steps: readonly TourStep[],
): ResumeDecision {
  if (!progress || steps.length === 0) return { kind: 'none' };
  let index = steps.findIndex((s) => s.id === progress.stepId);
  if (index === -1) {
    // The saved step was dropped from this user's walkthrough. Land on the
    // nearest surviving step AFTER its canonical position — never before it.
    const canonical = FIRST_RENTAL_TOUR.findIndex((s) => s.id === progress.stepId);
    if (canonical === -1) return { kind: 'none' };
    const after = FIRST_RENTAL_TOUR.slice(canonical + 1).map((s) => s.id);
    index = steps.findIndex((s) => after.includes(s.id));
    if (index === -1) return { kind: 'none' };
  }
  // A required run is not offered, it comes back: on any page, at its card.
  if (progress.required) return { kind: 'resume', index };
  if (progress.status === 'active' && stepIsOnRoute(steps[index], pathname)) {
    return { kind: 'resume', index };
  }
  if (pathname === '/') return { kind: 'prompt', index };
  return { kind: 'none' };
}

/**
 * The replay signal, fired by the user menu.
 *
 * A window event rather than a store or a prop, matching what the v2 chrome
 * already does for `open-sidebar-customizer` and `open-global-search`. The menu
 * and the tour sit in different subtrees of the dashboard layout and share no
 * ancestor that could hold the state.
 */
export const REPLAY_TOUR_EVENT = 'replay-first-rental-tour';

/**
 * What a replay can ask for. Both optional: a plain replay (from Help) starts
 * at the first card and can be closed.
 */
export interface ReplayTourDetail {
  /** Run it as a new company meets it: required, no way out but the last card. */
  required?: boolean;
  /** Start on this card instead of the first. */
  stepId?: string;
}
