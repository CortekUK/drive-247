/**
 * The Vehicles tab tour: eleven topics, in the order an operator meets them.
 *
 *   1 fleet       the list page: graph, card, search, filters, rows, statuses, export
 *   2 add         the Add Vehicle form, opened by the tour itself
 *   3 record      what opening a car gives you, and how it saves
 *   4 photos      cover photo, adding, reordering, removing
 *   5 prices      the three rates, which lengths are offered, deposit, mileage
 *   6 surcharges  extras, weekends, holidays and single days
 *   7 booking     why a car cannot be booked: pause, blocked periods
 *   8 keys        pickup location, lockbox, keys and papers
 *   9 upkeep      certificates, servicing and its history
 *  10 site        what customers see, and why a car might be hidden
 *  11 money       what it earned and cost, and retiring it
 *
 * Topics 3 to 11 open a real car: the first one the page has drawn (see
 * `readSampleIds`). With no car yet they show as locked in the menu.
 *
 * Every record anchor is a section heading in `components/vehicles-v2`. A
 * section without its own `tourId` is marked from its title by `Section` in
 * `kit.tsx` (`vsec-<title>`), so renaming a section heading means updating
 * the selector here too.
 */

import type { TourStep } from '@/lib/first-rental-tour';
import { recordRoute, type TabTour, type TabTourTopic } from './index';

/** The list page's own heading: the last resort under every list step. */
const LIST_HEADING = ['[data-slot="sidebar-inset"] h1', 'main h1'] as const;
/** The record's section heading, on every section. */
const PANEL = '[data-tour="vehicle-panel"]';
/** A record section's row in the left rail (laptop). */
const rail = (section: string) => `[data-sidebar="sidebar"] a[href*="section=${section}"]`;
/** A section heading on the record, by its marker. */
const sec = (id: string) => `[data-tour="${id}"]`;
const at = (section: string): Pick<TourStep, 'route' | 'routeFor' | 'requires'> => ({
  route: '/vehicles',
  routeFor: (ctx) => recordRoute(ctx.sampleIds?.vehicleId, '/vehicles', `section=${section}`),
  requires: { record: 'vehicleId' },
});

const ADD_DIALOG = '[data-tour="add-vehicle-dialog"]';
const OPEN_ADD = {
  trigger: ['[data-tour="add-vehicle"] button', '[data-tour="vehicles-empty"] button'],
  dialog: ADD_DIALOG,
} as const;
const NEEDS_CAR = { record: 'vehicleId' } as const;
const NEEDS_CAR_TEXT = 'Add your first car to open this topic.';

const fleet: TabTourTopic = {
  id: 'vehicles.fleet',
  title: 'Your fleet at a glance',
  summary: 'The list page: the graph, finding a car, and what each status means.',
  steps: [
    {
      id: 'vehicles.fleet.chart',
      label: 'Cars on rent',
      title: 'How busy your fleet is',
      body: 'This graph counts your cars out on rent. The big number is today, and the line shows the period you pick, with the one before it dotted.',
      route: '/vehicles',
      anchors: ['[data-tour="vehicles-chart"]', '[data-tour="fleet-overview"]', ...LIST_HEADING],
      side: 'bottom',
      requires: { record: 'vehicleId' },
    },
    {
      id: 'vehicles.fleet.card',
      label: 'The card',
      title: 'One idea at a time',
      body: 'The card beside the graph points you to one place worth a look for your fleet. Open takes you straight there.',
      route: '/vehicles',
      anchors: ['[data-tour="vehicles-featured"]'],
      side: 'bottom',
      requires: { record: 'vehicleId' },
    },
    {
      id: 'vehicles.fleet.search',
      label: 'Search',
      title: 'Find a car fast',
      body: 'I search this list by plate, make, model and colour as you type. Clear the box to see every car again.',
      route: '/vehicles',
      anchors: ['input[aria-label="Search vehicles…"]', 'button[aria-label="Search this page"]'],
      mobileAnchors: ['[data-mobile-tab-bar] button[aria-label="Search"]', 'button[aria-label="Search this page"]'],
      mobileBody: 'Search is at the bottom. Here it finds cars by plate, make, model or colour, and the filter button beside the box narrows by status, make, year and profit.',
      side: 'bottom',
      requires: { record: 'vehicleId' },
    },
    {
      id: 'vehicles.fleet.filters',
      label: 'Filters',
      title: 'Narrow it down',
      body: 'Filters turn the graph over to show status, make, year and profit. The graph then counts only the cars you filtered to.',
      route: '/vehicles',
      anchors: ['button[aria-label="Show filters"]', 'button[aria-label="Hide filters"]'],
      side: 'bottom',
      // On a phone the filter button only shows once search is open; the search step covers it.
      requires: { record: 'vehicleId', desktop: true },
    },
    {
      id: 'vehicles.fleet.row',
      label: 'A car',
      title: 'Each row is one car',
      body: 'Hover the plate to see its cover photo, and click anywhere on the row to open the car. Newest cars come first.',
      route: '/vehicles',
      anchors: ['[data-tour="vehicle-row"]'],
      side: 'bottom',
      requires: { record: 'vehicleId' },
    },
    {
      id: 'vehicles.fleet.status',
      label: 'Status',
      title: 'What the status means',
      body: 'Available can be booked, Rented is out now, Paused is off your site by choice, and Unavailable has every hire length switched off. Disposed cars are retired.',
      route: '/vehicles',
      anchors: ['[data-tour="vehicle-row"]'],
      side: 'bottom',
      requires: { record: 'vehicleId' },
      notes: [{ text: 'An Unavailable car is greyed out and its name is struck through.' }],
    },
    {
      id: 'vehicles.fleet.export',
      label: 'Export',
      title: 'Take the list with you',
      body: 'This downloads the list as a spreadsheet, with any search or filters you have on.',
      route: '/vehicles',
      anchors: ['button[aria-label="Export CSV"]'],
      side: 'bottom',
      requires: { record: 'vehicleId' },
    },
    // An empty fleet: the page is one teaching card, so the topic teaches from it.
    {
      id: 'vehicles.fleet.empty-first',
      label: 'The first car',
      title: 'Start with one real car',
      body: 'Use the car you actually mean to rent, not a test one. What you put on it is what customers see and pay on your booking site.',
      route: '/vehicles',
      anchors: ['[data-tour="vehicles-empty"] h3', ...LIST_HEADING],
      side: 'bottom',
      requires: { noRecord: 'vehicleId' },
    },
    {
      id: 'vehicles.fleet.empty-holds',
      label: 'One record',
      title: 'One car, everything about it',
      body: 'Photos, prices, the dates it cannot be booked, its papers and what it earns. A few answers create it, and the rest waits on its record.',
      route: '/vehicles',
      anchors: ['[data-tour="vehicles-empty-points"]', '[data-tour="vehicles-empty"]', ...LIST_HEADING],
      side: 'bottom',
      requires: { noRecord: 'vehicleId' },
    },
    {
      id: 'vehicles.fleet.empty-later',
      label: 'When it fills',
      title: 'What this page becomes',
      body: 'Once you have cars, this page shows how many are out on rent, a search, filters and one row per car. I will walk you through it then.',
      route: '/vehicles',
      anchors: ['[data-tour="vehicles-empty"]', ...LIST_HEADING],
      side: 'bottom',
      requires: { noRecord: 'vehicleId' },
    },
  ],
};

const add: TabTourTopic = {
  id: 'vehicles.add',
  title: 'Adding a car',
  summary: 'The Add Vehicle form, screen by screen. I open it for you.',
  steps: [
    {
      id: 'vehicles.add.button',
      label: 'Add Vehicle',
      title: 'Adding starts here',
      body: 'Add Vehicle opens a short form with one question per screen. I will open it now so you can see it.',
      route: '/vehicles',
      anchors: ['[data-tour="add-vehicle"]', '[data-tour="vehicles-empty"] button'],
      side: 'bottom',
      requires: { tab: 'vehicles', edit: true },
    },
    {
      id: 'vehicles.add.basics',
      label: 'The car',
      title: 'The basics first',
      body: 'Make, model, year and colour. I use them to look up what cars like this rent for, and suggest a price later in the form.',
      route: '/vehicles',
      anchors: ['[data-tour="add-vehicle-fields"]', ADD_DIALOG],
      side: 'top',
      opens: OPEN_ADD,
      requires: { tab: 'vehicles', edit: true },
    },
    {
      id: 'vehicles.add.dots',
      label: 'Screens',
      title: 'Eleven short screens',
      body: 'These dots are the screens. Next checks the one you are on before moving, and Back keeps everything you typed.',
      route: '/vehicles',
      anchors: [`${ADD_DIALOG} ol[aria-label^="Step "]`, ADD_DIALOG],
      side: 'top',
      opens: OPEN_ADD,
      requires: { tab: 'vehicles', edit: true },
    },
    {
      id: 'vehicles.add.middle',
      label: 'What it asks',
      title: 'What the next screens ask',
      body: 'Plate and VIN, how you got it, your three rates, mileage, which hire lengths you offer, due dates, paperwork, keys, and a line for your booking site.',
      route: '/vehicles',
      anchors: [`${ADD_DIALOG} h3`, ADD_DIALOG],
      side: 'bottom',
      opens: OPEN_ADD,
      requires: { tab: 'vehicles', edit: true },
      notes: [{ text: 'A screen only needs its required fields to move on. Anything else can wait for the car’s record.' }],
    },
    {
      id: 'vehicles.add.photos',
      label: 'Photos',
      title: 'Photos come last',
      body: 'The form will not save without at least one photo. The first one becomes the cover on your booking site.',
      route: '/vehicles',
      anchors: [`${ADD_DIALOG} ol[aria-label^="Step "]`, ADD_DIALOG],
      side: 'top',
      opens: OPEN_ADD,
      requires: { tab: 'vehicles', edit: true },
    },
    {
      id: 'vehicles.add.done',
      label: 'Added',
      title: 'When it is in',
      body: 'I tell you if anything still stops it being rented, like a missing price. Open it to finish, or add the next car straight away.',
      route: '/vehicles',
      anchors: [ADD_DIALOG],
      side: 'center',
      opens: OPEN_ADD,
      requires: { tab: 'vehicles', edit: true },
    },
  ],
};

const record: TabTourTopic = {
  id: 'vehicles.record',
  title: "The car's record",
  summary: 'Opening a car: its sections, how it saves, and what it is doing.',
  requires: NEEDS_CAR,
  unavailableText: NEEDS_CAR_TEXT,
  steps: [
    {
      id: 'vehicles.record.sections',
      label: 'Sections',
      title: 'Everything about one car',
      body: 'A car has nine sections, in the order you set one up: the car, its prices, how it runs, then its listing and its money.',
      ...at('vehicle'),
      anchors: ['[data-sidebar="sidebar"] [data-sidebar="content"]', rail('vehicle')],
      mobileAnchors: ['[data-record-dock]'],
      mobileBody: 'A car has nine sections. The button in the middle of this bar lists them all and shows which one you are on.',
      side: 'right',
    },
    {
      id: 'vehicles.record.saves',
      label: 'Saving',
      title: 'There is no Save button',
      body: 'What you change is saved as you type or pick it. Each section says what it is for right under its name.',
      ...at('vehicle'),
      anchors: [PANEL],
      side: 'bottom',
    },
    {
      id: 'vehicles.record.overview',
      label: 'Overview',
      title: 'What it is doing now',
      body: 'Overview shows the car at a glance: whether it is on hire, anything that needs your attention, and its key numbers. Activity and Timeline show what has happened to it.',
      ...at('vehicle'),
      // A wide screen shows it as a column; narrower ones put it on the bar at the bottom.
      anchors: ['aside[aria-label="Timeline & vehicle overview"]', '[data-record-dock] button[aria-label="Overview"]'],
      side: 'left',
    },
    {
      id: 'vehicles.record.details',
      label: 'The car',
      title: 'What the car is',
      body: 'Make, model, year, colour, plate and VIN. The plate is how I tell your cars apart everywhere in the portal.',
      ...at('vehicle'),
      anchors: [sec('vsec-the-car'), PANEL],
      side: 'top',
    },
    {
      id: 'vehicles.record.description',
      label: 'Description',
      title: 'A line for customers',
      body: 'This text sits under the photos on your booking site. Say what makes the car nice to drive.',
      ...at('vehicle'),
      anchors: [sec('vsec-description'), PANEL],
      side: 'top',
    },
    {
      id: 'vehicles.record.back',
      label: 'Back',
      title: 'Back to the list',
      body: 'All vehicles takes you back to the list. The address keeps the section you are on, so a saved link opens the car right here.',
      ...at('vehicle'),
      anchors: ['[data-sidebar="sidebar"] a[href="/vehicles"]', '[data-record-dock] a[aria-label="All vehicles"]'],
      mobileAnchors: ['[data-record-dock] a[aria-label="All vehicles"]'],
      mobileBody: 'The arrow on the left of this bar takes you back to all your cars. The address keeps the section you are on, so a saved link opens the car right here.',
      side: 'right',
    },
  ],
};

const photos: TabTourTopic = {
  id: 'vehicles.photos',
  title: 'Photos',
  summary: 'The cover photo, adding more, and taking one off.',
  requires: NEEDS_CAR,
  unavailableText: NEEDS_CAR_TEXT,
  steps: [
    {
      id: 'vehicles.photos.cover',
      label: 'Cover',
      title: 'The first photo is the cover',
      body: 'It is what customers see first on your booking site, and how you spot this car everywhere in here.',
      ...at('vehicle'),
      anchors: [sec('vehicle-photos'), PANEL],
      side: 'bottom',
    },
    {
      id: 'vehicles.photos.add',
      label: 'Add photo',
      title: 'Add as many as you like',
      body: 'Add photo takes JPG, PNG or WebP, several at once. A listing without photos gets far fewer bookings.',
      ...at('vehicle'),
      anchors: [`${sec('vehicle-photos')} button`, sec('vehicle-photos'), PANEL],
      side: 'bottom',
      requires: { record: 'vehicleId', tab: 'vehicles', edit: true },
    },
    {
      id: 'vehicles.photos.make-cover',
      label: 'Make cover',
      title: 'Pick a different cover',
      body: 'Every other photo has a Cover button under it. Press it and that photo moves to the front, on your site too.',
      ...at('vehicle'),
      anchors: [sec('vehicle-photos')],
      side: 'bottom',
    },
    {
      id: 'vehicles.photos.remove',
      label: 'Remove',
      title: 'Taking one off',
      body: 'The bin under a photo removes it straight away. If you remove the cover, the next photo takes its place.',
      ...at('vehicle'),
      anchors: [sec('vehicle-photos')],
      side: 'bottom',
    },
  ],
};

const prices: TabTourTopic = {
  id: 'vehicles.prices',
  title: 'Prices',
  summary: 'Daily, weekly and monthly rates, the deposit, and mileage.',
  requires: NEEDS_CAR,
  unavailableText: NEEDS_CAR_TEXT,
  steps: [
    {
      id: 'vehicles.prices.rates',
      label: 'Rates',
      title: 'Three rates',
      body: 'A daily rate for hires under 7 days, a weekly rate and a monthly rate. How long the hire is decides which one a booking uses.',
      ...at('rates'),
      anchors: [sec('vsec-rates'), PANEL],
      side: 'bottom',
    },
    {
      id: 'vehicles.prices.lengths',
      label: 'Hire lengths',
      title: 'Which lengths you offer',
      body: 'These switches decide whether customers can book this car by the day, week or month. Turn all three off and the car leaves your site.',
      ...at('rates'),
      anchors: [sec('vehicle-hire-lengths'), PANEL],
      side: 'top',
    },
    {
      id: 'vehicles.prices.deposit',
      label: 'Deposit',
      title: 'The deposit',
      body: 'This amount is held on the customer’s card when they book. It is a hold, not a charge.',
      ...at('rates'),
      anchors: [sec('vsec-rates'), PANEL],
      side: 'bottom',
      notes: [{ text: 'If your fleet uses one deposit for every car, it is set in Settings instead.' }],
    },
    {
      id: 'vehicles.prices.mileage',
      label: 'Mileage',
      title: 'How far they can drive',
      body: 'Set what is included per daily, weekly and monthly hire, and what each extra mile costs. An empty box means unlimited, not zero.',
      ...at('rates'),
      anchors: [sec('vsec-mileage'), PANEL],
      side: 'top',
    },
    {
      id: 'vehicles.prices.unlimited',
      label: 'Unlimited upgrade',
      title: 'Sell unlimited as an extra',
      body: 'Offer unlimited mileage lets a customer pay to drop the limit at checkout. You set its price per hire length.',
      ...at('rates'),
      anchors: [sec('vsec-mileage'), PANEL],
      side: 'top',
    },
  ],
};

const surcharges: TabTourTopic = {
  id: 'vehicles.surcharges',
  title: 'Weekends and holidays',
  summary: 'Extras, weekend and holiday surcharges, and one-off day prices.',
  requires: NEEDS_CAR,
  unavailableText: NEEDS_CAR_TEXT,
  steps: [
    {
      id: 'vehicles.surcharges.extras',
      label: 'Extras',
      title: 'Extras with this car',
      body: 'Things a customer can add, like a child seat. Switch one on to offer it with this car, and set its price here.',
      ...at('addons'),
      anchors: [sec('vsec-extras'), PANEL],
      side: 'bottom',
    },
    {
      id: 'vehicles.surcharges.weekends',
      label: 'Weekends',
      title: 'Weekends can cost more',
      body: 'The weekend surcharge is set once for the fleet in Settings. This car follows it, opts out, or uses its own percentage or fixed price.',
      ...at('addons'),
      anchors: [sec('vehicle-weekends'), PANEL],
      side: 'bottom',
    },
    {
      id: 'vehicles.surcharges.holidays',
      label: 'Holidays',
      title: 'Holidays work the same way',
      body: 'Holiday periods are set for the fleet in Settings. For each one, this car follows the rule, opts out, or has its own price.',
      ...at('addons'),
      anchors: [sec('vsec-holidays'), PANEL],
      side: 'top',
    },
    {
      id: 'vehicles.surcharges.days',
      label: 'Single days',
      title: 'A price for one day',
      body: 'Set a price on a single date, like a big local event. It wins over the base rate and over both surcharges.',
      ...at('addons'),
      anchors: [sec('vsec-individual-days'), PANEL],
      side: 'top',
      notes: [{ text: 'Surcharges apply to daily hires only, under 7 days.' }],
    },
  ],
};

const booking: TabTourTopic = {
  id: 'vehicles.booking',
  title: 'When a car can be booked',
  summary: 'What stops a booking, pausing a car, and blocking dates.',
  requires: NEEDS_CAR,
  unavailableText: NEEDS_CAR_TEXT,
  steps: [
    {
      id: 'vehicles.booking.blockers',
      label: 'Bookable',
      title: 'Bookable, or not',
      body: 'This says whether customers can book the car right now. If they cannot, it lists every reason in the way.',
      ...at('availability'),
      anchors: [sec('vehicle-blockers'), PANEL],
      side: 'bottom',
    },
    {
      id: 'vehicles.booking.pause',
      label: 'Pause',
      title: 'Pause it',
      body: 'Pausing takes the car off your booking site without deleting anything. A rental already under way carries on.',
      ...at('availability'),
      anchors: [sec('vsec-pause'), PANEL],
      side: 'top',
    },
    {
      id: 'vehicles.booking.blocked',
      label: 'Blocked periods',
      title: 'Block out some dates',
      body: 'Block dates when the car is away, like a service. It stays on your site, and customers just cannot pick those days.',
      ...at('availability'),
      anchors: [sec('vsec-blocked-periods'), PANEL],
      side: 'top',
    },
    {
      id: 'vehicles.booking.elsewhere',
      label: 'Availability tab',
      title: 'The whole fleet at once',
      body: 'Your opening hours, and the dates the whole fleet is closed, are in the Availability tab.',
      ...at('availability'),
      anchors: ['[data-sidebar="sidebar"] [data-tour="nav-/blocked-dates"]', sec('vsec-blocked-periods')],
      mobileAnchors: [sec('vsec-blocked-periods')],
      side: 'right',
    },
  ],
};

const keys: TabTourTopic = {
  id: 'vehicles.keys',
  title: 'Keys and lockbox',
  summary: 'Where it is picked up, lockbox handover, keys and papers.',
  requires: NEEDS_CAR,
  unavailableText: NEEDS_CAR_TEXT,
  steps: [
    {
      id: 'vehicles.keys.location',
      label: 'Pickup',
      title: 'Where it is collected',
      body: 'Pick the location this car lives at. Your locations are set up in Settings, under Locations.',
      ...at('pickup'),
      anchors: [sec('vsec-pickup-location'), PANEL],
      side: 'bottom',
    },
    {
      id: 'vehicles.keys.lockbox',
      label: 'Lockbox',
      title: 'Keys without meeting',
      body: 'Give the lockbox code and where to find the box. I send both to the customer at pickup, by email or text.',
      ...at('pickup'),
      anchors: [sec('vehicle-lockbox'), PANEL],
      side: 'top',
      notes: [{ text: 'Lockbox handover is switched on for the whole fleet in Settings, under Rentals.' }],
    },
    {
      id: 'vehicles.keys.security',
      label: 'Keys',
      title: 'Keys and security',
      body: 'Note the spare key and who holds it, and whether a tracker or immobiliser is fitted. None of this is shown to customers.',
      ...at('keys'),
      anchors: [sec('vsec-keys-security'), PANEL],
      side: 'bottom',
    },
    {
      id: 'vehicles.keys.documents',
      label: 'Documents',
      title: 'Its papers, in one place',
      body: 'Upload the title, insurance certificate, purchase invoice or inspection reports. Download or remove them here any time.',
      ...at('keys'),
      anchors: [sec('vsec-documents'), PANEL],
      side: 'top',
    },
  ],
};

const upkeep: TabTourTopic = {
  id: 'vehicles.upkeep',
  title: 'Upkeep',
  summary: 'Inspection and registration dates, servicing and its costs.',
  requires: NEEDS_CAR,
  unavailableText: NEEDS_CAR_TEXT,
  steps: [
    {
      id: 'vehicles.upkeep.certificates',
      label: 'Certificates',
      title: 'Dates that matter',
      body: 'Inspection, registration and warranty dates. An expired inspection or registration takes the car off your site on its own.',
      ...at('upkeep'),
      anchors: [sec('vehicle-certificates'), PANEL],
      side: 'bottom',
      notes: [{ text: 'I remind you before the inspection or registration is due.' }],
    },
    {
      id: 'vehicles.upkeep.servicing',
      label: 'Servicing',
      title: 'When it needs a service',
      body: 'Keep the odometer up to date and I work out how far it is until the next service.',
      ...at('upkeep'),
      anchors: [sec('vsec-servicing'), PANEL],
      side: 'top',
    },
    {
      id: 'vehicles.upkeep.plan',
      label: 'Service plan',
      title: 'A prepaid service plan',
      body: 'If this car’s servicing is prepaid on a plan, switch it on here, so your team knows the service is already covered.',
      ...at('upkeep'),
      anchors: [sec('vsec-servicing'), PANEL],
      side: 'top',
    },
    {
      id: 'vehicles.upkeep.history',
      label: 'History',
      title: 'Every service logged',
      body: 'Log each service with the work done, what it cost and the odometer. The cost goes straight onto this car’s money, so you see what it really earns.',
      ...at('upkeep'),
      anchors: [sec('vsec-service-history'), PANEL],
      side: 'top',
    },
  ],
};

const site: TabTourTopic = {
  id: 'vehicles.site',
  title: 'On your booking site',
  summary: 'What customers see, and why a car might be hidden.',
  requires: NEEDS_CAR,
  unavailableText: NEEDS_CAR_TEXT,
  steps: [
    {
      id: 'vehicles.site.listing',
      label: 'Listing',
      title: 'Nothing to publish',
      body: 'This is exactly what customers see, as of now. Change a price and the site shows the new price straight away.',
      ...at('listing'),
      anchors: [sec('vehicle-listing'), PANEL],
      side: 'bottom',
    },
    {
      id: 'vehicles.site.built-from',
      label: 'Built from',
      title: 'Built from the other sections',
      body: 'The photos and description come from Vehicle, the prices and mileage from Rates, and the extras from Extras. Fix things there.',
      ...at('listing'),
      anchors: [sec('vehicle-listing'), PANEL],
      side: 'bottom',
    },
    {
      id: 'vehicles.site.hidden',
      label: 'Hidden',
      title: 'When customers cannot see it',
      body: 'If the car is off your site, I list why here: paused, no hire length on, an expired date. Each reason links to its fix.',
      ...at('listing'),
      anchors: [sec('vsec-why-customers-can-t-see-it'), sec('vehicle-listing')],
      side: 'bottom',
    },
    {
      id: 'vehicles.site.switch',
      label: 'Website',
      title: 'See it for yourself',
      body: 'The Website switch at the top of the menu takes you to your booking site, where this car is listed.',
      // The record's own rail replaces the menu, so this step stands on the list.
      route: '/vehicles',
      requires: { record: 'vehicleId' },
      anchors: ['[data-tour="website-switch"]'],
      mobileAnchors: ['button[aria-label="Open menu"]'],
      mobileBody: 'Your booking site is one tap away: open the menu and use the Website switch at the top.',
      side: 'right',
    },
  ],
};

const money: TabTourTopic = {
  id: 'vehicles.money',
  title: 'What it earns',
  summary: 'Its rentals, what it cost, and retiring a car.',
  requires: NEEDS_CAR,
  unavailableText: NEEDS_CAR_TEXT,
  steps: [
    {
      id: 'vehicles.money.rentals',
      label: 'Rentals',
      title: 'Every hire it has been on',
      body: 'All of this car’s rentals, newest first. Open one to see the booking.',
      ...at('money'),
      anchors: [sec('vsec-rentals'), PANEL],
      side: 'bottom',
    },
    {
      id: 'vehicles.money.cost',
      label: 'Cost',
      title: 'What it cost you',
      body: 'How you got it, the price or finance, and services. I set this against what it brought in to show whether the car is ahead.',
      ...at('money'),
      anchors: [sec('vsec-what-it-cost'), PANEL],
      side: 'top',
    },
    {
      id: 'vehicles.money.ledger',
      label: 'Ledger',
      title: 'Where the money went',
      body: 'Every amount in and out for this car, straight from its ledger, so you can see where each number came from.',
      ...at('money'),
      anchors: [sec('vsec-where-it-came-from-and-went'), sec('vsec-what-it-cost')],
      side: 'top',
    },
    {
      id: 'vehicles.money.retire',
      label: 'Retire',
      title: 'When a car leaves the fleet',
      body: 'Sold it? Retire this vehicle records the sale and takes it off the fleet. It leaves your site and takes no bookings, but nothing is deleted.',
      ...at('money'),
      anchors: ['[data-tour="vehicle-retire"]', sec('vsec-retire-this-vehicle'), sec('vsec-retired'), PANEL],
      side: 'top',
      notes: [{ text: 'A car out on hire cannot be retired until that rental is closed.' }],
    },
  ],
};

export const VEHICLES_TAB_TOUR: TabTour = {
  id: 'vehicles',
  label: 'Vehicles',
  homeRoute: '/vehicles',
  emptyMessage:
    'There is not enough of this tab open to you to walk through. A head admin can widen your access to Vehicles.',
  topics: [fleet, add, record, photos, prices, surcharges, booking, keys, upkeep, site, money],
};
