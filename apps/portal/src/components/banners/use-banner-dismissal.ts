/**
 * useBannerDismissal — one dismissal model for every banner in the portal.
 *
 * Replaces three bespoke implementations that currently disagree with each
 * other (`setup-hub-live-dismissed-*`, `low-credits-dismissed-*`,
 * `bonzah-active-dismissed-*-*`), and gives the four banners that have no
 * dismiss affordance at all a way to grow one.
 *
 * ── KEY SHAPE ──────────────────────────────────────────────────────────────
 *
 *   d247.banner.v1.<tenantId>.<bannerId>   ->   { "fp": "<fingerprint>", "at": 1755388800000 }
 *
 * The fingerprint lives in the VALUE, not the key. The obvious alternative is
 * what `bonzah-status-banner.tsx` does today —
 * `bonzah-active-dismissed-${tenant.id}-${submissionId}` — which works and
 * leaks: every new occurrence writes a NEW key and the old ones are never
 * collected. A fingerprint built from a rental-id set churns on every fleet
 * change, so a busy tenant accumulates unbounded entries until `localStorage`
 * hits its ~5MB quota, at which point `setItem` throws and dismissal silently
 * stops working *for every banner at once*. Fingerprint-in-value means exactly
 * one key per (tenant, condition), forever, and the comparison does the work.
 *
 * `<tenantId>` in the key is what makes this per-tenant: a super admin hopping
 * between tenants sees each tenant's real state instead of inheriting the
 * dismissals of whichever one they looked at first.
 *
 * ── VISIBILITY ─────────────────────────────────────────────────────────────
 *
 *   visible = no record                       // never dismissed
 *          || record.fp !== banner.fingerprint // NEW occurrence — re-show
 *          || Date.now() - record.at >= ttl    // silence expired — re-show
 *
 * ── MIGRATION ──────────────────────────────────────────────────────────────
 * The three legacy keys are abandoned rather than migrated. Worst case an
 * operator sees one already-dismissed banner once more; for a `success` banner
 * that is harmless, and for low-credits it is arguably correct. Migration code
 * for that is not worth the surface area.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useTenant } from "@/contexts/TenantContext";

import { resolveTtlMs, type AppBanner } from "./banner-types";

const PREFIX = "d247.banner.v1.";

/** Exported so sources and tests can address a key without re-deriving it. */
export const bannerDismissalKey = (tenantId: string, bannerId: string): string =>
  `${PREFIX}${tenantId}.${bannerId}`;

interface DismissalRecord {
  /** Fingerprint of the occurrence that was dismissed. */
  fp: string;
  /** Epoch ms of the dismissal, for the TTL comparison. */
  at: number;
}

/**
 * Fallback store. Safari private mode throws on `setItem`, and some managed
 * browser profiles disable storage entirely. Losing dismissal across a reload
 * is bad; throwing inside a hook that gates the whole app shell is worse — so
 * we degrade to in-memory and the dismissal at least survives the session.
 */
const memoryStore = new Map<string, DismissalRecord>();

/**
 * Flipped false the first time a write actually throws.
 *
 * This flag is what keeps the fallback from becoming a bug. Consulting
 * `memoryStore` whenever `localStorage` merely came back EMPTY would make the
 * memory copy shadow the real store: a record cleared in another tab (or by the
 * user clearing site data) would still be found in memory, and the banner would
 * stay silenced with nothing on disk explaining why. While storage works it is
 * the single source of truth; memory is consulted only once storage has proven
 * it cannot hold anything.
 */
let storageUsable = true;

const isRecord = (value: unknown): value is DismissalRecord =>
  !!value &&
  typeof value === "object" &&
  typeof (value as DismissalRecord).fp === "string" &&
  typeof (value as DismissalRecord).at === "number";

const readRecord = (key: string): DismissalRecord | null => {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as unknown;
      // Corrupt values, and the legacy `"true"` the old bespoke banners wrote,
      // are treated as NO record. That errs toward showing the banner, which is
      // the only safe direction to fail on a money warning.
      return isRecord(parsed) ? parsed : null;
    }
    // Storage is readable and holds nothing. Believe it.
    return storageUsable ? null : (memoryStore.get(key) ?? null);
  } catch {
    // Unparseable is handled above, so this is storage being unavailable.
    return memoryStore.get(key) ?? null;
  }
};

const writeRecord = (key: string, record: DismissalRecord): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Quota exhausted or storage disabled (Safari private mode). Degrade to
    // memory for the rest of the session rather than throwing inside a hook
    // that gates the app shell.
    storageUsable = false;
    memoryStore.set(key, record);
  }
};

const removeRecord = (key: string): void => {
  memoryStore.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
};

/**
 * Forget a dismissal. Call this when a condition CLEARS, so that a later
 * recurrence starts from a clean slate instead of inheriting a stale silence
 * (e.g. a cohort empties, then the same cohort refills next week).
 */
export const clearBannerDismissal = (
  tenantId: string,
  bannerId: string,
): void => removeRecord(bannerDismissalKey(tenantId, bannerId));

export interface UseBannerDismissalResult {
  /** The input banners minus anything currently silenced. */
  visible: AppBanner[];
  /** Persist a dismissal for this banner's current occurrence. */
  dismiss: (banner: AppBanner) => void;
  /** Undo — mainly for tests and a future "restore notices" control. */
  restore: (banner: AppBanner) => void;
  /**
   * False until storage has been read. Callers must render nothing while this
   * is false, otherwise a dismissed banner flashes on every navigation.
   */
  ready: boolean;
}

export function useBannerDismissal(
  banners: AppBanner[],
): UseBannerDismissalResult {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;

  // Join, not the array itself: callers may hand us a freshly-built array on
  // every render, and we only want to re-read storage when the SET of ids
  // actually changes.
  const idsKey = banners.map((b) => b.id).join("|");

  /**
   * `null`            — storage not read yet; render nothing.
   * `{}`/missing key  — that banner's record has not been loaded yet.
   * `id -> null`      — loaded, and there is no dismissal.
   *
   * The three-way distinction matters: treating a not-yet-loaded id as
   * "never dismissed" would flash an already-dismissed banner for one frame
   * every time a new banner joins the array.
   */
  const [records, setRecords] = useState<Record<
    string,
    DismissalRecord | null
  > | null>(null);

  const load = useCallback(() => {
    if (!tenantId) return;
    const ids = idsKey ? idsKey.split("|") : [];
    const next: Record<string, DismissalRecord | null> = {};
    for (const id of ids) next[id] = readRecord(bannerDismissalKey(tenantId, id));
    setRecords(next);
  }, [tenantId, idsKey]);

  useEffect(() => {
    load();
  }, [load]);

  // Operators routinely run two tabs. `storage` fires only in OTHER tabs, so
  // this syncs a dismissal across them without any risk of a feedback loop.
  useEffect(() => {
    if (!tenantId) return;
    const scope = `${PREFIX}${tenantId}.`;
    const onStorage = (event: StorageEvent) => {
      // A `null` key means the whole store was cleared.
      if (event.key === null || event.key.startsWith(scope)) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [tenantId, load]);

  const dismiss = useCallback(
    (banner: AppBanner) => {
      if (!tenantId || !banner.dismissal) return;
      const record: DismissalRecord = {
        fp: banner.dismissal.fingerprint,
        at: Date.now(),
      };
      writeRecord(bannerDismissalKey(tenantId, banner.id), record);
      setRecords((prev) => ({ ...(prev ?? {}), [banner.id]: record }));
    },
    [tenantId],
  );

  const restore = useCallback(
    (banner: AppBanner) => {
      if (!tenantId) return;
      removeRecord(bannerDismissalKey(tenantId, banner.id));
      setRecords((prev) => ({ ...(prev ?? {}), [banner.id]: null }));
    },
    [tenantId],
  );

  const visible = useMemo(() => {
    if (records == null || !tenantId) return [];
    const now = Date.now();
    return banners.filter((banner) => {
      if (!banner.dismissal) return true; // not dismissible — always shown
      if (!(banner.id in records)) return false; // record still loading
      const record = records[banner.id];
      if (!record) return true; // never dismissed
      if (record.fp !== banner.dismissal.fingerprint) return true; // new occurrence
      // TTL. Note this is evaluated on render rather than on a timer: every
      // banner source polls (5 min for the deposit hooks), so a still-true
      // condition produces a fresh array long before a 24h silence lapses.
      // A dedicated ticker would buy nothing but re-renders.
      return now - record.at >= resolveTtlMs(banner);
    });
  }, [banners, records, tenantId]);

  return { visible, dismiss, restore, ready: records != null && !!tenantId };
}

export default useBannerDismissal;
