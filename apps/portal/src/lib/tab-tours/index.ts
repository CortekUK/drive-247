/**
 * Tab tours — one in-depth walkthrough per main tab, launched from a button on
 * that tab rather than fired at anybody.
 *
 * THE PRODUCT DECISION, restated because the shape of this directory follows
 * from it. `lib/first-rental-tour.ts` is the first-run ORIENTATION: eight
 * shallow steps across five routes whose whole job is to say WHERE THINGS LIVE
 * and then get out of the way. What it cannot do is explain a tab, because a
 * step that stopped to teach the vehicle record would derail the run for
 * everyone who only wanted to know where things are.
 *
 * (It used to try. It was an eleven-step walkthrough that crossed six pages and
 * marched a new operator through making a first rental before they had a car to
 * rent — which is exactly what these files exist to replace, and why that one
 * was cut back rather than extended.)
 *
 * So Ghulam asked for the other half: "har tab ke andar uske paas ek tour ka
 * button hai, jise wo apni convenience pe dekh lega" — inside every tab there
 * is a tour button, which they take when it suits them. Two reasons he gave:
 * someone who wants to learn one tab can learn just that tab, and someone who
 * does not want Customers today can leave it, instead of being made to hold
 * the whole application in their head at once.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES THESE TOURS ARE BUILT TO
 *
 *  1. AROUND TEN STEPS, and no more. His number, and his reason: "taake wo
 *     banda fatigue bhi na kare" — so they do not tire walking around. A tour
 *     that outlasts the operator's patience teaches nothing after the point
 *     they stopped reading.
 *
 *  2. SURFACE, NOT DEPTH. His worked example is the one to copy: an operator
 *     does not know what weekend pricing IS, so bring them to it, say what it
 *     means in a sentence, and let them explore the feature themselves. We are
 *     pointing at doors, not walking through them.
 *
 *  3. INTO THE RECORD, not just the list. He named vehicle detail explicitly —
 *     its stats, its maintenance, its date selection — because that is where
 *     the things a first-timer cannot guess actually live. Stopping at the
 *     "Add" button would teach the easy half. See `routeFor` below.
 *
 *  4. RENTAL DETAIL STAYS SHALLOW. "Aadhi application sirf usi ek tab ke andar
 *     hai" — half the application is inside that one tab, and doing it justice
 *     would take three or four tours. It gets the same ~10 steps as the others
 *     and deliberately leaves things out; what was left out is listed in
 *     `rentals.ts` so the next person does not think it was forgotten.
 *
 * ---------------------------------------------------------------------------
 * WHY IDS ARE NAMESPACED — this one is load-bearing
 *
 * `buildTour` REWRITES a step by id: on a canary without a usable Stripe
 * Connect account it swaps `rental` for `BLOCKED_RENTAL_STEP`. (It used to drop
 * `insurance` and `agreement` too; those steps left the first-run tour when it
 * shrank to an orientation, and they live in `rentals.ts` now.) `rental` is
 * exactly the word a Rentals tour wants for its own steps. A collision would
 * not crash — it would silently show the operator the first-rental tour's copy
 * on a different route, and portal ships with `ignoreBuildErrors: true`, so
 * nothing would catch it.
 *
 * The reroute is now scoped to the canonical list (see `buildTour`), and every
 * id here is additionally prefixed with its tour. Two independent guards,
 * because the failure is invisible.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TOURS DELIBERATELY DO NOT HAVE
 *
 *  - NO AUTOSTART. They are launched from the button, and only from it. That
 *    keeps `shouldAutostartTour` untouched, needs no per-tour "seen" gate to
 *    decide whether to fire, and means a blocked localStorage (Safari private
 *    mode, where `hasSeenTour` deliberately fails to TRUE) can never suppress
 *    a tour the operator explicitly asked for.
 *
 *  - NO RESUME. Ten steps that mostly sit on one route is not a journey worth
 *    restoring, and resume is what forces the "home is the dashboard"
 *    assumption in four separate places. The button is always there to start
 *    again, which is a better answer than a prompt.
 *
 * "Seen" IS still recorded, but only to dim the button — never to gate a run.
 */

import type { TourBuildContext, TourStep } from '@/lib/first-rental-tour';
import { AVAILABILITY_TAB_TOUR } from './availability';
import { CUSTOMERS_TAB_TOUR } from './customers';
import { PAYMENTS_TAB_TOUR } from './payments';
import { RENTALS_TAB_TOUR } from './rentals';
import { VEHICLES_TAB_TOUR } from './vehicles';

/**
 * The tabs that have a tour today.
 *
 * The order is not meaningful and nothing reads it as such: `tabTourForPath`
 * resolves by longest match and `readEmptyTabs` returns a set. It is NOT the
 * sidebar's order — that is Rentals, Vehicles, Customers with money under More.
 *
 * FIVE, and five is the whole list Ghulam asked for. Billing, Integrations and
 * Dashboard were ruled out by name; Payments becomes the Finances tour when
 * that tab lands (see the signpost at the head of `payments.ts`).
 */
export const TAB_TOUR_IDS = [
  'customers',
  'vehicles',
  'rentals',
  'payments',
  'availability',
] as const;

export type TabTourId = (typeof TAB_TOUR_IDS)[number];

export interface TabTour {
  id: TabTourId;
  /** The tab's name, as the button and the toast say it. */
  label: string;
  /**
   * Where this tour belongs. The launch button renders on this path and on any
   * path beneath it, so it is present on both `/vehicles` and
   * `/vehicles/<id>`.
   */
  homeRoute: string;
  /**
   * What to say when the tour will not run — fewer than `MIN_TOUR_STOPS`
   * anchored steps survived the permission filter.
   *
   * Per-tour on purpose. The first-rental tour's failure toast is hardcoded to
   * name "Vehicles, Customers and Rentals", which would be a strange thing to
   * tell someone whose Customers tour just declined to start.
   */
  emptyMessage: string;
  steps: readonly TourStep[];
}

const TOURS: Record<TabTourId, TabTour> = {
  customers: CUSTOMERS_TAB_TOUR,
  vehicles: VEHICLES_TAB_TOUR,
  rentals: RENTALS_TAB_TOUR,
  payments: PAYMENTS_TAB_TOUR,
  availability: AVAILABILITY_TAB_TOUR,
};

/** Look up a tour by id. Returns null for anything unknown — never throws. */
export function getTabTour(id: string | null | undefined): TabTour | null {
  if (!id) return null;
  return (TOURS as Record<string, TabTour | undefined>)[id] ?? null;
}

/**
 * The tour that belongs to a pathname, or null.
 *
 * Longest match wins so a future `/rentals/new` tour would beat `/rentals`.
 * Matching is on a path SEGMENT boundary: `/customers-archive` must not be
 * read as being inside `/customers`.
 */
export function tabTourForPath(pathname: string | null | undefined): TabTour | null {
  if (!pathname) return null;
  let best: TabTour | null = null;
  for (const id of TAB_TOUR_IDS) {
    const tour = TOURS[id];
    const home = tour.homeRoute;
    if (pathname !== home && !pathname.startsWith(`${home}/`)) continue;
    if (!best || home.length > best.homeRoute.length) best = tour;
  }
  return best;
}

/**
 * Bump when a tour's STEPS change enough that someone who has taken it should
 * be offered it again — which here means only that the button brightens back
 * up. Deliberately separate from `FIRST_RENTAL_TOUR_VERSION`: sharing that
 * constant would mean a typo fix in a Customers step also discarded every
 * in-flight first-rental run.
 */
export const TAB_TOUR_VERSION = 1;

/**
 * Where "taken" is remembered, per USER rather than per browser.
 *
 * Same reasoning as the first-rental tour's key: a portal login is shared
 * between an operator and their ops staff more often than it should be, and
 * the second person to sign in on that machine deserves their own run.
 *
 * The `d247.tour.` prefix is not cosmetic — `dev-actions.ts` clears that whole
 * namespace, so every tab tour is re-armed by the /dev reset for free, and the
 * first-run demo loop needs no per-tour teardown of its own.
 */
export function tabTourSeenKey(id: TabTourId, appUserId: string | null | undefined): string {
  const who = appUserId && appUserId.length > 0 ? appUserId : 'anon';
  return `d247.tour.tab.${id}.v${TAB_TOUR_VERSION}.${who}`;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Which version of a tab's tour is available right now.
 *
 * `empty` — the tab holds nothing, so the tour is the short one: what this tab
 * is for, and how to get the first one in.
 * `full`  — there is a record to open, so the walkthrough can go inside it,
 * which is where everything worth teaching actually lives.
 */
export type TabTourVariant = 'empty' | 'full';

/**
 * Has this user taken the tour that is available to them NOW?
 *
 * The subtlety, and the reason this takes a variant. Someone who takes the
 * Customers tour on their first day sees four steps, because they have no
 * customers — that is all there is to show. The moment they add one, seven
 * more steps become real: what a customer record holds, where an invoice comes
 * from, what verification means. Treating "took the empty tour" as "has seen
 * the tour" would hide that behind a dimmed button forever, and the operator
 * would never learn the half that matters.
 *
 * So taking the empty tour dims the button only until there is something more
 * to show. Taking the full tour dims it for good.
 *
 * Fails to TRUE — the DIMMED state — when storage throws or is absent. This is
 * the OPPOSITE direction of caution from the first-rental tour, and for the
 * opposite reason: there, failing to "unseen" prevents an unwanted autostart;
 * here nothing autostarts, so this only decides how loud a button is, and a
 * browser with blocked site data would otherwise show a permanent "new"
 * treatment on every single page load. Quiet is the safe failure.
 *
 * Values written before variants existed are ISO timestamps, which read as
 * `full` — the conservative answer, since it never re-brightens a button for
 * someone who has already been round.
 */
export function hasTakenTabTour(
  id: TabTourId,
  appUserId: string | null | undefined,
  available: TabTourVariant = 'full',
  store: StorageLike | null = storage(),
): boolean {
  if (!store) return true;
  try {
    const raw = store.getItem(tabTourSeenKey(id, appUserId));
    if (raw === null) return false;
    const takenEmptyOnly = raw === 'empty';
    // More to show than last time — offer it again.
    if (takenEmptyOnly && available === 'full') return false;
    return true;
  } catch {
    return true;
  }
}

/**
 * Which variant this user last took, or null if they never have.
 *
 * Distinct from `hasTakenTabTour`, which answers "is there anything new for
 * them" — this answers "what did they see", which is what the button's LABEL
 * needs. The two differ for exactly one person: someone who took the short
 * empty-tab tour and has since added their first record.
 */
export function takenTabTourVariant(
  id: TabTourId,
  appUserId: string | null | undefined,
  store: StorageLike | null = storage(),
): TabTourVariant | null {
  if (!store) return null;
  try {
    const raw = store.getItem(tabTourSeenKey(id, appUserId));
    if (raw === null) return null;
    return raw === 'empty' ? 'empty' : 'full';
  } catch {
    return null;
  }
}

/** Record that this user has taken it. Silent on a storage that refuses. */
export function markTabTourTaken(
  id: TabTourId,
  appUserId: string | null | undefined,
  variant: TabTourVariant = 'full',
  store: StorageLike | null = storage(),
): void {
  if (!store) return;
  try {
    // `empty` is a sentinel the reader checks for; anything else means full, so
    // the full case keeps storing a timestamp and stays debuggable.
    store.setItem(
      tabTourSeenKey(id, appUserId),
      variant === 'empty' ? 'empty' : new Date().toISOString(),
    );
  } catch {
    /* A tour that cannot be remembered is still a tour worth having run. */
  }
}

/**
 * Which tab tours have a RECORD to walk into, and which id names it.
 *
 * `null` means the tab has no record dimension at all, and there are two of
 * those. Payments has no `/payments/<id>` route, so nothing on the page names a
 * payment. Availability has no records whatsoever — it is one screen that draws
 * the same seven columns on a tenant's first day as on their thousandth rental.
 * For both, the full run IS the only run.
 *
 * WHY THIS IS A TABLE AND NOT A CHAIN OF TERNARIES, which is what it replaced.
 * The old tail was `: ids.rentalId`, so it answered for every id it did not
 * name — and the moment a fifth tab was added it started deciding that tab's
 * variant from whether a `/rentals/<uuid>` link happened to be somewhere on the
 * page. That decides whether the launch button re-brightens and relabels itself
 * "See what is inside", so the failure would have been a button changing its
 * mind for a reason belonging to a different tab, with nothing to catch it.
 */
const RECORD_FIELD: Record<TabTourId, 'vehicleId' | 'customerId' | 'rentalId' | null> = {
  customers: 'customerId',
  vehicles: 'vehicleId',
  rentals: 'rentalId',
  payments: null,
  availability: null,
};

/**
 * Which variant a tour would run as right now, from what is on the page.
 *
 * Same DOM read as `readSampleIds` — no query, and it answers correctly from
 * either the list or a record page.
 */
export function tabTourVariant(id: TabTourId): TabTourVariant {
  // The teaching empty state is the most direct answer available: the page puts
  // it up precisely when it has nothing to show. It is checked FIRST because it
  // is the only signal Payments has — there is no /payments/<id> route, so no
  // record id exists to look for on any account, busy or bare.
  if (readEmptyTabs().includes(id)) return 'empty';
  const field = RECORD_FIELD[id];
  // No record dimension: nothing will ever unlock later, so the button dims
  // once and stays dim rather than re-offering the same run forever.
  if (!field) return 'full';
  return readSampleIds()[field] ? 'full' : 'empty';
}


/**
 * Ask the mounted tour machine to run a tab tour.
 *
 * Carries the tour id in `detail` rather than using one event per tour: the
 * machine is mounted once, and a bare event with three listeners would start
 * three tours at once, stacking three cards on one screen.
 */
export const RUN_TAB_TOUR_EVENT = 'run-tab-tour';

export interface RunTabTourDetail {
  tourId: TabTourId;
}

export function runTabTour(tourId: TabTourId): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<RunTabTourDetail>(RUN_TAB_TOUR_EVENT, { detail: { tourId } }),
  );
}

/**
 * A route inside a record, or null when the tenant has no such record yet.
 *
 * Shared by the three tour files so they cannot disagree about what an empty
 * tab means. Null DROPS the step (see `buildTour`), which is exactly right for
 * the brand-new tenant this feature exists to serve: there is no vehicle to
 * open, so the steps about the vehicle record simply are not offered, and the
 * tour is the shorter list-only one rather than a walk into `/vehicles/null`.
 */
export function recordRoute(
  id: string | null | undefined,
  base: string,
  query?: string,
): string | null {
  if (!id) return null;
  return query ? `${base}/${id}?${query}` : `${base}/${id}`;
}

/**
 * One real record id per tab, read out of the links the page has already drawn.
 *
 * WHY THE DOM AND NOT A QUERY. The tours need a record to walk into, and the
 * obvious way to get one is to select the tenant's first vehicle. That would
 * mean a new query on a shared layout, which would then need its own canary
 * gate to avoid running for the other 56 tenants — the exact mistake
 * `use-first-run-questions.ts` currently makes, where an ungated lookup fires
 * on every dashboard mount for every tenant against a table that does not
 * exist in production.
 *
 * The list page has already fetched and rendered those rows, and each one is an
 * anchor to `/vehicles/<uuid>`. Reading the first href costs one querySelector,
 * runs only at launch, and cannot execute for a tenant who is not looking at
 * the page. No query, no gate, nothing to keep in sync.
 *
 * It returns null whenever the tab is empty — which is not a failure but the
 * normal state of the brand-new tenant this feature is built to demonstrate.
 * `buildTour` drops the record steps, and the operator gets the shorter
 * list-only tour instead of being marched into `/vehicles/undefined`.
 *
 * The uuid shape is asserted rather than assumed: these hrefs also carry
 * `/vehicles/new` and `/vehicles/analytics`, which are routes, not records.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * NOT EVERY LIST IS MADE OF LINKS, and that is why there are two strategies.
 *
 * `/vehicles` renders a real `<Link href="/vehicles/<uuid>">` on each row, so
 * the href is right there. `/rentals` and `/customers` do not: their rows are
 * `<TableRow onClick={router.push}>` and `<button onClick>` respectively — they
 * navigate imperatively and emit no href anywhere in the row.
 *
 * Read hrefs alone and the Vehicles tour walks into a vehicle record while the
 * other two silently collapse to their four list steps, with no error and
 * nothing in the console — they would simply look thin, and "the tour is a bit
 * short" is not a symptom anyone traces back to a missing anchor tag.
 *
 * The fix is an explicit `data-record-id`, which is inert markup and can be
 * added to a row without changing how it behaves. Turning those rows into real
 * links would be the better product change — middle-click and open-in-new-tab
 * are worth having — but it alters navigation on pages every canary operator
 * uses, which is more than a tour is entitled to change.
 */
function firstRecordId(base: string): string | null {
  if (typeof document === 'undefined') return null;
  const kind = base.replace(/^\//, '');
  try {
    // Explicit marker first: it is unambiguous, and where it exists it is on
    // the row the operator is actually looking at.
    const marked = document.querySelectorAll<HTMLElement>(
      `[data-record-kind="${kind}"][data-record-id]`,
    );
    for (const el of Array.from(marked)) {
      const id = el.getAttribute('data-record-id') ?? '';
      if (UUID_RE.test(id)) return id;
    }

    // Then hrefs, which cover the link-based lists and — importantly — the
    // record pages themselves, whose rails link to sibling sections of the same
    // record. That is what lets a tour be launched from inside a record.
    const links = document.querySelectorAll<HTMLAnchorElement>(`a[href^="${base}/"]`);
    for (const link of Array.from(links)) {
      // getAttribute, not .href — the property resolves to an absolute URL.
      const href = link.getAttribute('href') ?? '';
      const id = href.slice(base.length + 1).split(/[?#/]/)[0];
      if (UUID_RE.test(id)) return id;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Which tabs are showing their teaching empty state right now.
 *
 * WHY THIS EXISTS ALONGSIDE `readSampleIds`. The other three tab tours decide
 * "is there anything here" by whether a record id could be found, because they
 * need that id anyway to walk into a record. Payments cannot: there is no
 * `/payments/<id>` route, so there is no id to find, and a tour that keyed on
 * one would conclude the tab was empty even on a busy account.
 *
 * The page already answers the question in the DOM. Each list swaps its table
 * for a `TeachingEmptyState` when it has nothing, and those cards carry
 * `data-tour="<tab>-empty"`. Its presence IS the signal, it needs no query, and
 * it is the same element the empty-state steps point at — so a step guarded on
 * emptiness and a step anchored to the empty card can never disagree.
 *
 * Note this reads "the teaching empty state is up", which is narrower than "the
 * table has no rows": a filtered-to-nothing list shows the ordinary no-results
 * message instead, and correctly does NOT count as empty. Someone who has
 * filtered their payments down to zero should get the real tour, not the
 * beginner's one.
 *
 * It is narrower again for Availability, which draws no teaching empty state at
 * all — there is nothing for one to replace, since the screen renders a full
 * week off `FALLBACK_DEFAULTS` with no hours set and no dates blocked. So the
 * lookup for `availability-empty` below is one querySelector that can never
 * match, and that tour is deliberately a single run. See the header of
 * `./availability`, which explains why faking a signal was the wrong fix.
 */
export function readEmptyTabs(): string[] {
  if (typeof document === 'undefined') return [];
  const out: string[] = [];
  try {
    for (const id of TAB_TOUR_IDS) {
      if (document.querySelector(`[data-tour="${id}-empty"]`)) out.push(id);
    }
  } catch {
    // A DOM that refuses to be queried is not an empty tab — say nothing rather
    // than claiming every tab is bare.
    return [];
  }
  return out;
}

/** Sample ids for `TourBuildContext.sampleIds`. Safe to call on any route. */
export function readSampleIds(): {
  vehicleId: string | null;
  customerId: string | null;
  rentalId: string | null;
} {
  return {
    vehicleId: firstRecordId('/vehicles'),
    customerId: firstRecordId('/customers'),
    rentalId: firstRecordId('/rentals'),
  };
}

export type { TourBuildContext, TourStep };
