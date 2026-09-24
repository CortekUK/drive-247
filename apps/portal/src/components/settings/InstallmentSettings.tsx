"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button as ButtonV2 } from "@/components/ui-v2/button";
import { Switch as SwitchV2 } from "@/components/ui-v2/switch";
import {
  Dialog as DialogV2,
  DialogContent as DialogContentV2,
  DialogDescription as DialogDescriptionV2,
  DialogFooter as DialogFooterV2,
  DialogHeader as DialogHeaderV2,
  DialogTitle as DialogTitleV2,
} from "@/components/ui-v2/dialog";
import { useTenant } from "@/contexts/TenantContext";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { useToast } from "@/hooks/use-toast";
import { InstallmentCalendar, type InstallmentCalendarItem } from "@/components/installments/InstallmentCalendar";
import { cn } from "@/lib/utils";
import { useV2 } from "@/lib/v2-context";
import type { RegisterSectionSave } from "@/components/settings-v2/pricing-money-parts";
import { useRegisterLeaveSave } from "@/components/settings-v2/business-section-save";
import { SettingsPanel, SettingsRow, SettingsRowAlignProvider, useSettingsPageSave } from "@/components/settings-v2/settings-kit";
import {
  formatSettingsNumber,
  SettingsDependencyNotice,
  SettingsLoadError,
  SettingsReadOnlyFieldset,
  SettingsSaveState,
  SettingsSectionSkeleton,
  useSettingsAccess,
  useSettingsSaveStatus,
  useWarnOnUnsavedChanges,
} from "@/components/settings-v2/section-states";
import {
  installmentDraftFromConfig,
  isInstallmentDraftDirty,
  paymentProviderState,
  planMinimumDays,
  planOnlineMinimumDays,
} from "@/lib/settings-money-states";

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

/**
 * v2: the plan rows' controls are locked for a view-only user and while the
 * plans save. A context, so the pill buttons read it without a prop on each.
 * Always false for every other tenant.
 */
const PlanLockV2 = createContext(false);

/** v2: "Available for rentals 7+ days", with the online minimum when checkout's is later. */
function planAvailabilityLabelV2(
  cfg: Parameters<typeof planMinimumDays>[0],
  plan: "weekly" | "monthly",
): string {
  const days = planMinimumDays(cfg, plan);
  const online = planOnlineMinimumDays(cfg, plan);
  const base = `Available for rentals ${formatSettingsNumber(days)}+ days`;
  return online > days ? `${base} (${formatSettingsNumber(online)}+ when booked online)` : base;
}

/** v2: a link-styled button (See example), light purple in dark mode. */
const V2_INLINE_LINK =
  "inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]";

/**
 * Installments: the checkout switch (`tenants.installments_enabled`) and the
 * weekly and monthly plans (`tenants.installment_config`).
 *
 * v1 saves the switch the moment it flips and the plans with their own Save.
 *
 * v2 (northwind) is one form. The switch and the plans are a draft, and the
 * settings page's save bar saves them in one write: `registerSave` hands the
 * page this section's save and discard (key "installments") while it holds
 * unsaved edits, so the bar's Save changes and Reset, and the page's "Save
 * your changes?" dialog on the way out, cover it. Inside the page's save bar
 * (`useSettingsPageSave`) the section shows no Save of its own, only why a
 * save failed. Rendered outside one, it keeps a Save.
 */
export function InstallmentSettings({ registerSave }: { registerSave?: RegisterSectionSave } = {}) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const { settings, updateSettings, isUpdating } = useRentalSettings();

  // v2 (northwind): read state for the loading / failed-read gate below, who
  // may edit, whether the page's save bar owns Save, and the inline save
  // state. The hooks run for every tenant; only the v2 branch renders anything
  // from them.
  const v2Chrome = useV2("chrome");
  const rentalSettingsReadV2 = useRentalSettings();
  const { canEdit: canEditV2 } = useSettingsAccess("installments");
  const pageSaveV2 = useSettingsPageSave();
  const [savingPlansV2, setSavingPlansV2] = useState(false);
  const [plansErrorV2, setPlansErrorV2] = useState<unknown>(null);

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

  // Master gate the CHECKOUT actually reads (tenants.installments_enabled). The
  // weekly/monthly toggles below only configure the plans (installment_config);
  // without this ON, the split-payment option never appears at checkout — the
  // customer pays in full. v1: instant-save (like the Pay As You Go toggle).
  // v2: part of the form, saved with the plans.
  const [installmentsEnabled, setInstallmentsEnabled] = useState(false);

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

  // Keep the master toggle reflecting the saved DB value on load / after save / refetch.
  useEffect(() => {
    setInstallmentsEnabled(settings?.installments_enabled ?? false);
  }, [settings?.installments_enabled]);

  // v2: the switch and the plans are local until saved, so say when they
  // differ from what is saved, and warn before the page is closed with them
  // unsaved.
  const savedEnabledV2 = settings?.installments_enabled ?? false;
  const masterDirtyV2 = v2Chrome && installmentsEnabled !== savedEnabledV2;
  const plansDirtyV2 = v2Chrome && isInstallmentDraftDirty(config, tenantCfg);
  const dirtyV2 = masterDirtyV2 || plansDirtyV2;
  const plansStatusV2 = useSettingsSaveStatus({ isDirty: dirtyV2, isPending: savingPlansV2, error: plansErrorV2 });
  useWarnOnUnsavedChanges(dirtyV2);
  // v2: a view-only user, or a save in flight (a toggle flipped mid-save would
  // be overwritten by the saved row when it lands), cannot change the form.
  const planLockedV2 = v2Chrome && (!canEditV2 || savingPlansV2);

  // v2: putting every edit back (Reset, "Don't save", or flipping it back by
  // hand) clears a stale save error.
  useEffect(() => {
    if (!dirtyV2) setPlansErrorV2(null);
  }, [dirtyV2]);

  // v2: one write for whatever changed: the checkout switch, the plans merged
  // into the saved config (see `save` for why they are merged), or both.
  // Resolves false, with the error kept for the section, when it did not save.
  const plansErrorRefV2 = useRef<unknown>(null);
  async function saveV2(): Promise<boolean> {
    if (!tenant?.id) return false;
    const updates: Record<string, unknown> = {};
    if (masterDirtyV2) updates.installments_enabled = installmentsEnabled;
    if (plansDirtyV2) updates.installment_config = { ...(tenantCfg ?? {}), ...config };
    if (Object.keys(updates).length === 0) return true;
    setPlansErrorV2(null);
    plansErrorRefV2.current = null;
    setSavingPlansV2(true);
    try {
      await updateSettings(updates as never);
      return true;
    } catch (error) {
      // useRentalSettings already shows an error toast; the section says it too.
      setPlansErrorV2(error);
      plansErrorRefV2.current = error;
      return false;
    } finally {
      setSavingPlansV2(false);
    }
  }
  const discardV2 = () => {
    setPlansErrorV2(null);
    setConfig(installmentDraftFromConfig(tenantCfg));
    setInstallmentsEnabled(savedEnabledV2);
  };

  // v2: while the form holds unsaved edits, the settings page's save bar saves
  // it, its Reset discards it, and leaving asks first. The page's save REJECTS
  // when the write failed, so the page stays put and the bar says why.
  useRegisterLeaveSave(
    v2Chrome ? registerSave : undefined,
    "installments",
    dirtyV2 && canEditV2,
    async () => {
      if (await saveV2()) return;
      throw plansErrorRefV2.current ?? new Error("Couldn't save your installment settings.");
    },
    discardV2,
  );

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
      return true;
    } catch (error) {
      // useRentalSettings already shows an error toast — nothing to do here.
    }
  }

  const saving = isUpdating;

  // v2: no switch that writes may render over placeholder defaults. Until a
  // real row arrives, a skeleton; if it never does, the error with a retry.
  if (v2Chrome && !rentalSettingsReadV2.hasLoaded) {
    return rentalSettingsReadV2.error ? (
      <SettingsLoadError
        thing="installment settings"
        error={rentalSettingsReadV2.error}
        onRetry={() => rentalSettingsReadV2.refetch()}
        retrying={rentalSettingsReadV2.isFetching}
      />
    ) : (
      <SettingsSectionSkeleton variant="form" rows={3} label="Loading installment settings" />
    );
  }

  if (v2Chrome) {
    const controlsLocked = !canEditV2 || savingPlansV2;
    // Inside the page's save bar only a failed save is said here; the bar says the rest.
    const footer = pageSaveV2 ? (
      plansStatusV2 === "error" ? <SettingsSaveState status="error" error={plansErrorV2} /> : undefined
    ) : canEditV2 ? (
      <div className="flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-2">
        <SettingsSaveState
          status={plansStatusV2}
          error={plansErrorV2}
          onRetry={saveV2}
          onDiscard={discardV2}
          className="mr-auto"
        />
        <ButtonV2
          type="button"
          size="sm"
          onClick={() => void saveV2()}
          disabled={saving || savingPlansV2 || !dirtyV2}
          className="min-w-[112px]"
        >
          {savingPlansV2 && <Loader2 className="animate-spin" data-icon="inline-start" />}
          Save changes
        </ButtonV2>
      </div>
    ) : undefined;

    return (
      <div className="space-y-6">
        {rentalSettingsReadV2.error ? (
          <SettingsLoadError
            variant="inline"
            thing="installment settings"
            error={rentalSettingsReadV2.error}
            onRetry={() => rentalSettingsReadV2.refetch()}
            retrying={rentalSettingsReadV2.isFetching}
          />
        ) : null}

        {installmentsEnabled && !config.weekly_enabled && !config.monthly_enabled && (
          <SettingsDependencyNotice
            tone="warning"
            title="Installments is on, but no plan is enabled"
            body="Customers will still pay in full. Turn on the weekly or monthly plan below, then save."
          />
        )}
        {installmentsEnabled && paymentProviderState(settings as never) === "missing" && (
          <SettingsDependencyNotice
            tone="warning"
            title="No payment provider is connected"
            body="Installment payments are charged to the customer's card through your payment provider, and none is connected yet."
            action={{ label: "Open Integrations", href: "/integrations" }}
          />
        )}

        {/* LAYOUT. The label and its help take the row and the control sits at
            its end — the house style for a v2 settings form (settings-kit.tsx).
            This page is not in the settings page's `V2_PAGES_CONTROLS_AT_END`,
            so without this its switches sat mid-row while Pay as you go and
            Auto-extension, the two pages beside it in the Payment plans group,
            put theirs at the end (payment-modes-v2.tsx carries the same
            provider for the same reason). */}
        <SettingsRowAlignProvider align="end">
        <SettingsPanel footer={footer}>
          {/* The checkout switch. A disabled fieldset for a view-only user, so
              the keyboard cannot flip what the mouse cannot. */}
          <SettingsReadOnlyFieldset readOnly={!canEditV2}>
            <SettingsRow
              label="Offer installments at checkout"
              description="Customers split the rental, tax and service fees into payments. Insurance, deposits and delivery are always paid upfront."
              note={
                installmentsEnabled ? undefined : (
                  <p className="text-muted-foreground">Turn this on to set up the weekly and monthly plans below.</p>
                )
              }
            >
              <SwitchV2
                checked={installmentsEnabled}
                onCheckedChange={setInstallmentsEnabled}
                disabled={controlsLocked}
                aria-label="Offer installments at checkout"
              />
            </SettingsRow>
          </SettingsReadOnlyFieldset>

          {/* The plans. Kept, dimmed and disabled (mouse and keyboard) while
              the switch is off, so nothing configured is lost. */}
          <PlanLockV2.Provider value={planLockedV2}>
            <fieldset
              disabled={!installmentsEnabled}
              className={cn("m-0 min-w-0 border-0 p-0 transition-opacity", !installmentsEnabled && "opacity-60")}
            >
              <SettingsRow label="Weekly plan" description={planAvailabilityLabelV2(tenantCfg, "weekly")} htmlFor="weekly-enabled">
                <SwitchV2
                  id="weekly-enabled"
                  checked={config.weekly_enabled}
                  onCheckedChange={(v) => setConfig({ ...config, weekly_enabled: v })}
                  disabled={!installmentsEnabled || planLockedV2}
                />
              </SettingsRow>
              {/* Indented, because the divider that used to say "this row
                  belongs to the one above" went with the panel border
                  (settings-kit.tsx). Same 20px as locations-v2's `SubRow`. */}
              {config.weekly_enabled && (
                <SettingsRow label="Payments per week" description="How often the customer pays in each week of the rental.">
                  <PillButton active={config.weekly_payments_per_unit === 1} onClick={() => setConfig({ ...config, weekly_payments_per_unit: 1 })}>1×</PillButton>
                  <PillButton active={config.weekly_payments_per_unit === 2} onClick={() => setConfig({ ...config, weekly_payments_per_unit: 2 })}>2× (twice weekly)</PillButton>
                  <button
                    type="button"
                    className={cn(V2_INLINE_LINK, "ml-1")}
                    onClick={() => setPreviewOpen({ unit: "week", paymentsPerUnit: config.weekly_payments_per_unit })}
                  >
                    <Eye className="size-4" aria-hidden="true" /> See example
                  </button>
                </SettingsRow>
              )}
              <SettingsRow label="Monthly plan" description={planAvailabilityLabelV2(tenantCfg, "monthly")} htmlFor="monthly-enabled">
                <SwitchV2
                  id="monthly-enabled"
                  checked={config.monthly_enabled}
                  onCheckedChange={(v) => setConfig({ ...config, monthly_enabled: v })}
                  disabled={!installmentsEnabled || planLockedV2}
                />
              </SettingsRow>
              {config.monthly_enabled && (
                <SettingsRow label="Payments per month" description="How often the customer pays in each month of the rental.">
                  <PillButton active={config.monthly_payments_per_unit === 1} onClick={() => setConfig({ ...config, monthly_payments_per_unit: 1 })}>1×</PillButton>
                  <PillButton active={config.monthly_payments_per_unit === 2} onClick={() => setConfig({ ...config, monthly_payments_per_unit: 2 })}>2×</PillButton>
                  <PillButton active={config.monthly_payments_per_unit === 4} onClick={() => setConfig({ ...config, monthly_payments_per_unit: 4 })}>4×</PillButton>
                  <button
                    type="button"
                    className={cn(V2_INLINE_LINK, "ml-1")}
                    onClick={() => setPreviewOpen({ unit: "month", paymentsPerUnit: config.monthly_payments_per_unit })}
                  >
                    <Eye className="size-4" aria-hidden="true" /> See example
                  </button>
                </SettingsRow>
              )}
            </fieldset>
          </PlanLockV2.Provider>
        </SettingsPanel>
        </SettingsRowAlignProvider>

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

      {/* Master enable — this is the flag the CHECKOUT reads (tenants.installments_enabled).
          Instant-save, mirroring the Pay As You Go toggle. Passing ONLY installments_enabled
          leaves installment_config (the plans below) untouched. */}
      <div className="flex items-start justify-between gap-3 bg-card border border-border/60 rounded-lg p-6">
        <div className="space-y-1 min-w-0">
          <h4 className="font-medium text-foreground">Enable Installments</h4>
          <p className="text-sm text-muted-foreground">
            Turn on to offer the split-payment option at checkout. When off, customers pay in full even if the plans below are
            configured. It applies to rentals that meet each plan&apos;s minimum length.
          </p>
        </div>
        <Switch
          className="shrink-0 mt-0.5"
          checked={installmentsEnabled}
          onCheckedChange={async (checked) => {
            setInstallmentsEnabled(checked);
            try {
              await updateSettings({ installments_enabled: checked });
              toast({ title: checked ? "Installments enabled" : "Installments disabled" });
            } catch {
              setInstallmentsEnabled(!checked);
            }
          }}
        />
      </div>

      {!installmentsEnabled && (
        <p className="-mt-2 px-1 text-xs text-muted-foreground">
          Turn on <span className="font-medium">Enable Installments</span> above to configure the plans below.
        </p>
      )}

      <SectionRow label="Weekly Plan" sublabel={`Available for rentals ${WEEKLY_MIN_DAYS}+ days`} disabled={!installmentsEnabled}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={config.weekly_enabled}
              onCheckedChange={(v) => setConfig({ ...config, weekly_enabled: v })}
              disabled={!installmentsEnabled}
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

      <SectionRow label="Monthly Plan" sublabel={`Available for rentals ${MONTHLY_MIN_DAYS}+ days`} disabled={!installmentsEnabled}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={config.monthly_enabled}
              onCheckedChange={(v) => setConfig({ ...config, monthly_enabled: v })}
              disabled={!installmentsEnabled}
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

function SectionRow({ label, sublabel, disabled, children }: { label: string; sublabel?: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn(
      "bg-card border border-border/60 rounded-lg flex flex-col md:flex-row md:items-start gap-4 p-6 transition-opacity",
      disabled && "opacity-60"
    )}>
      <div className="md:w-[304px] flex-none">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {sublabel ? <div className="text-xs text-muted-foreground mt-1">{sublabel}</div> : null}
      </div>
      {/* A disabled <fieldset> blocks EVERY nested control (switches, pills, "See example")
          for both mouse AND keyboard when the master toggle is off — while the saved config
          state is left untouched, so nothing is wiped. */}
      <fieldset disabled={disabled} className="flex-1 min-w-0 border-0 m-0 p-0">{children}</fieldset>
    </div>
  );
}

function PillButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const lockedV2 = useContext(PlanLockV2);
  // v2 only: a real pill with the purple hover, and the chosen one in the
  // tenant's brand colour (not a fixed indigo), light in dark mode. Every other
  // tenant gets v1's exact class strings, so nothing they see changes.
  const v2Chrome = useV2("chrome");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={lockedV2 || undefined}
      aria-pressed={v2Chrome ? active : undefined}
      className={cn(
        v2Chrome
          ? "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors"
          : "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
        active
          ? v2Chrome
            ? "bg-primary/10 border-primary/40 text-primary dark:border-[hsl(var(--v2-link,var(--primary))_/_0.4)] dark:text-[hsl(var(--v2-link,var(--primary)))]"
            : "bg-primary/15 border-indigo-500/50 text-indigo-700 dark:text-indigo-300"
          : v2Chrome
            ? "bg-card border-border text-muted-foreground hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]"
            : "bg-card border-border text-muted-foreground hover:bg-muted/40",
        lockedV2 && "cursor-not-allowed opacity-50",
      )}
    >
      {children}
    </button>
  );
}

/** The example dialog's parts: v1's for every other tenant, the v2 ones for the canary. */
const EXAMPLE_DIALOG_V1 = { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Button };
const EXAMPLE_DIALOG_V2 = {
  Dialog: DialogV2,
  DialogContent: DialogContentV2,
  DialogDescription: DialogDescriptionV2,
  DialogFooter: DialogFooterV2,
  DialogHeader: DialogHeaderV2,
  DialogTitle: DialogTitleV2,
  Button: ButtonV2,
};

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
  // v2: the v2 dialog, and a settings-body mark for the dark-mode border fix in
  // styles/v2-theme.css. v1's dialog, with no attribute, for any other tenant.
  const v2ChromeDialog = useV2("chrome");
  const ui = v2ChromeDialog ? EXAMPLE_DIALOG_V2 : EXAMPLE_DIALOG_V1;

  return (
    <ui.Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <ui.DialogContent
        // v2's dialog caps its width at `sm:max-w-md`, so the wider cap is given at `sm:` too.
        className={v2ChromeDialog ? "max-h-[85vh] overflow-y-auto sm:max-w-2xl" : "max-w-2xl max-h-[85vh] overflow-y-auto"}
        data-settings-v2-body={v2ChromeDialog || undefined}
      >
        <ui.DialogHeader>
          <ui.DialogTitle>{label} — example</ui.DialogTitle>
          <ui.DialogDescription>
            Sample {sampleDays}-day rental, splittable amount {fmt(sampleTotal)}.
          </ui.DialogDescription>
        </ui.DialogHeader>
        <div className="space-y-4">
          <div
            className={
              v2ChromeDialog
                ? "rounded-xl bg-muted/40 p-4 text-sm text-foreground/90"
                : "bg-muted/40 border border-border/60 rounded-md p-4 text-sm text-foreground/90"
            }
          >
            Splittable {fmt(sampleTotal)} ÷ {schedule.length} payments → {fmt(schedule[0]?.amount ?? 0)} each
          </div>
          <InstallmentCalendar schedule={schedule} currencyCode={currencyCode} />
          <div className="text-xs text-muted-foreground">
            Customers will see these amounts and dates before checkout.
          </div>
        </div>
        <ui.DialogFooter>
          <ui.Button variant="outline" onClick={onClose}>Close</ui.Button>
        </ui.DialogFooter>
      </ui.DialogContent>
    </ui.Dialog>
  );
}

export default InstallmentSettings;
