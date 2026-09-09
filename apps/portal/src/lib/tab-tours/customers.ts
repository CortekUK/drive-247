/**
 * The Customers tab tour — the list, then one person's record.
 *
 * WHAT GHULAM ASKED THIS TOUR TO ANSWER, in his words: "their invoice gets made
 * here, their customer gets added here, the customer's information shows here,
 * and if they want to generate invoices for a customer, that is how". All four
 * are steps below — `customers.add`, `customers.identity` and `customers.money`
 * (which carries both money answers, because both instruments live on the one
 * section).
 *
 * Around that sit the things a first-timer does not go looking for because they
 * do not know they exist: the self-registration invite behind an unlabelled
 * icon, what a verification verdict IS and why it cannot be typed in, where a
 * customer's rentals and payments hang off the record, and the two blocks with
 * very different blast radii.
 *
 * ---------------------------------------------------------------------------
 * SHAPE: FOUR STOPS ON THE LIST, SIX INSIDE THE RECORD
 *
 * Rule 3 of the tab tours — go INTO the record — is the whole reason this is
 * not five steps about a table. The list teaches almost nothing a competent
 * operator cannot infer from looking at it; the record is where verification,
 * standing, the ledger and the statement live, and none of those announce
 * themselves.
 *
 * Eleven steps on a tenant who has customers, which is inside the
 * ten-to-twelve band, and every one of them points at a door rather than
 * walking through it. There is no step here that explains how to fill a form
 * in. The array below holds fourteen, because three of them are the empty
 * tab's own and never run alongside the other eleven — see the note at the
 * end of this header.
 *
 * ---------------------------------------------------------------------------
 * THE ANCHOR ORDER ON RECORD STEPS, WHICH IS NOT ARBITRARY
 *
 * Every record step is on the SAME pathname — `/customers/<uuid>` — and only
 * the query differs. Two consequences drove the anchors below.
 *
 * FIRST, the anchor-wait budget is keyed on `routePathname`, so ONE timeout on
 * this route drops every later step to 1500ms. That is why `customers.record`
 * goes first inside the record: it points at the section rail, which is built
 * from `SECTION_GROUPS` off the pathname alone and is therefore on screen
 * before the customer query has even been issued. It cannot time out, so it
 * cannot starve the five steps behind it.
 *
 * SECOND, a section change is a query-only push, and the hook starts polling
 * for the anchor the moment it sees itself "on route" — which it already is.
 * So at the first poll the PREVIOUS section is often still mounted. Any anchor
 * that resolves against both sections would win that race and spotlight the
 * screen the operator is leaving. Hence both anchors on every record step are
 * scoped to the section being visited: an in-panel `data-tour` that exists only
 * in that section's markup, and a rail row narrowed by `data-active="true"`,
 * which the rail sets from the same `?section=` the tour just pushed. Neither
 * can match early. Do not add a section-agnostic fallback here — an anchor like
 * `[data-slot="sidebar-inset"] h2` matches the outgoing panel's title and
 * quietly turns every record step into a spotlight on the last one.
 *
 * The rail row is the guaranteed floor for the four sections whose interesting
 * markup is behind a data guard: Money hides its tiles, its Collect button and
 * its statement behind `ledger.length`, and Rentals hides its stats behind
 * `rentals.length`. On a customer who has never been charged, the rail row is
 * the only thing left — so the bodies are written to still read correctly when
 * the spotlight lands there.
 *
 * ---------------------------------------------------------------------------
 * WHAT AN EMPTY TAB GETS — the other half of this tour
 *
 * A brand-new tenant has NO customers. That is what new means, and they are
 * the whole audience for an onboarding tour. So this one list serves both
 * states and `buildTour` picks the half that applies.
 *
 * Every step that points at a row or lives inside a record carries
 * `requires: { record: 'customerId' }` and is dropped when there is none. The
 * record steps would drop anyway — `routeFor` returns null — but the guard is
 * stated on them too, so the dependency is declared in one place rather than
 * being an emergent property of a route helper. `customers.open` is the one
 * that genuinely needs it: its route is perfectly valid, so without the guard
 * the operator watches the full anchor budget expire on a table that has been
 * REPLACED by the teaching empty state, and then a skip. Six seconds of
 * nothing.
 *
 * In their place, three `noRecord` steps that exist only for the empty tab.
 * With the shared opener and the invite step — which needs no data — that is
 * five stops, four of them anchored, comfortably over `MIN_TOUR_STOPS`.
 *
 * THE HONEST BIT, and why this tab's empty copy is not the other two's. An
 * empty Customers list is NOT a chore to clear. Most customers add THEMSELVES,
 * the moment they book on the operator's public site; the manual button is for
 * the walk-in, the phone booking and the regular they already know. Telling a
 * new operator to go and type in customers they do not have yet would be
 * wrong, so no step here does.
 *
 * The last empty step says the rest unlocks once there is one record, because
 * that is exactly what happens: `hasTakenTabTour` treats a taken empty tour as
 * unseen again once a record exists, and the launch button re-brightens and
 * relabels itself "See what is inside". Without that line a five-step tour
 * reads as the whole thing and nobody comes back for the half that matters.
 *
 * The empty copy also has to sit beside `CustomersTeachingEmptyState`, which
 * is what has replaced the table at that moment. It paraphrases those three
 * payoffs rather than contradicting them — and note that surface, like the
 * launch button, is canary-only, which is why the anchor below falls back to
 * the page title.
 */

import type { TourBuildContext, TourStep } from '@/lib/first-rental-tour';
import { recordRoute, type TabTour } from './index';

/** The list page's title. Present in every state the page can reach. */
const LIST_H1 = '[data-slot="sidebar-inset"] h1';

/**
 * The rail row for a section, but only once that section is the one showing.
 *
 * `data-active` comes from `SidebarMenuButton` and the rail computes it from
 * `?section=`, so this matches only after the tour's own push has landed. That
 * is the whole point — see the anchor note in the header.
 */
const railRow = (section: string) =>
  `[data-sidebar="sidebar"] [data-sidebar="menu-button"][data-active="true"][href*="section=${section}"]`;

/** A rail row regardless of which section is open. For NOTES, which only ask
 *  "is this thing on screen at all". */
const railLink = (section: string) => `[data-sidebar="sidebar"] a[href*="section=${section}"]`;

/**
 * The teaching empty state's payoff list — what stands where the table was.
 *
 * The LIST, not the card: the card runs the full width of the content column
 * and is around 450px tall, which leaves nowhere to stand the tour card, and a
 * spotlight with no placement degrades to the centred wash that teaches
 * nothing. The list is compact, sits mid-card, and carries the same three
 * lines. Both attributes come from one `data-tour` prop on
 * `TeachingEmptyState`; the page title is the fallback, since this surface is
 * canary-only and a v1 tenant renders the older empty state instead.
 *
 * The card's own `customers-empty` is still used below, but only as a SCOPE for
 * a descendant selector — its Add button — never as a spotlight of its own.
 */
const EMPTY_POINTS = '[data-tour="customers-empty-points"]';

/** `/customers/<id>?section=…`, or null on a tenant with no customers yet. */
const sectionRoute = (section: string) => (ctx: TourBuildContext) =>
  recordRoute(ctx.sampleIds?.customerId, '/customers', `section=${section}`);

const STEPS: readonly TourStep[] = [
  {
    id: 'customers.welcome',
    label: 'Welcome',
    title: 'Everyone who rents from you',
    body: 'This is the file on every person who takes a car from you. I will show you where a customer gets added, what their record holds, and how you get paid.',
    route: '/customers',
    anchors: [],
    side: 'center',
    showOutline: true,
  },
  /**
   * ---------------------------------------------------------------------
   * THE EMPTY TAB. Three steps, offered only when there is no customer to
   * open, and dropped the moment there is one. See the header note.
   */
  {
    id: 'customers.empty.what',
    label: 'What this is',
    title: 'What a customer record holds',
    body: 'A record is more than a name. The licence check belongs to the person rather than one rental, their history is on one page, and a block follows them everywhere.',
    route: '/customers',
    anchors: [EMPTY_POINTS, LIST_H1],
    // `left` first: the card then sits in the space between the sidebar and the
    // empty state rather than over the Add button inside it. `placementsFor`
    // falls through to right, bottom and top on a narrower window.
    side: 'left',
    requires: { noRecord: 'customerId' },
  },
  {
    id: 'customers.empty.arrive',
    // The step this tab needed and the other two do not. An empty customer
    // list is not a backlog — it is the normal state of a day-one operator
    // whose booking site has not taken an order yet.
    label: 'How they arrive',
    title: 'Most of these add themselves',
    body: 'Anyone who books on your public site lands here as a record on their own. An empty list on your first day is normal, not a job to clear.',
    route: '/customers',
    // The four counts render at zero rather than not at all, so this anchor is
    // as present on an empty tab as on a full one.
    anchors: ['[data-tour="customers-stats"]', LIST_H1],
    side: 'bottom',
    requires: { noRecord: 'customerId' },
  },
  {
    id: 'customers.list',
    label: 'The list',
    title: 'Your customers, at a glance',
    body: 'Anyone who books through your site is added here on their own. These four counts are the list in summary, so you can see the shape of it without reading it.',
    route: '/customers',
    anchors: ['[data-tour="customers-stats"]', LIST_H1],
    side: 'bottom',
    // Four counts of nothing teach nothing. `customers.empty.arrive` takes this
    // same anchor on an empty tab and says the useful thing instead.
    requires: { record: 'customerId' },
    notes: [
      {
        // Only the canary renders this button, and only for someone with the
        // `blocked_customers` grant — so the line is dropped rather than
        // promising a door that is not there.
        text: 'Anyone you block drops out of this list. Blocked is where they go.',
        anchors: ['[data-tour="customers-blocked"]'],
      },
    ],
  },
  {
    id: 'customers.add',
    label: 'Add a customer',
    title: 'A customer gets added here',
    body: 'Name, email and a licence is enough to start. You can also add someone in the middle of making a rental, so nobody has to come here first.',
    route: '/customers',
    anchors: ['[data-tour="add-customer"]', LIST_H1],
    side: 'bottom',
    // The empty tab gets `customers.empty.add` on this same button, with copy
    // that is honest about who the manual form is actually for.
    requires: { tab: 'customers', edit: true, record: 'customerId' },
    pauseOnAnchorClick: true,
  },
  {
    id: 'customers.invite',
    label: 'Invite',
    title: 'Let them fill it in themselves',
    body: 'This makes a one-off link. They open it, type their own details and upload their own licence, and the record lands here already filled in.',
    route: '/customers',
    anchors: ['[data-tour="customer-invite"]', LIST_H1],
    side: 'bottom',
    requires: { tab: 'customers', edit: true },
    pauseOnAnchorClick: true,
  },
  {
    /**
     * The empty tab's last stop, and deliberately the twin of `customers.add`
     * rather than a second visit to it: only one of the two is ever built.
     *
     * It sits here, after the invite step, because the empty sequence has to
     * END on the Add button — `pauseOnAnchorClick` steps the tour aside so the
     * operator actually opens the form, and anything after it would be a step
     * they never reach.
     */
    id: 'customers.empty.add',
    label: 'Add a customer',
    title: 'For the ones who do not book online',
    body: 'The walk-in, the phone booking, the regular you already know. Add one and the rest of this tour opens up, and I will take you inside a record.',
    route: '/customers',
    // The teaching card's own CTA first — on an empty tab it is the biggest
    // thing on the page, and it is the same handler as the header button. It is
    // the FIRST button in that card whenever it is drawn at all, and it is drawn
    // on exactly the `canEdit('customers')` this step already requires. The
    // header button is the fallback for a tenant who is not shown that card.
    anchors: ['[data-tour="customers-empty"] button', '[data-tour="add-customer"]', LIST_H1],
    side: 'bottom',
    requires: { tab: 'customers', edit: true, noRecord: 'customerId' },
    pauseOnAnchorClick: true,
  },
  {
    id: 'customers.open',
    // The hinge: everything after this is inside one person's record. No
    // `LIST_H1` fallback on purpose — with no rows there is nothing to click,
    // and pointing at the page title while saying "click a name" would be a
    // lie. Last of the list steps, so its timing out costs the rest nothing.
    label: 'Open a record',
    title: 'One person, one page',
    body: 'Click a name to go inside. Their details, their licence, every rental, every payment and what your staff made of them are all on the one page.',
    route: '/customers',
    anchors: ['[data-tour="customer-row"]', '[data-slot="sidebar-inset"] table tbody tr'],
    // A row runs the full width of the content column, so neither side has room
    // — `placementsFor` would fall through to `bottom` anyway. Say so.
    side: 'bottom',
    // The guard that matters most in this file. Both anchors are rows, and on
    // an empty tab the table they live in has been replaced outright — but the
    // ROUTE is fine, so nothing else would notice. Without this the step waits
    // out the whole anchor budget on a page whose table is gone, then skips.
    requires: { record: 'customerId' },
    notes: [
      {
        text: 'Verified and Gig Driver tell you at a glance who has been checked.',
        anchors: ['[data-tour="customers-verified-column"]'],
      },
    ],
  },
  {
    id: 'customers.record',
    label: 'The record',
    title: 'Eleven places, one person',
    body: 'Inside a record the sidebar becomes this rail: who they are, where they stand with you, and what they have actually done. Nothing here needs saving.',
    route: '/customers',
    routeFor: sectionRoute('identity'),
    anchors: ['[data-sidebar="sidebar"] [data-sidebar="content"]', '[data-sidebar="sidebar"]'],
    side: 'right',
    // On a phone the rail is an off-canvas Sheet with no rect, so there is
    // nothing to point at. The steps after this one anchor inside the panel and
    // still run.
    requires: { desktop: true, record: 'customerId' },
    notes: [
      {
        text: 'Reviews are your own staff rating the customer after a rental. They never see them.',
        anchors: [railLink('reviews')],
      },
      {
        text: 'Talking to a customer happens under Messages, not in here.',
        anchors: ['[aria-label="Messages"]'],
      },
    ],
  },
  {
    id: 'customers.identity',
    label: 'Their details',
    title: 'Their information shows here',
    body: 'Name, contact, address, and who to call if something happens while the car is out. There is no Save button — an edit lands as you type.',
    route: '/customers',
    routeFor: sectionRoute('identity'),
    anchors: ['[data-tour="customer-identity"]', railRow('identity')],
    side: 'right',
    requires: { record: 'customerId' },
  },
  {
    id: 'customers.verification',
    label: 'Verification',
    title: 'Whether they are who they say',
    body: 'You send a link, they photograph their licence and their face, and a provider decides. You cannot type this verdict in, which is what makes it evidence.',
    route: '/customers',
    routeFor: sectionRoute('verification'),
    anchors: ['[data-tour="customer-verification"]', railRow('verification')],
    side: 'right',
    requires: { record: 'customerId' },
    notes: [
      {
        text: 'Licences, insurance and anything else you hold on them sit under Documents.',
        anchors: [railLink('documents')],
      },
      {
        text: 'Gig-driver proof sits beside the licence, under Licence and driving.',
        anchors: [railLink('licence')],
      },
    ],
  },
  {
    id: 'customers.rentals',
    label: 'Their rentals',
    title: 'Every car they have had out',
    body: 'Every booking this person has held, what it was worth, and how long they keep a car for. Open any row to go straight to the rental itself.',
    route: '/customers',
    routeFor: sectionRoute('rentals'),
    anchors: ['[data-tour="customer-rentals"]', railRow('rentals')],
    side: 'right',
    requires: { record: 'customerId' },
  },
  {
    id: 'customers.money',
    // Ghulam's headline, and both of his money questions land here: Collect a
    // payment is what emails a customer an invoice, and Statement of account is
    // the printable history. Neither is on `/invoices`, which has no
    // per-customer create action at all.
    label: 'Money',
    title: 'Invoices and what they owe',
    body: 'Everything charged, everything received, and what is left. Collect a payment records cash, charges a card they have used, or emails them an invoice.',
    route: '/customers',
    routeFor: sectionRoute('money'),
    anchors: [
      '[data-tour="customer-money-collect"]',
      '[data-tour="customer-money-totals"]',
      railRow('money'),
    ],
    side: 'right',
    requires: { record: 'customerId' },
    notes: [
      {
        text: 'Statement of account prints their whole history on your letterhead.',
        anchors: ['[data-tour="customer-money-statement"]'],
      },
      // Anchorless, so it is always said: the main nav is replaced by the
      // section rail inside a record, and `nav-group-finance` is not on screen
      // to point at.
      { text: 'Rental invoices themselves are listed under More, then Finance.' },
    ],
  },
  {
    id: 'customers.standing',
    label: 'Standing',
    title: 'Two ways to stop someone',
    body: 'Blocking them with you refuses new bookings on your account and lifts whenever you like. The blocklist under it reaches every operator on the platform.',
    route: '/customers',
    routeFor: sectionRoute('account'),
    anchors: ['[data-tour="customer-block"]', railRow('account')],
    side: 'right',
    requires: { record: 'customerId' },
  },
];

export const CUSTOMERS_TAB_TOUR: TabTour = {
  id: 'customers',
  label: 'Customers',
  homeRoute: '/customers',
  emptyMessage:
    'There is not enough on your Customers tab to walk through yet. Add a customer and I will show you around it.',
  steps: STEPS,
};
