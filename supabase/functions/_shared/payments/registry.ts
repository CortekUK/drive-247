/**
 * Square integration — provider registry.
 *
 * Exists for one reason the lead asked for explicitly: "teesri branch banana bhi
 * mushkil kaam nahi hoga" — adding a third processor must be cheap. That claim is
 * only credible if it is mechanically checkable, so the registry is a table and
 * the test suite adds a throwaway third entry to prove the seam does not assume
 * exactly two providers.
 */

import { ProviderId } from "./types.ts";
import { capabilitiesFor, ProviderCapabilities } from "./capabilities.ts";

export interface ProviderDescriptor {
  id: ProviderId;
  /** Operator-facing name. Used in portal UI copy and skip reasons. */
  displayName: string;
  capabilities: ProviderCapabilities;
  /**
   * true for the rail whose code runs unchanged when the seam returns
   * handled:false. Exactly one provider may be native.
   */
  isNativeRail: boolean;
}

export const PROVIDERS: Readonly<Record<ProviderId, ProviderDescriptor>> = Object.freeze({
  stripe: Object.freeze({
    id: "stripe" as const,
    displayName: "Stripe",
    capabilities: capabilitiesFor("stripe"),
    isNativeRail: true,
  }),
  square: Object.freeze({
    id: "square" as const,
    displayName: "Square",
    capabilities: capabilitiesFor("square"),
    isNativeRail: false,
  }),
});

export function describeProvider(id: ProviderId): ProviderDescriptor {
  return PROVIDERS[id] ?? PROVIDERS.stripe;
}

export function allProviderIds(): ProviderId[] {
  return Object.keys(PROVIDERS) as ProviderId[];
}
