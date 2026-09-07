"use client";

// ── Integration pins — one operator's shortlist, kept on their own device ─────
//
// An operator with thirteen cards on this board cares about two or three of
// them. Pinning floats those to the top of the grid; unpinning drops the card
// straight back into the board's default position. That is the whole feature.
//
// ── WHY localStorage, AND NOT THE DATABASE ──────────────────────────────────
//
// The portal already has a preference store: `use-nav-preferences.ts`, backed
// by the `user_nav_preferences` table, which is what
// `components/shared/layout/sidebar-customizer-dialog.tsx` saves through. It
// was read first and deliberately NOT used here, for three reasons:
//
//   1. It is ONE JSONB blob per `app_users.id`, upserted whole
//      (`onConflict: "app_user_id"`). Putting pins in that column means the
//      sidebar customiser and this board write the same row — and the
//      customiser's save sends a `preferences` object built from its own draft,
//      so it would silently drop the pins on every sidebar save. Last writer
//      wins, and the loser is invisible.
//   2. That is also exactly the shape V2_PLAN §2 forbids: two in-flight v2
//      areas sharing one thing. The sidebar is somebody else's area right now.
//   3. Giving pins their own column or table means a migration, and V2_PLAN §4
//      is additive-only with the `tenants` anon-grant trap sitting next to it.
//      A card ordering preference is not worth a schema change.
//
// So this follows the portal's OTHER established persistence pattern — the one
// that actually fits a personal, non-critical, per-device view preference:
// `components/banners/use-banner-dismissal.ts`. Same key shape
// (`d247.<domain>.v<n>.…`), same memory fallback when storage throws, same
// cross-tab `storage` listener.
//
// ── KEY SHAPE ────────────────────────────────────────────────────────────────
//
//   d247.integrations.pins.v1.<tenantId>.<appUserId>   ->   ["Stripe Connect", …]
//
// Per TENANT and per USER, both. Per-tenant because a super admin hopping
// between operators must not carry one tenant's shortlist into the next.
// Per-user because a pin is a personal preference: two operators sharing a
// tenant have different jobs, and one of them re-ordering the other's board
// every morning is a worse feature than no feature.
//
// ── FAILURE ──────────────────────────────────────────────────────────────────
//
// Every read and write is wrapped. Storage that throws (Safari private mode, a
// managed profile with site data disabled) or comes back empty (cleared data, a
// fresh browser) means NO pins, which renders the board exactly as it looks
// today. There is no state in which a storage failure can hide a card.

import { useCallback, useEffect, useMemo, useState } from "react";

import { useTenant } from "@/contexts/TenantContext";
import { useAuthStore } from "@/stores/auth-store";

const PREFIX = "d247.integrations.pins.v1.";

/** Exported so tests can address a key without re-deriving the shape. */
export const integrationPinsKey = (tenantId: string, appUserId: string): string =>
  `${PREFIX}${tenantId}.${appUserId}`;

/**
 * A ceiling on what one key can hold.
 *
 * There are thirteen cards, so this can never be reached by the UI. It exists
 * because the value on disk is attacker-adjacent input the moment a user opens
 * devtools, and an unbounded array read out of storage is an unbounded array
 * rendered into a grid.
 */
const MAX_PINS = 32;

/**
 * Fallback store, used ONLY once storage has proven it cannot hold anything.
 *
 * Consulting it whenever storage merely came back empty would make the memory
 * copy shadow the real one — a pin cleared in another tab would still be found
 * here, and the board would stay re-ordered with nothing on disk explaining
 * why. Same reasoning, and the same `storageUsable` latch, as
 * `use-banner-dismissal.ts`.
 */
const memoryStore = new Map<string, string[]>();
let storageUsable = true;

/**
 * Keep only strings that are actually cards on the board, de-duplicated.
 *
 * A stored name that no longer matches a card is dropped rather than kept: an
 * integration that gets renamed or removed would otherwise leave a pin that can
 * never be seen and never be cleared, because the only way to unpin something
 * is to click the card it is on.
 */
function sanitise(value: unknown, known: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(known);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (!allowed.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
    if (out.length >= MAX_PINS) break;
  }
  return out;
}

/** The pins on disk for this key, or `[]` for anything that is not a clean list. */
export function readPins(key: string, known: readonly string[]): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) return sanitise(JSON.parse(raw) as unknown, known);
    // Storage is readable and holds nothing. Believe it.
    return storageUsable ? [] : sanitise(memoryStore.get(key), known);
  } catch {
    // Unparseable JSON is handled above (it throws here and yields no pins,
    // which is the right answer); this also covers storage being unavailable.
    return sanitise(memoryStore.get(key), known);
  }
}

/** Persist the pins for this key, degrading to memory rather than throwing. */
export function writePins(key: string, pins: readonly string[]): void {
  const value = pins.slice(0, MAX_PINS);
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exhausted, or storage disabled. Losing the shortlist on reload is
    // a small cost; throwing out of a click handler on the board is not.
    storageUsable = false;
    memoryStore.set(key, [...value]);
  }
}

/**
 * Split a list into [pinned, everything else], each in the list's OWN order.
 *
 * Pinned cards keep the board's default ordering rather than the order they
 * were pinned in. Insertion order would make an already-pinned card jump
 * whenever a different one is pinned, and it makes "unpinning returns the card
 * to its default position" the only half of the promise that is predictable.
 * Sorting both halves by the board keeps the grid stable in both directions.
 */
export function partitionByPins<T extends { name: string }>(
  items: readonly T[],
  pinned: ReadonlySet<string>,
): { pinned: T[]; rest: T[] } {
  const first: T[] = [];
  const rest: T[] = [];
  for (const item of items) (pinned.has(item.name) ? first : rest).push(item);
  return { pinned: first, rest };
}

export interface UseIntegrationPinsResult {
  /** Names currently pinned. Empty until storage has been read. */
  pinned: ReadonlySet<string>;
  isPinned: (name: string) => boolean;
  /** Pin an unpinned card, unpin a pinned one. No-op before `ready`. */
  toggle: (name: string) => void;
  /**
   * False until storage has been read (or has been established as
   * unreadable). The board still renders every card while this is false — it
   * just renders them in the default order, which is what an operator with no
   * pins sees anyway.
   */
  ready: boolean;
}

/**
 * The logged-in user's pinned integrations for the tenant they are looking at.
 *
 * @param known Every card name on the board. Anything outside this list is
 *   dropped on read and on write, so a stale name cannot survive a rename.
 */
export function useIntegrationPins(
  known: readonly string[],
): UseIntegrationPinsResult {
  const { tenant } = useTenant();
  // A narrow selector rather than `useAuth()`, which subscribes to the whole
  // auth store — the board would then re-render on every session refresh for a
  // value it reads once.
  const appUserId = useAuthStore((s) => s.appUser?.id ?? null);
  const tenantId = tenant?.id ?? null;

  const key = tenantId && appUserId ? integrationPinsKey(tenantId, appUserId) : null;

  // `null` means "not read yet", which is what `ready` reports. It is distinct
  // from `[]`, which means "read, and nothing is pinned".
  const [pins, setPins] = useState<string[] | null>(null);

  // Joined rather than the array itself: the board hands us a freshly-derived
  // list on every render and only a change to the SET of names should re-read.
  const knownKey = known.join("|");

  const load = useCallback(() => {
    if (!key) {
      setPins(null);
      return;
    }
    setPins(readPins(key, knownKey ? knownKey.split("|") : []));
  }, [key, knownKey]);

  useEffect(() => {
    load();
  }, [load]);

  // Operators run two tabs. `storage` fires only in OTHER tabs, so this keeps
  // them in step with no risk of a feedback loop.
  useEffect(() => {
    if (!key) return;
    const onStorage = (event: StorageEvent) => {
      // A null key means the whole store was cleared.
      if (event.key === null || event.key === key) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, load]);

  const pinnedSet = useMemo(() => new Set(pins ?? []), [pins]);

  // Computed outside the state updater on purpose: `writePins` is a side
  // effect, and React invokes updaters twice under StrictMode.
  const toggle = useCallback(
    (name: string) => {
      if (!key) return;
      const current = pins ?? [];
      const next = current.includes(name)
        ? current.filter((n) => n !== name)
        : [...current, name];
      writePins(key, next);
      setPins(next);
    },
    [key, pins],
  );

  return {
    pinned: pinnedSet,
    isPinned: useCallback((name: string) => pinnedSet.has(name), [pinnedSet]),
    toggle,
    ready: pins !== null,
  };
}
