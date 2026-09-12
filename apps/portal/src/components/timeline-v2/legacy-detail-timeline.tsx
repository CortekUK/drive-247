"use client";

import type { ReactNode } from "react";
import { ConnectedTimeline } from "./connected-timeline";
import { ContextTabs, ResponsiveContextRail } from "./context-rail";
import { RentalPaymentPlan } from "./rental-plan";

/** Calendar rollout is independent of the tenant's other V2 areas. Keep the
 * existing record page and actions intact, with its timeline in a right tab. */
export function LegacyDetailTimeline({ kind, id, children }: { kind: "rental" | "customer" | "vehicle"; id: string; children: ReactNode }) {
  const label = kind === "rental" ? "Payment Plan" : "Timeline";
  return <div className="tl-legacy-detail flex min-w-0 items-start">
    <div className="min-w-0 flex-1">{children}</div>
    <ResponsiveContextRail label={label} width={360} breakpoint={1440}>
      <ContextTabs label={`${kind} context`} defaultValue="timeline" tabs={[{ id: "timeline", label, keepMounted: true, content: kind === "rental" ? <RentalPaymentPlan rentalId={id} /> : <ConnectedTimeline scope={{ kind, id }} compact /> }]} />
    </ResponsiveContextRail>
  </div>;
}
