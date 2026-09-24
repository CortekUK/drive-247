"use client";

/**
 * The record dock, on its own, at a phone's width.
 *
 * It exists because the dock is otherwise unreviewable. It only renders below
 * 768px, and every screen that carries it — a rental, a customer, a vehicle —
 * is behind the sign-in, so there is no way to look at the thing without an
 * account, a tenant with records in it, and a phone. This page needs none of
 * those: `/playground/*` is pinned to the canary slug in `proxy.ts`, so it
 * wears the real v2 theme, and it renders the real component with fixtures.
 *
 * Same fixture-page convention as `timeline`, `customer-detail-fake` and the
 * others beside it: no live data, nothing writable, no route into it from the
 * app.
 *
 * Narrow the window under 768px (or use a device toolbar) — above that the
 * three record screens show their real columns and the dock is correctly
 * absent, so this page shows it unconditionally instead.
 */

import { ArrowLeft, Car, CreditCard, FileSignature, History, KeyRound, MapPin, MessageSquare, PackagePlus, ReceiptText, ShieldCheck, User } from "lucide-react";
import { RecordDock, RecordDockNav, contextTabPanels } from "@/components/ui-v2/record-dock";

/** The rental screen's stages, near enough to the real `STAGES` to judge by. */
const STAGES = [
  { id: "customer", label: "Customer", icon: User },
  { id: "vehicle", label: "Vehicle", icon: Car },
  { id: "when-where", label: "When & where", icon: MapPin },
  { id: "extras", label: "Extras", icon: PackagePlus },
  { id: "agreement", label: "Agreement", icon: FileSignature },
  { id: "insurance", label: "Insurance", icon: ShieldCheck },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "handover", label: "Handover", icon: KeyRound },
] as const;

function FakeView({ name }: { name: string }) {
  return (
    <div className="space-y-3 pb-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="rounded-xl border border-foreground/10 p-3">
          <p className="text-sm text-foreground">{name} {i + 1}</p>
        </div>
      ))}
    </div>
  );
}

export default function RecordDockPlayground() {
  return (
    <main className="min-h-screen bg-app-gradient px-5 py-8 pb-40">
      <h1 className="font-heading text-lg font-semibold text-foreground">Record dock</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The bar a rental, customer or vehicle wears below 768px. Fixtures only.
      </p>

      {/* Something to float over, so the bar's translucency and shadow can be
          judged against content rather than against an empty page. */}
      <div className="mt-6 space-y-3">
        {Array.from({ length: 14 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-foreground/10 bg-card p-4">
            <p className="text-sm font-medium text-foreground">Row {i + 1}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Scroll this under the dock to check it stays legible through the blur.
            </p>
          </div>
        ))}
      </div>

      <RecordDock
        back={{ href: "/playground/record-dock", label: "All rentals", icon: ArrowLeft }}
        primary={{
          id: "stages",
          label: "Agreement",
          icon: FileSignature,
          description: "Every stage of this rental. You are on Agreement.",
          content: (close) => (
            <RecordDockNav
              groups={[{ items: STAGES }]}
              current="agreement"
              onSelect={() => {}}
              close={close}
            />
          ),
        }}
        /* One icon per context view, which is what the real screens pass:
           a rental's Payment Plan / Messages / Activity, a customer's At a
           glance / Timeline. Each opens its own view — there is no tab strip
           inside the sheet. */
        secondary={contextTabPanels([
          { id: "payment-plan", label: "Payment Plan", icon: ReceiptText, content: <FakeView name="Payment Plan" /> },
          { id: "messages", label: "Messages", icon: MessageSquare, content: <FakeView name="Messages" /> },
          { id: "activity", label: "Activity", icon: History, content: <FakeView name="Activity" /> },
        ])}
      />
    </main>
  );
}
