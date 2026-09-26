/**
 * The Finances tab tour — one page for payments, bills, fines and plan
 * payments, walked top to bottom, and a shorter run for a tenant whose money
 * has not started moving yet.
 *
 * Finances is Payments, Invoices and Fines merged into one tab
 * (docs/FINANCES_DESIGN.md). It is CANARY-ONLY BY SLUG (`finances` in
 * `SLUG_ONLY_AREAS`, lib/v2.ts), so this tour sits beside the Payments tour
 * rather than replacing it: every other tenant still has `/payments`, and the
 * real v2 tenants among them still get that tab's button and its tour. The two
 * cannot collide — `tabTourForPath` matches on their different home routes,
 * and each page's launch button names its own tour.
 *
 * ---------------------------------------------------------------------------
 * THE WALK, in the order the page is drawn
 *
 *   header → Record payment → the overview (graph + what you are owed) → the
 *   filter button → Needs attention (only when there is something in it) →
 *   the four views → a row → its side panel
 *
 * Eight stops at most, inside the ten the tab tours allow. The page organises
 * money by the operator's four QUESTIONS — what did I charge and what is still
 * owed (Billed), what came in and where did it go (Received), what is due next
 * (Upcoming), and fines — so the views step says each question in a sentence
 * and stops there. Pointing at doors, not walking through them.
 *
 * Plain words only. Nothing in this file may say PAYG, installment or FIFO:
 * "plan payments", "put against what they owe", "pay by card".
 *
 * ---------------------------------------------------------------------------
 * ANCHORS — FIXED NAMES, shared with the components that draw them
 *
 * Every spotlight here is one of the `data-tour` names in `FINANCES_ANCHORS`
 * below, drawn by components/finances/** and the top bar's filter button
 * (through `usePageSearch({ filters: { tourAnchor } })`). They are agreed
 * names, not selectors describing today's layout, so the page can be
 * rearranged without breaking the tour as long as the attributes travel.
 *
 * `finances-header` is the floor under every step. It is the title block, drawn
 * on every state of the page — loading, failed, empty, full — so no step can
 * wait out `ANCHOR_WAIT_MS`, and no timeout can cascade the short budget onto
 * the steps behind it (every step here is on one route, so one stall would
 * starve the rest of the run).
 *
 * The ONE anchor that is not a fixed name is the teaching empty state's
 * headline on the empty run (`EMPTY_HEADLINE`). It is the same element the
 * empty guard reads (`FINANCES_EMPTY_STATE`), so a step built because that
 * card is up is also pointed at that card: the two cannot disagree.
 *
 * ---------------------------------------------------------------------------
 * TWO RUNS IN ONE LIST
 *
 * There is no `/finances/<id>`, so the record guards (`requires.record`) have
 * nothing to key on; `tabHasData` / `tabIsEmpty: 'finances'` do, from
 * `readEmptyTabs()`. What "empty" means here is narrower than it sounds, and
 * the copy is written for it — see `FINANCES_EMPTY_STATE`:
 *
 *   EMPTY  header · overview · the views · "nothing has moved yet" · Record
 *          payment (last, so the tour steps aside on it)
 *   FULL   header · Record payment · overview · filter · the views · a row ·
 *          its side panel
 *
 * Either run also stops at Needs attention, after the overview, when that
 * section is on screen at launch. A view-only manager loses the two Record
 * payment steps and keeps at least three anchored stops either way.
 *
 * `emptyTabs` fails CLOSED to "not empty": if the DOM read throws, the full
 * run builds, and every step in it still lands on something the page draws
 * with no rows (the list, then the header).
 *
 * ---------------------------------------------------------------------------
 * NEEDS ATTENTION is drawn only when it holds something, so its step is
 * guarded on the section itself: `readEmptyTabs()` reports
 * `FINANCES_ATTENTION_SECTION` when the section is absent, and
 * `requires.tabHasData` drops the step at launch. It deliberately has NO
 * fallback anchor: a card saying "what needs you" pointed at the page title
 * would be pointing at nothing that needs anybody.
 *
 * ---------------------------------------------------------------------------
 * THE ROW AND THE SIDE PANEL, and why both step aside when clicked
 *
 * Clicking a row opens its side panel — a modal sheet. A coach mark carrying on
 * over a sheet the operator just opened is in the way, so both steps use
 * `pauseOnAnchorClick`: the tour steps aside and the operator meets the panel
 * itself, which is the pattern every tab tour uses for its "do this" buttons.
 *
 * The row step could instead advance on the click and let the panel step
 * spotlight the panel as it opens, but the panel opens behind a router
 * round-trip (it is `?panel=` in the URL) and the next step resolves its anchor
 * at once — it would land on its fallback, under a sheet sliding in on top.
 * So the panel step reached by Next points at the LIST (the spotlight moves
 * from one row to the table, rather than sitting still through two cards) and
 * names the panel in words. `finances-side-panel` stays first in its anchors
 * for the one case where a panel is already open when the step comes up.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY LEFT OUT
 *
 *  - EXPORT and SEND A PAYMENT LINK, the header's icons. Both explain
 *    themselves in their tooltips; the link one opens the same window as
 *    Record payment, which the record step's note names.
 *  - The FILTER PANEL's sections one by one (Show / Status / Method / Period).
 *    The filter step names what is in there; opening it is the lesson.
 *  - The bill TIE-OUT ("Doesn't add up by $X"), refunds, approve / reject and
 *    the plan's actions. Second-visit material, and every one of them is
 *    explained where it is drawn — in the row or its panel.
 *  - Payment analytics and fine analytics. Neither is linked from this page.
 */

import type { TourStep } from '@/lib/first-rental-tour';
import type { TabTour } from './index';

/**
 * The anchor names this tour points at, agreed with the Finances components.
 * Changing one here means changing the component that draws it.
 */
export const FINANCES_ANCHORS = [
  /** The page title block. Drawn in every state — the floor under every step. */
  'finances-header',
  /** The "Record payment" header button (payments editors only). */
  'finances-record-payment',
  /** The hero row / overview flip: the Collected graph and the owed card. */
  'finances-overview',
  /** The filter button in the top bar's search field; it turns the overview over. */
  'finances-filter',
  /** Needs attention — rendered only when non-empty. */
  'finances-attention',
  /** The Billed · Received · Upcoming · Fines switch (not drawn for one view). */
  'finances-views',
  /** The current view's table. */
  'finances-list',
  /** The first data row of the current view's table. */
  'finances-row',
  /** The side panel's sheet content (only while a panel is open). */
  'finances-side-panel',
] as const;

export type FinancesAnchor = (typeof FINANCES_ANCHORS)[number];

const at = (name: FinancesAnchor) => `[data-tour="${name}"]`;

const HEADER = at('finances-header');
const RECORD = at('finances-record-payment');
const OVERVIEW = at('finances-overview');
const FILTER = at('finances-filter');
const ATTENTION = at('finances-attention');
const VIEWS = at('finances-views');
const LIST = at('finances-list');
const ROW = at('finances-row');
const SIDE_PANEL = at('finances-side-panel');

/**
 * The teaching empty state of the two views that say "no money yet": Billed
 * and Received.
 *
 * Scoped by the page's own `data-finances-view`, which carries the view on
 * screen, so Upcoming (empty on most accounts until payment plans are live) and
 * Fines (empty on most accounts, full stop) never make a busy tenant look new.
 * `SettingsEmptyState` stamps `data-settings-state="empty"` on its root; the
 * no-match, loading and error states carry other values, so a list FILTERED to
 * nothing is correctly not empty.
 *
 * WHAT THIS SIGNAL CAN AND CANNOT SAY. The lists open on THIS MONTH
 * (`DEFAULT_PERIOD` in components/finances/finances-url.ts), and the page shows
 * its teaching state whenever that default window is empty. So it reads
 * "nothing charged or paid this month": every brand-new tenant, and for a day
 * or two a quiet one at the turn of a month. `finances.empty.what` is written
 * to be true for both. A lifetime-empty marker, `data-tour="finances-empty"`,
 * is also honoured (`EMPTY_SIGNALS` in ./index) if the page ever draws one.
 *
 * Declared here and imported by ./index, never the other way round: index
 * evaluates this module while it is still importing it, so a value this file
 * read from index at load time would not exist yet.
 */
export const FINANCES_EMPTY_STATE = [
  '[data-finances-view="billed"] [data-settings-state="empty"]',
  '[data-finances-view="received"] [data-settings-state="empty"]',
] as const;

/**
 * That card's headline, never the card. The card runs the width of the content
 * column, so a spotlight on it has nowhere to stand the tour card and degrades
 * to a centred wash. `h3` is what `SettingsEmptyState` renders its headline
 * as, scoped to the card, so it can match nothing else on the page.
 */
const EMPTY_HEADLINE = FINANCES_EMPTY_STATE.map((card) => `${card} h3`).join(', ');

/**
 * The key `readEmptyTabs()` reports while Needs attention is NOT on screen.
 * Dotted, so it can never be mistaken for a tab id. See `OPTIONAL_SECTIONS` in
 * ./index.
 */
export const FINANCES_ATTENTION_SECTION = 'finances.attention';

const STEPS: readonly TourStep[] = [
  {
    // The opener, and anchored rather than a centred card: the title block is
    // "the header", and it is the one thing every state of this page draws.
    id: 'finances.header',
    label: 'Finances',
    title: 'All your money, in one place',
    body: 'What you charged, what came in, what is due next, and fines, all on one page. I will show you where each answer lives.',
    route: '/finances',
    anchors: [HEADER],
    side: 'bottom',
    showOutline: true,
  },
  {
    // Early, because it is the page's one labelled button, and it steps aside
    // when clicked so the operator meets the payment window itself — the same
    // trade the Customers tour makes on its Add button. The empty run gets
    // `finances.empty.record` at the END instead, with copy for an account
    // that has nothing to record yet.
    id: 'finances.record',
    label: 'Record a payment',
    title: 'Money that came in elsewhere',
    body: 'Cash in hand or a bank transfer: record it here and it is put against what the customer owes. Card payments from your booking site arrive on their own.',
    route: '/finances',
    anchors: [RECORD, HEADER],
    side: 'bottom',
    // `edit` because the button is drawn on `canEdit('payments')` and a step
    // never spotlights a money control for someone who cannot use it.
    requires: { tab: 'payments', edit: true, tabHasData: 'finances' },
    pauseOnAnchorClick: true,
    notes: [
      {
        // Anchored on the button, so it is only said where the button is.
        text: 'The same window can also email the customer a link to pay by card.',
        anchors: [RECORD],
      },
    ],
  },
  {
    // Shared by both runs: at zero the graph is flat and the card says
    // nothing is owed, which is exactly what the sentence describes.
    id: 'finances.overview',
    label: 'The overview',
    title: 'What came in, and what is owed',
    body: 'The graph is money you collected over the period you pick, after refunds. The card beside it is what customers still owe you, and how late it is.',
    route: '/finances',
    anchors: [OVERVIEW, HEADER],
    side: 'bottom',
  },
  {
    id: 'finances.filter',
    label: 'Search and filter',
    // The list opens on this month, so "where is last month's payment" has
    // this answer and no other. Said first, before what the panel holds.
    title: 'Finding the one you want',
    body: 'The list opens on this month. The filter button turns the graph over to pick another period, a status, or how it was paid. Its badge means some are hidden.',
    route: '/finances',
    // The button lives in the top bar's search field, which a phone does not
    // draw; the header is the floor, and the body still names the button.
    anchors: [FILTER, HEADER],
    side: 'bottom',
    // Narrowing an empty list teaches nothing. The empty run's own step points
    // at the same button in a note, for the quiet-month case.
    requires: { tabHasData: 'finances' },
    notes: [
      {
        text: 'The search beside it finds a customer, a rental, a car, or a Stripe or Square reference.',
        anchors: [FILTER],
      },
    ],
  },
  {
    // Built only when the section is on screen at launch — see the header.
    // No fallback anchor on purpose.
    id: 'finances.attention',
    label: 'Needs attention',
    title: 'What needs you',
    body: 'A declined card, a payment waiting for your check, a possible double charge, or credit not yet used. Each says what happened and carries its own fix.',
    route: '/finances',
    anchors: [ATTENTION],
    side: 'bottom',
    requires: { tabHasData: FINANCES_ATTENTION_SECTION },
  },
  {
    // The four questions the page is organised by. A manager who holds only
    // one of the three money grants gets no switch (one view needs none); the
    // spotlight then lands on the list, and the sentence is still true.
    id: 'finances.views',
    label: 'The four views',
    title: 'Four questions, four views',
    body: 'Billed: what you charged and what is still owed. Received: money that came in, and where it went. Upcoming: plan payments still to come. Fines: tolls and tickets.',
    route: '/finances',
    anchors: [VIEWS, LIST, HEADER],
    side: 'bottom',
  },
  {
    /**
     * The empty run's middle, after the views have been named. Pointed at the
     * teaching card's headline (the same element the guard read), then the
     * list, then the header — NOT the view switch, which the step before this
     * one already spotlit: a spotlight that does not move through two cards
     * reads as a stuck tour.
     *
     * The body has to be true for two readers — see `FINANCES_EMPTY_STATE`: a
     * tenant who has never taken money, and a busy one on the first day of a
     * quiet month. It says "this month" and the note offers the way out.
     */
    id: 'finances.empty.what',
    label: 'Nothing yet',
    title: 'Nothing has moved yet',
    body: 'The list opens on this month, and nothing has been charged or paid in it. On a new account that is normal: every booking fills this in on its own.',
    route: '/finances',
    anchors: [EMPTY_HEADLINE, LIST, HEADER],
    side: 'bottom',
    requires: { tabIsEmpty: 'finances' },
    notes: [
      {
        text: 'Had money before this month? The filter button in the search box shows other periods.',
        anchors: [FILTER],
      },
    ],
  },
  {
    id: 'finances.row',
    label: 'A row',
    title: 'One row, one piece of money',
    body: 'Each row is one bill or one payment: who, which rental, how much, and where it stands in plain words, such as Paid, Open or 12 days overdue.',
    route: '/finances',
    // The row, then the table, then the header. The last two only answer if
    // the list was filtered to nothing after launch; the body describes what a
    // row HOLDS, so it teaches the same thing wherever the spotlight lands.
    anchors: [ROW, LIST, HEADER],
    side: 'bottom',
    requires: { tabHasData: 'finances' },
    // Clicking the row opens its side panel — a modal sheet — so the tour
    // steps aside rather than sitting on top of it. See the header.
    pauseOnAnchorClick: true,
  },
  {
    id: 'finances.panel',
    label: 'Side panel',
    title: 'The whole story of that money',
    body: 'Open any row for its side panel: every charge, each payment that paid it off, what is left, and for a card payment, its Stripe reference.',
    route: '/finances',
    // The panel when one is already open; otherwise the TABLE, not the row the
    // step before spotlit. Written to read true on either.
    anchors: [SIDE_PANEL, LIST, HEADER],
    // The sheet stands at the right edge, so the card goes to its left.
    // `placementsFor` falls through when the list is the anchor.
    side: 'left',
    requires: { tabHasData: 'finances' },
    // A click inside the list opens a row's panel: step aside for it.
    pauseOnAnchorClick: true,
  },
  {
    /**
     * The empty run's last stop, and the twin of `finances.record` — only one
     * of the two is ever built. Last because it steps aside when clicked.
     *
     * An account with no money yet has nothing to record, so this does not
     * invent a chore: it says what the button is FOR, and that the rest of the
     * tour opens up once money moves — which is what happens: a taken empty
     * tour reads as unseen again once the tab has data, and the launch button
     * relabels itself "See what is inside".
     */
    id: 'finances.empty.record',
    label: 'Record a payment',
    title: 'For money that came in elsewhere',
    body: 'Cash in hand, or a transfer to your bank, whenever one turns up. Nothing to record today, and once money starts moving the rest of this tour opens up.',
    route: '/finances',
    anchors: [RECORD, HEADER],
    side: 'bottom',
    requires: { tabIsEmpty: 'finances', tab: 'payments', edit: true },
    pauseOnAnchorClick: true,
  },
];

export const FINANCES_TAB_TOUR: TabTour = {
  id: 'finances',
  label: 'Finances',
  homeRoute: '/finances',
  // Said when fewer than `MIN_TOUR_STOPS` anchored steps survive. Both runs
  // keep at least three anchored steps with no permission on them at all, so
  // in practice this is someone who cannot open `/finances` in the first place.
  emptyMessage:
    'There is not enough on your Finances tab to walk through yet. Take a payment, or record one yourself, and I will show you around it.',
  steps: STEPS,
};
