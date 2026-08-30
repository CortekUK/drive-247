/**
 * useAppBanners — the single registry every banner source feeds into.
 *
 * WHY A REGISTRY AND NOT JUST RENDERING EACH BANNER
 * -------------------------------------------------
 * Seven banner components already render themselves independently
 * (maintenance, Xero, low credits, platform status, Bonzah x2, go-live).
 * Each decides its own visibility, its own dismissal, and its own place in the
 * DOM — so on a bad day an operator meets a wall of stacked bars and stops
 * reading any of them. That is precisely how the GMT deposit notification
 * became invisible.
 *
 * Collecting sources here gives the stack one ordered list to reason about, so
 * it can rank by severity, keep criticals always visible, and fold the rest into
 * a single "N more notices" row.
 *
 * ADDING A SOURCE
 * ---------------
 * Write a hook returning `AppBanner[]` (return `[]` when there is nothing to
 * say), then add it to `sources` below. Hooks are called unconditionally and in
 * a fixed order — never behind a condition — because they are React hooks.
 *
 * WHAT THIS FILE ENFORCES, AND WHY IT IS HERE RATHER THAN IN BannerStack
 * ---------------------------------------------------------------------
 * `requiresTab`. BannerStack is a renderer: it filters on `scope` and
 * `hideOnPathPrefix` and nothing else. Permission is not a rendering concern —
 * it decides whether a banner should EXIST for this operator at all. A manager
 * whose permissions exclude a tab cannot open the page a banner links to, so
 * showing them the alarm hands them something frightening and no way to act on
 * it.
 *
 * Sources are free to short-circuit internally as well (the deposit source
 * does). This is the backstop, so a future source that forgets cannot leak one.
 */
"use client";

import { useMemo } from "react";

import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import type { AppBanner } from "./banner-types";
import { useAccountingBanners } from "./sources/accounting-banners";
import { useDepositHoldBanners } from "./sources/deposit-hold-banners";

export function useAppBanners(): AppBanner[] {
  // Hooks first, unconditionally, in a stable order.
  const deposit = useDepositHoldBanners();
  const accounting = useAccountingBanners();
  const { canView } = useManagerPermissions();

  return useMemo(() => {
    const all: AppBanner[] = [...deposit, ...accounting];

    return all.filter((b) => (b.requiresTab ? canView(b.requiresTab) : true));
    // `canView` is rebuilt on every render of the permissions hook, so it is
    // deliberately NOT a dependency — including it would defeat the memo. The
    // permission data it closes over is what actually changes, and that
    // re-renders this hook anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deposit, accounting]);
}
