"use client";

import { CreditsPanel } from "@/components/billing/credits-panel";

// Thin host page — all behaviour lives in CreditsPanel, which the CANARY also
// renders as a Credits section on /subscription. The other 36 tenants keep this
// page as the only place credits live, and their /subscription is unchanged.
// Either way this stays a real route so existing links to /credits resolve.
export default function CreditsPage() {
  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold">Credits</h1>
      <CreditsPanel />
    </div>
  );
}
