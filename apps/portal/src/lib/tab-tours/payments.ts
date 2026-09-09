/**
 * The Payments tab tour — one list, two runs, and no record to walk into.
 *
 * ---------------------------------------------------------------------------
 * SIGNPOST: THE FINANCES MERGE. READ THIS BEFORE MOVING ANYTHING.
 *
 * Payments, Invoices and Fines are being merged into ONE tab called "finances",
 * and the team lead is building it himself. When `/finances` lands, this tour
 * needs its `homeRoute` and its `label` revisited — `homeRoute` is what
 * `tabTourForPath` matches on and what the launch button renders under, so a
 * tour still pointing at `/payments` simply stops appearing. The `route` on
 * every step below needs the same one-line change.
 *
 * Nothing here tries to pre-empt that merge. What it does do is keep the cost
 * of it small: every anchor is a `payments-` prefixed `data-tour` attribute on
 * a payments-owned component — the summary cards, the filter bar, the rows —
 * rather than a selector describing where those things sit on today's page. If
 * the Payments screen becomes a section of Finances with its markup intact, the
 * anchors travel with it and only the routes change.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TOUR IS FLAT, WHEN THE OTHER THREE GO INSIDE A RECORD
 *
 * Rule 3 of the tab tours is "into the record, not just the list", because that
 * is where the unguessable things live. Payments has no record: there is no
 * `/payments/<id>` route at all. A row's menu leads OUT of this tab — to the
 * rental's ledger or the customer's payments — and following it would hand the
 * operator to a screen the Rentals and Customers tours already own.
 *
 * So there are no `routeFor` steps. Everything is list-level, and that is the
 * honest shape of this tab rather than a shortfall.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ID-BASED GUARDS ARE UNUSABLE HERE, AND WHAT IS USED INSTEAD
 *
 * `requires.record` and `requires.noRecord` cannot tell the truth on this tab.
 * `readSampleIds()` reads ids out of hrefs and `data-record-id` markers on the
 * page the operator is looking at, and on `/payments` there are NONE: the
 * customer, vehicle and rental cells are all `<button onClick={router.push}>`
 * and `<Badge onClick>`, which emit no href. So `sampleIds` is all-null here on
 * every account, busy or bare — `requires.record` would drop every step
 * carrying it even on a tenant with a thousand payments, and `requires.noRecord`
 * would keep every empty-tab step regardless of whether the table has rows.
 *
 * `requires.tabHasData` and `requires.tabIsEmpty` are the pair that CAN. They
 * name a TAB ('payments'), not a field, and `stepAllowed` resolves them from
 * `ctx.emptyTabs`, which `launch()` fills from `readEmptyTabs()` — a DOM read
 * for `[data-tour="<tab>-empty"]`, the marker every teaching empty state
 * carries. The page itself has already answered the question: it swaps its
 * table for `PaymentsTeachingEmptyState` when `lifetimePayments === 0`, and the
 * presence of that card IS the signal. No query, and the same element the empty
 * steps point at — so a step guarded on emptiness and a step anchored to the
 * empty card can never disagree.
 *
 * So this list serves BOTH states and `buildTour` picks the half that applies:
 *
 *  - `tabHasData` on the five steps that describe things only a populated table
 *    draws — the Method and Status values a row carries, the row itself, its
 *    actions menu, and the Record Payment step that the empty run twins.
 *  - `tabIsEmpty` on three steps written for the tenant this whole feature is
 *    about: what will land here, that card payments post themselves, and where
 *    money taken some other way goes. That last one is NOT a chore list. A new
 *    operator with no rentals has no payment to record, and telling them to go
 *    and record one would be nonsense — so it is framed as the door for the
 *    cash and the bank transfer, whenever one turns up, and it says the rest
 *    opens up once payments start arriving on their own.
 *
 * "Empty" here means THE TEACHING CARD IS UP, which is narrower than "no rows".
 * A list filtered down to nothing keeps the ordinary "No payments found" state
 * and is correctly NOT empty: someone who has filtered their payments to zero
 * is not a beginner and gets the real tour. Nothing below may assume otherwise.
 *
 * `emptyTabs` also fails CLOSED, to "not known" = not empty: if the DOM read
 * throws, the full run is what builds. That is why the row steps keep their
 * zero-payment fallbacks below rather than relying on the guard alone.
 *
 * ---------------------------------------------------------------------------
 * THE ANCHOR RULE THAT SITS UNDER THOSE GUARDS — this one is load-bearing
 *
 * The guards above decide which steps are OFFERED; the anchors decide whether a
 * step that IS offered can stall. Both are needed. A step pointing only at a
 * table row would wait out the full `ANCHOR_WAIT_MS` on a tab with no rows and
 * then skip — and the budget CASCADES: once one step on a route times out,
 * every later step on that same route gets 1500ms instead of 6000. Every step
 * in this file sits on one route, so a single stall would starve the whole back
 * half of whichever run is playing.
 *
 * So EVERY step ends its anchor list on something the page draws with zero
 * payments in it: a stat tile (the cards render at 0, not "not at all"), a
 * filter control (the bar is unconditional), or the page title. `findAnchor`
 * walks the list in order and returns the first VISIBLE match, so a missing row
 * anchor costs a fall-through and not a timeout. Nothing in this tour can time
 * out, which means nothing in it can starve anything else.
 *
 * The two row-level steps — `payments.row` and `payments.actions` — are now
 * guarded off the empty tab entirely, so their usual audience has rows on
 * screen. They keep their fallbacks for the two states the guard does not
 * cover: a filter that matched nothing, and a failed emptiness read. Their
 * bodies describe what a row HOLDS, which teaches the same thing wherever the
 * spotlight lands. The details that only make sense with rows on screen (the
 * per-row rate line, the approve/reject pair) are carried as NOTES with their
 * own anchors, and a note whose anchor is absent is dropped rather than shown —
 * so nobody is ever told about a tick they cannot see.
 *
 * ---------------------------------------------------------------------------
 * "AUTO-APPROVED", which is the one word on this screen nobody can guess
 *
 * It is not a setting and not a queue. `payments.verification_status` DEFAULTS
 * to `auto_approved` in the schema, and every Stripe-settled write sets it
 * explicitly — `create-upfront-checkout`, `create-preauth-checkout` (whose own
 * comment reads "Stripe verified payment") and the webhook handlers. A payment
 * a staff member enters by hand through the Record Payment dialog is written as
 * `approved`; one that a human ticked off on the row becomes `approved` through
 * `approve_payment`. Unpaid checkout links sit at `pending`.
 *
 * So the sentence is: the card cleared through Stripe on its own and nobody
 * here had to check it. `payments.status` says exactly that and nothing more.
 *
 * ---------------------------------------------------------------------------
 * A NOTE ON THE SEARCH BOX, so the copy is not accidentally a lie
 *
 * Its placeholder reads "Search customer or vehicle...", but it writes to
 * `customerSearch` alone, and `use-payments-data` turns that into
 * `.ilike("customers.name", …)`. `vehicleSearch` is only ever populated from a
 * `?vehicle=` URL parameter — no control on the page sets it. `payments.search`
 * therefore promises customer names only. If the box is ever widened to match a
 * registration, that body can widen with it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY LEFT OUT — and this is what did not fit
 *
 *  - The ANALYTICS PAGE itself. It rides as a note on the export step. It is a
 *    read-only month view (daily takings, method split, amount distribution,
 *    approval rate) and sending a first-timer off this tab to look at charts of
 *    a month they have not had yet teaches nothing.
 *  - SORTING and PAGINATION. Date, Customer and Amount headers sort on click,
 *    and the footer pages 25 at a time. Both are discoverable by looking, which
 *    is the test for leaving something out.
 *  - The VEHICLE and RENTAL columns, beyond one clause in `payments.row`. Both
 *    are links into tabs that have tours of their own.
 *  - The full REJECT dialog. Rejecting a pending payment closes the entire
 *    rental — ends it today, frees the vehicle, writes off outstanding charges
 *    and emails the customer. That blast radius is named in a note on
 *    `payments.actions` and then left to the dialog, which explains itself at
 *    length and is the right place for it.
 *  - REMOVE PAYMENT LINK vs REVERSE PAYMENT, past naming both. Which one a row
 *    offers depends on whether money ever moved, and the menu only shows the
 *    one that applies, so a first pass does not need the rule behind it.
 *  - The VOIDED and REVERSED badges, INITIAL FEE vs CUSTOMER PAYMENT, and
 *    partial refunds. Second-visit material; the Type column is named and the
 *    row step says what it is for.
 *  - RECORDING a payment, as opposed to finding the button. `payments.record`
 *    steps aside when the button is clicked so the operator meets the form
 *    itself, which is the pattern every one of these tours uses.
 */

import type { TourStep } from '@/lib/first-rental-tour';
import type { TabTour } from './index';

/**
 * The page title, and the universal last resort under every step here.
 *
 * `/payments` is a shared v1 page — a plain `container` div inside the layout's
 * inset — so there is no rail, no panel title and no record chrome to fall back
 * on. Under the canary's v2 chrome the inset is a `<main data-slot=
 * "sidebar-inset">`, and `main h1` covers the same element if that slot is ever
 * renamed.
 */
const LIST_HEADING = ['[data-slot="sidebar-inset"] h1', 'main h1'] as const;

/**
 * The teaching card's payoff list, which stands where the table does on a tab
 * with no payments yet. The LIST and never the card: that card runs the full
 * width of the content column and is around 450px tall, so a spotlight on it
 * has nowhere to stand the tour card and degrades to a centred wash that points
 * at nothing.
 *
 * Canary-only, and not drawn when a FILTER matched nothing (that branch keeps
 * the "No payments found" state), so `LIST_HEADING` still sits underneath it.
 */
const EMPTY_POINTS = '[data-tour="payments-empty-points"]';

/**
 * The teaching card's headline, so the two empty steps that stand in front of
 * that card do not spotlight the SAME element twice running. A spotlight that
 * does not move through two cards reads as a stuck tour — the note on
 * `payments.actions` says the same thing about sharing `EMPTY_POINTS`.
 *
 * `h3` is what `TeachingEmptyState` renders its headline as, and it is scoped
 * to the card, so it can match nothing else on the page.
 */
const EMPTY_HEADLINE = '[data-tour="payments-empty"] h3';

/**
 * The teaching card's own CTA. It is the FIRST button inside that card whenever
 * the card is drawn at all, it runs the same `setShowAddDialog(true)` handler as
 * the header button, and it is drawn on exactly the `canEdit('payments')` the
 * step that points at it already requires.
 */
const EMPTY_CTA = '[data-tour="payments-empty"] button';

const STEPS: readonly TourStep[] = [
  {
    id: 'payments.welcome',
    label: 'Welcome',
    title: 'Every payment, in one place',
    body: 'Card payments from your booking site post themselves here, and you enter cash and bank transfers yourself. Let me show you how to find any of them.',
    route: '/payments',
    anchors: [],
    side: 'center',
    showOutline: true,
  },
  /**
   * ---------------------------------------------------------------------
   * THE EMPTY TAB. Two steps here and a third at the end, offered only while
   * the teaching card is standing where the table goes, and dropped the
   * moment a payment exists. See the header note.
   */
  {
    id: 'payments.empty.what',
    label: 'What lands here',
    title: 'What this page will hold',
    body: 'Once money starts moving, every card charge, refund, deposit and cash entry lands here in one ledger. Nothing is missing today — none of it has happened yet.',
    route: '/payments',
    // The headline, never the card: that card runs the full width of the
    // content column and is around 450px tall, so a spotlight on it has
    // nowhere to stand the tour card and degrades to a centred wash.
    anchors: [EMPTY_HEADLINE, ...LIST_HEADING],
    // `left` first: the card then sits in the gap between the sidebar and the
    // teaching state rather than over the button inside it. `placementsFor`
    // falls through to right, bottom and top on a narrower window.
    side: 'left',
    requires: { tabIsEmpty: 'payments' },
  },
  {
    id: 'payments.empty.arrive',
    // The step this tab needs most, and the one an empty ledger makes easy to
    // get wrong. An empty Payments tab is not a backlog: the card side of it
    // fills itself, and the only work here is the money that never touched
    // Stripe. Said against the payoff list, which makes the same promise.
    label: 'How they arrive',
    title: 'Card payments post themselves',
    body: 'A card payment from your booking site writes itself here the moment it clears, with nothing for you to do. Cash and transfers are the ones you enter.',
    route: '/payments',
    anchors: [EMPTY_POINTS, ...LIST_HEADING],
    side: 'left',
    requires: { tabIsEmpty: 'payments' },
  },
  {
    id: 'payments.money-in',
    label: 'The totals',
    // The two facts an operator gets wrong about these tiles: that they follow
    // the filters (they do not — `payment-summary-cards` runs its own query on
    // today and the calendar month), and that they count everything with an
    // amount on it (they do not either — `sumReceived` drops voided rows,
    // unpaid links and uncaptured holds, which is the fix that stopped this
    // card reporting $1,101.25 for a month that took $751.25).
    title: 'Today, and the month so far',
    body: 'These two ignore the filters underneath them, and count only money you have actually received — an unpaid link or a reversed payment never lifts them.',
    route: '/payments',
    anchors: [
      '[data-tour="payments-stat-today"]',
      '[data-tour="payments-stat-month"]',
      ...LIST_HEADING,
    ],
    side: 'bottom',
    notes: [
      {
        text: 'Payment Count is how many landed this month, not how many rows the list is showing.',
        anchors: ['[data-tour="payments-stat-count"]'],
      },
    ],
  },
  {
    id: 'payments.period',
    label: 'Period',
    // First filter step on purpose. The page mounts with `quickFilter:
    // 'thisMonth'` and a date range already applied, so the single most common
    // first-day question — "where is the payment I took last month" — has this
    // answer and no other.
    title: 'The list opens on this month',
    body: 'So a payment from before it is not missing, it is outside the window. All Time drops the dates and shows you everything you have ever taken.',
    route: '/payments',
    anchors: ['[data-tour="payments-period"]', ...LIST_HEADING],
    side: 'bottom',
  },
  {
    id: 'payments.search',
    label: 'Search',
    title: 'Finding one payment',
    body: 'Type any part of a customer name and the list narrows to them. It matches the name on the payment, so a first name is usually enough.',
    route: '/payments',
    anchors: ['[data-tour="payments-search"]', ...LIST_HEADING],
    side: 'bottom',
  },
  {
    id: 'payments.method',
    label: 'Method',
    title: 'How the money arrived',
    body: 'Cash, card or bank transfer, matching the Method column on each row. Card comes in on its own; cash and transfers are the ones you enter here.',
    route: '/payments',
    anchors: ['[data-tour="payments-method"]', ...LIST_HEADING],
    side: 'bottom',
    // The control is on screen with no payments in it, but the sentence is
    // about a column on a row. `payments.empty.arrive` makes the half of this
    // that matters on day one — card arrives by itself, cash you enter — to
    // the operator who has neither yet.
    requires: { tabHasData: 'payments' },
  },
  {
    id: 'payments.status',
    label: 'Status',
    // The one word on this screen a new operator cannot infer. See the header
    // note for where `auto_approved` is actually written.
    title: 'What Auto-Approved means',
    body: 'The card cleared through Stripe on its own, with nobody here checking it. Approved is one your staff passed by hand, and Pending Review is still waiting.',
    route: '/payments',
    anchors: ['[data-tour="payments-status"]', ...LIST_HEADING],
    side: 'bottom',
    // Three words for a badge nobody has seen yet. Worth a stop the moment
    // there is a row wearing one, and noise before that.
    requires: { tabHasData: 'payments' },
  },
  {
    id: 'payments.dates',
    label: 'Dates',
    title: 'An exact window',
    body: 'The calendar sets a from and a to date of your own, for the quarter or the fortnight your accountant asked about. Clear dates puts it back.',
    route: '/payments',
    anchors: ['[data-tour="payments-dates"]', ...LIST_HEADING],
    side: 'bottom',
  },
  {
    id: 'payments.row',
    label: 'A payment',
    // Row first, then the Type header, then the empty card. The body describes
    // what a row HOLDS, so it teaches the same thing against any of them.
    title: 'What a row tells you',
    body: 'One payment: who paid, the car and the rental it belongs to, what it was for under Type, and how it reached you under Method.',
    route: '/payments',
    anchors: [
      '[data-tour="payment-row"]',
      '[data-tour="payments-type-column"]',
      // Only reachable now if the emptiness read FAILED — `readEmptyTabs`
      // returns [] on a DOM that refuses to be queried, and this step is then
      // built on a tab whose table has been replaced by that card. Kept for
      // exactly that, and it costs nothing when the guard did its job.
      EMPTY_POINTS,
      ...LIST_HEADING,
    ],
    side: 'bottom',
    // A row is the one thing an empty tab does not have. The empty run says
    // what will land here instead, and never narrates a table that is not
    // drawn — which is the bug this guard exists to close.
    requires: { tabHasData: 'payments' },
    notes: [
      {
        // Only meaningful with a row on screen, and the line itself only
        // renders where the rental has a rate to quote — so it is a note with
        // its own anchor, and it drops rather than describing thin air.
        text: 'Under the amount is the agreed rate it came from — the weekly or monthly figure, and how many.',
        anchors: ['[data-tour="payments-rate"]'],
      },
    ],
  },
  {
    id: 'payments.actions',
    label: 'Row menu',
    title: 'What you can do to one',
    body: 'The menu at the end of a row opens the ledger this payment posted to. A link nobody paid can be removed there, and a cash entry made in error reversed.',
    route: '/payments',
    // Still no `EMPTY_POINTS` here, though the step above keeps one. In the
    // failed-read path both would resolve to that same list and the spotlight
    // would sit still through two cards, which reads as a stuck tour. The
    // heading is the honest fallback: nothing on a page without rows is a row
    // menu, and the body still teaches what one will hold.
    anchors: [
      '[data-tour="payments-row-actions"]',
      '[data-tour="payments-actions-column"]',
      ...LIST_HEADING,
    ],
    // The actions cell is the last column, hard against the right edge, so the
    // card stands to its left.
    side: 'left',
    requires: { tabHasData: 'payments' },
    notes: [
      {
        // The warning is worth its 100 characters: reject does not reject a
        // payment, it closes the rental. Anchored to a row so it is only said
        // where those two buttons can actually be seen.
        text: 'The tick and cross on a pending row approve or reject it — and rejecting closes the whole rental.',
        anchors: ['[data-tour="payment-row"]'],
      },
    ],
  },
  {
    id: 'payments.export',
    label: 'Export',
    title: 'Taking the numbers out',
    body: 'This downloads what you are looking at as a spreadsheet. Your filters come with it, so set the period you want before you press it.',
    route: '/payments',
    anchors: ['[data-tour="payments-export"]', ...LIST_HEADING],
    side: 'bottom',
    notes: [
      {
        text: 'The chart button beside it plots this month: daily takings, the method split, and approvals.',
        anchors: ['[data-tour="payments-analytics"]'],
      },
    ],
  },
  {
    id: 'payments.record',
    label: 'Record a payment',
    // Last, and it steps aside when clicked: the operator meets the form
    // instead of the tour sitting on top of it. Same pattern as the Add steps
    // in the other three tours.
    title: 'Money that came in elsewhere',
    body: 'Cash in hand, or a transfer straight to your bank. Record it here and your ledger matches your account, with the rental settled against it.',
    route: '/payments',
    anchors: ['[data-tour="payments-record"]', ...LIST_HEADING],
    side: 'bottom',
    // A viewer-role manager does not get the button, and the other anchored
    // steps still clear MIN_TOUR_STOPS without it.
    //
    // `tabHasData` is here for a different reason than on the four steps
    // above: nothing in this body describes a row. It is the guard that keeps
    // the TWIN below from being built alongside it, since two steps pointing
    // at one button in a single run is a repeat, not a tour.
    requires: { tab: 'payments', edit: true, tabHasData: 'payments' },
    pauseOnAnchorClick: true,
  },
  {
    /**
     * The empty run's last stop, and the twin of `payments.record` rather than
     * a second visit to it — only one of the two is ever built.
     *
     * It ENDS that run because `pauseOnAnchorClick` steps the tour aside so the
     * operator can meet the form itself, and anything after it would be a step
     * they never reach.
     *
     * The framing is the whole point. A brand-new operator has no rentals, so
     * they have no payment to record, and a step that told them to record one
     * would be inventing a chore. This says what the button is FOR — the money
     * that reached you some other way — and then says the rest opens up on its
     * own, which is exactly what happens: `hasTakenTabTour` treats a taken
     * empty tour as unseen again once the tab has data, and the launch button
     * re-brightens and relabels itself "See what is inside".
     */
    id: 'payments.empty.record',
    label: 'Record a payment',
    title: 'For money that came in elsewhere',
    body: 'Cash in hand, or a transfer to your bank, whenever one turns up. Nothing to record today — and once payments start arriving, the rest of this tour opens up.',
    route: '/payments',
    // The teaching card's own CTA first: on an empty tab it is the biggest
    // thing on the page, and it is the same handler as the header button. The
    // header button is the fallback for a tenant not shown that card, and the
    // heading is the last resort.
    anchors: [EMPTY_CTA, '[data-tour="payments-record"]', ...LIST_HEADING],
    side: 'top',
    // `edit` for the same reason `payments.record` carries it: never spotlight
    // a mutation control for someone who is not allowed to use it. A view-only
    // manager on an empty tab keeps the two empty steps above this one, and
    // every filter step, so the run still clears MIN_TOUR_STOPS.
    requires: { tabIsEmpty: 'payments', tab: 'payments', edit: true },
    pauseOnAnchorClick: true,
    notes: [
      {
        // Anchored on the button it describes, so it is never promised to
        // someone rendering a header that does not carry one.
        text: 'When the first one lands, the tour button in the header relabels itself See what is inside.',
        anchors: ['[data-tour="take-tab-tour"]'],
      },
    ],
  },
];

export const PAYMENTS_TAB_TOUR: TabTour = {
  id: 'payments',
  label: 'Payments',
  homeRoute: '/payments',
  // Said when too few ANCHORED steps survive. Still not the empty-tab case: an
  // empty tab now builds its own run, and every step in either run anchors on
  // something the page draws with no payments in it. So in practice this is a
  // permissions shortfall: someone who cannot reach this list at all.
  emptyMessage:
    'There is not enough on your Payments tab to walk through yet. Take a payment, or record one yourself, and I will show you around it.',
  steps: STEPS,
};
