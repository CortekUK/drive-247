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

import { type ComponentType, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useV2 } from "@/lib/v2-context";
import { usePageSearch } from "@/components/shared/layout/page-search-slot";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardTitle } from "@/components/ui-v2/card";
import {
  CardTag,
  PanelLoading,
  StatusChip,
  StatusChipTagMode,
  StatusReportContext,
  type CardTagKind,
  type IntegrationState,
} from "./_panels/_kit";
import { DialogWidthContext, IntroFlow, ScreenPager, type IntroSpec } from "./_panels/_screens";
import { INTEGRATION_INTROS } from "./_panels/_intros";
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
// Integration billing (northwind only): premium, beta, not-available and hidden
// flags from the super admin's catalog. See premium-integration.tsx.
import {
  useIntegrationBilling,
  useIntegrationCatalog,
  useIntegrationSubscriptions,
} from "@/lib/integration-billing/hooks";
import { freeEntry, isPreviewOnly, keyForBoardName, type CatalogEntry } from "@/lib/integration-billing/catalog";
import { BetaPill, IntegrationDialogBody, AddOnPill } from "./premium-integration";

// logo.dev — publishable key (safe for client-side img.logo.dev)
const LOGO_TOKEN = "pk_EmodMTbiSPiHDa2fIPUo3w";
/**
 * Add-ons that are LIVE on the board though the billing edge function still
 * lists them preview-only (so nothing can actually be bought yet): they wear
 * "Add-on", not "Soon". Turo Sync — Ghulam, Oct 2 2026: "Turo is not soon,
 * Turo is there"; its extension is on the Chrome Web Store.
 */
const LIVE_ADD_ONS: ReadonlySet<string> = new Set(["turo_sync"]);

const logoSrc = (domain: string) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=128&format=png`;

type Integration = {
  name: string;
  category: string;
  description: string;
  domain?: string; // logo.dev brand logo
  localLogo?: boolean; // Bonzah — official SVG in /public
  fallbackGlobe?: boolean; // no brand (Branded Domain)
  Icon?: ComponentType<{ size?: number; color?: string }>; // bare glyph (no box)
  /** Dialog header shows this name in bold instead of the logo (Turo's
   *  logo.dev mark reads as a blank tag at dialog size). */
  wordmark?: string;
  /** Included for every account at no charge — the dialog header says "Free". */
  free?: boolean;
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
  { name: "Turo Sync", category: "Fleet", description: "Pull your Turo trips in and stop double-booking.", domain: "turo.com", wordmark: "Turo" },
  { name: "Stripe Connect", category: "Payments", description: "Accept booking payments, deposits & payouts.", domain: "stripe.com" },
  { name: "Square", category: "Payments", description: "Take booking payments through your Square account.", domain: "squareup.com" },
  { name: "Bonzah", category: "Insurance", description: "Per-rental insurance coverage at checkout.", localLogo: true },
  { name: "Inshur", category: "Insurance", description: "Fleet insurance for your vehicles between rentals.", domain: "inshur.com" },
  { name: "BoldSign", category: "Documents", description: "E-signature for rental agreements.", domain: "boldsign.com", free: true },
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

/**
 * Every integration follows the screen standard (Ghulam, Oct 2 2026 — set by
 * Bonzah, see `_panels/_screens.tsx`): logo top-left, status top-right, no ×,
 * a brand wash, and screens that never scroll. Kept as a set so a dialog can
 * be taken back out of the standard by name if it ever needs to be.
 */
const SCREEN_LED = new Set(integrations.map((i) => i.name));

/** Bonzah runs its own screens (education included) — it predates the shared ones. */
const OWNS_ITS_SCREENS = new Set(["Bonzah"]);

/** The page wash, sized for a dialog — gives screen-led dialogs a soft gradient. */
const SCREEN_LED_WASH = [
  "radial-gradient(40rem 26rem at 105% -10%, hsl(var(--v2-wash) / 0.30), transparent 62%)",
  "radial-gradient(34rem 24rem at -8% -6%, hsl(var(--chart-3) / 0.24), transparent 58%)",
  "radial-gradient(36rem 22rem at 50% 118%, hsl(var(--v2-wash) / 0.20), transparent 62%)",
  "linear-gradient(180deg, hsl(var(--v2-wash) / 0.08) 0%, transparent 45%)",
].join(", ");

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
  billing,
  subscribed,
}: {
  it: Integration;
  tenant: unknown;
  pinned: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
  /** The catalog's word on this card — integration-billing tenant only. */
  billing?: CatalogEntry;
  /** Someone at this tenant is already paying for it. */
  subscribed?: boolean;
}) {
  // Resolved per card rather than once for the grid: each integration answers
  // "am I working?" from its own state, and a card whose integration has no
  // panel yet simply shows no chip rather than a guess.
  const CardStatus = panelFor(it.name)?.StatusChip;

  // The card's ONE top-left tag. The first three are known from the catalog
  // alone; only when none applies does the integration's own status decide,
  // and then it can only say LIVE, or "!" with the warning on hover.
  const key = keyForBoardName(it.name);
  const fixedTag: CardTagKind | null = billing?.isUnavailable
    ? "unavailable"
    : key && isPreviewOnly(key) && !LIVE_ADD_ONS.has(key)
      ? "soon"
      : billing?.isPremium && !subscribed
        ? "addon"
        : null;

  return (
    <Card
      onClick={onOpen}
      className={cn(
        "group relative isolate flex cursor-pointer flex-col items-center gap-2 border bg-transparent py-6 text-center shadow-none transition-colors duration-200 ease-in hover:border-primary/30 hover:ease-out motion-reduce:transition-none",
        // Not available: dimmed slightly, still readable and still opens.
        billing?.isUnavailable && "opacity-60",
      )}
    >
      {/* Hover wash. A gradient cannot be transitioned — `background-image`
          snaps — so it sits on its own layer and fades in on opacity instead.
          `-z-10` inside the card's `isolate` keeps it above the card's
          background and beneath every piece of content. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] bg-gradient-to-br from-primary/15 via-primary/5 to-transparent opacity-0 transition-opacity duration-200 ease-in group-hover:opacity-100 group-hover:ease-out motion-reduce:transition-none"
      />
      {/* The tag slot, top-left: one tag at most (LIVE / SOON / ADD-ON /
          UNAVAILABLE), plus a "!" when the integration needs attention.
          Centred on the pin (a 28px button at top-3; the tag is 24px, so top-3.5) so the two corners read
          as one row. This replaced the status chip that sat under the text. */}
      <div className="absolute left-4 top-3.5 z-10 flex items-center gap-1.5">
        {fixedTag ? (
          <CardTag kind={fixedTag} />
        ) : CardStatus && tenant ? (
          <StatusChipTagMode>
            <CardStatus tenant={tenant as never} />
          </StatusChipTagMode>
        ) : null}
      </div>
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
            ? "text-primary hover:bg-primary/10 dark:text-[hsl(var(--v2-link,var(--primary)))] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]"
            : "text-muted-foreground/30 hover:bg-primary/10 hover:text-primary dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] dark:hover:text-[hsl(var(--v2-link,var(--primary)))]",
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
        {!it.localLogo && (
          <CardTitle className="flex items-center justify-center gap-1.5 text-base">
            {it.name}
            {billing?.isBeta && <BetaPill />}
          </CardTitle>
        )}
        {it.localLogo && billing?.isBeta && (
          <div className="flex justify-center text-base">
            <BetaPill />
          </div>
        )}
        <p className="text-sm text-muted-foreground">{it.description}</p>
      </CardContent>

    </Card>
  );
}

/**
 * The body of every dialog that follows the screen standard: the education
 * screens while an integration is not active yet, then its own panel paged
 * into screens that never scroll. An active integration skips straight to the
 * panel; Back from its first screen returns to the education only when the
 * operator came through it.
 */
function ScreenLedBody({
  intro,
  state,
  onClose,
  ownsScreens,
  renderPanel,
}: {
  intro?: IntroSpec;
  state: IntegrationState | null;
  onClose: () => void;
  /** The panel draws its own screens and nav — do not page it. */
  ownsScreens?: boolean;
  /** The panel, given its way back to the education (when there was one). */
  renderPanel: (onBack?: () => void) => ReactNode;
}) {
  const [started, setStarted] = useState(false);
  if (state === null || state === "loading") return <PanelLoading />;
  const active = state === "connected" || state === "attention";
  if (intro && !active && !started) {
    return <IntroFlow spec={intro} onStart={() => (intro.preview ? onClose() : setStarted(true))} />;
  }
  const back = intro && !active ? () => setStarted(false) : undefined;
  return (
    <div className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
      {ownsScreens ? renderPanel(back) : <ScreenPager onBackFromStart={back}>{renderPanel()}</ScreenPager>}
    </div>
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

  // Integration billing — northwind only. Every other tenant: `billingOn` is
  // false, no catalog is read, and the board is exactly the one it always was.
  const billingOn = useIntegrationBilling();
  const { catalog, isLoading: catalogLoading } = useIntegrationCatalog();
  const { byKey: subscriptionsByKey, everBilled, isLoading: subscriptionsLoading } = useIntegrationSubscriptions();
  // Until both are known a deep link waits, so it can never open a card the
  // catalog hides. (The grid itself paints at once, as it always has.)
  const billingPending = billingOn && (catalogLoading || subscriptionsLoading);
  const billingFor = (it: Integration): CatalogEntry | undefined => {
    // Not until the saved catalog has arrived, so a default never flashes a
    // crown on a card a super admin has made free.
    if (!billingOn || catalogLoading) return undefined;
    const key = keyForBoardName(it.name);
    if (!key) return undefined;
    const entry = catalog[key] ?? freeEntry(key);
    // Someone paying for it keeps seeing what they pay for — premium, at the
    // price they subscribed at, and never hidden — even if the catalog has
    // changed since. Stripe keeps billing until a super admin cancels it.
    const row = subscriptionsByKey[key];
    return row
      ? {
          ...entry,
          isPremium: true,
          monthlyPriceCents: row.monthly_price_cents,
          currency: row.currency,
          isHidden: false,
          // "Not available" stops new subscribers, not someone already paying.
          isUnavailable: false,
        }
      : entry;
  };
  const visibleIntegrations = useMemo(
    () => (billingOn ? integrations.filter((it) => !billingFor(it)?.isHidden) : integrations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [billingOn, catalog, subscriptionsByKey],
  );

  const [selected, setSelected] = useState<Integration | null>(null);
  // The open integration's state, as its header chip reports it. Decides
  // whether the dialog opens on the education screens or the working ones.
  const [chipState, setChipState] = useState<IntegrationState | null>(null);
  useEffect(() => setChipState(null), [selected]);
  // Narrow while an education screen is showing; wide for everything else.
  const [narrow, setNarrow] = useState(false);
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

  /* v2: search the board from the top bar (page-search-slot.tsx) — name,
     category or description, so "insurance" finds Bonzah and Inshur. The
     filter runs over each half of the pin split, so a match keeps its place. */
  const v2Chrome = useV2("chrome");
  const [boardQuery, setBoardQuery] = useState("");
  const needle = v2Chrome ? boardQuery.trim().toLowerCase() : "";
  const matchesQuery = (it: Integration) =>
    !needle ||
    it.name.toLowerCase().includes(needle) ||
    it.category.toLowerCase().includes(needle) ||
    it.description.toLowerCase().includes(needle);
  const shownPinned = needle ? pinnedCards.filter(matchesQuery) : pinnedCards;
  const shownRest = needle ? rest.filter(matchesQuery) : rest;
  const noMatch = !!needle && shownPinned.length === 0 && shownRest.length === 0;
  usePageSearch(
    v2Chrome
      ? {
          placeholder: "Search integrations…",
          value: boardQuery,
          onChange: setBoardQuery,
          scopeLabel: "Integrations",
          resultCount: shownPinned.length + shownRest.length,
        }
      : null,
  );

  const hasPins = shownPinned.length > 0;

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
  // Once, and — on integration billing — only after the catalog is known, so a
  // deep link can never open a card the catalog hides.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (billingPending || deepLinked.current) return;
    deepLinked.current = true;
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
    // Once on purpose: a later filter change must not re-open a dialog the
    // operator already closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingPending]);

  return (
    /* Switch row alignment: at md+ the h1 (text-3xl leading-tight, a 37.5px
       line box) is centred on the sidebar's Portal / Website switch at y=92.
       main's content box starts at 50px there: 50 + 23.25 + 18.75 = 92. It sat
       at 50, under the 64px top bar. Below md there is still no top padding. */
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-1 pb-6 md:pt-[23.25px]">
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
      {noMatch ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No integration matches &ldquo;{boardQuery.trim()}&rdquo;.
        </p>
      ) : hasPins ? (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium tracking-tight text-muted-foreground">Pinned</h2>
            <div className={GRID_CLASS}>
              {shownPinned.map((it) => (
                <IntegrationCard
                  key={it.name}
                  it={it}
                  tenant={tenant}
                  pinned
                  onOpen={() => setSelected(it)}
                  onTogglePin={() => toggle(it.name)}
                  billing={billingFor(it)}
                  subscribed={!!subscriptionsByKey[keyForBoardName(it.name) ?? ""]}
                />
              ))}
            </div>
          </section>

          {/* A search can leave only pinned matches: no empty "All" heading then. */}
          {shownRest.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium tracking-tight text-muted-foreground">
              All integrations
            </h2>
            <div className={GRID_CLASS}>
              {shownRest.map((it) => (
                <IntegrationCard
                  key={it.name}
                  it={it}
                  tenant={tenant}
                  pinned={false}
                  onOpen={() => setSelected(it)}
                  onTogglePin={() => toggle(it.name)}
                  billing={billingFor(it)}
                  subscribed={!!subscriptionsByKey[keyForBoardName(it.name) ?? ""]}
                />
              ))}
            </div>
          </section>
          )}
        </>
      ) : (
        <div className={GRID_CLASS}>
          {shownRest.map((it) => (
            <IntegrationCard
              key={it.name}
              it={it}
              tenant={tenant}
              pinned={false}
              onOpen={() => setSelected(it)}
              onTogglePin={() => toggle(it.name)}
              billing={billingFor(it)}
              subscribed={!!subscriptionsByKey[keyForBoardName(it.name) ?? ""]}
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
            `max-w-lg` those wrapped onto two lines and read as cramped.

            NEVER A HORIZONTAL SCROLL, in any panel (Ghulam, Oct 1 2026).
            `overflow-y-auto` alone makes the x-axis `auto` too (CSS promotes a
            visible axis once the other one clips), so a single child a few px
            too wide — a long URL, a rail, a wide button row — let the whole
            dialog slide sideways. `overflow-x-hidden` closes that axis, and
            `[&>*]:min-w-0` stops the dialog's grid tracks from growing to fit
            an unbreakable child, so content wraps instead of being clipped. */}
        <DialogContent
          // Screen-led panels drop the corner ×: the status chip owns that
          // corner, and Esc or a click outside still closes the dialog.
          showCloseButton={!(selected && SCREEN_LED.has(selected.name))}
          // The app's own page wash (styles/v2-theme.css → .bg-app-gradient),
          // scaled to the dialog: brand-derived layers only, so it follows
          // the tenant's colour and its dark mode. Not a new style.
          style={selected && SCREEN_LED.has(selected.name) ? { backgroundImage: SCREEN_LED_WASH } : undefined}
          className={cn(
            "no-scrollbar max-h-[88vh] overflow-y-auto overflow-x-hidden p-8 sm:max-w-4xl [&>*]:min-w-0",
            // Screen-led panels page instead of scrolling, so they get the
            // room: taller and wider, enough for a real section of a form.
            selected && SCREEN_LED.has(selected.name) && "max-h-[94vh] p-6 sm:max-w-5xl",
            // Education screens: a narrow, near-square dialog (see
            // DialogWidthContext in _panels/_screens.tsx).
            selected && SCREEN_LED.has(selected.name) && narrow && "sm:max-w-[860px]",
          )}>
          <DialogWidthContext.Provider value={setNarrow}>
          {selected && (() => {
            const dialogBadges = (
              <>
                {billingFor(selected)?.isPremium && (
                  // Sky, not amber: amber beside a status chip reads as a
                  // warning (see AddOnPill), and indigo is Beta's.
                  <AddOnPill className="border-sky-300/70 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300" />
                )}
                {selected.free && !billingFor(selected)?.isPremium && (
                  // Neutral outline: it says what it costs, not how it is doing
                  // — the status pill beside it owns green.
                  <span className="border border-border bg-background/60 text-foreground/75">Free</span>
                )}
                {billingFor(selected)?.isBeta && (
                  <BetaPill className="border border-primary/30 bg-primary/10" />
                )}
                {billingFor(selected)?.isUnavailable ? (
                  <StatusChip state="disconnected" label="Not available" />
                ) : (
                  entry && tenant && (
                    <StatusReportContext.Provider value={setChipState}>
                      <entry.StatusChip tenant={tenant as never} />
                    </StatusReportContext.Provider>
                  )
                )}
              </>
            );
            return (
            <>
              <DialogHeader>
                {/* Screen-led panels (one idea per screen, see bonzah.tsx) say
                    what they are in their own headline, so the name and
                    tagline stay for screen readers only and the status chip
                    moves up beside the logo. */}
                <div className={cn("mb-2 flex h-16 items-center gap-3", SCREEN_LED.has(selected.name) && "-mt-2 mb-0 h-12")}>
                  {selected.wordmark ? (
                    <span className="text-2xl font-bold tracking-tight text-foreground">{selected.wordmark}</span>
                  ) : (
                    <IntegrationLogo it={selected} size={48} />
                  )}
                  {/* Pushed to the far end of the row. */}
                  {SCREEN_LED.has(selected.name) && (
                    // Three matching pills (Ghulam, Oct 2): Add-on, Beta and the
                    // status share one height, padding, size and casing here.
                    // The card keeps its own marks; only the dialog is evened.
                    <div className="ml-auto flex items-center gap-2 [&>*]:inline-flex [&>*]:h-6 [&>*]:min-w-[4.5rem] [&>*]:items-center [&>*]:justify-center [&>*]:rounded-full [&>*]:px-2.5 [&>*]:text-[11px] [&>*]:font-medium [&>*]:normal-case [&>*]:leading-none [&>*]:tracking-normal">
                      {dialogBadges}
                    </div>
                  )}
                </div>
                <DialogTitle className={cn("flex items-center gap-2", SCREEN_LED.has(selected.name) && "sr-only")}>
                  {selected.name}
                  {!SCREEN_LED.has(selected.name) && dialogBadges}
                </DialogTitle>
                <DialogDescription className={cn(SCREEN_LED.has(selected.name) && "sr-only")}>
                  {selected.description}
                </DialogDescription>
              </DialogHeader>

              {/* `tenant` is null for a tick on first paint and stays null on an
                  unresolved host. A panel is written assuming a real tenant, so
                  it is not rendered until there is one — never with a fallback
                  id, which is how a query ends up pointed at the wrong row. */}
              {!tenant ? (
                <PanelLoading />
              ) : (
                (() => {
                  const billing = billingFor(selected);
                  const key = keyForBoardName(selected.name);
                  // The add-on gate (premium banner, read-only until
                  // subscribed) wraps the integration's OWN panel only — never
                  // the education screens or their Back / Next, which a
                  // disabled fieldset would otherwise switch off too.
                  const gated = !!billing && !!key && (billing.isPremium || billing.isUnavailable);
                  const renderPanel = (onBack?: () => void) => {
                    const rawPanel = entry ? (
                      <entry.Panel
                        tenant={tenant as never}
                        onClose={() => setSelected(null)}
                        onBack={onBack}
                        fromIntro={!!onBack}
                      />
                    ) : (
                      <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                        {selected.category} integration &middot; configuration coming soon.
                      </div>
                    );
                    // A panel that runs its own screens (Turo Sync's setup steps)
                    // is not wrapped: the read-only fieldset would switch off its
                    // Back / Next. Its add-on and Beta pills still show above.
                    return gated && !entry?.ownsScreens ? (
                      <IntegrationDialogBody
                        name={selected.name}
                        integrationKey={key!}
                        entry={billing!}
                        subscription={subscriptionsByKey[key!]}
                        everBilled={everBilled.has(key!)}
                      >
                        {rawPanel}
                      </IntegrationDialogBody>
                    ) : (
                      rawPanel
                    );
                  };
                  if (!entry || OWNS_ITS_SCREENS.has(selected.name)) return renderPanel();
                  return (
                    <ScreenLedBody
                      key={selected.name}
                      intro={INTEGRATION_INTROS[selected.name]}
                      state={billing?.isUnavailable ? "disconnected" : chipState}
                      onClose={() => setSelected(null)}
                      ownsScreens={entry.ownsScreens}
                      renderPanel={renderPanel}
                    />
                  );
                })()
              )}
            </>
            );
          })()}
          </DialogWidthContext.Provider>
        </DialogContent>
      </Dialog>
    </div>
  );
}
