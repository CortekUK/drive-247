"use client";

// ── Turo Sync — getting started ───────────────────────────────────────────────
//
// Turo Sync is LIVE (Ghulam, Oct 2 2026 — "the turo is not soon"). The feature
// itself — the `/turo-bridge` page, its four `turo-bridge-*` edge functions and
// the `turo_bridge_*` tables — was grafted onto `main` on 2026-09-12 and is
// gated to the canary (`V2_AREAS.turo`). This panel used to be a preview that
// said "nothing to install"; it is now the operator's way IN: the dialog's
// education screens explain it, then these four screens walk them through
// getting their first trips across, and hand off to the Turo Sync page.
//
// THE STEPS ARE THE PAGE'S OWN. They mirror the empty state on
// `app/(dashboard)/turo-bridge/page.tsx` in substance — sign in to Turo, add
// the "Drive247 Turo Bridge" extension (now on the Chrome Web Store, Oct 2
// 2026), paste a pairing code, run a sync. If that flow changes, change both.
//
// AN ADD-ON (Ghulam, Oct 2 2026: "we are using the word add-on instead of
// premium"). Where integration billing is on (northwind), the education is
// followed by what it costs — $10 a month on the Drive247 bill — a confirm
// step, and "it's yours", THEN the setup steps. Played on screen only: the
// billing edge function still refuses `turo_sync` (it is in its
// PREVIEW_ONLY_KEYS), so nothing can be charged from here, and the demo never
// calls it. Every other tenant has billing off and goes straight to setup.
//
// STILL READS NOTHING AND WRITES NOTHING. Every action here is a link — to
// turo.com, or to the Turo Sync page — so the panel can never touch
// `turo_bridge_*` itself. The chip reads only `tenants.turo_bridge_enabled`,
// which TenantContext already carries (the same column the page's route gate
// reads).
//
// NAME SPLIT, DELIBERATE. Operators read "Turo Sync"; Chrome shows the
// extension as "Drive247 Turo Bridge"; everything internal stays
// `turo_bridge_*`. Saying the Chrome name once, where they install it, is what
// stops "I can't find Turo Sync in my extensions".

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ExternalLink, Loader2 } from "lucide-react";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useIntegrationBilling, useIntegrationSubscriptions } from "@/lib/integration-billing/hooks";
import { formatBillDate } from "@/lib/integration-billing/catalog";
import { nextBillAt } from "@/lib/integration-billing/plan";
import { InvoicesEmptyArt } from "@/components/illustrations-v2/scenes/invoices";
import { PaymentsEmptyArt } from "@/components/illustrations-v2/scenes/payments";

import { Button } from "@/components/ui-v2/button";
import { BlockedDatesEmptyArt } from "@/components/illustrations-v2/scenes/blocked-dates";
import { DocumentsEmptyArt } from "@/components/illustrations-v2/scenes/documents";
import { UsersEmptyArt } from "@/components/illustrations-v2/scenes/users";
import { PendingBookingsEmptyArt } from "@/components/illustrations-v2/scenes/pending-bookings";

import type { IntegrationPanelProps, PanelTenant } from "./_kit";
import { PanelCard, PanelRow, StatusChip } from "./_kit";
import { Hero, QuietNav, ScreenNav, SubScreen } from "./_screens";
import { useV2 } from "@/lib/v2-context";
import { describeSyncFreshness, useTuroStagedReservations } from "@/hooks/use-turo-bridge";
import { formatDistanceToNow } from "date-fns";

/** The published extension (Chrome Web Store, Oct 2 2026). */
const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/drive247-turo-bridge-poc/fookpplgkejjomgledninkhedjpajkci";

/** The add-on's price, as Ghulam set it for the walk-through (Oct 2 2026). */
const ADD_ON_PRICE = "$10";

/** The demo's "subscribed" — in the browser only, until the page reloads. */
const addOnDemo = (() => {
  let on = false;
  const ls = new Set<() => void>();
  return {
    get: () => on,
    set: (v: boolean) => {
      on = v;
      ls.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      ls.add(l);
      return () => ls.delete(l);
    },
  };
})();

const cardName = (brand: string | null | undefined) =>
  brand ? brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase() : "Card";

/**
 * On when the tenant's own Turo Sync switch is on — the operator has it in
 * use. Off reads "Not set up" (not "Soon": it is available now).
 */
export function TuroSyncStatus({ tenant }: { tenant: PanelTenant }) {
  // Where the add-on is being shown (integration billing — northwind), the
  // chip follows the add-on: "Not set up" until it is added, so the dialog
  // opens on the education, then the add-on, then setup. northwind's own
  // switch happens to be on, which would otherwise skip all three.
  const billingOn = useIntegrationBilling();
  const demoHeld = useSyncExternalStore(addOnDemo.subscribe, addOnDemo.get, addOnDemo.get);
  const on = billingOn ? demoHeld : tenant.turo_bridge_enabled === true;
  return on ? <StatusChip state="connected" label="On" /> : <StatusChip state="disconnected" label="Not set up" />;
}

export default function TuroSyncPanel({ tenant, onClose, onBack }: IntegrationPanelProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  // The Turo Sync page is canary-only (V2_AREAS.turo); a link to it is only
  // offered where it will actually open.
  const onCanary = useV2("turo");

  // The add-on step: only where integration billing is on, and only until
  // the add-on is held (for real, or in the demo).
  const billingOn = useIntegrationBilling();
  const { byKey } = useIntegrationSubscriptions();
  const demoHeld = useSyncExternalStore(addOnDemo.subscribe, addOnDemo.get, addOnDemo.get);
  const held = demoHeld || !!byKey["turo_sync"];
  const [addOnScreen, setAddOnScreen] = useState<"pitch" | "confirm" | "done">(held ? "done" : "pitch");
  const [setupStarted, setSetupStarted] = useState(held || !billingOn);
  const { subscription: plan } = useTenantSubscription();
  const [adding, setAdding] = useState(false);

  // CONNECTED: the dialog opens on a home screen whose one button goes to the
  // synced trips (Ghulam, Oct 2 2026: "when it's connected we should have
  // that link here, every time we need to see the sync"). The setup steps
  // stay one quiet link away, for a second browser or a re-pair.
  const on = billingOn ? held : tenant.turo_bridge_enabled === true;
  const [home, setHome] = useState(on);

  const openTuroSync = () => {
    onClose();
    router.push("/turo-bridge");
  };

  if (on && home && onCanary) {
    return (
      <TuroHome
        onOpen={openTuroSync}
        onSetup={() => {
          setHome(false);
          setSetupStarted(true);
          setStep(0);
        }}
        onBack={onBack}
      />
    );
  }

  if (billingOn && !setupStarted) {
    if (addOnScreen === "confirm") {
      const card = plan?.card_last4 ? `${cardName(plan.card_brand)} •••• ${plan.card_last4}` : "The card on your Drive247 plan";
      const nextBill = formatBillDate(nextBillAt(plan));
      return (
        <SubScreen title="Add Turo Sync" onBack={() => setAddOnScreen("pitch")}>
          <PanelCard className="divide-y divide-border/60">
            <PanelRow label="Turo Sync add-on">{ADD_ON_PRICE}/month</PanelRow>
            <PanelRow label="Your next bill">{nextBill ?? "Your next billing date"}</PanelRow>
            <PanelRow label="Paid with">{card}</PanelRow>
          </PanelCard>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Nothing is charged today. {ADD_ON_PRICE} is added to your next bill{nextBill ? ` on ${nextBill}` : ""}, and to
            every bill after that. Stop it any time.
          </p>
          <div className="flex justify-center">
            <Button
              className="h-10 rounded-2xl px-6"
              disabled={adding}
              onClick={() => {
                setAdding(true);
                window.setTimeout(() => {
                  addOnDemo.set(true);
                  setAdding(false);
                  setAddOnScreen("done");
                }, 1400);
              }}
            >
              {adding ? <Loader2 className="animate-spin" /> : null}
              {adding ? "Adding Turo Sync…" : `Add for ${ADD_ON_PRICE}/month`}
            </Button>
          </div>
        </SubScreen>
      );
    }
    if (addOnScreen === "done") {
      return (
        <div className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
          <Hero
            art={PaymentsEmptyArt}
            eyebrow="Add-on"
            title="Turo Sync is yours."
            actions={
              <div className="flex justify-center">
                <Button className="h-10 rounded-2xl px-6" onClick={() => setSetupStarted(true)}>
                  Set it up
                  <ArrowRight className="ml-1.5 size-4" />
                </Button>
              </div>
            }
          >
            {ADD_ON_PRICE} a month starts on your next bill. Now let&rsquo;s get your Turo trips across — four quick
            steps.
          </Hero>
          <ScreenNav className="mt-8" onBack={onBack} />
        </div>
      );
    }
    return (
      <div className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
        <Hero
          art={InvoicesEmptyArt}
          eyebrow="Add-on"
          title={`Turo Sync is ${ADD_ON_PRICE} a month.`}
          actions={
            <div className="flex justify-center">
              <Button className="h-10 rounded-2xl px-6" onClick={() => setAddOnScreen("confirm")}>
                Add Turo Sync
                <ArrowRight className="ml-1.5 size-4" />
              </Button>
            </div>
          }
        >
          It&rsquo;s added to your Drive247 bill as its own line — nothing is charged today, and you can stop it
          whenever you like.
        </Hero>
        <ScreenNav className="mt-6" onBack={onBack} />
      </div>
    );
  }

  const STEPS = [
    {
      art: BlockedDatesEmptyArt,
      title: "Sign in to Turo as a host.",
      body: "Open turo.com in this browser and sign in to your host account. The extension reads your trips from there, so keep it signed in.",
      action: (
        <Button variant="outline" className="h-10 rounded-2xl px-5" asChild>
          <a href="https://turo.com" target="_blank" rel="noopener noreferrer">
            Open turo.com
            <ExternalLink className="ml-1.5 size-4" />
          </a>
        </Button>
      ),
    },
    {
      art: DocumentsEmptyArt,
      title: "Add the Turo Bridge extension.",
      body: "It's on the Chrome Web Store as Drive247 Turo Bridge. Add it to Chrome, then pin it so it's one click away.",
      action: (
        <Button variant="outline" className="h-10 rounded-2xl px-5" asChild>
          <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer">
            Add to Chrome
            <ExternalLink className="ml-1.5 size-4" />
          </a>
        </Button>
      ),
    },
    {
      art: UsersEmptyArt,
      title: "Pair it with your account.",
      body: "Open the extension and paste the pairing code your Drive247 admin creates for you. That's all it needs — no Turo password, and no account details typed anywhere.",
    },
    {
      art: PendingBookingsEmptyArt,
      title: "Run your first sync.",
      body: "Click Sync in the extension. Your Turo trips land in Turo Sync within a few seconds — match each Turo car to one of yours, then import the trips you want as bookings.",
      action: (
        <Button className="h-10 rounded-2xl px-6" onClick={openTuroSync}>
          Open Turo Sync
          <ArrowRight className="ml-1.5 size-4" />
        </Button>
      ),
    },
  ] as const;

  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div
      key={step}
      className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none"
    >
      <Hero
        art={s.art}
        eyebrow={`Step ${step + 1} of ${STEPS.length}`}
        title={s.title}
        actions={"action" in s && s.action ? <div className="flex justify-center">{s.action}</div> : undefined}
      >
        {s.body}
      </Hero>
      <ScreenNav
        className="mt-8"
        onBack={
          step > 0
            ? () => setStep(step - 1)
            : on && onCanary
              ? () => setHome(true)
              : billingOn
                ? () => setSetupStarted(false)
                : onBack
        }
        onNext={!last ? () => setStep(step + 1) : undefined}
      />
    </div>
  );
}

/**
 * The connected home: what has come across from Turo, and the one way to it.
 * Reads the same RLS-scoped, tenant-filtered query the Turo Sync page uses.
 */
function TuroHome({ onOpen, onSetup, onBack }: { onOpen: () => void; onSetup: () => void; onBack?: () => void }) {
  const reservations = useTuroStagedReservations();
  const rows = reservations.allRows;
  const ready = reservations.counts.byState.staged ?? 0;
  const needCar = reservations.counts.byState.pending_match ?? 0;
  const freshness = describeSyncFreshness(rows);
  const synced = freshness.lastSyncedAt
    ? `Last synced ${formatDistanceToNow(new Date(freshness.lastSyncedAt), { addSuffix: true })}.`
    : "Nothing has synced yet — run a sync from the extension.";
  return (
    <div className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
      <Hero
        art={PendingBookingsEmptyArt}
        eyebrow="Live"
        title={rows.length ? `${rows.length} Turo trip${rows.length === 1 ? "" : "s"} in Drive247.` : "Turo Sync is on."}
        actions={
          <div className="flex justify-center">
            <Button className="h-10 rounded-2xl px-6" onClick={onOpen}>
              Open Turo Sync
              <ArrowRight className="ml-1.5 size-4" />
            </Button>
          </div>
        }
        footer={
          <QuietNav
            items={[
              { label: "Set up the extension", onClick: onSetup },
              { label: "Chrome Web Store", onClick: () => window.open(CHROME_STORE_URL, "_blank", "noopener,noreferrer") },
            ]}
          />
        }
      >
        {synced}
        {rows.length > 0 && (
          <>
            {" "}
            {ready} ready to import{needCar ? `, ${needCar} waiting on a car match` : ""}.
          </>
        )}
      </Hero>
      <ScreenNav className="mt-5" onBack={onBack} />
    </div>
  );
}
