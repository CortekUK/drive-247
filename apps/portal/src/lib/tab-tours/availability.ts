/**
 * The Availability tab tour: five topics, in the order an operator meets them.
 *
 *   1 week      reading the calendar: hours, columns, the word under each date, moving week
 *   2 hours     the weekly hours dialog, opened by the tour itself, and how it saves
 *   3 clock     open 24 hours and the timezone
 *   4 closing   one date: the day editor, closing it for the whole fleet, custom hours
 *   5 site      what this changes on the booking site and for each car
 *
 * The tab has no records, so no topic needs one: every tenant sees a full week
 * (the hours fall back to 9 to 5 when none are set).
 *
 * The screen saves by itself (`use-availability-save.ts`): the weekly pattern,
 * 24 hours, the timezone and whole-day closures. Custom hours for one date are
 * NOT saved (the blocked dates table has no times), and the tour says so.
 *
 * On a phone the week scrolls sideways three days at a time and opens on today,
 * so the column steps point at today's column (`data-today`), not Monday's.
 */

import type { TourStep } from '@/lib/first-rental-tour';
import type { TabTour, TabTourTopic } from './index';

/** The page's own heading: the last resort under the steps that can use it. */
const LIST_HEADING = ['[data-slot="sidebar-inset"] h1', 'main h1'] as const;
const ROUTE = '/blocked-dates';

const CONTROLS = '[data-tour="availability-controls"]';
const TODAY = '[data-tour="availability-day"][data-today]';
const DAY = '[data-tour="availability-day"]';
const TODAY_HEADER = '[data-today] [data-tour="availability-day-header"]';
const DAY_HEADER = '[data-tour="availability-day-header"]';

const HOURS_DIALOG = '[data-tour="availability-hours-dialog"]';
const OPEN_HOURS = { trigger: ['[data-tour="availability-pattern"]'], dialog: HOURS_DIALOG } as const;

const DAY_EDITOR = '[data-tour="availability-day-editor"]';
const OPEN_DAY = { trigger: [TODAY, DAY], dialog: DAY_EDITOR } as const;
const CAN_EDIT = { tab: 'availability', edit: true } as const;

const at = (s: Omit<TourStep, 'route'>): TourStep => ({ route: ROUTE, ...s });

const week: TabTourTopic = {
  id: 'availability.week',
  title: 'Reading the week',
  summary: 'The calendar, the word under each date, and moving between weeks.',
  steps: [
    at({
      id: 'availability.week.hours',
      label: 'The calendar',
      title: 'The week, drawn as hours',
      body: 'The hours run down this edge, and the seven columns are the seven dates of the week.',
      anchors: ['[data-tour="availability-hours"]', ...LIST_HEADING],
      side: 'right',
      notes: [
        { text: 'The hours shown fit your week, with an hour spare either side.' },
        { text: 'A red line across today shows the time now on your own device.', anchors: ['[data-tour="availability-now"]'] },
      ],
    }),
    at({
      id: 'availability.week.day',
      label: 'One date',
      title: 'Each column is one date',
      body: 'The coloured block is the time you are open that day. A grey Closed column is a day you are shut.',
      anchors: [TODAY, DAY, ...LIST_HEADING],
      mobileBody: 'A phone shows three dates at a time. Swipe the calendar sideways to see the rest of the week.',
      side: 'right',
    }),
    at({
      id: 'availability.week.states',
      label: 'Day status',
      title: 'The word under each date',
      body: 'Default follows your weekly hours. Custom means you changed this date on its own, and Blocked means the date is closed in your blocked dates.',
      anchors: [TODAY_HEADER, DAY_HEADER, ...LIST_HEADING],
      side: 'bottom',
      notes: [{ text: 'A date you changed by hand gets an amber dashed outline, so it stands out from the rest.' }],
    }),
    at({
      id: 'availability.week.nav',
      label: 'The week',
      title: 'Moving between weeks',
      body: 'The arrows step one week either way. Tap the dates to pick any week from a calendar, or to jump back to this week.',
      anchors: ['[data-tour="availability-week"]', CONTROLS, ...LIST_HEADING],
      side: 'bottom',
      notes: [{ text: 'A week in the past shows no blocked dates. I only read blocks that end today or later.' }],
    }),
  ],
};

const hours: TabTourTopic = {
  id: 'availability.hours',
  title: 'Your weekly hours',
  summary: 'The hours for each weekday, and how changes are saved. I open it for you.',
  steps: [
    at({
      id: 'availability.hours.button',
      label: 'Hours',
      title: 'Your opening hours live here',
      body: 'Hours opens your hours for each weekday. Hover it to see them in one line. I will open it now.',
      mobileBody: 'Hours opens your hours for each weekday. I will open it now.',
      anchors: ['[data-tour="availability-pattern"]', CONTROLS, ...LIST_HEADING],
      side: 'bottom',
    }),
    at({
      id: 'availability.hours.rows',
      label: 'Weekdays',
      title: 'One row per weekday',
      body: 'Click a day to set it to Open with times, 24 hours or Closed. Apply to This day only or to All days.',
      anchors: ['[data-tour="availability-weekly-hours"]', HOURS_DIALOG],
      side: 'top',
      opens: OPEN_HOURS,
      notes: [
        { text: 'This day only means that weekday every week, not one date.' },
        { text: 'While Open 24 hours is on, these rows are locked.' },
      ],
    }),
    at({
      id: 'availability.hours.weekdays',
      label: 'Set weekdays',
      title: 'Monday to Friday in one go',
      body: 'Set weekdays gives Monday to Friday the same opening and closing time. The weekend is left as it is.',
      anchors: ['[data-tour="availability-set-weekdays"]', '[data-tour="availability-weekly-hours"]', HOURS_DIALOG],
      side: 'bottom',
      opens: OPEN_HOURS,
    }),
    at({
      id: 'availability.hours.saves',
      label: 'Saving',
      title: 'There is no Save button',
      body: 'I save your hours when you close this window. Every date that follows the weekly hours changes with them.',
      anchors: ['[data-tour="availability-hours-saves"]', HOURS_DIALOG],
      side: 'top',
      opens: OPEN_HOURS,
      notes: [{ text: 'If a save fails, I tell you.' }],
    }),
  ],
};

const clock: TabTourTopic = {
  id: 'availability.clock',
  title: '24 hours and timezone',
  summary: 'Opening around the clock, and which clock your times are on.',
  steps: [
    at({
      id: 'availability.clock.always',
      label: 'Open 24 hours',
      title: 'Open around the clock',
      body: 'Turn this on and every day can be booked at any hour. The times for each day stop applying until you turn it off.',
      anchors: ['[data-tour="availability-always-open"]', HOURS_DIALOG],
      side: 'bottom',
      opens: OPEN_HOURS,
    }),
    at({
      id: 'availability.clock.calendar',
      label: 'On the calendar',
      title: 'How 24 hours looks',
      body: 'A day open around the clock shows a short Open 24 hours bar at the top of its column instead of a block of hours.',
      anchors: [TODAY, DAY, ...LIST_HEADING],
      side: 'right',
      closesDialogs: true,
    }),
    at({
      id: 'availability.clock.zone',
      label: 'Timezone',
      title: 'Which clock your times are on',
      body: 'Every time on this screen is read in this zone, and the button shows the time there now. Pick another zone to change it.',
      anchors: ['[data-tour="availability-timezone"]', CONTROLS, ...LIST_HEADING],
      side: 'bottom',
      notes: [{ text: 'Search the list by city or country.' }],
    }),
    at({
      id: 'availability.clock.real',
      label: 'A real setting',
      title: 'Nine to five means nine to five there',
      body: 'The zone is saved with your hours. Your booking site reads pickup and return times in this zone too.',
      anchors: ['[data-tour="availability-timezone"]', CONTROLS, ...LIST_HEADING],
      side: 'bottom',
    }),
  ],
};

const closing: TabTourTopic = {
  id: 'availability.closing',
  title: 'Closing a date',
  summary: 'Changing one date: closing it for every car, or custom hours. I open a date for you.',
  steps: [
    at({
      id: 'availability.closing.click',
      label: 'Open a date',
      title: 'Click a date to change it',
      body: 'Clicking a date opens it on its own, without touching your weekly hours. I will open today for you.',
      anchors: [TODAY, DAY],
      side: 'right',
      requires: CAN_EDIT,
    }),
    at({
      id: 'availability.closing.choices',
      label: 'Three choices',
      title: 'Three choices for one date',
      body: 'Follow the weekly default, custom hours for this day only, or closed all day. The tick shows which one the date has now.',
      anchors: ['[data-tour="availability-day-modes"]', DAY_EDITOR],
      side: 'left',
      opens: OPEN_DAY,
      requires: CAN_EDIT,
    }),
    at({
      id: 'availability.closing.closed',
      label: 'Closed all day',
      title: 'Closed for the whole fleet',
      body: 'Closed all day saves the date as blocked for every car, so no booking can start or end on it. It then shows as Blocked.',
      anchors: ['[data-tour="availability-day-modes"]', DAY_EDITOR],
      side: 'left',
      opens: OPEN_DAY,
      requires: CAN_EDIT,
    }),
    at({
      id: 'availability.closing.custom',
      label: 'Custom hours',
      title: 'Custom hours are not saved',
      body: 'Custom hours show on the calendar but are not kept, because a blocked date holds whole days only. I warn you when you set them.',
      anchors: ['[data-tour="availability-day-modes"]', DAY_EDITOR],
      side: 'left',
      opens: OPEN_DAY,
      requires: CAN_EDIT,
      notes: [{ text: 'To keep a date shut, close it all day instead.' }],
    }),
    at({
      id: 'availability.closing.blocked',
      label: 'Blocked dates',
      title: 'Blocked dates already in place',
      body: 'A blocked date is shaded red with its reason. Open it and I list every block behind it, for the whole fleet or one car.',
      anchors: ['[data-tour="availability-blocked"]', TODAY, DAY, ...LIST_HEADING],
      side: 'right',
      closesDialogs: true,
    }),
  ],
};

const site: TabTourTopic = {
  id: 'availability.site',
  title: 'Your site and each car',
  summary: 'What these hours and closed dates change for customers and for one car.',
  steps: [
    at({
      id: 'availability.site.hours',
      label: 'Opening hours',
      title: 'Customers see your hours',
      body: 'The contact page on your booking site lists these weekly hours as your pickup and return hours.',
      anchors: ['[data-tour="availability-pattern"]', CONTROLS, ...LIST_HEADING],
      side: 'bottom',
    }),
    at({
      id: 'availability.site.closed',
      label: 'Closed dates',
      title: 'A closed date blocks every car',
      body: 'A date closed for the whole fleet cannot be picked for any car on your booking site.',
      anchors: ['[data-tour="availability-blocked"]', TODAY, DAY, ...LIST_HEADING],
      side: 'right',
    }),
    at({
      id: 'availability.site.car',
      label: 'One car',
      title: 'When only one car is out',
      body: 'A block on one car does not close the day. The column counts it at the foot, like 1 vehicle out, and you stay open.',
      anchors: ['[data-tour="availability-vehicles-out"]', TODAY, DAY, ...LIST_HEADING],
      side: 'right',
    }),
    at({
      id: 'availability.site.where',
      label: 'Where to block one car',
      title: 'Blocking one car',
      body: 'To block a single car, open it in Vehicles and add a blocked period under Availability on its record. This screen is for the whole fleet.',
      anchors: [...LIST_HEADING],
      side: 'bottom',
    }),
  ],
};

export const AVAILABILITY_TAB_TOUR: TabTour = {
  id: 'availability',
  label: 'Availability',
  homeRoute: ROUTE,
  emptyMessage:
    'There is not enough of this tab open to you to walk through. A head admin can widen your access to Availability.',
  topics: [week, hours, clock, closing, site],
};
