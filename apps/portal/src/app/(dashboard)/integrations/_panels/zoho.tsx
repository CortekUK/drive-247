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

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Link2Off,
  Loader2,
  Plug,
  RefreshCw,
  Search,
} from "lucide-react";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { extractFunctionError } from "@/lib/edge-error";
import { useAuth } from "@/stores/auth-store";
import { Button } from "@/components/ui-v2/button";
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
  PanelSection,
  StatusChip,
} from "./_kit";

/* ───────────────────────────── regions ──────────────────────────────────── */

/**
 * The six data centres `zoho-oauth-start` will accept (its ALLOWED_REGIONS).
 * Sending anything else is a 400 before the operator ever reaches Zoho.
 */
const CONNECTABLE_REGIONS = [
  { region: "com", label: "Global (.com)", where: "United States and everywhere unlisted" },
  { region: "eu", label: "Europe (.eu)", where: "UK and EU" },
  { region: "in", label: "India (.in)", where: "India" },
  { region: "com.au", label: "Australia (.com.au)", where: "Australia" },
  { region: "jp", label: "Japan (.jp)", where: "Japan" },
  { region: "sa", label: "Saudi Arabia (.sa)", where: "Middle East" },
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

export default function ZohoPanel({ tenant, onClose }: IntegrationPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { appUser } = useAuth();
  // The prop carries the tenant ROW; `refetchTenant` lives on the context, and
  // `integration_zoho_books` is read from that row by other screens.
  const { refetchTenant } = useTenant();

  const connection = useZohoConnection(tenant.id);
  const view = describeZoho(connection.isLoading ? undefined : connection.data, connection.isError);

  const mappings = useAccountingMappings("zoho");
  const stats = useAccountingSyncStats("zoho");
  const failures = useAccountingSyncLog({ provider: "zoho", state: "failed", pageSize: 3 });

  const [region, setRegion] = useState<ConnectableRegion | "">("");
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
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

  const disconnect = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("disconnect-accounting", {
        body: { provider: "zoho", tenantSlug: tenant.slug },
      });
      if (error) throw new Error(await extractFunctionError(error, "Could not disconnect Zoho Books"));
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: zohoConnectionKey(tenant.id) });
      // v1's own accounting screens key off this; keeping it fresh stops the
      // Settings tab (still live for the other 56 tenants) reading a stale row.
      await qc.invalidateQueries({ queryKey: ["accounting-connections", tenant.id] });
      void refetchTenant?.();
      toast({ title: "Zoho Books disconnected" });
      setConfirmingDisconnect(false);
      onClose();
    },
    onError: (err: Error) =>
      toast({ variant: "destructive", title: "Couldn't disconnect", description: err.message }),
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

  if (connection.isError) {
    return (
      <PanelError
        message={(connection.error as Error)?.message ?? "Unknown error"}
        onRetry={() => void connection.refetch()}
      />
    );
  }
  if (connection.isLoading) return <PanelLoading rows={4} />;

  const current = view.current;
  const live = current && current.status !== "revoked";

  return (
    <div className="space-y-5 pt-1">
      {!live ? (
        /* ── not connected ──────────────────────────────────────────────── */
        <>
          <PanelNote>
            Connecting sends every rental charge, extension, damage, payment and refund to Zoho
            Books as invoices, customer payments and credit notes. Nothing already in Zoho Books is
            changed.
          </PanelNote>

          {staleAttempt && (
            <PanelNote tone="warn">
              A connection you started {fmtRelative(new Date(staleAttempt.startedAt).toISOString())}{" "}
              (data centre {REGION_LABELS[staleAttempt.region] ?? staleAttempt.region}) never
              completed. Zoho reports connection failures to the old Settings → Accounting page,
              which this product does not show — so start again here and, if it fails a second
              time, the reason will be in the server logs.
              <button
                type="button"
                onClick={() => {
                  clearAttempt();
                  setStaleAttempt(null);
                }}
                className="mt-1 block underline underline-offset-2"
              >
                Dismiss
              </button>
            </PanelNote>
          )}

          {current?.status === "revoked" && (
            <PanelCard>
              <PanelRow label="Last connected" hint={current.external_org_name ?? undefined}>
                {fmtDate(current.connected_at)}
              </PanelRow>
              <PanelRow label="Disconnected">
                {fmtDate(current.disconnected_at ?? current.connected_at)}
              </PanelRow>
            </PanelCard>
          )}

          <PanelSection
            title="Data centre"
            description="Zoho keeps each account in one regional data centre and every API host differs per region. Picking the wrong one fails in a way that reads like bad credentials, so we ask rather than guess."
          >
            {/* `undefined`, not "": Radix treats the empty string as "no item
                matched" only when the value is absent, and shows the
                placeholder for it. */}
            <Select value={region || undefined} onValueChange={(v) => setRegion(v as ConnectableRegion)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose your Zoho data centre" />
              </SelectTrigger>
              <SelectContent>
                {CONNECTABLE_REGIONS.map((r) => (
                  <SelectItem key={r.region} value={r.region}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">
              It is in your Zoho URL — <span className="font-mono">books.zoho.eu</span> is Europe,{" "}
              <span className="font-mono">books.zoho.com</span> is Global.
              {region && (
                <>
                  {" "}
                  {CONNECTABLE_REGIONS.find((r) => r.region === region)?.where}.
                </>
              )}{" "}
              If Zoho sends you to a different data centre while you authorise, we record the one
              Zoho names — it is the only one that can redeem the code.
            </p>
          </PanelSection>

          {!canManage && (
            <PanelNote tone="warn">
              Only an admin or head admin can connect an accounting system.
            </PanelNote>
          )}

          <Button
            onClick={() => region && connect.mutate(region)}
            disabled={!region || !canManage || connect.isPending}
            className="w-full"
          >
            {connect.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plug className="size-4" />
            )}
            {connect.isPending ? "Opening Zoho…" : "Connect Zoho Books"}
          </Button>
        </>
      ) : (
        /* ── connected (or connected-but-broken) ────────────────────────── */
        <>
          {view.state === "attention" && (
            <PanelNote tone="warn">
              {current.status === "expired" ? (
                <>
                  Zoho revoked or exhausted this grant, so nothing can sync. Reconnecting runs the
                  authorisation again; your organisation, data centre and account mappings are kept.
                </>
              ) : view.tokenExpired ? (
                <>
                  The access token expired {fmtRelative(current.token_expires_at)} and has not been
                  renewed. Test the connection below — if it still fails, reconnect.
                </>
              ) : (
                <>
                  The last sync attempt reported an error.
                  {current.last_error ? (
                    <span className="mt-1 block font-mono text-[11px] opacity-80">
                      {current.last_error}
                    </span>
                  ) : null}
                </>
              )}
            </PanelNote>
          )}

          <PanelCard>
            <PanelRow label="Organisation">{current.external_org_name ?? "Unnamed"}</PanelRow>
            <PanelRow label="Organisation ID">
              <CopyValue value={current.external_org_id} />
            </PanelRow>
            <PanelRow
              label="Data centre"
              hint="Where this organisation's books actually live — set by Zoho at connect time."
            >
              {current.external_region
                ? (REGION_LABELS[current.external_region] ?? `.${current.external_region}`)
                : "Unknown"}
            </PanelRow>
            <PanelRow label="Connected">{fmtDate(current.connected_at)}</PanelRow>
            <PanelRow
              label="Access token"
              hint={
                view.tokenExpired
                  ? "Renewal is not running, so this does not recover on its own."
                  : undefined
              }
            >
              {view.tokenExpired ? (
                <span className="text-warning">Expired {fmtRelative(current.token_expires_at)}</span>
              ) : (
                <>Valid {fmtRelative(current.token_expires_at)}</>
              )}
            </PanelRow>
            <PanelRow label="Last sync">
              {current.last_synced_at ? fmtDateTime(current.last_synced_at) : "Never"}
            </PanelRow>
          </PanelCard>

          {/* The tenant flag is what v1's rental-detail sync stripe reads. It is
              written by the callback and by disconnect-accounting, so the two can
              only diverge if one of those half-failed — worth one line, not a
              state of its own.

              `=== false`, not `!flag`: the column is `boolean | null` on the
              context and the optional-columns fetch can leave it undefined, and
              "we did not load it" is not the same claim as "it is off". Warn
              only when we positively know. */}
          {tenant.integration_zoho_books === false && (
            <PanelNote tone="warn">
              This connection is live but the tenant&rsquo;s Zoho Books flag is off, so other
              screens will report it as unconnected. Reconnecting sets the flag.
            </PanelNote>
          )}

          <PanelSection
            title="Check the connection"
            description="Asks Zoho for this organisation's chart of accounts using the stored token — the one test that proves the token, the data centre, the permissions and the organisation id all still line up."
          >
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => probe.mutate()}
                disabled={probe.isPending || !canManage}
              >
                {probe.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Search className="size-3.5" />
                )}
                Test connection
              </Button>
              {accounts && (
                <span className="inline-flex items-center gap-1.5 text-xs text-success">
                  <Check className="size-3.5" />
                  Reached Zoho Books · {accounts.length} account
                  {accounts.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            {probeError && <PanelNote tone="warn">{probeError}</PanelNote>}
            {!canManage && (
              <p className="text-xs text-muted-foreground">
                Only an admin or head admin can run this.
              </p>
            )}
          </PanelSection>

          <PanelSection
            title="Account mappings"
            description="Which Zoho account each kind of charge lands in. An event whose type has no mapping does not fall back to a default — it fails permanently."
          >
            <PanelCard>
              <PanelRow label="Charge types mapped">
                {mappings.isLoading ? "…" : `${mappingSummary.mapped} of 9`}
              </PanelRow>
              <PanelRow
                label="Payment account"
                hint="Where customer payments are recorded. Without it, every payment fails."
              >
                {mappingSummary.paymentAccount ? (
                  <span className="truncate">{mappingSummary.paymentAccount}</span>
                ) : (
                  <span className="text-warning">Not set</span>
                )}
              </PanelRow>
            </PanelCard>

            {mappingSummary.unconfirmed > 0 && (
              <PanelNote tone="warn">
                {mappingSummary.unconfirmed} mapping
                {mappingSummary.unconfirmed === 1 ? " is" : "s are"} still the value seeded at
                connect time. Those seeds hold Zoho account <em>names</em> where Zoho&rsquo;s API
                expects an account id, so they will be rejected until an account is chosen for each.
                Choosing an account per charge type is not built here yet — ask support to set
                them until it is.
              </PanelNote>
            )}

            {/* The payment account is the one mapping this panel does set: it is
                never seeded, it blocks every payment_receipt on its own, and it
                is a single choice rather than a nine-row editor. */}
            {!mappingSummary.paymentAccount && canManage && (
              <div className="space-y-2">
                {accounts ? (
                  <>
                    <Select value={paymentAccount || undefined} onValueChange={setPaymentAccount}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose the bank or clearing account" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.code} value={a.code}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={() => savePaymentAccount.mutate(paymentAccount)}
                      disabled={!paymentAccount || savePaymentAccount.isPending}
                    >
                      {savePaymentAccount.isPending && <Loader2 className="size-3.5 animate-spin" />}
                      Save payment account
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Run <span className="font-medium">Test connection</span> above to load your
                    chart of accounts, then pick one here.
                  </p>
                )}
              </div>
            )}
          </PanelSection>

          <PanelSection
            title="Sync activity"
            description="Every rental charge and payment is queued server-side the moment it is recorded, whether or not this panel is open."
          >
            <PanelCard>
              <PanelRow label="Synced">{stats.isLoading ? "…" : stats.data?.synced ?? 0}</PanelRow>
              <PanelRow label="Queued">{stats.isLoading ? "…" : stats.data?.pending ?? 0}</PanelRow>
              <PanelRow label="Failed">
                {stats.isLoading ? (
                  "…"
                ) : (stats.data?.failed ?? 0) > 0 ? (
                  <span className="text-warning">{stats.data?.failed}</span>
                ) : (
                  0
                )}
              </PanelRow>
              <PanelRow label="Skipped" hint="Event types that are never sent to an accounting system.">
                {stats.isLoading ? "…" : stats.data?.skipped ?? 0}
              </PanelRow>
            </PanelCard>

            {/* Not a claim that the queue is stuck — just what the two numbers
                say. The queue drainer is a cron target and is not scheduled in
                production (see the header), so this is the state northwind and
                every other tenant will actually see. */}
            {!stats.isLoading && (stats.data?.pending ?? 0) > 0 && !current.last_synced_at && (
              <PanelNote tone="warn">
                {stats.data?.pending} event{(stats.data?.pending ?? 0) === 1 ? " is" : "s are"}{" "}
                queued and nothing has synced to Zoho Books yet.
              </PanelNote>
            )}

            {(failures.data?.rows?.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">Most recent failures</p>
                {failures.data!.rows.map((row) => (
                  <div key={row.id} className="rounded-xl border px-3 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-medium">
                        {row.event?.event_type?.replace(/_/g, " ") ?? "Event"}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {fmtDate(row.last_attempt_at ?? row.created_at)}
                      </span>
                    </div>
                    {row.last_error && (
                      <p className="mt-1 break-words font-mono text-[11px] leading-snug text-muted-foreground">
                        {row.last_error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </PanelSection>

          <PanelSection title="Disconnect">
            {!confirmingDisconnect ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmingDisconnect(true)}
                disabled={!canManage}
              >
                <Link2Off className="size-3.5" />
                Disconnect Zoho Books
              </Button>
            ) : (
              /* An inline confirm rather than an AlertDialog: this panel already
                 renders inside the board's Dialog, and a second portal-backed
                 modal over it fights the same focus trap. */
              <div className="space-y-3">
                <PanelNote tone="danger">
                  <span className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      <strong>Stops:</strong> new charges and payments no longer reach Zoho Books,
                      and this tenant&rsquo;s Zoho tokens are deleted — reconnecting means running
                      the whole authorisation again.
                      <br />
                      <strong>Does not stop:</strong> Drive247 keeps recording every financial event
                      server-side exactly as it does today, invoices already in Zoho Books are left
                      untouched, and anything already queued stays queued.
                    </span>
                  </span>
                </PanelNote>
                <div className="flex items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => disconnect.mutate()}
                    disabled={disconnect.isPending}
                  >
                    {disconnect.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Link2Off className="size-3.5" />
                    )}
                    Yes, disconnect
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDisconnect(false)}
                    disabled={disconnect.isPending}
                  >
                    Keep connected
                  </Button>
                </div>
              </div>
            )}
            {!canManage && (
              <p className="text-xs text-muted-foreground">
                Only an admin or head admin can disconnect.
              </p>
            )}
          </PanelSection>

          {/* Reconnect is offered for a broken connection only — for a healthy
              one it is a destructive-looking control with nothing to fix. */}
          {view.state === "attention" && canManage && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => connect.mutate(asConnectableRegion(current.external_region))}
              disabled={connect.isPending}
            >
              {connect.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {/* Named after the region we will ACTUALLY start at, which is not
                  always the stored one — see asConnectableRegion. Zoho still
                  gets the last word at the callback either way. */}
              Reconnect via {REGION_LABELS[asConnectableRegion(current.external_region)]}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
