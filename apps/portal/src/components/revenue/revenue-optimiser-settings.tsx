/**
 * RevenueOptimiserSettings — Spec §8.6
 *
 * Settings surface for safety rails + notifications + mode control.
 * Sections:
 *   1. Mode (Observation / Recommendations / Disabled) — uses toggleMode mutation
 *   2. Safety rails (sliders + numeric inputs)
 *   3. Notifications (switches)
 *   4. Cost floor — info card pointing at vehicle edit page
 *
 * Two-column settings layout per the Drive247 design system (304px label
 * column + flex content column).
 */
"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail, Bell, ShieldAlert, AlertTriangle, ExternalLink, Save } from "lucide-react";
import {
  RevenueOptimiserSettings as Settings,
  RevenueOptimiserSettingsUpdate,
  useRevenueOptimiserSettings,
  useToggleRevenueOptimiserMode,
  useUpdateRevenueOptimiserSettings,
} from "@/hooks/use-revenue-optimiser";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFeatureAccess } from "@/hooks/use-feature-access";
import Link from "next/link";

type ModeOption = "observation" | "recommendations" | "disabled";

export function RevenueOptimiserSettings() {
  const settings = useRevenueOptimiserSettings();
  const recommendationsAccess = useFeatureAccess("revenue_optimiser_recommendations");
  const toggleMode = useToggleRevenueOptimiserMode();
  const update = useUpdateRevenueOptimiserSettings();

  const [draft, setDraft] = useState<RevenueOptimiserSettingsUpdate | null>(null);

  // Seed editable draft once the row is loaded
  useEffect(() => {
    if (settings.data && draft === null) {
      setDraft({
        max_swing_percent: settings.data.max_swing_percent,
        weekend_max_increase_percent: settings.data.weekend_max_increase_percent,
        cost_floor_enabled: settings.data.cost_floor_enabled,
        require_approval_above_amount: settings.data.require_approval_above_amount,
        auto_pause_on_utilization_drop: settings.data.auto_pause_on_utilization_drop,
        auto_pause_threshold_percent: settings.data.auto_pause_threshold_percent,
        notify_daily_summary: settings.data.notify_daily_summary,
        notify_outcome: settings.data.notify_outcome,
        notify_anomalies: settings.data.notify_anomalies,
      });
    }
  }, [settings.data, draft]);

  if (settings.isLoading || !draft || !settings.data) {
    return <div className="text-sm text-[#737373]">Loading settings…</div>;
  }

  const current: Settings = settings.data;
  const dirty = JSON.stringify(draft) !== JSON.stringify(pickEditable(current));
  const mode: ModeOption = (current.enabled ? current.mode : "disabled") as ModeOption;

  const setField = <K extends keyof RevenueOptimiserSettingsUpdate>(key: K, value: RevenueOptimiserSettingsUpdate[K]) => {
    setDraft((prev) => ({ ...(prev ?? {}), [key]: value }));
  };

  return (
    <div className="space-y-10">
      {/* Mode */}
      <Section
        title="Mode"
        description="Insights mode collects data but never changes prices. Recommendations mode produces daily price suggestions for your team to apply."
      >
        <div className="space-y-2">
          <RadioRow
            label="Insights (observation)"
            description="Daily fleet observations. No price changes."
            checked={mode === "observation"}
            onSelect={() => toggleMode.mutate("observation")}
            disabled={toggleMode.isPending}
          />
          <RadioRow
            label="Recommendations"
            description={
              recommendationsAccess.canAccess
                ? "Daily per-vehicle price suggestions you can apply or dismiss."
                : `Available on the ${recommendationsAccess.requiredTierLabel} tier or higher.`
            }
            checked={mode === "recommendations"}
            onSelect={() => toggleMode.mutate("recommendations")}
            disabled={!recommendationsAccess.canAccess || toggleMode.isPending}
          />
          <RadioRow
            label="Disabled"
            description="Pauses the entire feature. Sidebar entry remains visible."
            checked={mode === "disabled"}
            onSelect={() => toggleMode.mutate("disabled")}
            disabled={toggleMode.isPending}
            tone="danger"
          />
        </div>
      </Section>

      {/* Safety rails */}
      <Section
        title="Safety rails"
        description="Hard guardrails that always apply — even if you set a custom price. Operators above the approval threshold see suggestions in a separate queue."
      >
        <div className="space-y-6">
          <SliderField
            label="Max swing per recommendation"
            value={Number(draft.max_swing_percent ?? current.max_swing_percent)}
            min={5} max={30} step={1}
            suffix="%"
            help="The largest single change Revenue Optimiser will ever propose. Defaults to 15% which matches industry norms."
            onChange={(v) => setField("max_swing_percent", v)}
          />
          <SliderField
            label="Max weekend uplift"
            value={Number(draft.weekend_max_increase_percent ?? current.weekend_max_increase_percent)}
            min={5} max={40} step={1}
            suffix="%"
            help="Combined with your weekend surcharge rules — the engine won't exceed this on weekend daily rates."
            onChange={(v) => setField("weekend_max_increase_percent", v)}
          />
          <NumberField
            label="Approval threshold"
            value={draft.require_approval_above_amount ?? null}
            placeholder="None"
            prefix="$"
            help="If a recommendation moves the price by more than this dollar amount, it requires manual approval — even in Autopilot."
            onChange={(v) => setField("require_approval_above_amount", v)}
          />
          <ToggleField
            label="Auto-pause on utilisation drop"
            checked={!!draft.auto_pause_on_utilization_drop}
            onChange={(v) => setField("auto_pause_on_utilization_drop", v)}
            help="If a vehicle's utilisation falls more than the threshold below after applying, we pause new recommendations for it."
          />
          {draft.auto_pause_on_utilization_drop && (
            <SliderField
              label="Auto-pause threshold"
              value={Number(draft.auto_pause_threshold_percent ?? current.auto_pause_threshold_percent)}
              min={5} max={40} step={1}
              suffix="%"
              help="Drop in utilisation post-apply that triggers the auto-pause."
              onChange={(v) => setField("auto_pause_threshold_percent", v)}
            />
          )}
        </div>
      </Section>

      {/* Cost floor */}
      <Section
        title="Cost floors"
        description="The engine will never recommend a price below your per-vehicle cost floor. Configure each vehicle's floor on its edit page."
      >
        <div className="space-y-3">
          <ToggleField
            label="Enforce cost floors"
            checked={!!draft.cost_floor_enabled}
            onChange={(v) => setField("cost_floor_enabled", v)}
            help="When on, vehicles with a configured cost floor cannot be priced below it. Vehicles without a floor are unaffected."
          />
          <div className="rounded-md border border-[#f1f5f9] bg-[#f8fafc] p-3">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 text-amber-600" />
              <div className="text-xs text-[#404040]">
                Per-vehicle cost floors live on the vehicle edit page under
                {" "}<span className="font-medium">Pricing safety</span>.
                <Link href="/vehicles" className="ml-1 inline-flex items-center gap-0.5 font-medium text-indigo-600 hover:underline">
                  Open vehicles <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Notifications */}
      <Section
        title="Notifications"
        description="Daily summaries and outcome reports go to your tenant admin email."
      >
        <div className="space-y-3">
          <ToggleField
            label="Daily morning summary"
            icon={Mail}
            checked={!!draft.notify_daily_summary}
            onChange={(v) => setField("notify_daily_summary", v)}
            help="Branded email at 07:30 UTC listing today's top recommendations."
          />
          <ToggleField
            label="Outcome notifications"
            icon={Bell}
            checked={!!draft.notify_outcome}
            onChange={(v) => setField("notify_outcome", v)}
            help="One-line email when an applied recommendation's 14-day outcome lands."
          />
          <ToggleField
            label="Anomaly alerts"
            icon={AlertTriangle}
            checked={!!draft.notify_anomalies}
            onChange={(v) => setField("notify_anomalies", v)}
            help="Get notified when a vehicle's revenue or utilisation deviates from expectation."
          />
        </div>
      </Section>

      {/* Save bar */}
      <div className="sticky bottom-0 -mx-6 flex items-center justify-end gap-2 border-t border-[#f1f5f9] bg-white/80 px-6 py-3 backdrop-blur">
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDraft(pickEditable(current))}
          disabled={!dirty || update.isPending}
        >
          Discard
        </Button>
        <Button
          size="sm"
          onClick={() => draft && update.mutate(draft)}
          disabled={!dirty || update.isPending}
          className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90"
        >
          {update.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}

function pickEditable(s: Settings): RevenueOptimiserSettingsUpdate {
  return {
    max_swing_percent: s.max_swing_percent,
    weekend_max_increase_percent: s.weekend_max_increase_percent,
    cost_floor_enabled: s.cost_floor_enabled,
    require_approval_above_amount: s.require_approval_above_amount,
    auto_pause_on_utilization_drop: s.auto_pause_on_utilization_drop,
    auto_pause_threshold_percent: s.auto_pause_threshold_percent,
    notify_daily_summary: s.notify_daily_summary,
    notify_outcome: s.notify_outcome,
    notify_anomalies: s.notify_anomalies,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Layout helpers
// ────────────────────────────────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-6 border-t border-[#f1f5f9] pt-8 first:border-t-0 first:pt-0 lg:grid-cols-[304px_1fr]">
      <header>
        <h2 className="text-base font-medium text-[#080812]">{title}</h2>
        <p className="mt-1 text-xs text-[#737373]">{description}</p>
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function RadioRow({
  label, description, checked, onSelect, disabled, tone,
}: { label: string; description: string; checked: boolean; onSelect: () => void; disabled?: boolean; tone?: "danger" }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`flex w-full items-start justify-between gap-3 rounded-md border px-4 py-3 text-left transition-colors
        ${checked
          ? tone === "danger"
            ? "border-red-200 bg-red-50/60"
            : "border-indigo-200 bg-indigo-50/60"
          : "border-[#f1f5f9] bg-white hover:border-indigo-200"}
        ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-medium ${tone === "danger" && checked ? "text-red-900" : "text-[#080812]"}`}>{label}</span>
        <span className="block text-xs text-[#737373]">{description}</span>
      </span>
      <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border ${checked ? (tone === "danger" ? "border-red-600 bg-red-600" : "border-indigo-600 bg-indigo-600") : "border-[#d4d4d8]"}`} />
    </button>
  );
}

function SliderField({
  label, value, min, max, step, suffix, help, onChange,
}: { label: string; value: number; min: number; max: number; step: number; suffix?: string; help?: string; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs font-medium text-[#404040]">{label}</Label>
        <span className="tabular-nums text-sm font-medium text-[#080812]">{value}{suffix}</span>
      </div>
      <Slider
        className="mt-2"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
      />
      {help && <p className="mt-1.5 text-[11px] text-[#737373]">{help}</p>}
    </div>
  );
}

function NumberField({
  label, value, onChange, prefix, placeholder, help,
}: { label: string; value: number | null; onChange: (v: number | null) => void; prefix?: string; placeholder?: string; help?: string }) {
  return (
    <div>
      <Label className="text-xs font-medium text-[#404040]">{label}</Label>
      <div className="mt-1 flex items-center gap-1">
        {prefix && <span className="text-sm text-[#737373]">{prefix}</span>}
        <Input
          type="number"
          min="0"
          step="1"
          placeholder={placeholder}
          value={value ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(null);
            const n = Number(raw);
            if (Number.isFinite(n)) onChange(n);
          }}
          className="h-9 max-w-[180px] text-sm"
        />
      </div>
      {help && <p className="mt-1.5 text-[11px] text-[#737373]">{help}</p>}
    </div>
  );
}

function ToggleField({
  label, checked, onChange, help, icon: Icon,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; help?: string; icon?: typeof Mail }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-[#f1f5f9] bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-3.5 w-3.5 text-[#737373]" />}
          <span className="text-sm font-medium text-[#080812]">{label}</span>
        </div>
        {help && <p className="mt-0.5 text-xs text-[#737373]">{help}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
