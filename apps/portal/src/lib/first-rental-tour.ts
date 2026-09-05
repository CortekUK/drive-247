/**
 * The first-rental tour — its three stops, its gate, and its "seen" storage.
 *
 * THE PRODUCT DECISION, restated here because the shape of this file follows
 * from it: the tour has exactly three stops and one job, which is to get a
 * brand-new operator to their FIRST RENTAL. It is deliberately NOT a tour of
 * the chrome — no "here is the sidebar, here is search". A new operator does
 * not need the furniture named; they need to know that a rental needs a car and
 * a person, and that the button which makes one is right there.
 *
 *   1. Add a vehicle   — "You need one car to rent."
 *   2. Add a customer  — "And one person to rent it to."
 *   3. New Rental      — "That's it. Pick your dates and location, and you're
 *                         done."
 *
 * Stop 3 also carries two QUIET lines pointing at where agreements and
 * insurance already sit on screen. They are one line each and teach nothing:
 * depth for those two belongs to the persistent setup checklist and to the
 * in-place empty states, which are a different surface entirely. A tour that
 * starts explaining e-signature modes is a tour nobody finishes.
 *
 * NO VIDEOS. Videos live in the checklist and the empty states. A video stops a
 * tour dead — the whole thing is budgeted at about 60 seconds.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LOGIC IS IN A .ts FILE AND NOT IN THE COMPONENT
 *
 * Everything here is pure and injectable, so the two things that can actually
 * break — the gate and the anchor filter — are unit-testable without a DOM,
 * without a tenant, and without React. Portal builds with
 * `ignoreBuildErrors: true`, so a type error in a .tsx file ships; a test is
 * the only thing that catches a wrong answer.
 */

/**
 * Bump when the STOPS change in a way that makes re-showing the tour the right
 * call. The version is part of the storage key, so bumping it re-arms the tour
 * for everyone; leaving it alone keeps every operator who has already seen it
 * from meeting it twice.
 */
export const FIRST_RENTAL_TOUR_VERSION = 1;

/**
 * Where "seen" is remembered, per USER rather than per browser profile.
 *
 * Autostart is specified as once per user, and a portal login is shared far
 * more often than it should be — an operator and their ops staff on one
 * machine. Keying on the app user's id means the second person to sign in on
 * that machine still gets their own run, and the first person is not re-prompted
 * when they come back.
 *
 * A missing id yields a shared fallback key rather than `null`. Refusing to
 * store anything would make the tour re-fire on every dashboard mount, which is
 * the single worst failure mode available to a first-run surface.
 */
export function tourSeenKey(appUserId: string | null | undefined): string {
  const who = appUserId && appUserId.length > 0 ? appUserId : 'anon';
  return `d247.tour.first-rental.v${FIRST_RENTAL_TOUR_VERSION}.${who}`;
}

/** A quiet supporting line on a stop. Rendered only if its anchor is present. */
export interface TourNote {
  text: string;
  /**
   * Ordered candidate selectors for the thing this line points at. A note whose
   * anchor is nowhere on screen is DROPPED rather than shown — "agreements live
   * under More → Records" is a lie to a manager whose permissions hide Records.
   * Omit entirely for a line that points at nothing in particular.
   */
  anchors?: readonly string[];
}

export interface TourStop {
  /** Stable key. Used for React keys and for test assertions. */
  id: string;
  title: string;
  body: string;
  /**
   * Ordered candidate selectors, most specific first.
   *
   * More than one on purpose. The explicit `data-tour` attributes are the
   * intended anchor, but they live in `app-sidebar-v2.tsx` — a large file under
   * concurrent edit — and an anchor that goes missing does not fail loudly, it
   * just stalls the tour on a step pointing at nothing. The href-based fallback
   * resolves against markup the sidebar cannot render without, so losing the
   * attribute costs the tour nothing.
   */
  anchors: readonly string[];
  /** Preferred side to place the card on. The renderer may flip it to fit. */
  side: 'right' | 'bottom';
  notes?: readonly TourNote[];
}

/**
 * Below this many surviving stops the tour does not run at all.
 *
 * Anchors go missing for real reasons: sidebar items are permission-gated
 * (`ROUTE_TO_TAB` → `canView`), areas are hidden per-tenant by `isAreaHidden`,
 * and on a phone the whole sidebar is an off-canvas Sheet that is not in the
 * DOM until it is opened. A one-stop "tour" is not a tour; showing one to a
 * viewer-role manager who can see neither Vehicles nor Customers would be worse
 * than showing nothing.
 */
export const MIN_TOUR_STOPS = 2;

const SIDEBAR = '[data-sidebar="sidebar"]';

export const FIRST_RENTAL_TOUR: readonly TourStop[] = [
  {
    id: 'vehicle',
    title: 'Add a vehicle',
    body: 'You need one car to rent. Add the real one you plan to put on the road — this is your live business, not a demo.',
    anchors: [`[data-tour="nav-vehicles"]`, `${SIDEBAR} a[href="/vehicles"]`],
    side: 'right',
  },
  {
    id: 'customer',
    title: 'Add a customer',
    body: 'And one person to rent it to. A real customer — name, email, licence — so the first agreement you send is a real one.',
    anchors: [`[data-tour="nav-customers"]`, `${SIDEBAR} a[href="/customers"]`],
    side: 'right',
  },
  {
    id: 'rental',
    title: 'New Rental',
    body: "That's it. Pick your dates and location, and you're done.",
    anchors: [
      // If the dashboard's primary-action slot is showing New Rental rather
      // than the setup guide, point at the button itself.
      `[data-tour="new-rental"]`,
      `[data-tour="nav-rentals"]`,
      `${SIDEBAR} a[href="/rentals"]`,
    ],
    side: 'right',
    // The two quiet lines. They point at THIS flow — agreements and insurance
    // are steps inside creating a rental, not separate errands to run first —
    // so they carry no anchor of their own and ride the stop's. Deliberately
    // one line each and no depth: teaching e-signature modes or coverage tiers
    // is the job of the persistent setup checklist and of the in-place empty
    // states, and a tour that starts explaining them is a tour nobody finishes.
    notes: [
      {
        text: 'The rental agreement is drawn up and sent for signature as part of this.',
      },
      {
        text: 'Insurance is offered in the same flow, priced per rental.',
      },
    ],
  },
];

/** A stop whose anchor was actually found on screen. */
export interface ResolvedStop {
  stop: TourStop;
  element: Element;
  /** Only the notes whose own anchors resolved. */
  notes: readonly string[];
}

/**
 * Is this element genuinely on screen?
 *
 * `querySelector` finding a node proves nothing about whether the operator can
 * see it. The v2 sidebar renders a desktop rail AND a mobile Sheet from the
 * same primitives, both carrying `data-sidebar="sidebar"`, and a collapsed rail
 * keeps its labels in the tree as `sr-only`. Spotlighting a zero-area node
 * draws a hole in the middle of nowhere.
 */
export function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * First VISIBLE element matching any candidate selector, in order.
 *
 * Selector order is preference order, and every match for a selector is
 * considered before moving to the next one — so a hidden duplicate never
 * shadows the real thing.
 */
export function findAnchor(
  anchors: readonly string[],
  root: ParentNode,
  visible: (el: Element) => boolean = isVisible,
): Element | null {
  for (const selector of anchors) {
    let matches: NodeListOf<Element>;
    try {
      matches = root.querySelectorAll(selector);
    } catch {
      // A malformed selector must not take the whole tour down with it.
      continue;
    }
    for (const el of Array.from(matches)) {
      if (visible(el)) return el;
    }
  }
  return null;
}

/**
 * Resolve every stop against the live DOM and DROP the ones pointing at
 * nothing.
 *
 * This is the failure mode that killed the previous attempt: a step whose
 * target is absent renders a card anchored to nowhere and the operator has no
 * idea what they are being shown, so the tour stalls dead. Resolving up front —
 * once, at launch — means the tour that starts is the tour that can finish.
 */
export function resolveStops(
  stops: readonly TourStop[],
  root: ParentNode,
  visible: (el: Element) => boolean = isVisible,
): ResolvedStop[] {
  const resolved: ResolvedStop[] = [];
  for (const stop of stops) {
    const element = findAnchor(stop.anchors, root, visible);
    if (!element) continue;
    const notes = (stop.notes ?? [])
      .filter((n) => !n.anchors || findAnchor(n.anchors, root, visible) !== null)
      .map((n) => n.text);
    resolved.push({ stop, element, notes });
  }
  return resolved;
}

/** Everything that has to be true before the tour may autostart. */
export interface TourGateInput {
  /** `isLeanTenant(tenant.slug)` — the canary, keyed on SLUG and never on id. */
  isCanary: boolean;
  /**
   * Is this tenant on the v2 chrome? Every anchor lives in
   * `app-sidebar-v2.tsx`; under v1 chrome they are all absent and the tour
   * would filter itself down to nothing anyway. Checking explicitly makes that
   * intent legible rather than accidental.
   */
  hasV2Chrome: boolean;
  /** Dashboard route only. */
  onDashboard: boolean;
  /** Auth and the app user have settled. */
  authReady: boolean;
  /**
   * Any blocking gate is up — the subscription paywall in its `setup`,
   * `expired` or `past_due` variant. A tour spotlighting the sidebar behind a
   * non-dismissible paywall is nonsense the operator cannot act on.
   */
  blockingGateOpen: boolean;
  /**
   * The first-run wizard is showing, or has not yet said whether it will.
   *
   * This is step 7 of a flow whose step 6 is the wizard, and the two must never
   * be on screen together. "Not yet resolved" counts as pending on purpose: the
   * wizard's query settles a beat after mount, and starting during that beat is
   * exactly how two full-screen surfaces end up stacked.
   */
  wizardPending: boolean;
  /** This user has already been through it (or skipped it). */
  alreadySeen: boolean;
}

/**
 * Should the tour AUTOSTART?
 *
 * Fails CLOSED on every unknown, which is the only safe direction for a
 * surface that covers the screen. Note in particular that an unresolved tenant
 * slug arrives here as `isCanary: false` — `isLeanTenant` returns false for
 * null/undefined — so the brief tick before TenantContext resolves the hostname
 * cannot flash the tour, and a bogus subdomain never resolves a tenant at all.
 *
 * Replay is deliberately NOT routed through here. Asking for the tour from the
 * user menu is an explicit act; it bypasses `alreadySeen` and `onDashboard`
 * (the menu item only exists on the canary's v2 chrome in the first place).
 */
export function shouldAutostartTour(input: TourGateInput): boolean {
  return (
    input.isCanary &&
    input.hasV2Chrome &&
    input.onDashboard &&
    input.authReady &&
    !input.blockingGateOpen &&
    !input.wizardPending &&
    !input.alreadySeen
  );
}

/**
 * Has this user seen the tour?
 *
 * Every access is wrapped: `localStorage` THROWS on access (not just returns
 * null) in Safari's private mode and wherever site data is blocked, and an
 * uncaught throw here happens during the dashboard's first paint. Fails to
 * `true` — "assume seen" — because the cost of wrongly staying quiet is one
 * operator who has to replay from the menu, while the cost of wrongly starting
 * is an unskippable-feeling tour that returns on every single page load.
 */
export function hasSeenTour(
  appUserId: string | null | undefined,
  storage: Pick<Storage, 'getItem'> | null = safeStorage(),
): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(tourSeenKey(appUserId)) !== null;
  } catch {
    return true;
  }
}

/**
 * Record that this user has seen the tour.
 *
 * Called UP FRONT, the moment the tour is about to start — never on finish.
 * Writing at the end leaves a window in which a re-render, a route change or a
 * second tab re-fires the autostart, and a first-run surface that appears twice
 * reads as broken. Skipping and finishing therefore need no separate bookkeeping
 * at all: both are already recorded.
 */
export function markTourSeen(
  appUserId: string | null | undefined,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(tourSeenKey(appUserId), new Date().toISOString());
  } catch {
    // Storage full or blocked. The tour still runs this once; the only loss is
    // that it may offer itself again next load. Never worth throwing for.
  }
}

/** `localStorage`, or null wherever touching it throws. */
export function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The replay signal, fired by the user menu.
 *
 * A window event rather than a store or a prop, matching what the v2 chrome
 * already does for `open-sidebar-customizer` and `open-global-search`. The menu
 * and the tour sit in different subtrees of the dashboard layout and share no
 * ancestor that could hold the state.
 */
export const REPLAY_TOUR_EVENT = 'replay-first-rental-tour';
