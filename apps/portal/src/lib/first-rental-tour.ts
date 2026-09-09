/**
 * The first-run ORIENTATION — its steps, its gate, its anchor resolver, and the
 * two things it remembers: that a user has seen it, and where they got to.
 *
 * THE PRODUCT DECISION, restated here because the shape of this file follows
 * from it, and because this file has already been the wrong size once.
 *
 * It shipped as three coach marks. It was then grown into an eleven-step
 * WALKTHROUGH that crossed six pages — dashboard, Vehicles, Customers, the New
 * Rental form (three steps deep, including insurance and the agreement),
 * Payments, Settings — and marched a brand-new operator through making a first
 * rental before they had a car or a customer to make one with.
 *
 * Ghulam ruled that out in review: "woh abhi woh tour nahi hai" — that is not
 * the tour — and named the walk through payments specifically. His design is
 * four separate things, and this file is only the third of them:
 *
 *   questions answered → a first dialog where Trax introduces itself →
 *   a SHORT general orientation → and inside every tab, a tour BUTTON the
 *   operator takes at their own convenience.
 *
 * So this is now an ORIENTATION, not a walkthrough. Its whole job is to say
 * WHERE THINGS LIVE and then get out of the way. Eight shallow steps, one
 * stop per place, and nothing that walks into a form:
 *
 *   1. Welcome       (dashboard)   Trax introduces itself; a minute, skippable
 *   2. Your sidebar  (dashboard)   ONE stop for the nav, not one per item
 *   3. Vehicles      → /vehicles   this is your fleet — NOT the Add dialog
 *   4. Customers     → /customers  this is everyone who rents from you
 *   5. Rentals       → /rentals    where the business runs — NOT /rentals/new
 *   6. Tab tours     (same page)   every tab has its own tour, take it later
 *   7. Booking site  → /settings   "your customers book here", and settings
 *   8. Done          (anywhere)    a finale, and a pointer to the tab tours
 *
 * WHY IT MAY NOT GROW BACK. The depth that used to be steps 6-9 has not been
 * deleted — it MOVED, to `lib/tab-tours/{vehicles,customers,rentals,payments}.ts`,
 * where roughly ten steps per tab are launched from a button on that tab rather
 * than fired at somebody on their first login. Anything you are tempted to add
 * here almost certainly belongs there instead. The `tours` step exists to hand
 * the operator over to them, which is what makes this list allowed to be short.
 *
 * The old dashboard "setup guide" step went the other way: it is not a stop any
 * more, because the panel it pointed at is already on the screen the operator
 * lands on and needs no spotlight to be found. The finale names it instead, so
 * they leave knowing what still tracks their remaining setup.
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
 * shape, worth one more run.
 * v2 → v3: the walkthrough became the eight-step orientation. Half the stops
 * are gone and the survivors say different things on different pages, so
 * anyone who sat through v2 is being offered a genuinely different tour rather
 * than a repeat — and anyone stranded mid-v2 has their saved step discarded by
 * `isProgress` rather than resumed onto a route this list no longer visits.
 *
 * Older keys are not cleaned up here — the reset path in `lib/dev-actions.ts`
 * matches on the `d247.tour.` namespace, so it clears every version at once.
 */
export const FIRST_RENTAL_TOUR_VERSION = 3;

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

/**
 * The universal last resort. Every page in the v2 chrome renders a title
 * inside the inset; a page that cannot render one is a page that failed.
 */
const PAGE_TITLE = '[data-slot="sidebar-inset"] h1';

/** One line each. These ride the rerouted rental step when the flow is gated. */
const INSURANCE_NOTE = 'Insurance is offered in the same flow, priced per rental.';
const AGREEMENT_NOTE = 'The rental agreement is drawn up and sent for signature as part of this.';

/**
 * The canonical step list. `buildTour` filters and reroutes it per user; this
 * is what a head admin on a desktop with Stripe connected walks through.
 *
 * TWO PROPERTIES OF THIS LIST ARE LOAD-BEARING, and neither is obvious.
 *
 * ROUTES ONLY EVER MOVE FORWARD: `/` → `/vehicles` → `/customers` → `/rentals`
 * → `/settings`, and the finale stays put. Five pushes for eight steps. A tour
 * that doubles back — Settings, then a tab page again — reads as lost, and each
 * extra navigation is another chance for an anchor to arrive late.
 *
 * NOTHING HERE REQUIRES AN EDIT GRANT. The old walkthrough pointed at Add
 * Vehicle and Add Customer, so a viewer or a read-only manager lost those steps
 * and could fall under `MIN_TOUR_STOPS` entirely. An orientation is about where
 * things ARE, which is a read, so these steps point at what the page shows
 * rather than at what it lets you press — and everyone who can open the page
 * gets them.
 */
export const FIRST_RENTAL_TOUR: readonly TourStep[] = [
  {
    id: 'welcome',
    label: 'Welcome',
    // Trax speaks, in the first person, and this is the one card where that
    // introduction happens — every step after it is already understood to be
    // Trax talking, so they stay short and practical rather than re-introducing
    // anybody. No emoji anywhere in this file: the voice carries the warmth.
    title: 'I am Trax. Let me show you around.',
    body: 'I work alongside you in here. Give me a minute and you will know where everything lives. Skip whenever you like, or replay this from your profile menu.',
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
    id: 'vehicles',
    label: 'Vehicles',
    // Was "Add your first vehicle", anchored on the Add button and pausing the
    // tour so they went and did it. That is the tab tour's job now — and
    // `lib/tab-tours/vehicles.ts` does it better, because it can then walk
    // INTO the record. Here we only say what this page is.
    //
    // ONE stat tile, never the grid: the six-card row is most of the fold on a
    // laptop, and a spotlight that big degrades to a wash that teaches nothing.
    // The tile is rendered above the empty-state branch, so it is on the page
    // for a brand-new tenant with no cars at all — reading zero, which is the
    // honest thing for it to say to them.
    title: 'Your fleet',
    body: 'Every car you rent out lives here, with its rates, its photos and whether it is free to book right now.',
    route: '/vehicles',
    anchors: ['[data-tour="fleet-stat-total-vehicles"]', PAGE_TITLE],
    side: 'bottom',
  },
  {
    id: 'customers',
    label: 'Customers',
    title: 'Everyone who rents from you',
    body: 'Anyone who books on your site lands here on their own. Their licence, their history and what they owe sit on one page.',
    route: '/customers',
    // The four counts render at zero rather than not at all, so this is as
    // present on a brand-new tenant's empty tab as on a busy one.
    anchors: ['[data-tour="customers-stats"]', PAGE_TITLE],
    side: 'bottom',
  },
  {
    id: 'rental',
    label: 'Rentals',
    // The step the lead's ruling changed most. It used to be `/rentals/new`
    // and drag the operator three steps into the form. It now stops at the
    // door: this is the tab, that is the button, come back when you have a car
    // and a customer.
    //
    // `pauseOnAnchorClick` is NOT optional here, and not for the usual reason.
    // The next step (`tours`) is on this same page, and the renderer treats a
    // click on a look-at-this step whose next step is same-page as "understood"
    // and advances. So without this, clicking New Rental would advance the
    // orientation to `tours` while the browser navigated away to the form, and
    // the card would be left pointing at a page that is leaving.
    title: 'Where the business runs',
    body: 'Every booking lives here, from the first enquiry to the keys coming back. New Rental starts one whenever you are ready.',
    route: '/rentals',
    anchors: ['[data-tour="new-rental"]', '[data-tour="rentals-header"]', PAGE_TITLE],
    side: 'bottom',
    pauseOnAnchorClick: true,
  },
  {
    id: 'tours',
    label: 'Tab tours',
    // The handoff, and the reason this list is allowed to be eight steps.
    //
    // It lives HERE, on `/rentals`, rather than at the end after Settings —
    // the button only exists on the tab pages, so a step for it after the
    // Settings stop would mean navigating back to a tab and breaking the
    // forward-only route order. This is the last tab the orientation visits,
    // which also makes it the right moment to say it: they have just been
    // shown three tabs, and this is how they go deeper into any of them.
    //
    // `pauseOnAnchorClick`, because clicking this launches a tab tour. Two
    // tours drawing cards on one screen is the worst outcome available here,
    // so the orientation steps aside the moment they reach for the other one.
    title: 'Each tab has its own tour',
    // FOUR tab tours, not three. Payments has one too, and it was the tab the
    // original objection to the old walkthrough was actually about — omitting
    // it here would send the operator away believing the one tour they most
    // need does not exist. Keep this sentence in step with TAB_TOUR_IDS.
    body: 'This button walks you through one tab properly, at whatever moment suits you. Vehicles, Customers, Rentals and Payments each have one.',
    route: '/rentals',
    // The button self-gates on the canary slug and the v2 chrome — the same
    // two things this tour's own gate requires — so it is present whenever the
    // orientation is running. The fallbacks are for the replay path, which
    // bypasses that gate, and cost nothing when the button is there.
    anchors: ['[data-tour="take-tab-tour"]', '[data-tour="rentals-header"]', PAGE_TITLE],
    side: 'bottom',
    pauseOnAnchorClick: true,
  },
  {
    id: 'booking-site',
    label: 'Booking site',
    title: 'Your customers book here',
    body: 'Your name, logo and colours go on a public booking site that is already live for you.',
    route: '/settings?tab=branding',
    // Point at the Branding ROW in the settings rail, not at the panel it
    // opens. The panel (`[data-tour="booking-site-branding"]`) is a whole Card
    // — Application Name, Company Logo and Favicon — and it is TALLER THAN THE
    // VIEWPORT, so spotlighting it rimmed nearly the entire screen, left only a
    // strip of sidebar dimmed, and slid around as the operator scrolled. A
    // spotlight around everything points at nothing.
    //
    // The row is the thing the sentence is actually about: "your customers book
    // here" is telling them WHERE this lives, and the answer is Settings →
    // Branding. Once they are looking at the right row, the panel beside it is
    // already on screen and needs no rim of its own.
    //
    // `[id$="-trigger-branding"]` used to sit here as the small-element
    // fallback. It addresses Radix's generated TabsTrigger id from the v1
    // settings page, which the v2 sidebar replaced — so it matched nothing, and
    // every run fell through to the oversized card. Kept last, still, for a
    // tenant rendering the v1 tab strip.
    // The page's own <h1> is the genuine last resort, and it is last for a
    // reason. `[id$="-trigger-branding"]` above it matches only the v1 Radix
    // tab strip, which the v2 sidebar replaced — and this tour requires v2
    // chrome, so under the chrome it actually runs in that selector resolves
    // to NOTHING. Without a real fallback beneath it, the step's only
    // remaining candidate was the oversized Branding card this step exists to
    // avoid, and the suite's "every step ends on markup the page cannot render
    // without" assertion was true of this step only on a technicality.
    // /settings renders an h1 in every branch, so this makes the guarantee real.
    anchors: [
      '[data-tour="settings-tab-branding"]',
      '[data-tour="booking-site-branding"]',
      '[id$="-trigger-branding"]',
      '[data-slot="sidebar-inset"] h1',
      'main h1',
    ],
    side: 'right',
    requires: { settingsTab: 'branding' },
    detail: (ctx) => (ctx.bookingUrl ? ctx.bookingUrl.replace(/^https?:\/\//, '') : null),
    notes: [
      {
        // The lead asked for settings to be named rather than merely visited.
        // Anchored on the rail this step is already standing in front of, so a
        // tenant whose settings sidebar is not drawn never reads about a list
        // that is not there.
        text: 'The rest of your setup is in this list — locations, deposits, fees and more.',
        anchors: [`${SIDEBAR} [data-sidebar="content"]`],
      },
    ],
  },
  {
    id: 'done',
    label: 'Done',
    title: "That's the house",
    body: 'Take a tab tour whenever you want the detail on one. Your setup guide on the dashboard tracks what is still to switch on.',
    route: null,
    anchors: [],
    side: 'center',
  },
];

/**
 * The rental step as it reads when the New Rental flow is GATED — a lean
 * tenant without a usable Stripe Connect account gets a "connect Stripe"
 * dialog instead of the form when they press the button.
 *
 * The orientation stops at `/rentals` either way, so this no longer exists to
 * rescue a step that had nowhere to stand; it exists because the sentence is
 * different. Telling that operator "New Rental starts one whenever you are
 * ready" would be false — the button will stop them — so this says what it
 * will actually do and where the fix is.
 *
 * It also carries the two one-liners the healthy operator does not get, and
 * that asymmetry is deliberate: someone who can open the rental flow will meet
 * insurance and the agreement inside it, or in the Rentals tab tour. Someone
 * who is blocked at the door will not meet them at all, so they are told.
 */
export const BLOCKED_RENTAL_STEP: TourStep = {
  id: 'rental',
  label: 'Rentals',
  title: 'Where the business runs',
  body: 'Every booking lives here. New Rental starts one once your payments are connected, and the setup guide gets you there.',
  route: '/rentals',
  anchors: [
    '[data-tour="new-rental"]',
    '[data-tour="rentals-header"]',
    '[data-tour="nav-rentals"]',
    `${SIDEBAR} a[href="/rentals"]`,
  ],
  side: 'bottom',
  pauseOnAnchorClick: true,
  notes: [{ text: INSURANCE_NOTE }, { text: AGREEMENT_NOTE }],
};

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
  // The Stripe reroute below REWRITES a step by id, and `rental` is generic
  // enough that another tour could reasonably use it. If one did, a canary
  // without a usable Connect account would silently get THIS tour's copy —
  // different title, different body, different notes — with no error and no
  // failed build, which on a project that ships with `ignoreBuildErrors: true`
  // means nobody finds out.
  //
  // So the reroute is scoped to the list it was written for. Tab tours
  // additionally namespace their ids (`rentals.new`), which makes a collision
  // impossible rather than merely unlikely — belt and braces, because the cost
  // of being wrong here is a wrong screen rather than a crash.
  //
  // The orientation no longer enters the New Rental form, so there is nothing
  // left to DROP when the flow is gated — `insurance` and `agreement` were the
  // only steps that lived in there, and they are now the Rentals tab tour's.
  // What survives is a copy swap: same page, same button, honest sentence.
  const canReroute = steps === FIRST_RENTAL_TOUR;
  const out: TourStep[] = [];
  for (const raw of steps) {
    let step = raw;
    if (canReroute && ctx.rentalCreationBlocked && step.id === 'rental') {
      step = BLOCKED_RENTAL_STEP;
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
