"use client";

// ── Stripe Connect panel ──────────────────────────────────────────────────────
//
// THE ONE THING TO UNDERSTAND BEFORE EDITING THIS FILE.
//
// There are TWO different Stripe connections on `tenants`, and their columns do
// not describe each other:
//
//   managed / Express  — `stripe_account_id`, `stripe_account_status`,
//                        `stripe_onboarding_complete`. An account the PLATFORM
//                        created on the legacy UK platform account, onboarded
//                        with `create-connected-account` +
//                        `get-connect-onboarding-link`.
//
//   own / Standard     — `own_stripe_account_id` (+ `own_stripe_test_account_id`
//                        for rehearsals), `own_stripe_connected_at`. The
//                        operator's OWN Stripe account, OAuth-linked to the UAE
//                        platform account via `stripe-oauth-start`.
//
// `stripe_account_status` and `stripe_onboarding_complete` are deliberately NOT
// maintained for an own account — `stripe-connect-webhook` says so in as many
// words, because `stripe_onboarding_complete` is a ROUTING decision read by
// `getConnectAccountId`, not a display flag. Rendering them as "your Stripe
// status" for an own-model tenant is precisely the bug that took Global Motion
// Transport offline for two days on 17 Aug 2026: the portal said "connected,
// onboarding complete" about the OLD managed account while Stripe had the NEW
// one paused, and they could not collect a penny across 10 live rentals.
//
// So this panel resolves WHICH account is real for this tenant first, and only
// then reads status columns — and it never shows an account id that is not
// actually the tenant's (in test the money routes to Drive247's shared Connect
// account, whose id is an edge-function env var and is nobody's business here).
//
// ⚠️ ISOLATION (V2_PLAN §5): RLS is OFF on `tenants`. Every read here carries
// `.eq('id', tenant.id)` and every edge-function call passes this tenant's id
// explicitly. There is no database net beneath either.

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Link2,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/stores/auth-store";
import { isTestModeUiHidden } from "@/lib/lean-areas";
import { Button } from "@/components/ui-v2/button";

import type { IntegrationPanelProps, IntegrationState, PanelTenant } from "./_kit";
import {
  CopyValue,
  PanelCard,
  PanelError,
  PanelLink,
  PanelLoading,
  PanelNote,
  PanelRow,
  PanelSection,
  StatusChip,
} from "./_kit";

/* ─────────────────────────────── data ───────────────────────────────────── */

/**
 * The tenant columns this panel reads. Kept as one string so the chip and the
 * dialog cannot drift into selecting different sets and disagreeing about the
 * same tenant.
 *
 * Every one of these is in the generated Supabase types today, so this stays on
 * the TYPED client. `payment_provider_locked_at` is deliberately absent: it is
 * not in the generated types, the typed client rejects an entire select
 * containing one unknown column, and the one-time processor choice it drives is
 * a different screen's job (`payment-provider-choice.tsx`), not this panel's.
 */
const TENANT_COLUMNS =
  "id, payment_provider, payment_model, stripe_mode, " +
  "stripe_account_id, stripe_account_status, stripe_onboarding_complete, " +
  "stripe_charges_enabled, stripe_payouts_enabled, stripe_requirements_due, " +
  "stripe_status_synced_at, stripe_account_disabled_reason, " +
  "own_stripe_account_id, own_stripe_connected_at, " +
  "own_stripe_test_account_id, own_stripe_test_connected_at, " +
  "company_name, contact_email, country";

interface StripeRow {
  id: string;
  payment_provider: string | null;
  payment_model: string | null;
  stripe_mode: string | null;
  stripe_account_id: string | null;
  stripe_account_status: string | null;
  stripe_onboarding_complete: boolean | null;
  stripe_charges_enabled: boolean | null;
  stripe_payouts_enabled: boolean | null;
  stripe_requirements_due: unknown;
  stripe_status_synced_at: string | null;
  stripe_account_disabled_reason: string | null;
  own_stripe_account_id: string | null;
  own_stripe_connected_at: string | null;
  own_stripe_test_account_id: string | null;
  own_stripe_test_connected_at: string | null;
  company_name: string | null;
  contact_email: string | null;
  country: string | null;
}

const queryKeyFor = (tenantId: string) => ["v2-stripe-connect", tenantId] as const;

/**
 * One fetch shared by the board chip and the dialog.
 *
 * The board paints a chip for every card at once, so this must be cheap: same
 * query key, so the chip's fetch is the one the panel then reuses, and a
 * `staleTime` long enough that opening the dialog does not re-hit the row.
 */
function useStripeConnect(tenant: PanelTenant) {
  return useQuery({
    queryKey: queryKeyFor(tenant.id),
    queryFn: async (): Promise<StripeRow> => {
      const { data, error } = await supabase
        .from("tenants")
        .select(TENANT_COLUMNS)
        // ⚠️ The only thing standing between this tenant and another operator's
        // payment routing. RLS is off on `tenants`.
        .eq("id", tenant.id)
        .single();
      if (error) throw error;
      return data as unknown as StripeRow;
    },
    staleTime: 30_000,
    retry: 1,
  });
}

/* ──────────────────────────── derivation ────────────────────────────────── */

type ConnectModel = "own" | "managed";

interface ConnectView {
  /** Which of the two connection shapes this tenant is on. */
  model: ConnectModel;
  /** What the tenant actually trades in. Presentation of it is gated separately. */
  mode: "test" | "live";
  /** Square tenants do not use this integration at all. */
  usesStripe: boolean;
  /** The operator's OWN account id, or null. Never the platform's shared one. */
  accountId: string | null;
  /** When that account was linked, where we record it (own model only). */
  connectedAt: string | null;
  /** Is money from bookings currently landing in the operator's own account? */
  receivingPayments: boolean;
  chargesEnabled: boolean | null;
  payoutsEnabled: boolean | null;
  requirementsDue: string[];
  disabledReason: string | null;
  syncedAt: string | null;
  state: IntegrationState;
  /** Short chip label. Says what is wrong, never dresses broken up as working. */
  label: string;
  /** One sentence of the same truth, for the panel body. */
  headline: string;
  /**
   * True in the single state that is actively losing money: the tenant routes
   * live charges through an own account that is not there. `getConnectAccountId`
   * THROWS on this rather than silently charging the platform, so every booking,
   * deposit and invoice fails until it is reconnected.
   */
  brokenRouting: boolean;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Mirrors `getConnectAccountId` in `supabase/functions/_shared/stripe-client.ts`.
 *
 * Kept as a derivation rather than a fetch because it is the question the whole
 * panel answers, and getting it wrong is worse than showing nothing: the
 * operator would be told an account is taking their money when a different one
 * is. If that helper's rules change, change these with them.
 */
function derive(row: StripeRow): ConnectView {
  const model: ConnectModel = row.payment_model === "own" ? "own" : "managed";
  const mode: "test" | "live" = row.stripe_mode === "live" ? "live" : "test";
  const usesStripe = row.payment_provider !== "square";

  const requirementsDue = asStringArray(row.stripe_requirements_due);
  const disabledReason = row.stripe_account_disabled_reason;
  const chargesEnabled = row.stripe_charges_enabled;
  const payoutsEnabled = row.stripe_payouts_enabled;

  // The account we may legitimately name. On the own model the operator always
  // links their REAL account (stripe-oauth-start is called with mode 'live'), so
  // the live column is the one that answers "which account is yours" even while
  // the tenant is still trading in test.
  const accountId = model === "own" ? row.own_stripe_account_id : row.stripe_account_id;
  const connectedAt = model === "own" ? row.own_stripe_connected_at : null;

  // Is the operator's own account the one being charged? Straight from
  // getConnectAccountId: an own tenant only routes to their account once
  // stripe_mode is live, and a managed tenant only once live AND onboarded.
  // Everything else routes to Drive247's shared Connect account or the platform
  // balance — i.e. not to them.
  const receivingPayments =
    model === "own"
      ? mode === "live" && !!row.own_stripe_account_id
      : mode === "live" && !!row.stripe_account_id && row.stripe_onboarding_complete === true;

  // The outage state: live + own model + no account. getConnectAccountId throws
  // here rather than falling back, so nothing can be charged at all.
  const brokenRouting = model === "own" && mode === "live" && !row.own_stripe_account_id;

  const base = {
    model,
    mode,
    usesStripe,
    accountId,
    connectedAt,
    receivingPayments,
    chargesEnabled,
    payoutsEnabled,
    requirementsDue,
    disabledReason,
    syncedAt: row.stripe_status_synced_at,
    brokenRouting,
  };

  if (!usesStripe) {
    return {
      ...base,
      state: "disconnected",
      label: "Not in use",
      headline: "Square is this account's payment processor, so Stripe is not taking any payments.",
    };
  }

  if (brokenRouting) {
    return {
      ...base,
      state: "attention",
      label: "Payments failing",
      headline:
        "Your bookings are set to settle into your own Stripe account, but no account is linked — " +
        "so payments, deposits and invoices are all failing. Reconnect Stripe to start taking money again.",
    };
  }

  if (!accountId) {
    return {
      ...base,
      state: "disconnected",
      label: "Not connected",
      headline:
        "No Stripe account is linked yet, so booking payments are not reaching your bank. " +
        "Connecting takes a couple of minutes.",
    };
  }

  // Ordered worst-first. Each rung is a different fix, so collapsing them would
  // tell the operator to do the wrong thing.
  if (disabledReason) {
    return {
      ...base,
      state: "attention",
      label: "Restricted by Stripe",
      headline: describeDisabledReason(disabledReason),
    };
  }

  if (chargesEnabled === false) {
    return {
      ...base,
      state: "attention",
      label: "Cannot take payments",
      headline:
        "Stripe is not letting this account accept payments yet. Open Stripe and finish what it is asking for — " +
        "payments switch over automatically the moment it does.",
    };
  }

  if (model === "managed" && row.stripe_onboarding_complete !== true) {
    return {
      ...base,
      state: "attention",
      label: "Setup unfinished",
      headline:
        "Your account exists but Stripe's verification is not finished, so payouts cannot be sent. " +
        "Pick up where you left off below.",
    };
  }

  if (requirementsDue.length > 0) {
    return {
      ...base,
      state: "attention",
      label: "Information needed",
      headline:
        "Stripe needs a few more details before this account is fully in the clear. " +
        "Until you provide them Stripe can pause payments or payouts without warning.",
    };
  }

  if (payoutsEnabled === false) {
    return {
      ...base,
      state: "attention",
      label: "Payouts paused",
      headline:
        "Payments are going through, but Stripe is holding the money rather than paying it out to your bank. " +
        "Open Stripe to see what it needs.",
    };
  }

  if (!receivingPayments) {
    // Connected, nothing wrong with the account — the switch just has not been
    // completed yet. stripe-connect-webhook finishes it on `account.updated`.
    return {
      ...base,
      state: "attention",
      label: "Not receiving yet",
      headline:
        "Your account is linked and healthy, but bookings are not settling into it yet. " +
        "This finishes on its own once Stripe confirms the account — usually within a few minutes.",
    };
  }

  return {
    ...base,
    state: "connected",
    label: "Connected",
    headline: "Booking payments and deposits are settling into your own Stripe account.",
  };
}

/* ────────────────────────── copy helpers ────────────────────────────────── */

/** Stripe's `requirements.disabled_reason` values, in the operator's language. */
function describeDisabledReason(reason: string): string {
  const map: Record<string, string> = {
    "requirements.past_due":
      "Stripe has paused this account because information it asked for is now overdue. Provide it in Stripe and payments resume.",
    "requirements.pending_verification":
      "Stripe is verifying the details you submitted. Nothing to do — this usually clears within a day or two.",
    "rejected.fraud": "Stripe has rejected this account. You will need to take this up with Stripe directly.",
    "rejected.terms_of_service":
      "Stripe has rejected this account for a terms of service breach. You will need to take this up with Stripe directly.",
    "rejected.listed": "Stripe has rejected this account. You will need to take this up with Stripe directly.",
    "rejected.other": "Stripe has rejected this account. You will need to take this up with Stripe directly.",
    listed: "Stripe has put this account under review. Nothing to do until they come back to you.",
    under_review: "Stripe is reviewing this account. Nothing to do until they come back to you.",
    platform_paused: "This account has been paused. Contact Drive247 support and we will pick it up with Stripe.",
    other: "Stripe has disabled this account. Open Stripe to see what it needs.",
  };
  return (
    map[reason] ??
    `Stripe has restricted this account (${reason}). Open Stripe to see what it needs.`
  );
}

/**
 * Stripe requirement keys, in the operator's language.
 *
 * The exact key is what Stripe shows in its own dashboard, so the fallback
 * prettifies rather than hides it — an operator matching our wording against
 * Stripe's list needs to recognise the row.
 */
const REQUIREMENT_LABELS: Record<string, string> = {
  external_account: "A bank account to be paid into",
  "business_profile.url": "Your business website",
  "business_profile.mcc": "What kind of business you run",
  "business_profile.product_description": "A description of what you rent out",
  "business_profile.support_phone": "A support phone number",
  "tos_acceptance.date": "Accepting Stripe's terms of service",
  "tos_acceptance.ip": "Accepting Stripe's terms of service",
  "company.name": "Your registered company name",
  "company.tax_id": "Your company tax ID",
  "company.address.line1": "Your company address",
  "company.verification.document": "A document proving your company details",
  "individual.id_number": "Your ID number",
  "individual.ssn_last_4": "The last 4 digits of your SSN",
  "individual.dob.day": "Your date of birth",
  "individual.address.line1": "Your home address",
  "individual.verification.document": "A photo of your ID",
  "individual.verification.additional_document": "A second proof of address or identity",
};

function describeRequirement(key: string): string {
  if (REQUIREMENT_LABELS[key]) return REQUIREMENT_LABELS[key];

  // `person_1Nabc.verification.document` — the id segment is noise to a human.
  const normalised = key.replace(/^person_[^.]+\./, "individual.");
  if (REQUIREMENT_LABELS[normalised]) return REQUIREMENT_LABELS[normalised];

  const words = normalised
    .split(".")
    .filter((seg) => seg !== "individual" && seg !== "company" && seg !== "relationship")
    .join(" ")
    .replace(/_/g, " ")
    .trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

/* ─────────────────────────── refresh plan ───────────────────────────────── */

type SyncStep = "connect-status" | "stripe-account";

/**
 * Which "re-read from Stripe" calls are truthful for THIS tenant, richest first.
 *
 * This is a safety gate, not a convenience. `sync-connect-status` resolves the
 * account through `getTenantChargeContext` → `getConnectAccountId`, which for a
 * tenant not yet routing through their own account returns **Drive247's shared
 * test Connect account**. Calling it then reads the PLATFORM's account and
 * writes its `charges_enabled` / `payouts_enabled` / requirements onto this
 * tenant's row — the panel would go green off somebody else's health. The cron
 * sweep never hits that because it filters on `stripe_onboarding_complete`; a
 * button wired to `{ tenantId }` has no such filter, so the filter lives here.
 *
 * `sync-stripe-account` reads the exact id it is handed, so it can only ever
 * describe the tenant's own account — but it only understands the managed
 * columns, and it WRITES the id it is given into `stripe_account_id`. Handing
 * it an own-Stripe id would overwrite the managed routing column, so it is
 * offered on the managed path only.
 *
 * `sync-connect-status` is also SUPER-ADMIN ONLY — it answers 403 to a
 * head_admin, which is what every operator running their own portal is. It is
 * therefore not a step that "sometimes fails" for them, it is a step they do
 * not have, and offering a button that always errors is not an honest control.
 * The mutation still handles a 403 defensively, in case this flag is stale.
 *
 * An empty plan is a real answer: for an own account there is no function a
 * normal operator can call to re-read it on demand. Stripe's `account.updated`
 * webhook is what keeps it current, and the panel says so rather than offering
 * a button that would lie.
 */
function syncPlan(view: ConnectView, row: StripeRow, isSuperAdmin: boolean): SyncStep[] {
  const plan: SyncStep[] = [];
  if (view.receivingPayments && isSuperAdmin) plan.push("connect-status");
  if (view.model === "managed" && row.stripe_account_id) plan.push("stripe-account");
  return plan;
}

/* ──────────────────────── edge function plumbing ────────────────────────── */

interface InvokeResult<T> {
  data: T | null;
  status: number | null;
  message: string | null;
}

/**
 * Invoke an edge function and recover the status code and the real message.
 *
 * supabase-js wraps any non-2xx in a `FunctionsHttpError` whose `message` is the
 * useless "Edge Function returned a non-2xx status code", with the actual
 * Response hidden on `.context`. Unwrapping it is the difference between this
 * screen telling an operator what Stripe said and telling them nothing — which
 * is most of the reason the panel exists.
 */
async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<InvokeResult<T>> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return { data: (data ?? null) as T | null, status: 200, message: null };

  const context = (error as { context?: Response }).context;
  let message = error.message || "Request failed";
  if (context && typeof context.json === "function") {
    try {
      const payload = await context.json();
      if (payload?.error) message = String(payload.error);
    } catch {
      /* body already consumed or not JSON — the generic message stands */
    }
  }
  return { data: null, status: context?.status ?? null, message };
}

/* ────────────────────────────── panel ───────────────────────────────────── */

export function StripeConnectStatus({ tenant }: { tenant: PanelTenant }) {
  const { data, isLoading, isError } = useStripeConnect(tenant);

  if (isLoading) return <StatusChip state="loading" />;
  // A failed READ is not a disconnected integration. Saying "Not connected"
  // here invites an operator to reconnect an account that is already live,
  // and reconnecting re-points where their customers' money lands.
  if (isError || !data) return <StatusChip state="attention" label="Status unavailable" />;

  const view = derive(data);
  return <StatusChip state={view.state} label={view.label} />;
}

export default function StripeConnectPanel({ tenant }: IntegrationPanelProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useStripeConnect(tenant);

  // Read from the auth store rather than queried: `sync-connect-status` is
  // super-admin only, and whether this caller HAS that control is a property of
  // the person, not of the tenant. Deliberately not read in the status chip —
  // the board paints every chip on first paint and a chip must not depend on
  // anything but the integration's own state.
  const { appUser } = useAuth();
  const isSuperAdmin = appUser?.is_super_admin === true;

  // Lean tenants have no test/live concept, so no mode row and no TEST badge.
  // Presentation only — nothing here reads or writes `stripe_mode`.
  const hideModeUi = isTestModeUiHidden(tenant.slug);

  const view = useMemo(() => (data ? derive(data) : null), [data]);

  // Both connect paths end in a full-page redirect, so the pending flag is
  // latched rather than cleared on success — the button must keep spinning
  // until the browser actually leaves.
  const [connecting, setConnecting] = useState(false);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeyFor(tenant.id) });
  }, [queryClient, tenant.id]);

  /* ── connect / resume onboarding ──────────────────────────────────────── */

  const connect = useCallback(async () => {
    if (!data || !view) return;
    setConnecting(true);
    try {
      if (view.model === "own") {
        // The operator links their OWN account, so this is Stripe's OAuth flow
        // on the UAE platform — NOT the managed Express account links below.
        // `mode: 'live'` is not a mode toggle: it is which platform credentials
        // sign the handshake, and an operator only ever connects the real
        // account they are paid into. A test-mode link is an admin rehearsal
        // tool and is deliberately not offered here.
        const res = await invokeFn<{ url?: string }>("stripe-oauth-start", {
          tenantId: tenant.id,
          mode: "live",
          returnTo: "portal",
          origin: window.location.origin,
        });
        if (!res.data?.url) throw new Error(res.message || "Could not create the connection link");
        window.location.href = res.data.url;
        return;
      }

      // Managed/Express: create the account on first run, or mint a fresh
      // account link to resume a half-finished one. Both functions accept the
      // return URLs, so the operator comes back to this board rather than to
      // the v1 settings page they never opened.
      const returnUrl = `${window.location.origin}/integrations?stripe=return`;
      const fnName = data.stripe_account_id ? "get-connect-onboarding-link" : "create-connected-account";
      const res = await invokeFn<{ onboardingUrl?: string }>(fnName, {
        tenantId: tenant.id,
        // Only read by create-connected-account, and only when it has to mint
        // the account. Harmless extra keys on the resume call.
        email: data.contact_email,
        businessName: data.company_name,
        country: data.country ?? undefined,
        returnUrl,
        refreshUrl: returnUrl,
      });
      if (!res.data?.onboardingUrl) throw new Error(res.message || "Could not start Stripe onboarding");
      // Same tab, deliberately: a popup here is blocked by default and the
      // operator sees a button that does nothing.
      window.location.href = res.data.onboardingUrl;
    } catch (e) {
      toast({
        title: "Could not open Stripe",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
      setConnecting(false);
    }
  }, [data, view, tenant.id]);

  /* ── refresh from Stripe ──────────────────────────────────────────────── */

  const syncMutation = useMutation({
    mutationFn: async (): Promise<{ full: boolean }> => {
      if (!data || !view) throw new Error("Status not loaded yet");

      const plan = syncPlan(view, data, isSuperAdmin);
      let lastMessage: string | null = null;

      for (const step of plan) {
        if (step === "connect-status") {
          // The richest answer: re-reads the account through the same resolver
          // the charge path uses and writes the whole truth set — charges,
          // payouts, requirements, disabled reason and `stripe_status_synced_at`.
          const res = await invokeFn<{ status?: { error?: string | null } }>("sync-connect-status", {
            tenantId: tenant.id,
          });
          if (res.data) {
            // A 200 can still carry a per-tenant failure (Stripe error, no
            // connected account). Surface Stripe's own words rather than
            // claiming a successful refresh.
            const inner = res.data.status?.error;
            if (inner) throw new Error(inner);
            return { full: true };
          }
          // 403 here is expected, not broken: this function is super-admin only.
          // Fall through to the next step if there is one.
          lastMessage = res.message;
          if (res.status !== 403) throw new Error(res.message || "Could not reach Stripe");
          continue;
        }

        // Managed only, and always against the id already on the tenant's own
        // row. Refreshes status and onboarding but not the health columns, so
        // the caller is told this was a partial answer.
        const res = await invokeFn<unknown>("sync-stripe-account", {
          tenantId: tenant.id,
          stripeAccountId: data.stripe_account_id,
        });
        if (res.data) return { full: false };
        lastMessage = res.message;
        throw new Error(res.message || "Could not reach Stripe");
      }

      throw new Error(
        lastMessage
          ? "A manual re-check has to be run by Drive247 on this account. Stripe still tells us automatically whenever anything changes."
          : "There is nothing to re-check yet.",
      );
    },
    onSuccess: ({ full }) => {
      invalidate();
      toast({
        title: "Checked with Stripe",
        description: full
          ? "This is Stripe's current answer for your account."
          : "Account status refreshed. Payout and requirement details are updated by Drive247's own check.",
      });
    },
    onError: (e: Error) => {
      toast({ title: "Could not check with Stripe", description: e.message, variant: "destructive" });
    },
  });

  /* ── render ───────────────────────────────────────────────────────────── */

  if (isLoading) return <PanelLoading rows={4} />;
  if (isError || !data || !view) {
    return (
      <PanelError
        message={error instanceof Error ? error.message : "Unknown error"}
        onRetry={() => void refetch()}
      />
    );
  }

  // Square tenants never touch this integration. Nothing below applies, and
  // offering a Connect button would start onboarding on a rail their refunds
  // could never come back through.
  if (!view.usesStripe) {
    return (
      <div className="space-y-4 pt-1">
        <PanelNote>{view.headline}</PanelNote>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Your payment processor is fixed once money has been taken, because a refund has to go back
          through whoever took the charge. Talk to Drive247 support if this looks wrong.
        </p>
      </div>
    );
  }

  const syncedRelative = relativeTime(view.syncedAt);
  const connectedOn = formatDate(view.connectedAt);
  const isConnected = !!view.accountId;
  const canCheckNow = syncPlan(view, data, isSuperAdmin).length > 0;

  // Where the operator finishes what Stripe is asking for. A Standard account
  // holder uses their own dashboard; an Express account holder has no full
  // dashboard at all and reaches theirs through Stripe's Express login. v1
  // linked everyone at /connect/accounts/overview, which is the PLATFORM's view
  // of its connected accounts — an operator following it sees a login they have
  // no account for.
  const stripeHref =
    view.model === "own" ? "https://dashboard.stripe.com" : "https://connect.stripe.com/express_login";

  const primaryLabel = view.brokenRouting
    ? "Reconnect Stripe"
    : !isConnected
      ? "Connect Stripe"
      : view.model === "managed" && data.stripe_onboarding_complete !== true
        ? "Finish setup in Stripe"
        : null;

  return (
    <div className="space-y-5 pt-1">
      {/* The headline. Tone tracks how much money is on the line: `danger` only
          for the state where every payment is actively failing. */}
      <PanelNote
        tone={view.brokenRouting ? "danger" : view.state === "attention" ? "warn" : "info"}
      >
        {view.headline}
      </PanelNote>

      {/* What Stripe is waiting for. Listed rather than counted — "3 requirements
          outstanding" tells an operator to go hunting; naming them tells them
          what to bring. */}
      {view.requirementsDue.length > 0 && (
        <PanelSection
          title="Stripe still needs"
          description="Provide these in Stripe. Nothing needs to be re-entered here."
        >
          <PanelCard>
            <ul className="space-y-1.5 py-0.5">
              {view.requirementsDue.map((key) => (
                <li key={key} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  <span>{describeRequirement(key)}</span>
                </li>
              ))}
            </ul>
          </PanelCard>
        </PanelSection>
      )}

      <PanelSection title="Account">
        <PanelCard className="divide-y divide-border/60">
          <PanelRow
            label="Receiving payments"
            hint={
              // The reassurance is only true while there IS a working charge
              // path. Under brokenRouting there is none — getConnectAccountId
              // throws — so telling the operator bookings still work would be
              // the exact lie this panel exists to stop.
              view.receivingPayments || view.brokenRouting
                ? undefined
                : "Bookings still work — the money is just not landing in your account yet."
            }
          >
            {view.receivingPayments ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <CheckCircle2 className="size-3.5" />
                Yes
              </span>
            ) : (
              <span className="text-muted-foreground">Not yet</span>
            )}
          </PanelRow>

          <PanelRow label="Payouts to your bank">
            {view.payoutsEnabled === true ? (
              "Enabled"
            ) : view.payoutsEnabled === false ? (
              <span className="text-warning">Paused by Stripe</span>
            ) : (
              <span className="text-muted-foreground">{isConnected ? "Not confirmed yet" : "—"}</span>
            )}
          </PanelRow>

          <PanelRow
            label="Stripe account"
            hint={isConnected ? undefined : "Nothing is linked to your business yet."}
          >
            {view.accountId ? (
              <CopyValue value={view.accountId} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </PanelRow>

          {connectedOn && <PanelRow label="Linked on">{connectedOn}</PanelRow>}

          {/* Mode is a concept the lean product does not have. Shown to everyone
              else because for them "test" is the difference between a rehearsal
              and a real charge. */}
          {!hideModeUi && (
            <PanelRow label="Stripe mode">
              {view.mode === "live" ? "Live" : "Test"}
            </PanelRow>
          )}

          <PanelRow
            label="Last checked with Stripe"
            hint={
              // A stale timestamp is not automatically a problem here: Stripe
              // pushes `account.updated` to us the moment anything changes, and
              // this row only records the times we asked. Saying so stops the
              // screen crying wolf at an account that is perfectly healthy.
              !view.syncedAt && isConnected
                ? "Stripe also tells us the moment anything changes, so an empty value here is not itself a problem."
                : undefined
            }
          >
            {syncedRelative ? (
              <span title={new Date(view.syncedAt as string).toLocaleString()}>{syncedRelative}</span>
            ) : (
              <span className="text-muted-foreground">Never</span>
            )}
          </PanelRow>
        </PanelCard>
      </PanelSection>

      {/* Actions. Connect first when there is nothing linked — for the canary
          that is the state an operator actually arrives in. */}
      <div className="flex flex-wrap items-center gap-2">
        {primaryLabel && (
          <Button onClick={() => void connect()} disabled={connecting}>
            {connecting ? <Loader2 className="animate-spin" /> : <Link2 />}
            {connecting ? "Opening Stripe…" : primaryLabel}
          </Button>
        )}

        {/* Rendered only when a truthful re-read exists for this tenant — see
            syncPlan. A button that would report the PLATFORM's shared account
            as this operator's is worse than no button. */}
        {canCheckNow && (
          <Button
            variant="outline"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {syncMutation.isPending ? "Checking…" : "Check with Stripe"}
          </Button>
        )}

        {isConnected && (
          <Button variant="ghost" asChild>
            <a href={stripeHref} target="_blank" rel="noopener noreferrer">
              Open Stripe
              <ArrowUpRight />
            </a>
          </Button>
        )}
      </div>

      {/* Said out loud rather than hidden, because "where is the refresh
          button?" is otherwise the obvious next question. There is genuinely no
          existing function that can re-read a linked-but-not-yet-routing
          account on demand; the webhook is what finishes it. */}
      {isConnected && !canCheckNow && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Stripe tells us the moment anything changes on this account, so what you see here keeps
          itself current. There is no manual re-check to run from this screen.
        </p>
      )}

      {/* Why there is no Disconnect button.
          There is no operator-facing disconnect in this codebase, and the two
          functions that come closest are not it: `delete-connected-account`
          DELETES the Stripe account outright (a tenant-teardown tool), and the
          revert path runs off Stripe's own `account.application.deauthorized`
          webhook. Inventing a button here would either destroy an account or
          leave the tenant on a routing decision with nothing behind it, which
          fails every subsequent charge. So: say what actually works. */}
      {isConnected && (
        <PanelSection title="Disconnecting">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <Ban className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Unlinking is not something you can do from here — it changes where your customers&rsquo;
              money goes, and in-progress rentals stop being chargeable the moment it happens.{" "}
              {view.model === "own"
                ? "If you do need to, revoke Drive247's access from your own Stripe settings — Stripe tells us straight away — but talk to support first if you have live rentals."
                : "This account was created for you by Drive247, so ask support to unlink it rather than closing it in Stripe."}
            </span>
          </p>
        </PanelSection>
      )}

      {!isConnected && (
        <PanelSection title="What happens when you connect">
          <ol className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            {[
              "Sign in to your Stripe account, or create one — it takes about two minutes.",
              "Stripe asks for your business details and the bank account you want paying.",
              "Once Stripe confirms the account, your bookings start settling straight into it.",
              "Stripe pays out to your bank on its own schedule from then on.",
            ].map((step, i) => (
              <li key={step} className="flex gap-2">
                <span className="shrink-0 text-primary">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            Prefer to read it first?{" "}
            <PanelLink href="https://stripe.com/connect">How Stripe Connect works</PanelLink>
          </p>
        </PanelSection>
      )}
    </div>
  );
}
