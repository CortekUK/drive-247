/**
 * The Rentals tab tour: eleven topics, in the order an operator meets them.
 *
 *   1 list       the list page: graph, card, search, filters, rows, statuses, calendar, export
 *   2 new        what New Rental does, and the order a rental is filled in
 *   3 record     the eight stages, how a rental saves, the panels beside it
 *   4 customer   who is renting: profile, changing them, reviews, the ID check
 *   5 car        the car, swapping it, mileage, pricing, add-ons, other drivers
 *   6 dates      when and where: dates, how it changes hands, the map, locking
 *   7 agreement  sending it, where it got to, the template, when it goes stale
 *   8 insurance  Bonzah cover, the four covers, the customer's own policy
 *   9 payments   what is owed, the deposit, taking money, charges, cancelling
 *  10 handover   the car going out and coming back, photos, damage
 *  11 elsewhere  messages, notifications, activity, Trax, and the emails sent
 *
 * Topics 3 to 11 open a real rental: the first row the list has drawn (see
 * `readSampleIds`, which reads `data-record-id` off the rows). The tour only
 * points: New Rental creates a draft the moment it is clicked, so no step
 * clicks it, and nothing that moves money or sends anything is ever opened.
 *
 * The v2 rental record is eight stages in the left rail (`rental-detail/stages.ts`).
 * On a phone that rail is a closed sheet, so its steps point at the dock's
 * middle button instead. Stage anchors are `data-tour` markers in the
 * `rentals-v2/rental-detail/stage-*.tsx` files.
 *
 * Extensions are left out on purpose: `SHOW_MULTI_PERIOD` is false in
 * `rental-detail/multi-period.ts`, so the screen has nothing to point at.
 *
 * The empty-tab steps in topic 1 only run if the Tour button is shown on an
 * empty list. Today the list hides it there (`teachEmptyRentals`).
 */

import type { TourStep } from '@/lib/first-rental-tour';
import { recordRoute, type TabTour, type TabTourTopic } from './index';

/** The list page's heading: the last resort under every list step. */
const LIST_HEADING = ['[data-slot="sidebar-inset"] h1', 'main h1'] as const;
/** A stage panel's own title, drawn on every stage in every state. */
const PANEL_TITLE = '[data-slot="sidebar-inset"] h2.font-heading';
/** A stage's row in the left rail (laptop). */
const rail = (stage: string) => `[data-sidebar="sidebar"] a[href*="stage=${stage}"]`;
/** The whole stage rail (laptop). */
const RAIL = '[data-sidebar="sidebar"] [data-sidebar="content"]';
/** The dock on a phone. Its middle button lists the stages. */
const DOCK_STAGES = '[data-record-dock]';
/** A panel button on the phone dock (Management, Messages…). */
const dockTab = (label: string) => `[data-record-dock] button[aria-label="${label}"]`;
/** A tab of the right-hand column (wide laptop). */
const railTab = (id: string) => `[data-tour="rental-right-rail"] [role="tab"][id$="-trigger-${id}"]`;
const sec = (id: string) => `[data-tour="${id}"]`;

/** A step that lives on one stage of the sample rental. */
const at = (stage: string): Pick<TourStep, 'route' | 'routeFor' | 'requires'> => ({
  route: '/rentals',
  routeFor: (ctx) => recordRoute(ctx.sampleIds?.rentalId, '/rentals', `stage=${stage}`),
  requires: { record: 'rentalId' },
});
/** The same, for a step that points at a control only an editor may use. */
const atEdit = (stage: string): Pick<TourStep, 'route' | 'routeFor' | 'requires'> => ({
  ...at(stage),
  requires: { record: 'rentalId', tab: 'rentals', edit: true },
});

const NEEDS_RENTAL = { record: 'rentalId' } as const;
const NEEDS_RENTAL_TEXT = 'Once you have a rental, this topic opens.';

const list: TabTourTopic = {
  id: 'rentals.list',
  title: 'Your rentals at a glance',
  summary: 'The list page: the graph, finding a rental, and what each status means.',
  steps: [
    {
      id: 'rentals.list.chart',
      label: 'Booked value',
      title: 'How much you have booked',
      body: 'This graph shows what you booked over the period you pick, with what was picked up as a lighter line and the period before dotted. The menu above it switches to counting new bookings.',
      route: '/rentals',
      anchors: ['[data-tour="rentals-chart"]', ...LIST_HEADING],
      side: 'bottom',
      requires: { record: 'rentalId' },
      notes: [{ text: 'Booked value is what rentals were written for, not money collected.' }],
    },
    {
      id: 'rentals.list.card',
      label: 'The card',
      title: 'One useful place at a time',
      body: 'This card points you to one place worth a look, like Calendar View. Open takes you straight there.',
      route: '/rentals',
      anchors: ['[data-tour="rentals-featured"]'],
      side: 'bottom',
      requires: { record: 'rentalId' },
    },
    {
      id: 'rentals.list.search',
      label: 'Search',
      title: 'Find a rental fast',
      body: 'I search this list by customer, registration or rental number as you type. The slider button inside the box opens the filters.',
      route: '/rentals',
      anchors: ['[data-tour="rentals-search"]', 'button[aria-label="Search this page"]'],
      mobileAnchors: ['[data-mobile-tab-bar] button[aria-label="Search"]', 'button[aria-label="Search this page"]'],
      mobileBody: 'Search is at the bottom. Here it finds a rental by customer, registration or rental number.',
      side: 'bottom',
      requires: { record: 'rentalId' },
    },
    {
      id: 'rentals.list.filters',
      label: 'Filters',
      title: 'Narrow it down',
      body: 'Filters turn the graph card over: status, how it is paid, insurance, a start date range and cancellation requests. A number on this button means the list is filtered.',
      route: '/rentals',
      anchors: ['button[aria-label="Show filters"]', 'button[aria-label="Hide filters"]'],
      side: 'bottom',
      // On a phone the filter button only shows once search is open.
      requires: { record: 'rentalId', desktop: true },
    },
    {
      id: 'rentals.list.row',
      label: 'A rental',
      title: 'One entry per rental',
      body: 'Its number, the customer and car, pickup and return, the total and the status. Click anywhere on the row to open it. Newest come first.',
      mobileBody: 'Each card is one rental: its number, the customer and car, pickup and return, the total and the status. Tap a card to open it.',
      route: '/rentals',
      anchors: ['[data-tour="rental-row"]'],
      // Set so the phone wording is used (it only applies with phone anchors).
      mobileAnchors: ['[data-tour="rental-row"]'],
      side: 'bottom',
      requires: { record: 'rentalId' },
    },
    {
      id: 'rentals.list.status',
      label: 'Status',
      title: 'What the status means',
      body: 'Pending has not started yet, Upcoming is booked for a later date, Active is under way and Completed is over. Cancelled and Rejected never ran.',
      route: '/rentals',
      anchors: ['[data-tour="rental-row"]'],
      side: 'bottom',
      requires: { record: 'rentalId' },
      notes: [{ text: 'A tinted row needs a look: a cancellation request, or Bonzah cover that is still quoted or needs balance.' }],
    },
    {
      id: 'rentals.list.calendar',
      label: 'Calendar',
      title: 'See them on a timeline',
      body: 'Calendar view lays your fleet and its rentals out on a timeline. The same button brings you back to the list.',
      route: '/rentals',
      anchors: ['[data-tour="rentals-calendar"]'],
      side: 'bottom',
      requires: { record: 'rentalId' },
    },
    {
      id: 'rentals.list.export',
      label: 'Export',
      title: 'Take the list with you',
      body: 'This downloads the rentals you are looking at as a spreadsheet, with your search and filters applied.',
      route: '/rentals',
      anchors: ['button[aria-label="Export CSV"]'],
      side: 'bottom',
      requires: { record: 'rentalId' },
    },
    // An empty tab: the page is one teaching card, so the topic teaches from it.
    {
      id: 'rentals.list.empty-what',
      label: 'No rentals yet',
      title: 'Where the business runs',
      body: 'Each rental ties one customer to one car, with its payment, agreement and handover. This page fills up as you take bookings.',
      route: '/rentals',
      anchors: ['[data-tour="rentals-empty"] h3', ...LIST_HEADING],
      side: 'bottom',
      requires: { noRecord: 'rentalId' },
    },
    {
      id: 'rentals.list.empty-first',
      label: 'The first one',
      title: 'A car and a customer first',
      body: 'A rental needs a car and a customer, so add those first. Then this button starts your first rental.',
      route: '/rentals',
      anchors: ['[data-tour="rentals-empty"] button', ...LIST_HEADING],
      side: 'top',
      requires: { noRecord: 'rentalId', tab: 'rentals', edit: true },
    },
    {
      id: 'rentals.list.empty-later',
      label: 'When it fills',
      title: 'What this page becomes',
      body: 'Once you have rentals, this page shows what you booked, a search, filters and one row per rental. I will walk you through it then.',
      route: '/rentals',
      anchors: ['[data-tour="rentals-empty"]', ...LIST_HEADING],
      side: 'bottom',
      requires: { noRecord: 'rentalId' },
    },
  ],
};

const start: TabTourTopic = {
  id: 'rentals.new',
  title: 'Starting a new rental',
  summary: 'What New Rental does, and the order to fill a rental in.',
  steps: [
    {
      id: 'rentals.new.button',
      label: 'New Rental',
      title: 'No long form',
      body: 'New Rental makes an empty rental straight away and opens it. You then fill it in stage by stage, on the rental itself.',
      route: '/rentals',
      anchors: ['[data-tour="new-rental"]'],
      side: 'bottom',
      requires: { tab: 'rentals', edit: true, record: 'rentalId' },
      // Clicking it is the operator doing the thing. Stand aside.
      pauseOnAnchorClick: true,
      detail: (ctx) => (ctx.rentalCreationBlocked ? 'Connect payments first' : null),
      notes: [
        { text: 'A rental you started but have not finished waits under Drafts, above the list.', anchors: ['[data-tour="rental-drafts"]'] },
        { text: 'If you leave a new rental without picking anything, I throw it away.' },
      ],
    },
    {
      id: 'rentals.new.order',
      label: 'The stages',
      title: 'Fill it in from the top',
      body: 'A new rental opens on Customer. Work down the stages: who, which car, when and where, extras, then the paperwork, the money and the handover.',
      ...at('customer'),
      anchors: [RAIL, rail('customer'), PANEL_TITLE],
      mobileAnchors: [DOCK_STAGES, PANEL_TITLE],
      mobileBody: 'A new rental opens on Customer. The button in the middle of this bar lists the stages: who, which car, when and where, extras, then the paperwork, the money and the handover.',
      side: 'right',
    },
    {
      id: 'rentals.new.customer',
      label: 'Customer',
      title: 'Who is renting',
      body: 'On a new rental this stage is a search over your customers. Pick one and they go on the rental.',
      ...at('customer'),
      anchors: [rail('customer'), PANEL_TITLE],
      side: 'right',
    },
    {
      id: 'rentals.new.vehicle',
      label: 'Vehicle',
      title: 'Then the car',
      body: 'Pick the car next. The list tells you when a car cannot be used for your dates, like already booked or blocked, before you choose it.',
      ...at('vehicle'),
      anchors: [rail('vehicle'), PANEL_TITLE],
      side: 'right',
    },
    {
      id: 'rentals.new.when',
      label: 'When & where',
      title: 'Then the dates',
      body: 'Pick pickup and return on the car’s own calendar, and how the car changes hands at each end. I show the new price before you save.',
      ...at('when'),
      anchors: [rail('when'), PANEL_TITLE],
      side: 'right',
    },
    {
      id: 'rentals.new.ready',
      label: 'Ready',
      title: 'When it can go out',
      body: 'The rental stays Pending until the car goes out. Confirm collection on Handover opens once the agreement is signed and nothing is owed.',
      ...at('handover'),
      anchors: [rail('handover'), PANEL_TITLE],
      side: 'right',
    },
  ],
};

const record: TabTourTopic = {
  id: 'rentals.record',
  title: 'Inside a rental',
  summary: 'The eight stages, how a rental saves, and the panels beside it.',
  requires: NEEDS_RENTAL,
  unavailableText: NEEDS_RENTAL_TEXT,
  steps: [
    {
      id: 'rentals.record.stages',
      label: 'Stages',
      title: 'Eight stages, one rental',
      body: 'The first four describe the rental: who, which car, when and where, and extras. The last four come out of it: agreement, insurance, payments and handover.',
      ...at('customer'),
      anchors: [RAIL, rail('customer')],
      mobileAnchors: [DOCK_STAGES],
      mobileBody: 'The button in the middle of this bar lists the eight stages and shows which one you are on. The first four describe the rental; the last four are the agreement, insurance, payments and handover.',
      side: 'right',
    },
    {
      id: 'rentals.record.answers',
      label: 'Answers',
      title: 'An answer, or a question',
      body: 'A stage shows its answer once it has one, like the customer’s name. Until then it asks its question in grey, like Add cover?',
      ...at('customer'),
      anchors: [rail('insurance'), rail('customer')],
      side: 'right',
      // The phone's stage list shows names only.
      requires: { record: 'rentalId', desktop: true },
    },
    {
      id: 'rentals.record.jump',
      label: 'Moving around',
      title: 'Open any stage',
      body: 'Stages do not have to be done in order. Click any one to open it. The address keeps the stage, so a saved link opens it again.',
      mobileBody: 'Stages do not have to be done in order. Open the list from the middle button and tap any one. The address keeps the stage, so a saved link opens it again.',
      ...at('customer'),
      anchors: [rail('payments'), PANEL_TITLE],
      mobileAnchors: [DOCK_STAGES, PANEL_TITLE],
      side: 'right',
    },
    {
      id: 'rentals.record.saving',
      label: 'Saving',
      title: 'Nothing to submit',
      body: 'The rental already exists, so each stage saves its own changes. Who, which car, the dates and extras can change only while it is Pending and nothing has gone out yet.',
      ...at('customer'),
      anchors: [PANEL_TITLE],
      side: 'bottom',
      notes: [{ text: 'If your role can only view rentals, you see every stage but cannot change anything.' }],
    },
    {
      id: 'rentals.record.beside',
      label: 'Beside it',
      title: 'The panels beside it',
      body: 'Management shows how this rental is booked. Messages, Notifications, Activity and Trax are about this rental only.',
      ...at('customer'),
      anchors: ['[data-tour="rental-right-rail"]'],
      mobileAnchors: [dockTab('Management')],
      mobileSpan: [dockTab('Messages'), dockTab('Notifications'), dockTab('Activity'), dockTab('Trax')],
      mobileBody: 'These buttons open the panels beside the rental: Management, Messages, Notifications, Activity and Trax, all about this rental only.',
      side: 'left',
    },
  ],
};

const customer: TabTourTopic = {
  id: 'rentals.customer',
  title: 'The customer and their checks',
  summary: 'Who is renting, changing them, what your team said, and their ID check.',
  requires: NEEDS_RENTAL,
  unavailableText: NEEDS_RENTAL_TEXT,
  steps: [
    {
      id: 'rentals.customer.who',
      label: 'Who',
      title: 'Who is renting',
      body: 'Their name and email. Open profile takes you to everything about them in Customers.',
      ...at('customer'),
      anchors: [sec('rental-customer-who'), PANEL_TITLE],
      side: 'bottom',
      notes: [{ text: 'A blocked customer shows a red Blocked tag here, with the reason.' }],
    },
    {
      id: 'rentals.customer.change',
      label: 'Changing them',
      title: 'Putting someone else on it',
      body: 'Clear customer lets you pick another person. It only works while the rental is Pending, before any agreement, cover, payment or handover.',
      ...atEdit('customer'),
      anchors: [sec('rental-customer-action')],
      side: 'bottom',
      notes: [{ text: 'When it is greyed out, hover it and I tell you why.' }],
    },
    {
      id: 'rentals.customer.reviews',
      label: 'Reviews',
      title: 'What your team said',
      body: 'After a rental closes your team rates the customer, and I sum up every review here. Rate this rental shows up once this one is closed.',
      ...at('customer'),
      anchors: [sec('rental-customer-reviews'), PANEL_TITLE],
      side: 'bottom',
    },
    {
      id: 'rentals.customer.check',
      label: 'ID check',
      title: 'Their ID check',
      body: 'I check their licence and that their selfie matches it. The tag says how it went: verified, in review, failed, or link sent.',
      ...at('customer'),
      anchors: [sec('rental-customer-verification'), PANEL_TITLE],
      side: 'top',
      notes: [{ text: 'When a check is on file, open the card to see all of it.' }],
    },
    {
      id: 'rentals.customer.photos',
      label: 'Documents',
      title: 'Licence and selfie',
      body: 'The front and back of the licence and the selfie sit here. They stay blurred until you open one, because they are someone’s ID.',
      ...at('customer'),
      anchors: [sec('rental-customer-verification'), PANEL_TITLE],
      side: 'top',
    },
    {
      id: 'rentals.customer.link',
      label: 'New link',
      title: 'Check them again',
      body: 'The link button beside Verification sends them a new verification link. When photos are on file, the arrow next to it runs my check again.',
      ...atEdit('customer'),
      anchors: [sec('rental-customer-verification'), PANEL_TITLE],
      side: 'top',
    },
  ],
};

const car: TabTourTopic = {
  id: 'rentals.car',
  title: 'The car and its extras',
  summary: 'Which car, swapping it, mileage and price, add-ons and other drivers.',
  requires: NEEDS_RENTAL,
  unavailableText: NEEDS_RENTAL_TEXT,
  steps: [
    {
      id: 'rentals.car.which',
      label: 'The car',
      title: 'Which car goes out',
      body: 'The car on this rental, its plate, and its status in your fleet right now. Open vehicle takes you to its record.',
      ...at('vehicle'),
      anchors: [sec('rental-car'), PANEL_TITLE],
      side: 'bottom',
    },
    {
      id: 'rentals.car.swap',
      label: 'Swapping',
      title: 'Swapping the car',
      body: 'Clear vehicle lets you pick another car while the rental is Pending or Active. The price stays as it was.',
      ...atEdit('vehicle'),
      anchors: [sec('rental-vehicle-action')],
      side: 'bottom',
      notes: [{ text: 'Once the keys are out, a swap counts as a breakdown and I ask you what happened.' }],
    },
    {
      id: 'rentals.car.mileage',
      label: 'Mileage',
      title: 'How far it can go',
      body: 'The allowance for each hire length, with this hire’s one marked, and what going over costs. Anything over is worked out from the odometer readings at handover.',
      ...at('vehicle'),
      anchors: [sec('rental-vehicle-mileage'), PANEL_TITLE],
      side: 'bottom',
    },
    {
      id: 'rentals.car.pricing',
      label: 'Pricing',
      title: 'What it rents for',
      body: 'The car’s daily, weekly and monthly rates, with this hire’s rate marked, and what this rental is priced at.',
      ...at('vehicle'),
      anchors: [sec('rental-vehicle-pricing'), PANEL_TITLE],
      side: 'bottom',
    },
    {
      id: 'rentals.car.addons',
      label: 'Add-ons',
      title: 'Extras on top',
      body: 'Child seats, toll passes and anything else from your catalogue. While the rental can still change, add them here and Save extras adds the charge.',
      ...at('extras'),
      anchors: [sec('rental-addons'), PANEL_TITLE],
      side: 'bottom',
      notes: [{ text: 'Once it is locked, they show as they were booked.' }],
    },
    {
      id: 'rentals.car.drivers',
      label: 'Drivers',
      title: 'Anyone else driving',
      body: 'Other drivers on this rental. Each one gets their own ID check and signs too.',
      ...at('extras'),
      anchors: [sec('rental-drivers'), PANEL_TITLE],
      side: 'top',
      notes: [{ text: 'A driver the renter added from their own portal is listed only. They are not on the agreement or the insurance.' }],
    },
  ],
};

const dates: TabTourTopic = {
  id: 'rentals.dates',
  title: 'Dates and places',
  summary: 'When it goes out and comes back, how it changes hands, and where.',
  requires: NEEDS_RENTAL,
  unavailableText: NEEDS_RENTAL_TEXT,
  steps: [
    {
      id: 'rentals.dates.when',
      label: 'Dates',
      title: 'Out and back',
      body: 'Pickup and drop-off, with their times, in your time zone. While the rental can still change, open this bar to pick new dates on the car’s own calendar.',
      ...at('when'),
      anchors: [sec('rental-dates'), PANEL_TITLE],
      side: 'bottom',
    },
    {
      id: 'rentals.dates.how',
      label: 'How',
      title: 'How it changes hands',
      body: 'For each end: they come to you, use one of your saved locations, or you deliver and collect. Your choices and their fees come from Settings, under Locations.',
      ...at('when'),
      anchors: [sec('rental-places'), PANEL_TITLE],
      side: 'bottom',
      notes: [{ text: 'While the rental can still change, a promo code can be added here too.' }],
    },
    {
      id: 'rentals.dates.map',
      label: 'Map',
      title: 'On the map',
      body: 'P is pickup and R is drop-off. Your own places are shown too, with your delivery area if you have one.',
      ...at('when'),
      anchors: [sec('rental-map'), PANEL_TITLE],
      side: 'top',
    },
    {
      id: 'rentals.dates.money',
      label: 'Price',
      title: 'Changing it moves the money',
      body: 'Change something and a bar shows the new price before you save. New dates re-price the whole rental; a new place only changes its fee.',
      ...at('when'),
      anchors: [sec('rental-places'), PANEL_TITLE],
      side: 'bottom',
    },
    {
      id: 'rentals.dates.locked',
      label: 'Locked',
      title: 'When it locks',
      body: 'Once the rental is no longer Pending, or the agreement, cover, a payment or the handover has happened, the dates are fixed. A Locked note then shows up here and tells you why.',
      ...at('when'),
      anchors: [sec('rental-stage-locked'), PANEL_TITLE],
      side: 'bottom',
    },
  ],
};

const agreement: TabTourTopic = {
  id: 'rentals.agreement',
  title: 'The agreement',
  summary: 'Sending it to sign, where it got to, its template, and when it goes stale.',
  requires: NEEDS_RENTAL,
  unavailableText: NEEDS_RENTAL_TEXT,
  steps: [
    {
      id: 'rentals.agreement.send',
      label: 'Send',
      title: 'Send it to sign',
      body: 'I email the customer a link to sign the agreement online. After the first send, this reads Send an updated agreement.',
      ...atEdit('agreement'),
      anchors: [sec('rental-agreement-send')],
      side: 'bottom',
      notes: [{ text: 'It needs the customer’s name and email address.' }],
    },
    {
      id: 'rentals.agreement.status',
      label: 'Status',
      title: 'Where it got to',
      body: 'The tag says Not sent, Awaiting signature, Opened not signed, or Signed. Open shows the document, and Signed copy is the one they signed.',
      ...at('agreement'),
      anchors: [sec('rental-agreement-doc'), PANEL_TITLE],
      side: 'bottom',
      notes: [{ text: 'A Test tag means it was sent in test mode: watermarked, and deleted after 14 days.' }],
    },
    {
      id: 'rentals.agreement.template',
      label: 'Template',
      title: 'Which template it uses',
      body: 'The template the next send will use. Change picks another, Preview shows it filled in with this rental, and Edit changes the template itself.',
      ...at('agreement'),
      anchors: [sec('rental-agreement-template'), PANEL_TITLE],
      side: 'top',
      notes: [{ text: 'Saving an edit changes that template for every later agreement that uses it.' }],
    },
    {
      id: 'rentals.agreement.stale',
      label: 'Out of date',
      title: 'When the terms move',
      body: 'If the dates or the car change after it was sent, I put a banner here saying it no longer matches. Send an updated one, or keep the one they have.',
      ...at('agreement'),
      anchors: [sec('rental-agreement-doc'), PANEL_TITLE],
      side: 'bottom',
      notes: [{ text: 'Earlier versions are kept, because a customer may have signed one of them.' }],
    },
    {
      id: 'rentals.agreement.keys',
      label: 'Before the keys',
      title: 'Signed before the keys go',
      body: 'The car cannot go out until the agreement is signed. Handover tells you if it is still waiting.',
      ...at('agreement'),
      anchors: [rail('handover'), sec('rental-agreement-doc'), PANEL_TITLE],
      mobileAnchors: [sec('rental-agreement-doc'), PANEL_TITLE],
      side: 'right',
    },
  ],
};

const insurance: TabTourTopic = {
  id: 'rentals.insurance',
  title: 'Insurance',
  summary: 'Bonzah cover for these dates, or the customer’s own policy.',
  requires: NEEDS_RENTAL,
  unavailableText: NEEDS_RENTAL_TEXT,
  steps: [
    {
      id: 'rentals.insurance.buy',
      label: 'Buy cover',
      title: 'Cover for this hire',
      body: 'Add Bonzah cover opens a quote priced for this car and these dates. If Bonzah cannot cover it, hover the button and I tell you why.',
      ...atEdit('insurance'),
      anchors: [sec('rental-insurance-buy')],
      side: 'bottom',
      notes: [{ text: 'Cover you buy is added to the rental as a charge, to take on Payments.' }],
    },
    {
      id: 'rentals.insurance.facts',
      label: 'The policy',
      title: 'The policy at a glance',
      body: 'The policy number, the dates it covers, how many days and the premium. Before anything is bought, it shows what the cover would cost.',
      ...at('insurance'),
      anchors: [sec('rental-bonzah-facts'), PANEL_TITLE],
      side: 'bottom',
    },
    {
      id: 'rentals.insurance.covers',
      label: 'Covers',
      title: 'Four kinds of cover',
      body: 'Collision damage, liability to others, extra liability up to $1M, and personal accident. Each tile says what it pays for and what it costs.',
      ...at('insurance'),
      anchors: [sec('rental-bonzah-covers'), PANEL_TITLE],
      side: 'bottom',
    },
    {
      id: 'rentals.insurance.stale',
      label: 'Out of date',
      title: 'If the dates move',
      body: 'A policy covers fixed dates. If the rental now runs longer, I say how many days the car is not covered and offer to re-quote.',
      ...at('insurance'),
      anchors: [sec('rental-bonzah-facts'), PANEL_TITLE],
      side: 'bottom',
    },
    {
      id: 'rentals.insurance.own',
      label: 'Their own',
      title: 'Their own insurance',
      body: 'If the customer has their own policy, upload the certificate here, as a PDF or a photo. I read it and check it.',
      ...at('insurance'),
      anchors: [sec('rental-own-policy'), PANEL_TITLE],
      side: 'top',
    },
  ],
};

const payments: TabTourTopic = {
  id: 'rentals.payments',
  title: 'Payments and the deposit',
  summary: 'What is owed, the deposit hold, taking money, and cancelling.',
  requires: NEEDS_RENTAL,
  unavailableText: NEEDS_RENTAL_TEXT,
  steps: [
    {
      id: 'rentals.payments.owed',
      label: 'Owed',
      title: 'What is still owed',
      body: 'The big number is what is left to pay, or Settled when nothing is. Beside it, the sum: total charged, minus what was paid.',
      ...at('payments'),
      anchors: [sec('rental-outstanding'), PANEL_TITLE],
      side: 'bottom',
      notes: [{ text: 'It reads Overdue when a charge is past its due date and still not paid.' }],
    },
    {
      id: 'rentals.payments.deposit',
      label: 'Deposit',
      title: 'The deposit sits apart',
      body: 'A hold on a card is not money received, so the deposit is never in the totals. Charge or release a hold here, or take one if there is none.',
      ...at('payments'),
      anchors: [sec('rental-deposit'), sec('rental-outstanding'), PANEL_TITLE],
      side: 'bottom',
    },
    {
      id: 'rentals.payments.take',
      label: 'Take a payment',
      title: 'Taking money',
      body: 'Take a payment first asks what it is for and shows the amount before anything moves. Then you charge the card on file, send a link, or record it by hand.',
      ...atEdit('payments'),
      anchors: [sec('rental-payment-actions')],
      side: 'bottom',
      notes: [{ text: 'Add a charge puts a fine or another cost on the rental.' }],
    },
    {
      id: 'rentals.payments.charges',
      label: 'Charges',
      title: 'Every charge',
      body: 'What the rental owes, the ones still owed first, each with what is paid and what is left. Open the card to see them all.',
      ...at('payments'),
      anchors: ['[aria-label="Open all charges"]', PANEL_TITLE],
      side: 'top',
    },
    {
      id: 'rentals.payments.received',
      label: 'Payments',
      title: 'Every payment',
      body: 'Money that came in, and how it was paid. A payment someone typed in by hand says so. Open the card for the full list.',
      ...at('payments'),
      anchors: ['[aria-label="Open all payments"]', PANEL_TITLE],
      side: 'top',
    },
    {
      id: 'rentals.payments.cancel',
      label: 'Cancel',
      title: 'Cancelling a rental',
      body: 'Cancel rental works only before the car goes out. You pick a full, part or no refund, and I email the customer.',
      ...atEdit('payments'),
      anchors: [sec('rental-cancel')],
      side: 'bottom',
      notes: [{ text: 'Once the car is out, end the rental on Handover instead.' }],
    },
  ],
};

const handover: TabTourTopic = {
  id: 'rentals.handover',
  title: 'Handover and return',
  summary: 'The car going out and coming back: photos, readings, damage.',
  requires: NEEDS_RENTAL,
  unavailableText: NEEDS_RENTAL_TEXT,
  steps: [
    {
      id: 'rentals.handover.ready',
      label: 'Before the keys',
      title: 'Before the keys go',
      body: 'Confirm collection opens once the agreement is signed and nothing is owed. Until then I list what is missing, each with a link to fix it.',
      ...at('handover'),
      anchors: [sec('rental-handover-missing'), sec('rental-handover-giving'), PANEL_TITLE],
      side: 'bottom',
    },
    {
      id: 'rentals.handover.out',
      label: 'Going out',
      title: 'When the car goes out',
      body: 'Add photos, the odometer reading and any notes. Photos are numbered in the order taken, so shoot the same angles in the same order both times.',
      ...at('handover'),
      anchors: [sec('rental-handover-giving'), PANEL_TITLE],
      side: 'bottom',
      notes: [{ text: 'If you use lockboxes, how the keys are collected is chosen on this page too.' }],
    },
    {
      id: 'rentals.handover.back',
      label: 'Coming back',
      title: 'When it comes back',
      body: 'The same photos, reading and notes for the return. This half stays locked until the car has gone out.',
      ...at('handover'),
      anchors: [sec('rental-handover-receiving'), PANEL_TITLE],
      side: 'top',
      notes: [{ text: 'With both readings in, I work out how far it went against the allowance.' }],
    },
    {
      id: 'rentals.handover.confirm',
      label: 'Confirm',
      title: 'Confirm out, then back',
      body: 'Confirm collection records the car going out and, once approved and paid, makes the rental Active, emails the customer and places the deposit hold. Confirm return closes it and releases the hold.',
      ...atEdit('handover'),
      anchors: [sec('rental-handover-confirm')],
      side: 'top',
      notes: [{ text: 'A confirmed handover can be undone if it was a mistake.' }],
    },
    {
      id: 'rentals.handover.damage',
      label: 'Damage',
      title: 'Spotting new damage',
      body: 'With photos on both sides, I can compare them pair by pair and flag new damage. It is a prompt to go and look, and it charges nobody.',
      ...at('handover'),
      anchors: [sec('rental-damage'), PANEL_TITLE],
      side: 'top',
    },
  ],
};

const elsewhere: TabTourTopic = {
  id: 'rentals.elsewhere',
  title: 'Messages, history and emails',
  summary: 'The panels beside a rental, and what the customer is sent.',
  requires: NEEDS_RENTAL,
  unavailableText: NEEDS_RENTAL_TEXT,
  steps: [
    {
      id: 'rentals.elsewhere.management',
      label: 'Management',
      title: 'How it is booked',
      body: 'Management shows the original booking: its dates, how many days and what it comes to.',
      ...at('customer'),
      anchors: [railTab('management'), '[data-tour="rental-right-rail"]'],
      mobileAnchors: [dockTab('Management')],
      side: 'left',
    },
    {
      id: 'rentals.elsewhere.messages',
      label: 'Messages',
      title: 'Talk to the customer',
      body: 'Your conversation with this customer, by in-app chat, text, email or a call, without leaving the rental.',
      ...at('customer'),
      anchors: [railTab('messages'), '[data-tour="rental-right-rail"]'],
      mobileAnchors: [dockTab('Messages')],
      side: 'left',
    },
    {
      id: 'rentals.elsewhere.notifications',
      label: 'Notifications',
      title: 'Alerts for this rental',
      body: 'Only the notifications about this rental: the booking, payments, signing, refunds and deposit holds.',
      ...at('customer'),
      anchors: [railTab('notifications'), '[data-tour="rental-right-rail"]'],
      mobileAnchors: [dockTab('Notifications')],
      side: 'left',
    },
    {
      id: 'rentals.elsewhere.activity',
      label: 'Activity',
      title: 'What has happened',
      body: 'Everything this rental has done, in order: created, the agreement sent and signed, payments and refunds, the car going out and coming back.',
      ...at('customer'),
      anchors: [railTab('activity'), '[data-tour="rental-right-rail"]'],
      mobileAnchors: [dockTab('Activity')],
      side: 'left',
    },
    {
      id: 'rentals.elsewhere.trax',
      label: 'Trax',
      title: 'Ask me about it',
      body: 'Ask me anything about this rental here. I already know which one you mean, and this chat is kept apart from your main one.',
      ...at('customer'),
      anchors: [railTab('trax'), '[data-tour="rental-right-rail"]'],
      mobileAnchors: [dockTab('Trax')],
      side: 'left',
    },
    {
      id: 'rentals.elsewhere.emails',
      label: 'Emails',
      title: 'What the customer gets',
      body: 'I email the customer along the way: the agreement to sign, when the hire starts, when it is complete, and if it is cancelled.',
      ...at('customer'),
      anchors: [],
      side: 'center',
    },
  ],
};

export const RENTALS_TAB_TOUR: TabTour = {
  id: 'rentals',
  label: 'Rentals',
  homeRoute: '/rentals',
  emptyMessage:
    'There is not enough of this tab open to you to walk through. A head admin can widen your access to Rentals.',
  topics: [list, start, record, customer, car, dates, agreement, insurance, payments, handover, elsewhere],
};
