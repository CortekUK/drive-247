/**
 * Square — the portal's read/connect/disconnect hook for a tenant's Square
 * merchant link.
 *
 * MODELLED ON use-accounting-connection.ts (Xero/Zoho), NOT on the Stripe
 * settings hooks, and for the same reason square-oauth.ts is modelled on
 * _shared/accounting: Stripe Connect stores an account id and no secret,
 * because its tokens never expire and the merchant is addressed with a
 * Stripe-Account header. Square has neither property — the per-merchant OAuth
 * ACCESS TOKEN *is* the addressing, and it dies after 30 days. So the shape the
 * UI has to render is "a credential with a lifetime and a refresh cron behind
 * it", which is the accounting shape, not the Stripe Connect shape.
 *
 * Reads come from the `square_connections_public` VIEW. Never the base table:
 * the view exists precisely because `square_connections` carries
 * access_token_secret_id / refresh_token_secret_id, and the view is defined
 * without them. It is `security_invoker=true`, so the base table's RLS
 * (`tenant_id = get_user_tenant_id() OR is_super_admin()`) still applies to the
 * caller.
 */
"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { throwEdgeError } from "@/lib/edge-error";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The provider name as stored in `tenants.payment_provider`.
 *
 * Deliberately a named constant and not a bare `=== "square"` literal.
 * `scripts/square-guardrails/check-predicates.mjs` bans raw provider-name
 * comparisons outside `supabase/functions/_shared/payments` so that
 * BEHAVIOURAL differences live in capabilities.ts instead of being sprinkled
 * across the app. The one comparison that rule cannot remove is identity — "is
 * there a Square panel to render at all" — which is exactly what plan item
 * A-13 specifies ("a sibling component chosen by provider"). Keeping it behind
 * a constant means there is exactly one such comparison in the portal, right
 * here, rather than one per consumer.
 */
const SQUARE_PROVIDER = "square";

/**
 * The eight markets where Square can actually take a payment.
 *
 * MIRRORS `SQUARE_CAPABILITIES.supportedCountries` in
 * supabase/functions/_shared/payments/capabilities.ts, which is the source of
 * truth. It is duplicated rather than imported because that module is Deno
 * source (`.ts` extension imports, esm.sh specifiers) living outside the Next
 * app's module graph; importing it would drag a Deno import map into a webpack
 * build. The DB CHECK on `tenants.country` enforces the same list server-side,
 * so a drift here is a cosmetic bug, never a money bug — but keep them in sync.
 */
export const SQUARE_SUPPORTED_COUNTRIES = [
  "AU",
  "CA",
  "FR",
  "IE",
  "JP",
  "ES",
  "GB",
  "US",
] as const;

/** Human labels for the country codes above — used by the unsupported-market state. */
export const SQUARE_SUPPORTED_COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia",
  CA: "Canada",
  FR: "France",
  IE: "Ireland",
  JP: "Japan",
  ES: "Spain",
  GB: "United Kingdom",
  US: "United States",
};

/** Square OAuth access tokens live 30 days. Nothing we control changes this. */
export const SQUARE_TOKEN_LIFETIME_DAYS = 30;

/**
 * Square advises refreshing every 7 days or less regardless of activity, so
 * `refresh-square-tokens` acts at 7 days remaining and not at 1. A healthy
 * connection therefore never sits below this number for long: seeing it here
 * means the refresh cron has not run, which is an operator-visible problem
 * BEFORE the token actually dies.
 */
export const SQUARE_REFRESH_WINDOW_DAYS = 7;

/** Below this, "the cron is late" has become "you are about to stop taking payments". */
export const SQUARE_EXPIRY_CRITICAL_DAYS = 3;

/**
 * The only tenant columns this hook reads — the portal-side twin of
 * TENANT_PROVIDER_COLUMNS in _shared/payments/resolve.ts. Deliberately tiny:
 * TenantContext's own select list is a different concern (and a different
 * agent's file), and widening that one carries the anon column-grant trap that
 * has already taken every tenant's login branding down once.
 *
 * Safe here because Settings runs as `authenticated`, which holds a
 * TABLE-level SELECT grant on `tenants` — the column-grant trap only bites the
 * anon, pre-session path.
 */
const TENANT_PROVIDER_COLUMNS = "id, payment_provider, square_mode, country";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SquareMode = "test" | "live";

/** Mirrors the CHECK on square_connections.status. */
export type SquareConnectionStatus = "active" | "expired" | "revoked" | "error";

/** Exactly the columns exposed by `square_connections_public` — no secrets. */
export interface SquareConnectionRow {
  id: string;
  tenant_id: string;
  square_mode: SquareMode;
  status: SquareConnectionStatus;
  token_expires_at: string | null;
  merchant_id: string | null;
  location_id: string | null;
  location_currency: string | null;
  business_name: string | null;
  scopes: string[] | null;
  refresh_failure_count: number | null;
  last_error: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
}

export interface SquareConnectionSnapshot {
  /** 'square' only when the tenant row says so; anything else fails safe to Stripe. */
  provider: "stripe" | "square";
  /** Sandbox and production are physically separate Square hosts, so this picks the row. */
  squareMode: SquareMode;
  country: string | null;
  connections: SquareConnectionRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** True when Square can take a payment in this market. Unknown country = no. */
export function isSquareCountrySupported(country: string | null | undefined): boolean {
  if (!country) return false; // a constrained processor + an unknown country must refuse
  return (SQUARE_SUPPORTED_COUNTRIES as readonly string[]).includes(country.toUpperCase());
}

/**
 * Whole days until the access token dies. Negative once it already has.
 * Null when there is no expiry on file (no connection, or a row written before
 * the callback learned the expiry).
 */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((then - Date.now()) / 86_400_000);
}

/**
 * Pick the row that the panel should talk about, for one mode.
 *
 * Ordered by how much it demands of the operator, not by recency: an 'expired'
 * or 'error' row is the one that needs a reconnect prompt, whereas a 'revoked'
 * row is just the residue of a deliberate disconnect and should read as "not
 * connected". Within a status, newest wins.
 */
const STATUS_PRIORITY: Record<SquareConnectionStatus, number> = {
  active: 0,
  expired: 1,
  error: 2,
  revoked: 3,
};

function pickConnection(
  rows: SquareConnectionRow[],
  mode: SquareMode,
): SquareConnectionRow | null {
  const forMode = rows.filter((r) => r.square_mode === mode);
  if (forMode.length === 0) return null;
  const sorted = [...forMode].sort((a, b) => {
    const byStatus = (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99);
    if (byStatus !== 0) return byStatus;
    const at = a.connected_at ? new Date(a.connected_at).getTime() : 0;
    const bt = b.connected_at ? new Date(b.connected_at).getTime() : 0;
    return bt - at;
  });
  return sorted[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The hook
// ─────────────────────────────────────────────────────────────────────────────

export function useSquareConnection() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["square-connection", tenant?.id],
    queryFn: async (): Promise<SquareConnectionSnapshot> => {
      if (!tenantId) {
        return { provider: "stripe", squareMode: "test", country: null, connections: [] };
      }

      // 1. Which processor owns this tenant's customer money, and in which
      //    Square environment. TenantContext does not carry these columns.
      const { data: tenantRow, error: tenantError } = await supabaseUntyped
        .from("tenants")
        .select(TENANT_PROVIDER_COLUMNS)
        .eq("id", tenantId)
        .single();
      if (tenantError) throw tenantError;

      // Fail SAFE toward Stripe, exactly as resolvePaymentProvider does: an
      // unrecognised value must never be read as Square, or a Stripe tenant
      // gets a panel offering to re-plumb their money.
      const provider: "stripe" | "square" =
        tenantRow?.payment_provider === SQUARE_PROVIDER ? SQUARE_PROVIDER : "stripe";
      const squareMode: SquareMode = tenantRow?.square_mode === "live" ? "live" : "test";
      const country: string | null = tenantRow?.country ?? null;

      // A Stripe tenant has no Square rows and never will — skip the second
      // round-trip rather than issue a query whose only correct answer is [].
      if (provider !== SQUARE_PROVIDER) {
        return { provider, squareMode, country, connections: [] };
      }

      // 2. The connection rows. The tenant_id filter is load-bearing and NOT
      //    redundant with RLS: the policy is
      //    `tenant_id = get_user_tenant_id() OR is_super_admin()`, so a super
      //    admin browsing a tenant portal would otherwise pull every tenant's
      //    Square connection into this panel.
      const { data, error } = await supabaseUntyped
        .from("square_connections_public")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("connected_at", { ascending: false });
      if (error) throw error;

      return {
        provider,
        squareMode,
        country,
        connections: (data ?? []) as SquareConnectionRow[],
      };
    },
    enabled: !!tenant,
    // POLLING, NOT REALTIME — deliberately.
    //
    // The accounting hook subscribes to postgres_changes on
    // accounting_connections; verified against the live project, neither that
    // table nor square_connections is in the `supabase_realtime` publication,
    // so that subscription is a no-op and copying it here would look like live
    // sync while delivering nothing. Everything that changes this panel is
    // either a cron (refresh-square-tokens), a webhook
    // (oauth.authorization.revoked) or a pure clock event (token expiry) — and
    // a clock event can never be pushed by any socket. A slow poll while the
    // settings tab is open is the honest mechanism.
    staleTime: 30_000,
    refetchInterval: 60_000,
    // Overrides the app-wide `refetchOnWindowFocus: false`. The operator comes
    // back to this tab straight from Square's consent screen; a stale "Not
    // connected" card there reads as "the connection failed".
    refetchOnWindowFocus: true,
  });

  const snapshot = query.data;
  const provider = snapshot?.provider ?? "stripe";
  const squareMode: SquareMode = snapshot?.squareMode ?? "test";
  const country = snapshot?.country ?? null;

  /** Identity check — see the SQUARE_PROVIDER comment. */
  const isSquareTenant = provider === SQUARE_PROVIDER;

  const connection = useMemo(
    () => pickConnection(snapshot?.connections ?? [], squareMode),
    [snapshot?.connections, squareMode],
  );

  const daysUntilExpiry = daysUntil(connection?.token_expires_at);

  const isConnected = connection?.status === "active";

  /**
   * "The credential is dead." Either the refresh cron gave up and marked the
   * row, or the stored expiry is already in the past — the second case matters
   * because the cron can itself be down, in which case nothing will ever write
   * the status.
   */
  const isExpired =
    connection?.status === "expired" ||
    (connection != null && daysUntilExpiry !== null && daysUntilExpiry < 0);

  /** Square rejected something on the merchant's behalf and the row records why. */
  const isError = connection?.status === "error";

  /** Operator (or Square) deliberately cut the link. Reads as "not connected". */
  const isRevoked = connection?.status === "revoked";

  /**
   * Connected to a merchant, but Square cannot take a card on it yet.
   *
   * Detected STRUCTURALLY, not by parsing `last_error`: square-oauth-callback
   * stores the merchant and then writes `location_id = NULL` for exactly the
   * two cases it refuses to activate on — no ACTIVE CREDIT_CARD_PROCESSING
   * location, and a location currency that does not match the account. The
   * sentence in `last_error` is free English written for a human and would be a
   * fragile thing to match on.
   *
   * Worth separating from a plain 'error' because the remedy is different: the
   * operator fixes something inside Square's own dashboard first. And because
   * NOTHING will ever push a "now it works" signal — Square emits no event for
   * "your location became card-capable" — this state has to stay on screen
   * until the operator acts on it.
   */
  const isSetupIncomplete =
    isError && !!connection?.merchant_id && !connection?.location_id;

  /**
   * Needs the operator to walk Square's consent flow again. Deliberately
   * EXCLUDES the setup-incomplete case, which gets its own, differently-worded
   * panel — telling someone to "reconnect" when the real problem is an inactive
   * Square location sends them round a loop that cannot succeed.
   */
  const needsReconnect = (isExpired || isError) && !isSetupIncomplete;

  /**
   * The token is inside the window the refresh cron should already have acted
   * in. Not fatal on its own, but it is the only warning an operator ever gets
   * before payments stop.
   */
  const isExpiringSoon =
    isConnected && daysUntilExpiry !== null && daysUntilExpiry <= SQUARE_REFRESH_WINDOW_DAYS;

  const isExpiryCritical =
    isConnected &&
    daysUntilExpiry !== null &&
    (daysUntilExpiry <= SQUARE_EXPIRY_CRITICAL_DAYS ||
      (connection?.refresh_failure_count ?? 0) > 0);

  const countrySupported = isSquareCountrySupported(country);

  // ── connect ───────────────────────────────────────────────────────────────
  const connectMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant context");

      const { data, error } = await supabase.functions.invoke("square-oauth-start", {
        body: {
          tenantId,
          // Send the tenant's configured mode, never a hardcoded 'live' the way
          // own-stripe-settings does. Square's sandbox and production are
          // SEPARATE HOSTS with non-interchangeable credentials — the mode is
          // the base URL, not a key — so connecting on the wrong one produces a
          // link that can never take a real payment.
          mode: squareMode,
          returnTo: "portal",
          origin: window.location.origin,
        },
      });
      if (error) await throwEdgeError(error);

      // The two OAuth-start precedents in this repo disagree on the field name
      // (`stripe-oauth-start` returns { url }, `xero-oauth-start` returns
      // { authorizeUrl }). Accept either rather than break on a coin-flip in a
      // function this file does not own.
      const payload = (data ?? {}) as { url?: string; authorizeUrl?: string };
      const url = payload.url ?? payload.authorizeUrl;
      if (!url) throw new Error("Square did not return an authorisation link.");

      // Same-tab handoff: a popup would be blocked, and the callback needs to
      // land the operator back on this settings page.
      window.location.href = url;
      return { redirected: true };
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Could not start the Square connection",
      ),
  });

  // ── disconnect ────────────────────────────────────────────────────────────
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant context");
      const { data, error } = await supabase.functions.invoke("square-disconnect", {
        // Mode-scoped: a tenant can hold a sandbox row and a production row at
        // once, and disconnecting one must not touch the other.
        body: { tenantId, mode: squareMode },
      });
      if (error) await throwEdgeError(error);
      return (data ?? { ok: true }) as { ok: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["square-connection", tenantId] });
      toast.success("Square disconnected");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to disconnect Square"),
  });

  return {
    // raw
    connection,
    connections: snapshot?.connections ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,

    // tenant-level facts
    provider,
    isSquareTenant,
    squareMode,
    country,
    countrySupported,

    // computed connection health
    isConnected,
    isExpired,
    isError,
    isRevoked,
    isSetupIncomplete,
    needsReconnect,
    isExpiringSoon,
    isExpiryCritical,
    daysUntilExpiry,

    // actions
    connect: () => connectMutation.mutate(),
    isConnecting: connectMutation.isPending,
    disconnect: () => disconnectMutation.mutate(),
    isDisconnecting: disconnectMutation.isPending,
  };
}
