"use client";

// ── Integrations board — official logos via logo.dev (Bonzah uses local SVG) ──
//
// The grid and the dialog frame. Everything an integration actually KNOWS or
// DOES lives in its own file under `_panels/`, reached through
// `_panels/registry.ts` — so this file stays the shell it is, and seven panels
// can be built in parallel without landing edits on the same lines (V2_PLAN §2).
//
// ⚠️ The panels DO read and write real state, and RLS is off on the core tables
// (V2_PLAN §5). The route gate stops a non-canary tenant OPENING this screen;
// it does nothing to stop a query inside a panel touching another tenant's row.
// Every query a panel issues must carry `.eq('tenant_id', tenant.id)`, or
// `.eq('id', tenant.id)` against `tenants` itself.
//
// Co-located with the route rather than living under `components/`, because
// `page.tsx` must stay a Server Component to resolve the v2 gate — see the
// comment there.

import { type ComponentType, useEffect, useMemo, useState } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardTitle } from "@/components/ui-v2/card";
import { PanelLoading, StatusChip } from "./_panels/_kit";
import { panelFor } from "./_panels/registry";
import { partitionByPins, useIntegrationPins } from "./integration-pins";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
// The branch drew these two from `@phosphor-icons/react`, which is not a
// dependency of this app. lucide-react — already the icon set everywhere else
// in the portal — carries both, and takes the same `size` / `color` props.
import { Globe, IdCard, Pin } from "lucide-react";

// logo.dev — publishable key (safe for client-side img.logo.dev)
const LOGO_TOKEN = "pk_EmodMTbiSPiHDa2fIPUo3w";
const logoSrc = (domain: string) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=128&format=png`;

type Integration = {
  name: string;
  category: string;
  description: string;
  domain?: string; // logo.dev brand logo
  localLogo?: boolean; // Bonzah — official SVG in /public
  fallbackGlobe?: boolean; // no brand (Branded Domain)
  Icon?: ComponentType<{ size?: number; color?: string }>; // bare glyph (no box)
  iconColor?: string;
};

// Tesla, Xero and Zoho are brand logos via logo.dev rather than
// `react-icons/si` glyphs, as the original drew them. react-icons is not a
// declared dependency of this app — it only resolved by walking up to the
// root node_modules, which would break the moment that tree changed. These
// four already have brand logos on the CDN the page uses for Stripe, Twilio
// and BoldSign, so this removes the implicit dependency without touching
// package.json or the lockfile, and renders the same real brand marks.
//
// ORDER IS THE PRODUCT DECISION, not an accident. `Turo Sync` leads the list so
// it leads the first row — it is the newest thing here and the one an operator
// is least likely to go looking for. Pinned cards still outrank it (see
// `integration-pins.ts`); a shortlist someone built by hand beats a default we
// chose for them, and that is the correct precedence.
const integrations: Integration[] = [
  { name: "Turo Sync", category: "Fleet", description: "Pull your Turo trips in and stop double-booking.", domain: "turo.com" },
  { name: "Stripe Connect", category: "Payments", description: "Accept booking payments, deposits & payouts.", domain: "stripe.com" },
  { name: "Square", category: "Payments", description: "Take booking payments through your Square account.", domain: "squareup.com" },
  { name: "Bonzah", category: "Insurance", description: "Per-rental insurance coverage at checkout.", localLogo: true },
  { name: "Inshur", category: "Insurance", description: "Fleet insurance for your vehicles between rentals.", domain: "inshur.com" },
  { name: "BoldSign", category: "Documents", description: "E-signature for rental agreements.", domain: "boldsign.com" },
  { name: "CheckMyDriver", category: "Verification", description: "Verify driver's licenses & identity.", Icon: IdCard, iconColor: "#0EA5E9" },
  { name: "Twilio Messages", category: "Messaging", description: "SMS notifications, reminders & 2-way chat.", domain: "twilio.com" },
  { name: "Twilio Calling", category: "Calling", description: "Call forwarding, voicemail & recordings.", domain: "twilio.com" },
  { name: "Tesla", category: "Fleet", description: "Supercharging & vehicle data via the Fleet API.", domain: "tesla.com" },
  { name: "Custom Domain", category: "Website", description: "Use your own domain for booking & portal.", fallbackGlobe: true },
  { name: "Xero", category: "Accounting", description: "Sync invoices & payments to Xero.", domain: "xero.com" },
  { name: "Zoho", category: "Accounting", description: "Sync books & CRM with Zoho.", domain: "zoho.com" },
];

function IntegrationLogo({ it, size }: { it: Integration; size: number }) {
  if (it.Icon) return <it.Icon size={size} color={it.iconColor} />;
  if (it.localLogo)
    return (
      <>
        <img src="/bonzah-logo.svg" alt={it.name} className="w-auto dark:hidden" style={{ height: size * 0.62 }} />
        <img src="/bonzah-logo-dark.svg" alt={it.name} className="hidden w-auto dark:block" style={{ height: size * 0.62 }} />
      </>
    );
  if (it.fallbackGlobe) return <Globe size={size} className="text-muted-foreground" />;
  return <img src={logoSrc(it.domain!)} alt={it.name} className="object-contain" style={{ height: size, width: size }} />;
}

/** Every card name, for the pin store to validate what it reads off disk against. */
const CARD_NAMES = integrations.map((i) => i.name);

/** One grid. Shared by the pinned row and the rest, so the two cannot drift. */
const GRID_CLASS = "grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4";

/**
 * One card.
 *
 * Its own component rather than JSX inlined into a `.map()` twice: the board
 * now renders two grids when anything is pinned, and a card moving between
 * them must be the same component in React's eyes or every pin would remount a
 * `StatusChip` and re-run its fetch.
 */
function IntegrationCard({
  it,
  tenant,
  pinned,
  onOpen,
  onTogglePin,
}: {
  it: Integration;
  tenant: unknown;
  pinned: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
}) {
  // Resolved per card rather than once for the grid: each integration answers
  // "am I working?" from its own state, and a card whose integration has no
  // panel yet simply shows no chip rather than a guess.
  const CardStatus = panelFor(it.name)?.StatusChip;

  return (
    <Card
      onClick={onOpen}
      className="group relative flex cursor-pointer flex-col items-center gap-2 border bg-transparent py-6 text-center shadow-none transition-all duration-200 hover:border-primary/30 hover:bg-gradient-to-br hover:from-primary/15 hover:via-primary/5 hover:to-transparent"
    >
      {/* Pin. A real <button> inside a clickable div, so it has to stop the
          click going any further — without `stopPropagation` every pin would
          also open the dialog behind it. The card body is untouched and still
          opens the panel.

          Always rendered rather than revealed on hover: `group-hover` never
          fires on a touch device, and an affordance that only exists for mouse
          users is one an operator on an iPad simply does not have. Faint when
          unpinned so thirteen of them do not read as thirteen controls. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${it.name}` : `Pin ${it.name}`}
        title={pinned ? "Unpin" : "Pin to the top"}
        className={cn(
          "absolute right-3 top-3 z-10 rounded-full p-1.5 transition-colors",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          pinned
            ? "text-primary hover:bg-primary/10"
            : "text-muted-foreground/30 hover:bg-muted hover:text-foreground",
        )}
      >
        <Pin className={cn("size-4", pinned && "fill-current")} />
      </button>

      {/* Big logo */}
      <div className="flex h-20 items-center justify-center px-6">
        <IntegrationLogo it={it} size={72} />
      </div>

      {/* Text */}
      <CardContent className="flex-1 space-y-1 px-6 pt-1">
        {!it.localLogo && <CardTitle className="text-base">{it.name}</CardTitle>}
        <p className="text-sm text-muted-foreground">{it.description}</p>
      </CardContent>

      {/* Live status. The card used to carry a Switch that toggled a
          local boolean and connected nothing — it read as a control
          over a live integration while acting on nothing at all.
          Connecting and disconnecting is a real, mostly irreversible
          operation, so it belongs inside the dialog, behind whatever
          confirmation that particular provider warrants. */}
      <div className="px-6 pb-0.5">
        {CardStatus && tenant ? (
          <CardStatus tenant={tenant as never} />
        ) : (
          <span className="text-xs text-muted-foreground/60">&nbsp;</span>
        )}
      </div>
    </Card>
  );
}

export function IntegrationsBoard() {
  // Every card renders for every tenant, the canary included.
  //
  // CheckMyDriver used to be filtered off the lean board by the `cmd` entry
  // in `lean-areas.ts`. That filter is gone ON PURPOSE, and the
  // reason matters: the CMD and Inshur cards now open a "coming soon" panel
  // that describes the integration and connects nothing. A preview card
  // exposes no feature, so there is nothing for the lean gate to hide here.
  // The gate itself is untouched and still closes the actual feature —
  // `use-cmd-verification` issues no reads for the canary, the dashboard
  // checklist rows stay dropped, and the rental-page dialog stays hidden. See
  // `lean-areas.ts` holds those hook-level gates; this board itself does NOT
  // filter the card away.
  const { tenant } = useTenant();
  const visibleIntegrations = integrations;

  const [selected, setSelected] = useState<Integration | null>(null);
  const entry = selected ? panelFor(selected.name) : undefined;

  // A personal shortlist, per tenant and per user, kept in this browser. See
  // `integration-pins.ts` for why it is not a row in the database.
  //
  // It is NOT gated and it does not need to be: nothing is read, nothing is
  // written, and the worst a failure can do is render the board in its default
  // order — which is what an operator with no pins sees anyway.
  const { pinned, toggle } = useIntegrationPins(CARD_NAMES);
  const { pinned: pinnedCards, rest } = useMemo(
    () => partitionByPins(visibleIntegrations, pinned),
    [visibleIntegrations, pinned],
  );
  const hasPins = pinnedCards.length > 0;

  // Reopen the right card when a provider sends the operator back here.
  //
  // Four panels hand off to an OAuth flow (Stripe, Xero, Zoho, Tesla) and each
  // returns to `/integrations` — with the dialog closed, because the page was
  // reloaded. The chip flipping state was the only confirmation, and an
  // operator who just spent two minutes at Stripe deserves better than a grid.
  // Each panel's own return marker is honoured here, plus a generic
  // `?open=<card name>` for anything that wants to deep-link a panel later.
  //
  // Read from `window.location` in an effect rather than `useSearchParams`:
  // that hook demands a Suspense boundary at build time, and this needs no
  // Next.js coupling to answer a one-shot question on mount. The params are
  // NOT stripped — the Xero chip and the Zoho panel read theirs to show a
  // success/failure note and clean up after themselves.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const wanted =
      q.get("open") ??
      (q.has("stripe") ? "Stripe Connect" : null) ??
      (q.has("xero") ? "Xero" : null) ??
      (q.get("provider") === "zoho" ? "Zoho" : null) ??
      (q.has("tesla_connected") ? "Tesla" : null);
    if (!wanted) return;
    const hit = visibleIntegrations.find((i) => i.name === wanted);
    if (hit) setSelected(hit);
    // Mount-only on purpose: a later filter change must not re-open a dialog
    // the operator already closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-1 pb-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight">Integrations</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Connect the tools that power payments, documents, messaging and more.
        </p>
      </div>

      {/* Grid.

          ONE grid when nothing is pinned — the same single grid, with the same
          classes, that this board has always rendered. No "Pinned" heading, no
          empty section, no extra wrapper: an operator who has never pinned
          anything sees exactly the screen they saw yesterday.

          Two labelled grids the moment anything IS pinned. A marker alone would
          leave a card silently teleported to the front of a list of thirteen;
          the heading says why it moved. Both halves keep the board's own order
          (see `partitionByPins`), so unpinning drops a card straight back where
          it started rather than somewhere new. */}
      {hasPins ? (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium tracking-tight text-muted-foreground">Pinned</h2>
            <div className={GRID_CLASS}>
              {pinnedCards.map((it) => (
                <IntegrationCard
                  key={it.name}
                  it={it}
                  tenant={tenant}
                  pinned
                  onOpen={() => setSelected(it)}
                  onTogglePin={() => toggle(it.name)}
                />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium tracking-tight text-muted-foreground">
              All integrations
            </h2>
            <div className={GRID_CLASS}>
              {rest.map((it) => (
                <IntegrationCard
                  key={it.name}
                  it={it}
                  tenant={tenant}
                  pinned={false}
                  onOpen={() => setSelected(it)}
                  onTogglePin={() => toggle(it.name)}
                />
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className={GRID_CLASS}>
          {rest.map((it) => (
            <IntegrationCard
              key={it.name}
              it={it}
              tenant={tenant}
              pinned={false}
              onOpen={() => setSelected(it)}
              onTogglePin={() => toggle(it.name)}
            />
          ))}
        </div>
      )}

      {/* Integration detail dialog. Each panel manages its own integration —
          its own reads, its own confirmations, its own footer actions — so the
          frame here deliberately carries no Connect/Disconnect button of its
          own. A shared one could only guess at what connecting means for a
          given provider, and for Stripe and the accounting pairs that guess is
          destructive. */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        {/* Wider than the ui-v2 default and padded up: nine panels render
            label/value rows, provider tabs and step lists in here, and at
            `max-w-lg` those wrapped onto two lines and read as cramped. */}
        <DialogContent className="no-scrollbar max-h-[88vh] overflow-y-auto p-8 sm:max-w-4xl">
          {selected && (
            <>
              <DialogHeader>
                <div className="mb-2 flex h-16 items-center">
                  <IntegrationLogo it={selected} size={48} />
                </div>
                <DialogTitle className="flex items-center gap-2">
                  {selected.name}
                  {entry && tenant && <entry.StatusChip tenant={tenant as never} />}
                </DialogTitle>
                <DialogDescription>{selected.description}</DialogDescription>
              </DialogHeader>

              {/* `tenant` is null for a tick on first paint and stays null on an
                  unresolved host. A panel is written assuming a real tenant, so
                  it is not rendered until there is one — never with a fallback
                  id, which is how a query ends up pointed at the wrong row. */}
              {!tenant ? (
                <PanelLoading />
              ) : entry ? (
                <entry.Panel tenant={tenant as never} onClose={() => setSelected(null)} />
              ) : (
                <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                  {selected.category} integration &middot; configuration coming soon.
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
