import { useSyncExternalStore } from "react";
import {
  isEmptyStateForced,
  subscribeDevOverrides,
  type EmptyStatePageId,
} from "@/lib/dev-overrides";

/**
 * Is this listing page forced into its teaching empty state by the developer
 * override? See `lib/dev-overrides.ts` for the mechanism and the guards.
 *
 * Call it unconditionally at the top of the page, like any hook, and compose
 * the result INSIDE the lean gate:
 *
 *     const devForceEmpty = useForcedEmptyState("vehicles");
 *     const teachEmptyFleet = isLeanTenant(tenantSlug) && (vehicles.length === 0 || devForceEmpty);
 *
 * `useSyncExternalStore` rather than state + effect so a toggle on `/dev`
 * re-renders the page without a reload — in this tab through the custom
 * event, in another tab through `storage`. The server snapshot is a constant
 * `false`: the flag lives in the browser, so the server render and the first
 * client render agree and there is no hydration mismatch; React then applies
 * the real client value in the same commit.
 *
 * Outside development `isEmptyStateForced` folds to `false` and
 * `subscribeDevOverrides` to a no-op, so this hook costs a production page one
 * store read that returns a literal.
 */
export function useForcedEmptyState(pageId: EmptyStatePageId): boolean {
  return useSyncExternalStore(
    subscribeDevOverrides,
    () => isEmptyStateForced(pageId),
    () => false,
  );
}
