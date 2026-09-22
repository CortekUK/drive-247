"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CreditsPanel } from "@/components/billing/credits-panel";
import { useIntegrationBilling } from "@/lib/integration-billing/hooks";

// Thin host page — all behaviour lives in CreditsPanel, which the CANARY also
// renders as a Credits section on /subscription. The other 36 tenants keep this
// page as the only place credits live, and their /subscription is unchanged.
// Either way this stays a real route so existing links to /credits resolve.
//
// Integration billing (northwind): there are no credits any more — e-signing
// is on the plan (docs/integration-billing/build-spec.md, D3) — so an old
// /credits link lands on Billing instead of a wallet it can no longer use.
export default function CreditsPage() {
  const creditsRetired = useIntegrationBilling();
  const router = useRouter();
  useEffect(() => {
    if (creditsRetired) router.replace("/subscription");
  }, [creditsRetired, router]);
  if (creditsRetired) return null;

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold">Credits</h1>
      <CreditsPanel />
    </div>
  );
}
