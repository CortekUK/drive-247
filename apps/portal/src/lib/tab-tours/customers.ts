/**
 * The Customers tab tour: ten topics, in the order an operator meets them.
 *
 *   1 list          the list page: graph, card, search, filters, rows, columns, export
 *   2 add           the Add Customer form, opened by the tour itself
 *   3 arrive        other ways in: the booking site, the invite link, CSV import
 *   4 record        opening a customer: sections, saving, At a glance, back
 *   5 details       identity, address, account holder, next of kin, licence, gig proof
 *   6 verification  the licence and face check, its statuses, running it again
 *   7 rentals       their bookings, the cars they had, fines
 *   8 money         totals, collecting a payment, ledger, statement, payment links
 *   9 standing      status, blocking with you, the blocklist, deleting
 *  10 more          documents, consent, reviews, activity, messages
 *
 * Topics 4 to 10 open a real customer: the first one the list has drawn (see
 * `readSampleIds`). With no customer yet they show as locked in the menu.
 *
 * Record anchors are section titles in `components/customers-v2/customer-detail`.
 * `Panel` marks its title `cpanel-<title>` and `Section` marks its heading
 * `csec-<title>` (`kit.tsx`), so renaming a heading means updating it here too.
 * Each one exists only on its own section, so a step never lands on the
 * section the tour is leaving.
 */

import type { TourStep } from '@/lib/first-rental-tour';
import { recordRoute, type TabTour, type TabTourTopic } from './index';

/** The list page's own heading: the last resort under every list step. */
const LIST_HEADING = ['[data-slot="sidebar-inset"] h1', 'main h1'] as const;
const CHART = '[data-tour="customers-chart"]';
const ROW = '[data-tour="customer-row"]';
/** A record section's title, by its marker. */
const panel = (title: string) => `[data-tour="cpanel-${title}"]`;
/** A heading inside a record section, by its marker. */
const sec = (title: string) => `[data-tour="csec-${title}"]`;
const at = (section: string): Pick<TourStep, 'route' | 'routeFor' | 'requires'> => ({
  route: '/customers',
  routeFor: (ctx) => recordRoute(ctx.sampleIds?.customerId, '/customers', `section=${section}`),
  requires: { record: 'customerId' },
});

const ADD_DIALOG = '[data-tour="add-customer-dialog"]';
const OPEN_ADD = {
  trigger: ['[data-tour="add-customer"]', '[data-tour="customers-empty"] button'],
  dialog: ADD_DIALOG,
} as const;
const INVITE_DIALOG = '[data-tour="invite-link-dialog"]';
const OPEN_INVITE = {
  trigger: ['[data-tour="customer-invite"]'],
  dialog: INVITE_DIALOG,
} as const;
const CAN_EDIT = { tab: 'customers', edit: true } as const;
const NEEDS_CUSTOMER = { record: 'customerId' } as const;
const NEEDS_CUSTOMER_TEXT = 'Add your first customer to open this topic.';

const list: TabTourTopic = {
  id: 'customers.list',
  title: 'Your customers at a glance',
  summary: 'The list page: the graph, finding someone, and what each column says.',
  steps: [
    {
      id: 'customers.list.chart',
      label: 'New customers',
      title: 'Who joined, and when',
      body: 'This graph counts new customers on the day they were added, with how many of them are verified as a second line. The period before is dotted behind it.',
      route: '/customers',
      anchors: [CHART, '[data-tour="customers-stats"]', ...LIST_HEADING],
      side: 'bottom',
      requires: { record: 'customerId' },
      notes: [{ text: 'Blocked customers are left out of the list and the graph.' }],
    },
    {
      id: 'customers.list.card',
      label: 'The card',
      title: 'One shortcut at a time',
      body: 'The card beside the graph shows one useful door, like your invite link, importing a list, or the people you have blocked.',
      route: '/customers',
      anchors: ['[data-tour="customers-featured"]'],
      side: 'bottom',
      requires: { record: 'customerId' },
    },
    {
      id: 'customers.list.search',
      label: 'Search',
      title: 'Find someone fast',
      body: 'I search this list by name, email and phone as you type. Clear the box to see everyone again.',
      route: '/customers',
      anchors: ['input[aria-label="Search customers…"]', 'button[aria-label="Search this page"]'],
      mobileAnchors: ['[data-mobile-tab-bar] button[aria-label="Search"]', 'button[aria-label="Search this page"]'],
      mobileBody: 'Search is at the bottom. Here it finds customers by name, email or phone, and the filter button beside the box narrows the list by status and user type.',
      side: 'bottom',
      requires: { record: 'customerId' },
    },
    {
      id: 'customers.list.filters',
      label: 'Filters',
      title: 'Narrow it down',
      body: 'Filters turn the graph over. Pick a status (Active, Inactive or Rejected) or a user type, and the graph and list show only those customers.',
      route: '/customers',
      anchors: ['button[aria-label="Show filters"]', 'button[aria-label="Hide filters"]'],
      side: 'bottom',
      // On a phone the filter button only shows once search is open; the search step covers it.
      requires: { record: 'customerId', desktop: true },
    },
    {
      id: 'customers.list.row',
      label: 'A customer',
      title: 'Each row is one person',
      body: 'Newest customers come first. Click anywhere on a row to open their record.',
      route: '/customers',
      anchors: [ROW],
      side: 'bottom',
      requires: { record: 'customerId' },
      notes: [{ text: 'Rejected or Inactive beside a name is their account status. A small shield means an emergency contact is on file.' }],
    },
    {
      id: 'customers.list.columns',
      label: 'Columns',
      title: 'What the columns say',
      body: 'Type is Authenticated when they have an account on your booking site, Guest when not. Gig driver shows who drives for Uber, Lyft and the like.',
      route: '/customers',
      anchors: ['thead:has([data-tour="customers-verified-column"])', ROW],
      // Phone rows are cards with no column headings, so point at a card.
      mobileAnchors: [ROW],
      side: 'bottom',
      requires: { record: 'customerId' },
      notes: [{ text: 'Verification has its own topic, with what each word means.' }],
    },
    {
      id: 'customers.list.export',
      label: 'Export',
      title: 'Take the list with you',
      body: 'This downloads the customers you are looking at as a spreadsheet, with search and filters applied. Phone and balance are in it too.',
      route: '/customers',
      anchors: ['button[aria-label="Export CSV"]'],
      side: 'bottom',
      requires: { record: 'customerId' },
    },
    // No customers yet: the page is one teaching card, so the topic teaches from it.
    {
      id: 'customers.list.empty-what',
      label: 'One record',
      title: 'Everyone who rents from you',
      body: 'Each customer has one record: their details, their licence check, every rental and every payment.',
      route: '/customers',
      anchors: ['[data-tour="customers-empty-points"]', '[data-tour="customers-empty"]', ...LIST_HEADING],
      side: 'bottom',
      requires: { noRecord: 'customerId' },
    },
    {
      id: 'customers.list.empty-later',
      label: 'When it fills',
      title: 'Most of them add themselves',
      body: 'Anyone who books on your booking site lands here on their own. Add someone by hand for a walk-in or a phone booking.',
      route: '/customers',
      anchors: ['[data-tour="customers-empty"] button', ...LIST_HEADING],
      side: 'bottom',
      requires: { noRecord: 'customerId' },
    },
  ],
};

const add: TabTourTopic = {
  id: 'customers.add',
  title: 'Adding a customer',
  summary: 'The Add Customer form, screen by screen. I open it for you.',
  steps: [
    {
      id: 'customers.add.button',
      label: 'Add Customer',
      title: 'Adding starts here',
      body: 'Add Customer opens a short form with one question per screen. I will open it now so you can see it.',
      route: '/customers',
      anchors: ['[data-tour="add-customer"]', '[data-tour="customers-empty"] button'],
      side: 'bottom',
      requires: CAN_EDIT,
    },
    {
      id: 'customers.add.who',
      label: 'Who',
      title: 'Who is renting',
      body: 'Their full name and date of birth, as on their licence. I refuse a birth date that makes them younger than the age you rent to, or 21 if you have not set one.',
      route: '/customers',
      anchors: ['[data-tour="add-customer-fields"]', ADD_DIALOG],
      side: 'top',
      opens: OPEN_ADD,
      requires: CAN_EDIT,
    },
    {
      id: 'customers.add.dots',
      label: 'Screens',
      title: 'Six short screens',
      body: 'These dots are the screens. Next checks the one you are on before moving, and Back keeps everything you typed.',
      route: '/customers',
      anchors: [`${ADD_DIALOG} ol[aria-label^="Step "]`, ADD_DIALOG],
      side: 'top',
      opens: OPEN_ADD,
      requires: CAN_EDIT,
    },
    {
      id: 'customers.add.contact',
      label: 'Contact and licence',
      title: 'How to reach them, and their licence',
      body: 'Next comes an email or a phone, and I need at least one. Then the licence and ID number, which I check against your blocklist and against customers you already have.',
      route: '/customers',
      anchors: [`${ADD_DIALOG} button[type="submit"]`, ADD_DIALOG],
      side: 'top',
      opens: OPEN_ADD,
      requires: CAN_EDIT,
    },
    {
      id: 'customers.add.extras',
      label: 'The rest',
      title: 'Status, gig work, emergency contact',
      body: 'Then Active or Inactive, and whether they drive for a gig platform. The last two screens are an emergency contact, and both are optional.',
      route: '/customers',
      anchors: [`${ADD_DIALOG} ol[aria-label^="Step "]`, ADD_DIALOG],
      side: 'top',
      opens: OPEN_ADD,
      requires: CAN_EDIT,
      notes: [{ text: 'For a gig driver I ask for their proof straight after saving.' }],
    },
    {
      id: 'customers.add.verify',
      label: 'Check their ID',
      title: 'Then I offer the ID check',
      body: 'Once they are added, I can check their ID straight away: show a QR code if they are with you, or email them the link. You can also leave it for later.',
      route: '/customers',
      anchors: [ADD_DIALOG],
      side: 'center',
      opens: OPEN_ADD,
      requires: CAN_EDIT,
    },
  ],
};

const arrive: TabTourTopic = {
  id: 'customers.arrive',
  title: 'Other ways customers arrive',
  summary: 'Bookings on your site, a sign-up link, and importing a list.',
  steps: [
    {
      id: 'customers.arrive.site',
      label: 'Your booking site',
      title: 'Most customers add themselves',
      body: 'Anyone who books on your booking site is added to this list on their own. The form is for walk-ins and phone bookings.',
      route: '/customers',
      anchors: [CHART, ...LIST_HEADING],
      side: 'bottom',
    },
    {
      id: 'customers.arrive.invite',
      label: 'Invite link',
      title: 'Let them sign themselves up',
      body: 'Invite link makes a sign-up link. They type their own details and verify their own ID. I will open it now.',
      route: '/customers',
      anchors: ['[data-tour="customer-invite"]'],
      side: 'bottom',
      requires: CAN_EDIT,
    },
    {
      id: 'customers.arrive.link',
      label: 'The link',
      title: 'What the link does',
      body: 'It opens a short form on your booking site. Each link signs up one customer and works for 7 days.',
      route: '/customers',
      anchors: [`${INVITE_DIALOG} h3`, INVITE_DIALOG],
      side: 'bottom',
      opens: OPEN_INVITE,
      requires: CAN_EDIT,
    },
    {
      id: 'customers.arrive.make',
      label: 'Make the link',
      title: 'Make it, then send it',
      body: 'Make the link creates it, and you copy it from here to send however you like. Links you made earlier keep working until they are used or expire.',
      route: '/customers',
      anchors: ['[data-tour="invite-link-make"]', INVITE_DIALOG],
      side: 'top',
      opens: OPEN_INVITE,
      requires: CAN_EDIT,
    },
    {
      id: 'customers.arrive.import',
      label: 'Import CSV',
      title: 'Bring a list you already have',
      body: 'Import CSV adds many customers at once from a spreadsheet, so you do not type them in one by one.',
      route: '/customers',
      anchors: ['button[aria-label="Import CSV"]'],
      side: 'bottom',
      requires: CAN_EDIT,
    },
  ],
};

const record: TabTourTopic = {
  id: 'customers.record',
  title: "A customer's record",
  summary: 'Opening a customer: its sections, how it saves, and At a glance.',
  requires: NEEDS_CUSTOMER,
  unavailableText: NEEDS_CUSTOMER_TEXT,
  steps: [
    {
      id: 'customers.record.open',
      label: 'Open one',
      title: 'One person, one page',
      body: 'Click any customer to open their record. Everything about them is there, split into sections.',
      route: '/customers',
      anchors: [ROW],
      side: 'bottom',
      requires: { record: 'customerId' },
    },
    {
      id: 'customers.record.sections',
      label: 'Sections',
      title: 'Eleven sections, three groups',
      body: 'Inside a record the menu becomes its sections: the person, their standing with you, and their history.',
      ...at('identity'),
      anchors: ['[data-sidebar="sidebar"] [data-sidebar="content"]', '[data-sidebar="sidebar"]'],
      mobileAnchors: ['[data-record-dock]'],
      mobileBody: 'A record has eleven sections. The middle button of this bar lists them all and shows which one you are on.',
      side: 'right',
    },
    {
      id: 'customers.record.saves',
      label: 'Saving',
      title: 'There is no Save button',
      body: 'What you type is saved as you go. Each section says what it is for right under its name.',
      ...at('identity'),
      anchors: [panel('identity')],
      side: 'bottom',
      notes: [{ text: 'If they are blocked, rejected or their licence has run out, a red line says so at the top of every section.' }],
    },
    {
      id: 'customers.record.glance',
      label: 'At a glance',
      title: 'Can they have the keys?',
      body: 'At a glance adds everything up and says Ready to rent, Not ready or Cannot rent, and what is in the way. Each line takes you to the section that owns it.',
      ...at('identity'),
      // A wide screen shows it as a column; narrower ones put it on the bar at the bottom.
      anchors: ['aside[aria-label="At a glance"]', '[data-record-dock] button[aria-label="At a glance"]'],
      side: 'left',
    },
    {
      id: 'customers.record.back',
      label: 'Back',
      title: 'Back to the list',
      body: 'All customers takes you back to the list. The address keeps the section you are on, so a saved link opens it right here.',
      ...at('identity'),
      anchors: ['[data-sidebar="sidebar"] a[href="/customers"]', '[data-record-dock] a[aria-label="All customers"]'],
      mobileAnchors: ['[data-record-dock] a[aria-label="All customers"]'],
      mobileBody: 'The arrow on the left of this bar takes you back to all your customers. The address keeps the section you are on, so a saved link opens it right here.',
      side: 'right',
    },
  ],
};

const details: TabTourTopic = {
  id: 'customers.details',
  title: 'Their details and licence',
  summary: 'Contact, address, account holder, emergency contact, licence and gig proof.',
  requires: NEEDS_CUSTOMER,
  unavailableText: NEEDS_CUSTOMER_TEXT,
  steps: [
    {
      id: 'customers.details.contact',
      label: 'Contact',
      title: 'Who they are',
      body: 'Name, email, phone, date of birth and timezone. Their timezone decides when their reminders and lockbox codes are sent.',
      ...at('identity'),
      anchors: [sec('contact'), panel('identity')],
      side: 'bottom',
    },
    {
      id: 'customers.details.address',
      label: 'Address',
      title: 'Where they live',
      body: 'When their ID is checked, the address read off their licence is compared with this one.',
      ...at('identity'),
      anchors: [sec('address'), panel('identity')],
      side: 'top',
    },
    {
      id: 'customers.details.holder',
      label: 'Account holder',
      title: 'A person or a company',
      body: 'A company account bills and signs under the business, not the driver. Pick Company to add the business name and registration.',
      ...at('identity'),
      anchors: [sec('account-holder'), panel('identity')],
      side: 'top',
    },
    {
      id: 'customers.details.kin',
      label: 'Next of kin',
      title: 'Who to call',
      body: 'The person to call if something happens to the driver while the car is out.',
      ...at('identity'),
      anchors: [sec('next-of-kin'), panel('identity')],
      side: 'top',
    },
    {
      id: 'customers.details.licence',
      label: 'Licence',
      title: 'Their driving licence',
      body: 'The licence number, issuing state and one more ID. The issue and expiry dates are read off the document by the ID check, not typed in.',
      ...at('licence'),
      anchors: [sec('driving-licence'), panel('licence-driving')],
      side: 'bottom',
      notes: [{ text: 'An expired licence shows in red on every section, because a car cannot go out against it.' }],
    },
    {
      id: 'customers.details.gig',
      label: 'Gig driver',
      title: 'Gig drivers and their proof',
      body: 'Switch this on for Uber, Lyft or DoorDash drivers and keep their proof here. Proof they send from their own portal shows up too.',
      ...at('licence'),
      anchors: [sec('gig-driver'), panel('licence-driving')],
      side: 'top',
    },
  ],
};

const verification: TabTourTopic = {
  id: 'customers.verification',
  title: 'Licence and face check',
  summary: 'How a customer is verified, what each status means, and running it again.',
  requires: NEEDS_CUSTOMER,
  unavailableText: NEEDS_CUSTOMER_TEXT,
  steps: [
    {
      id: 'customers.verification.verdict',
      label: 'The verdict',
      title: 'Are they who they say?',
      body: 'They photograph their licence and take a selfie, and the provider decides. This says Not started, In review, Verified or Declined.',
      ...at('verification'),
      anchors: ['[data-tour="customer-verification"]', panel('verification')],
      side: 'bottom',
      notes: [{ text: 'Nobody can type this verdict in, which is what makes it evidence.' }],
    },
    {
      id: 'customers.verification.stages',
      label: 'Stages',
      title: 'Each stage ticks off',
      body: 'Under the verdict: documents captured, sent to the provider, verdict issued, and the licence checked with the state that issued it.',
      ...at('verification'),
      anchors: ['[data-tour="customer-verification-stages"]', '[data-tour="customer-verification"]', panel('verification')],
      side: 'right',
    },
    {
      id: 'customers.verification.captured',
      label: 'Evidence',
      title: 'What the provider captured',
      body: 'The photos the provider took when it decided: their face, the selfie and both sides of the document. Nobody can replace these from Documents.',
      ...at('verification'),
      anchors: [sec('what-the-provider-captured'), panel('verification')],
      side: 'top',
    },
    {
      id: 'customers.verification.stale',
      label: 'Out of date',
      title: 'When the details change',
      body: 'Edit their name, licence, date of birth or address after a pass, and I mark it Verified, out of date and show what changed. Run it again, or say it still stands.',
      ...at('verification'),
      anchors: ['[data-tour="customer-verification"]', panel('verification')],
      side: 'bottom',
    },
    {
      id: 'customers.verification.send',
      label: 'Send a link',
      title: 'Start a check',
      body: 'Send a verification link, or Re-verify, starts a check. Pick the document they will use, and they scan the QR code or open the link on their phone.',
      ...at('verification'),
      anchors: [sec('actions'), panel('verification')],
      side: 'top',
      requires: { record: 'customerId', tab: 'customers', edit: true },
    },
    {
      id: 'customers.verification.list',
      label: 'On the list',
      title: 'The same answer on the list',
      body: 'Verified means passed or checked by hand, Pending is waiting on the provider, Rejected failed, and Unverified has not been checked yet.',
      route: '/customers',
      anchors: ['[data-tour="customers-verified-column"]', ROW],
      mobileAnchors: [ROW],
      side: 'bottom',
      requires: { record: 'customerId' },
    },
  ],
};

const rentals: TabTourTopic = {
  id: 'customers.rentals',
  title: 'Their rentals and fines',
  summary: 'Every booking they have held, the cars they had, and fines.',
  requires: NEEDS_CUSTOMER,
  unavailableText: NEEDS_CUSTOMER_TEXT,
  steps: [
    {
      id: 'customers.rentals.stats',
      label: 'Rentals',
      title: 'What they have booked',
      body: 'How many bookings they have held, what they were worth and how long they usually keep a car. Cancelled ones are left out of the value.',
      ...at('rentals'),
      anchors: ['[data-tour="customer-rentals"]', panel('rentals')],
      side: 'bottom',
    },
    {
      id: 'customers.rentals.list',
      label: 'By booking or car',
      title: 'Each booking, or each car',
      body: 'By booking lists every rental. By car groups them by the car they drove, which helps before you hand the same car over again.',
      ...at('rentals'),
      anchors: ['[data-tour="customer-rentals-view"]', panel('rentals')],
      side: 'bottom',
    },
    {
      id: 'customers.rentals.row',
      label: 'A rental',
      title: 'One booking',
      body: 'The car, the dates, the total, what is still owed and its status. Open takes you straight to the rental.',
      ...at('rentals'),
      anchors: ['[data-tour="customer-rental-row"]', panel('rentals')],
      side: 'top',
    },
    {
      id: 'customers.rentals.fines',
      label: 'Fines',
      title: 'Fines and tolls',
      body: 'Citations and tolls that came in against a car while they had it, with what is unpaid and what is settled.',
      ...at('fines'),
      anchors: [panel('fines')],
      side: 'bottom',
    },
  ],
};

const money: TabTourTopic = {
  id: 'customers.money',
  title: 'What they owe and have paid',
  summary: 'Totals, collecting a payment, the ledger and their statement.',
  requires: NEEDS_CUSTOMER,
  unavailableText: NEEDS_CUSTOMER_TEXT,
  steps: [
    {
      id: 'customers.money.totals',
      label: 'Totals',
      title: 'Four numbers',
      body: 'Charged, Received, Outstanding and Credit on account. I work them out from the ledger below, nobody types them in.',
      ...at('money'),
      anchors: ['[data-tour="customer-money-totals"]', panel('money')],
      side: 'bottom',
    },
    {
      id: 'customers.money.collect',
      label: 'Collect',
      title: 'Collect a payment',
      body: 'When they owe you, this records cash, card, bank transfer and more, charges a card, or emails them a link to pay. The money lands as credit on their account.',
      ...at('money'),
      anchors: ['[data-tour="customer-money-collect"]', '[data-tour="customer-money-totals"]', panel('money')],
      side: 'right',
      requires: { record: 'customerId', tab: 'customers', edit: true },
    },
    {
      id: 'customers.money.billing',
      label: 'Billing',
      title: 'How they pay',
      body: 'How they have paid before, and whether there is a saved card on file that can be charged without asking.',
      ...at('money'),
      anchors: ['[data-tour="customer-money-billing"]', panel('money')],
      side: 'left',
    },
    {
      id: 'customers.money.ledger',
      label: 'Ledger',
      title: 'Every charge and payment',
      body: 'Oldest first, with the balance after every row, so you can see where each number came from.',
      ...at('money'),
      anchors: [sec('ledger'), panel('money')],
      side: 'top',
    },
    {
      id: 'customers.money.statement',
      label: 'Statement',
      title: 'A statement to send',
      body: 'Statement of account makes a printable statement of their whole history with you, under your company name and logo.',
      ...at('money'),
      anchors: ['[data-tour="customer-money-statement"]', sec('ledger'), panel('money')],
      side: 'top',
    },
    {
      id: 'customers.money.requests',
      label: 'Payment requests',
      title: 'Links you sent them',
      body: 'Payment links sent to this customer, each marked when it is paid. Open one to see what they see.',
      ...at('money'),
      anchors: [sec('payment-requests'), panel('money')],
      side: 'top',
    },
  ],
};

const standing: TabTourTopic = {
  id: 'customers.standing',
  title: 'Status and blocking',
  summary: 'Active, Inactive or Rejected, the two kinds of block, and deleting.',
  requires: NEEDS_CUSTOMER,
  unavailableText: NEEDS_CUSTOMER_TEXT,
  steps: [
    {
      id: 'customers.standing.blocked',
      label: 'Blocked list',
      title: 'Where blocked people go',
      body: 'Anyone you block drops out of this list. This button opens the people you have blocked.',
      route: '/customers',
      anchors: ['[data-tour="customers-blocked"]'],
      side: 'bottom',
      requires: { record: 'customerId' },
    },
    {
      id: 'customers.standing.status',
      label: 'Status',
      title: 'Active, Inactive or Rejected',
      body: 'Active can book and rent. Inactive keeps their history but stops the account being used, and Rejected is a decision with a reason written down.',
      ...at('account'),
      anchors: [sec('status'), panel('account')],
      side: 'bottom',
    },
    {
      id: 'customers.standing.block',
      label: 'Block',
      title: 'Block them with you',
      body: 'This refuses new bookings on your account. Rentals already out carry on, and you can lift it any time.',
      ...at('account'),
      anchors: ['[data-tour="customer-block"]', panel('account')],
      side: 'top',
    },
    {
      id: 'customers.standing.blocklist',
      label: 'Blocklist',
      title: 'The blocklist',
      body: 'An entry is kept against their licence, other ID or email, so it still catches them under a new account. Keep it for fraud, a stolen car and the like.',
      ...at('account'),
      anchors: [sec('blocklist'), panel('account')],
      side: 'top',
    },
    {
      id: 'customers.standing.delete',
      label: 'Delete',
      title: 'Deleting a customer',
      body: 'This removes them for good. Someone with rentals cannot be deleted, so set them to Inactive instead and keep the history.',
      ...at('account'),
      anchors: ['[data-tour="customer-delete"]'],
      side: 'top',
      requires: { record: 'customerId', tab: 'customers', edit: true },
    },
  ],
};

const more: TabTourTopic = {
  id: 'customers.more',
  title: 'The rest of the record',
  summary: 'Documents, consent, staff reviews, activity, and messaging them.',
  requires: NEEDS_CUSTOMER,
  unavailableText: NEEDS_CUSTOMER_TEXT,
  steps: [
    {
      id: 'customers.more.documents',
      label: 'Documents',
      title: 'Files you keep on them',
      body: 'Files you upload about them, each with its type and the dates it is valid for. Each one is scanned, and I count what is expiring and what the scanner flagged.',
      ...at('documents'),
      anchors: [panel('documents')],
      side: 'bottom',
    },
    {
      id: 'customers.more.consent',
      label: 'Consent',
      title: 'May I text them?',
      body: 'Whether they agreed to text messages, and the date they did. WhatsApp is a separate permission.',
      ...at('consent'),
      anchors: [panel('consent')],
      side: 'bottom',
    },
    {
      id: 'customers.more.reviews',
      label: 'Reviews',
      title: 'What your staff thought',
      body: 'Your staff rate the customer out of 10 after a rental. They never see it, and it is never on your booking site.',
      ...at('reviews'),
      anchors: [panel('reviews')],
      side: 'bottom',
    },
    {
      id: 'customers.more.activity',
      label: 'Activity',
      title: 'Everything that happened',
      body: 'Everything that has happened on this record, oldest first.',
      ...at('activity'),
      anchors: [panel('activity')],
      side: 'bottom',
    },
    {
      id: 'customers.more.messages',
      label: 'Messages',
      title: 'Talking to them',
      body: 'Messages to a customer are not kept on the record. They live here: texts, emails and calls in one place.',
      route: '/customers',
      anchors: ['[aria-label^="Multi Chat"]'],
      side: 'bottom',
      requires: { record: 'customerId' },
    },
  ],
};

export const CUSTOMERS_TAB_TOUR: TabTour = {
  id: 'customers',
  label: 'Customers',
  homeRoute: '/customers',
  emptyMessage:
    'There is not enough of this tab open to you to walk through. A head admin can widen your access to Customers.',
  topics: [list, add, arrive, record, details, verification, rentals, money, standing, more],
};
