"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { TraxSupportDialog } from "./support/TraxSupportDialog";
import { useTenant } from "@/contexts/TenantContext";
import { useV2, usePortalOnV2 } from "@/lib/v2-context";
import { isV2 } from "@/lib/v2";

/**
 * Imperative handle: one verb, "open the Trax conversation".
 */
export type TraxLauncherHandle = {
  open: () => void;
};

/**
 * One V2 assistant, opened by the existing sidebar Ask AI control
 * or keyboard shortcut. Its hidden pill remains the imperative opener.
 * V1 keeps its original dialog, hook and endpoint; this component never mounts
 * the new support hook outside the reviewed V2 rollout gate.
 */
export const TraxLauncher = forwardRef<TraxLauncherHandle>(function TraxLauncher(
  _props,
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { tenant } = useTenant();
  const chrome = useV2("chrome");
  const onV2 = usePortalOnV2();

  useImperativeHandle(
    ref,
    () => ({
      open() {
        // `:scope > button` is the pill and only the pill — the overlay's own
        // buttons (send, clear, close) are nested deeper, so a stray match
        // cannot happen even while the conversation is open.
        hostRef.current
          ?.querySelector<HTMLButtonElement>(":scope > button")
          ?.click();
      },
    }),
    [],
  );

  // TWO terms, ANDed, as before: `chrome` says the v2 chrome is what is
  // rendering, and the second says this tenant is on the rollout. Only the
  // second gains the column — a tenant switched over by `portal_experience`
  // is in no slug list, so without `onV2` the AND would refuse it.
  if (!chrome || !(onV2 || isV2('chrome', tenant?.slug))) return null;

  return (
    <div ref={hostRef} className="contents [&>button]:hidden">
      <TraxSupportDialog />
    </div>
  );
});
