"use client";

// ── Xero ──────────────────────────────────────────────────────────────────────
//
// The lean product's only route to a Xero connection.
//
// `accounting` is in LEAN_HIDDEN_AREAS, so Settings → Accounting does not render
// for a lean tenant — and this card does. That is not a contradiction to be
// resolved by un-hiding the tab: the lean product surfaces accounting through
// Integrations instead of Settings, and this panel is the replacement for that
// tab, not a second copy of it. Consequently there is NOWHERE to "see the full
// screen": every link out of this panel would land on a tab the canary cannot
// open, so the panel says what it knows and stops, rather than pointing at a
// page that will not be there.
//
// WHAT THIS FEATURE ACTUALLY IS, in production, today: `integration_xero` is
// true for 0 of 57 tenants, and all three rows of `accounting_connections`
// belong to the internal `test` tenant. Nobody has ever run this live. The v1
// code below it is therefore unproven, not battle-tested, and this panel is
// written to say only what it can read — no capability is claimed on the
// strength of the v1 code appearing to implement it.
//
// ⚠️ Every query lives in `xero-data.ts` and every one carries
// `.eq("tenant_id", tenant.id)`. See the isolation note at the top of that file
// for why RLS being ON here does not make that optional.

import { type ReactNode, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Link2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui-v2/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui-v2/select";
import { useAuth } from "@/stores/auth-store";
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
  deriveXeroVerdict,
  useConnectXero,
  useDisconnectXero,
  useRetryFailedXeroSync,
  useSaveXeroPaymentAccount,
  useXeroAccounts,
  useXeroOAuthReturn,
  useXeroStatus,
  useXeroSyncHealth,
  XERO_MAPPED_EVENT_TYPES,
  type XeroAccount,
  type XeroConnectionRow,
  type XeroSyncRow,
  type XeroSnapshot,
  type XeroVerdict,
} from "./xero-data";
import { ConnectionTest, DisconnectScreen, Hero, QuietNav, ScreenNav, ScreenPager, SubScreen, demoCheck } from "./_screens";
import { InvoicesEmptyArt } from "@/components/illustrations-v2/scenes/invoices";
import { PaymentsEmptyArt } from "@/components/illustrations-v2/scenes/payments";

/* ─────────────────────────────── helpers ────────────────────────────────── */

const fmtDate = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "d MMM yyyy") : "—";

const fmtAgo = (iso: string | null | undefined) =>
  iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "—";

/** "expires in 24 minutes" / "expired 3 hours ago" — the tense carries the fault. */
function tokenPhrase(expiresAt: string | null): string {
  if (!expiresAt) return "No expiry recorded";
  const ms = new Date(expiresAt).getTime() - Date.now();
  const rel = formatDistanceToNow(new Date(expiresAt), { addSuffix: true });
  return ms > 0 ? `Expires ${rel}` : `Expired ${rel}`;
}

/**
 * Bank accounts first: `recordPayment` posts against a Xero bank account, so
 * that is what an operator is looking for in a list that also contains every
 * revenue and liability code in their chart.
 */
function orderAccounts(accounts: XeroAccount[]): XeroAccount[] {
  return [...accounts].sort((a, b) => {
    const aBank = a.type === "BANK" ? 0 : 1;
    const bBank = b.type === "BANK" ? 0 : 1;
    if (aBank !== bBank) return aBank - bBank;
    return a.code.localeCompare(b.code, undefined, { numeric: true });
  });
}

/* ──────────────────────────────── chip ──────────────────────────────────── */

/* ─────────────────────────── first-run demo ─────────────────────────────── */

/**
 * FIRST-RUN DEMO — northwind only, on screen only (Ghulam, Oct 2 2026), the
 * same as Stripe's and Square's.
 *
 * The chip and the panel read a STAND-IN snapshot: no connection at first,
 * then — after "Connect Xero" opens Xero's sign-in in a new tab and the button
 * spins — a healthy connection with a payment account and every charge type
 * mapped. Nothing calls `xero-oauth-start`, lists accounts, retries a sync or
 * disconnects: the demo's small screens draw demo data and offer no live
 * control. To remove: delete this block and every `demo` branch below.
 */
const XERO_FIRST_RUN_DEMO_SLUGS: readonly string[] = ["northwind"];

type DemoStage = "fresh" | "live";

const demoStore = (() => {
  let stage: DemoStage = "fresh";
  const listeners = new Set<() => void>();
  return {
    get: () => stage,
    set: (next: DemoStage) => {
      if (next === stage) return;
      stage = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
})();

const DEMO_ACCOUNTS: Record<string, string> = {
  rental_charge: "200 · Rental income",
  extension_charge: "200 · Rental income",
  insurance_charge: "210 · Insurance income",
  damage_charge: "220 · Damage recovery",
  mileage_charge: "200 · Rental income",
  late_fee: "230 · Late fees",
  charging_cost: "240 · Charging recharges",
  deposit_capture: "820 · Deposits held",
  discount: "400 · Discounts given",
};

function demoSnapshot(tenantId: string, stage: DemoStage): XeroSnapshot {
  if (stage === "fresh") return { connection: null, mappings: [] };
  const now = new Date().toISOString();
  return {
    connection: {
      id: "demo",
      tenant_id: tenantId,
      provider: "xero",
      status: "active",
      token_expires_at: new Date(Date.now() + 25 * 60_000).toISOString(),
      external_org_id: "8f2c1d6e-demo-4b1a-9c3e-xero0rg",
      external_org_name: "Northwind Rentals Ltd",
      external_region: null,
      last_synced_at: null,
      last_error: null,
      connected_by: null,
      connected_at: now,
      disconnected_at: null,
      created_at: now,
      updated_at: now,
    },
    mappings: [
      { event_type: null, is_payment_account_sentinel: true, external_account_code: "090", external_account_name: "Business Bank Account" },
      ...XERO_MAPPED_EVENT_TYPES.map((e) => ({
        event_type: e.key,
        is_payment_account_sentinel: false,
        external_account_code: DEMO_ACCOUNTS[e.key].split(" · ")[0],
        external_account_name: DEMO_ACCOUNTS[e.key].split(" · ")[1],
      })),
    ],
  };
}

function useDemo(tenant: PanelTenant, real: XeroSnapshot | undefined) {
  const enabled = XERO_FIRST_RUN_DEMO_SLUGS.includes(tenant.slug);
  const stage = useSyncExternalStore(demoStore.subscribe, demoStore.get, demoStore.get);
  const data = useMemo(() => (enabled ? demoSnapshot(tenant.id, stage) : real), [enabled, stage, real, tenant.id]);
  return { demo: enabled, data };
}

/** The main screen's headline for each verdict. */
function xeroTitle(v: XeroVerdict): string {
  if (v.state === "disconnected") return "Connect your Xero account.";
  if (v.state === "connected") return "Your books are syncing to Xero.";
  const label = v.label ?? "";
  if (label === "Reconnect needed" || label === "Token expired") return "Reconnect Xero.";
  if (label === "Connection error") return "Xero reported a problem.";
  if (label === "Payment account not set") return "Choose where payments land.";
  if (label.includes("unmapped")) return "A few charges have nowhere to go.";
  return "Xero";
}

/* ──────────────────────────────── chip ──────────────────────────────────── */

export function XeroStatus({ tenant }: { tenant: PanelTenant }) {
  useXeroOAuthReturn(tenant);
  const { data: real, isLoading, isError } = useXeroStatus(tenant);
  const { demo, data } = useDemo(tenant, real);

  if (!demo && isLoading) return <StatusChip state="loading" />;
  // A read that failed is NOT "not connected". Saying so would invite a
  // reconnect, and reconnecting rotates the credentials of a connection that
  // may be perfectly healthy.
  if (!demo && isError) return <StatusChip state="attention" label="Status unavailable" />;

  const verdict = deriveXeroVerdict(data);
  return <StatusChip state={verdict.state} label={verdict.label} />;
}

/* ──────────────────────────────── panel ─────────────────────────────────── */

/*
 * THE SCREEN STANDARD (Ghulam, Oct 2 2026 — see `_screens.tsx`), as Stripe and
 * Square have it: one main screen per state with ONE button, and the rest —
 * account details, where things land, sync, disconnecting — behind quiet
 * links, with Back. The Mappings and SyncHealth components are the same ones
 * as before, each on its own (paged) screen; no rule in them changed.
 */
type Screen = "home" | "account" | "mappings" | "sync" | "disconnect";

export default function XeroPanel({ tenant, onBack, fromIntro }: IntegrationPanelProps) {
  const status = useXeroStatus(tenant);
  const { demo, data } = useDemo(tenant, status.data);
  const { appUser } = useAuth();

  // The four edge functions this panel calls all reject anything below admin.
  // Super admins arrive here as `head_admin` — the auth store rewrites the role.
  const canManage = appUser?.role === "head_admin" || appUser?.role === "admin";

  const verdict = deriveXeroVerdict(data);
  const connection = data?.connection ?? null;
  const usable = connection?.status === "active" && !verdict.tokenExpired;
  const live = !!connection && connection.status !== "revoked";

  // Real reads only — the demo never asks Xero for anything.
  const health = useXeroSyncHealth(tenant, live && !demo);
  const accounts = useXeroAccounts(tenant, usable && !demo);
  const connect = useConnectXero(tenant);
  const disconnect = useDisconnectXero(tenant);

  const [screen, setScreen] = useState<Screen>("home");
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!demo) return;
    return () => demoStore.set("fresh");
  }, [demo]);

  const startConnect = useCallback(() => {
    setLeaving(true);
    if (demo) {
      // Xero's sign-in in a new tab (nothing is authorised), a spin, then a
      // healthy connection. A real connect leaves for Xero's OAuth instead.
      window.open("https://login.xero.com", "_blank", "noopener,noreferrer");
      window.setTimeout(() => {
        demoStore.set("live");
        setLeaving(false);
      }, 2600);
      return;
    }
    connect.mutate(undefined, { onError: () => setLeaving(false) });
  }, [demo, connect]);

  // "Connect Xero" on the last education screen IS the connect button.
  const [autoStarted, setAutoStarted] = useState(false);
  useEffect(() => {
    if (!fromIntro || autoStarted || live || !canManage) return;
    if (!demo && (status.isLoading || status.isError)) return;
    setAutoStarted(true);
    startConnect();
  }, [fromIntro, autoStarted, live, canManage, demo, status.isLoading, status.isError, startConnect]);

  if (!demo && status.isLoading) return <PanelLoading rows={4} />;
  if (!demo && status.isError) {
    return (
      <PanelError
        message={status.error instanceof Error ? status.error.message : "Unknown error"}
        onRetry={() => void status.refetch()}
      />
    );
  }

  const home = () => setScreen("home");

  /* ── small screens ─────────────────────────────────────────────────────── */

  if (screen === "account" && live && connection) {
    return (
      <SubScreen title="Account details" description="The Xero organisation your bookings are recorded in." onBack={home}>
        <PanelCard className="divide-y divide-border/60">
          <PanelRow label="Organisation">
            {connection.external_org_name ?? <span className="text-muted-foreground">Unnamed</span>}
          </PanelRow>
          <PanelRow label="Organisation ID">
            <CopyValue value={connection.external_org_id} />
          </PanelRow>
          <PanelRow label="Connected">{fmtDate(connection.connected_at)}</PanelRow>
          {/* No promise of renewal: it is a server-side job this screen
              cannot see, and an expiry in the past is the evidence it failed. */}
          <PanelRow label="Access" hint="Short-lived, renewed behind the scenes.">
            <span className={verdict.tokenExpired ? "text-warning" : undefined}>{tokenPhrase(connection.token_expires_at)}</span>
          </PanelRow>
        </PanelCard>
        {connection.last_error && (
          <PanelNote tone="warn">
            Last error from Xero:
            <span className="mt-1 block font-mono text-[11px] opacity-80">{connection.last_error}</span>
          </PanelNote>
        )}
        {/* A real check: asks Xero for this organisation's chart of accounts
            with the stored credentials — the same call the mappings use. */}
        <ConnectionTest
          idle="Check Drive247 can still reach your Xero organisation."
          disabled={!canManage}
          run={
            demo
              ? () => demoCheck("Working · reached Xero, 38 accounts")
              : !usable
                ? null
                : async () => {
                    const r = await accounts.refetch();
                    if (r.error) throw r.error instanceof Error ? r.error : new Error("Xero did not answer");
                    const n = r.data?.length ?? 0;
                    return `Working · reached Xero, ${n} account${n === 1 ? "" : "s"}`;
                  }
          }
          unavailable="The stored sign-in has expired — reconnect Xero, then test."
        />
      </SubScreen>
    );
  }

  if (screen === "mappings" && live) {
    if (demo) {
      // Demo: read-only, from the stand-in snapshot — no account list is
      // fetched from Xero and nothing is saved.
      return (
        <SubScreen title="Where things land" description="The Xero accounts your payments and charges are recorded against." onBack={home}>
          <PanelCard className="divide-y divide-border/60">
            <PanelRow label="Customer payments" hint="The bank account payments are recorded in.">
              090 · Business Bank Account
            </PanelRow>
            {XERO_MAPPED_EVENT_TYPES.slice(0, 5).map((e) => (
              <PanelRow key={e.key} label={e.label}>
                {DEMO_ACCOUNTS[e.key]}
              </PanelRow>
            ))}
          </PanelCard>
          <p className="text-center text-xs text-muted-foreground">
            And {XERO_MAPPED_EVENT_TYPES.length - 5} more charge types, all mapped.
          </p>
        </SubScreen>
      );
    }
    return (
      <ScreenPager onBackFromStart={home}>
        <Mappings
          tenant={tenant}
          canManage={canManage}
          usable={usable}
          accounts={accounts}
          paymentAccount={verdict.paymentAccount}
          missingEventTypes={verdict.missingEventTypes}
        />
      </ScreenPager>
    );
  }

  if (screen === "sync" && live) {
    if (demo) {
      return (
        <SubScreen title="Sync" description="What has gone to Xero, and anything waiting." onBack={home}>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Sent", "0"],
              ["Waiting", "0"],
              ["Failed", "0"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-muted/20 px-2.5 py-3 text-center">
                <div className="text-lg font-medium leading-tight">{value}</div>
                <div className="text-[11px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            Nothing sent yet — every new charge, payment and refund goes to Xero as it happens.
          </p>
        </SubScreen>
      );
    }
    return (
      <ScreenPager onBackFromStart={home}>
        <SyncHealth tenant={tenant} canManage={canManage} health={health} />
      </ScreenPager>
    );
  }

  if (screen === "disconnect" && live) {
    // Unlinking is allowed from here (Ghulam, Oct 2) — `useDisconnectXero`,
    // behind a confirmation. The demo just puts itself back to the start.
    return (
      <DisconnectScreen
        name="Xero"
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
            New charges, payments and refunds stop going to Xero straight away. Invoices already in Xero stay
            exactly as they are, and reconnecting picks up where it stopped.
          </>
        }
      />
    );
  }

  /* ── the main screen ───────────────────────────────────────────────────── */

  // Straight from "Connect Xero": keep a connecting screen up while Xero opens.
  if (leaving && !live) {
    return (
      <>
        <Hero
          art={InvoicesEmptyArt}
          title="Connect your Xero account."
          actions={
            <div className="flex justify-center">
              <Button className="h-10 rounded-2xl px-6" disabled>
                <Loader2 className="animate-spin" />
                Opening Xero…
              </Button>
            </div>
          }
        >
          Finish in the Xero tab — sign in and choose your organisation. I&rsquo;ll pick it up here the
          moment Xero hands it back.
        </Hero>
        <ScreenNav className="mt-8" onBack={onBack} />
      </>
    );
  }

  const needsReconnect = live && (verdict.tokenExpired || connection?.status === "error");
  const needsMapping = live && !needsReconnect && verdict.state === "attention";

  let action: ReactNode = null;
  if (!live || needsReconnect) {
    action = canManage ? (
      <Button className="h-10 rounded-2xl px-6" onClick={startConnect} disabled={leaving}>
        {leaving ? <Loader2 className="animate-spin" /> : needsReconnect ? <RefreshCw /> : <Link2 />}
        {needsReconnect ? "Reconnect Xero" : "Connect Xero"}
      </Button>
    ) : null;
  } else if (needsMapping) {
    action = (
      <Button className="h-10 rounded-2xl px-6" onClick={() => setScreen("mappings")}>
        Set it up
        <ArrowRight />
      </Button>
    );
  } else {
    action = (
      <Button className="h-10 rounded-2xl px-6" asChild>
        <a href="https://go.xero.com/" target="_blank" rel="noopener noreferrer">
          Open Xero
          <ArrowUpRight />
        </a>
      </Button>
    );
  }

  const body = !live
    ? connection?.disconnected_at
      ? `You disconnected Xero on ${fmtDate(connection.disconnected_at)}. Invoices already in Xero were left as they were, and reconnecting picks up where it stopped.`
      : "Sign in to Xero and pick your organisation. Every rental charge, payment and refund then goes to your Xero books as it happens — I never see your Xero password."
    : verdict.state === "connected"
      ? `Every rental charge, payment and refund goes to ${connection?.external_org_name ?? "your Xero organisation"} as it happens.`
      : verdict.detail ?? "";

  const blocker = (!live || needsReconnect) && !canManage ? "Only an admin or head admin can connect Xero — ask one of them to open this card." : null;

  const links = live
    ? [
        { label: "Account details", onClick: () => setScreen("account") },
        { label: "Where things land", onClick: () => setScreen("mappings") },
        { label: "Sync", onClick: () => setScreen("sync") },
        ...(canManage ? [{ label: "Disconnecting", onClick: () => setScreen("disconnect") }] : []),
      ]
    : [];

  return (
    <>
      <Hero
        art={live ? InvoicesEmptyArt : PaymentsEmptyArt}
        eyebrow={verdict.state === "connected" ? "Live" : verdict.state === "disconnected" ? "Not connected" : verdict.label}
        title={xeroTitle(verdict)}
        actions={action && <div className="flex justify-center">{action}</div>}
        footer={links.length > 0 && <QuietNav items={links} />}
      >
        {body}
        {blocker && <span className="mt-2 block text-warning">{blocker}</span>}
      </Hero>
      <ScreenNav className="mt-5" onBack={onBack} />
    </>
  );
}


/* ──────────────────────────────── mappings ──────────────────────────────── */

function Mappings({
  tenant,
  canManage,
  usable,
  accounts,
  paymentAccount,
  missingEventTypes,
}: {
  tenant: PanelTenant;
  canManage: boolean;
  usable: boolean;
  accounts: ReturnType<typeof useXeroAccounts>;
  paymentAccount: { code: string; name: string | null } | null;
  missingEventTypes: ReadonlyArray<{ key: string; label: string }>;
}) {
  const save = useSaveXeroPaymentAccount(tenant);
  const [draft, setDraft] = useState<string>("");
  const [editing, setEditing] = useState(false);

  const options = useMemo(() => orderAccounts(accounts.data ?? []), [accounts.data]);
  const mappedCount = XERO_MAPPED_EVENT_TYPES.length - missingEventTypes.length;
  const showPicker = editing || !paymentAccount;

  return (
    <PanelSection
      title="Books mapping"
      description="Which Xero accounts Drive247 posts into."
      action={
        usable ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void accounts.refetch()}
            disabled={accounts.isFetching}
            title="Re-read the chart of accounts from Xero"
          >
            {accounts.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Recheck
          </Button>
        ) : undefined
      }
    >
      {/* Reading the chart of accounts IS the connection test — it authenticates
          with the stored token against Xero's own API — so its outcome is
          reported as the verdict on the credentials, not as a dropdown that
          failed to load. */}
      {!usable ? (
        <PanelNote tone="warn">
          Xero cannot be reached with the current credentials, so the chart of accounts could not be
          read. Reconnect first — the mapping below is unchanged in the meantime.
        </PanelNote>
      ) : accounts.isError ? (
        <PanelNote tone="warn">
          Xero rejected the request for your chart of accounts.
          <span className="mt-1 block font-mono text-[11px] opacity-80">
            {accounts.error instanceof Error ? accounts.error.message : "Unknown error"}
          </span>
        </PanelNote>
      ) : accounts.isPending || accounts.isFetching ? (
        <p className="text-xs text-muted-foreground">Checking Xero…</p>
      ) : (
        <p className="inline-flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="size-3.5" />
          Xero answered — {options.length} account{options.length === 1 ? "" : "s"} in your chart.
        </p>
      )}

      <PanelCard>
        <PanelRow
          label="Payment account"
          hint="The bank or clearing account customer payments are recorded against."
        >
          {paymentAccount ? (
            <span>
              {paymentAccount.name ?? (
                <span className="font-mono text-[13px]">{paymentAccount.code}</span>
              )}
              {paymentAccount.name && (
                <span className="ml-1.5 font-mono text-[12px] text-muted-foreground">
                  {paymentAccount.code}
                </span>
              )}
            </span>
          ) : (
            <span className="text-warning">Not set</span>
          )}
        </PanelRow>
        <PanelRow label="Charge types mapped" hint={
          missingEventTypes.length > 0
            ? `Unmapped: ${missingEventTypes.map((e) => e.label).join(", ")}`
            : undefined
        }>
          <span className={missingEventTypes.length > 0 ? "text-warning" : undefined}>
            {mappedCount} of {XERO_MAPPED_EVENT_TYPES.length}
          </span>
        </PanelRow>
      </PanelCard>

      {/* The nine per-charge-type mappings are seeded automatically when the
          connection is made (`seed_default_accounting_mappings`), which is why
          they are shown as a count and not as nine dropdowns in a 32rem dialog.
          The payment account is NOT seeded — the seed has no sensible default
          for someone else's bank account — so it is the one that is editable
          here, and without it every `payment_receipt` fails with
          NO_PAYMENT_ACCOUNT. That is the whole reason this control exists. */}
      {!paymentAccount && (
        <PanelNote tone="warn">
          Until a payment account is set, invoices will sync but customer payments will not — each
          one fails as <span className="font-mono text-[11px]">NO_PAYMENT_ACCOUNT</span> and has to
          be re-queued afterwards.
        </PanelNote>
      )}

      {/* Reconnecting is a real remedy here, not a shrug: the OAuth callback
          calls `seed_default_accounting_mappings`, which inserts only the rows
          that are missing and leaves the ones you have chosen alone. */}
      {missingEventTypes.length > 0 && (
        <PanelNote tone="warn">
          {missingEventTypes.length} charge type{missingEventTypes.length === 1 ? " has" : "s have"}{" "}
          no Xero account, so charges of those kinds fail permanently rather than retrying.
          Reconnecting fills the missing ones back in with Drive247&rsquo;s defaults and leaves the
          accounts you have already chosen alone.
        </PanelNote>
      )}

      {canManage && usable && showPicker && (
        <div className="flex items-center gap-2">
          <Select value={draft} onValueChange={setDraft} disabled={options.length === 0}>
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue
                placeholder={
                  options.length === 0 ? "No accounts with a code" : "Choose a Xero account"
                }
              />
            </SelectTrigger>
            <SelectContent tone="surface">
              {options.map((a) => (
                <SelectItem key={a.code} value={a.code} className="text-xs">
                  <span className="font-mono">{a.code}</span> · {a.name}
                  {a.type === "BANK" && <span className="ml-1 text-muted-foreground">(bank)</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!draft || save.isPending}
            onClick={() => {
              const chosen = options.find((a) => a.code === draft);
              if (!chosen) return;
              save.mutate(chosen, { onSuccess: () => setEditing(false) });
            }}
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
          {editing && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      )}

      {canManage && usable && paymentAccount && !editing && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDraft(paymentAccount.code);
            setEditing(true);
          }}
        >
          Change payment account
        </Button>
      )}

      {/* Xero bank accounts are not required to carry an account code, and
          `recordPayment` posts against `Account.Code`. One with no code cannot
          be used, so it is filtered out rather than offered and then rejected. */}
      {usable && !accounts.isError && !accounts.isFetching && options.length === 0 && (
        <PanelNote tone="warn">
          None of the accounts in this Xero organisation has an account code, and payments are
          posted by code. Give your bank account a code in Xero, then press Recheck.
        </PanelNote>
      )}
    </PanelSection>
  );
}

/* ─────────────────────────────── sync health ────────────────────────────── */

function SyncHealth({
  tenant,
  canManage,
  health,
}: {
  tenant: PanelTenant;
  canManage: boolean;
  health: ReturnType<typeof useXeroSyncHealth>;
}) {
  const retry = useRetryFailedXeroSync(tenant);

  if (health.isLoading) return <PanelLoading rows={2} />;
  if (health.isError) {
    return (
      <PanelSection title="Sync">
        <PanelError
          message={health.error instanceof Error ? health.error.message : "Unknown error"}
          onRetry={() => void health.refetch()}
        />
      </PanelSection>
    );
  }

  const h = health.data;
  if (!h) return null;

  const failures = h.recent.filter((r) => r.state === "failed");

  return (
    <PanelSection title="Sync" description="Financial events queued for Xero.">
      {h.total === 0 ? (
        <PanelNote>
          Nothing has been queued for Xero yet. Events are recorded as rentals are charged, paid and
          refunded — this fills up on its own once the fleet is trading.
        </PanelNote>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Tile label="Synced" value={h.synced} />
            <Tile label="Queued" value={h.queued} />
            <Tile label="Failed" value={h.failed} tone={h.failed > 0 ? "warn" : undefined} />
            <Tile label="Skipped" value={h.skipped} />
          </div>

          <PanelCard>
            <PanelRow label="Last sync attempt">{fmtAgo(h.lastAttemptAt)}</PanelRow>
          </PanelCard>

          {/* Nothing on this screen runs the sync — `process-accounting-sync` is
              driven from the server. Queued work that has never been attempted
              is the only evidence the portal has that the worker is not draining
              this queue, and saying nothing would leave the operator waiting on
              a run that is not coming. */}
          {h.queueStalled && (
            <PanelNote tone="warn">
              {h.queued} event{h.queued === 1 ? " is" : "s are"} queued and none has been attempted
              yet. Drive247 sends these from a background worker rather than from this screen — if
              this does not clear, the queue is not being processed and it needs looking at on the
              platform side.
            </PanelNote>
          )}

          {failures.length > 0 && (
            <div className="space-y-1.5">
              {failures.slice(0, 3).map((row) => (
                <Failure key={row.id} row={row} />
              ))}
            </div>
          )}

          {canManage && h.failed > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => retry.mutate()}
              disabled={retry.isPending}
              // Deliberately says "this tenant", not "Xero": the bulk path of
              // `retry-accounting-sync` filters on tenant + state and not on
              // provider, so a tenant also running Zoho has those re-queued too.
              title="Re-queues every failed accounting event for this tenant"
            >
              {retry.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Re-queue {h.failed} failed event{h.failed === 1 ? "" : "s"}
            </Button>
          )}
        </>
      )}
    </PanelSection>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}) {
  return (
    <div className="rounded-xl border bg-muted/20 px-2.5 py-2 text-center">
      <div className={`text-lg font-medium leading-tight ${tone === "warn" ? "text-warning" : ""}`}>
        {value}
      </div>
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

function Failure({ row }: { row: XeroSyncRow }) {
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-xs leading-relaxed text-foreground">
            {row.last_error ?? "Failed with no error recorded."}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {row.last_error_code ? `${row.last_error_code} · ` : ""}
            {row.attempts} attempt{row.attempts === 1 ? "" : "s"} · {fmtAgo(row.updated_at)}
          </p>
        </div>
      </div>
    </div>
  );
}

