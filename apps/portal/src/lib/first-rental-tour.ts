/**
 * The first-rental walkthrough — its steps, its gate, its anchor resolver, and
 * the two things it remembers: that a user has seen it, and where they got to.
 *
 * THE PRODUCT DECISION, restated here because the shape of this file follows
 * from it. The tour shipped as three coach marks on the sidebar; Ghulam then
 * asked for "a bit more like a walkthrough — a good amount of steps in it", the
 * standard of a big application's onboarding. So it is now eleven steps that
 * CROSS PAGES — dashboard, Vehicles, Customers, the New Rental flow, Payments,
 * Settings — and shows the operator the house on the way to the one thing it
 * has always been for: their first rental.
 *
 *   1.  Welcome        (dashboard)   what this is, a minute, skip any time
 *   2.  Your sidebar   (dashboard)   ONE stop for the nav, not one per item
 *   3.  Setup guide    (dashboard)   tracks progress; each row has a video
 *   4.  Vehicles       → /vehicles   add your first vehicle — real, not demo
 *   5.  Customers      → /customers  add your first customer
 *   6.  New Rental     → /rentals/new  mode, customer, vehicle, dates, place
 *   7.  Insurance      (same flow)   Bonzah, offered where the car is picked
 *   8.  Agreement      (same flow)   drawn up and sent for signature from here
 *   9.  Payments       → /payments   where the money shows up
 *   10. Booking site   → /settings   "your customers book here"
 *   11. Done           (anywhere)    a finale, and a pointer to the checklist
 *
 * Insurance sits before Agreement, the reverse of the brief's numbering, on
 * purpose: in the flow the car (and its cover) is chosen first and the
 * agreement is the thing that goes out at the end, and the spotlight walks the
 * breadcrumb left to right instead of doubling back.
 *
 * Still skippable at every step, still replayable from the user menu, still NO
 * VIDEOS inside it — videos live in the setup checklist and the empty states.
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

/**
 * Bump when the STEPS change in a way that makes re-showing the tour the right
 * call. The version is part of the storage key, so bumping it re-arms the tour
 * for everyone; leaving it alone keeps every operator who has already seen it
 * from meeting it twice.
 *
 * v1 → v2: the three-stop tour became the eleven-step walkthrough. Different
 * shape, worth one more run. The v1 keys are not cleaned up here — the reset
 * path in `lib/dev-actions.ts` matches on the `d247.tour.` namespace, so it
 * clears every version at once.
 */
export const FIRST_RENTAL_TOUR_VERSION = 2;

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

const SIDEBAR = '[data-sidebar="sidebar"]';

/** One line each. These ride the rerouted rental step when the flow is gated. */
const INSURANCE_NOTE = 'Insurance is offered in the same flow, priced per rental.';
const AGREEMENT_NOTE = 'The rental agreement is drawn up and sent for signature as part of this.';

/**
 * The canonical step list. `buildTour` filters and reroutes it per user; this
 * is what a head admin on a desktop with Stripe connected walks through.
 */
export const FIRST_RENTAL_TOUR: readonly TourStep[] = [
  {
    id: 'welcome',
    label: 'Welcome',
    title: 'Welcome to your portal',
    body: 'A quick walk through the house — about a minute. Skip any time; you can replay it from your profile menu.',
    route: '/',
    anchors: [],
    side: 'center',
    showOutline: true,
  },
  {
    id: 'sidebar',
    label: 'Navigation',
    title: 'Everything lives here',
    body: 'Rentals, Vehicles and Customers up top. Money, records and settings under More.',
    route: '/',
    anchors: [`${SIDEBAR} [data-sidebar="content"]`, SIDEBAR],
    side: 'right',
    requires: { desktop: true },
  },
  {
    id: 'setup-guide',
    label: 'Setup guide',
    title: 'Your setup guide',
    body: 'It tracks what is left to set up. Each row has a short video when you want the detail.',
    route: '/',
    anchors: ['[data-tour="setup-guide-panel"]', '[data-tour="setup-guide"]'],
    side: 'left',
  },
  {
    id: 'vehicles',
    label: 'Vehicles',
    title: 'Add your first vehicle',
    body: 'You need one car to rent. Add the real one you plan to put on the road — this is your live business, not a demo.',
    route: '/vehicles',
    anchors: ['[data-tour="add-vehicle"]', '[data-add-vehicle-trigger]'],
    side: 'bottom',
    requires: { tab: 'vehicles', edit: true },
    pauseOnAnchorClick: true,
  },
  {
    id: 'customers',
    label: 'Customers',
    title: 'Add your first customer',
    body: 'And one person to rent it to. A real customer — name, email, licence — so the first agreement you send is a real one.',
    route: '/customers',
    anchors: ['[data-tour="add-customer"]'],
    side: 'bottom',
    requires: { tab: 'customers', edit: true },
    pauseOnAnchorClick: true,
  },
  {
    id: 'rental',
    label: 'New rental',
    title: 'Making a rental',
    body: "Booking mode, customer, vehicle — then dates and a location. That's all a rental needs.",
    route: '/rentals/new',
    anchors: ['[data-tour="rental-steps"]', 'nav[aria-label="Progress"]'],
    side: 'top',
    requires: { tab: 'rentals', edit: true },
  },
  {
    id: 'insurance',
    label: 'Insurance',
    title: 'Insurance, in the same place',
    body: 'When you pick the vehicle, Bonzah cover is offered right there — priced per rental, no separate errand.',
    route: '/rentals/new',
    anchors: [
      '[data-tour="rental-insurance"]',
      '[data-tour="rental-step-vehicle"]',
      '[data-tour="rental-steps"]',
    ],
    side: 'top',
    requires: { tab: 'rentals', edit: true },
  },
  {
    id: 'agreement',
    label: 'Agreement',
    title: 'The agreement sends itself',
    body: 'Finish the last step and the rental agreement is drawn up and sent to the customer for signature.',
    route: '/rentals/new',
    anchors: ['[data-tour="rental-step-rental-details"]', '[data-tour="rental-steps"]'],
    side: 'top',
    requires: { tab: 'rentals', edit: true },
  },
  {
    id: 'money',
    label: 'Payments',
    title: 'Where the money shows up',
    body: 'Every payment a customer makes lands here, with its rental beside it.',
    route: '/payments',
    anchors: ['[data-tour="payments-overview"]'],
    side: 'bottom',
    requires: { tab: 'payments' },
    notes: [
      {
        text: 'Invoices sit next door, under More → Finance.',
        anchors: ['[data-tour="nav-group-finance"]'],
      },
    ],
  },
  {
    id: 'booking-site',
    label: 'Booking site',
    title: 'Your customers book here',
    body: 'Your name, logo and colours go on a public booking site that is already live for you.',
    route: '/settings?tab=branding',
    anchors: ['[data-tour="booking-site-branding"]', '[id$="-trigger-branding"]'],
    side: 'top',
    requires: { settingsTab: 'branding' },
    detail: (ctx) => (ctx.bookingUrl ? ctx.bookingUrl.replace(/^https?:\/\//, '') : null),
  },
  {
    id: 'done',
    label: 'Done',
    title: "That's the house",
    body: 'Your setup guide on the dashboard tracks what is left. Add a car, add a customer, and your first rental is a few clicks away.',
    route: null,
    anchors: [],
    side: 'center',
  },
];

/**
 * The rental step as it reads when the New Rental flow is GATED — a lean
 * tenant without a usable Stripe Connect account gets a "connect Stripe"
 * dialog instead of the form, so there is no breadcrumb, no vehicle step and
 * no insurance box to point at. Point at the button instead, say what it
 * needs, and carry the two in-flow lessons as quiet one-liners — exactly what
 * the three-stop tour did before the walkthrough. Insurance and Agreement are
 * dropped as steps; nothing is lost, only depth that had nowhere to sit.
 */
export const BLOCKED_RENTAL_STEP: TourStep = {
  id: 'rental',
  label: 'New rental',
  title: 'Making a rental',
  body: "Dates, location, vehicle, customer — that's all a rental needs. This button makes one once payments are connected; the setup guide gets you there.",
  route: '/rentals',
  anchors: ['[data-tour="new-rental"]', '[data-tour="nav-rentals"]', `${SIDEBAR} a[href="/rentals"]`],
  side: 'bottom',
  requires: { tab: 'rentals', edit: true },
  pauseOnAnchorClick: true,
  notes: [{ text: INSURANCE_NOTE }, { text: AGREEMENT_NOTE }],
};

/** Step ids that only exist inside the (ungated) rental form. */
const IN_FLOW_ONLY = new Set(['insurance', 'agreement']);

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
  const out: TourStep[] = [];
  for (const raw of steps) {
    let step = raw;
    if (ctx.rentalCreationBlocked) {
      if (IN_FLOW_ONLY.has(step.id)) continue;
      if (step.id === 'rental') step = BLOCKED_RENTAL_STEP;
    }
    if (!stepAllowed(step, ctx)) continue;
    out.push(step);
  }
  return out;
}

/** Steps that point at something on screen. Welcome and Done do not count. */
export function countAnchoredSteps(steps: readonly TourStep[]): number {
  return steps.filter((s) => s.anchors.length > 0).length;
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
  return rect.width > 0 && rect.height > 0;
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
    !input.alreadySeen
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
    typeof v.prompts === 'number'
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
  progress: { stepId: string; status: TourProgressStatus; prompts?: number },
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  if (!storage) return;
  const record: TourProgress = {
    version: FIRST_RENTAL_TOUR_VERSION,
    stepId: progress.stepId,
    status: progress.status,
    updatedAt: new Date().toISOString(),
    prompts: progress.prompts ?? 0,
  };
  try {
    storage.setItem(tourProgressKey(appUserId), JSON.stringify(record));
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
