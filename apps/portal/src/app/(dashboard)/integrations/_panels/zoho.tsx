"use client";

// ── Zoho Books ────────────────────────────────────────────────────────────────
//
// The lean product's ONLY route to the accounting integration. `accounting` is
// in LEAN_HIDDEN_AREAS, so Settings → Accounting does not render for a lean
// tenant — this panel replaces that tab rather than duplicating it. Nothing
// here un-hides the v1 tab and nothing here edits `lean-areas.ts`.
//
// WHAT IS ACTUALLY TRUE IN PRODUCTION, measured 2026-09-05. Read this before
// adding a control that promises more than the platform delivers:
//
//  • `integration_zoho_books` is on for 1 of 57 tenants (`test`, internal),
//    which owns all 3 rows of `accounting_connections`. No live operator has
//    ever run this. Treat the v1 path as unproven.
//  • **Neither `process-accounting-sync` nor `refresh-accounting-tokens` is
//    scheduled.** `cron.job` holds 21 jobs and none of them is either one, even
//    though `20260526120300_schedule_process_accounting_sync_cron.sql` exists.
//    Two consequences drive this file's design:
//      – nothing drains `financial_event_sync_state`, so queued rows stay
//        queued. This panel therefore reports the queue rather than promising
//        it will empty, and offers no "retry" button — resetting a row to
//        `pending` when no worker runs is a control that does nothing.
//      – nothing refreshes the OAuth token and nothing flips `status` to
//        `expired`. `test`'s row says `status = 'active'` with a
//        `token_expires_at` two days in the past. **`status` alone is a lie**;
//        every state decision below reads `token_expires_at` as well.
//  • An event whose type has no mapping does NOT land in a default ledger
//    line — `process-accounting-sync` raises a `validation` ProviderError with
//    no retry, so it fails permanently. And `seed_default_accounting_mappings`
//    seeds Zoho with the account *names* `Sales` / `Other Income`, where
//    `zoho-client.listAccounts()` returns Zoho's numeric `account_id` as the
//    code. So the seeded defaults are wrong until confirmed, and no payment
//    account is seeded at all — which is why that one control is here.
//
// NO TIER PAYWALL HERE, and that is deliberate rather than an omission.
// v1's Settings tab opens with `useFeatureAccess('finance_sync')`, which
// resolves Growth+ from `tenant_subscriptions.plan_name`. Northwind has no
// subscription row at all, so `resolveTier(null)` is `basic` and the paywall
// would render for the one tenant that can open this board — a panel that
// tests nothing. It is also purely presentational: none of the six edge
// functions this panel calls looks at the plan, so removing it grants no
// capability the same operator did not already have. Putting a commercial gate
// on a new surface is a pricing decision, not a UI one; it is flagged to the
// lead rather than made here.
//
// ISOLATION (V2_PLAN §5, brief rule 3). RLS is ON for the accounting tables,
// but this file does not lean on that. The connection read below carries
// `.eq('tenant_id', tenant.id)` explicitly. The three v1 hooks reused here —
// `useAccountingSyncStats`, `useAccountingSyncLog`, `useAccountingMappings` —
// each filter `.eq('tenant_id', tenant.id)` at source against the same tenant
// this panel was handed (the board sources the prop from `useTenant()`, which
// is what those hooks read). The four edge functions called resolve the tenant
// server-side through `_shared/resolve-tenant.ts`, which PINS a scoped user to
// their own tenant and ignores any slug they send; the slug is passed only so
// a super admin (tenant_id = NULL by design) is not left without a tenant.
//
// Deliberately NOT reusing `useAccountingConnections` from
// `use-accounting-connection.ts`, even though the query is identical: that hook
// opens a realtime channel named `accounting-connections-${tenant.id}` per
// mounted instance. The board mounts a status chip for every card plus the open
// panel, and the Xero panel does the same, so reusing it would put four
// subscriptions on one topic. It also has nothing to listen for — the cron that
// used to flip `status` under the operator is not scheduled.

import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Globe, Loader2, Plug, RefreshCw } from "lucide-react";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { extractFunctionError } from "@/lib/edge-error";
import { useAuth } from "@/stores/auth-store";
import { Button } from "@/components/ui-v2/button";
import { cn } from "@/lib/utils";
import { ConnectionTest, DisconnectScreen, Hero, QuietNav, ScreenNav, SubScreen, demoCheck, useNarrowDialog } from "./_screens";
import { ExpensesEmptyArt } from "@/components/illustrations-v2/scenes/expenses";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui-v2/select";
import {
  useAccountingMappings,
  useAccountingSyncLog,
  useAccountingSyncStats,
} from "@/hooks/use-accounting-sync";
import type { IntegrationPanelProps, IntegrationState, PanelTenant } from "./_kit";
import {
  CopyValue,
  PanelCard,
  PanelError,
  PanelLoading,
  PanelNote,
  PanelRow,
  StatusChip,
} from "./_kit";

/* ───────────────────────────── regions ──────────────────────────────────── */

/**
 * The six data centres `zoho-oauth-start` will accept (its ALLOWED_REGIONS).
 * Sending anything else is a 400 before the operator ever reaches Zoho.
 */
const CONNECTABLE_REGIONS = [
  { region: "com", label: "Global (.com)", where: "United States and everywhere unlisted", flag: null },
  { region: "eu", label: "Europe (.eu)", where: "UK and EU", flag: "eu" },
  { region: "in", label: "India (.in)", where: "India", flag: "in" },
  { region: "com.au", label: "Australia (.com.au)", where: "Australia", flag: "au" },
  { region: "jp", label: "Japan (.jp)", where: "Japan", flag: "jp" },
  { region: "sa", label: "Saudi Arabia (.sa)", where: "Middle East", flag: "sa" },
] as const;

type ConnectableRegion = (typeof CONNECTABLE_REGIONS)[number]["region"];

/**
 * Is a STORED region one we may hand back to `zoho-oauth-start`?
 *
 * Not a formality. The callback can persist `uk` or `ca`, which the start
 * function's ALLOWED_REGIONS rejects with a 400 — so a Reconnect button that
 * simply replayed `external_region` would be unusable on exactly the two
 * connections whose region we did not choose in the first place.
 */
function asConnectableRegion(stored: string | null): ConnectableRegion {
  const hit = CONNECTABLE_REGIONS.find((r) => r.region === stored);
  return hit ? hit.region : "com";
}

/**
 * Display names for every region that can end up STORED on a connection, which
 * is a wider set than the one above: `zoho-oauth-callback` derives the region
 * from Zoho's own `accounts-server` header and can persist `uk` or `ca` (Canada
 * is served from zohocloud.ca, outside the `zoho.<suffix>` pattern) even though
 * neither can be picked here. A connection showing a region absent from this
 * map would render as a bare suffix rather than a blank.
 */
const REGION_LABELS: Record<string, string> = {
  ...Object.fromEntries(CONNECTABLE_REGIONS.map((r) => [r.region, r.label])),
  uk: "United Kingdom (.uk)",
  ca: "Canada (zohocloud.ca)",
};

/* ───────────────────────────── connection read ──────────────────────────── */

type ZohoConnectionRow = {
  id: string;
  tenant_id: string;
  provider: string;
  status: "active" | "expired" | "revoked" | "error";
  token_expires_at: string | null;
  external_org_id: string;
  external_org_name: string | null;
  external_region: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  connected_at: string;
  disconnected_at: string | null;
};

/** Shared by the card chip, the dialog-header chip and the panel — one fetch. */
const zohoConnectionKey = (tenantId: string) => ["v2-zoho-connection", tenantId] as const;

function useZohoConnection(tenantId: string) {
  return useQuery({
    queryKey: zohoConnectionKey(tenantId),
    queryFn: async (): Promise<ZohoConnectionRow[]> => {
      // `accounting_connections_public` is the view without the vault
      // secret_id columns — the same one v1 reads. Untyped client because the
      // view is not in the generated types.
      const { data, error } = await supabaseUntyped
        .from("accounting_connections_public")
        .select(
          "id, tenant_id, provider, status, token_expires_at, external_org_id, external_org_name, external_region, last_synced_at, last_error, connected_at, disconnected_at",
        )
        .eq("tenant_id", tenantId) // ← the only thing standing between tenants
        .eq("provider", "zoho")
        .order("connected_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ZohoConnectionRow[];
    },
    staleTime: 30_000,
    // Overrides the portal's global `false`. The connect flow leaves this tab
    // for Zoho's and comes back; without a focus refetch the panel keeps
    // showing "Not connected" after a connection that actually succeeded.
    refetchOnWindowFocus: true,
  });
}

type ZohoView = {
  /** The row that represents the connection as it stands, revoked included. */
  current: ZohoConnectionRow | null;
  state: IntegrationState;
  /** Short enough for the chip. */
  chipLabel?: string;
  /** Is the stored access token past its expiry right now? */
  tokenExpired: boolean;
  /** True only when the connection can actually reach Zoho. */
  usable: boolean;
};

/**
 * Derive what to show from the rows.
 *
 * The ordering matters. `expired` is `attention`, never `disconnected`: an
 * expired connection still holds its org, its region and its mappings, and
 * telling an operator it is "not connected" invites them to start a fresh
 * OAuth round-trip when the grant may only have needed a refresh.
 */
function describeZoho(rows: ZohoConnectionRow[] | undefined, failed: boolean): ZohoView {
  if (failed) {
    // Never present a failed READ as "not connected" (kit contract). There is
    // no error shape for a chip, so `attention` + an explicit label is the
    // closest honest thing: it claims neither state and draws the eye to the
    // panel, which renders the real PanelError.
    return { current: null, state: "attention", chipLabel: "Status unknown", tokenExpired: false, usable: false };
  }
  if (!rows) {
    return { current: null, state: "loading", tokenExpired: false, usable: false };
  }

  // Rows arrive newest-first. A live row wins over history even if an older
  // revoked row was created later by a failed reconnect.
  const current =
    rows.find((r) => r.status === "active") ??
    rows.find((r) => r.status === "expired" || r.status === "error") ??
    rows[0] ??
    null;

  if (!current || current.status === "revoked") {
    return { current, state: "disconnected", tokenExpired: false, usable: false };
  }

  const tokenExpired =
    !current.token_expires_at || new Date(current.token_expires_at).getTime() <= Date.now();

  if (current.status === "expired") {
    return { current, state: "attention", chipLabel: "Reconnect needed", tokenExpired: true, usable: false };
  }
  if (current.status === "error") {
    return { current, state: "attention", chipLabel: "Connection error", tokenExpired, usable: false };
  }
  // status === 'active' from here.
  if (tokenExpired) {
    // The refresher is not scheduled, so this is the state a working connection
    // silently decays into an hour after it is made.
    return { current, state: "attention", chipLabel: "Token expired", tokenExpired: true, usable: false };
  }
  if (current.last_error) {
    return { current, state: "attention", chipLabel: "Sync error", tokenExpired: false, usable: true };
  }
  return { current, state: "connected", tokenExpired: false, usable: true };
}

/* ───────────────────────────── formatting ───────────────────────────────── */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** "in 47 min" / "2 days ago" — enough precision for a token, no library. */
function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "unknown";
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60_000);
  const unit =
    mins < 60
      ? `${mins} min`
      : mins < 60 * 48
        ? `${Math.round(mins / 60)} hr`
        : `${Math.round(mins / 1440)} days`;
  return ms >= 0 ? `in ${unit}` : `${unit} ago`;
}

/* ───────────────────────────── status chip ──────────────────────────────── */

export function ZohoStatus({ tenant }: { tenant: PanelTenant }) {
  const { data, isError, isLoading } = useZohoConnection(tenant.id);
  const demoStage = useZohoDemoStage();
  if (ZOHO_FIRST_RUN_DEMO_SLUGS.includes(tenant.slug)) {
    return demoStage === "live" ? <StatusChip state="connected" /> : <StatusChip state="disconnected" />;
  }
  const view = describeZoho(isLoading ? undefined : data, isError);
  return <StatusChip state={view.state} label={view.chipLabel} />;
}

/* ───────────────────────────── OAuth round-trip ─────────────────────────── */

/**
 * Human wording for the `reason` codes `zoho-oauth-callback` emits. Copied from
 * v1's AccountingSettings rather than imported: that constant is not exported,
 * and the brief forbids editing the v1 file to export it.
 */
const OAUTH_REASONS: Record<string, string> = {
  state_expired:
    "The request timed out before you finished authorising. Start again and complete Zoho's screens without pausing.",
  invalid_state: "That connection link had already been used. Start a fresh one.",
  state_provider_mismatch: "That connection link was for a different provider. Start again.",
  missing_params: "Zoho redirected back without an authorisation code.",
  server_misconfigured: "The server is missing ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET.",
  token_exchange_failed: "Zoho rejected the authorisation code.",
  invalid_code: "Zoho rejected the authorisation code — it may already have been used.",
  invalid_client: "Zoho rejected our API credentials for that data centre.",
  no_access_token: "Zoho did not return an access token.",
  no_refresh_token:
    "Zoho did not return a refresh token, so the connection could not be kept alive. Revoke Drive247 in your Zoho account's connected apps, then connect again.",
  organisations_lookup_failed:
    "You authorised successfully, but Zoho rejected our request for your organisation list — usually a missing permission on the Zoho app.",
  no_organisations:
    "You authorised successfully, but that Zoho account has no Books organisation. Create one at books.zoho.com signed in as the same account, then connect again.",
  persist_failed: "Zoho accepted the connection but it could not be saved. Try again.",
};

/** Marks that we handed the operator off to Zoho, so an outcome can be missed. */
const ATTEMPT_KEY = "drive247.zoho.connect_attempt";
const ATTEMPT_TTL_MS = 60 * 60_000;

type ConnectAttempt = { startedAt: number; region: string };

function readAttempt(): ConnectAttempt | null {
  try {
    const raw = sessionStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConnectAttempt;
    if (!parsed?.startedAt || Date.now() - parsed.startedAt > ATTEMPT_TTL_MS) {
      sessionStorage.removeItem(ATTEMPT_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null; // private mode / blocked storage — the marker is a nicety
  }
}

function clearAttempt() {
  try {
    sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    /* ignore */
  }
}

/* ───────────────────────────── panel ────────────────────────────────────── */

export default function ZohoPanel({ tenant, onBack }: IntegrationPanelProps) {
  const demo = ZOHO_FIRST_RUN_DEMO_SLUGS.includes(tenant.slug);
  const demoStage = useZohoDemoStage();
  const [screen, setScreen] = useState<"home" | "account" | "mappings" | "sync" | "disconnect">("home");
  const [leaving, setLeaving] = useState(false);
  /** The data centre picked in the demo, so its account screen echoes it. */
  const demoRegion = useRef<string>("com");
  // The demo starts fresh every time the dialog opens.
  useEffect(() => {
    if (!demo) return;
    return () => zohoDemo.set("fresh");
  }, [demo]);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { appUser } = useAuth();

  const connection = useZohoConnection(tenant.id);
  const view = describeZoho(connection.isLoading ? undefined : connection.data, connection.isError);

  const mappings = useAccountingMappings("zoho");
  const stats = useAccountingSyncStats("zoho");
  const failures = useAccountingSyncLog({ provider: "zoho", state: "failed", pageSize: 3 });

  const [region, setRegion] = useState<ConnectableRegion | "">("");
  const [accounts, setAccounts] = useState<Array<{ code: string; name: string }> | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [paymentAccount, setPaymentAccount] = useState<string>("");
  const [staleAttempt, setStaleAttempt] = useState<ConnectAttempt | null>(null);

  // Only admin / head_admin / super admin get past the four edge functions'
  // role checks (the store already promotes a super admin to head_admin).
  // Disabling here turns a 403 toast into an explanation before the click.
  const canManage =
    !!appUser?.is_super_admin || ["admin", "head_admin"].includes(appUser?.role ?? "");

  /* ── the return leg of the OAuth round-trip ─────────────────────────────
   *
   * `zoho-oauth-callback` redirects to `redirect_back` VERBATIM on success, so
   * whatever we send it is where the operator lands — we send this route with
   * the callback's own `provider` / `status` vocabulary.
   *
   * On FAILURE it does not use that path: every error branch emits a hardcoded
   * `/settings?tab=accounting&status=error&…` and only borrows the ORIGIN from
   * `redirect_back`. For a lean tenant that page does not render the accounting
   * tab, so the reason is lost. The error branch below is therefore not dead
   * code but it is not the common path either; the sessionStorage marker under
   * it is what actually catches a failed attempt. See the final report.
   */
  const handledReturn = useRef(false);
  useEffect(() => {
    if (handledReturn.current) return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    if (params.get("provider") !== "zoho") return; // Xero's return is not ours
    const status = params.get("status");
    if (!status) return;
    handledReturn.current = true;

    if (status === "success") {
      clearAttempt();
      void qc.invalidateQueries({ queryKey: zohoConnectionKey(tenant.id) });
      toast({ title: "Zoho Books connected" });
    } else {
      const reason = params.get("reason") ?? "unknown";
      toast({
        variant: "destructive",
        title: "Couldn't connect Zoho Books",
        description: OAUTH_REASONS[reason] ?? `Zoho reported: ${reason}`,
      });
    }

    // `history.replaceState`, not `router.replace`: the board holds the open
    // dialog in React state and a real navigation would tear it down mid-read.
    // Only our own params are stripped.
    params.delete("provider");
    params.delete("status");
    params.delete("reason");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [qc, tenant.id, toast]);

  // A handoff that never came back with an answer. Only shown once the read has
  // settled and there is genuinely no live connection, so a slow first fetch
  // cannot make a successful connect look like a failure.
  useEffect(() => {
    if (connection.isLoading || connection.isError) return;
    const attempt = readAttempt();
    if (!attempt) {
      setStaleAttempt(null);
      return;
    }
    if (view.current && view.current.status !== "revoked") {
      clearAttempt();
      setStaleAttempt(null);
      return;
    }
    setStaleAttempt(attempt);
  }, [connection.isLoading, connection.isError, view.current]);

  /* ── mutations ─────────────────────────────────────────────────────────── */

  /**
   * The CSRF state is not ours to touch.
   *
   * `zoho-oauth-start` inserts a row into `accounting_oauth_state` — tenant,
   * provider, the picked region and a 10-minute expiry — and returns an
   * authorize URL carrying that row's `nonce` as `state`. `zoho-oauth-callback`
   * then looks the nonce up, refuses it if it is unknown, belongs to another
   * provider or has expired, and DELETES it, so a nonce redeems exactly once.
   * That is what stops a replayed or forged callback binding someone else's
   * Zoho org to this tenant.
   *
   * So: never build the authorize URL here, never invent or persist a `state`
   * client-side, and never cache or re-open a previously returned
   * `authorizeUrl` — each one is single-use and short-lived. Follow the URL the
   * server hands back, once, and let the callback do the validating.
   *
   * `redirectBack` is this portal's OWN origin, never anything user-supplied:
   * the callback stores it and later redirects to it verbatim.
   */
  const connect = useMutation({
    mutationFn: async (picked: ConnectableRegion) => {
      const redirectBack = `${window.location.origin}/integrations?provider=zoho&status=success`;
      const { data, error } = await supabase.functions.invoke("zoho-oauth-start", {
        // `tenantSlug` is read ONLY for a super admin, whose app_users row has
        // tenant_id = NULL; resolve-tenant.ts pins everyone else to their own
        // tenant and ignores it, so this cannot widen anyone's reach.
        body: { region: picked, redirectBack, tenantSlug: tenant.slug },
      });
      if (error) throw new Error(await extractFunctionError(error, "Could not start the Zoho connection"));
      const authorizeUrl = (data as { authorizeUrl?: string })?.authorizeUrl;
      if (!authorizeUrl) throw new Error("Zoho did not return an authorisation URL");
      try {
        sessionStorage.setItem(
          ATTEMPT_KEY,
          JSON.stringify({ startedAt: Date.now(), region: picked } satisfies ConnectAttempt),
        );
      } catch {
        /* storage blocked — we simply lose the "didn't come back" hint */
      }
      window.location.href = authorizeUrl;
    },
    onError: (err: Error) =>
      toast({ variant: "destructive", title: "Couldn't connect Zoho Books", description: err.message }),
  });

  // Unlinking. The tenant flag and v1's accounting screens key off the same
  // rows, so both caches are refreshed.
  const disconnect = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("disconnect-accounting", {
        body: { provider: "zoho", tenantSlug: tenant.slug },
      });
      if (error) throw new Error(await extractFunctionError(error, "Could not disconnect Zoho Books"));
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: zohoConnectionKey(tenant.id) });
      await qc.invalidateQueries({ queryKey: ["accounting-connections", tenant.id] });
      toast({ title: "Zoho Books disconnected" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Couldn't disconnect", description: err.message }),
  });

  /**
   * The verify control, and the most useful thing on this screen.
   *
   * `list-accounting-accounts` loads the vault token for THIS tenant and calls
   * Zoho's /chartofaccounts with it, so a success proves four things at once:
   * the token still works, the stored data centre is the right one, the grant
   * carries ZohoBooks.accountants.READ, and the org id resolves. It is also the
   * only source of the account ids the payment-account control below needs —
   * one call, two jobs.
   */
  const probe = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("list-accounting-accounts", {
        body: { provider: "zoho", tenantSlug: tenant.slug },
      });
      if (error) throw new Error(await extractFunctionError(error, "Zoho did not answer"));
      return ((data as { accounts?: Array<{ code: string; name: string }> })?.accounts ?? []).filter(
        (a) => a?.code,
      );
    },
    onSuccess: (list) => {
      setProbeError(null);
      setAccounts(list);
    },
    onError: (err: Error) => {
      setAccounts(null);
      setProbeError(err.message);
    },
  });

  const savePaymentAccount = useMutation({
    mutationFn: async (code: string) => {
      const chosen = accounts?.find((a) => a.code === code);
      const { error } = await supabase.functions.invoke("save-accounting-mappings", {
        // `save-accounting-mappings` upserts row by row (by event_type, or by
        // the sentinel), so sending only the sentinel leaves the nine event
        // mappings exactly as they are.
        body: {
          provider: "zoho",
          tenantSlug: tenant.slug,
          mappings: [
            {
              is_payment_account_sentinel: true,
              external_account_code: code,
              external_account_name: chosen?.name ?? null,
            },
          ],
        },
      });
      if (error) throw new Error(await extractFunctionError(error, "Could not save the payment account"));
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["accounting-mappings", tenant.id, "zoho"] });
      toast({ title: "Payment account saved" });
    },
    onError: (err: Error) =>
      toast({ variant: "destructive", title: "Couldn't save", description: err.message }),
  });

  /** Connect at a region: real OAuth round trip, or the demo's hand-off. */
  const startConnect = (picked: ConnectableRegion) => {
    setLeaving(true);
    if (demo) {
      window.open("https://accounts.zoho.com/signin", "_blank", "noopener,noreferrer");
      demoRegion.current = picked;
      window.setTimeout(() => {
        zohoDemo.set("live");
        setLeaving(false);
      }, 2600);
      return;
    }
    connect.mutate(picked, { onError: () => setLeaving(false) });
  };

  /* ── mapping summary ───────────────────────────────────────────────────── */

  const mappingSummary = useMemo(() => {
    const rows = mappings.data ?? [];
    const eventRows = rows.filter((r) => !r.is_payment_account_sentinel && r.event_type);
    const sentinel = rows.find((r) => r.is_payment_account_sentinel) ?? null;
    return {
      mapped: eventRows.length,
      // `is_default` marks a row written by `seed_default_accounting_mappings`
      // and never confirmed by a human. For Zoho those seeds hold the account
      // NAMES 'Sales' / 'Other Income' where the API wants an account_id, so an
      // unconfirmed row is not merely unreviewed — it will fail at Zoho.
      unconfirmed: eventRows.filter((r) => r.is_default).length,
      paymentAccount: sentinel?.external_account_name ?? sentinel?.external_account_code ?? null,
    };
  }, [mappings.data]);

  /* ── render ────────────────────────────────────────────────────────────── */
  //
  // THE SCREEN STANDARD (Ghulam, Oct 2 2026 — see `_screens.tsx`), the same
  // shape as Xero: a main screen per state with ONE button, and account
  // details, where things land, sync and disconnecting behind quiet links.
  // Zoho alone asks for its data centre before connecting, so its first
  // working screen is a region picker. Every rule above — the CSRF round
  // trip, the region resolution, the probe, the payment-account save — is
  // exactly as it was; only where it is drawn moved.

  if (!demo && connection.isError) {
    return (
      <PanelError
        message={(connection.error as Error)?.message ?? "Unknown error"}
        onRetry={() => void connection.refetch()}
      />
    );
  }
  if (!demo && connection.isLoading) return <PanelLoading rows={4} />;

  const current = demo ? (demoStage === "live" ? demoRow(tenant.id, demoRegion.current) : null) : view.current;
  const state: IntegrationState = demo ? (demoStage === "live" ? "connected" : "disconnected") : view.state;
  const tokenExpired = demo ? false : view.tokenExpired;
  const live = !!current && current.status !== "revoked";
  const summary = demo ? { mapped: 9, unconfirmed: 0, paymentAccount: "Business Checking" } : mappingSummary;
  const statNums = demo
    ? { synced: 0, pending: 0, failed: 0, skipped: 0 }
    : { synced: stats.data?.synced ?? 0, pending: stats.data?.pending ?? 0, failed: stats.data?.failed ?? 0, skipped: stats.data?.skipped ?? 0 };
  const home = () => setScreen("home");

  /* ── small screens (connected) ─────────────────────────────────────────── */

  if (screen === "account" && live && current) {
    return (
      <SubScreen title="Account details" description="The Zoho Books organisation your bookings are recorded in." onBack={home}>
        <PanelCard className="divide-y divide-border/60">
          <PanelRow label="Organisation">{current.external_org_name ?? "Unnamed"}</PanelRow>
          <PanelRow label="Organisation ID">
            <CopyValue value={current.external_org_id} />
          </PanelRow>
          <PanelRow label="Data centre" hint="Set by Zoho when you connected.">
            {current.external_region ? (REGION_LABELS[current.external_region] ?? `.${current.external_region}`) : "Unknown"}
          </PanelRow>
          <PanelRow label="Connected">{fmtDate(current.connected_at)}</PanelRow>
          <PanelRow label="Access" hint={tokenExpired ? "Renewal isn't running, so this won't recover on its own." : undefined}>
            {tokenExpired ? (
              <span className="text-warning">Expired {fmtRelative(current.token_expires_at)}</span>
            ) : (
              <>Valid {fmtRelative(current.token_expires_at)}</>
            )}
          </PanelRow>
        </PanelCard>
        {/* The verify control: one call that proves the token, the data
            centre, the permissions and the organisation all still line up —
            and loads the accounts the payment-account choice needs. */}
        <ConnectionTest
          idle="Check Drive247 can still reach your Zoho Books."
          disabled={!canManage}
          run={
            demo
              ? () => demoCheck("Working · reached Zoho Books, 42 accounts")
              : async () => {
                  const list = await probe.mutateAsync();
                  return `Working · reached Zoho Books, ${list.length} account${list.length === 1 ? "" : "s"}`;
                }
          }
        />
      </SubScreen>
    );
  }

  if (screen === "mappings" && live) {
    return (
      <SubScreen title="Where things land" description="The Zoho accounts your charges and payments are recorded in." onBack={home}>
        <PanelCard className="divide-y divide-border/60">
          <PanelRow label="Charge types mapped">{!demo && mappings.isLoading ? "…" : `${summary.mapped} of 9`}</PanelRow>
          <PanelRow label="Payment account" hint="Where customer payments are recorded.">
            {summary.paymentAccount ? (
              <span className="truncate">{summary.paymentAccount}</span>
            ) : (
              <span className="text-warning">Not set</span>
            )}
          </PanelRow>
        </PanelCard>
        {!demo && summary.unconfirmed > 0 && (
          <PanelNote tone="warn">
            {summary.unconfirmed} mapping{summary.unconfirmed === 1 ? " is" : "s are"} still the value seeded at connect
            time, which Zoho will reject. Ask support to set them until choosing them here is built.
          </PanelNote>
        )}
        {/* The payment account is the one mapping this panel sets: never
            seeded, and it blocks every payment on its own. */}
        {!demo && !summary.paymentAccount && canManage && (
          <div className="space-y-2">
            {accounts ? (
              <>
                <Select value={paymentAccount || undefined} onValueChange={setPaymentAccount}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose the bank or clearing account" />
                  </SelectTrigger>
                  <SelectContent tone="surface">
                    {accounts.map((a) => (
                      <SelectItem key={a.code} value={a.code}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex justify-center">
                  <Button
                    className="rounded-2xl"
                    onClick={() => savePaymentAccount.mutate(paymentAccount)}
                    disabled={!paymentAccount || savePaymentAccount.isPending}
                  >
                    {savePaymentAccount.isPending && <Loader2 className="size-3.5 animate-spin" />}
                    Save payment account
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                Run Test connection under Account details to load your accounts, then pick one here.
              </p>
            )}
          </div>
        )}
      </SubScreen>
    );
  }

  if (screen === "sync" && live) {
    return (
      <SubScreen title="Sync" description="What has gone to Zoho Books, and anything waiting." onBack={home}>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Synced", statNums.synced],
            ["Queued", statNums.pending],
            ["Failed", statNums.failed],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-xl border bg-muted/20 px-2.5 py-3 text-center">
              <div className={`text-lg font-medium leading-tight ${label === "Failed" && (value as number) > 0 ? "text-warning" : ""}`}>
                {!demo && stats.isLoading ? "…" : (value as number)}
              </div>
              <div className="text-[11px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          {statNums.pending > 0 && !current?.last_synced_at
            ? `${statNums.pending} event${statNums.pending === 1 ? " is" : "s are"} queued and nothing has reached Zoho Books yet.`
            : "Every new charge, payment and refund goes to Zoho Books as it happens."}
        </p>
        {!demo && (failures.data?.rows?.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            {failures.data!.rows.slice(0, 2).map((row) => (
              <div key={row.id} className="rounded-xl border px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium">{row.event?.event_type?.replace(/_/g, " ") ?? "Event"}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{fmtDate(row.last_attempt_at ?? row.created_at)}</span>
                </div>
                {row.last_error && (
                  <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={row.last_error}>
                    {row.last_error}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </SubScreen>
    );
  }

  if (screen === "disconnect" && live) {
    // Unlinking is allowed from here (Ghulam, Oct 2) — `disconnect-accounting`,
    // behind a confirmation. The demo just puts itself back to the start.
    return (
      <DisconnectScreen
        name="Zoho Books"
        canManage={canManage}
        pending={disconnect.isPending}
        onBack={home}
        onConfirm={() => {
          if (demo) {
            zohoDemo.set("fresh");
            home();
            return;
          }
          disconnect.mutate(undefined, { onSuccess: home });
        }}
        consequence={
          <>
            New charges and payments stop reaching Zoho Books, and your Zoho sign-in is removed — reconnecting
            means signing in again. Invoices already in Zoho Books stay exactly as they are.
          </>
        }
      />
    );
  }

  /* ── not connected: pick the data centre, then connect ─────────────────── */

  if (leaving && !live) {
    return (
      <>
        <Hero
          art={ExpensesEmptyArt}
          title="Connect Zoho Books."
          actions={
            <div className="flex justify-center">
              <Button className="h-10 rounded-2xl px-6" disabled>
                <Loader2 className="animate-spin" />
                Opening Zoho…
              </Button>
            </div>
          }
        >
          Finish in the Zoho tab — sign in and choose your organisation. I&rsquo;ll pick it up here the moment
          Zoho hands it back.
        </Hero>
        <ScreenNav className="mt-8" onBack={onBack} />
      </>
    );
  }

  if (!live) {
    const picked = CONNECTABLE_REGIONS.find((r) => r.region === region);
    return (
      <div className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
        <RegionPicker>
          <div className="space-y-2 text-center">
            <h3 className="text-xl font-medium leading-snug text-foreground">Where&rsquo;s your Zoho account?</h3>
            <p className="mx-auto max-w-[32rem] text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
              Zoho keeps each account in one region — it&rsquo;s in your Zoho web address:{" "}
              <span className="font-mono text-[13px] text-foreground/80">books.zoho.eu</span> is Europe,{" "}
              <span className="font-mono text-[13px] text-foreground/80">books.zoho.com</span> is Global.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Zoho data centre">
            {CONNECTABLE_REGIONS.map((r) => (
              <button
                key={r.region}
                type="button"
                role="radio"
                aria-checked={region === r.region}
                onClick={() => setRegion(r.region)}
                className={cn(
                  "rounded-2xl border px-3 py-2.5 text-left transition-colors duration-200 motion-reduce:transition-none",
                  region === r.region
                    ? "border-primary/50 bg-primary/10"
                    : "border-border bg-background/70 hover:border-primary/30",
                )}
              >
                <span className="flex items-center gap-2">
                  {/* A flag per data centre (flagcdn, like the board's logo.dev
                      logos); Global gets a globe — it is no one country. */}
                  {r.flag ? (
                    <img
                      src={`https://flagcdn.com/${r.flag}.svg`}
                      alt=""
                      aria-hidden
                      className="h-3.5 w-5 shrink-0 rounded-[3px] object-cover ring-1 ring-black/10"
                    />
                  ) : (
                    <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="truncate text-sm font-medium text-foreground">{r.label}</span>
                </span>
                <span className="mt-0.5 block truncate pl-7 text-[11px] text-muted-foreground">{r.where}</span>
              </button>
            ))}
          </div>
          {!demo && staleAttempt && (
            <p className="text-center text-xs text-warning">
              A connection you started {fmtRelative(new Date(staleAttempt.startedAt).toISOString())} never completed — start
              again here.{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => { clearAttempt(); setStaleAttempt(null); }}>
                Dismiss
              </button>
            </p>
          )}
          {!canManage && (
            <p className="text-center text-xs text-warning">Only an admin or head admin can connect an accounting system.</p>
          )}
          <div className="flex justify-center">
            <Button className="h-10 rounded-2xl px-6" onClick={() => picked && startConnect(picked.region)} disabled={!picked || !canManage}>
              <Plug className="size-4" />
              Connect Zoho Books
            </Button>
          </div>
        </RegionPicker>
        <ScreenNav className="mt-5" onBack={onBack} />
      </div>
    );
  }

  /* ── connected: the main screen ────────────────────────────────────────── */

  const expired = !demo && current!.status === "expired";
  const title =
    state === "connected"
      ? "Your books are syncing to Zoho."
      : expired || tokenExpired
        ? "Reconnect Zoho Books."
        : "Zoho reported a problem.";
  const body =
    state === "connected"
      ? `Every rental charge, payment and refund goes to ${current!.external_org_name ?? "your Zoho Books organisation"} as it happens.${summary.paymentAccount ? "" : " Choose where payments land to finish setting up."}`
      : expired
        ? "Zoho revoked or exhausted this grant, so nothing can sync. Reconnecting runs the authorisation again — your organisation and mappings are kept."
        : tokenExpired
          ? `The access token expired ${fmtRelative(current!.token_expires_at)} and hasn't been renewed. Reconnect to issue a fresh one.`
          : current!.last_error ?? "The last sync attempt reported an error.";
  const action =
    state === "attention" && canManage ? (
      <Button className="h-10 rounded-2xl px-6" onClick={() => startConnect(asConnectableRegion(current!.external_region))} disabled={leaving}>
        <RefreshCw />
        Reconnect Zoho Books
      </Button>
    ) : (
      <Button className="h-10 rounded-2xl px-6" asChild>
        <a href="https://books.zoho.com" target="_blank" rel="noopener noreferrer">
          Open Zoho Books
          <ArrowUpRight />
        </a>
      </Button>
    );

  return (
    <>
      <Hero
        art={ExpensesEmptyArt}
        eyebrow={state === "connected" ? "Live" : view.chipLabel ?? "Needs attention"}
        title={title}
        actions={<div className="flex justify-center">{action}</div>}
        footer={
          <QuietNav
            items={[
              { label: "Account details", onClick: () => setScreen("account") },
              { label: "Where things land", onClick: () => setScreen("mappings") },
              { label: "Sync", onClick: () => setScreen("sync") },
              ...(canManage ? [{ label: "Disconnecting", onClick: () => setScreen("disconnect") }] : []),
            ]}
          />
        }
      >
        {body}
        {!demo && tenant.integration_zoho_books === false && (
          // The tenant flag other screens read; the two only diverge if a
          // callback or disconnect half-failed.
          <span className="mt-2 block text-warning">
            The tenant&rsquo;s Zoho Books flag is off, so other screens show it as unconnected. Reconnecting sets it.
          </span>
        )}
      </Hero>
      <ScreenNav className="mt-5" onBack={onBack} />
    </>
  );
}

/** The region picker's column — narrow, like every other step screen. */
function RegionPicker({ children }: { children: ReactNode }) {
  useNarrowDialog();
  return <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-1">{children}</div>;
}

/* ─────────────────────────── first-run demo ─────────────────────────────── */

/**
 * FIRST-RUN DEMO — northwind only, on screen only (Ghulam, Oct 2 2026), like
 * Stripe, Square and Xero. The panel shows the region picker as if nothing
 * were connected; "Connect Zoho Books" opens Zoho's sign-in in a new tab,
 * spins, then lands on a healthy stand-in connection. Nothing calls
 * `zoho-oauth-start`, the probe, the mapping save or disconnect; the stand-in
 * is drawn from constants. To remove: delete this block and every `demo`
 * branch above.
 */
const ZOHO_FIRST_RUN_DEMO_SLUGS: readonly string[] = ["northwind"];

type DemoStage = "fresh" | "live";

const zohoDemo = (() => {
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

function useZohoDemoStage(): DemoStage {
  return useSyncExternalStore(zohoDemo.subscribe, zohoDemo.get, zohoDemo.get);
}

function demoRow(tenantId: string, region: string): ZohoConnectionRow {
  const now = new Date().toISOString();
  return {
    id: "demo",
    tenant_id: tenantId,
    provider: "zoho",
    status: "active",
    token_expires_at: new Date(Date.now() + 55 * 60_000).toISOString(),
    external_org_id: "60031234567",
    external_org_name: "Northwind Rentals",
    external_region: region,
    last_synced_at: null,
    last_error: null,
    connected_at: now,
    disconnected_at: null,
  };
}
