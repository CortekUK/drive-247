"use client";

// ── Xero panel — data access ─────────────────────────────────────────────────
//
// Everything the Xero panel reads or writes. Split out of `xero.tsx` so the
// panel file stays presentation, and named `xero-*` so it cannot collide with
// the Zoho panel being written in parallel (V2_PLAN §2).
//
// DELIBERATELY NOT SHARED WITH ZOHO. The two providers run on the same tables,
// the same worker and the same edge functions, so the temptation to factor an
// `accounting-*` module out of this is strong — and wrong while two agents are
// writing at once: a shared file is a shared merge point, which is the one
// thing the panel split exists to prevent. Factor it out afterwards, if at all.
//
// ⚠️ ISOLATION. Every query below carries `.eq("tenant_id", tenantId)`. RLS is
// ON for the accounting tables (unlike the core tables — V2_PLAN §5), but its
// policy is `tenant_id = get_user_tenant_id() OR is_super_admin()`, and a super
// admin carries `tenant_id = NULL` by design. So for the one operator most
// likely to open this screen, the policy matches EVERY row and the explicit
// filter is the only thing scoping the read to this tenant. Do not remove it on
// the grounds that "RLS covers this table".

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { throwEdgeError } from "@/lib/edge-error";
import type { IntegrationState, PanelTenant } from "./_kit";

/* ─────────────────────────────── shapes ─────────────────────────────────── */

export type XeroConnectionStatus = "active" | "expired" | "revoked" | "error";

/**
 * A row of `accounting_connections_public` — the view over
 * `accounting_connections` with the two vault `*_secret_id` columns dropped.
 * Read the view, never the base table: the ids are useless to the browser and
 * putting them on the wire is how they end up in a logged network trace.
 *
 * The view is `security_invoker = true`, so RLS applies to it as written.
 */
export interface XeroConnectionRow {
  id: string;
  tenant_id: string;
  provider: "xero" | "zoho";
  status: XeroConnectionStatus;
  token_expires_at: string | null;
  external_org_id: string;
  external_org_name: string | null;
  external_region: string | null;
  /**
   * Always NULL in production. Nothing writes it — verified across all 324 edge
   * functions, only `signup-provision` and `reconcile-subscriptions` write a
   * column of this name and both are the Stripe subscription tables. v1's card
   * renders it as "Last synced" and therefore always shows a dash. The panel
   * derives real sync activity from `financial_event_sync_state` instead.
   */
  last_synced_at: string | null;
  last_error: string | null;
  connected_by: string | null;
  connected_at: string;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface XeroMappingRow {
  event_type: string | null;
  is_payment_account_sentinel: boolean;
  external_account_code: string;
  external_account_name: string | null;
}

export interface XeroAccount {
  code: string;
  name: string;
  type?: string;
  isActive?: boolean;
}

export type XeroSyncStateValue = "pending" | "syncing" | "synced" | "failed" | "skipped";

export interface XeroSyncRow {
  id: string;
  state: XeroSyncStateValue;
  attempts: number;
  last_error: string | null;
  last_error_code: string | null;
  last_attempt_at: string | null;
  synced_at: string | null;
  external_invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The event types `process-accounting-sync` looks a mapping up for.
 *
 * Mirrors the VALUES list in `seed_default_accounting_mappings()`, which is
 * what the OAuth callback runs on connect — so a freshly connected tenant has
 * all nine already. Any that are missing mean the seed did not run, and every
 * event of that type fails permanently with `NO_MAPPING` (validation class, no
 * retry). `financial_event_type` has five more members
 * (`payment_receipt`, `refund`, `security_hold_release`, `maintenance_expense`,
 * `partner_payout`) which the worker routes without a mapping lookup, so they
 * are deliberately not listed.
 */
export const XERO_MAPPED_EVENT_TYPES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "rental_charge", label: "Rental charge" },
  { key: "extension_charge", label: "Extension charge" },
  { key: "insurance_charge", label: "Insurance charge" },
  { key: "damage_charge", label: "Damage charge" },
  { key: "mileage_charge", label: "Mileage charge" },
  { key: "late_fee", label: "Late fee" },
  { key: "charging_cost", label: "Charging cost" },
  { key: "deposit_capture", label: "Deposit captured" },
  { key: "discount", label: "Discount" },
];

export interface XeroSnapshot {
  connection: XeroConnectionRow | null;
  /** Empty when there is no live connection row — see the note in the query. */
  mappings: XeroMappingRow[];
}

/* ──────────────────────────── status snapshot ───────────────────────────── */

export const xeroStatusKey = (tenantId: string) => ["v2-xero-status", tenantId] as const;

/**
 * The one read behind BOTH the board chip and the panel header.
 *
 * The chip renders for every card on first paint, so this is a single query for
 * the common case: one row out of a fifteen-column view. The mappings read only
 * fires once a connection is actually active, where the answer changes what the
 * chip is allowed to say — a connected Xero with no payment account maps every
 * `payment_receipt` to `NO_PAYMENT_ACCOUNT` and syncs no payment at all, which
 * is precisely the "connected but not working" state `attention` exists for.
 *
 * `refetchOnWindowFocus` is ON, overriding the portal's global `false`. The
 * OAuth round-trip leaves and re-enters this tab, and without a focus refetch
 * an operator who has just authorised in Xero comes back to a cached
 * "Not connected".
 */
export function useXeroStatus(tenant: PanelTenant) {
  return useQuery({
    queryKey: xeroStatusKey(tenant.id),
    queryFn: async (): Promise<XeroSnapshot> => {
      // Newest row wins. There can be several per (tenant, provider) — the
      // internal `test` tenant carries two Xero rows today, both expired — and
      // v1 only ever looked for `status === 'active'`, so an expired connection
      // rendered as "not connected" and invited a reconnect that was not the
      // remedy. Take the newest whatever its status and classify it below.
      const { data: connRows, error: connErr } = await supabaseUntyped
        .from("accounting_connections_public")
        .select("*")
        .eq("tenant_id", tenant.id)
        .eq("provider", "xero")
        .order("connected_at", { ascending: false })
        .limit(1);
      if (connErr) throw connErr;

      const connection = ((connRows ?? [])[0] ?? null) as XeroConnectionRow | null;
      // Read the mappings for any connection that still exists, not just an
      // active one. They survive expiry and revocation — nothing deletes them —
      // and skipping the read on an expired connection would have the panel
      // report "0 of 9 mapped" for a tenant whose mappings are all present,
      // which is a worse lie than saying nothing.
      if (!connection || connection.status === "revoked") {
        return { connection, mappings: [] };
      }

      const { data: mapRows, error: mapErr } = await supabaseUntyped
        .from("accounting_account_mappings")
        .select("event_type, is_payment_account_sentinel, external_account_code, external_account_name")
        .eq("tenant_id", tenant.id)
        .eq("provider", "xero");
      if (mapErr) throw mapErr;

      return { connection, mappings: (mapRows ?? []) as XeroMappingRow[] };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/* ───────────────────────────── classification ───────────────────────────── */

export interface XeroVerdict {
  state: IntegrationState;
  /** Overrides the chip's default word. Says what is wrong, never dresses it up. */
  label?: string;
  /** One sentence: the fault, then the remedy. */
  detail?: string;
  tokenExpired: boolean;
  paymentAccount: { code: string; name: string | null } | null;
  missingEventTypes: ReadonlyArray<{ key: string; label: string }>;
}

/**
 * Turn the snapshot into what the operator is told.
 *
 * The ordering is the point: the most disabling fault wins. A revoked or
 * missing row is genuinely "not connected"; everything else is a connection
 * that exists and cannot do its job, which is `attention` — the kit's whole
 * reason for having a third state.
 */
export function deriveXeroVerdict(snapshot: XeroSnapshot | undefined): XeroVerdict {
  const empty: XeroVerdict = {
    state: "disconnected",
    tokenExpired: false,
    paymentAccount: null,
    missingEventTypes: XERO_MAPPED_EVENT_TYPES,
  };
  if (!snapshot) return empty;

  const { connection, mappings } = snapshot;
  if (!connection || connection.status === "revoked") return empty;

  const sentinel = mappings.find((m) => m.is_payment_account_sentinel && m.external_account_code);
  const paymentAccount = sentinel
    ? { code: sentinel.external_account_code, name: sentinel.external_account_name }
    : null;
  const mapped = new Set(
    mappings.filter((m) => !m.is_payment_account_sentinel && m.external_account_code).map((m) => m.event_type),
  );
  const missingEventTypes = XERO_MAPPED_EVENT_TYPES.filter((e) => !mapped.has(e.key));

  const tokenExpired =
    !!connection.token_expires_at && new Date(connection.token_expires_at).getTime() <= Date.now();

  if (connection.status === "expired") {
    return {
      state: "attention",
      label: "Reconnect needed",
      detail:
        "Xero stopped accepting the stored credentials. Reconnect to authorise Drive247 again — " +
        "nothing already in Xero is affected.",
      tokenExpired: true,
      paymentAccount,
      missingEventTypes,
    };
  }

  if (connection.status === "error") {
    return {
      state: "attention",
      label: "Connection error",
      detail: connection.last_error ?? "Xero reported an error on this connection.",
      tokenExpired,
      paymentAccount,
      missingEventTypes,
    };
  }

  // status === 'active'. An access token whose expiry has already passed while
  // the row still says `active` is itself the evidence: `refresh-accounting-tokens`
  // would have either renewed it or flipped the row to `expired`, so if neither
  // happened the renewal is not running and reconnecting is the only remedy the
  // portal can offer. Stated as an observation, not as a claim about the server.
  if (tokenExpired) {
    return {
      state: "attention",
      label: "Token expired",
      detail:
        "The Xero access token has passed its expiry and has not been renewed, so calls to Xero " +
        "will be rejected. Reconnect to issue a fresh one.",
      tokenExpired,
      paymentAccount,
      missingEventTypes,
    };
  }

  if (!paymentAccount) {
    return {
      state: "attention",
      label: "Payment account not set",
      detail:
        "Invoices can sync, but payments cannot — Drive247 has no Xero bank account to record them " +
        "against. Set one below.",
      tokenExpired,
      paymentAccount,
      missingEventTypes,
    };
  }

  if (missingEventTypes.length > 0) {
    return {
      state: "attention",
      label: `${missingEventTypes.length} unmapped charge${missingEventTypes.length === 1 ? "" : "s"}`,
      detail:
        "Some charge types have no Xero account to land in. Events of those types fail permanently " +
        "rather than retrying.",
      tokenExpired,
      paymentAccount,
      missingEventTypes,
    };
  }

  return { state: "connected", tokenExpired, paymentAccount, missingEventTypes };
}

/* ─────────────────────────────── sync health ────────────────────────────── */

/**
 * Counts by state, plus the five most recently touched rows.
 *
 * One React Query entry rather than v1's two hooks: the counts, the recent rows
 * and the last attempt all answer the same question and all invalidate at the
 * same moment, so splitting them only creates a window where the panel shows
 * one of them refreshed and the others stale. A grouped count is not
 * expressible through PostgREST without an RPC, so the totals are still five
 * `head: true` counts — but nothing here runs until the dialog is open.
 */
export function useXeroSyncHealth(tenant: PanelTenant, enabled: boolean) {
  return useQuery({
    queryKey: ["v2-xero-sync-health", tenant.id],
    queryFn: async () => {
      const states: XeroSyncStateValue[] = ["synced", "pending", "syncing", "failed", "skipped"];
      const counts = await Promise.all(
        states.map(async (state) => {
          const { count, error } = await supabaseUntyped
            .from("financial_event_sync_state")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.id)
            .eq("provider", "xero")
            .eq("state", state);
          if (error) throw error;
          return [state, count ?? 0] as const;
        }),
      );
      const byState = Object.fromEntries(counts) as Record<XeroSyncStateValue, number>;

      const { data: recentRaw, error: recentErr } = await supabaseUntyped
        .from("financial_event_sync_state")
        .select(
          "id, state, attempts, last_error, last_error_code, last_attempt_at, synced_at, external_invoice_id, created_at, updated_at",
        )
        .eq("tenant_id", tenant.id)
        .eq("provider", "xero")
        .order("updated_at", { ascending: false })
        .limit(5);
      if (recentErr) throw recentErr;
      const recent = (recentRaw ?? []) as XeroSyncRow[];

      // Asked for exactly, not inferred from the five rows above. Ordering by
      // `updated_at` surfaces the most recently TOUCHED rows, and a burst of
      // freshly enqueued events pushes every attempted row out of that window —
      // which would have read as "nothing has ever been attempted" and put a
      // platform-health warning on a queue that is running fine.
      const { data: attemptRaw, error: attemptErr } = await supabaseUntyped
        .from("financial_event_sync_state")
        .select("last_attempt_at")
        .eq("tenant_id", tenant.id)
        .eq("provider", "xero")
        .not("last_attempt_at", "is", null)
        .order("last_attempt_at", { ascending: false })
        .limit(1);
      if (attemptErr) throw attemptErr;
      const lastAttemptAt =
        ((attemptRaw ?? [])[0] as { last_attempt_at: string } | undefined)?.last_attempt_at ?? null;

      const total = states.reduce((sum, s) => sum + (byState[s] ?? 0), 0);
      const queued = (byState.pending ?? 0) + (byState.syncing ?? 0);

      return {
        total,
        synced: byState.synced ?? 0,
        queued,
        failed: byState.failed ?? 0,
        skipped: byState.skipped ?? 0,
        recent,
        lastAttemptAt,
        /**
         * Queued work exists and nothing has ever been attempted. The worker
         * (`process-accounting-sync`) is driven by cron, not by this screen, so
         * this is the only signal the portal has that the queue is not moving.
         */
        queueStalled: queued > 0 && !lastAttemptAt,
      };
    },
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

/* ─────────────────────────── chart of accounts ──────────────────────────── */

/**
 * The tenant's Xero chart of accounts, fetched live through
 * `list-accounting-accounts`.
 *
 * This doubles as the connection test, which is why the panel has no separate
 * "Test connection" button calling something weaker: the call authenticates
 * with the stored token and hits Xero's `/Accounts` endpoint, so a success is
 * proof the credentials still work and a failure carries Xero's own reason.
 *
 * v1's `useAccountingAccounts` is nearly this, but its `enabled` is only
 * `!!provider` — it fires against a provider that was never connected and
 * surfaces a 4xx as a broken screen. Gated on an active connection instead.
 */
export function useXeroAccounts(tenant: PanelTenant, enabled: boolean) {
  return useQuery({
    queryKey: ["v2-xero-accounts", tenant.id],
    queryFn: async (): Promise<XeroAccount[]> => {
      const { data, error } = await supabase.functions.invoke("list-accounting-accounts", {
        // A super admin has `tenant_id = NULL` in `app_users`, so the edge
        // function cannot infer the tenant from the JWT alone. The slug is how
        // it resolves one — and it is only honoured FOR a super admin; a scoped
        // user is pinned to their own tenant and the slug ignored, so this
        // cannot be used to point at someone else's books.
        body: { provider: "xero", tenantSlug: tenant.slug ?? null },
      });
      if (error) await throwEdgeError(error);
      return ((data as { accounts?: XeroAccount[] })?.accounts ?? []).filter((a) => !!a.code);
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: false, // a 401/403 from Xero is an answer, not a blip — show it
  });
}

/* ───────────────────────────── mutations ────────────────────────────────── */

/**
 * Start the OAuth redirect.
 *
 * The `state` parameter is NOT ours to construct. `xero-oauth-start` mints a
 * nonce, stores it in `accounting_oauth_state` with the tenant and a ten-minute
 * expiry, and the callback redeems it — that row is what binds the redirect
 * back to this tenant, and it is also why the callback can run with
 * `verify_jwt = false`. The client's only job is to hand off to the URL the
 * server returns, unmodified.
 *
 * `redirectBack` IS ours, and it is the one value here that could be abused:
 * the callback 302s the browser to it verbatim on success. It is therefore
 * built from `window.location.origin` and a fixed path — never from a query
 * parameter, a prop or anything else a link could carry, which would turn the
 * callback into an open redirect carrying a freshly authorised session.
 */
export function useConnectXero(tenant: PanelTenant) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const redirectBack = `${window.location.origin}/integrations?xero=connected`;
      const { data, error } = await supabase.functions.invoke("xero-oauth-start", {
        body: { redirectBack, tenantSlug: tenant.slug ?? null },
      });
      if (error) await throwEdgeError(error);
      const authorizeUrl = (data as { authorizeUrl?: string })?.authorizeUrl;
      if (!authorizeUrl) throw new Error("Xero did not return an authorisation URL.");
      window.location.href = authorizeUrl;
      return true;
    },
    onError: (err) =>
      toast({
        variant: "destructive",
        title: "Could not start the Xero connection",
        description: err instanceof Error ? err.message : "Please try again.",
      }),
  });
}

export function useDisconnectXero(tenant: PanelTenant) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { refetchTenant } = useTenant();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("disconnect-accounting", {
        body: { provider: "xero", tenantSlug: tenant.slug ?? null },
      });
      if (error) await throwEdgeError(error);
      return data as { ok: boolean };
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: xeroStatusKey(tenant.id) });
      qc.removeQueries({ queryKey: ["v2-xero-accounts", tenant.id] });
      // `disconnect-accounting` flips `tenants.integration_xero` to false, and
      // TenantContext holds that column in memory for the session.
      await refetchTenant?.();
      toast({ title: "Xero disconnected", description: "No further events will be sent to Xero." });
    },
    onError: (err) =>
      toast({
        variant: "destructive",
        title: "Could not disconnect Xero",
        description: err instanceof Error ? err.message : "Nothing was changed.",
      }),
  });
}

/**
 * Re-arm every failed sync row for this tenant.
 *
 * NOTE the blast radius: `retry-accounting-sync`'s bulk path filters on
 * `tenant_id` and `state = 'failed'` and does NOT filter by provider, so on a
 * tenant that also runs Zoho this re-queues that provider's failures too. It is
 * still the right control — re-queuing a failed row is harmless, and the
 * alternative is asking the operator to click through rows one at a time — but
 * the copy in the panel says "this tenant", not "Xero", for that reason.
 */
export function useRetryFailedXeroSync(tenant: PanelTenant) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("retry-accounting-sync", {
        body: { allFailed: true, tenantSlug: tenant.slug ?? null },
      });
      if (error) await throwEdgeError(error);
      return data as { reset: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["v2-xero-sync-health", tenant.id] });
      toast({
        title: data.reset === 0 ? "Nothing to retry" : `${data.reset} event${data.reset === 1 ? "" : "s"} re-queued`,
        description:
          data.reset === 0
            ? "There are no failed events waiting."
            : "They will be sent on the next run of the accounting sync worker.",
      });
    },
    onError: (err) =>
      toast({
        variant: "destructive",
        title: "Could not re-queue the failed events",
        description: err instanceof Error ? err.message : "Nothing was changed.",
      }),
  });
}

/**
 * Set the Xero bank/clearing account payments are recorded against.
 *
 * `save-accounting-mappings` upserts each mapping it is handed independently,
 * so sending ONLY the sentinel row leaves the nine per-event-type mappings —
 * and the tax codes on them — untouched. Sending them along "for completeness"
 * would rewrite `external_tax_code` from whatever this form knows, which is
 * nothing, and silently drop the tax treatment off every future invoice line.
 */
export function useSaveXeroPaymentAccount(tenant: PanelTenant) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (account: XeroAccount) => {
      const { data, error } = await supabase.functions.invoke("save-accounting-mappings", {
        body: {
          provider: "xero",
          tenantSlug: tenant.slug ?? null,
          mappings: [
            {
              is_payment_account_sentinel: true,
              external_account_code: account.code,
              external_account_name: account.name ?? null,
            },
          ],
        },
      });
      if (error) await throwEdgeError(error);
      return data as { errors?: string[] };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: xeroStatusKey(tenant.id) });
      if (data?.errors?.length) {
        toast({
          variant: "destructive",
          title: "Xero rejected the payment account",
          description: data.errors[0],
        });
        return;
      }
      toast({ title: "Payment account saved" });
    },
    onError: (err) =>
      toast({
        variant: "destructive",
        title: "Could not save the payment account",
        description: err instanceof Error ? err.message : "Nothing was changed.",
      }),
  });
}

/* ────────────────────────── OAuth return handling ───────────────────────── */

/**
 * Module-scoped, not a ref, and that is deliberate.
 *
 * The return lands on the BOARD, not in the dialog — the operator comes back
 * from Xero to a closed dialog — so this hook is mounted by the status chip,
 * which paints on every card. The chip renders twice whenever the dialog is
 * open (card + dialog header), and React StrictMode double-invokes effects in
 * dev, so a per-component ref would still fire the toast twice. One flag per
 * page load is the only guard that covers both.
 */
let xeroOAuthReturnHandled = false;

/**
 * Notice the `?xero=connected` we asked the callback to send us back to.
 *
 * Reads `window.location.search` rather than `useSearchParams()` so the board
 * does not need a Suspense boundary it does not own, and strips the parameter
 * with `history.replaceState` rather than `router.replace` so the server
 * component — which re-resolves the v2 gate — is not re-run for a cosmetic URL
 * change.
 *
 * SUCCESS ONLY. `xero-oauth-callback` honours `redirect_back` verbatim on
 * success but hardcodes `/settings?tab=accounting&status=error&…` on every
 * failure path, taking only the ORIGIN from `redirect_back`. A failed
 * authorisation therefore lands on Settings, where the Accounting tab is hidden
 * from lean tenants — so the operator sees no message at all. That cannot be
 * fixed from here without editing a shared edge function; it is reported rather
 * than papered over, and the panel's own state still tells the truth on the
 * next paint (still "Not connected").
 */
export function useXeroOAuthReturn(tenant: PanelTenant) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { refetchTenant } = useTenant();

  useEffect(() => {
    if (xeroOAuthReturnHandled) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("xero") !== "connected") return;
    xeroOAuthReturnHandled = true;

    params.delete("xero");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);

    // The callback wrote the connection with the service role; nothing told this
    // tab. Refetch before claiming anything, and let the panel's own derivation
    // decide what to say — a redirect back is not by itself proof of a usable
    // connection.
    qc.invalidateQueries({ queryKey: xeroStatusKey(tenant.id) });
    void refetchTenant?.();
    toast({
      title: "Back from Xero",
      description: "Checking the connection — open the Xero card to see its status.",
    });
  }, [qc, toast, refetchTenant, tenant.id]);
}
