import { useSyncExternalStore } from "react";
import { readHoldSkeletons, subscribeDevOverrides } from "@/lib/dev-overrides";

/**
 * A page's loading flag for <AutoSkeleton>: the real one, or held on by the
 * developer "Hold skeletons" switch on `/dev` so the skeleton can be looked at.
 * Outside development the switch folds to `false` (lib/dev-overrides.ts).
 *
 *     const isLoading = useSkeletonLoading(vehiclesLoading || plLoading);
 */
export function useSkeletonLoading(loading: boolean): boolean {
  const held = useSyncExternalStore(subscribeDevOverrides, () => readHoldSkeletons(), () => false);
  return loading || held;
}
