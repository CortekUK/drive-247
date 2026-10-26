"use client";

// ── Xero / Zoho Books — one panel, two providers ─────────────────────────────
//
// The v2 accounting connection (accounting_v2_connections + the sync engine in
// supabase/functions/_shared/accounting-v2). `xero.tsx` and `zoho.tsx` are thin
// wrappers that pick the provider; everything else is the same screen standard
// as before (`_screens.tsx`): one main screen per state with ONE button, the
// rest behind quiet links with Back — Account details, Where things land, Sync,
// Disconnecting.
//
// Each tenant connects its OWN organisation; tokens live in Vault server-side
// and never reach this file. Every money movement is captured by database
// triggers, so nothing on these screens is needed for a transaction to sync —
// they only show what happened and let an admin connect, map and disconnect.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ArrowRight, ArrowUpRight, Building2, Globe, Link2, Loader2, Plug, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { InvoicesEmptyArt } from "@/components/illustrations-v2/scenes/invoices";
import { PaymentsEmptyArt } from "@/components/illustrations-v2/scenes/payments";
import { ExpensesEmptyArt } from "@/components/illustrations-v2/scenes/expenses";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/stores/auth-store";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import {
  accountingAction,
  type AccountingConnection,
  type AccountingProvider,
  type AccountingSettings,
  type AccountOption,
  type AccountRef,
  PROVIDER_CARD,
  PROVIDER_NAME,
  type SyncItemRow,
  useAccountingConnection,
  useAccountingConnections,
  useAccountingInvalidate,
  useAccountingOptions,
  useSyncItems,
  useSyncItemsLive,
} from "@/hooks/use-accounting-v2";
import type { IntegrationPanelProps, IntegrationState, PanelTenant } from "./_kit";
import { CopyValue, PanelCard, PanelError, PanelLoading, PanelNote, PanelRow, PanelSection, StatusChip } from "./_kit";
import { ConnectionTest, DisconnectScreen, Hero, QuietNav, ScreenNav, ScreenPager, SubScreen, useNarrowDialog } from "./_screens";

/* ─────────────────────────────── helpers ────────────────────────────────── */

const fmtDate = (iso: string | null | undefined) => (iso ? format(new Date(iso), "d MMM yyyy") : "—");
const fmtAgo = (iso: string | null | undefined) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "—");

/** The Zoho data centres to start sign-in in (Canada only arrives on return). Zoho tells us the real one on return; this only builds the first URL. */
const ZOHO_REGIONS = [
  { region: "com", label: "Global (.com)", where: "United States and everywhere unlisted", flag: null },
  { region: "eu", label: "Europe (.eu)", where: "European Union", flag: "eu" },
  { region: "uk", label: "United Kingdom (.uk)", where: "United Kingdom", flag: "gb" },
  { region: "in", label: "India (.in)", where: "India", flag: "in" },
  { region: "com.au", label: "Australia (.com.au)", where: "Australia", flag: "au" },
  { region: "jp", label: "Japan (.jp)", where: "Japan", flag: "jp" },
  { region: "sa", label: "Saudi Arabia (.sa)", where: "Middle East", flag: "sa" },
] as const;

const OAUTH_REASONS: Record<string, string> = {
  state_expired: "The sign-in took too long and expired. Start again and finish without pausing.",
  access_denied: "Access was not granted, so nothing was connected.",
  missing_params: "The provider came back without an authorisation code.",
  token_exchange_failed: "The provider rejected the authorisation code. Start again.",
  no_refresh_token: "The provider did not grant offline access, so the connection could not be kept alive. Remove Drive247 from its connected apps, then connect again.",
  organisations_lookup_failed: "You signed in, but the provider would not list your organisations — usually a permission missing on the app.",
  no_organisations: "That account has no organisation to connect. Create one, then connect again.",
  persist_failed: "The connection was authorised but could not be saved. Try again.",
  other_provider: "This company already has its other accounting integration connected. A company uses one — disconnect it first to switch.",
  org_taken: "That organisation is already connected to another company on Drive247. Each company connects its own books — sign in with your company's own organisation.",
};

type Verdict = { state: IntegrationState; label?: string };

export function verdictOf(c: AccountingConnection | null | undefined): Verdict {
  if (!c || c.status === "disconnected") return { state: "disconnected" };
  if (c.status === "connected") return { state: "connected" };
  if (c.status === "pending_org") return { state: "attention", label: "Choose organisation" };
  if (c.status === "needs_reauth") return { state: "attention", label: "Needs reconnect" };
  return { state: "attention", label: "Error" };
}

function webUrl(provider: AccountingProvider, c: AccountingConnection | null): string {
  if (provider === "xero") {
    return c?.external_org_short_code
      ? `https://go.xero.com/organisationlogin/default.aspx?shortcode=${encodeURIComponent(c.external_org_short_code)}`
      : "https://go.xero.com/";
  }
  let host = "books.zoho.com";
  try {
    if (c?.api_domain) {
      const h = new URL(c.api_domain).hostname;
      host = h.endsWith("zohoapis.ca") ? "books.zohocloud.ca" : h.replace(/^www\.zohoapis\./, "books.zoho.");
    } else if (c?.region) host = `books.zoho.${c.region}`;
  } catch { /* default */ }
  return c?.external_org_id ? `https://${host}/app/${c.external_org_id}#/home/dashboard` : `https://${host}/`;
}

/* ───────────────────────────── OAuth return ─────────────────────────────── */

/**
 * The callbacks send the operator back to `/integrations?open=<card>` with
 * `accounting=connected|choose|error&provider=…&reason=…`. Module-scoped flag:
 * the chip renders twice when the dialog is open and StrictMode doubles
 * effects, so a ref would toast twice. `open` / `provider` are left in place —
 * the board reads them to open the dialog.
 */
const handledReturn: Record<string, boolean> = {};

function useOAuthReturn(tenant: PanelTenant, provider: AccountingProvider) {
  const { toast } = useToast();
  const invalidate = useAccountingInvalidate(tenant.id);
  useEffect(() => {
    if (handledReturn[provider] || typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("provider") !== provider || !q.get("accounting")) return;
    handledReturn[provider] = true;
    const status = q.get("accounting");
    const reason = q.get("reason");
    q.delete("accounting");
    q.delete("reason");
    const qs = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    try { sessionStorage.removeItem(`drive247.accounting.${provider}.leaving`); } catch { /* ignore */ }
    void invalidate();
    const name = PROVIDER_NAME[provider];
    if (status === "connected") toast({ title: `${name} connected`, description: "New charges, payments and refunds now go to your books as they happen." });
    else if (status === "choose") toast({ title: "Choose an organisation", description: `You authorised more than one — pick the one Drive247 should post to.` });
    else toast({ variant: "destructive", title: `Couldn't connect ${name}`, description: OAUTH_REASONS[reason ?? ""] ?? `${name} reported: ${reason ?? "unknown error"}` });
  }, [provider, toast, invalidate]);
}

/* ──────────────────────────────── chip ──────────────────────────────────── */

export function AccountingStatusChip({ tenant, provider }: { tenant: PanelTenant; provider: AccountingProvider }) {
  useOAuthReturn(tenant, provider);
  const { data, isLoading, isError } = useAccountingConnection(tenant.id, provider);
  if (isLoading) return <StatusChip state="loading" />;
  // A read that failed is NOT "not connected" — that would invite a reconnect.
  if (isError) return <StatusChip state="attention" label="Status unavailable" />;
  const v = verdictOf(data);
  return <StatusChip state={v.state} label={v.label} />;
}

/* ──────────────────────────────── panel ─────────────────────────────────── */

type Screen = "home" | "account" | "mappings" | "sync" | "disconnect";

export function AccountingPanel({ tenant, onBack, fromIntro, provider }: IntegrationPanelProps & { provider: AccountingProvider }) {
  const name = PROVIDER_NAME[provider];
  const short = provider === "xero" ? "Xero" : "Zoho";
  const { appUser } = useAuth();
  const { toast } = useToast();
  const invalidate = useAccountingInvalidate(tenant.id);
  const canManage = !!appUser?.is_super_admin || appUser?.role === "head_admin" || appUser?.role === "admin";

  const status = useAccountingConnection(tenant.id, provider);
  const conn = status.data ?? null;
  const live = !!conn && conn.status !== "disconnected";
  // One accounting integration per company: the other provider, if it is live
  // or mid-connect, blocks this one until it is disconnected.
  const allConns = useAccountingConnections(tenant.id);
  const otherConn = (allConns.data ?? []).find((c) => c.provider !== provider && c.status !== "disconnected") ?? null;
  const otherName = otherConn ? PROVIDER_NAME[otherConn.provider] : null;
  const usable = conn?.status === "connected";

  const [screen, setScreen] = useState<Screen>("home");
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [region, setRegion] = useState<string>("");

  const startConnect = useCallback(async (zohoRegion?: string) => {
    setLeaving(true);
    try {
      const redirectBack = `${window.location.origin}/integrations?open=${encodeURIComponent(PROVIDER_CARD[provider])}`;
      const { authorizeUrl } = await accountingAction<{ authorizeUrl: string }>("start", provider, tenant.slug, {
        redirectBack, region: zohoRegion ?? conn?.region ?? undefined,
      });
      if (!authorizeUrl) throw new Error(`${name} did not return a sign-in address.`);
      window.location.href = authorizeUrl;
    } catch (e) {
      setLeaving(false);
      toast({ variant: "destructive", title: `Could not start the ${name} connection`, description: e instanceof Error ? e.message : "Please try again." });
    }
  }, [provider, tenant.slug, conn?.region, name, toast]);

  // "Connect Xero" on the education's last screen IS the connect button. Zoho
  // needs its data centre first, so it lands on the picker instead.
  const [autoStarted, setAutoStarted] = useState(false);
  useEffect(() => {
    if (provider !== "xero" || !fromIntro || autoStarted || live || otherConn || !canManage || status.isLoading || status.isError || allConns.isLoading) return;
    setAutoStarted(true);
    void startConnect();
  }, [provider, fromIntro, autoStarted, live, otherConn, canManage, status.isLoading, status.isError, allConns.isLoading, startConnect]);

  const run = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      await invalidate();
      if (done) toast({ title: done });
      return true;
    } catch (e) {
      toast({ variant: "destructive", title: label, description: e instanceof Error ? e.message : "Nothing was changed." });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (status.isLoading) return <PanelLoading rows={4} />;
  if (status.isError) {
    return <PanelError message={status.error instanceof Error ? status.error.message : "Unknown error"} onRetry={() => void status.refetch()} />;
  }
  const home = () => setScreen("home");

  /* ── small screens ─────────────────────────────────────────────────────── */

  if (screen === "account" && live && conn) {
    return (
      <SubScreen title="Account details" description={`The ${name} organisation your bookings are recorded in.`} onBack={home}>
        <PanelCard className="divide-y divide-border/60">
          <PanelRow label="Organisation">{conn.external_org_name ?? <span className="text-muted-foreground">Not chosen yet</span>}</PanelRow>
          {conn.external_org_id && (
            <PanelRow label="Organisation ID"><CopyValue value={conn.external_org_id} /></PanelRow>
          )}
          {provider === "zoho" && conn.region && <PanelRow label="Data centre">{`zoho.${conn.region}`}</PanelRow>}
          <PanelRow label="Connected">{fmtDate(conn.connected_at)}</PanelRow>
          <PanelRow label="Last sent" hint="Transactions go as they happen, within about a minute.">{fmtAgo(conn.last_sync_at)}</PanelRow>
        </PanelCard>
        {conn.last_error && conn.status !== "connected" && (
          <PanelNote tone="warn">
            {conn.last_error}
          </PanelNote>
        )}
        {/* A real call with the stored sign-in: Xero GET /Organisation, Zoho GET /organizations/{id}. */}
        <ConnectionTest
          idle={`Check Drive247 can still reach your ${name} organisation.`}
          disabled={!canManage}
          run={usable ? async () => {
            const r = await accountingAction<{ organisation: string }>("test", provider, tenant.slug);
            return `Working · reached ${r.organisation}`;
          } : null}
          unavailable={`The stored sign-in no longer works — reconnect ${short}, then test.`}
        />
        <SyncSince tenant={tenant} provider={provider} conn={conn} canManage={canManage} />
      </SubScreen>
    );
  }

  if (screen === "mappings" && live && conn) {
    return (
      <ScreenPager onBackFromStart={home}>
        <Mappings tenant={tenant} provider={provider} conn={conn} canManage={canManage} usable={usable} />
      </ScreenPager>
    );
  }

  if (screen === "sync" && live && conn) {
    return <SyncScreen tenant={tenant} provider={provider} onBack={home} />;
  }

  if (screen === "disconnect" && live) {
    return (
      <DisconnectScreen
        name={short}
        canManage={canManage}
        pending={busy}
        onBack={home}
        onConfirm={() => void run(`Could not disconnect ${short}`, () => accountingAction("disconnect", provider, tenant.slug), `${short} disconnected`).then((ok) => ok && home())}
        consequence={
          <>
            New charges, payments and refunds stop going to {short} straight away, and Drive247&rsquo;s access
            is revoked. Everything already in {short} stays exactly as it is — and reconnecting the same
            organisation sends whatever happened in between, so nothing is missed.
          </>
        }
      />
    );
  }

  /* ── leaving for the provider ──────────────────────────────────────────── */

  if (leaving) {
    return (
      <>
        <Hero
          art={provider === "xero" ? InvoicesEmptyArt : ExpensesEmptyArt}
          title={`Connect your ${name} account.`}
          actions={
            <div className="flex justify-center">
              <Button className="h-10 rounded-2xl px-6" disabled>
                <Loader2 className="animate-spin" />
                Opening {short}…
              </Button>
            </div>
          }
        >
          Sign in to {short} and choose your organisation. I&rsquo;ll pick it up here the moment {short} hands it back.
        </Hero>
        <ScreenNav className="mt-8" onBack={onBack} />
      </>
    );
  }

  /* ── several organisations authorised: pick one ────────────────────────── */

  if (conn?.status === "pending_org") {
    return (
      <OrgPicker
        conn={conn}
        name={name}
        canManage={canManage}
        busy={busy}
        onBack={onBack}
        onPick={(orgId) => void run("Could not finish connecting", () => accountingAction("select_org", provider, tenant.slug, { orgId }), `${short} connected`)}
      />
    );
  }

  /* ── the other integration is connected: one per company ───────────────── */

  if (!live && otherConn && otherName) {
    return (
      <>
        <Hero art={provider === "xero" ? InvoicesEmptyArt : ExpensesEmptyArt} title={`${otherName} is already connected.`}>
          A company uses one accounting integration, so every transaction lands in one set of books. To move to {name},
          disconnect {otherName} first — everything already in {otherName} stays there.
        </Hero>
        <ScreenNav className="mt-8" onBack={onBack} />
      </>
    );
  }

  /* ── not connected: Zoho asks for its data centre first ────────────────── */

  if (!live && provider === "zoho") {
    const picked = ZOHO_REGIONS.find((r) => r.region === region);
    return (
      <div className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
        <Narrow>
          <div className="space-y-2 text-center">
            <h3 className="text-xl font-medium leading-snug text-foreground">Where&rsquo;s your Zoho account?</h3>
            <p className="mx-auto max-w-[32rem] text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
              Zoho keeps each account in one region — it&rsquo;s in your Zoho web address:{" "}
              <span className="font-mono text-[13px] text-foreground/80">books.zoho.eu</span> is Europe,{" "}
              <span className="font-mono text-[13px] text-foreground/80">books.zoho.com</span> is Global.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Zoho data centre">
            {ZOHO_REGIONS.map((r) => (
              <ChoiceButton key={r.region} selected={region === r.region} onClick={() => setRegion(r.region)}
                icon={r.flag ? (
                  <img src={`https://flagcdn.com/${r.flag}.svg`} alt="" aria-hidden className="h-3.5 w-5 shrink-0 rounded-[3px] object-cover ring-1 ring-black/10" />
                ) : <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                label={r.label} sub={r.where} />
            ))}
          </div>
          {conn?.disconnected_at && (
            <p className="text-center text-xs text-muted-foreground">
              You disconnected Zoho Books on {fmtDate(conn.disconnected_at)}. Reconnecting the same organisation sends what happened since.
            </p>
          )}
          {!canManage && <p className="text-center text-xs text-warning">Only an admin or head admin can connect an accounting system.</p>}
          <div className="flex justify-center">
            <Button className="h-10 rounded-2xl px-6" onClick={() => picked && void startConnect(picked.region)} disabled={!picked || !canManage}>
              <Plug className="size-4" />
              Connect Zoho Books
            </Button>
          </div>
        </Narrow>
        <ScreenNav className="mt-5" onBack={onBack} />
      </div>
    );
  }

  /* ── the main screen ───────────────────────────────────────────────────── */

  const needsReconnect = live && (conn?.status === "needs_reauth" || conn?.status === "error");
  const v = verdictOf(conn);

  let action = null;
  if (!live || needsReconnect) {
    action = canManage ? (
      <Button className="h-10 rounded-2xl px-6" onClick={() => void startConnect()} disabled={leaving}>
        {needsReconnect ? <RefreshCw /> : <Link2 />}
        {needsReconnect ? `Reconnect ${short}` : `Connect ${short}`}
      </Button>
    ) : null;
  } else {
    action = (
      <Button className="h-10 rounded-2xl px-6" asChild>
        <a href={webUrl(provider, conn)} target="_blank" rel="noopener noreferrer">
          Open {short}
          <ArrowUpRight />
        </a>
      </Button>
    );
  }

  const title = !live
    ? `Connect your ${name} account.`
    : needsReconnect
      ? `Reconnect ${short}.`
      : `Your books are syncing to ${short}.`;

  const body = !live
    ? conn?.disconnected_at
      ? `You disconnected ${short} on ${fmtDate(conn.disconnected_at)}. What's already in ${short} was left as it was, and reconnecting the same organisation sends everything that happened since.`
      : `Sign in to ${short} and pick your organisation. Every rental charge, payment and refund — card or cash — then goes to your ${short} books as it happens. I never see your ${short} password.`
    : needsReconnect
      ? `${conn?.last_error ?? `${short} stopped accepting the stored sign-in.`} Nothing is lost — new transactions wait here and go the moment you reconnect.`
      : `Every rental charge, payment and refund goes to ${conn?.external_org_name ?? `your ${short} organisation`} as it happens.`;

  const blocker = (!live || needsReconnect) && !canManage ? `Only an admin or head admin can connect ${short} — ask one of them to open this card.` : null;

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
        art={live ? InvoicesEmptyArt : provider === "xero" ? PaymentsEmptyArt : ExpensesEmptyArt}
        eyebrow={v.state === "connected" ? "Live" : v.state === "disconnected" ? "Not connected" : v.label}
        title={title}
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

/* ─────────────────────────────── pieces ─────────────────────────────────── */

function Narrow({ children }: { children: React.ReactNode }) {
  useNarrowDialog();
  return <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-1">{children}</div>;
}

function ChoiceButton({ selected, onClick, icon, label, sub }: {
  selected: boolean; onClick: () => void; icon: React.ReactNode; label: string; sub?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "rounded-2xl border px-3 py-2.5 text-left transition-colors duration-200 motion-reduce:transition-none",
        selected ? "border-primary/50 bg-primary/10" : "border-border bg-background/70 hover:border-primary/30",
      )}
    >
      <span className="flex items-center gap-2">
        {icon}
        <span className="truncate text-sm font-medium text-foreground">{label}</span>
      </span>
      {sub && <span className="mt-0.5 block truncate pl-7 text-[11px] text-muted-foreground">{sub}</span>}
    </button>
  );
}

function OrgPicker({ conn, name, canManage, busy, onBack, onPick }: {
  conn: AccountingConnection; name: string; canManage: boolean; busy: boolean; onBack?: () => void; onPick: (orgId: string) => void;
}) {
  const [orgId, setOrgId] = useState("");
  const orgs = conn.available_orgs ?? [];
  return (
    <div className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
      <Narrow>
        <div className="space-y-2 text-center">
          <h3 className="text-xl font-medium leading-snug text-foreground">Which organisation?</h3>
          <p className="mx-auto max-w-[32rem] text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
            You gave Drive247 access to {orgs.length} {name} organisations. Pick the one your rentals belong in —
            access to the others is dropped.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={`${name} organisation`}>
          {orgs.map((o) => (
            <ChoiceButton key={o.id} selected={orgId === o.id} onClick={() => setOrgId(o.id)}
              icon={<Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />} label={o.name} />
          ))}
        </div>
        {!canManage && <p className="text-center text-xs text-warning">Only an admin or head admin can finish connecting.</p>}
        <div className="flex justify-center">
          <Button className="h-10 rounded-2xl px-6" disabled={!orgId || !canManage || busy} onClick={() => onPick(orgId)}>
            {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}
            Use this organisation
          </Button>
        </div>
      </Narrow>
      <ScreenNav className="mt-5" onBack={onBack} />
    </div>
  );
}

/** "Syncing since" + the optional backfill: also send past transactions from a date. */
function SyncSince({ tenant, provider, conn, canManage }: {
  tenant: PanelTenant; provider: AccountingProvider; conn: AccountingConnection; canManage: boolean;
}) {
  const { toast } = useToast();
  const invalidate = useAccountingInvalidate(tenant.id);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const since = conn.sync_from ?? conn.connected_at;
  return (
    <PanelCard>
      <PanelRow label="Syncing since" hint="Transactions from this date on are in your books.">
        <span className="inline-flex items-center gap-2">
          {fmtDate(since)}
          {canManage && conn.status === "connected" && !open && (
            <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setOpen(true)}>
              Include earlier
            </button>
          )}
        </span>
      </PanelRow>
      {open && (
        <div className="flex items-center gap-2 px-4 pb-3">
          <Input type="date" className="h-8 flex-1 text-xs" value={from} max={since ? since.slice(0, 10) : undefined} onChange={(e) => setFrom(e.target.value)} />
          <Button size="sm" disabled={!from || busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await accountingAction<{ queued: number }>("backfill", provider, tenant.slug, { from: new Date(`${from}T00:00:00`).toISOString() });
              await invalidate();
              toast({ title: r.queued ? `${r.queued} past transaction${r.queued === 1 ? "" : "s"} queued` : "Nothing earlier to send", description: r.queued ? "They go out over the next few minutes, oldest first." : undefined });
              setOpen(false);
            } catch (e) {
              toast({ variant: "destructive", title: "Could not include earlier transactions", description: e instanceof Error ? e.message : "Nothing was changed." });
            } finally {
              setBusy(false);
            }
          }}>
            {busy && <Loader2 className="animate-spin" />}
            Send
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      )}
    </PanelCard>
  );
}

/* ──────────────────────────── where things land ─────────────────────────── */

type SlotKey = "card_account" | "manual_account" | "sales_account" | "deposit_account" | "tax_account";

const SLOTS: { key: SlotKey; label: string; hint: string; pay: boolean }[] = [
  { key: "card_account", label: "Card payments", hint: "Stripe and Square payments and refunds.", pay: true },
  { key: "manual_account", label: "Cash & manual payments", hint: "Cash, bank transfer, cheque — recorded by hand.", pay: true },
  { key: "sales_account", label: "Rental income", hint: "Rental, fees, extras, fines.", pay: false },
  { key: "deposit_account", label: "Security deposits", hint: "Held for the customer — ideally a liability.", pay: false },
  { key: "tax_account", label: "Tax collected", hint: "Drive247's own Tax lines.", pay: false },
];

function accountLabel(a: AccountRef | AccountOption | null | undefined) {
  if (!a) return "—";
  return a.code ? `${a.code} · ${a.name ?? ""}` : (a.name ?? a.id);
}

function Mappings({ tenant, provider, conn, canManage, usable }: {
  tenant: PanelTenant; provider: AccountingProvider; conn: AccountingConnection; canManage: boolean; usable: boolean;
}) {
  const short = provider === "xero" ? "Xero" : "Zoho";
  const options = useAccountingOptions(tenant, provider, usable);
  const { toast } = useToast();
  const invalidate = useAccountingInvalidate(tenant.id);
  const [draft, setDraft] = useState<AccountingSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const current: AccountingSettings = draft ?? conn.settings ?? {};
  const auto = new Set(conn.settings?.auto ?? []);

  const accounts = options.data?.accounts ?? [];
  const pick = (slot: SlotKey) => {
    const pay = SLOTS.find((s) => s.key === slot)!.pay;
    return accounts.filter((a) => (pay ? a.canPay : a.canSell));
  };
  const chosen = (slot: SlotKey): AccountRef | null =>
    (current[slot] as AccountRef | null | undefined) ?? (options.data?.defaults?.[slot] ?? null);

  return (
    <PanelSection
      title="Where things land"
      description={`The ${short} accounts Drive247 posts into. Anything left on its default is chosen from your chart automatically.`}
      action={usable ? (
        <Button variant="ghost" size="xs" onClick={() => void options.refetch()} disabled={options.isFetching} title={`Re-read the chart of accounts from ${short}`}>
          {options.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Recheck
        </Button>
      ) : undefined}
    >
      {!usable ? (
        <PanelNote tone="warn">{short} cannot be reached with the current sign-in, so the chart of accounts could not be read. Reconnect first — the mapping below is unchanged in the meantime.</PanelNote>
      ) : options.isError ? (
        <PanelNote tone="warn">
          {short} rejected the request for your chart of accounts.
          <span className="mt-1 block font-mono text-[11px] opacity-80">{options.error instanceof Error ? options.error.message : "Unknown error"}</span>
        </PanelNote>
      ) : null}

      <PanelCard className="divide-y divide-border/60">
        {SLOTS.map((s) => {
          const value = chosen(s.key);
          const isAuto = !current[s.key] || (!draft && auto.has(s.key));
          return (
            <PanelRow key={s.key} label={s.label} hint={s.hint}>
              {canManage && usable && options.data ? (
                <Select
                  value={value?.id ?? ""}
                  onValueChange={(id) => {
                    const a = accounts.find((x) => x.id === id);
                    if (a) setDraft({ ...current, [s.key]: { id: a.id, code: a.code, name: a.name } });
                  }}
                >
                  <SelectTrigger className="h-8 w-[15rem] text-xs"><SelectValue placeholder="Choose an account" /></SelectTrigger>
                  <SelectContent tone="surface">
                    {pick(s.key).map((a) => (
                      <SelectItem key={a.id} value={a.id} className="text-xs">{accountLabel(a)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm">{accountLabel(value)}</span>
              )}
              {isAuto && value && <span className="ml-1.5 text-[11px] text-muted-foreground">default</span>}
            </PanelRow>
          );
        })}
        <PanelRow label="Tax rate on income" hint="Applied to rental and fee lines. Drive247 already adds its own Tax line, so most leave this off.">
          {canManage && usable && options.data ? (
            <Select
              value={current.tax_rate?.id ?? "__none"}
              onValueChange={(id) => {
                const t = options.data!.taxRates.find((x) => x.id === id);
                setDraft({ ...current, tax_rate: t ? { id: t.id, name: t.name } : null });
              }}
            >
              <SelectTrigger className="h-8 w-[15rem] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent tone="surface">
                <SelectItem value="__none" className="text-xs">No tax</SelectItem>
                {options.data.taxRates.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}{t.rate != null ? ` (${t.rate}%)` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-sm">{current.tax_rate?.name ?? "No tax"}</span>
          )}
        </PanelRow>
      </PanelCard>

      {canManage && draft && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
          <Button size="sm" disabled={saving} onClick={async () => {
            setSaving(true);
            try {
              await accountingAction("save_settings", provider, tenant.slug, { settings: draft });
              await invalidate();
              setDraft(null);
              toast({ title: "Saved", description: "New transactions use these accounts." });
            } catch (e) {
              toast({ variant: "destructive", title: "Could not save", description: e instanceof Error ? e.message : "Nothing was changed." });
            } finally {
              setSaving(false);
            }
          }}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      )}
    </PanelSection>
  );
}

/* ──────────────────────────────── sync ──────────────────────────────────── */

/**
 * Every transaction sent to the provider, newest first, read-only. Scrolls
 * inside the dialog; the next 50 load as the bottom comes into view.
 */
function SyncScreen({ tenant, provider, onBack }: { tenant: PanelTenant; provider: AccountingProvider; onBack: () => void }) {
  const short = provider === "xero" ? "Xero" : "Zoho";
  const items = useSyncItems(tenant.id, provider, true);
  useSyncItemsLive(tenant.id, true);
  const rows = useMemo(() => (items.data?.pages ?? []).flat(), [items.data]);
  const currency = (tenant.currency_code as string | undefined) ?? rows[0]?.currency ?? "USD";

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !items.hasNextPage) return;
    const io = new IntersectionObserver(
      (e) => { if (e[0]?.isIntersecting && !items.isFetchingNextPage) void items.fetchNextPage(); },
      { root: scrollRef.current, rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [items.hasNextPage, items.isFetchingNextPage, items.fetchNextPage, rows.length]);

  return (
    <SubScreen title="Sync" description={`What has gone to ${short}, and anything waiting.`} onBack={onBack}>
      {items.isLoading ? (
        <PanelLoading rows={4} />
      ) : items.isError ? (
        <PanelError message={items.error instanceof Error ? items.error.message : "Unknown error"} onRetry={() => void items.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Nothing sent yet — every new charge, payment and refund goes to {short} as it happens.
        </p>
      ) : (
        <div ref={scrollRef} className="max-h-[min(52vh,28rem)] overflow-y-auto rounded-xl border">
          <table className="w-full table-fixed text-xs">
            <thead className="sticky top-0 z-10 bg-background/95 text-[11px] text-muted-foreground backdrop-blur">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-medium">Transaction</th>
                <th className="w-[5.5rem] px-2 py-2 text-right font-medium">Amount</th>
                <th className="w-[4.5rem] px-2 py-2 text-left font-medium">Date</th>
                <th className="w-[4.75rem] px-3 py-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => <SyncRow key={r.id} row={r} currency={currency} />)}
            </tbody>
          </table>
          <div ref={sentinel} className="h-px" />
          {items.isFetchingNextPage && (
            <p className="flex items-center justify-center gap-1.5 py-2 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading more…
            </p>
          )}
        </div>
      )}
    </SubScreen>
  );
}

function SyncRow({ row, currency }: { row: SyncItemRow; currency: string }) {
  const sign = row.direction === "in" ? "+" : row.direction === "out" ? "−" : "";
  return (
    <tr>
      <td className="px-3 py-2">
        <p className="truncate text-foreground" title={row.description}>{row.description}</p>
        {row.customer_name && <p className="truncate text-[11px] text-muted-foreground">{row.customer_name}</p>}
      </td>
      <td className={cn("px-2 py-2 text-right tabular-nums", row.direction === "out" ? "text-red-600 dark:text-red-400" : "text-foreground")}>
        {sign && <span aria-hidden className="mr-0.5 text-muted-foreground">{sign}</span>}
        {formatCurrency(Number(row.amount), row.currency || currency)}
      </td>
      <td className="px-2 py-2 text-muted-foreground">{format(new Date(row.occurred_at), "d MMM")}</td>
      <td className="px-3 py-2 text-right"><SyncPill row={row} /></td>
    </tr>
  );
}

const PILL: Record<SyncItemRow["status"], { label: string; cls: string }> = {
  sent: { label: "Sent", cls: "panel-ink-success border-success/30 bg-success/10" },
  waiting: { label: "Waiting", cls: "border-border bg-muted/40 text-muted-foreground" },
  failed: { label: "Failed", cls: "panel-ink-warn border-warning/30 bg-warning/10" },
};

function SyncPill({ row }: { row: SyncItemRow }) {
  const p = PILL[row.status];
  const pill = (
    <span className={cn("panel-text inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none", p.cls)}>
      {p.label}
    </span>
  );
  const tip = row.status === "failed"
    ? `${row.last_error ?? "Failed with no reason recorded."} · retrying automatically (${row.attempts} attempt${row.attempts === 1 ? "" : "s"})`
    : row.status === "waiting" && row.last_error
      ? row.last_error
      : row.status === "sent" && row.sent_at ? `Sent ${fmtAgo(row.sent_at)}` : null;
  if (!tip) return pill;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span tabIndex={0} className="cursor-default">{pill}</span></TooltipTrigger>
      <TooltipContent side="left" className="max-w-[18rem] text-xs">{tip}</TooltipContent>
    </Tooltip>
  );
}

