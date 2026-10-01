"use client";

/**
 * The `/dev` switch that holds every auto skeleton on screen.
 *
 * A real load lasts half a second, so without this a skeleton can only be
 * judged in a blink. Like the other controls here it only writes
 * `lib/dev-overrides.ts`: a per-browser developer preference, nothing stored.
 */

import { useSyncExternalStore } from "react";
import { ScanLine } from "lucide-react";

import {
  Card, CardDescription, CardHeader, CardTitle,
} from "@/components/ui-v2/card";
import { readHoldSkeletons, setHoldSkeletons, subscribeDevOverrides } from "@/lib/dev-overrides";

export function SkeletonPreview() {
  const held = useSyncExternalStore(subscribeDevOverrides, () => readHoldSkeletons(), () => false);

  return (
    <Card className="mt-6">
      <CardHeader>
        <label className="flex cursor-pointer items-start justify-between gap-4">
          <span>
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <ScanLine className="h-4 w-4" />
              Hold skeletons
            </CardTitle>
            <CardDescription className="mt-1.5">
              Keeps every page that uses the auto skeleton in its loading state, so the skeleton
              can be looked at properly. The page underneath is the real one; turn this off and
              the data comes straight back.
            </CardDescription>
          </span>
          <input
            type="checkbox"
            checked={held}
            onChange={(e) => setHoldSkeletons(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
          />
        </label>
      </CardHeader>
    </Card>
  );
}
