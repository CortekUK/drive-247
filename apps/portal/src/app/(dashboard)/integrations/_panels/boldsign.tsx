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

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

import { supabase } from "@/integrations/supabase/client";
import { useBoldSignMode } from "@/lib/lean-context";
import { Button } from "@/components/ui-v2/button";

import type { IntegrationPanelProps, PanelTenant } from "./_kit";
// Integration billing (northwind): e-signing is on the plan, no credits (D3).
import { isIntegrationBillingTenant } from "@/lib/integration-billing/gate";
import { StatusChip } from "./_kit";
import { Hero, ScreenNav } from "./_screens";
import { AgreementsEmptyArt } from "@/components/illustrations-v2/scenes/agreements";
import { DocumentsEmptyArt } from "@/components/illustrations-v2/scenes/documents";

/* ─────────────────────────────── constants ──────────────────────────────── */

/** `credit_costs.category` for a signature. Falls back to 7 — the same default
 *  `lib/esign-credit-alert.ts` uses, so the panel and the alert that fires
 *  behind it can never quote different numbers. */
const ESIGN_CATEGORY = "esign";
const DEFAULT_ESIGN_COST = 7;

/** `reminder_config.config_key` for the low-credit alert (v1 owns this key). */
const ALERT_CONFIG_KEY = "esign_low_credit";

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
    // Integration billing: no credits, so no wallet, cost or alert to read.
    enabled: !isIntegrationBillingTenant(tenant.slug),
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
  // Above the early returns below: `useBoldSignMode` is a hook, and a hook
  // called after a conditional return is a rules-of-hooks violation that only
  // shows up as "rendered fewer hooks than expected" once the read fails.
  const mode = useBoldSignMode(tenant.boldsign_mode);

  // Integration billing: e-signing is on the plan, so nothing here can run out
  // and the wallet is never read.
  if (isIntegrationBillingTenant(tenant.slug)) {
    return mode === "test"
      ? <StatusChip state="attention" label="Sandbox — not binding" />
      : <StatusChip state="connected" />;
  }

  // A failed read is not a broken integration. Saying "Not connected" here
  // would invite the operator to go looking for a connection that does not
  // exist (_kit: never render a failed read as disconnected).
  if (isError) return <StatusChip state="attention" label="Status unknown" />;
  if (isLoading || !data) return <StatusChip state="loading" />;

  if (mode === "test") return <StatusChip state="attention" label="Sandbox — not binding" />;

  const lowBar = data.alertThreshold ?? data.esignCost * 2;
  if (data.balance < data.esignCost)
    return <StatusChip state="attention" label="Out of credits" />;
  if (data.alertEnabled && data.balance < lowBar)
    return <StatusChip state="attention" label="Credits low" />;

  return <StatusChip state="connected" />;
}

/* ─────────────────────────────── panel ──────────────────────────────────── */

/**
 * KEPT SIMPLE ON PURPOSE (Ghulam, Oct 2 2026). BoldSign is not something an
 * operator connects — every Drive247 account signs through the platform's
 * BoldSign — so the dialog is two screens: what BoldSign is, then "it's
 * already set up", with one button to the Agreements page. The only thing
 * added to that is a single line when signing is genuinely not counting
 * (sandbox, or out of credits), because an operator relying on an unbinding
 * or unsent contract must hear it here.
 */
export default function BoldSignPanel({ tenant, onClose, onBack }: IntegrationPanelProps) {
  const [step, setStep] = useState<0 | 1>(0);
  const health = useBoldSignHealth(tenant);
  const mode = useBoldSignMode(tenant.boldsign_mode);

  const creditsRetired = isIntegrationBillingTenant(tenant.slug);
  const esignCost = health.data?.esignCost ?? DEFAULT_ESIGN_COST;
  const spendable = mode === "live" ? (health.data?.balance ?? 0) : (health.data?.testBalance ?? 0);
  const outOfCredits = !creditsRetired && !!health.data && spendable < esignCost;

  const warning =
    mode === "test"
      ? "You're signing in the sandbox right now — documents are watermarked, not legally binding, and deleted after 14 days."
      : outOfCredits
        ? `You're out of signing credits (${spendable} left, ${esignCost} per agreement), so the next agreement won't send until you top up.`
        : null;

  if (step === 0) {
    return (
      <div key="what" className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
        <Hero art={AgreementsEmptyArt} title="Contracts, signed online — and binding.">
          BoldSign is a trusted e-signature service. Your customer signs their rental agreement on their
          phone or computer, and every signature is legally binding, with a full record of who signed,
          when, and from where.
        </Hero>
        <ScreenNav className="mt-8" onBack={onBack} onNext={() => setStep(1)} />
      </div>
    );
  }

  return (
    <div key="ready" className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
      <Hero
        art={DocumentsEmptyArt}
        title="It's already set up for you."
        actions={
          <div className="flex justify-center">
            <Button className="h-10 rounded-2xl px-6" asChild>
              <Link href="/agreements" onClick={onClose}>
                Open agreements
                <ArrowRight />
              </Link>
            </Button>
          </div>
        }
      >
        BoldSign comes connected on every Drive247 account — there&rsquo;s nothing to sign in to. Send an
        agreement from any rental and your customer gets it to sign straight away.
        {warning && <span className="mt-2 block text-warning">{warning}</span>}
      </Hero>
      <ScreenNav className="mt-8" onBack={() => setStep(0)} />
    </div>
  );
}
