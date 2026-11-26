/**
 * Tour state follows the person, not the browser.
 *
 * The tours keep their state in localStorage under `d247.tour.…<appUserId>`
 * keys (the quick tour's "seen" and card, each tab tour's topics). That stays
 * the working copy: it is synchronous, so the tour logic did not have to change.
 * This module mirrors those keys to `user_tour_progress`, one row per key, so
 * the same person on a phone tomorrow picks up where the laptop left off.
 *
 *   write  every tour write calls `noteTourWrite(key)`, which stamps the time
 *          and tells `TourSync` (the component) to upsert that one row.
 *   read   on sign-in `TourSync` pulls the rows and keeps, per key, whichever
 *          side was written last. Until that pull answers, `isTourSyncReady()`
 *          is false and the quick tour does not autostart, so a new device
 *          does not start a tour the person already finished elsewhere.
 *
 * If the table is missing or unreachable the tours work exactly as before,
 * from the browser alone.
 */

export const TOUR_KEY_PREFIX = 'd247.tour.';
const TIMES_KEY = 'd247.toursync.times';
const PAUSED_KEY = 'd247.toursync.paused';
export const TOUR_WRITE_EVENT = 'd247:tour-write';
export const TOUR_SYNC_READY_EVENT = 'd247:tour-sync-ready';

let ready = false;

function local(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readTimes(): Record<string, string> {
  try {
    const raw = local()?.getItem(TIMES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeTimes(times: Record<string, string>): void {
  try {
    local()?.setItem(TIMES_KEY, JSON.stringify(times));
  } catch {
    /* storage blocked: the next pull simply wins */
  }
}

/** When this browser last wrote `key`, or null. */
export function localWriteTime(key: string): string | null {
  return readTimes()[key] ?? null;
}

/** A tour key was just written (or removed) in this browser. */
export function noteTourWrite(key: string): void {
  if (typeof window === 'undefined' || !key.startsWith(TOUR_KEY_PREFIX)) return;
  const times = readTimes();
  times[key] = new Date().toISOString();
  writeTimes(times);
  window.dispatchEvent(new CustomEvent(TOUR_WRITE_EVENT, { detail: { key } }));
}

/** Forget the write times, after a local reset. */
export function clearTourWriteTimes(): void {
  try {
    local()?.removeItem(TIMES_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * The database key for a browser key: the key without `.<appUserId>` on the
 * end. Null for a key that is not this user's tour key.
 */
export function serverKeyFor(localKey: string, appUserId: string): string | null {
  if (!localKey.startsWith(TOUR_KEY_PREFIX)) return null;
  const suffix = `.${appUserId}`;
  if (!localKey.endsWith(suffix)) return null;
  return localKey.slice(0, -suffix.length);
}

export function localKeyFor(serverKey: string, appUserId: string): string {
  return `${serverKey}.${appUserId}`;
}

/** Every tour key this browser holds for this user. */
export function localTourKeys(appUserId: string): string[] {
  const store = local();
  if (!store) return [];
  const out: string[] = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && serverKeyFor(key, appUserId)) out.push(key);
    }
  } catch {
    return [];
  }
  return out;
}

export interface ServerTourRow {
  tour_key: string;
  value: string | null;
  updated_at: string;
}

/**
 * Lay the database rows over this browser. Per key, the later write wins.
 * Returns the browser keys that are newer here (or missing there), which the
 * caller pushes up.
 */
export function mergeServerRows(rows: readonly ServerTourRow[], appUserId: string): string[] {
  const store = local();
  if (!store) return [];
  const times = readTimes();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = localKeyFor(row.tour_key, appUserId);
    seen.add(key);
    const mine = times[key];
    if (mine && mine >= row.updated_at) continue;
    try {
      if (row.value === null) store.removeItem(key);
      else store.setItem(key, row.value);
      times[key] = row.updated_at;
    } catch {
      /* storage blocked */
    }
  }
  writeTimes(times);
  const push: string[] = [];
  for (const key of localTourKeys(appUserId)) {
    const t = times[key];
    const row = rows.find((r) => localKeyFor(r.tour_key, appUserId) === key);
    if (!row || (t && t > row.updated_at)) push.push(key);
  }
  // Removed here after the last pull (the key is gone but has a newer time).
  for (const [key, t] of Object.entries(times)) {
    if (!serverKeyFor(key, appUserId) || push.includes(key)) continue;
    const row = rows.find((r) => localKeyFor(r.tour_key, appUserId) === key);
    if (row && row.value !== null && t > row.updated_at && store.getItem(key) === null) push.push(key);
  }
  return push;
}

export function isTourSyncReady(): boolean {
  return ready;
}

export function setTourSyncReady(value: boolean): void {
  ready = value;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TOUR_SYNC_READY_EVENT));
}

/**
 * Sync paused: read and write the browser only. Used on a developer's
 * machine to try tours without touching the database. Per tab.
 */
export function isTourSyncPaused(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(PAUSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setTourSyncPaused(paused: boolean): void {
  try {
    if (paused) window.sessionStorage.setItem(PAUSED_KEY, '1');
    else window.sessionStorage.removeItem(PAUSED_KEY);
  } catch {
    /* storage blocked */
  }
}
