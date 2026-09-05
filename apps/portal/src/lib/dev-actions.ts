/**
 * Developer-only reset actions for the northwind canary's onboarding surfaces.
 *
 * Two consumers share this module — the `/dev` page and the sidebar Developer
 * link that leads to it — so that "what counts as first-time state" is written
 * down exactly once. Before this file the sidebar block carried its own copy of
 * every reset, and a second copy on the page would have been the first place
 * the two could drift apart.
 *
 * PURE ON PURPOSE. Nothing here imports Supabase, React or Next.
 *   - The one action that touches the database takes its client as an
 *     argument, so the sidebar link can import this module without pulling the
 *     Supabase client into its own bundle, and so every branch — including the
 *     RLS silent-no-op branch, which is the one that matters — is testable with
 *     a fake client rather than a mocked module.
 *   - Storage is injectable for the same reason. The defaults reach for the
 *     real `window` stores, guarded the way `lib/first-rental-tour.ts` guards
 *     them, because `localStorage` THROWS on access (not just returns null) in
 *     Safari's private mode and wherever site data is blocked.
 *
 * NONE OF THIS IS GATED HERE. The gates — `NODE_ENV`, the localhost hostname,
 * the northwind slug — live in the two consumers, because a gate on a pure
 * helper proves nothing about who rendered the button. `isLocalhostHost` is
 * exported from here only so both consumers use the same definition.
 */

import { REPLAY_TOUR_EVENT, safeStorage } from '@/lib/first-rental-tour';

/** The developer page's route. Also the sidebar link's target. */
export const DEV_ROUTE = '/dev';

/**
 * Is this the developer's own machine?
 *
 * `next dev` bound to a LAN address, a preview built with NODE_ENV unset, or a
 * dev build served from a tunnel all fail this. Portal's dev port is 4002
 * (4001–4005 across the apps), never 3000–3005 — but the port is irrelevant to
 * the check; the host is what matters. `*.localhost` is included because the
 * canary is actually served as `northwind.portal.localhost:4002`.
 */
export function isLocalhostHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

// ── The tour's "seen" flags ────────────────────────────────────────────────

/**
 * Every key the tour writes starts with this. The full key is
 * `d247.tour.first-rental.v<version>.<appUserId>` (see `tourSeenKey`), keyed
 * per USER — so a shared machine holds one per person who has signed in, and
 * a first-time reset must clear all of them, not just the current user's.
 * Matching on the namespace rather than the exact key also survives the tour
 * bumping its version. A test pins this prefix to `tourSeenKey`'s output so
 * the two cannot drift.
 */
export const TOUR_STORAGE_PREFIX = 'd247.tour.';

type KeyedStorage = Pick<Storage, 'length' | 'key'>;

/** Keys in `storage` that belong to the tour. */
export function tourStorageKeys(storage: KeyedStorage | null = safeStorage()): string[] {
  if (!storage) return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(TOUR_STORAGE_PREFIX)) keys.push(key);
    }
  } catch {
    // Reading storage threw. Nothing to clear is the only honest answer.
  }
  return keys;
}

/**
 * Forget that anyone on this machine has seen the tour. Returns how many flags
 * were cleared. This is what re-arms AUTOSTART — the gate a brand-new operator
 * actually meets on their first dashboard load.
 */
export function clearTourSeenFlags(storage: Storage | null = safeStorage()): number {
  if (!storage) return 0;
  let cleared = 0;
  for (const key of tourStorageKeys(storage)) {
    try {
      storage.removeItem(key);
      cleared += 1;
    } catch {
      // The flag simply survives. Never worth throwing for.
    }
  }
  return cleared;
}

// ── The setup checklist's dismissal state ──────────────────────────────────

/**
 * Every localStorage/sessionStorage key that holds "the operator has already
 * dealt with the setup checklist" state, all suffixed with the tenant id.
 *
 * The checklist's PROGRESS is derived from real data — vehicles, Stripe,
 * Bonzah — and is deliberately not faked; what these keys hold is only the
 * dismissed/minimised/snoozed state that stops the guide from showing. The
 * file that writes each key is named beside it, because this list is the only
 * coupling to those surfaces: rename a key there and this is the one place
 * that has to follow. A test reads those files and checks each literal is
 * still present.
 */
export function checklistStorageKeys(tenantId: string): string[] {
  return [
    // components/dashboard-v2/setup-guide.tsx — panel expanded/minimized/closed
    `setup-guide-state-${tenantId}`,
    // components/dashboard/getting-started-checklist.tsx — the legacy card
    `getting-started-collapsed-${tenantId}`,
    `getting-started-dismissed-${tenantId}`,
    `getting-started-completed-at-${tenantId}`,
    // components/dashboard/setup-reminder-dialog.tsx — "don't show me again"
    `setup-reminder-dismissed-${tenantId}`,
    // …and its per-session snooze, which lives in sessionStorage
    `setup-reminder-snoozed-${tenantId}`,
  ];
}

/** `sessionStorage`, or null wherever touching it throws. */
export function safeSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Put the setup checklist back to its day-one state. Returns how many stored
 * values were removed across both stores. Clearing the panel key returns the
 * guide to its default (minimised, naming the next action), which IS what a
 * new operator sees — see `SetupGuide`.
 */
export function clearChecklistState(
  tenantId: string,
  local: Storage | null = safeStorage(),
  session: Storage | null = safeSessionStorage(),
): number {
  let cleared = 0;
  for (const key of checklistStorageKeys(tenantId)) {
    for (const store of [local, session]) {
      if (!store) continue;
      try {
        if (store.getItem(key) !== null) {
          store.removeItem(key);
          cleared += 1;
        }
      } catch {
        // Storage unavailable — nothing to clear.
      }
    }
  }
  return cleared;
}

// ── The first-run wizard's row ─────────────────────────────────────────────

type QueryResult<T> = PromiseLike<{ data: T; error: { message: string } | null }>;

/**
 * The slice of the Supabase client this module needs — structurally typed so a
 * test can hand in a fake, and so the real client can be passed as-is even
 * though `tenant_first_run` is absent from the generated types until its
 * migration reaches production and types are regenerated.
 */
export interface FirstRunClient {
  from(table: string): {
    delete(): {
      eq(column: string, value: string): { select(columns: string): QueryResult<unknown> };
    };
    select(columns: string): {
      eq(column: string, value: string): { maybeSingle(): QueryResult<unknown> };
    };
  };
}

export type FirstRunResetResult =
  /** The row is gone — either just deleted, or there was none to delete. */
  | { ok: true; deleted: number }
  /**
   * `blocked`: the row is still there after the delete. Row-level security
   * let this session READ it but not REMOVE it, and PostgREST reports that as
   * success with zero rows. This is the case a plain delete would have called
   * a success. `error`: the database said no out loud.
   */
  | { ok: false; reason: 'blocked' | 'error'; message: string };

/**
 * Re-arm the first-run wizard by deleting this tenant's `tenant_first_run`
 * row: the row EXISTING is the "already seen" flag, so removing it is the
 * whole reset. The wizard keeps nothing in localStorage.
 *
 * `.select('id')` on the delete is load-bearing, and so is the read-back. RLS
 * on that table decides who may delete, and a session it refuses gets back
 * success with zero rows — indistinguishable from "there was nothing to clear"
 * unless the row is then read again. A reset that reports success while the
 * wizard stays dark is worse than one that fails, so zero deleted rows is
 * never trusted on its own.
 */
export async function resetFirstRunRow(
  client: FirstRunClient,
  tenantId: string,
): Promise<FirstRunResetResult> {
  const deleted = await client
    .from('tenant_first_run')
    .delete()
    .eq('tenant_id', tenantId)
    .select('id');

  if (deleted.error) return { ok: false, reason: 'error', message: deleted.error.message };

  const count = Array.isArray(deleted.data) ? deleted.data.length : 0;
  if (count > 0) return { ok: true, deleted: count };

  const remaining = await client
    .from('tenant_first_run')
    .select('id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (remaining.error) return { ok: false, reason: 'error', message: remaining.error.message };
  if (remaining.data) {
    return {
      ok: false,
      reason: 'blocked',
      message:
        'The first-run record is still there after the delete: row-level security let this ' +
        'session read it but not remove it. Nothing was reset. Sign in as the head admin of ' +
        'this tenant (or a super admin) and try again.',
    };
  }
  return { ok: true, deleted: 0 };
}

// ── The tour's replay signal ───────────────────────────────────────────────

/**
 * Ask the mounted tour to run again, right now, in this tab. Bypasses the
 * "already seen" flag by design — replaying is an explicit act — but not the
 * tour's own anchor filter, which is a correctness rule rather than a
 * preference. Returns false only where there is no window to signal.
 */
export function replayTour(
  target: Pick<EventTarget, 'dispatchEvent'> | null = typeof window === 'undefined'
    ? null
    : window,
): boolean {
  if (!target) return false;
  target.dispatchEvent(new Event(REPLAY_TOUR_EVENT));
  return true;
}
