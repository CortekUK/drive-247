"use client";

// ── Square panel ─────────────────────────────────────────────────────────────
//
// The sibling of `stripe-connect.tsx`, one card to its right. The two are one
// product: same register, same section order, same refusal to dress a broken
// integration up as a working one.
//
// THREE RAILS, and the panel is honest about all of them:
//
//   payment_provider = 'stripe', unlocked   Square is AVAILABLE. Choosing it is
//                                           a one-time rail decision, so the
//                                           panel says what locks, what it
//                                           means for Stripe, and confirms
//                                           before writing (`ChooseSquare`).
//   payment_provider = 'stripe', locked     Square is not available. Said
//                                           plainly, with a pointer to support.
//   payment_provider = 'square'             The connect / manage flow.
//
// The Stripe panel deliberately does not own the choice; this one does, and it
// writes it the way v1's `payment-provider-choice.tsx` does, column for
// column — see `useChooseSquare` in `square-data.ts`.
//
// TWO BACKGROUND JOBS ARE NOT RUNNING, and the panel is written around that
// rather than pretending otherwise: `refresh-square-tokens` (the 30-day expiry
// defence) stopped on 3 Sep 2026 and `recover-pending-square-payments` was
// never scheduled. So token validity is computed from `token_expires_at`
// against the clock, the healthy state never says "renews automatically", and
// no button here calls a function that only helps when a worker runs. See the
// note above `deriveSquareVerdict`.
//
// LEAN MODE. `isTestModeUiHidden` is true for the canary: no mode row, no TEST
// badge, and `set-square-mode` is never called from here. Presentation only —
// the connect and disconnect calls send the tenant's OWN `square_mode`,
// because hiding a concept must not change what the money does.
//
// ⚠️ Every query lives in `square-data.ts` and every one carries the tenant
// filter. See the isolation note at the top of that file.

import { type ReactNode, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Link2,
  Loader2,
  Lock,
  RefreshCw,
} from "lucide-react";

import { useAuth } from "@/stores/auth-store";
import { useIsTestModeUiHidden } from "@/lib/lean-context";
import { Button } from "@/components/ui-v2/button";
import { Checkbox } from "@/components/ui-v2/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui-v2/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-v2/alert-dialog";

import type { IntegrationPanelProps, PanelTenant } from "./_kit";
import {
  CopyValue,
  PanelCard,
  PanelError,
  PanelLoading,
  PanelNote,
  PanelRow,
  PanelSection,
  StatusChip,
} from "./_kit";
import {
  deriveSquareVerdict,
  isSquareCountrySupported,
  SQUARE_COUNTRIES,
  SQUARE_LIMITS,
  SQUARE_TOKEN_LIFETIME_DAYS,
  useChooseSquare,
  useConnectSquare,
  useDisconnectSquare,
  useSquareOAuthReturn,
  useSquarePaymentsCount,
  useSquareStatus,
  type SquareConnectionRow,
  type SquareMode,
  type SquareSnapshot,
  type SquareVerdict,
} from "./square-data";
import { ConnectionTest, DisconnectScreen, Hero, QuietNav, ScreenNav, ScreenPager, SubScreen, demoCheck } from "./_screens";
import { PaymentsEmptyArt } from "@/components/illustrations-v2/scenes/payments";
import { OwnerPayoutsEmptyArt } from "@/components/illustrations-v2/scenes/owner-payouts";
import { QuotesEmptyArt } from "@/components/illustrations-v2/scenes/quotes";

/* ─────────────────────────────── helpers ────────────────────────────────── */

const fmtDate = (iso: string | null | undefined) =>
  iso && !Number.isNaN(new Date(iso).getTime()) ? format(new Date(iso), "d MMM yyyy") : "—";

const fmtAgo = (iso: string | null | undefined) =>
  iso && !Number.isNaN(new Date(iso).getTime())
    ? formatDistanceToNow(new Date(iso), { addSuffix: true })
    : "—";

/** "Valid until 4 Oct 2026 (29 days)" / "Expired 2 days ago" — the tense carries the fault. */
function tokenPhrase(expiresAt: string | null, days: number | null): string {
  if (!expiresAt || days === null) return "No expiry recorded";
  if (days < 0) return `Expired ${fmtAgo(expiresAt)}`;
  if (days === 0) return `Expires today (${fmtDate(expiresAt)})`;
  return `Valid until ${fmtDate(expiresAt)} (${days} day${days === 1 ? "" : "s"})`;
}

/**
 * The seller dashboard for the environment this connection actually lives in.
 * Sandbox merchants exist only on the sandbox host; sending a test-mode
 * operator to app.squareup.com lands them on a login for an account they do
 * not have. The host is chosen by the connection's mode even where the mode
 * itself is not shown.
 */
const dashboardHref = (mode: SquareMode) =>
  mode === "live" ? "https://app.squareup.com/dashboard/" : "https://app.squareupsandbox.com/dashboard/";

/* ──────────────────────────────── chip ──────────────────────────────────── */

/* ─────────────────────────── first-run demo ─────────────────────────────── */

/**
 * FIRST-RUN DEMO — northwind only, on screen only (Ghulam, Oct 2 2026), the
 * same as Stripe's (see `stripe-connect.tsx`).
 *
 * northwind runs on Stripe, so its Square dialog can never show the flow a
 * brand-new Square operator meets. For demoing that, this pretends — in the
 * browser, nowhere else — that the account is on the Square rail with nothing
 * connected: the chip and the panel read a STAND-IN snapshot, so the education
 * screens and the connect step appear. "Set up Square" then opens Square's
 * public sign-up page in a new tab, spins, and lands on a connected account,
 * instead of calling `square-oauth-start` — and the one-time processor choice
 * (`useChooseSquare`, a permanent DB write) is never offered or made.
 *
 * NOTHING IS WRITTEN. No query changes, no edge function, no column. Closing
 * the dialog resets the demo. To remove: delete this block, the two
 * `useDemoSnapshot` calls and the demo branch in `startConnect`.
 */
const SQUARE_FIRST_RUN_DEMO_SLUGS: readonly string[] = ["northwind"];

type DemoStage = "fresh" | "live";

const demoStore = (() => {
  let stage: DemoStage = "fresh";
  const listeners = new Set<() => void>();
  return {
    get: () => stage,
    set: (next: DemoStage) => {
      stage = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
})();

/** A stand-in snapshot for the demo stage, built from the real one. Never sent anywhere. */
function demoSnapshot(real: SquareSnapshot, stage: DemoStage): SquareSnapshot {
  const now = Date.now();
  const connection: SquareConnectionRow = {
    id: "demo",
    tenant_id: real.tenant.id,
    square_mode: "live",
    status: "active",
    token_expires_at: new Date(now + SQUARE_TOKEN_LIFETIME_DAYS * 86_400_000).toISOString(),
    merchant_id: "ML0DEMO7Q2X4K",
    location_id: "L8DEMO3N5PZ1",
    location_currency: (real.tenant.currency_code ?? "usd").toLowerCase(),
    business_name: "Northwind Rentals",
    scopes: ["PAYMENTS_WRITE", "PAYMENTS_READ", "ORDERS_WRITE", "MERCHANT_PROFILE_READ"],
    refresh_failure_count: 0,
    last_error: null,
    connected_at: new Date(now).toISOString(),
    disconnected_at: null,
  };
  return {
    ...real,
    tenant: { ...real.tenant, payment_provider: "square", square_mode: "live" },
    provider: "square",
    locked: true,
    squareMode: "live",
    connections: stage === "live" ? [connection] : [],
  };
}

function useDemoSnapshot(tenant: PanelTenant, real: SquareSnapshot | undefined) {
  const enabled = SQUARE_FIRST_RUN_DEMO_SLUGS.includes(tenant.slug);
  const stage = useSyncExternalStore(demoStore.subscribe, demoStore.get, demoStore.get);
  const data = useMemo(
    () => (real && enabled ? demoSnapshot(real, stage) : real),
    [real, enabled, stage],
  );
  return { demo: enabled, data };
}

/**
 * The main screen's headline for each state the verdict can produce, keyed by
 * its chip label. The body under it is the verdict's own headline, unchanged.
 */
function titleFor(label: string): string {
  if (label.startsWith("Expires")) return "Your Square access is running out.";
  const map: Record<string, string> = {
    "Not in use": "Stripe takes your payments.",
    Available: "Prefer Square?",
    "Not connected": "Connect your Square account.",
    "Setup unfinished": "Finish setting up in Square.",
    "Access expired": "Your Square access has expired.",
    "Token expired": "Your Square access has expired.",
    "Connection error": "Square stopped answering.",
    "Renewal failing": "Your Square access isn't renewing.",
    "Renewal problem": "Your Square access isn't renewing.",
    "No card location": "Square needs a card location.",
    "Currency mismatch": "Square is set to a different currency.",
    Connected: "You're taking payments with Square.",
  };
  return map[label] ?? "Square";
}

/* ──────────────────────────────── panel ─────────────────────────────────── */

export function SquareStatus({ tenant }: { tenant: PanelTenant }) {
  useSquareOAuthReturn(tenant);
  const { data: real, isLoading, isError } = useSquareStatus(tenant);
  const { data } = useDemoSnapshot(tenant, real);

  if (isLoading) return <StatusChip state="loading" />;
  // A failed READ is not a disconnected integration. Saying "Not connected"
  // invites a reconnect, and a reconnect here revokes and replaces the
  // credentials of a connection that may be perfectly healthy.
  if (isError || !data) return <StatusChip state="attention" label="Status unavailable" />;

  const verdict = deriveSquareVerdict(data);
  return <StatusChip state={verdict.state} label={verdict.label} />;
}

/*
 * THE SCREEN STANDARD (Ghulam, Oct 2 2026 — see `_screens.tsx`). One main
 * screen per state: a picture, a headline, the verdict's own sentence and ONE
 * button. The account details, the one-time processor choice and
 * disconnecting are screens behind quiet links, with Back — the same set as
 * Stripe's (a payments screen was dropped to match it). No rule
 * changed: every gate (who may manage, the country check, the permanent rail
 * write and its confirmation, the disconnect confirmation) is the component it
 * always was — only where it is drawn moved.
 */
// Exactly Stripe's set — account details and disconnecting — plus the two
// Square alone has (the one-time processor choice, how connecting works).
type Screen = "home" | "choose" | "account" | "disconnect" | "how";

export default function SquarePanel({ tenant, onBack, fromIntro }: IntegrationPanelProps) {
  const status = useSquareStatus(tenant);
  const { demo, data: snapshot } = useDemoSnapshot(tenant, status.data);
  const { appUser } = useAuth();

  // `square-oauth-start`, `square-disconnect` and the rail write all reject
  // anything below admin (the edge functions' `authorizeCaller` accepts exactly
  // head_admin | admin of THIS tenant, or a super admin — whom the auth store
  // rewrites to head_admin on load). Showing a viewer a live button that can
  // only 403 is worse than showing it disabled with the reason.
  const canManage = appUser?.role === "head_admin" || appUser?.role === "admin";

  // Lean tenants have no test/live concept, so no mode row. Presentation only.
  const hideModeUi = useIsTestModeUiHidden();

  const verdict = useMemo(() => deriveSquareVerdict(snapshot), [snapshot]);
  const live = verdict.rail === "square" && !!verdict.connection;
  const mode: SquareMode = snapshot?.squareMode ?? "test";
  const connect = useConnectSquare(tenant, mode);
  const disconnect = useDisconnectSquare(tenant, mode);

  const [screen, setScreen] = useState<Screen>("home");
  // The connect ends in a full-page redirect, so the pending flag is latched
  // rather than cleared on success — the button keeps spinning until the
  // browser actually leaves. Reset only when the start call fails.
  const [leaving, setLeaving] = useState(false);

  // The demo starts fresh every time the dialog opens, and is put back when it
  // closes, so it can be shown again from the top.
  useEffect(() => {
    if (!demo) return;
    return () => demoStore.set("fresh");
  }, [demo]);

  const startConnect = useCallback(() => {
    setLeaving(true);
    if (demo) {
      // Plays the hand-off: Square opens in a new tab (its public sign-up page
      // — nothing is created or linked), the button spins, then the dialog
      // lands on connected. A real connect leaves for Square's OAuth instead.
      window.open("https://squareup.com/signup", "_blank", "noopener,noreferrer");
      window.setTimeout(() => {
        demoStore.set("live");
        setLeaving(false);
      }, 2600);
      return;
    }
    connect.mutate(undefined, { onError: () => setLeaving(false) });
  }, [demo, connect]);

  // The DB CHECK guarantees a Square tenant has a supported country, so this
  // is belt and braces: `square-oauth-start` refuses the same case with its
  // own sentence, and offering a button it will 409 is not a control.
  const countryOk = isSquareCountrySupported(snapshot?.tenant.country) || demo;

  // "Set up Square" on the last education screen IS the connect button: on
  // the Square rail with nothing connected, connect at once rather than show a
  // second screen asking for the same click. Never on the Stripe rail — the
  // one-time processor choice is a permanent write that must be read first.
  const [autoStarted, setAutoStarted] = useState(false);
  useEffect(() => {
    if (!fromIntro || autoStarted || !snapshot) return;
    if (verdict.rail !== "square" || live || !canManage || !countryOk) return;
    setAutoStarted(true);
    startConnect();
  }, [fromIntro, autoStarted, snapshot, verdict.rail, live, canManage, countryOk, startConnect]);

  if (status.isLoading) return <PanelLoading rows={4} />;
  if (status.isError || !snapshot) {
    return (
      <PanelError
        message={status.error instanceof Error ? status.error.message : "Unknown error"}
        onRetry={() => void status.refetch()}
      />
    );
  }

  const home = () => setScreen("home");

  /* ── screens behind quiet links ────────────────────────────────────────── */

  if (screen === "choose" && verdict.rail === "stripe-unlocked") {
    return (
      <ScreenPager onBackFromStart={home}>
        <ChooseSquare tenant={tenant} snapshot={snapshot} verdict={verdict} canManage={canManage} />
      </ScreenPager>
    );
  }

  if (screen === "account" && live) {
    // Same shape as Stripe's "Account details": a narrow screen, one card of
    // rows with short hints, an action only when there is something to fix,
    // and one quiet line. The facts are the old Connection section's, unchanged.
    const c = verdict.connection as SquareConnectionRow;
    const reconnect = verdict.state === "attention" && canManage;
    return (
      <SubScreen
        title="Account details"
        description="What Square has told us about the account your bookings are paid into."
        onBack={home}
      >
        <PanelCard className="divide-y divide-border/60">
          <PanelRow label="Business">{c.business_name ?? <span className="text-muted-foreground">Unnamed</span>}</PanelRow>
          <PanelRow label="Merchant ID">
            {c.merchant_id ? <CopyValue value={c.merchant_id} /> : <span className="text-muted-foreground">—</span>}
          </PanelRow>
          {/* Square binds the currency to the LOCATION and never converts, and
              a location is mandatory on every payment link — so "none" here is
              "cannot take money", full stop. */}
          <PanelRow label="Location">
            {c.location_id ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="font-mono text-[12px]">{c.location_id}</span>
                {c.location_currency && (
                  <span className={verdict.currencyMismatch ? "text-warning" : "text-muted-foreground"}>
                    {c.location_currency.toUpperCase()}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-warning">None cleared for cards</span>
            )}
          </PanelRow>
          <PanelRow label="Connected">{fmtDate(c.connected_at)}</PanelRow>
          {!hideModeUi && <PanelRow label="Square mode">{mode === "live" ? "Live" : "Test"}</PanelRow>}
          {/* Deliberately no promise of renewal: the job that renews runs on
              Drive247's side, this screen cannot see it, and it is not running
              today. The date is a deadline that only moves if something moves it. */}
          <PanelRow label="Access">
            <span className={verdict.tokenExpired ? "text-destructive" : verdict.expiringSoon ? "text-warning" : undefined}>
              {tokenPhrase(c.token_expires_at, verdict.daysUntilExpiry)}
            </span>
          </PanelRow>
          <PanelRow label="Permissions">
            {c.scopes && c.scopes.length > 0 ? (
              <span title={c.scopes.join(", ")}>{c.scopes.length} approved</span>
            ) : (
              <span className="text-muted-foreground">Not recorded yet</span>
            )}
          </PanelRow>
        </PanelCard>
        {/* Verbatim: support needs this string to tell a revoke from a
            deactivated merchant from missing platform credentials. */}
        {c.last_error && (
          <PanelNote tone="warn">
            Last message on this connection:
            <span className="mt-1 block break-words font-mono text-[11px] opacity-80">{c.last_error}</span>
          </PanelNote>
        )}
        {reconnect ? (
          <div className="flex justify-center">
            <Button variant="outline" className="rounded-2xl" onClick={startConnect} disabled={leaving}>
              {leaving ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {leaving ? "Opening Square…" : verdict.setupIncomplete ? "Reconnect and re-check" : "Reconnect Square"}
            </Button>
          </div>
        ) : (
          // Square has no on-demand check this screen may run (the token job is
          // a cron), so the test re-reads the STORED connection and says so —
          // it never claims to have asked Square.
          <ConnectionTest
            idle="Re-check the connection Drive247 has on file."
            run={
              demo
                ? () => demoCheck("Working · access valid for 30 days")
                : async () => {
                    const r = await status.refetch();
                    if (r.error) throw r.error instanceof Error ? r.error : new Error("Could not read the connection");
                    const v = deriveSquareVerdict(r.data);
                    if (v.state !== "connected") throw new Error(v.label);
                    return `Working · ${tokenPhrase(v.connection?.token_expires_at ?? null, v.daysUntilExpiry)}`;
                  }
            }
          />
        )}
      </SubScreen>
    );
  }

  if (screen === "disconnect" && live) {
    // Unlinking is allowed from here (Ghulam, Oct 2) — `square-disconnect`
    // via useDisconnectSquare, behind a confirmation. The demo's account is a
    // stand-in, so there it just puts the demo back to the start.
    return (
      <DisconnectScreen
        name="Square"
        canManage={canManage}
        pending={disconnect.isPending}
        onBack={home}
        onConfirm={() => {
          if (demo) {
            demoStore.set("fresh");
            home();
            return;
          }
          disconnect.mutate(undefined, { onSuccess: home });
        }}
        consequence={
          <>
            New bookings can&rsquo;t take card payments, and no Square refund can be issued from here, until you
            connect again. Payments already taken stay in your Square account, untouched.
          </>
        }
      />
    );
  }

  if (screen === "how") {
    return (
      <SubScreen title="How connecting works" onBack={home}>
        <ol className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          {[
            "Sign in to Square and approve access — Drive247 never sees your Square password.",
            "Square hands back a credential for your merchant; it is held encrypted, never shown, and can be revoked from Square at any time.",
            "Drive247 checks that the account has a location cleared for card payments in your currency, and records it.",
            "Square brings you back here when it's done.",
          ].map((step, i) => (
            <li key={step} className="flex gap-2">
              <span className="shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </SubScreen>
    );
  }

  /* ── the main screen ───────────────────────────────────────────────────── */

  // Straight from "Set up Square": keep the education's last screen up, its
  // button spinning, while Square opens — one continuous step.
  if (fromIntro && leaving && !live) {
    return (
      <>
        <Hero
          art={OwnerPayoutsEmptyArt}
          title="Connect your Square account."
          actions={
            <div className="flex justify-center">
              <Button className="h-10 rounded-2xl px-6" disabled>
                <Loader2 className="animate-spin" />
                Opening Square…
              </Button>
            </div>
          }
        >
          Finish in the Square tab — sign in and approve Drive247. I&rsquo;ll pick it up here the moment
          Square hands the account back.
        </Hero>
        <ScreenNav className="mt-8" onBack={onBack} />
      </>
    );
  }

  const offerReconnect = live && verdict.state === "attention" && canManage;
  const conn = verdict.connection;

  let action: ReactNode = null;
  if (verdict.rail === "stripe-unlocked") {
    action = (
      <Button className="h-10 rounded-2xl px-6" onClick={() => setScreen("choose")}>
        See what changes
        <ArrowRight />
      </Button>
    );
  } else if (verdict.rail === "square" && !live) {
    action =
      !countryOk || !canManage ? null : (
        <Button className="h-10 rounded-2xl px-6" onClick={startConnect} disabled={leaving}>
          {leaving ? <Loader2 className="animate-spin" /> : <Link2 />}
          {leaving ? "Opening Square…" : "Connect Square"}
        </Button>
      );
  } else if (offerReconnect) {
    action = (
      <Button className="h-10 rounded-2xl px-6" onClick={startConnect} disabled={leaving}>
        {leaving ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {leaving ? "Opening Square…" : verdict.setupIncomplete ? "Reconnect and re-check" : "Reconnect Square"}
      </Button>
    );
  } else if (live && conn) {
    action = (
      <Button className="h-10 rounded-2xl px-6" asChild>
        <a href={dashboardHref(conn.square_mode)} target="_blank" rel="noopener noreferrer">
          Open Square
          <ArrowUpRight />
        </a>
      </Button>
    );
  }

  // Why a manager-shaped action is missing, said instead of hidden.
  const blocker =
    verdict.rail === "square" && !live && !countryOk
      ? `Square can't process payments for a business registered in ${snapshot.tenant.country ?? "an unknown country"}. Ask Drive247 support to correct the country first.`
      : (verdict.rail === "square" && !live) || (live && verdict.state === "attention")
        ? !canManage
          ? "Only an admin or head admin can connect Square — ask one of them to open this card."
          : null
        : null;

  const links = live
    ? [
        { label: "Account details", onClick: () => setScreen("account") },
        ...(canManage ? [{ label: "Disconnecting", onClick: () => setScreen("disconnect") }] : []),
      ]
    : verdict.rail === "square"
      ? [{ label: "How connecting works", onClick: () => setScreen("how") }]
      : [];

  return (
    <>
      <Hero
        art={live ? PaymentsEmptyArt : verdict.rail === "square" ? OwnerPayoutsEmptyArt : QuotesEmptyArt}
        eyebrow={verdict.state === "connected" ? "Live" : verdict.label}
        title={titleFor(verdict.label)}
        actions={action && <div className="flex justify-center">{action}</div>}
        footer={links.length > 0 && <QuietNav items={links} />}
      >
        {verdict.headline}
        {verdict.revokedAt && !live && (
          <> You disconnected Square on {fmtDate(verdict.revokedAt)}; payments already taken were left as they were.</>
        )}
        {verdict.rail === "stripe-locked" && (
          <> Your payment processor is fixed once chosen, because a refund has to go back through whoever took the charge.</>
        )}
        {blocker && <span className="mt-2 block text-warning">{blocker}</span>}
      </Hero>
      {/* mt-5: this screen can carry a button AND links under its text. */}
      <ScreenNav className="mt-5" onBack={onBack} />
    </>
  );
}

/* ───────────────────────────── stripe, locked ───────────────────────────── */

function StripeLocked({ verdict }: { verdict: SquareVerdict }) {
  return (
    <div className="space-y-4 pt-1">
      <PanelNote>{verdict.headline}</PanelNote>
      {/* Same sentence the Stripe panel uses for the mirror case, on purpose:
          the two cards must agree about why the rail is fixed. The trigger
          refuses to clear the lock for anyone, so no promise is made about what
          support can do — only who to talk to. */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Your payment processor is fixed once chosen, because a refund has to go back through whoever
        took the charge. Talk to Drive247 support if this looks wrong.
      </p>
    </div>
  );
}

/* ─────────────────────────── stripe, unlocked ───────────────────────────── */

/**
 * The rail decision.
 *
 * Three gates, mirrored from the DB trigger and v1's screen rather than
 * invented: no payments may exist, the business must be registered in one of
 * Square's eight markets, and the operator must acknowledge what Square cannot
 * do. Then a confirmation, because the write cannot be undone — not here, not
 * in Settings, and not by clearing the column (the trigger refuses that too).
 */
function ChooseSquare({
  tenant,
  snapshot,
  verdict,
  canManage,
}: {
  tenant: PanelTenant;
  snapshot: SquareSnapshot;
  verdict: SquareVerdict;
  canManage: boolean;
}) {
  const payments = useSquarePaymentsCount(tenant, true);
  const choose = useChooseSquare(tenant);

  const storedCountry = (snapshot.tenant.country ?? "").toUpperCase();
  const [country, setCountry] = useState<string>(
    isSquareCountrySupported(storedCountry) ? storedCountry : "",
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const paymentCount = payments.data ?? 0;
  const hasPayments = paymentCount > 0;
  // A stored country outside Square's markets is a hard stop the operator
  // cannot clear from here: the DB CHECK would refuse the write, and quietly
  // overwriting a registered country to get past it is not this screen's call.
  const countryFixedElsewhere = !!storedCountry && !isSquareCountrySupported(storedCountry);
  const stripeLinked = snapshot.tenant.own_stripe_account_id ?? snapshot.tenant.stripe_account_id;

  const countryName = SQUARE_COUNTRIES.find((c) => c.code === country)?.name ?? country;
  const canConfirm = canManage && !hasPayments && !countryFixedElsewhere && !!country && acknowledged;

  return (
    <div className="space-y-5 pt-1">
      <PanelNote>{verdict.headline}</PanelNote>

      <PanelSection
        title="Choose Square instead"
        description="Payment links only. For businesses that already run on Square."
      >
        <PanelCard>
          <p className="py-1 text-xs font-medium text-foreground">With Square you will not be able to use:</p>
          <ul className="space-y-1 pb-1 text-xs leading-relaxed text-muted-foreground">
            {SQUARE_LIMITS.map((l) => (
              <li key={l} className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </PanelCard>

        {/* What the write touches, named in full. Every line is a column the
            confirm actually changes — see useChooseSquare — so nothing here is
            a surprise afterwards. */}
        <PanelCard>
          <p className="py-1 text-xs font-medium text-foreground">What changes when you confirm:</p>
          <ul className="space-y-1 pb-1 text-xs leading-relaxed text-muted-foreground">
            <li className="flex gap-2">
              <Lock className="mt-0.5 size-3 shrink-0" />
              <span>
                Square becomes your processor <strong className="font-medium text-foreground">permanently</strong>.
                The database refuses to change it again once set — there is no undo here or in Settings.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>
                Stripe Connect stops being offered.
                {stripeLinked
                  ? ` The Stripe account already linked (${stripeLinked}) stays linked but takes no more bookings.`
                  : " Nothing is linked in Stripe today, so nothing is left behind."}
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>Deposits are taken as a real charge and refunded afterwards, instead of held.</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>
                Instalment plans, auto-extend charging and pay-as-you-go reminders are switched off, because
                Square cannot store a card to charge later.
              </span>
            </li>
          </ul>
        </PanelCard>

        {hasPayments ? (
          <PanelNote tone="warn">
            You already have {paymentCount} payment{paymentCount === 1 ? "" : "s"} recorded. The
            processor is fixed once money has been taken, because refunds must go back through the
            processor that took them. Square is no longer an option for this account.
          </PanelNote>
        ) : countryFixedElsewhere ? (
          <PanelNote tone="warn">
            Square cannot process payments for a business registered in {storedCountry}. It is available
            in {SQUARE_COUNTRIES.map((c) => c.code).join(", ")}. If that country is wrong, ask Drive247
            support to correct it before choosing Square.
          </PanelNote>
        ) : !canManage ? (
          <PanelNote tone="warn">
            Only an admin or head admin can choose the payment processor. Ask one of them to open this
            card.
          </PanelNote>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Country your business is registered in
              </label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select a country" />
                </SelectTrigger>
                <SelectContent tone="surface">
                  {SQUARE_COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code} className="text-xs">
                      {c.name} ({c.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Square only operates in these countries. Registered somewhere else? Square is not
                available to you, and Stripe stays your processor.
              </p>
            </div>

            {/* A <label> wrapping the control, so the whole row is the hit
                target: on v1 this checkbox rendered as an invisible box and
                Confirm stayed disabled with nothing on screen saying why. */}
            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
                className="mt-0.5"
              />
              <span className="text-xs leading-snug text-foreground">
                I understand these features will not be available, and that this choice is permanent.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setConfirmOpen(true)} disabled={!canConfirm || choose.isPending}>
                {choose.isPending ? <Loader2 className="animate-spin" /> : <Lock />}
                {choose.isPending ? "Saving…" : "Choose Square"}
              </Button>
              {/* A disabled button with no reason beside it is a dead end.
                  Name the missing step. */}
              <span className="text-[11px] text-muted-foreground">
                {!country
                  ? "Choose your country to continue."
                  : !acknowledged
                    ? "Tick the box above to continue."
                    : "You will not be asked again."}
              </span>
            </div>
          </>
        )}
      </PanelSection>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make Square your payment processor?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Your business will be recorded as registered in {countryName}, and every booking from
                  now on will be paid through Square. This locks immediately and cannot be reversed.
                </p>
                <p>
                  Instalments, auto-extend charging, saved-card charges and deposit holds are switched
                  off. Stripe Connect will no longer be offered on this account.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Stripe</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // `mutate` with callbacks rather than `await mutateAsync`:
                // AlertDialogAction dismisses on click either way, so awaiting
                // inside the handler only delays the result. The panel does not
                // close on success — the same dialog re-renders on the Square
                // rail with a Connect button, which is the next step.
                choose.mutate(country);
                setConfirmOpen(false);
              }}
            >
              Choose Square
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────────────────────────── not connected ────────────────────────────── */

function NotConnected({
  tenant,
  snapshot,
  verdict,
  mode,
  canManage,
}: {
  tenant: PanelTenant;
  snapshot: SquareSnapshot;
  verdict: SquareVerdict;
  mode: SquareMode;
  canManage: boolean;
}) {
  const connect = useConnectSquare(tenant, mode);
  // The connect ends in a full-page redirect, so the pending flag is latched
  // rather than cleared on success — the button keeps spinning until the
  // browser actually leaves. Reset only when the start call fails.
  const [leaving, setLeaving] = useState(false);
  // The DB CHECK guarantees a Square tenant has a supported country, so this
  // is belt and braces: `square-oauth-start` refuses the same case with its
  // own sentence, and offering a button it will 409 is not a control.
  const countryOk = isSquareCountrySupported(snapshot.tenant.country);

  return (
    <PanelSection title="Connect Square">
      {verdict.revokedAt && (
        <PanelNote>
          You disconnected Square on {fmtDate(verdict.revokedAt)}. Payments already taken were left
          exactly as they were in Square, and reconnecting starts fresh.
        </PanelNote>
      )}

      <ol className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
        {[
          "Sign in to Square and approve access — Drive247 never sees your Square password.",
          "Square hands back a credential for your merchant; it is held encrypted, never shown, and can be revoked from Square at any time.",
          "Drive247 checks that the account has a location cleared for card payments in your currency, and records it.",
          "Square brings you back to this portal's Settings → Payments page when it is done. This card updates the next time you open it.",
        ].map((step, i) => (
          <li key={step} className="flex gap-2">
            <span className="shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {!countryOk ? (
        <PanelNote tone="warn">
          Square cannot process payments for a business registered in{" "}
          {snapshot.tenant.country ?? "an unknown country"}. Ask Drive247 support to correct the
          country on this account first.
        </PanelNote>
      ) : !canManage ? (
        <PanelNote tone="warn">
          Only an admin or head admin can connect a payment processor. Ask one of them to open this
          card.
        </PanelNote>
      ) : (
        <Button
          onClick={() => {
            setLeaving(true);
            connect.mutate(undefined, { onError: () => setLeaving(false) });
          }}
          disabled={leaving}
        >
          {leaving ? <Loader2 className="animate-spin" /> : <Link2 />}
          {leaving ? "Opening Square…" : "Connect Square"}
        </Button>
      )}
    </PanelSection>
  );
}

