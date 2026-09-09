/**
 * The Availability tab tour — one screen, one run, and no record to walk into.
 *
 * The fifth and last of the tab tours. Ghulam named the set at [24:20]:
 * "billing ka humne koi tour nahi dena, integration ka bhi nahi, dashboard ka
 * bhi nahi — baaki AVAILABILITY ka tour de denge hum." Billing, Integrations
 * and Dashboard get nothing; Availability was the one still owed.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TOUR IS FLAT, AND WHY THAT IS NOT A SHORTFALL
 *
 * Rule 3 of the tab tours is "into the record, not just the list", because that
 * is where the unguessable things live. This tab has no records at ALL — no
 * `/blocked-dates/<id>` route, no rows, no detail page. It is a single screen
 * that draws the same seven columns for a tenant on their first day as for one
 * with a thousand rentals.
 *
 * So there are no `routeFor` steps and every anchor sits on one pathname. That
 * is the honest shape of this tab, the same way it is for Payments.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS ONE RUN AND NOT TWO — checked, not assumed
 *
 * The other four tours are really two tours each: a full walkthrough and a
 * shorter one for the operator whose tab is still empty. `requires.record` /
 * `requires.noRecord` split the first three; `requires.tabHasData` /
 * `requires.tabIsEmpty` split Payments, resolved from `ctx.emptyTabs`, which
 * `launch()` fills from `readEmptyTabs()` — a DOM read for
 * `[data-tour="<tab>-empty"]`, the marker every `TeachingEmptyState` carries.
 *
 * NEITHER PAIR CAN TELL THE TRUTH HERE, and both fail in the quiet direction.
 *
 *  - `record` / `noRecord` name a field in `ctx.sampleIds`, which holds one id
 *    each for vehicles, customers and rentals. There is no availability id to
 *    put there, and `/blocked-dates` draws no `a[href^="/rentals/<uuid>"]` or
 *    `data-record-id` for `readSampleIds()` to find — so every id is null on
 *    this route on EVERY account, and a `record` guard would drop its step for
 *    everybody while a `noRecord` guard would keep its step for everybody.
 *
 *  - `tabHasData` / `tabIsEmpty` need a teaching empty state to key on, and
 *    `components/empty-states/lean-empty-states.tsx` has none for this tab.
 *    There is nothing for it to replace: with no hours set and no blocked
 *    dates, `availability-v2.tsx` still draws a full week off
 *    `FALLBACK_DEFAULTS`. `readEmptyTabs()` therefore never returns
 *    'availability', so `tabIsEmpty` would drop every step carrying it and the
 *    empty half of a two-half tour would silently never run.
 *
 * Faking a signal — inventing an empty state purely so the tour could branch on
 * it — would be adding a surface to a shared screen to make a walkthrough
 * prettier, which is not a trade a tour is entitled to make. So this is ONE
 * run of ten anchored steps, and it is the same run for everybody.
 *
 * The consequence to know about: `hasTakenTabTour` re-brightens a tab's launch
 * button when a tour that was taken while empty has more to show later. Nothing
 * here ever has more to show, so this button dims once and stays dim. That is
 * correct rather than a regression — see `RECORD_FIELD` in `./index`, which
 * says so in one place instead of leaving it to a fall-through.
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING THIS SCREEN MUST TEACH BEFORE ANYTHING ELSE
 *
 * Availability v2 is a PREVIEW. It reads the tenant's real weekly hours and
 * their real `blocked_dates` rows and it writes NOTHING — every control on it
 * moves React state and is gone on reload (`availability-model.ts`, and the
 * docblocks in every file in that directory say the same). The screen carries a
 * permanent, non-dismissible pill saying so.
 *
 * `availability.preview` is therefore the SECOND step, before a single control
 * is named. The one unacceptable outcome of this tour is an operator walking
 * away believing they have closed next Tuesday when they have not — and a tour
 * that spent nine steps teaching the controls and mentioned the pill at the end
 * would produce exactly that. Nothing below may be reordered past it.
 *
 * ---------------------------------------------------------------------------
 * THE ANCHOR RULE, which is load-bearing because every step is on one route
 *
 * The anchor budget CASCADES: once one step on a route times out, every later
 * step on that SAME route gets 1500ms instead of 6000. All eleven stops here
 * sit on `/blocked-dates`, so a single stall would starve the whole back half.
 *
 * Two things follow, and both are honoured below.
 *
 * FIRST, prefer anchors present on FIRST PAINT. The header and the global
 * control bar are unconditional; the calendar card is not — `availability-v2`
 * swaps it for `CalendarSkeleton` while the tenants row is in flight, and that
 * skeleton carries no attributes at all. In practice the tour is launched from
 * a button on a page that has already settled, so the card is there; the
 * fallbacks exist for the case where it is not.
 *
 * SECOND, every step ends its anchor list on markup the page cannot render
 * without — `LIST_HEADING`, the page's own `<h1>`. The exception is
 * `availability.day`, the LAST step, which deliberately has no heading
 * fallback: with no calendar there is no date to click, and pointing at the
 * page title while saying "click any date" would be a lie. Being last, its
 * timing out costs the run nothing.
 *
 * Nothing here anchors the calendar CARD, or the seven-column grid inside it.
 * The card is ~700px tall across the full content width and the grid ~584px,
 * both past the roughly two-thirds-of-viewport point at which the spotlight
 * degrades to a centred wash that teaches nothing. The steps land on the hour
 * axis (58px wide), the pattern strip (~110px tall), a single day column
 * (~200px) and its header (~76px) instead.
 *
 * ---------------------------------------------------------------------------
 * CLICKING A SPOTLIGHT, and why only the last step pauses
 *
 * `first-rental-tour.tsx` advances the tour when the operator clicks the thing
 * being pointed at, provided the next step is on the same page — which here is
 * always true. Three of these steps anchor inside a day column, and clicking a
 * day column opens the day editor in a Popover.
 *
 * That is why the three column steps are the last three, in this order: an
 * operator who clicks the status chip on `availability.states` opens the editor
 * AND advances to `availability.day`, which is the step describing the very
 * panel that just opened. The accident lands them somewhere correct.
 *
 * `availability.day` itself carries `pauseOnAnchorClick`, so a click there
 * steps the tour aside rather than floating a card over the panel — the same
 * pattern the Add steps use in the other four tours. It also carries
 * `requires: { tab: 'availability', edit: true }`: a view-only manager gets a
 * disabled `PopoverTrigger`, so telling them to click a date would point at a
 * control they cannot use. They keep the other nine anchored steps.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY LEFT OUT
 *
 *  - WHERE THE REAL HOURS ARE SAVED. Nowhere the canary can reach: v1's
 *    `WorkingHoursCard` and `BlockedDatesManager` are the two cards this screen
 *    REPLACES, so a step sending them there would send them to a page they do
 *    not have. The tour says the screen does not save and stops there.
 *  - The AMBER DASHED OUTLINE and the colour system behind it. Real design work
 *    (colour plus a dash plus a hatch, so the states survive colour blindness
 *    and a greyscale print) but it explains itself the moment an override
 *    exists, and `availability.states` names all three words already.
 *  - The HOUR WINDOW auto-fitting to the week (`hourWindow()`). Invisible when
 *    it works, which is the test for leaving something out.
 *  - PER-DAY CELLS in the pattern strip — the switch and the two time pickers.
 *    The strip step names what the strip IS; how to set a time is not something
 *    a first-timer needs told.
 *  - EXCEPTION PRECEDENCE (an exception beats a real block on screen). True,
 *    deliberate, and second-visit material: it only matters once someone has
 *    sketched over a maintenance block, and the day editor lists the real block
 *    underneath either way.
 */

import type { TourStep } from '@/lib/first-rental-tour';
import type { TabTour } from './index';

/**
 * The page's own heading, and the universal last resort under every step here
 * bar the last.
 *
 * Under the canary's v2 chrome the inset is a `<main data-slot="sidebar-inset">`
 * and this screen's `<h1>` is the only one inside it. `main h1` covers the same
 * element if that slot is ever renamed.
 */
const LIST_HEADING = ['[data-slot="sidebar-inset"] h1', 'main h1'] as const;

/**
 * The global control bar. Unconditional, outside the calendar card, and so
 * still standing during the loading branch that replaces the card with a
 * skeleton — which is why the two control steps fall back to it before the
 * heading rather than straight to the heading.
 */
const CONTROLS = '[data-tour="availability-controls"]';

/**
 * The leftmost day column, and its header.
 *
 * `findAnchor` returns the first VISIBLE match, so both of these resolve to
 * Monday every time. The spotlight is deterministic rather than landing
 * wherever the week's data happens to put it.
 */
const DAY_COLUMN = '[data-tour="availability-day"]';
const DAY_HEADER = '[data-tour="availability-day-header"]';

const STEPS: readonly TourStep[] = [
  {
    id: 'availability.welcome',
    label: 'Welcome',
    title: 'When your fleet can be booked',
    body: 'This screen decides the hours you are open and the days you are not. I will show you the weekly pattern, the week it produces, and how one date gets changed.',
    route: '/blocked-dates',
    anchors: [],
    side: 'center',
    showOutline: true,
  },
  {
    /**
     * SECOND, and it does not move. See the header note: an operator who leaves
     * this tour believing they have closed next Tuesday is the one outcome this
     * screen cannot afford, and everything after this step describes a control
     * that does not save.
     */
    id: 'availability.preview',
    label: 'Saving',
    title: 'Your changes are saved when you say so',
    body: 'Edit the week freely — nothing reaches your customers until you press Save changes. Until then the page marks itself as having unsaved work, and Reset throws it away.',
    route: '/blocked-dates',
    anchors: ['[data-tour="availability-preview"]', ...LIST_HEADING],
    side: 'bottom',
  },
  {
    id: 'availability.week',
    label: 'The week',
    title: 'One week at a time',
    body: 'Everything on the page describes these seven dates. The arrows step a week either way, and This week brings you back to the one you are in.',
    route: '/blocked-dates',
    anchors: ['[data-tour="availability-week"]', ...LIST_HEADING],
    side: 'bottom',
    notes: [
      {
        // `useBlockedDates()` only reads rows whose `end_date` is today or
        // later, so a past week draws no blocks at all. Nothing on the screen
        // says so, and an operator stepping back to check last month would
        // otherwise read the gap as "we were open".
        text: 'A week in the past shows no blocked days. Only blocks ending today or later are read.',
      },
    ],
  },
  {
    id: 'availability.pattern',
    label: 'Weekly pattern',
    title: 'The pattern under the week',
    body: 'Your opening hours for each weekday, summarised here. Open it to change them, and every date below that you have not edited by hand follows.',
    route: '/blocked-dates',
    anchors: ['[data-tour="availability-pattern"]', ...LIST_HEADING],
    // `bottom` now: this anchors a button in the toolbar with the calendar
    // underneath it, where it used to anchor a strip at the head of the card.
    side: 'bottom',
    notes: [
      {
        // The strip's own honest footnote, and the answer to the question it
        // exists to raise. Anchorless on purpose: the amber override pill it
        // describes only renders once an override exists, so an anchored note
        // would be dropped for exactly the operator hearing this for the first
        // time.
        text: 'A date you have already changed by hand keeps your version, and the cell counts how many.',
      },
    ],
  },
  {
    id: 'availability.hours24',
    label: 'Open 24 hours',
    title: 'Open around the clock',
    body: 'One switch for the whole operation. Turn it on and every day is open around the clock, and the opening times in the strip stop applying.',
    route: '/blocked-dates',
    anchors: ['[data-tour="availability-always-open"]', CONTROLS, ...LIST_HEADING],
    side: 'bottom',
  },
  {
    id: 'availability.timezone',
    label: 'Timezone',
    title: 'Which clock these times are on',
    body: 'Every time on this screen is read in this zone. It is a real setting rather than a display choice, so nine to five here means nine to five there.',
    route: '/blocked-dates',
    anchors: ['[data-tour="availability-timezone"]', CONTROLS, ...LIST_HEADING],
    side: 'bottom',
  },
  {
    id: 'availability.calendar',
    label: 'The calendar',
    title: 'The week, drawn as hours',
    body: 'The hours run down this edge and each column is one date. The block inside a column is the window you are open, drawn where those hours fall.',
    route: '/blocked-dates',
    anchors: ['[data-tour="availability-hours"]', ...LIST_HEADING],
    // The axis is the leftmost thing in the card, so the card stands to its
    // right and the seven columns stay visible behind it.
    side: 'right',
    notes: [
      {
        // Drawn only on today's column, and only when now falls inside the
        // hour window — so it is anchored, and dropped rather than promised.
        text: 'A red line across today shows where the day has got to.',
        anchors: ['[data-tour="availability-now"]'],
      },
    ],
  },
  {
    /*
     * Was `availability.counts`, describing an open/closed/exceptions tally in
     * the control bar. The toolbar rebuild removed that readout, so the step
     * had nothing left to point at and its body described a thing not on the
     * screen. What survives is the part that is still true and still useful:
     * Reset, which is the only undo here.
     */
    id: 'availability.reset',
    label: 'Undo',
    title: 'Throwing the week away',
    body: 'Reset drops every unsaved change at once and puts your saved hours back. It is all-or-nothing, and it does nothing once you have saved.',
    route: '/blocked-dates',
    anchors: ['[data-tour="availability-reset"]', CONTROLS, ...LIST_HEADING],
    side: 'bottom',
  },
  {
    /**
     * First of the three steps anchored inside a day column — see the header
     * note on clicking a spotlight. The `availability-blocked` attribute is on
     * the hatch overlay and only exists where a real tenant-wide block covers a
     * visible date, so the column behind it is the fallback and the body is
     * written to read correctly against either.
     */
    id: 'availability.blocked',
    label: 'Blocked dates',
    title: 'Days already closed for you',
    body: 'A date blocked for the whole operation is drawn in red hatching. It comes from your blocked dates, and it is not something this screen can clear.',
    route: '/blocked-dates',
    anchors: ['[data-tour="availability-blocked"]', DAY_COLUMN, ...LIST_HEADING],
    // A column is ~584px tall and starts well down the page, so there is no
    // room under it; the leftmost column leaves room to its right.
    side: 'right',
    notes: [
      {
        // A per-vehicle block does NOT close the day — it is a footnote at the
        // foot of the column. Anchored, because it only renders on a date that
        // actually has one.
        text: 'One car blocked on an open day is counted at the foot of the column instead. You stay open.',
        anchors: ['[data-tour="availability-vehicles-out"]'],
      },
      {
        // Where that per-vehicle block is actually made. True for the canary:
        // the vehicle record's Availability section adds and removes them.
        text: 'Blocked periods for one car are set on that car, under Availability on its own record.',
      },
    ],
  },
  {
    id: 'availability.states',
    label: 'Day status',
    title: 'The word under each date',
    body: 'Default means the day follows the pattern. Custom means you changed this date on its own. Blocked means a closure that is already in your data.',
    route: '/blocked-dates',
    anchors: [DAY_HEADER, DAY_COLUMN, ...LIST_HEADING],
    // The header sits at the top of a tall column, so there is room beneath it.
    side: 'bottom',
  },
  {
    /**
     * Last, and it steps aside when clicked: the operator meets the day editor
     * itself rather than the tour sitting on top of it. Same pattern as the Add
     * steps in the other four tours.
     *
     * No heading fallback, and being last is what makes that safe. With no
     * calendar there is no date to click, and pointing at the page title while
     * saying "click any date" would be a lie — while a timeout here shortens
     * the budget for no step that follows.
     */
    id: 'availability.day',
    label: 'One date',
    title: 'Changing one date only',
    body: 'Click any date to open it. Three choices: follow the weekly pattern, custom hours for that date alone, or closed all day.',
    route: '/blocked-dates',
    anchors: [DAY_COLUMN],
    side: 'right',
    // A view-only manager gets a disabled trigger, so this would point at a
    // control they cannot use. They keep the nine anchored steps above.
    requires: { tab: 'availability', edit: true },
    pauseOnAnchorClick: true,
    notes: [
      {
        // The panel's most useful property and the least visible one: a sketch
        // that "opens" a maintenance day still lists the block underneath.
        text: 'The panel lists any real blocks behind that date, so a sketch never hides one.',
      },
    ],
  },
];

export const AVAILABILITY_TAB_TOUR: TabTour = {
  id: 'availability',
  label: 'Availability',
  homeRoute: '/blocked-dates',
  // Said when fewer than `MIN_TOUR_STOPS` anchored steps survive.
  //
  // There is no data condition that can cause it: this screen draws the same
  // week for every tenant, so all ten anchored steps are built for anyone who
  // can open the page, and a view-only manager still keeps nine. What is left
  // is access to the route itself, and this is worded for that rather than
  // telling someone to go and set hours they may not be permitted to set.
  emptyMessage:
    'There is not enough of this tab open to you to walk through. A head admin can widen your access to Availability, and the tour will have more to show.',
  steps: STEPS,
};
