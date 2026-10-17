import { Manrope } from "next/font/google";

import { PortalV2Gate } from "@nw/portal-v2/shell";

/**
 * Customer portal v2 — northwind.<domain>/portal-v2, built beside the current
 * /portal in the operator portal v2's design language. Reachable whatever the
 * Developer-tab switch says (V2_ONLY_SEGMENTS in src/lib/booking-design.ts),
 * and only for Northwind. Components live in src/northwind-site/portal-v2/.
 */

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export default function PortalV2Layout({ children }: { children: React.ReactNode }) {
  return <PortalV2Gate fontClass={manrope.variable}>{children}</PortalV2Gate>;
}
