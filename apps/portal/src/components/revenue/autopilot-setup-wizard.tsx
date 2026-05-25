/**
 * AutopilotSetupWizard — 3-step Phase 3 onboarding (Spec §8.6).
 *
 *   Step 1 — Scope: choose which categories Autopilot covers. Existing rules
 *            are listed; missing categories get a "needs bounds" warning so
 *            the operator can't enable Autopilot for an unbounded category.
 *
 *   Step 2 — Safety rails: confirm max swing, approval threshold,
 *            auto-pause-on-drop. Pre-filled from current settings.
 *
 *   Step 3 — Review + Enable. Calls useToggleRevenueOptimiserMode("autopilot")
 *            plus useUpdateRevenueOptimiserSettings for the rails, then routes
 *            to /revenue.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check, ChevronRight, ChevronLeft, ShieldCheck, AlertTriangle, Loader2,
} from "lucide-react";
import { useRevenueOptimiserRules, useUpdateRule, useVehicleCategories } from "@/hooks/use-revenue-optimiser-rules";
import {
  useRevenueOptimiserSettings,
  useUpdateRevenueOptimiserSettings,
  useToggleRevenueOptimiserMode,
} from "@/hooks/use-revenue-optimiser";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const STEPS = ["Scope", "Safety rails", "Review"] as const;
type StepKey = typeof STEPS[number];

export function AutopilotSetupWizard() {
  const router = useRouter();
  const rulesQuery = useRevenueOptimiserRules();
  const categoriesQuery = useVehicleCategories();
  const settingsQuery = useRevenueOptimiserSettings();
  const updateRule = useUpdateRule();
  const updateSettings = useUpdateRevenueOptimiserSettings();
  const toggleMode = useToggleRevenueOptimiserMode();

  const [step, setStep] = useState<StepKey>("Scope");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [rails, setRails] = useState<{
    max_swing_percent: number;
    weekend_max_increase_percent: number;
    require_approval_above_amount: number | null;
    auto_pause_on_utilization_drop: boolean;
    auto_pause_threshold_percent: number;
  } | null>(null);

  // Seed rails from current settings once loaded
  useEffect(() => {
    if (!rails && settingsQuery.data) {
      setRails({
        max_swing_percent: settingsQuery.data.max_swing_percent ?? 15,
        weekend_max_increase_percent: settingsQuery.data.weekend_max_increase_percent ?? 25,
        require_approval_above_amount: settingsQuery.data.require_approval_above_amount,
        auto_pause_on_utilization_drop: settingsQuery.data.auto_pause_on_utilization_drop ?? true,
        auto_pause_threshold_percent: settingsQuery.data.auto_pause_threshold_percent ?? 20,
      });
    }
  }, [rails, settingsQuery.data]);

  // Pre-select categories that already have a rule with autopilot_enabled
  useEffect(() => {
    if (selectedCategories.size === 0 && rulesQuery.data) {
      const initial = new Set<string>(
        rulesQuery.data
          .filter((r) => r.category && r.autopilot_enabled)
          .map((r) => r.category!),
      );
      if (initial.size > 0) setSelectedCategories(initial);
    }
  }, [rulesQuery.data, selectedCategories.size]);

  const isLoading = rulesQuery.isLoading || categoriesQuery.isLoading || settingsQuery.isLoading || !rails;
  const isSubmitting = updateRule.isPending || updateSettings.isPending || toggleMode.isPending;

  const categoryRule = useMemo(() => {
    const m = new Map<string, ReturnType<typeof useRevenueOptimiserRules>["data"] extends Array<infer R> ? R : never>();
    for (const r of rulesQuery.data ?? []) {
      if (r.category) m.set(r.category, r);
    }
    return m;
  }, [rulesQuery.data]);

  if (isLoading) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>;
  }

  const stepIndex = STEPS.indexOf(step);
  const canAdvance =
    step === "Scope" ? selectedCategories.size > 0 :
    step === "Safety rails" ? true :
    true;

  const onNext = () => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]);
  const onBack = () => setStep(STEPS[Math.max(0, stepIndex - 1)]);

  const onFinish = async () => {
    if (!rails) return;
    // Step A: enable autopilot on each selected category's rule (skip those
    // without a rule — we showed a warning earlier).
    for (const cat of selectedCategories) {
      const rule = categoryRule.get(cat);
      if (!rule) continue;
      if (!rule.autopilot_enabled) {
        await updateRule.mutateAsync({ id: rule.id, patch: { autopilot_enabled: true } });
      }
    }
    // Step B: persist safety rails on settings
    await updateSettings.mutateAsync(rails);
    // Step C: flip mode
    await toggleMode.mutateAsync("autopilot");
    router.push("/revenue");
  };

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <ol className="flex items-center gap-4">
        {STEPS.map((s, i) => {
          const isActive = i === stepIndex;
          const isDone = i < stepIndex;
          return (
            <li key={s} className="flex items-center gap-2">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium
                ${isDone ? "bg-emerald-600 text-white" : isActive ? "bg-[#0f172a] text-white" : "bg-[#f1f5f9] text-[#737373]"}`}>
                {isDone ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <span className={`text-xs ${isActive ? "font-medium text-[#080812]" : "text-[#737373]"}`}>{s}</span>
              {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-[#737373]" />}
            </li>
          );
        })}
      </ol>

      {step === "Scope" && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-[#080812]">Which categories does autopilot cover?</h2>
          <p className="text-xs text-[#737373]">
            Autopilot acts on category-scoped rules. Categories without a rule still need bounds set on{" "}
            <Link href="/revenue/rules" className="text-indigo-600 hover:underline">Rules</Link> before they can be enabled.
          </p>
          {categoriesQuery.data && categoriesQuery.data.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#f1f5f9] bg-white p-6 text-center text-xs text-[#737373]">
              You have no vehicle categories yet. Add categories on the vehicle edit pages first.
            </div>
          ) : (
            <ul className="space-y-2">
              {(categoriesQuery.data ?? []).map((cat) => {
                const selected = selectedCategories.has(cat);
                const rule = categoryRule.get(cat);
                const ready = !!rule && (
                  (rule.min_price_daily != null && rule.max_price_daily != null) ||
                  (rule.min_price_weekly != null && rule.max_price_weekly != null) ||
                  (rule.min_price_monthly != null && rule.max_price_monthly != null)
                );
                return (
                  <li key={cat}>
                    <button
                      type="button"
                      onClick={() => {
                        const next = new Set(selectedCategories);
                        if (selected) next.delete(cat); else next.add(cat);
                        setSelectedCategories(next);
                      }}
                      className={`flex w-full items-start justify-between gap-3 rounded-md border px-4 py-3 text-left transition-colors
                        ${selected ? "border-indigo-300 bg-indigo-50" : "border-[#f1f5f9] bg-white hover:border-indigo-200"}`}
                    >
                      <div>
                        <div className="text-sm font-medium text-[#080812]">{cat}</div>
                        {!rule ? (
                          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700">
                            <AlertTriangle className="h-3 w-3" /> No rule yet — autopilot will not act until bounds are set.
                          </div>
                        ) : !ready ? (
                          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700">
                            <AlertTriangle className="h-3 w-3" /> Rule exists but needs min + max bounds for at least one tier.
                          </div>
                        ) : (
                          <div className="mt-0.5 text-[11px] text-[#737373]">
                            Bounded · ready for autopilot
                          </div>
                        )}
                      </div>
                      <div className={`mt-0.5 h-4 w-4 rounded-full border ${selected ? "border-indigo-600 bg-indigo-600" : "border-[#d4d4d8]"}`} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {step === "Safety rails" && rails && (
        <section className="space-y-5">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <Label className="text-xs font-medium text-[#404040]">Max swing per recommendation</Label>
              <span className="tabular-nums text-sm font-medium text-[#080812]">{rails.max_swing_percent}%</span>
            </div>
            <Slider className="mt-2" min={5} max={30} step={1} value={[rails.max_swing_percent]} onValueChange={(v) => setRails((r) => r ? { ...r, max_swing_percent: v[0] } : r)} />
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <Label className="text-xs font-medium text-[#404040]">Max weekend uplift</Label>
              <span className="tabular-nums text-sm font-medium text-[#080812]">{rails.weekend_max_increase_percent}%</span>
            </div>
            <Slider className="mt-2" min={5} max={40} step={1} value={[rails.weekend_max_increase_percent]} onValueChange={(v) => setRails((r) => r ? { ...r, weekend_max_increase_percent: v[0] } : r)} />
          </div>
          <div>
            <Label className="text-xs font-medium text-[#404040]">Approval threshold ($)</Label>
            <Input
              type="number"
              min="0"
              step="1"
              className="mt-1.5 h-9 max-w-[180px] text-sm"
              placeholder="No threshold"
              value={rails.require_approval_above_amount ?? ""}
              onChange={(e) => setRails((r) => r ? { ...r, require_approval_above_amount: e.target.value === "" ? null : Number(e.target.value) } : r)}
            />
            <p className="mt-1 text-[11px] text-[#737373]">Recs above this dollar delta queue for manual approval instead of auto-applying.</p>
          </div>
          <div className="flex items-center justify-between rounded-md border border-[#f1f5f9] bg-[#f8fafc] px-3 py-2">
            <div className="text-xs">
              <div className="font-medium text-[#080812]">Auto-pause on utilisation drop</div>
              <div className="text-[#737373]">If fleet utilisation drops by more than the threshold, autopilot pauses fleet-wide.</div>
            </div>
            <Switch checked={rails.auto_pause_on_utilization_drop} onCheckedChange={(v) => setRails((r) => r ? { ...r, auto_pause_on_utilization_drop: v } : r)} />
          </div>
          {rails.auto_pause_on_utilization_drop && (
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <Label className="text-xs font-medium text-[#404040]">Drop threshold</Label>
                <span className="tabular-nums text-sm font-medium text-[#080812]">{rails.auto_pause_threshold_percent}%</span>
              </div>
              <Slider className="mt-2" min={5} max={40} step={1} value={[rails.auto_pause_threshold_percent]} onValueChange={(v) => setRails((r) => r ? { ...r, auto_pause_threshold_percent: v[0] } : r)} />
            </div>
          )}
        </section>
      )}

      {step === "Review" && rails && (
        <section className="space-y-3">
          <div className="rounded-lg border border-[#f1f5f9] bg-white p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <h3 className="text-sm font-medium text-[#080812]">Ready to enable Autopilot</h3>
            </div>
            <dl className="mt-3 space-y-2 text-xs">
              <Row label="Categories" value={[...selectedCategories].join(", ") || "—"} />
              <Row label="Max swing" value={`${rails.max_swing_percent}%`} />
              <Row label="Weekend uplift cap" value={`${rails.weekend_max_increase_percent}%`} />
              <Row label="Approval threshold" value={rails.require_approval_above_amount != null ? `$${rails.require_approval_above_amount}` : "None"} />
              <Row label="Auto-pause" value={rails.auto_pause_on_utilization_drop ? `Yes (${rails.auto_pause_threshold_percent}% drop)` : "No"} />
            </dl>
          </div>
          <p className="text-[11px] text-[#737373]">
            Autopilot starts at 08:00 UTC tomorrow. Recommendations above the approval
            threshold queue for manual review instead of being applied. You can revert
            any auto-apply individually, and pause autopilot fleet-wide from{" "}
            <Link href="/revenue/settings" className="text-indigo-600 hover:underline">Settings</Link>.
          </p>
        </section>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-[#f1f5f9] pt-4">
        <Button variant="outline" onClick={onBack} disabled={stepIndex === 0 || isSubmitting}>
          <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Back
        </Button>
        {step === "Review" ? (
          <Button
            onClick={onFinish}
            disabled={!canAdvance || isSubmitting || selectedCategories.size === 0}
            className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90"
          >
            {isSubmitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
            Enable Autopilot
          </Button>
        ) : (
          <Button onClick={onNext} disabled={!canAdvance} className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90">
            Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[#737373]">{label}</dt>
      <dd className="text-right font-medium text-[#080812]">{value}</dd>
    </div>
  );
}
