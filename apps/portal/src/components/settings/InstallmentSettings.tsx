"use client";

import { useEffect, useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTenant } from "@/contexts/TenantContext";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { useToast } from "@/hooks/use-toast";
import { InstallmentCalendar, type InstallmentCalendarItem } from "@/components/installments/InstallmentCalendar";
import { cn } from "@/lib/utils";

interface InstallmentConfig {
  weekly_enabled: boolean;
  weekly_payments_per_unit: 1 | 2;
  monthly_enabled: boolean;
  monthly_payments_per_unit: 1 | 2 | 4;
}

const WEEKLY_MIN_DAYS = 7;
const MONTHLY_MIN_DAYS = 30;
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;

function buildSampleSchedule(unit: "week" | "month", paymentsPerUnit: number, days: number, total: number): InstallmentCalendarItem[] {
  const span = unit === "week" ? WEEK_DAYS : MONTH_DAYS;
  const intervalDays = span / paymentsPerUnit;
  const count = Math.max(2, Math.floor(days / intervalDays));
  const per = Math.round((total / count) * 100) / 100;
  const start = new Date();
  return Array.from({ length: count }, (_, i) => {
    const due = new Date(start);
    due.setDate(due.getDate() + Math.round(i * intervalDays));
    return {
      number: i + 1,
      date: due.toISOString().split("T")[0],
      amount: i === count - 1 ? total - per * (count - 1) : per,
      status: "scheduled" as const,
    };
  });
}

export function InstallmentSettings() {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const { settings, updateSettings, isUpdating } = useRentalSettings();

  // The portal's TenantContext does NOT include installment_config in its
  // SELECT list, so we read from useRentalSettings() (which does SELECT *).
  // That way the toggles reflect the saved DB state on every (re)mount —
  // previously the component would read undefined, default to false, and
  // appear to "lose" the toggle after a tab switch / refetch.
  const tenantCfg = settings?.installment_config as unknown as
    | (Partial<InstallmentConfig> & Record<string, unknown>)
    | null
    | undefined;

  const [config, setConfig] = useState<InstallmentConfig>({
    weekly_enabled: false,
    weekly_payments_per_unit: 1,
    monthly_enabled: false,
    monthly_payments_per_unit: 1,
  });
  const [previewOpen, setPreviewOpen] = useState<null | { unit: "week" | "month"; paymentsPerUnit: number }>(null);

  // Hydrate local state from server when the server snapshot changes (initial
  // load, after save, refetches). Field-level deps avoid resyncing on
  // unrelated reference changes from React Query.
  useEffect(() => {
    if (!tenantCfg) return;
    setConfig({
      weekly_enabled: tenantCfg.weekly_enabled ?? false,
      weekly_payments_per_unit: (tenantCfg.weekly_payments_per_unit ?? 1) as 1 | 2,
      monthly_enabled: tenantCfg.monthly_enabled ?? false,
      monthly_payments_per_unit: (tenantCfg.monthly_payments_per_unit ?? 1) as 1 | 2 | 4,
    });
  }, [
    tenantCfg?.weekly_enabled,
    tenantCfg?.weekly_payments_per_unit,
    tenantCfg?.monthly_enabled,
    tenantCfg?.monthly_payments_per_unit,
  ]);

  async function save() {
    if (!tenant?.id) return;
    try {
      // Merge with the existing config so fields owned by the broader settings
      // page (charge_first_upfront, what_gets_split, minimum_days_*,
      // *_installments_limit, limiting_amount_per_day_*, grace_period_days,
      // max_retry_attempts, retry_interval_days) are preserved. The previous
      // implementation replaced the entire JSONB blob with just the 4 fields
      // managed here, silently wiping the rest.
      const merged = { ...(tenantCfg ?? {}), ...config };
      await updateSettings({ installment_config: merged as any });
      toast({ title: "Saved", description: "Installment settings updated." });
    } catch (error) {
      // useRentalSettings already shows an error toast — nothing to do here.
    }
  }

  const saving = isUpdating;

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border/60 rounded-lg p-6">
        <h2 className="text-lg font-medium text-foreground mb-1">Installments</h2>
        <p className="text-sm text-muted-foreground mb-4">Configure how customers can split their rental payments.</p>
        <div className="rounded-md bg-primary/10 border border-primary/30 px-4 py-3 text-sm text-foreground">
          <span className="font-medium">Note:</span> only the rental base amount, taxes, and service fees are split into installments.
          Insurance, deposits, and delivery fees are always paid upfront.
        </div>
      </div>

      <SectionRow
        label="Weekly Plan"
        sublabel={`Available for rentals ${WEEKLY_MIN_DAYS}+ days`}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={config.weekly_enabled}
              onCheckedChange={(v) => setConfig({ ...config, weekly_enabled: v })}
              id="weekly-enabled"
            />
            <Label htmlFor="weekly-enabled" className="text-sm text-foreground/90">Enable weekly installments</Label>
          </div>
          {config.weekly_enabled && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payments per week</div>
              <div className="flex items-center gap-2">
                <PillButton active={config.weekly_payments_per_unit === 1} onClick={() => setConfig({ ...config, weekly_payments_per_unit: 1 })}>1×</PillButton>
                <PillButton active={config.weekly_payments_per_unit === 2} onClick={() => setConfig({ ...config, weekly_payments_per_unit: 2 })}>2× (twice weekly)</PillButton>
                <button
                  type="button"
                  className="ml-auto inline-flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200"
                  onClick={() => setPreviewOpen({ unit: "week", paymentsPerUnit: config.weekly_payments_per_unit })}
                >
                  <Eye className="w-4 h-4" /> See example
                </button>
              </div>
            </div>
          )}
        </div>
      </SectionRow>

      <SectionRow
        label="Monthly Plan"
        sublabel={`Available for rentals ${MONTHLY_MIN_DAYS}+ days`}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={config.monthly_enabled}
              onCheckedChange={(v) => setConfig({ ...config, monthly_enabled: v })}
              id="monthly-enabled"
            />
            <Label htmlFor="monthly-enabled" className="text-sm text-foreground/90">Enable monthly installments</Label>
          </div>
          {config.monthly_enabled && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payments per month</div>
              <div className="flex items-center gap-2">
                <PillButton active={config.monthly_payments_per_unit === 1} onClick={() => setConfig({ ...config, monthly_payments_per_unit: 1 })}>1×</PillButton>
                <PillButton active={config.monthly_payments_per_unit === 2} onClick={() => setConfig({ ...config, monthly_payments_per_unit: 2 })}>2×</PillButton>
                <PillButton active={config.monthly_payments_per_unit === 4} onClick={() => setConfig({ ...config, monthly_payments_per_unit: 4 })}>4×</PillButton>
                <button
                  type="button"
                  className="ml-auto inline-flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200"
                  onClick={() => setPreviewOpen({ unit: "month", paymentsPerUnit: config.monthly_payments_per_unit })}
                >
                  <Eye className="w-4 h-4" /> See example
                </button>
              </div>
            </div>
          )}
        </div>
      </SectionRow>

      <div className="flex justify-end pt-2">
        <Button onClick={save} disabled={saving} className="bg-foreground text-background hover:bg-foreground/90">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Save changes
        </Button>
      </div>

      {previewOpen && (
        <ExampleDialog
          open={Boolean(previewOpen)}
          onClose={() => setPreviewOpen(null)}
          unit={previewOpen.unit}
          paymentsPerUnit={previewOpen.paymentsPerUnit}
          currencyCode={tenant?.currency_code || "USD"}
        />
      )}
    </div>
  );
}

function SectionRow({ label, sublabel, children }: { label: string; sublabel?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border/60 rounded-lg flex flex-col md:flex-row md:items-start gap-4 p-6">
      <div className="md:w-[304px] flex-none">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {sublabel ? <div className="text-xs text-muted-foreground mt-1">{sublabel}</div> : null}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function PillButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
        active
          ? "bg-primary/15 border-indigo-500/50 text-indigo-700 dark:text-indigo-300"
          : "bg-card border-border text-muted-foreground hover:bg-muted/40",
      )}
    >
      {children}
    </button>
  );
}

function ExampleDialog({ open, onClose, unit, paymentsPerUnit, currencyCode }: {
  open: boolean; onClose: () => void; unit: "week" | "month"; paymentsPerUnit: number; currencyCode: string;
}) {
  const sampleDays = unit === "week" ? (paymentsPerUnit === 1 ? 21 : 14) : (paymentsPerUnit === 1 ? 60 : paymentsPerUnit === 2 ? 60 : 30);
  const sampleTotal = unit === "week" ? (paymentsPerUnit === 1 ? 900 : 800) : (paymentsPerUnit === 1 ? 1200 : paymentsPerUnit === 2 ? 1200 : 800);
  const schedule = buildSampleSchedule(unit, paymentsPerUnit, sampleDays, sampleTotal);
  const label = unit === "week"
    ? (paymentsPerUnit === 1 ? "Weekly" : "Twice weekly")
    : (paymentsPerUnit === 1 ? "Monthly" : paymentsPerUnit === 2 ? "Twice monthly" : "Weekly via monthly");
  const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(n);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{label} — example</DialogTitle>
          <DialogDescription>
            Sample {sampleDays}-day rental, splittable amount {fmt(sampleTotal)}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-muted/40 border border-border/60 rounded-md p-4 text-sm text-foreground/90">
            Splittable {fmt(sampleTotal)} ÷ {schedule.length} payments → {fmt(schedule[0]?.amount ?? 0)} each
          </div>
          <InstallmentCalendar schedule={schedule} currencyCode={currencyCode} />
          <div className="text-xs text-muted-foreground">
            Customers will see these amounts and dates before checkout.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default InstallmentSettings;
