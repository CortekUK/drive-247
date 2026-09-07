"use client";

import { CreditsPanel } from "@/components/billing/credits-panel";

// Thin host page — all behaviour lives in CreditsPanel, which is also
// embedded as the "Credits" tab on /subscription (see subscription/page.tsx).
// Kept as a real route so existing links to /credits keep resolving.
export default function CreditsPage() {
  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold">Credits</h1>
      <CreditsPanel />
    </div>
  );
}
