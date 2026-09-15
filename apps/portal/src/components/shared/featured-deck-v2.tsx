"use client";

import { useMemo, useRef, useState } from "react";
import { useV2 } from "@/lib/v2-context";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useFeatureAnnouncements } from "@/hooks/use-feature-announcements";
import { useTraxOptional } from "@/components/trax/trax-provider";
import { LEAN_HIDDEN_AREAS, isLeanTenant } from "@/lib/lean-areas";
import {
  buildDeck,
  rotationKey,
  type FeatureCardId,
  type FeaturedContext,
  type FeaturedHandlers,
  type FeaturedRecommendation,
  type FeaturedTab,
} from "@/lib/featured-cards";
import { FeaturedDeckView } from "./featured-deck-view-v2";

export {
  ADVANCE_MS,
  FEATURED_SHELL_CLASS,
  FeaturedCardFace,
  FeaturedCardShell,
  FeaturedDeckView,
  MAX_DOTS,
  type FeaturedDeckViewProps,
} from "./featured-deck-view-v2";
export { FeaturedArtSlot, FeaturedCardArt } from "./featured-card-art-v2";

/**
 * The featured deck for a hero tab: the card beside the graph, which shows off
 * a feature, a recommendation or a platform announcement, one at a time.
 *
 * USE
 *
 *   <HeroRow
 *     chart={…}
 *     card={
 *       <FeaturedDeck
 *         tab="rentals"
 *         routePrefixes={["/rentals", "/turo-bridge"]}
 *         handlers={{ openCalendar: onOpenCalendar }}
 *         recommendations={[…]}
 *         anchor="rentals-featured"
 *       />
 *     }
 *   />
 *
 * Pass the deck DIRECTLY as HeroRow's `card`. It renders nothing when no card
 * is eligible, and HeroRow gives the graph the whole row when its card slot is
 * empty; wrapping the deck in another element would defeat that.
 *
 * WHAT THE TAB SUPPLIES, AND WHAT IT DOES NOT
 *
 * The tab supplies only what it alone knows: its callbacks (`openCalendar`,
 * `openInvite`, `openImport`, or any a recommendation names), the
 * recommendations it can derive from rows it already holds, "already adopted"
 * signals, and the route prefixes an announcement must point under. Everything
 * a gate reads — v2 area flags, the lean product, manager permissions, the
 * tenant's Turo switch, whether Trax is mounted, the signed-in user for
 * rotation — is read here, from the same hooks the destinations themselves
 * use, so a tab cannot pass a stale or wrong answer for one of them.
 *
 * `openTrax` is supplied here from the Trax provider when one is mounted; a tab
 * may override it.
 *
 * v2 only. Rendered inside the v2 hero tabs; nothing in v1 imports it.
 */

export interface FeaturedDeckProps {
  tab: FeaturedTab;
  /**
   * Same-origin route prefixes an announcement's CTA must fall under to join
   * this deck, e.g. Rentals ["/rentals"], Vehicles ["/vehicles",
   * "/blocked-dates"], Customers ["/customers"].
   */
  routePrefixes: readonly string[];
  /** Callbacks by handler name. A card whose handler is missing is not shown. */
  handlers?: FeaturedHandlers;
  /** Derived by the page from data it already holds. A count of 0 hides one. */
  recommendations?: readonly FeaturedRecommendation[];
  /** `true` hides that feature card, e.g. `{ "import-customers": customers.length > 0 }`. */
  adopted?: Partial<Record<FeatureCardId, boolean>>;
  /** data-tour anchor on the deck root (the same prop name HeroChart uses). */
  anchor?: string;
  /**
   * The same anchor under its attribute name, for a call site that writes
   * `data-tour="…"` on the deck as it would on a button. Without this that
   * attribute would be swallowed silently and the tour step would find nothing.
   * `anchor` wins when both are given.
   */
  "data-tour"?: string;
  className?: string;
  /** For tests. Defaults to the moment the deck mounts. */
  now?: Date;
}

export function FeaturedDeck({
  tab,
  routePrefixes,
  handlers,
  recommendations,
  adopted,
  anchor,
  "data-tour": dataTour,
  className,
  now,
}: FeaturedDeckProps) {
  // The v2 areas a registry gate reads, one call each. When a gate starts
  // reading another area, add it here: an area missing from `v2` reads as off,
  // so forgetting fails closed (the card never shows) rather than open.
  const turo = useV2("turo");
  const availability = useV2("availability");

  const { tenant, tenantSlug, loading: tenantLoading } = useTenant();
  const { appUser } = useAuth();
  const { canView, canEdit, canAccessRoute, isLoading: permissionsLoading } = useManagerPermissions();
  const openTrax = useTraxOptional()?.openSheet;
  const { announcements, isLoading: announcementsLoading, dismiss } = useFeatureAnnouncements();
  const [mountedAt] = useState(() => new Date());

  const supplied = useMemo<FeaturedHandlers>(() => {
    const out: FeaturedHandlers = {};
    if (openTrax) out.openTrax = openTrax;
    for (const [name, fn] of Object.entries(handlers ?? {})) {
      if (typeof fn === "function") out[name] = fn;
    }
    return out;
  }, [openTrax, handlers]);

  // The tenant's Turo switch, remembered per tenant id across a RELOAD of the
  // tenant row. TenantContext's refetchTenant() (the v2 user menu calls it
  // after a name change) puts `loading` back to true while the page stays
  // mounted; reading that as "unknown" pulled Turo Sync out of the deck and put
  // it back a moment later. Unknown still refuses on the first load, and for a
  // tenant id this deck has not seen resolve.
  const tenantId = (tenant as { id?: string } | null)?.id ?? null;
  const turoFlag = (tenant as { turo_bridge_enabled?: boolean } | null)?.turo_bridge_enabled === true;
  const knownTuro = useRef<{ tenantId: string | null; enabled: boolean } | null>(null);
  if (!tenantLoading) knownTuro.current = { tenantId, enabled: turoFlag };
  const turoBridgeEnabled = !tenantLoading
    ? turoFlag
    : knownTuro.current && knownTuro.current.tenantId === tenantId
      ? knownTuro.current.enabled
      : null;

  const slug = tenantSlug ?? tenant?.slug ?? null;
  const lean = isLeanTenant(slug);
  const ctx: FeaturedContext = {
    v2: { turo, availability },
    isLean: lean,
    hiddenAreas: lean ? LEAN_HIDDEN_AREAS : [],
    canView,
    canEdit,
    canAccessRoute,
    // Unknown (null) while the tenant row is first in flight; the column arrives
    // through TenantContext's optional column list, so anything but `true`
    // refuses. A reload keeps the last answer (above).
    turoBridgeEnabled,
    hasTrax: !!openTrax,
    handlers: Object.keys(supplied),
    adopted: adopted ?? {},
  };

  const cards = buildDeck({
    tab,
    ctx,
    routePrefixes,
    announcements,
    recommendations,
    now: now ?? mountedAt,
  });

  // A manager's grants, the tenant row and the announcements read can each add
  // or remove cards when they land, so the visit's start card waits for all
  // three. Non-managers and non-canary tenants resolve at once (both queries
  // are disabled for them).
  //
  // LATCHED: once ready, the deck stays ready for the life of this mount. A
  // later reload of any input (refetchTenant() flips the tenant's `loading`
  // back on; a changed query key re-pends a query) must not blank the card,
  // unmount its dots and controls, mark the region aria-hidden and drop a
  // keyboard user's focus to <body>. Cards still follow the inputs as they are.
  const inputsResolved = !announcementsLoading && !tenantLoading && !permissionsLoading;
  const [wasReady, setWasReady] = useState(false);
  if (inputsResolved && !wasReady) setWasReady(true);
  const ready = inputsResolved || wasReady;

  return (
    <FeaturedDeckView
      cards={cards}
      ready={ready}
      handlers={supplied}
      storageKey={rotationKey(tab, appUser?.id)}
      onDismissAnnouncement={dismiss}
      anchor={anchor ?? dataTour}
      className={className}
    />
  );
}
