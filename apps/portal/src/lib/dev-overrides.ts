/**
 * Developer-only overrides — today, one: FORCE A TEACHING EMPTY STATE.
 *
 * The seven teaching empty states (`components/empty-states/lean-empty-states.tsx`)
 * fire only when a page's unfiltered count is zero. That makes them impossible
 * to look at on a tenant that has data without deleting the data. This module
 * lets a developer flip a page into its teaching state on demand, per page,
 * from the `/dev` page — nothing is deleted, and the flag lives in this
 * browser's localStorage only.
 *
 * ── WHERE THE OVERRIDE SITS IN THE GATE ────────────────────────────────────
 * Every consumer composes it INSIDE the lean gate, never outside it:
 *
 *     isLeanTenant(tenantSlug) && (unfilteredCount === 0 || devForceEmpty)
 *
 * so for the other 56 tenants the whole right-hand side is short-circuited
 * away and their pages are byte-for-byte what they were. A planted key on a
 * live operator's browser changes nothing, because the slug gate is evaluated
 * first and fails. `isLeanTenant` is keyed on SLUG, never id — northwind is
 * 6e5c544f-… in production and 8e6bc88f-… on staging.
 *
 * ── THE NODE_ENV GUARD IS THE PRODUCTION KILL-SWITCH ───────────────────────
 * Every reader and writer here starts with the literal
 * `process.env.NODE_ENV === "development"` and returns its inert value on the
 * other branch. Next substitutes the literal at build time, so in a production
 * bundle each guard reads `if ("production" === "development") …` — a constant
 * — and the minifier folds the body to `return false` / `return EMPTY` / a
 * no-op, dropping the storage code with it. The check is written out in each
 * function rather than routed through one `isDev()` helper on purpose: a
 * bundler folds a literal comparison, but it does not inline a function call
 * and then fold what it inlined, so the helper shape would leave the storage
 * reads in the bundle (dead at runtime, but present). And the DEVELOPMENT
 * branch comes first — `if (dev) return real; return inert;` — because that is
 * the shape esbuild was seen to fold cleanly; the inverted
 * `if (!dev) return inert; …rest` relies on the bundler noticing that the rest
 * is unreachable, which it does only after it has already kept the references.
 *
 * The result: outside `next dev`, planting the key does nothing, even on the
 * canary, even on localhost. This is the guard the pages rely on; the `/dev`
 * page's own localhost + tenant gates only decide who sees the SWITCH.
 *
 * ── STORAGE SHAPE ──────────────────────────────────────────────────────────
 * One key, `d247.dev.forceEmptyState`, holding a JSON array of page ids in
 * manifest order — `["vehicles","rentals"]`. Removed entirely when empty, so
 * "no overrides" leaves no trace. Unknown ids and garbage are dropped on read
 * rather than thrown, because a stale value from an older build must never
 * take a listing page down.
 *
 * PURE ON PURPOSE. No React, no Next, no Supabase. Storage is injectable so
 * every branch is testable with a fake `Storage`; the default reaches for
 * `window.localStorage` inside a try/catch because it THROWS on access (not
 * merely returns null) in Safari's private mode and wherever site data is
 * blocked. The React hook lives in `hooks/use-forced-empty-state.ts`.
 */

/** The one localStorage key. */
export const FORCE_EMPTY_STATE_KEY = "d247.dev.forceEmptyState";

/**
 * Same-tab change signal. `storage` events only fire in OTHER tabs, so a
 * toggle on `/dev` would not reach a listing page open in the same tab
 * without this. Cross-tab updates still arrive through `storage`.
 */
export const DEV_OVERRIDES_EVENT = "d247:dev-overrides";

/**
 * The Messages conversation preview.
 *
 * Same shape as the forced empty states above and for the same reason: a
 * per-browser developer preference, not tenant state, so it lives in
 * localStorage and never touches the database. It exists so the conversation
 * timeline can be REVIEWED — call events, inbound and outbound email, a failed
 * send, attachments — without writing a single row anybody would have to clean
 * up afterwards.
 *
 * The renderers it drives are NOT mock-only. They read a message's channel and
 * metadata exactly as a real one would, so when the backend starts producing
 * these states they already draw correctly; only the DATA here is invented.
 */
export const MESSAGES_SCENARIO_KEY = "d247.dev.messagesScenario";

export const MESSAGE_SCENARIOS = [
  { id: "off", label: "Off", hint: "Real conversation data" },
  { id: "mixed", label: "Active mixed", hint: "In-app, SMS, email, calls, attachments" },
  { id: "email", label: "Email-heavy", hint: "Inbound and outbound email thread" },
  { id: "calls", label: "Call history", hint: "Completed, missed and outgoing calls" },
  { id: "failed", label: "Failed send", hint: "A message that did not go out" },
  { id: "empty", label: "New conversation", hint: "Nothing said yet" },
] as const;

export type MessagesScenarioId = (typeof MESSAGE_SCENARIOS)[number]["id"];

const SCENARIO_IDS: ReadonlySet<string> = new Set(MESSAGE_SCENARIOS.map((s) => s.id));

/** Read the selected scenario. Anything unrecognised reads as "off". */
export function readMessagesScenario(storage?: Storage | null): MessagesScenarioId {
  if (process.env.NODE_ENV !== "development") return "off";
  const store = resolve(storage);
  if (!store) return "off";
  try {
    const raw = store.getItem(MESSAGES_SCENARIO_KEY);
    return raw && SCENARIO_IDS.has(raw) ? (raw as MessagesScenarioId) : "off";
  } catch {
    return "off";
  }
}

/** Select a scenario, or "off" to go back to real data. No-op in production. */
export function setMessagesScenario(id: MessagesScenarioId, storage?: Storage | null): void {
  if (process.env.NODE_ENV !== "development") return;
  const store = resolve(storage);
  if (!store) return;
  try {
    if (id === "off") store.removeItem(MESSAGES_SCENARIO_KEY);
    else store.setItem(MESSAGES_SCENARIO_KEY, id);
  } catch {
    return;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DEV_OVERRIDES_EVENT));
}

/* ───────────────────────────────────────────────────────────────────────────
   BILLING STATES

   The dunning states cannot be reached by clicking. `past_due` arrives from a
   Stripe webhook after a card actually fails, and grace expiry is a CLOCK
   EVENT — you would have to fail a real payment and then wait out the
   configured window to see the blocked screen once. So the states nobody can
   reach are exactly the ones nobody has reviewed.

   This selects one. It overrides what `use-tenant-subscription` DERIVES —
   is it past due, is the window open, has it closed — and changes nothing it
   FETCHES: no row is written, no Stripe call is made, and the real queries
   keep running underneath. Turning it off restores the true state on the next
   render.

   Composed inside the same two gates as everything else in this file: the
   NODE_ENV literal (folded away in a production bundle) and, at the consumer,
   `isLeanTenant(tenant.slug)`. A key planted on a live operator's browser does
   nothing.
   ─────────────────────────────────────────────────────────────────────────── */

export const BILLING_SCENARIO_KEY = "d247.dev.billingScenario";

export const BILLING_SCENARIOS = [
  { id: "off", label: "Off", hint: "Real subscription state" },
  { id: "active", label: "Active", hint: "Paid, renewing normally" },
  { id: "payment_failed", label: "Payment failed", hint: "Card declined, window open" },
  { id: "overdue", label: "Overdue", hint: "Due date passed, window open" },
  { id: "grace_expiring", label: "Grace, nearly out", hint: "Same warning, stronger tone" },
  { id: "grace_expired", label: "Grace expired", hint: "Window closed — app blocked" },
  { id: "recovered", label: "Payment recovered", hint: "Paid; access restored" },
] as const;

export type BillingScenarioId = (typeof BILLING_SCENARIOS)[number]["id"];

const BILLING_IDS: ReadonlySet<string> = new Set(BILLING_SCENARIOS.map((s) => s.id));

/** Read the selected billing state. Anything unrecognised reads as "off". */
export function readBillingScenario(storage?: Storage | null): BillingScenarioId {
  if (process.env.NODE_ENV !== "development") return "off";
  const store = resolve(storage);
  if (!store) return "off";
  try {
    const raw = store.getItem(BILLING_SCENARIO_KEY);
    return raw && BILLING_IDS.has(raw) ? (raw as BillingScenarioId) : "off";
  } catch {
    return "off";
  }
}

/** Select a billing state, or "off" to go back to the real one. */
export function setBillingScenario(id: BillingScenarioId, storage?: Storage | null): void {
  if (process.env.NODE_ENV !== "development") return;
  const store = resolve(storage);
  if (!store) return;
  try {
    if (id === "off") store.removeItem(BILLING_SCENARIO_KEY);
    else store.setItem(BILLING_SCENARIO_KEY, id);
  } catch {
    return;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DEV_OVERRIDES_EVENT));
}

/**
 * The listing pages that carry a teaching empty state, in the order they sit
 * in the sidebar. Each `id` is what the page passes to `useForcedEmptyState`,
 * and `EmptyStatePageId` is derived from these keys so a typo'd id on a page
 * fails `tsc` rather than silently never matching.
 */
export const EMPTY_STATE_PAGES = [
  { id: "vehicles", label: "Vehicles", href: "/vehicles" },
  { id: "customers", label: "Customers", href: "/customers" },
  { id: "rentals", label: "Rentals", href: "/rentals" },
  { id: "agreements", label: "Agreements", href: "/agreements" },
  { id: "insurances", label: "Insurances", href: "/insurances" },
  { id: "invoices", label: "Invoices", href: "/invoices" },
  { id: "payments", label: "Payments", href: "/payments" },
] as const;

export type EmptyStatePageId = (typeof EMPTY_STATE_PAGES)[number]["id"];

const PAGE_IDS: ReadonlySet<string> = new Set(EMPTY_STATE_PAGES.map((p) => p.id));

export function isEmptyStatePageId(value: unknown): value is EmptyStatePageId {
  return typeof value === "string" && PAGE_IDS.has(value);
}

/** The inert answer, shared so `useSyncExternalStore` sees one stable value. */
const NONE: ReadonlySet<EmptyStatePageId> = new Set();

/** `localStorage`, or null wherever touching it throws. */
function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Resolve the injected store, or the real one when nothing was injected. */
const resolve = (storage: Storage | null | undefined): Storage | null =>
  storage === undefined ? safeLocalStorage() : storage;

/**
 * Turn a stored value into the set of forced pages. Tolerates anything: a
 * missing key, an old shape, hand-edited garbage. Unknown ids are dropped.
 */
export function parseForcedEmptyPages(raw: string | null | undefined): ReadonlySet<EmptyStatePageId> {
  if (!raw) return NONE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NONE;
  }
  if (!Array.isArray(parsed)) return NONE;
  const pages = new Set<EmptyStatePageId>();
  for (const value of parsed) if (isEmptyStatePageId(value)) pages.add(value);
  return pages.size > 0 ? pages : NONE;
}

/**
 * The raw stored string — `""` when unset — for callers that need a snapshot
 * that is stable between reads (`useSyncExternalStore` compares snapshots by
 * `Object.is`, and a fresh `Set` every call would loop forever).
 */
export function readForcedEmptyRaw(storage?: Storage | null): string {
  if (process.env.NODE_ENV === "development") {
    const store = resolve(storage);
    if (!store) return "";
    try {
      return store.getItem(FORCE_EMPTY_STATE_KEY) ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

/** Every page currently forced into its teaching state. Empty outside development. */
export function readForcedEmptyPages(storage?: Storage | null): ReadonlySet<EmptyStatePageId> {
  if (process.env.NODE_ENV === "development") {
    return parseForcedEmptyPages(readForcedEmptyRaw(storage));
  }
  return NONE;
}

/**
 * THE READER THE PAGES USE. Is this page forced into its teaching state?
 *
 * `false`, unconditionally, outside development — a planted key is dead in
 * every other build. See the header for why the guard is a literal here.
 */
export function isEmptyStateForced(pageId: EmptyStatePageId, storage?: Storage | null): boolean {
  if (process.env.NODE_ENV === "development") {
    return readForcedEmptyPages(storage).has(pageId);
  }
  return false;
}

/**
 * Persist a set, in manifest order so the stored value is deterministic, and
 * tell this tab. Removes the key outright when the set is empty.
 */
function writeForcedEmptyPages(pages: ReadonlySet<EmptyStatePageId>, storage: Storage | null | undefined): void {
  const store = resolve(storage);
  if (!store) return;
  const ordered = EMPTY_STATE_PAGES.map((p) => p.id).filter((id) => pages.has(id));
  try {
    if (ordered.length === 0) store.removeItem(FORCE_EMPTY_STATE_KEY);
    else store.setItem(FORCE_EMPTY_STATE_KEY, JSON.stringify(ordered));
  } catch {
    // Storage refused the write. The switch simply does not take.
    return;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DEV_OVERRIDES_EVENT));
}

/** Force one page on or off. A no-op outside development. */
export function setEmptyStateForced(pageId: EmptyStatePageId, forced: boolean, storage?: Storage | null): void {
  if (process.env.NODE_ENV === "development") {
    const next = new Set(readForcedEmptyPages(storage));
    if (forced) next.add(pageId);
    else next.delete(pageId);
    writeForcedEmptyPages(next, storage);
  }
}

/** Force every page on, or clear them all. A no-op outside development. */
export function setAllEmptyStatesForced(forced: boolean, storage?: Storage | null): void {
  if (process.env.NODE_ENV === "development") {
    writeForcedEmptyPages(forced ? new Set(EMPTY_STATE_PAGES.map((p) => p.id)) : NONE, storage);
  }
}

/**
 * Subscribe to changes from this tab (the custom event) and from other tabs
 * (`storage`). Returns the unsubscribe. Outside development it subscribes to
 * nothing and returns a no-op, so a listing page in production adds no
 * listeners for a flag it can never read.
 */
export function subscribeDevOverrides(onChange: () => void): () => void {
  if (process.env.NODE_ENV === "development") {
    if (typeof window === "undefined") return () => {};
    const onStorage = (event: StorageEvent) => {
      // `key === null` is "storage.clear()" — that wipes ours too.
      if (
        event.key === null ||
        event.key === FORCE_EMPTY_STATE_KEY ||
        event.key === MESSAGES_SCENARIO_KEY
      ) onChange();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(DEV_OVERRIDES_EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(DEV_OVERRIDES_EVENT, onChange);
    };
  }
  return () => {};
}
