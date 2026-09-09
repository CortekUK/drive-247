/**
 * The Rentals tab tour — four stops on the list, then seven inside one rental,
 * or five different ones when the tab has nothing in it yet.
 *
 * THE CURATION PROBLEM, which is worse on this tab than on the other two.
 * Ghulam's own words about rental detail: "aadhi application sirf usi ek tab ke
 * andar hai" — half the application is inside that one tab — and "wahan toh
 * teen chaar tour lag jaayenge", it would take three or four tours to do it
 * justice. He then ruled that we do NOT go deep here: this tab gets the same
 * ~ten stops as Vehicles and Customers, and the things it leaves out are listed
 * at the foot of this comment so the next person knows they were left out on
 * purpose rather than missed.
 *
 * So every record step names a DOOR and says in one sentence what is behind it.
 * None of them explains how to fill anything in.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RECORD HALF ANCHORS ON THE STAGE RAIL
 *
 * The v2 rental detail is not a page of cards, it is eight STAGES — one
 * decision each — and opening a rental REPLACES the app sidebar with a rail of
 * those eight (`shared/layout/app-sidebar-v2.tsx`, the `isRentalDetailPage`
 * branch). Each row is a real link whose href comes from `stageHref()` in
 * `rental-detail/stages.ts`, so `[data-sidebar="sidebar"] a[href*="stage=…"]`
 * is:
 *
 *   - present on FIRST PAINT, before any query settles, for every rental
 *   - present in both the expanded rail and the collapsed icon rail
 *   - correct BY IDENTITY — each step falls back to its own stage's row, so a
 *     step that resolves before the new panel has repainted still points at the
 *     right door rather than at the outgoing one
 *   - small: a ~40px pill, nowhere near the two-thirds-of-viewport threshold at
 *     which the spotlight degrades to a centred wash
 *
 * That last property is what makes this tour safe. Once ONE step on a route
 * times out waiting for an anchor, every later step on that SAME route gets
 * 1.5s instead of 6s — and seven of these eleven steps sit on one pathname. An
 * anchor that resolves on the first poll is the only thing keeping a slow
 * ledger from starving the five steps behind it.
 *
 * Only two record steps aim at the panel first: Payments, where the outstanding
 * figure is the whole point, and Handover, where the two halves are. Both fall
 * back to their own rail row, so a slow panel costs the run nothing. Every
 * other stage panel is built from `Panel`, `Section` and `Surface`, none of
 * which spread props — there is no raw element in them to hang a `data-tour`
 * on without adding markup, and adding markup to a screen shared by the canary
 * to make a tour prettier is not a trade worth making.
 *
 * The final fallback on the stage steps is `h2.font-heading` — the panel's own
 * title, which `Panel` renders in every state including loading and error. It
 * is reached only when the rail is not on screen at all, which in practice
 * means a phone, where the sidebar is an off-canvas Sheet with no rect.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE RENTAL ID COMES FROM
 *
 * `ctx.sampleIds.rentalId` comes from `readSampleIds()`. The v2 rentals list
 * draws no `a[href^="/rentals/<uuid>"]` for it to read — its rows are
 * `<TableRow>` elements with `onClick={() => router.push(…)}` and no anchor
 * anywhere — so the id comes off the inert `data-record-kind="rentals"` /
 * `data-record-id` pair on the row instead (`rentals-list-v2.tsx`). Launched
 * from a rental detail page the stage rail supplies eight real hrefs, and the
 * same reader picks the id out of those.
 *
 * Either way it is null on a tenant who has taken no booking — which is not a
 * failure but the normal state of the operator this tour is written for.
 *
 * ---------------------------------------------------------------------------
 * WHAT AN EMPTY TAB GETS — the other half of this tour
 *
 * A brand-new tenant has NO rentals, and on this tab that is not even a
 * backlog: a rental needs a vehicle AND a customer, so on day one it cannot be
 * filled even in principle. The order agreed in the meeting was vehicle first.
 * So the one step list below serves both states and `buildTour` picks the half
 * that applies.
 *
 * Every step that points at a row or lives inside a rental carries
 * `requires: { record: 'rentalId' }`. The seven `routeFor` steps would drop on
 * their own — the helper returns null — but the guard is stated on them too, so
 * the dependency is declared in one place rather than being an emergent
 * property of a route helper. `rentals.open` is the one that genuinely needs
 * it: its route is perfectly valid and its anchor is never coming, so without
 * the guard the operator watches the full anchor budget expire on a table that
 * has been REPLACED by `RentalsTeachingEmptyState`, and then a skip. Six
 * seconds of nothing.
 *
 * `rentals.find` and `rentals.new` carry it as a product judgement rather than
 * a mechanical one. A search box over an empty table teaches nothing, and New
 * Rental is not available work on a tab that cannot be filled yet — the empty
 * run gets `rentals.empty.start` on that same button instead, with copy that
 * sends them to Vehicles first. Only one of each twin is ever built.
 *
 * In their place, four `noRecord` steps. With the shared opener that is five
 * stops, all five anchored — `MIN_TOUR_STOPS` counts ANCHORED steps, and a
 * tour under it silently refuses to launch.
 *
 * The last of them says the rest unlocks once one rental exists, because that
 * is exactly what happens: `hasTakenTabTour` treats a taken empty tour as
 * unseen again the moment there is a record, and the launch button re-brightens
 * and relabels itself "See what is inside". Without that line a five-step tour
 * reads as the whole thing and nobody comes back for the half that matters.
 *
 * The empty copy has to sit beside `RentalsTeachingEmptyState`, which is what
 * has replaced the table at that moment. It paraphrases that card rather than
 * contradicting it — its footnote is where the "creates the car or the customer
 * inline" line comes from. That card, like this whole v2 list, is canary-only,
 * and it is not drawn at all when a FILTER matched nothing, so every empty step
 * also falls back to the page title.
 *
 * ---------------------------------------------------------------------------
 * ONE NOTE ON HISTORY. The stage rail navigates with `replace` on purpose
 * (`_kit.tsx` StageItem, and the comment in `rental-detail-v2.tsx`) so that
 * looking at eight stages does not cost eight presses of Back. The tour uses
 * `push`, so this run leaves six entries behind it. That is accepted rather
 * than overlooked: the alternative is a per-step replace option on the hook,
 * and the record step names "All rentals" as the way out, which is one click
 * instead of six.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY LEFT OUT — Ghulam's "we do not go deep" rule, itemised
 *
 *  - EXTENSIONS, auto-extend, pay-as-you-go and instalment plans. Not on this
 *    screen at all: `SHOW_MULTI_PERIOD` is false in `rental-detail/multi-period.ts`
 *    and gates the Extensions rail tab, the extension reads in Payments, the
 *    extension agreements block and the extension cover block. A step about
 *    them would point at nothing. The v1 components are all still on disk and
 *    still serve the other 56 tenants, which is how this gets got wrong by grep.
 *  - The CUSTOMER stage. Verification, licence checks and staff reviews are a
 *    subject of their own and the Customers tour owns them.
 *  - The WHEN & WHERE stage. Its rail row already reads "When and where?" and
 *    carries the dates; the record step names it as one of the four decisions
 *    that make up the rental, which is as much as a first pass needs.
 *  - Damage analysis, and the lockbox. Damage only appears once photographs
 *    exist on BOTH halves; the lockbox block renders only for tenants who have
 *    lockboxes switched on. Both are named in passing by the Handover step
 *    rather than given a stop that would be blank on most rentals.
 *  - Agreement version history and terms drift. Genuinely the cleverest thing
 *    on the screen, and second-visit material.
 *  - The charge and payment lists, the stuck-charge warning and the v1 drift
 *    check on Payments. The outstanding figure is the surface-level point; the
 *    rest is depth.
 *  - The rentals calendar and `/rentals/analytics`. The calendar rides as a
 *    note on the search step; analytics was removed from the list header on
 *    purpose and is not somewhere to send anybody.
 *  - The overview stat strip. It returns null when `stats` is null and holds no
 *    single addressable element worth a rim.
 */

import type { TourBuildContext, TourStep } from '@/lib/first-rental-tour';
import { recordRoute, type TabTour } from './index';

/**
 * A stage's row in the rail — the fallback under every record step, and the
 * primary anchor for the four that are only naming a door.
 *
 * `stage=` values are a contract with `rental-detail/stages.ts` in two places
 * on the same step: the route AND this selector. Renaming a `StageId` breaks
 * both together, so there is no half-working state to miss.
 */
const rail = (stage: string) => `[data-sidebar="sidebar"] a[href*="stage=${stage}"]`;

/**
 * The stage panel's own title. `Panel` draws it in every state — loading,
 * loaded, and the rental-not-found screen — so it is the one thing on the
 * detail route that cannot be absent. Last resort only: unlike a rail row it is
 * not identity-correct while a stage change is repainting.
 */
const PANEL_TITLE = '[data-slot="sidebar-inset"] h2.font-heading';

/** The list page's heading. Unconditional on `/rentals`, and its last resort. */
const LIST_HEADING = ['[data-slot="sidebar-inset"] h1', 'main h1'] as const;

/**
 * `RentalsTeachingEmptyState`, which REPLACES the table on a tab with no
 * rentals. Two anchors INTO it and never the card itself: that card runs the
 * full width of the content column and is around 450px tall, so a spotlight on
 * it has nowhere to stand its own card and degrades to the centred wash the
 * Welcome step uses — an even dim that points at nothing.
 *
 * Canary-only, and not drawn at all when a FILTER matched nothing (that branch
 * keeps the "No rentals found" card), so every step using these keeps
 * `LIST_HEADING` under it.
 */
const EMPTY_HEADLINE = '[data-tour="rentals-empty"] h3';
const EMPTY_POINTS = '[data-tour="rentals-empty-points"]';

/**
 * The teaching card's own CTA. It is the FIRST button inside that card whenever
 * the card is drawn at all, and it runs the same handler as the header button —
 * including the Connect dialog on a tenant without a usable Stripe account.
 */
const EMPTY_CTA = '[data-tour="rentals-empty"] button';

/** `/rentals/<id>?stage=…`, or null on a tenant with nothing to open. */
const stageRoute = (stage?: string) => (ctx: TourBuildContext) =>
  recordRoute(ctx.sampleIds?.rentalId, '/rentals', stage ? `stage=${stage}` : undefined);

const STEPS: readonly TourStep[] = [
  {
    id: 'rentals.list',
    label: 'Rentals',
    title: 'Every hire, in one list',
    body: 'A rental ties one customer to one car for a set of dates, and carries the money and the paperwork with it. Most of what the portal reports on starts here.',
    route: '/rentals',
    anchors: ['[data-tour="rentals-header"]', ...LIST_HEADING],
    side: 'bottom',
    showOutline: true,
  },
  /**
   * ---------------------------------------------------------------------
   * THE EMPTY TAB. Four steps, offered only when there is no rental to open,
   * and dropped the moment there is one. They sit interleaved with the shared
   * steps rather than in a block because `buildTour` keeps this array's order
   * and the empty run has to READ in order: what turns up here, what one
   * carries, what has to exist first, then the door.
   */
  {
    id: 'rentals.empty.arrive',
    label: 'How one appears',
    title: 'Two ways a rental appears',
    body: 'You make one here, or a customer books on your public site and it arrives waiting for your approval. Either way it becomes the same record.',
    route: '/rentals',
    anchors: [EMPTY_HEADLINE, ...LIST_HEADING],
    // `left` first: the card then sits in the gap between the sidebar and the
    // teaching state rather than over the button inside it. `placementsFor`
    // falls through to right, bottom and top on a narrower window.
    side: 'left',
    requires: { noRecord: 'rentalId' },
  },
  {
    id: 'rentals.empty.holds',
    label: 'What it carries',
    title: 'What one rental carries',
    body: 'The charge, the deposit hold, the signed agreement and the cover all hang off the rental, and every one of them is settled from inside it.',
    route: '/rentals',
    anchors: [EMPTY_POINTS, ...LIST_HEADING],
    side: 'left',
    requires: { noRecord: 'rentalId' },
  },
  {
    /**
     * The honest step, and the one this tab needs that the other two do not.
     * A rental needs a vehicle AND a customer, so an empty Rentals tab on day
     * one is not a backlog — it is the correct state until the other two tabs
     * have something in them. Pointing at New Rental here instead would be
     * offering work that cannot be done yet.
     */
    id: 'rentals.empty.needs',
    label: 'A car first',
    title: 'A car and a person come first',
    body: 'This tab fills last, because a rental needs both. Add a vehicle, then a customer. Each of those tabs has its own tour, and Vehicles is the one for today.',
    route: '/rentals',
    // The sidebar row, then its own link, then the page title for a phone —
    // where the rail is an off-canvas Sheet with no rect. The body names both
    // tabs in words, so it still reads correctly on the heading.
    anchors: [
      '[data-tour="nav-vehicles"]',
      '[data-sidebar="sidebar"] a[href="/vehicles"]',
      ...LIST_HEADING,
    ],
    side: 'right',
    requires: { noRecord: 'rentalId' },
    notes: [
      {
        text: 'Customers comes after that. Anyone who books on your site is added there on their own.',
        anchors: ['[data-tour="nav-customers"]', '[data-sidebar="sidebar"] a[href="/customers"]'],
      },
    ],
  },
  {
    id: 'rentals.find',
    label: 'Finding one',
    title: 'Search, then narrow',
    body: 'Type a customer, a registration or a rental number. The slider inside the box opens the filters, and its badge means you are not reading the whole list.',
    route: '/rentals',
    anchors: ['[data-tour="rentals-search"]', ...LIST_HEADING],
    side: 'bottom',
    // Searching nothing teaches nothing, and the calendar note below points at
    // a tile inside an overview that returns null when there are no stats. Both
    // are worth a stop only once there is a list to narrow.
    requires: { record: 'rentalId' },
    notes: [
      {
        // Removed from the header on purpose, so this card is the only way an
        // operator finds it. Anchored, so it is not promised in calendar view
        // where the tile is not drawn.
        text: 'Calendar view lays the same rentals on a timeline, one row per car.',
        anchors: ['[data-tour="rentals-calendar"]'],
      },
    ],
  },
  {
    id: 'rentals.new',
    label: 'New rental',
    title: 'Starting one',
    body: 'Four steps: how it is billed, who is renting, which car, then the details. Everything after that happens inside the rental itself.',
    route: '/rentals',
    anchors: ['[data-tour="new-rental"]', ...LIST_HEADING],
    side: 'bottom',
    // The empty tab gets `rentals.empty.start` on this same button instead,
    // with copy that sends them to Vehicles first. Only one of the twins is
    // ever built.
    requires: { tab: 'rentals', edit: true, record: 'rentalId' },
    // Clicking it is the operator doing the thing. Stand aside.
    pauseOnAnchorClick: true,
    // On a lean tenant without a usable Stripe Connect account this button
    // opens a "connect Stripe" dialog INSTEAD of the flow, so the body must not
    // promise a form. Said only to the tenants it is true for.
    detail: (ctx) => (ctx.rentalCreationBlocked ? 'Connect payments first' : null),
  },
  {
    /**
     * The empty tab's last stop, and the twin of `rentals.new` rather than a
     * second visit to it.
     *
     * It ends the empty run because `pauseOnAnchorClick` steps the tour aside
     * so the operator can actually open the thing, and anything after it would
     * be a step they never reach.
     */
    id: 'rentals.empty.start',
    label: 'Start one',
    title: 'Where your first one starts',
    body: 'This is where one starts. Get a car and a customer in first, then come back — and the rest of this tour unlocks, inside the rental itself.',
    route: '/rentals',
    // The teaching card's own CTA first: on an empty tab it is the biggest
    // thing on the page, and it is the same handler as the header button. The
    // header button is the fallback for a tenant not shown that card — a filter
    // that matched nothing — and the heading is the last resort.
    anchors: [EMPTY_CTA, '[data-tour="new-rental"]', ...LIST_HEADING],
    side: 'top',
    // `edit` for the same reason `rentals.new` carries it: never spotlight a
    // mutation control for someone who is not allowed to use it. A view-only
    // manager on an empty tab keeps the three steps above this one.
    requires: { noRecord: 'rentalId', tab: 'rentals', edit: true },
    pauseOnAnchorClick: true,
    // Same gate as `rentals.new`, and the reason this body does not promise a
    // form: on a tenant without a usable Stripe Connect account both buttons
    // open the Connect dialog instead.
    detail: (ctx) => (ctx.rentalCreationBlocked ? 'Connect payments first' : null),
    notes: [
      // From the teaching card's own footnote, so the two cannot disagree.
      { text: 'You need both, though the rental flow can create either one inline as you go.' },
      { text: 'Once one rental exists, the tour button in the header relabels itself See what is inside.' },
    ],
  },
  {
    id: 'rentals.open',
    // The hinge. Last of the list steps on purpose, and no heading fallback
    // either: with no rows there is nothing to click, and pointing at the page
    // title while saying "click a row" would be a lie. On an empty tab it is
    // not merely unanchored but DROPPED — see `requires` below — because a
    // timeout here would also shorten the anchor budget for the rest of
    // `/rentals`, and it is the last step that could afford one.
    label: 'Open one',
    title: 'One row is one rental',
    body: 'Click any row to go inside. Nothing on the row says so, and inside is where the rest of the work actually happens.',
    route: '/rentals',
    anchors: [
      '[data-tour="rental-row"]',
      '[data-slot="sidebar-inset"] table tbody tr',
      '[data-slot="sidebar-inset"] table thead',
    ],
    // A row runs the full width of the content column, so neither side has room
    // for the card and `placeCard` would fall through to bottom anyway.
    side: 'bottom',
    // Without this the step has a perfectly valid route and no way to know its
    // anchor is never coming: the full anchor budget expires on a table that is
    // not there, and only then does it skip. See the header note.
    requires: { record: 'rentalId' },
  },
  {
    id: 'rentals.record',
    label: 'The record',
    title: 'The sidebar becomes the rental',
    body: 'Eight decisions, top to bottom. The first four are the rental itself; the last four are what comes out of it. Each row shows its answer once it has one.',
    route: '/rentals',
    routeFor: stageRoute(),
    anchors: ['[data-sidebar="sidebar"] [data-sidebar="content"]', '[data-sidebar="sidebar"]'],
    side: 'right',
    // On a phone the rail is an off-canvas Sheet with no rect, so there is
    // nothing to point at. The stage steps after this one fall back to the
    // panel title and still run.
    requires: { desktop: true, record: 'rentalId' },
    notes: [
      { text: 'Nothing here is a form you submit. The rental already exists; an edit lands as you make it.' },
      {
        text: 'All rentals, at the top, is the way back out.',
        anchors: ['[data-sidebar="sidebar"] a[href="/rentals"]'],
      },
      {
        // The aside is `hidden … xl:flex`, so this line is dropped rather than
        // shown on a narrow laptop where the rail is not on screen.
        text: 'Messages beside the rental is your thread with the customer. Activity is everything it has done.',
        anchors: ['[data-tour="rental-right-rail"]'],
      },
    ],
  },
  {
    id: 'rentals.vehicle',
    label: 'Vehicle',
    title: 'The car, and its mileage',
    body: 'Which car went out, and the mileage allowance this hire was sold on. Swapping the car here re-checks the dates and re-prices the rental.',
    route: '/rentals',
    routeFor: stageRoute('vehicle'),
    anchors: [rail('vehicle'), PANEL_TITLE],
    side: 'right',
    requires: { record: 'rentalId' },
  },
  {
    id: 'rentals.extras',
    label: 'Extras',
    title: 'Add-ons and other drivers',
    body: 'What rides along on top of the car. A second driver is a second name on the agreement and on the cover, and needs their own ID check.',
    route: '/rentals',
    routeFor: stageRoute('extras'),
    anchors: [rail('extras'), PANEL_TITLE],
    side: 'right',
    requires: { record: 'rentalId' },
  },
  {
    id: 'rentals.agreement',
    label: 'Agreement',
    title: 'The contract lives here',
    body: 'Send it for signature from the rental, and send it again whenever the terms move. It tells you itself when it no longer matches them.',
    route: '/rentals',
    routeFor: stageRoute('agreement'),
    anchors: [rail('agreement'), PANEL_TITLE],
    side: 'right',
    requires: { record: 'rentalId' },
  },
  {
    id: 'rentals.insurance',
    label: 'Insurance',
    title: 'Cover for these dates',
    body: 'Buy cover priced from this car and this hire, or record the policy the customer already holds and mark it checked. Either way it sits on the rental.',
    route: '/rentals',
    routeFor: stageRoute('insurance'),
    anchors: [rail('insurance'), PANEL_TITLE],
    side: 'right',
    requires: { record: 'rentalId' },
  },
  {
    id: 'rentals.payments',
    label: 'Payments',
    title: 'What is owed, and what is held',
    body: 'Outstanding is what is still to come in, with the charges and payments under it. The deposit sits apart, because a hold on a card is not money received.',
    route: '/rentals',
    routeFor: stageRoute('payments'),
    // The band, if the ledger has landed; this stage's own rail row if it has
    // not. The sentence is written to read correctly against either.
    anchors: ['[data-tour="rental-outstanding"]', rail('payments'), PANEL_TITLE],
    side: 'left',
    requires: { record: 'rentalId' },
  },
  {
    id: 'rentals.handover',
    label: 'Handover',
    title: 'Keys, photographs, odometer',
    body: 'Confirm the car went out, then confirm it came back. The photographs and readings on both halves are what damage and excess mileage get settled from.',
    route: '/rentals',
    routeFor: stageRoute('handover'),
    anchors: ['[data-tour="rental-handover-half"]', rail('handover'), PANEL_TITLE],
    side: 'left',
    requires: { record: 'rentalId' },
    notes: [
      // Both are conditional on the screen — damage needs photographs on both
      // halves, the lockbox needs the tenant to run lockboxes — so neither is
      // worth a stop, and both are worth a line.
      { text: 'With photographs on both sides it will compare them for you. Lockbox collection is set up here too.' },
    ],
  },
];

export const RENTALS_TAB_TOUR: TabTour = {
  id: 'rentals',
  label: 'Rentals',
  homeRoute: '/rentals',
  // Said when too few ANCHORED steps survive. No longer the empty-tab case —
  // that has four steps of its own — so in practice this is a permissions
  // shortfall: someone who cannot reach this list at all.
  emptyMessage:
    'There is nothing on your Rentals tab to walk through yet. Take a booking, or make one yourself, and I will show you around it.',
  steps: STEPS,
};
