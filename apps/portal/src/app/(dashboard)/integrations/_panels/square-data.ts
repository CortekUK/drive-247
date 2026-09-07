"use client";

// ── Square panel — data access ───────────────────────────────────────────────
//
// Everything the Square panel reads or writes. Split out of `square.tsx` so the
// panel file stays presentation, and named `square-*` so it cannot collide with
// the Stripe Connect panel being written beside it (V2_PLAN §2).
//
// WHAT SQUARE IS, in this codebase — not a second Stripe. Stripe Connect stores
// a permanent account id and no secret; Square stores a per-merchant OAuth
// ACCESS TOKEN that dies after 30 days, and that token IS the merchant
// addressing (there is no Stripe-Account header). So the shape this panel
// renders is "a credential with a lifetime and a renewal job behind it" — the
// accounting (Xero) shape, not the Stripe one — and the renewal job is the part
// to be careful about. See the note above `deriveSquareVerdict`.
//
// THE RAIL DECISION LIVES HERE, and only here on this board. `payment_provider`
// is a one-time choice: the DB trigger `tenants_payment_provider_immutable`
// refuses any change once `payment_provider_locked_at` is set, refuses it
// outright once the tenant holds a single `payments` row (a refund must go back
// through the processor that took the charge), stamps the lock itself, and
// refuses to ever clear it. The Stripe panel deliberately does not touch that
// column; v1 puts the choice on its own Settings screen
// (`payment-provider-choice.tsx`). `useChooseSquare` below writes EXACTLY what
// that screen writes — same columns, same values — so there is one shape of
// write for this decision across v1 and v2, not two.
//
// ⚠️ ISOLATION. Every query below carries `.eq("tenant_id", tenant.id)`, or
// `.eq("id", tenant.id)` on `tenants` itself. `payments` has RLS OFF (V2_PLAN
// §5) and holds every operator's money rows, so the filter there is the only
// thing scoping the counts to this tenant. `square_connections` has RLS ON, but
// its policy is `tenant_id = get_user_tenant_id() OR is_super_admin()` and a
// super admin carries `tenant_id = NULL` — for the operator most likely to open
// this screen the policy matches EVERY row. None of the filters is optional.

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";
import { throwEdgeError } from "@/lib/edge-error";
import type { IntegrationState, PanelTenant } from "./_kit";

/* ─────────────────────────────── shapes ─────────────────────────────────── */

export type ProviderId = "stripe" | "square";
export type SquareMode = "test" | "live";
/** Mirrors the CHECK on `square_connections.status`. */
export type SquareConnectionStatus = "active" | "expired" | "revoked" | "error";

/**
 * A row of `square_connections_public` — the view over `square_connections`
 * with the two vault `*_secret_id` columns dropped. Read the view, never the
 * base table: the ids are useless to the browser and putting them on the wire
 * is how they end up in a logged network trace. The view is
 * `security_invoker = true` (verified against production), so the base table's
 * RLS applies to it as written.
 */
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

/**
 * The tenant columns this panel reads. One string, so the chip and the dialog
 * cannot drift into selecting different sets and disagreeing about the same
 * tenant.
 *
 * On the UNTYPED client: `payment_provider_locked_at` is not in the generated
 * Supabase types, and the typed client rejects an entire select containing one
 * unknown column. The Stripe panel leaves that column out for exactly that
 * reason and declines to own the processor choice; this panel is where the
 * choice lives, so it needs the column.
 *
 * The two Stripe account ids are read for ONE sentence: an operator about to
 * move the rail to Square is told whether a linked Stripe account will be left
 * behind. Nothing here writes them.
 */
const TENANT_COLUMNS =
  "id, payment_provider, payment_provider_locked_at, square_mode, country, currency_code, " +
  "stripe_account_id, own_stripe_account_id";

export interface SquareTenantRow {
  id: string;
  payment_provider: string | null;
  payment_provider_locked_at: string | null;
  square_mode: string | null;
  country: string | null;
  currency_code: string | null;
  stripe_account_id: string | null;
  own_stripe_account_id: string | null;
}

export interface SquareSnapshot {
  tenant: SquareTenantRow;
  /** 'square' only when the row says so; anything else fails safe to Stripe. */
  provider: ProviderId;
  /** The one-time processor choice has been made — for whichever rail. */
  locked: boolean;
  /** Sandbox and production are separate Square hosts, so this picks the row. */
  squareMode: SquareMode;
  /** Empty for a Stripe tenant — the second read is skipped, not just filtered. */
  connections: SquareConnectionRow[];
}

/* ────────────────────────────── constants ───────────────────────────────── */

/**
 * The eight markets where Square can take a payment.
 *
 * Duplicated rather than imported: the source of truth is
 * `supabase/functions/_shared/payments/capabilities.ts`, which is Deno source
 * outside this app's module graph. The DB CHECK
 * `tenants_square_country_supported_check` enforces the same list, so a drift
 * here is a cosmetic bug and never a money bug — the write is refused.
 */
export const SQUARE_COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },
  { code: "FR", name: "France" },
  { code: "IE", name: "Ireland" },
  { code: "JP", name: "Japan" },
  { code: "ES", name: "Spain" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
];

/**
 * What a Square tenant gives up. Every line traces to ONE capability —
 * `supportsStoredCredential: false` in `capabilities.ts`: a hosted Square
 * payment link cannot vault a card, so nothing that charges later with nobody
 * present can work. Read to the operator before they lock the rail.
 */
export const SQUARE_LIMITS: ReadonlyArray<string> = [
  "Instalment plans — a card cannot be stored for later charges",
  "Auto-extend auto-charge — renters open a payment link each time instead",
  "Charging a saved card from the portal",
  "Deposit authorisation holds — deposits are taken as a real charge and refunded",
];

/** Square OAuth access tokens live 30 days. Nothing we control changes this. */
export const SQUARE_TOKEN_LIFETIME_DAYS = 30;

/**
 * `refresh-square-tokens` acts at 7 days remaining, not at 1 — Square advises
 * renewing every 7 days regardless of activity. A connection whose expiry is
 * inside this window has therefore been MISSED by the renewal, which is
 * operator-visible evidence before anything actually dies.
 */
export const SQUARE_REFRESH_WINDOW_DAYS = 7;

/* ─────────────────────────────── helpers ────────────────────────────────── */

export function isSquareCountrySupported(country: string | null | undefined): boolean {
  if (!country) return false; // a constrained processor + an unknown country must refuse
  const upper = country.toUpperCase();
  return SQUARE_COUNTRIES.some((c) => c.code === upper);
}

/**
 * Whole days until the access token dies. Negative once it already has. Null
 * when there is no expiry on file.
 */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((then - Date.now()) / 86_400_000);
}

/**
 * Which row the panel talks about, for one mode.
 *
 * Ordered by how much it demands of the operator, not by recency: an
 * 'expired' or 'error' row is the one that needs a reconnect prompt, whereas a
 * 'revoked' row is the residue of a deliberate disconnect and should read as
 * "not connected". Within a status, newest wins. Mirrors v1's
 * `use-square-connection.ts`, which the charge path agrees with:
 * `square_get_tokens` only ever returns the 'active' row for the mode.
 */
const STATUS_PRIORITY: Record<SquareConnectionStatus, number> = {
  active: 0,
  expired: 1,
  error: 2,
  revoked: 3,
};

function pickConnection(rows: SquareConnectionRow[], mode: SquareMode): SquareConnectionRow | null {
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

/* ──────────────────────────── status snapshot ───────────────────────────── */

export const squareStatusKey = (tenantId: string) => ["v2-square", tenantId] as const;

/**
 * The one read behind BOTH the board chip and the panel header.
 *
 * The chip renders for every card on first paint, so the common case — a
 * Stripe tenant, which is 55 of 57 today — is one row from `tenants` and
 * nothing else. The connection read only fires once the row says Square.
 *
 * `refetchOnWindowFocus` is ON, overriding the portal's global `false`. The
 * OAuth round-trip leaves and re-enters this tab, and without a focus refetch
 * an operator who has just authorised at Square comes back to a cached
 * "Not connected".
 */
export function useSquareStatus(tenant: PanelTenant) {
  return useQuery({
    queryKey: squareStatusKey(tenant.id),
    queryFn: async (): Promise<SquareSnapshot> => {
      const { data: row, error: tenantError } = await supabaseUntyped
        .from("tenants")
        .select(TENANT_COLUMNS)
        // ⚠️ The only thing standing between this tenant and another operator's
        // processor choice. Never remove.
        .eq("id", tenant.id)
        .single();
      if (tenantError) throw tenantError;
      const t = row as unknown as SquareTenantRow;

      // Fail SAFE toward Stripe, exactly as `resolvePaymentProvider` does on the
      // server: an unrecognised value must never be read as Square, or a Stripe
      // tenant gets a panel offering to re-plumb their money.
      const provider: ProviderId = t.payment_provider === "square" ? "square" : "stripe";
      const squareMode: SquareMode = t.square_mode === "live" ? "live" : "test";
      const locked = !!t.payment_provider_locked_at;

      if (provider !== "square") {
        return { tenant: t, provider, locked, squareMode, connections: [] };
      }

      const { data: rows, error } = await supabaseUntyped
        .from("square_connections_public")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("connected_at", { ascending: false });
      if (error) throw error;

      return {
        tenant: t,
        provider,
        locked,
        squareMode,
        connections: (rows ?? []) as SquareConnectionRow[],
      };
    },
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });
}

/* ───────────────────────────── classification ───────────────────────────── */

export type SquareRail = "stripe-locked" | "stripe-unlocked" | "square";

export interface SquareVerdict {
  rail: SquareRail;
  state: IntegrationState;
  /** Short chip label. Says what is wrong, never dresses broken up as working. */
  label: string;
  /** One or two sentences of the same truth, for the panel body. */
  headline: string;
  tone: "info" | "warn" | "danger";
  /** The row the panel talks about, for the tenant's mode. Null when none, or only revoked residue. */
  connection: SquareConnectionRow | null;
  /** When the residue IS a revoked row — for the "you disconnected on …" note. */
  revokedAt: string | null;
  tokenExpired: boolean;
  daysUntilExpiry: number | null;
  /** Inside the window the renewal job should already have acted in. */
  expiringSoon: boolean;
  /** Linked to a merchant, but Square has no card-capable location for it. */
  setupIncomplete: boolean;
  currencyMismatch: boolean;
}

const EMPTY_VERDICT: SquareVerdict = {
  rail: "stripe-unlocked",
  state: "disconnected",
  label: "Not connected",
  headline: "",
  tone: "info",
  connection: null,
  revokedAt: null,
  tokenExpired: false,
  daysUntilExpiry: null,
  expiringSoon: false,
  setupIncomplete: false,
  currencyMismatch: false,
};

function fmtDay(iso: string | null): string {
  if (!iso) return "an unknown date";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "an unknown date" : d.toLocaleDateString();
}

/**
 * Turn the snapshot into what the operator is told. Ordered worst-first — each
 * rung is a different fix, so collapsing them would tell the operator to do the
 * wrong thing.
 *
 * THE RENEWAL JOB, AND WHY EXPIRY IS DERIVED HERE RATHER THAN READ.
 *
 * `refresh-square-tokens` is the only thing that keeps a Square connection
 * alive past 30 days, and it is a cron target. Measured against production on
 * 5 Sep 2026: it ran every 10 minutes from 27 Aug and stopped at 08:40 UTC on
 * 3 Sep — `cron.job` now holds 21 jobs and none is Square, and its `cron_runs`
 * heartbeat has no row in the last 24 hours. `recover-pending-square-payments`
 * has never been scheduled at all. So `status = 'active'` on a row is NOT
 * evidence the token is usable: the only function that would flip it to
 * 'expired' is the one that is not running. The expiry is therefore computed
 * from `token_expires_at` against the clock, an expiry inside the 7-day
 * refresh window is reported as a MISSED renewal, and the panel offers no
 * control that only works when that worker runs. Reconnecting is a real
 * remedy for every attention state below — it is a fresh 30-day token minted
 * by the operator's own consent, with no job in the loop.
 *
 * `cron_runs` itself is deliberately not read: its policy is
 * `is_super_admin()` only, so for the operator it returns nothing, and a chip
 * must not depend on who is looking. The copy states observations, never the
 * schedule — if the job is put back, nothing here becomes a lie.
 */
export function deriveSquareVerdict(snapshot: SquareSnapshot | undefined): SquareVerdict {
  if (!snapshot) return EMPTY_VERDICT;

  if (snapshot.provider !== "square") {
    if (snapshot.locked) {
      return {
        ...EMPTY_VERDICT,
        rail: "stripe-locked",
        label: "Not in use",
        headline:
          "Stripe is this account's payment processor, and that choice is locked — so Square is not available here.",
      };
    }
    return {
      ...EMPTY_VERDICT,
      rail: "stripe-unlocked",
      label: "Available",
      headline:
        "Stripe is this account's payment processor today. You can choose Square instead — once, and for good.",
    };
  }

  const picked = pickConnection(snapshot.connections, snapshot.squareMode);
  const base: SquareVerdict = { ...EMPTY_VERDICT, rail: "square" };

  if (!picked || picked.status === "revoked") {
    return {
      ...base,
      state: "disconnected",
      label: "Not connected",
      tone: "warn",
      revokedAt: picked?.disconnected_at ?? picked?.connected_at ?? null,
      headline:
        "Square is your payment processor, but no Square account is connected — so bookings cannot take card payments until one is.",
    };
  }

  const daysUntilExpiry = daysUntil(picked.token_expires_at);
  const tokenExpired =
    picked.status === "expired" || (daysUntilExpiry !== null && daysUntilExpiry < 0);
  // Detected STRUCTURALLY, not by parsing `last_error`: square-oauth-callback
  // stores the merchant and writes `location_id = NULL` for exactly the two
  // cases it refuses to activate on. The English in `last_error` is for a
  // human and would be fragile to match on.
  const setupIncomplete = picked.status === "error" && !!picked.merchant_id && !picked.location_id;
  const tenantCurrency = (snapshot.tenant.currency_code ?? "").toUpperCase();
  const locationCurrency = (picked.location_currency ?? "").toUpperCase();
  const currencyMismatch =
    !!tenantCurrency && !!locationCurrency && tenantCurrency !== locationCurrency;
  const expiringSoon =
    picked.status === "active" &&
    !tokenExpired &&
    daysUntilExpiry !== null &&
    daysUntilExpiry <= SQUARE_REFRESH_WINDOW_DAYS;

  const common = {
    ...base,
    connection: picked,
    tokenExpired,
    daysUntilExpiry,
    expiringSoon,
    setupIncomplete,
    currencyMismatch,
  };

  if (setupIncomplete) {
    return {
      ...common,
      state: "attention",
      label: "Setup unfinished",
      tone: "warn",
      headline:
        `Your Square account is linked, but Square has no location on it that can take card payments` +
        `${tenantCurrency ? ` in ${tenantCurrency}` : ""}. Sort that out inside Square, then reconnect here — ` +
        "reconnecting is what re-checks it.",
    };
  }

  if (tokenExpired) {
    return {
      ...common,
      state: "attention",
      label: picked.status === "expired" ? "Access expired" : "Token expired",
      tone: "danger",
      headline:
        picked.status === "expired"
          ? "Square's permission to charge on your behalf has lapsed, so payments and refunds are failing. Reconnect to restore them."
          : `The Square access token expired on ${fmtDay(picked.token_expires_at)} and was not renewed, so Square is rejecting every call. Reconnect to issue a fresh one.`,
    };
  }

  if (picked.status === "error") {
    return {
      ...common,
      state: "attention",
      label: "Connection error",
      tone: "warn",
      headline: picked.last_error ?? "Square reported a problem with this connection. Reconnect to replace it.",
    };
  }

  // status === 'active' from here down.
  const failures = picked.refresh_failure_count ?? 0;
  if (failures > 0) {
    return {
      ...common,
      state: "attention",
      label: "Renewal failing",
      tone: "warn",
      headline:
        `Automatic renewal of your Square access has failed ${failures} time${failures === 1 ? "" : "s"}. ` +
        `Payments still work until ${fmtDay(picked.token_expires_at)}; reconnect before then rather than waiting on it.`,
    };
  }

  if (picked.last_error) {
    return {
      ...common,
      state: "attention",
      label: "Renewal problem",
      tone: "warn",
      headline:
        `The last renewal attempt reported a problem, shown below. Payments still work until ${fmtDay(picked.token_expires_at)}.`,
    };
  }

  if (!picked.location_id) {
    return {
      ...common,
      state: "attention",
      label: "No card location",
      tone: "warn",
      headline:
        "Square has no location on this account cleared for card payments, so payment links cannot be created. Activate one in Square, then reconnect.",
    };
  }

  if (currencyMismatch) {
    return {
      ...common,
      state: "attention",
      label: "Currency mismatch",
      tone: "warn",
      headline:
        `Your Square location bills in ${locationCurrency} but this account quotes prices in ${tenantCurrency}. ` +
        "Square does not convert — a customer would be charged the same number in the wrong money. Fix it in Square before taking payments.",
    };
  }

  if (expiringSoon) {
    const n = daysUntilExpiry as number;
    return {
      ...common,
      state: "attention",
      label: n <= 0 ? "Expires today" : `Expires in ${n} day${n === 1 ? "" : "s"}`,
      tone: "warn",
      headline:
        `Square access expires on ${fmtDay(picked.token_expires_at)} and has not been renewed. ` +
        `Payments stop that day unless it is — reconnecting Square issues a fresh ${SQUARE_TOKEN_LIFETIME_DAYS}-day token now.`,
    };
  }

  return {
    ...common,
    state: "connected",
    label: "Connected",
    tone: "info",
    headline: "Booking payments are going through your Square account.",
  };
}

/* ───────────────────────────── payments count ───────────────────────────── */

/**
 * How many payments this tenant holds, on any rail. Read only while the rail is
 * still open: the DB trigger refuses a processor change once this is non-zero,
 * and the panel explains that BEFORE the click rather than after.
 *
 * ⚠️ `payments` has RLS OFF. The tenant filter is the whole scope.
 */
export function useSquarePaymentsCount(tenant: PanelTenant, enabled: boolean) {
  return useQuery({
    queryKey: ["v2-square-payments-count", tenant.id],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabaseUntyped
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id);
      if (error) throw error;
      return count ?? 0;
    },
    enabled,
    staleTime: 30_000,
  });
}

/* ───────────────────────────── payment health ───────────────────────────── */

export interface SquarePaymentHealth {
  total: number;
  /** Links a customer has not paid yet, as far as this database knows. */
  pending: number;
  completed: number;
  lastPaidAt: string | null;
  oldestPendingAt: string | null;
  /**
   * A link has sat unpaid for over an hour. Not proof of anything — the
   * customer may simply not have paid — but it is the only shape a MISSED
   * `payment.updated` webhook ever has from this side, and nothing scheduled
   * is going to re-check it (see `deriveSquareVerdict`).
   */
  pendingStale: boolean;
}

/**
 * Counts by state for this tenant's Square payments.
 *
 * `use-square-payment-sync` (v1) is a rental-page cache refresher — it
 * invalidates queries when the operator returns from the checkout tab and
 * writes nothing, so there is nothing of it to show here. What IS worth
 * showing is the state its counterpart on the server,
 * `recover-pending-square-payments`, would act on: Pending rows with a Square
 * order id. That function takes no tenant argument and sweeps every tenant at
 * once, so it is deliberately NOT offered as a button — a portal button that
 * settles other operators' payments is not a control this screen may have.
 *
 * ⚠️ `payments` has RLS OFF. Every query here filters on `tenant_id`.
 */
export function useSquarePaymentHealth(tenant: PanelTenant, enabled: boolean) {
  return useQuery({
    queryKey: ["v2-square-payment-health", tenant.id],
    queryFn: async (): Promise<SquarePaymentHealth> => {
      const scoped = () =>
        supabaseUntyped
          .from("payments")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("payment_provider", "square");

      const [totalRes, pendingRes, completedRes] = await Promise.all([
        scoped(),
        scoped().eq("status", "Pending").not("square_order_id", "is", null),
        scoped().eq("status", "Completed"),
      ]);
      for (const r of [totalRes, pendingRes, completedRes]) {
        if (r.error) throw r.error;
      }

      const { data: oldestRows, error: oldestErr } = await supabaseUntyped
        .from("payments")
        .select("created_at")
        .eq("tenant_id", tenant.id)
        .eq("payment_provider", "square")
        .eq("status", "Pending")
        .not("square_order_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(1);
      if (oldestErr) throw oldestErr;

      const { data: lastRows, error: lastErr } = await supabaseUntyped
        .from("payments")
        .select("paid_at")
        .eq("tenant_id", tenant.id)
        .eq("payment_provider", "square")
        .not("paid_at", "is", null)
        .order("paid_at", { ascending: false })
        .limit(1);
      if (lastErr) throw lastErr;

      const oldestPendingAt =
        ((oldestRows ?? [])[0] as { created_at: string } | undefined)?.created_at ?? null;
      const lastPaidAt = ((lastRows ?? [])[0] as { paid_at: string } | undefined)?.paid_at ?? null;
      const pending = pendingRes.count ?? 0;

      return {
        total: totalRes.count ?? 0,
        pending,
        completed: completedRes.count ?? 0,
        lastPaidAt,
        oldestPendingAt,
        pendingStale:
          pending > 0 &&
          !!oldestPendingAt &&
          Date.now() - new Date(oldestPendingAt).getTime() > 60 * 60 * 1000,
      };
    },
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

/* ───────────────────────────── mutations ────────────────────────────────── */

/**
 * Move this tenant's rail to Square. Permanent.
 *
 * WRITES EXACTLY WHAT v1's `payment-provider-choice.tsx` WRITES, on purpose:
 *
 *  - `payment_provider_locked_at` is sent explicitly even though the trigger
 *    stamps it on a change of provider — so the two writers cannot drift on
 *    whether confirming sets the lock.
 *  - `country` is sent because `tenants_square_country_supported_check`
 *    requires a supported country on a Square tenant, and the canary has none.
 *  - The four SQUARE INVARIANTS are what `supportsStoredCredential: false`
 *    means in tenant columns. The admin create-company path forces them at
 *    birth; the operator path once did not, and the gap was real: a tenant
 *    left with `deposit_charge_enabled = false` ("hold the deposit as an
 *    authorisation" — which Square cannot do) got a 409 on EVERY booking.
 *    Applied only when choosing Square; nothing else on the row is touched.
 *
 * The DB trigger is the authority — locked, or payments exist, or unsupported
 * country, and the write is refused with a sentence that names the reason. The
 * panel mirrors those rules so the operator hears them before clicking, and
 * surfaces the database's own words if it disagrees.
 */
export function useChooseSquare(tenant: PanelTenant) {
  const qc = useQueryClient();
  const { refetchTenant } = useTenant();
  return useMutation({
    mutationFn: async (country: string) => {
      const { error } = await supabaseUntyped
        .from("tenants")
        .update({
          payment_provider: "square",
          country,
          payment_provider_locked_at: new Date().toISOString(),
          deposit_charge_enabled: true,
          installments_enabled: false,
          auto_extend_enabled: false,
          payg_auto_reminders_enabled: false,
        })
        // ⚠️ RLS is on for `tenants`, but the policy is `id = get_user_tenant_id()
        // OR is_super_admin()` — a super admin can reach every row. This filter
        // is what keeps the write on the canary.
        .eq("id", tenant.id);
      if (error) throw error;
      return true;
    },
    onSuccess: async () => {
      // The rail decision changes what the Stripe card says, what the booking
      // flow offers and four feature flags TenantContext holds in memory. v1
      // invalidates everything after this write; so does this.
      await refetchTenant?.();
      await qc.invalidateQueries();
      toast({
        title: "Square is now your payment processor",
        description: "Connect your Square account to start taking payments.",
      });
    },
    onError: (err) =>
      toast({
        variant: "destructive",
        title: "Could not choose Square",
        // The database's own words name the real reason (locked, payments
        // exist, unsupported country) far better than a generic string.
        description: err instanceof Error ? err.message : "Nothing was changed.",
      }),
  });
}

/**
 * Start the Square OAuth redirect.
 *
 * The `state` parameter is NOT ours to construct: `square-oauth-start` mints a
 * 256-bit nonce, stores it in `square_oauth_state` with the tenant, the mode
 * and a 30-minute expiry, and the callback consumes that row — which is what
 * binds the redirect back to this tenant and why the callback can run with
 * `verify_jwt = false`. The client's only job is to hand off to the URL the
 * server returns, unmodified.
 *
 * `mode` is the tenant's OWN `square_mode`, never a literal. Sandbox and
 * production are physically separate Square hosts with non-interchangeable
 * credentials, so connecting on the wrong one yields a link that can never
 * take a real payment. The lean product hides the concept of mode from the
 * operator (`isTestModeUiHidden`), but hiding it must not change it — this
 * sends whatever the row says and nothing here ever writes `square_mode`.
 *
 * WHERE THE OPERATOR COMES BACK. `square-oauth-start` accepts `returnTo` of
 * 'portal' or 'admin' only (anything else is a 400), and the callback strips
 * the path from `origin` — so the only landing it can produce for the portal is
 * `/settings?tab=payments&square=ok|incomplete|error[&reason=…]`, the v1
 * Payments tab, which reads that result and shows it. This board's own
 * `?square=` handling (`useSquareOAuthReturn`) is in place for the day a v2
 * start function can return here; until then it is simply never reached.
 */
export function useConnectSquare(tenant: PanelTenant, mode: SquareMode) {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("square-oauth-start", {
        body: {
          tenantId: tenant.id,
          mode,
          returnTo: "portal",
          origin: window.location.origin,
        },
      });
      if (error) await throwEdgeError(error);
      // The two OAuth-start precedents in this repo disagree on the field name
      // (`stripe-oauth-start` → { url }, `xero-oauth-start` → { authorizeUrl });
      // Square's returns { url } today. Accept either rather than break on a
      // rename in a function this file does not own.
      const payload = (data ?? {}) as { url?: string; authorizeUrl?: string };
      const url = payload.url ?? payload.authorizeUrl;
      if (!url) throw new Error("Square did not return an authorisation link.");
      // Same tab: a popup is blocked by default and the callback needs to land
      // the operator back in this portal.
      window.location.href = url;
      return true;
    },
    onError: (err) =>
      toast({
        variant: "destructive",
        title: "Could not open Square",
        description: err instanceof Error ? err.message : "Please try again.",
      }),
  });
}

export interface SquareDisconnectResult {
  ok: boolean;
  revokedAtSquare?: boolean;
  alreadyDisconnected?: boolean;
  message?: string;
}

/**
 * End the connection through `square-disconnect`.
 *
 * Mode-scoped, because the function requires it and never defaults: one
 * active sandbox row and one active production row coexist by design, and
 * disconnecting one must not take the other down. The function revokes at
 * Square first, then deletes both Vault secrets and flips the row to
 * 'revoked' — and if Square cannot be reached it still clears locally and SAYS
 * SO in `message`, which is why the toast shows the server's sentence rather
 * than a fixed one.
 */
export function useDisconnectSquare(tenant: PanelTenant, mode: SquareMode) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<SquareDisconnectResult> => {
      const { data, error } = await supabase.functions.invoke("square-disconnect", {
        body: { tenantId: tenant.id, mode },
      });
      if (error) await throwEdgeError(error);
      return (data ?? { ok: true }) as SquareDisconnectResult;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: squareStatusKey(tenant.id) });
      qc.removeQueries({ queryKey: ["v2-square-payment-health", tenant.id] });
      toast({
        title: result.alreadyDisconnected ? "Square was already disconnected" : "Square disconnected",
        description:
          result.message ??
          "New bookings cannot take card payments until Square is connected again.",
      });
    },
    onError: (err) =>
      toast({
        variant: "destructive",
        title: "Could not disconnect Square",
        description: err instanceof Error ? err.message : "Nothing was changed.",
      }),
  });
}

/* ────────────────────────── OAuth return handling ───────────────────────── */

/**
 * Wording for the `reason` codes `square-oauth-callback` redirects with.
 *
 * The first five are every code that function emits, read off it rather than
 * guessed: `state_expired`, `missing_code`, `connection_failed` (outcome
 * `error`) and `no_card_capable_location`, `currency_mismatch` (outcome
 * `incomplete`). The rest are Square's own OAuth error strings, which the
 * callback passes through when Square supplies one. Anything unlisted falls
 * through to the raw code, which still beats silence.
 */
const OAUTH_REASONS: Record<string, string> = {
  state_expired:
    "The connection request timed out before you finished authorising. Click Connect again and complete Square's screens without pausing.",
  missing_code: "Square redirected back without an authorisation code.",
  connection_failed:
    "Square authorised the connection, but we could not finish saving it. Please try again.",
  no_card_capable_location:
    "That Square account has no location that can take card payments yet. Create or activate a location in your Square dashboard, then reconnect.",
  currency_mismatch:
    "Your Square location bills in a different currency from this portal. Square never converts between currencies — align the two in Square, then reconnect.",
  access_denied: "The Square sign-in was cancelled before it finished.",
  invalid_request: "Square rejected the connection request.",
  invalid_client: "Square rejected our application credentials for this environment.",
  invalid_grant:
    "Square rejected the authorisation code — it is only valid for five minutes and only once.",
  unauthorized_client: "This portal is not authorised to connect that Square account.",
};

/**
 * Module-scoped, not a ref, and that is deliberate.
 *
 * The return lands on the BOARD with the dialog closed, so this hook is mounted
 * by the status chip, which paints on every card. The chip renders twice
 * whenever the dialog is open (card + header), and React StrictMode
 * double-invokes effects in dev, so a per-component ref would still fire the
 * toast twice. One flag per page load is the only guard that covers both.
 */
let squareOAuthReturnHandled = false;

/**
 * Notice a `?square=…` result on this page and say what it means.
 *
 * Honours the callback's real vocabulary (`ok` | `incomplete` | `error`, with
 * `reason`) plus a plain `connected` for any future start function that
 * returns here. Reads `window.location.search` rather than `useSearchParams()`
 * so the board does not need a Suspense boundary it does not own, and strips
 * the parameters with `history.replaceState` so the server component — which
 * re-resolves the v2 gate — is not re-run for a cosmetic URL change.
 *
 * `incomplete` is deliberately NOT an error. Nothing failed — the handshake
 * succeeded and the tokens are stored — but Square cannot take a card on this
 * connection yet, and Square emits NO event when that changes. So the panel's
 * "Setup unfinished" state stays on screen until the operator acts.
 */
export function useSquareOAuthReturn(tenant: PanelTenant) {
  const qc = useQueryClient();
  const { refetchTenant } = useTenant();

  useEffect(() => {
    if (squareOAuthReturnHandled) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("square");
    if (!result) return;
    squareOAuthReturnHandled = true;

    const reason = params.get("reason") ?? "";
    const explained = reason ? OAUTH_REASONS[reason] : undefined;

    params.delete("square");
    params.delete("reason");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);

    // The callback wrote the connection with the service role; nothing told
    // this tab. Refetch before claiming anything, and let the derivation decide
    // what to say — a redirect back is not by itself proof of a usable
    // connection.
    qc.invalidateQueries({ queryKey: squareStatusKey(tenant.id) });
    void refetchTenant?.();

    if (result === "ok" || result === "connected") {
      toast({
        title: "Back from Square",
        description: "Checking the connection — open the Square card to see its status.",
      });
    } else if (result === "incomplete") {
      toast({
        title: "One more step in Square",
        description:
          explained ??
          "Your Square account is linked, but it cannot take card payments yet. Finish Square's own setup, then reconnect.",
      });
    } else {
      toast({
        variant: "destructive",
        title: "Could not connect Square",
        description: explained ?? (reason ? `Square reported: ${reason}` : "Please try again."),
      });
    }
  }, [qc, refetchTenant, tenant.id]);
}
