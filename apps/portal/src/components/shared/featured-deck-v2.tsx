"use client";

import { useMemo, useRef, useState } from "react";
import { useV2 } from "@/lib/v2-context";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useTraxOptional } from "@/components/trax/trax-provider";
import { LEAN_HIDDEN_AREAS, isLeanTenant } from "@/lib/lean-areas";
import { useIsLean } from "@/lib/lean-context";
import {
  buildDeck,
  pickHeroCard,
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
 * The featured card for a hero tab: the ONE card beside the graph.
 *
 * It was a rotating carousel of features, recommendations and announcements.
 * Team lead, Sep 16 2026: show a single, minimal card instead. Announcements
 * left the hero decks the same day; they live on the dashboard desk band only
 * (components/announcements/feature-announcement-deck.tsx). `buildDeck`
 * still works out what is eligible; `pickHeroCard` keeps one (Calendar View on
 * Rentals). With one card the view draws no dots, no arrows and never rotates.
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
 * recommendations it can derive from rows it already holds and "already adopted"
 * signals. Everything
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
   * Same-origin route prefixes this tab lives under, e.g. Rentals ["/rentals"],
   * Vehicles ["/vehicles", "/blocked-dates"], Customers ["/customers"].
   *
   * NOT READ any more. It decided which platform announcements joined the deck,
   * and announcements left the hero decks on Sep 16 2026. Kept, optional, so
   * the tabs that pass it (and their tests, which assert it) need no change.
   */
  routePrefixes?: readonly string[];
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
  const { canView, canEdit, canAccessRoute, isLoading: permissionsLoading } = useManagerPermissions();
  const openTrax = useTraxOptional()?.openSheet;
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
  // The resolved answer (slug list OR `portal_experience`) OR'd with this
  // deck's own slug fallback, which also accepts `tenant.slug` when the
  // header slug is absent. Never narrower than it was.
  const lean = useIsLean() || isLeanTenant(slug);
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

  const cards = pickHeroCard(
    tab,
    buildDeck({
      tab,
      ctx,
      recommendations,
      now: now ?? mountedAt,
    }),
  );

  // A manager's grants and the tenant row can each add or remove cards when
  // they land, so the visit's start card waits for both. Non-managers resolve
  // at once (the grants query is disabled for them).
  //
  // LATCHED: once ready, the deck stays ready for the life of this mount. A
  // later reload of any input (refetchTenant() flips the tenant's `loading`
  // back on; a changed query key re-pends a query) must not blank the card,
  // unmount its dots and controls, mark the region aria-hidden and drop a
  // keyboard user's focus to <body>. Cards still follow the inputs as they are.
  const inputsResolved = !tenantLoading && !permissionsLoading;
  const [wasReady, setWasReady] = useState(false);
  if (inputsResolved && !wasReady) setWasReady(true);
  const ready = inputsResolved || wasReady;

  return (
    <FeaturedDeckView
      cards={cards}
      ready={ready}
      handlers={supplied}
      anchor={anchor ?? dataTour}
      className={className}
    />
  );
}
