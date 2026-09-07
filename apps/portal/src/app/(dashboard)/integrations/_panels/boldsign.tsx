"use client";

// ── BoldSign — e-signature ───────────────────────────────────────────────────
//
// WHAT THIS INTEGRATION ACTUALLY IS. BoldSign is not a per-tenant connection.
// The API keys are Drive247's (`BOLDSIGN_TEST_API_KEY` / `BOLDSIGN_LIVE_API_KEY`,
// held server-side and read by `api/esign/*` and `_shared/boldsign-client.ts`),
// and all 57 tenants send through them. There is no OAuth, no operator BoldSign
// login, and no per-tenant credential — so a Connect / Disconnect control here
// would be a button that lies, and an "Open your BoldSign dashboard" link would
// point at an account the operator cannot sign into. Neither is offered.
//
// What the operator DOES own is the three things this panel manages: the mode
// their documents are signed in, the brand their signing pages carry, and the
// credit balance that pays for each signature.
//
// WHY THERE IS NO TEST/LIVE SWITCH — this panel is deliberately NOT a port of
// v1's `components/settings/esign-settings.tsx`. That surface is built entirely
// around a Switch that writes `tenants.boldsign_mode`. The lean product has no
// test mode at all (`isTestModeUiHidden`), so for the canary that control has
// nothing to do: `resolveBoldSignMode()` already returns 'live' for a lean
// tenant whatever the column says. What replaces it is a read-only statement of
// the EFFECTIVE mode, because that is the fact with consequences — an operator
// who believes a watermarked sandbox document is a signed contract is holding an
// unenforceable rental agreement, and BoldSign deletes it after 14 days.
//
// AND WE DO NOT "FIX" THE COLUMN. northwind's `boldsign_mode` still reads
// 'test' while it signs live, and writing 'live' into it would look tidy and be
// wrong. Every rental and every `rental_agreements` row records its OWN
// `boldsign_mode`, and a document created against the sandbox key 404s against
// the live key — `api/esign/status` and the webhook both read the row's mode
// first for exactly that reason. The tenant column is history, not
// configuration. Nothing in this file writes it; the disagreement is shown
// instead, in the operator's own words.
//
// ⚠️ ISOLATION (V2_PLAN §5). RLS is off on every table touched here. Each query
// below carries `.eq('tenant_id', tenant.id)`, or `.eq('id', tenant.id)` on
// `tenants`. The one server call — POST /api/esign/status — runs as
// service_role and does NOT filter by tenant itself, so both ids handed to it
// are taken from a row this panel already read under a tenant filter. Do not
// change that to an id typed in from anywhere else.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  CircleDollarSign,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { isTestModeUiHidden, resolveBoldSignMode } from "@/lib/lean-areas";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Label } from "@/components/ui-v2/label";
import { Switch } from "@/components/ui-v2/switch";

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

/* ─────────────────────────────── constants ──────────────────────────────── */

/** `credit_costs.category` for a signature. Falls back to 7 — the same default
 *  `lib/esign-credit-alert.ts` uses, so the panel and the alert that fires
 *  behind it can never quote different numbers. */
const ESIGN_CATEGORY = "esign";
const DEFAULT_ESIGN_COST = 7;

/** `reminder_config.config_key` for the low-credit alert (v1 owns this key). */
const ALERT_CONFIG_KEY = "esign_low_credit";

/**
 * Statuses `api/esign/status` treats as final. It short-circuits on these and
 * never calls BoldSign, so re-checking one proves nothing about the
 * integration — which is why the verify button below only offers a document
 * that is genuinely still in flight.
 */
const TERMINAL_STATUSES = new Set([
  "completed",
  "signed",
  "declined",
  "voided",
  "expired",
]);

/** Statuses that mean the agreement never reached the customer. */
const BLOCKED_STATUSES = ["credit_failed", "send_failed"];

const STATUS_LABEL: Record<string, { text: string; tone: "ok" | "wait" | "bad" }> = {
  completed: { text: "Signed", tone: "ok" },
  signed: { text: "Signed", tone: "ok" },
  sent: { text: "Awaiting signature", tone: "wait" },
  delivered: { text: "Awaiting signature", tone: "wait" },
  pending: { text: "Draft", tone: "wait" },
  declined: { text: "Declined", tone: "bad" },
  voided: { text: "Voided", tone: "bad" },
  expired: { text: "Expired", tone: "bad" },
  credit_failed: { text: "Blocked — no credits", tone: "bad" },
  send_failed: { text: "Send failed", tone: "bad" },
};

/* ─────────────────────────────── data ───────────────────────────────────── */

type Health = {
  /** Live wallet — what a live-mode signature actually spends. */
  balance: number;
  /** Sandbox wallet. Only spent while a tenant signs in test mode. */
  testBalance: number;
  autoRefillEnabled: boolean;
  autoRefillThreshold: number;
  autoRefillAmount: number;
  esignCost: number;
  /** Per-tenant low-credit alert, or null when the tenant never set one. */
  alertThreshold: number | null;
  alertEnabled: boolean;
};

/**
 * The one read both the board chip and the dialog need.
 *
 * Batched into a single React Query entry rather than three, because the chip
 * paints on the board's first render alongside six other integrations: one
 * cache entry with one staleTime is cheaper to reason about than three that can
 * refetch out of step and make the chip and the panel disagree.
 *
 * Deliberately NOT filed under v1's `["credit-wallet", tenant.id]` key even
 * though `use-credit-wallet.ts` reads the same row. That hook does `select("*")`
 * and `/credits` renders the whole wallet object; seeding its cache entry with
 * the four columns below would leave that page rendering a half-populated
 * wallet until its next refetch.
 */
function useBoldSignHealth(tenant: PanelTenant) {
  return useQuery({
    queryKey: ["boldsign-panel", "health", tenant.id],
    queryFn: async (): Promise<Health> => {
      const [walletRes, costRes, alertRes] = await Promise.all([
        (supabase as any)
          .from("tenant_credit_wallets")
          .select(
            "balance, test_balance, auto_refill_enabled, auto_refill_threshold, auto_refill_amount",
          )
          .eq("tenant_id", tenant.id)
          .maybeSingle(),
        // Platform-wide price list — no tenant column to filter on.
        (supabase as any)
          .from("credit_costs")
          .select("cost_credits")
          .eq("category", ESIGN_CATEGORY)
          .eq("is_active", true)
          .maybeSingle(),
        (supabase as any)
          .from("reminder_config")
          .select("config_value")
          .eq("tenant_id", tenant.id)
          .eq("config_key", ALERT_CONFIG_KEY)
          .maybeSingle(),
      ]);

      if (walletRes.error) throw walletRes.error;
      if (costRes.error) throw costRes.error;
      if (alertRes.error) throw alertRes.error;

      const cfg = (alertRes.data?.config_value ?? null) as
        | { threshold?: number; enabled?: boolean }
        | null;

      return {
        balance: Number(walletRes.data?.balance ?? 0),
        testBalance: Number(walletRes.data?.test_balance ?? 0),
        autoRefillEnabled: !!walletRes.data?.auto_refill_enabled,
        autoRefillThreshold: Number(walletRes.data?.auto_refill_threshold ?? 0),
        autoRefillAmount: Number(walletRes.data?.auto_refill_amount ?? 0),
        esignCost: Number(costRes.data?.cost_credits ?? DEFAULT_ESIGN_COST) || DEFAULT_ESIGN_COST,
        alertThreshold: typeof cfg?.threshold === "number" ? cfg.threshold : null,
        alertEnabled: cfg?.enabled !== false,
      };
    },
    staleTime: 60_000,
  });
}

type AgreementRow = {
  id: string;
  rental_id: string;
  agreement_type: string;
  document_id: string | null;
  document_status: string | null;
  created_at: string | null;
  envelope_sent_at: string | null;
  envelope_completed_at: string | null;
};

type Activity = {
  recent: AgreementRow[];
  total: number;
  blocked: number;
  brandTestId: string | null;
  brandLiveId: string | null;
  logoUrl: string | null;
  companyName: string | null;
  hasCustomTemplate: boolean;
};

/**
 * Everything the dialog adds on top of the chip.
 *
 * Recent activity is read from `rental_agreements`, NOT from `esign_usage_log`.
 * The usage log is dead: it holds 22 rows for a single tenant, newest
 * 2026-03-07, and the only writer is the `report-usage-event` edge function,
 * which nothing in this repo calls. `rental_agreements` is where every send
 * lands — including the failures, which are the rows an operator most needs to
 * see. If per-signature Stripe metering is ever wired up, this is the query to
 * revisit; until then reading the log would show a live integration as idle.
 */
function useBoldSignActivity(tenant: PanelTenant) {
  return useQuery({
    queryKey: ["boldsign-panel", "activity", tenant.id],
    queryFn: async (): Promise<Activity> => {
      const [recentRes, totalRes, blockedRes, tenantRes, templateRes] = await Promise.all([
        (supabase as any)
          .from("rental_agreements")
          .select(
            "id, rental_id, agreement_type, document_id, document_status, created_at, envelope_sent_at, envelope_completed_at",
          )
          .eq("tenant_id", tenant.id)
          .order("created_at", { ascending: false })
          .limit(5),
        (supabase as any)
          .from("rental_agreements")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id),
        (supabase as any)
          .from("rental_agreements")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .in("document_status", BLOCKED_STATUSES),
        // Brand ids and the logo the brand is built from are not in
        // TenantContext's column list, so they are fetched here — by id, which
        // is the tenant filter for `tenants` itself.
        (supabase as any)
          .from("tenants")
          .select(
            "boldsign_test_brand_id, boldsign_live_brand_id, logo_url, company_name",
          )
          .eq("id", tenant.id)
          .maybeSingle(),
        (supabase as any)
          .from("agreement_templates")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("is_active", true),
      ]);

      // Every one of these throws rather than falling back to 0/false. A count
      // that failed and a count that is genuinely zero look identical once it
      // reaches the screen, and "Nothing sent yet" on a tenant with 300 signed
      // agreements is the failed-read-as-a-state trap _kit warns about.
      if (recentRes.error) throw recentRes.error;
      if (totalRes.error) throw totalRes.error;
      if (blockedRes.error) throw blockedRes.error;
      if (tenantRes.error) throw tenantRes.error;
      if (templateRes.error) throw templateRes.error;

      return {
        recent: (recentRes.data ?? []) as AgreementRow[],
        total: totalRes.count ?? 0,
        blocked: blockedRes.count ?? 0,
        brandTestId: tenantRes.data?.boldsign_test_brand_id ?? null,
        brandLiveId: tenantRes.data?.boldsign_live_brand_id ?? null,
        logoUrl: tenantRes.data?.logo_url ?? null,
        companyName: tenantRes.data?.company_name ?? null,
        hasCustomTemplate: (templateRes.count ?? 0) > 0,
      };
    },
    staleTime: 30_000,
  });
}

/* ─────────────────────────────── chip ───────────────────────────────────── */

/**
 * Board chip.
 *
 * "Connected" is the wrong axis for BoldSign — the platform key means every
 * tenant is always connected — so the chip answers the question that actually
 * has a bad answer: will the next agreement go out? It will not if the tenant
 * has fewer credits than one signature costs, and it is not worth having if it
 * goes out in sandbox mode.
 *
 * The low-credit warning uses the tenant's configured alert threshold when one
 * exists and `cost x 2` otherwise — the same default `lib/esign-credit-alert.ts`
 * applies, so the chip turns amber on exactly the balance that raises the
 * reminder.
 */
export function BoldSignStatus({ tenant }: { tenant: PanelTenant }) {
  const { data, isLoading, isError } = useBoldSignHealth(tenant);

  // A failed read is not a broken integration. Saying "Not connected" here
  // would invite the operator to go looking for a connection that does not
  // exist (_kit: never render a failed read as disconnected).
  if (isError) return <StatusChip state="attention" label="Status unknown" />;
  if (isLoading || !data) return <StatusChip state="loading" />;

  const mode = resolveBoldSignMode(tenant.boldsign_mode, tenant.slug);

  if (mode === "test") return <StatusChip state="attention" label="Sandbox — not binding" />;

  const lowBar = data.alertThreshold ?? data.esignCost * 2;
  if (data.balance < data.esignCost)
    return <StatusChip state="attention" label="Out of credits" />;
  if (data.alertEnabled && data.balance < lowBar)
    return <StatusChip state="attention" label="Credits low" />;

  return <StatusChip state="connected" label="Ready to sign" />;
}

/* ─────────────────────────────── panel ──────────────────────────────────── */

export default function BoldSignPanel({ tenant, onClose }: IntegrationPanelProps) {
  const queryClient = useQueryClient();
  const health = useBoldSignHealth(tenant);
  const activity = useBoldSignActivity(tenant);

  const mode = resolveBoldSignMode(tenant.boldsign_mode, tenant.slug);
  const hideModeUi = isTestModeUiHidden(tenant.slug);
  /** The stored column and the mode actually used are allowed to disagree. */
  const storedMode = (tenant.boldsign_mode as string | null) ?? "test";
  const columnDisagrees = storedMode !== mode;

  const esignCost = health.data?.esignCost ?? DEFAULT_ESIGN_COST;
  const spendable = mode === "live" ? (health.data?.balance ?? 0) : (health.data?.testBalance ?? 0);
  const agreementsLeft = esignCost > 0 ? Math.floor(spendable / esignCost) : 0;

  /* ── low-credit alert threshold ────────────────────────────────────────── */

  const [thresholdDraft, setThresholdDraft] = useState<string | null>(null);
  const currentThreshold = health.data?.alertThreshold ?? esignCost * 2;
  const alertEnabled = health.data?.alertEnabled ?? true;
  const thresholdValue = thresholdDraft ?? String(currentThreshold);
  // An empty or non-numeric box is not "threshold 0" — 0 is a legitimate value
  // meaning "only warn me once they are gone", so it cannot double as the
  // sentinel for an unparseable field.
  const parsedThreshold =
    thresholdValue.trim() === "" || Number.isNaN(Number(thresholdValue))
      ? null
      : Number(thresholdValue);
  const thresholdDirty = parsedThreshold !== null && parsedThreshold !== currentThreshold;

  // Written here rather than through v1's `use-esign-credit-alert-config`
  // because the read is already batched into `useBoldSignHealth` above; mounting
  // that hook only for its mutation would fire a fourth request for a row this
  // panel is holding. The write is the same upsert against the same key, and it
  // invalidates v1's cache entry too so Settings cannot go stale behind us.
  const saveAlert = useMutation({
    mutationFn: async (next: { threshold: number; enabled: boolean }) => {
      const { data: existing, error: readErr } = await (supabase as any)
        .from("reminder_config")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("config_key", ALERT_CONFIG_KEY)
        .maybeSingle();
      if (readErr) throw readErr;

      if (existing?.id) {
        // Filtered by tenant as well as id: the row was found under a tenant
        // filter, and with RLS off the second predicate is what makes a wrong
        // id unable to write into another operator's config.
        const { error } = await (supabase as any)
          .from("reminder_config")
          .update({ config_value: next, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .eq("tenant_id", tenant.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("reminder_config").insert({
          config_key: ALERT_CONFIG_KEY,
          config_value: next,
          tenant_id: tenant.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setThresholdDraft(null);
      queryClient.invalidateQueries({ queryKey: ["boldsign-panel", "health", tenant.id] });
      queryClient.invalidateQueries({ queryKey: ["esign-credit-alert-config", tenant.id] });
      toast({ title: "Low-credit alert updated" });
    },
    onError: (err: any) =>
      toast({
        title: "Could not save the alert",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      }),
  });

  /* ── verify: re-check a live document against BoldSign ─────────────────── */

  // The only genuine health probe the portal can make. There is no BoldSign
  // credentials-test endpoint (unlike Bonzah's `bonzah-verify-credentials`), and
  // the API key is the platform's, so "is BoldSign answering for this tenant?"
  // can only be asked about a real document. `api/esign/status` short-circuits
  // on a terminal status and on a row with no document_id, so neither is
  // offered — a button that returns a cached row would look like a passing
  // health check while proving nothing.
  const recheckable = useMemo(
    () =>
      (activity.data?.recent ?? []).find(
        (a) => a.document_id && !TERMINAL_STATUSES.has(a.document_status ?? ""),
      ) ?? null,
    [activity.data],
  );

  const recheck = useMutation({
    mutationFn: async (row: AgreementRow) => {
      const res = await fetch("/api/esign/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Both ids come from a row read under `.eq('tenant_id', tenant.id)`.
        // The route runs as service_role and does not re-check the tenant.
        body: JSON.stringify({ agreementId: row.id, rentalId: row.rental_id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `BoldSign check failed (HTTP ${res.status})`);
      }
      return json as { status?: string; source?: string };
    },
    onSuccess: (json) => {
      queryClient.invalidateQueries({ queryKey: ["boldsign-panel", "activity", tenant.id] });
      toast({
        title: "BoldSign responded",
        description:
          json.source === "db-cache"
            ? "That document had already reached a final state — nothing to re-check."
            : `Document is ${STATUS_LABEL[json.status ?? ""]?.text ?? json.status ?? "unknown"}.`,
      });
    },
    onError: (err: any) =>
      toast({
        title: "BoldSign did not answer",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      }),
  });

  /* ── render ────────────────────────────────────────────────────────────── */

  if (health.isError || activity.isError) {
    const err = (health.error ?? activity.error) as any;
    return (
      <PanelError
        message={err?.message ?? "Unknown error"}
        onRetry={() => {
          health.refetch();
          activity.refetch();
        }}
      />
    );
  }

  if (health.isLoading || activity.isLoading) return <PanelLoading rows={4} />;

  const brandId = mode === "live" ? activity.data!.brandLiveId : activity.data!.brandTestId;
  const otherBrandId = mode === "live" ? activity.data!.brandTestId : activity.data!.brandLiveId;
  const outOfCredits = spendable < esignCost;

  return (
    <div className="space-y-5">
      {/* ── Signing ─────────────────────────────────────────────────────── */}
      <PanelSection
        title="Signing"
        description="BoldSign runs on Drive247's account — there is no separate login to connect."
      >
        {mode === "test" && (
          <PanelNote tone="danger">
            Documents are being signed in the BoldSign <strong>sandbox</strong>. They are
            watermarked, <strong>not legally binding</strong>, and BoldSign deletes them after 14
            days. Do not rely on one as a rental contract.
          </PanelNote>
        )}

        <PanelCard className="divide-y">
          <PanelRow
            label="Mode"
            hint={
              mode === "live"
                ? "Signed documents are legally binding."
                : "Sandbox — watermarked and deleted after 14 days."
            }
          >
            <span className={mode === "live" ? "text-success" : "text-warning"}>
              {mode === "live" ? "Live" : "Sandbox"}
            </span>
          </PanelRow>
          <PanelRow label="Cost per agreement" hint="Charged on send, refunded if BoldSign rejects it.">
            {esignCost} credits
          </PanelRow>
          <PanelRow
            label="Agreement template"
            hint={
              activity.data!.hasCustomTemplate
                ? "Your own wording is used."
                : "The platform's standard wording is used."
            }
          >
            <Link
              href="/settings/agreement-templates"
              onClick={onClose}
              className="text-primary hover:underline"
            >
              {activity.data!.hasCustomTemplate ? "Custom" : "Platform default"}
            </Link>
          </PanelRow>
        </PanelCard>

        {/* The tension the canary actually sits in: the column says one thing,
            the signing key is another. Shown rather than silently corrected —
            writing the column would misdescribe every document already signed
            under the old value. */}
        {columnDisagrees && (
          <PanelNote>
            An older setting on this account still reads{" "}
            <span className="font-mono">{storedMode}</span>, but it is not what your agreements use
            — they are signed <strong>{mode}</strong>
            {hideModeUi ? ", because your plan has no sandbox mode" : ""}. It is left as it is on
            purpose: every document already signed carries the mode it was created in, and that is
            what we reopen it with. Rewriting the setting would not change any of them.
          </PanelNote>
        )}
      </PanelSection>

      {/* ── Branding ────────────────────────────────────────────────────── */}
      <PanelSection
        title="Signing page branding"
        description="What your customer sees on the BoldSign page and the signing email."
      >
        <PanelCard className="divide-y">
          <PanelRow label="Sender name">{activity.data!.companyName ?? "—"}</PanelRow>
          <PanelRow
            label="Brand ID"
            mono
            hint={
              brandId
                ? "Created once, from your logo and company name."
                : "Created automatically on your first agreement."
            }
          >
            {brandId ? (
              <CopyValue value={brandId} />
            ) : (
              <span className="text-muted-foreground">Not created yet</span>
            )}
          </PanelRow>
          {/* Only rendered when a brand from the other mode exists — history,
              not something to act on. */}
          {otherBrandId && (
            <PanelRow label={mode === "live" ? "Sandbox brand" : "Live brand"} mono>
              <CopyValue value={otherBrandId} />
            </PanelRow>
          )}
        </PanelCard>

        {!brandId && !activity.data!.logoUrl && (
          <PanelNote tone="warn">
            You have no logo set. Your brand is built the first time you send an agreement, and
            without a logo it falls back to a plain tile of your initials — which is then what every
            future signing page carries, because the brand is created once and not refreshed. Add a
            logo in{" "}
            <Link href="/settings?tab=branding" onClick={onClose} className="underline">
              Settings &rarr; Branding
            </Link>{" "}
            before your first agreement goes out.
          </PanelNote>
        )}

        {brandId && (
          <PanelNote>
            The brand was built from the logo and company name you had at the time and is not
            rebuilt when those change. Contact support to refresh it.
          </PanelNote>
        )}
      </PanelSection>

      {/* ── Credits ─────────────────────────────────────────────────────── */}
      <PanelSection
        title="Credits"
        description="Every signature is paid for from your credit balance."
      >
        {outOfCredits && (
          <PanelNote tone="danger">
            <strong>The next agreement will fail.</strong> You have {spendable} credits and each
            agreement costs {esignCost}. Until you top up, agreements are parked unsent and your
            customer never receives the contract.
          </PanelNote>
        )}

        <PanelCard className="divide-y">
          <PanelRow
            label={mode === "live" ? "Balance" : "Sandbox balance"}
            hint={
              mode === "live"
                ? undefined
                : "Sandbox signing spends the test wallet, not your live credits."
            }
          >
            <span className={outOfCredits ? "text-destructive" : undefined}>{spendable}</span>
          </PanelRow>
          <PanelRow label="Agreements remaining">
            {agreementsLeft === 0 ? (
              <span className="text-destructive">None</span>
            ) : (
              `~${agreementsLeft}`
            )}
          </PanelRow>
          <PanelRow
            label="Auto top-up"
            hint={
              health.data!.autoRefillEnabled
                ? `Buys ${health.data!.autoRefillAmount} credits below ${health.data!.autoRefillThreshold}.`
                : "Off — credits run out silently unless the alert below is on."
            }
          >
            {health.data!.autoRefillEnabled ? "On" : "Off"}
          </PanelRow>
        </PanelCard>

        <Button variant="outline" size="sm" asChild>
          <Link href="/credits" onClick={onClose}>
            <CircleDollarSign className="size-3.5" />
            Buy credits
          </Link>
        </Button>

        {/* The one setting on this screen worth changing. Without it an operator
            finds out they are out of credits from a customer who never got the
            contract. */}
        <PanelCard className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="boldsign-alert-enabled" className="text-sm">
                Warn me when credits run low
              </Label>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/70">
                Raises a reminder before agreements start failing.
              </p>
            </div>
            <Switch
              id="boldsign-alert-enabled"
              checked={alertEnabled}
              disabled={saveAlert.isPending}
              onCheckedChange={(next) =>
                saveAlert.mutate({ threshold: parsedThreshold ?? currentThreshold, enabled: next })
              }
            />
          </div>

          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Label htmlFor="boldsign-alert-threshold" className="text-xs text-muted-foreground">
                Warn below (credits)
              </Label>
              <Input
                id="boldsign-alert-threshold"
                type="number"
                min={0}
                className="mt-1"
                value={thresholdValue}
                disabled={!alertEnabled || saveAlert.isPending}
                onChange={(e) => setThresholdDraft(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={!thresholdDirty || saveAlert.isPending}
              onClick={() =>
                parsedThreshold !== null &&
                saveAlert.mutate({ threshold: parsedThreshold, enabled: alertEnabled })
              }
            >
              {saveAlert.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        </PanelCard>
      </PanelSection>

      {/* ── Activity ────────────────────────────────────────────────────── */}
      <PanelSection
        title="Recent agreements"
        description={
          activity.data!.total === 0
            ? "Nothing sent yet."
            : `${activity.data!.total} sent${
                activity.data!.blocked > 0 ? ` · ${activity.data!.blocked} never delivered` : ""
              }`
        }
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={!recheckable || recheck.isPending}
            title={
              recheckable
                ? "Ask BoldSign for this document's current state"
                : "No recent agreement is awaiting signature"
            }
            onClick={() => recheckable && recheck.mutate(recheckable)}
          >
            {recheck.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Re-check
          </Button>
        }
      >
        {activity.data!.blocked > 0 && (
          <PanelNote tone="warn">
            <AlertTriangle className="mr-1 inline size-3 align-[-2px]" />
            {activity.data!.blocked} agreement{activity.data!.blocked === 1 ? "" : "s"} never reached
            a customer. Open one from{" "}
            <Link href="/agreements" onClick={onClose} className="underline">
              Agreements
            </Link>{" "}
            to resend it.
          </PanelNote>
        )}

        {activity.data!.recent.length === 0 ? (
          <PanelCard>
            <p className="py-1 text-xs text-muted-foreground">
              No agreement has been sent from this account yet. The first one creates your BoldSign
              brand and spends {esignCost} credits.
            </p>
          </PanelCard>
        ) : (
          <PanelCard className="divide-y">
            {activity.data!.recent.map((row) => {
              const meta = STATUS_LABEL[row.document_status ?? ""] ?? {
                text: row.document_status ?? "Unknown",
                tone: "wait" as const,
              };
              const when =
                row.envelope_completed_at ?? row.envelope_sent_at ?? row.created_at;
              return (
                <PanelRow
                  key={row.id}
                  label={row.agreement_type === "extension" ? "Extension" : "Rental agreement"}
                  hint={when ? format(new Date(when), "d MMM yyyy") : undefined}
                >
                  <span
                    className={
                      meta.tone === "ok"
                        ? "text-success"
                        : meta.tone === "bad"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    {meta.text}
                  </span>
                </PanelRow>
              );
            })}
          </PanelCard>
        )}

        {activity.data!.total > 0 && (
          <Link
            href="/agreements"
            onClick={onClose}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            All agreements
            <ExternalLink className="size-3" />
          </Link>
        )}
      </PanelSection>
    </div>
  );
}
