"use client";

/**
 * v2 Settings (northwind): Weekend and holiday pricing (`?tab=pricing`,
 * formerly "Custom pricing" and before that "Pricing rules"; the tab key and
 * the manager permission are unchanged), plus the monthly rate section that
 * General mounts. Each part has every state an operator can meet: first load,
 * a failed read, nothing configured, view-only access, unsaved / saving /
 * failed saves, and extreme data (long names, past holidays, huge
 * percentages, 100+ holidays).
 *
 *   PricingRulesV2         Weekend pricing, then Holiday pricing.
 *   MonthlyRateSectionV2   "Monthly rate starts at", moved to General (D3).
 *                          Same save key ("pricing-monthly-tier"), same
 *                          behaviour; General's SettingsSection gives it its
 *                          heading (MONTHLY_RATE_SECTION has the copy).
 *
 * v1 keeps `components/settings/pricing-rules-settings.tsx`, untouched. This
 * uses the same hooks (`useWeekendPricing`, `useTenantHolidays`) and sends the
 * same payloads. Holiday edits still send `excluded_vehicle_ids: []`, as v1
 * does; the dialog now warns when that clears a holiday's vehicle exclusions.
 *
 * The copy says what the pricing engine does (`lib/calculate-rental-price.ts`,
 * the same file in booking): surcharges apply to every booking that includes
 * the day, weekly and monthly ones too (on their per-day price); and when a
 * holiday falls on a weekend day, only the holiday's surcharge applies unless
 * `stack_surcharges` is on, which adds the two together. It is NOT "the higher
 * one": a 5% holiday on a 10% weekend day charges 5% with stacking off.
 */

import { Fragment, useEffect, useState } from "react";
import { CalendarRange, Loader2, Pencil, Plus, Trash2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Switch } from "@/components/ui-v2/switch";
// Every SelectContent below is `tone="surface"`: Settings is a light,
// text-heavy screen, and the dropdown's default translucent near-black panel
// reads there as an OS menu rather than as part of the page. The surface tone
// uses the page's own popover, border and highlight tokens — see
// components/ui-v2/select.tsx.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-v2/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui-v2/tooltip";
import {
  LIST_CLASSES,
  LIST_ROW_ACTION,
  ListBody,
  ListCell,
  ListFooter,
  ListHead,
  ListMetaChip,
  ListRow,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
} from "@/components/shared/list-table-v2";
import { SettingsField, SettingsPanel, SettingsRow, SettingsRowAlignProvider, Unit, useSettingsPageSave } from "@/components/settings-v2/settings-kit";
import {
  SettingsDependencyNotice,
  SettingsEmptyState,
  SettingsReadOnlyFieldset,
  SettingsSaveState,
  TabularValue,
  TruncatedText,
  describeSaveError,
} from "@/components/settings-v2/section-states";
import {
  IssueLine,
  ReadGate,
  SaveFooter,
  SectionHeader,
  useSectionSave,
  useSettingsReadState,
  type RegisterSectionSave,
  type SettingsReadState,
} from "@/components/settings-v2/pricing-money-parts";
import {
  BLOCKED_SAVE_MESSAGE,
  EMPTY_HOLIDAY_FORM,
  WEEKEND_DAY_LIMIT,
  describeHolidayDeleteError,
  excludedVehicleCount,
  formatHolidayDates,
  formatPercent,
  hasBlockingIssue,
  holidayFormErrors,
  isHolidayPast,
  isWeekendDirty,
  localDateKey,
  weekendDaysIssue,
  weekendOffNote,
  weekendPercentIssue,
  type HolidayFormErrors,
  type HolidayFormFields,
} from "@/components/settings-v2/pricing-money-logic";
import { useTenant } from "@/contexts/TenantContext";
import { useWeekendPricing } from "@/hooks/use-weekend-pricing";
import { useTenantHolidays, type TenantHoliday, type TenantHolidayInsert } from "@/hooks/use-tenant-holidays";
import { useAuditLogOnOpen } from "@/hooks/use-audit-log-on-open";
import { cn } from "@/lib/utils";

const DAY_LABELS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

/** Title and description for the monthly rate's section heading (General's `SettingsSection`). */
export const MONTHLY_RATE_SECTION = {
  title: "Monthly rate",
  description: "When a rental is long enough to be priced at your monthly rate instead of the daily or weekly one.",
} as const;

/** The section key the monthly rate registers with the page's save bar. `business-rules-logic.ts` reads it. */
export const MONTHLY_RATE_SAVE_KEY = "pricing-monthly-tier";

/**
 * The "Holiday on a weekend day" row (`tenants.stack_surcharges`). Off, the
 * holiday's surcharge is the only one charged that day; on, the weekend's is
 * added to it. `off`/`on` label the switch's current state beside it.
 */
export const STACK_SURCHARGES_COPY = {
  label: "Holiday on a weekend day",
  description:
    "Off: only the holiday surcharge is charged. On: the weekend surcharge is added to it, so a 20% holiday on a 10% weekend day costs 30% more.",
  off: "Holiday only",
  on: "Add both",
} as const;

export interface MonthlyTierProps {
  value: number;
  savedValue: number | null | undefined;
  onChange: (days: number) => void;
  /** The page's own save for `monthly_tier_days`; rejects on failure. */
  onSave: () => Promise<unknown>;
  read: SettingsReadState;
}

export interface PricingRulesV2Props {
  canEdit: boolean;
  registerSave?: RegisterSectionSave;
  /** Weekend pricing's unsaved edits (the page's `pricingDirty`). */
  onDirtyChange?: (dirty: boolean) => void;
  // No monthly rate here: it moved to General (D3) as `MonthlyRateSectionV2`.
}

export function PricingRulesV2({ canEdit, registerSave, onDirtyChange }: PricingRulesV2Props) {
  return (
    <div className="pointer-events-auto space-y-10">
      <WeekendPricingSection canEdit={canEdit} registerSave={registerSave} onDirtyChange={onDirtyChange} />
      <HolidayPricingSection canEdit={canEdit} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Monthly rate                                                                */
/* -------------------------------------------------------------------------- */

export interface MonthlyRateSectionV2Props {
  canEdit: boolean;
  registerSave?: RegisterSectionSave;
  monthlyTier: MonthlyTierProps;
  /**
   * Draw the section's own "Monthly rate" heading. Leave it off (the default)
   * inside General, where `<SettingsSection title={MONTHLY_RATE_SECTION.title}
   * description={MONTHLY_RATE_SECTION.description}>` already heads it.
   */
  withHeading?: boolean;
}

/**
 * "Monthly rate starts at": one row, saved through the page's save bar under
 * `MONTHLY_RATE_SAVE_KEY`. The same component, save and behaviour the Custom
 * pricing page had, lifted out so General can mount it.
 */
export function MonthlyRateSectionV2({ canEdit, registerSave, monthlyTier, withHeading = false }: MonthlyRateSectionV2Props) {
  const body = <MonthlyRateBody {...monthlyTier} canEdit={canEdit} registerSave={registerSave} />;
  if (!withHeading) return body;
  return (
    <section aria-labelledby="v2-monthly-rate" className="space-y-3">
      <SectionHeader id="v2-monthly-rate" title={MONTHLY_RATE_SECTION.title} description={MONTHLY_RATE_SECTION.description} />
      {body}
    </section>
  );
}

function MonthlyRateBody({
  value,
  savedValue,
  onChange,
  onSave,
  read,
  canEdit,
  registerSave,
}: MonthlyTierProps & { canEdit: boolean; registerSave?: RegisterSectionSave }) {
  const saved = savedValue ?? 30;
  const dirty = read.hasData && Number(value) !== Number(saved);
  const pageSave = useSettingsPageSave();
  const save = useSectionSave({
    sectionKey: MONTHLY_RATE_SAVE_KEY,
    isDirty: dirty,
    registerSave,
    signature: String(value),
    run: onSave,
    discard: () => onChange(Number(saved)),
  });
  const options = [30, 31].includes(Number(value)) ? [30, 31] : [30, 31, Number(value)];

  return (
    <ReadGate read={read} thing="monthly pricing" rows={1}>
      <SettingsReadOnlyFieldset readOnly={!canEdit}>
        {/* Controls at the end of the row, as on Locations: left-aligned they
            sat mid-row with the whole right half of the panel empty. */}
        <SettingsRowAlignProvider align="end">
        <SettingsPanel>
          <SettingsRow
            label="Monthly rate starts at"
            description="Rentals this long or longer use the monthly rate. Also used for mileage allowance and extensions."
            note={
              // Inside the page's save bar only a failed save is said here.
              canEdit && (pageSave ? save.status === "error" : save.status !== "idle") ? (
                <SettingsSaveState
                  status={save.status}
                  error={save.error}
                  onRetry={pageSave ? undefined : save.retry}
                  onDiscard={pageSave ? undefined : () => onChange(Number(saved))}
                />
              ) : undefined
            }
          >
            <Select value={String(value)} onValueChange={(next) => onChange(parseInt(next))}>
              <SelectTrigger className="w-28" aria-label="Monthly rate starts at">
                <SelectValue />
              </SelectTrigger>
              <SelectContent tone="surface">
                {options.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {days} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canEdit && !pageSave && (
              <Button
                type="button"
                size="sm"
                variant={dirty ? "default" : "outline"}
                disabled={!dirty || save.saving}
                aria-busy={save.saving || undefined}
                onClick={save.trigger}
              >
                {save.saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
                Save
              </Button>
            )}
          </SettingsRow>
        </SettingsPanel>
        </SettingsRowAlignProvider>
      </SettingsReadOnlyFieldset>
    </ReadGate>
  );
}

/* -------------------------------------------------------------------------- */
/* Weekend pricing                                                             */
/* -------------------------------------------------------------------------- */

function WeekendPricingSection({
  canEdit,
  registerSave,
  onDirtyChange,
}: {
  canEdit: boolean;
  registerSave?: RegisterSectionSave;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { tenant } = useTenant();
  const { settings, updateSettings } = useWeekendPricing();
  const read = useSettingsReadState(["weekend-pricing", tenant?.id]);

  const [percent, setPercent] = useState<number | "">("");
  const [days, setDays] = useState<number[]>([6, 0]);
  const [stack, setStack] = useState(false);

  // Seed the form from the REAL row, never from the placeholder defaults, and
  // re-seed when the saved row changes. Done during render (not in an effect)
  // so the form never paints once with stale values or reads as dirty.
  const savedKey = read.hasData
    ? JSON.stringify([settings.weekend_surcharge_percent, settings.weekend_days, settings.stack_surcharges])
    : null;
  const [seededKey, setSeededKey] = useState<string | null>(null);
  if (savedKey !== null && savedKey !== seededKey) {
    setSeededKey(savedKey);
    setPercent(settings.weekend_surcharge_percent || "");
    setDays(settings.weekend_days || [6, 0]);
    setStack(settings.stack_surcharges ?? false);
  }

  const dirty = savedKey !== null && savedKey === seededKey && isWeekendDirty({ percent, days, stack }, settings);

  // Report unsaved weekend edits to the page, and clear them when this unmounts
  // (v1 never did, leaving a stale "unsaved changes" prompt behind).
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const percentIssue = weekendPercentIssue(percent);
  const blocked = hasBlockingIssue([percentIssue]);
  const percentNote = percentIssue ?? weekendOffNote(percent);
  const daysNote = weekendDaysIssue(percent, days);

  const discard = () => {
    setPercent(settings.weekend_surcharge_percent || "");
    setDays(settings.weekend_days || [6, 0]);
    setStack(settings.stack_surcharges ?? false);
  };

  const save = useSectionSave({
    sectionKey: "pricing-weekend",
    isDirty: dirty,
    registerSave,
    signature: JSON.stringify([percent, days, stack]),
    run: async () => {
      if (blocked) throw new Error(BLOCKED_SAVE_MESSAGE);
      await updateSettings({
        weekend_surcharge_percent: Number(percent) || 0,
        weekend_days: days,
        stack_surcharges: stack,
      });
    },
    discard,
  });

  const toggleDay = (day: number) =>
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : prev.length >= WEEKEND_DAY_LIMIT ? prev : [...prev, day],
    );

  return (
    <section aria-labelledby="v2-weekend-pricing" className="space-y-3">
      <SectionHeader
        id="v2-weekend-pricing"
        title="Weekend pricing"
        description="Charge more on the days you pick. It applies to every booking that includes them, weekly and monthly ones too."
      />
      <ReadGate read={read} thing="weekend pricing" rows={3}>
        <SettingsReadOnlyFieldset readOnly={!canEdit}>
          {/* Controls at the end of the row, like the monthly rate above. */}
          <SettingsRowAlignProvider align="end">
          <SettingsPanel
            footer={canEdit ? <SaveFooter save={save} disabled={!dirty || blocked} onDiscard={discard} /> : undefined}
          >
            <SettingsRow
              label="Surcharge"
              htmlFor="v2-weekend-percent"
              description="Added to the day's price on the days below."
              note={percentNote ? <IssueLine issue={percentNote} id="v2-weekend-percent-note" /> : undefined}
            >
              <Input
                id="v2-weekend-percent"
                type="number"
                inputMode="decimal"
                min={0}
                step={1}
                placeholder="0"
                value={percent}
                onChange={(e) => setPercent(e.target.value === "" ? "" : Number(e.target.value))}
                aria-invalid={percentIssue?.blocksSave || undefined}
                aria-describedby={percentNote ? "v2-weekend-percent-note" : undefined}
                className="w-24 tabular-nums"
              />
              <Unit>%</Unit>
            </SettingsRow>
            <SettingsRow
              label="Weekend days"
              description={`Choose up to ${WEEKEND_DAY_LIMIT}.`}
              note={daysNote ? <IssueLine issue={daysNote} /> : undefined}
            >
              <div role="group" aria-label="Weekend days" className="flex flex-wrap gap-1.5">
                {DAY_LABELS.map((day) => {
                  const selected = days.includes(day.value);
                  const atLimit = !selected && days.length >= WEEKEND_DAY_LIMIT;
                  return (
                    <button
                      key={day.value}
                      type="button"
                      aria-pressed={selected}
                      disabled={atLimit}
                      onClick={() => toggleDay(day.value)}
                      className={cn(
                        "h-8 min-w-11 rounded-full px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed",
                        selected
                          ? "bg-primary text-primary-foreground disabled:opacity-60"
                          : "bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40",
                      )}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </SettingsRow>
            <SettingsRow
              label={STACK_SURCHARGES_COPY.label}
              htmlFor="v2-stack-surcharges"
              description={<span id="v2-stack-surcharges-help">{STACK_SURCHARGES_COPY.description}</span>}
            >
              <Switch
                id="v2-stack-surcharges"
                checked={stack}
                onCheckedChange={setStack}
                aria-describedby="v2-stack-surcharges-help v2-stack-surcharges-state"
              />
              {/* What the switch does right now, in words: on/off alone does not say it. */}
              <Unit>
                <span id="v2-stack-surcharges-state">{stack ? STACK_SURCHARGES_COPY.on : STACK_SURCHARGES_COPY.off}</span>
              </Unit>
            </SettingsRow>
          </SettingsPanel>
          </SettingsRowAlignProvider>
        </SettingsReadOnlyFieldset>
      </ReadGate>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Holiday pricing                                                             */
/* -------------------------------------------------------------------------- */

function HolidayPricingSection({ canEdit }: { canEdit: boolean }) {
  const { tenant } = useTenant();
  const { holidays, addHoliday, isAdding, updateHoliday, isUpdating, deleteHoliday, isDeleting } = useTenantHolidays();
  const read = useSettingsReadState(["tenant-holidays", tenant?.id]);
  const rows = useProgressiveRows(holidays, tenant?.id ?? "");
  const today = localDateKey();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TenantHoliday | null>(null);
  const [form, setForm] = useState<HolidayFormFields>(EMPTY_HOLIDAY_FORM);
  const [attempted, setAttempted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [deleteTarget, setDeleteTarget] = useState<TenantHoliday | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);

  useAuditLogOnOpen({
    open: !!deleteTarget,
    action: "holiday_delete_warning_shown",
    entityType: "settings",
    entityId: deleteTarget?.id ?? null,
  });

  const saving = isAdding || isUpdating;
  const errors = holidayFormErrors(form);
  const invalid = Object.keys(errors).length > 0;
  // Required-field messages wait for a Save attempt; a wrong value shows at once.
  const shown: HolidayFormErrors = attempted
    ? errors
    : { end_date: form.start_date && form.end_date ? errors.end_date : undefined, surcharge_percent: errors.surcharge_percent };
  const excluded = editing ? excludedVehicleCount(editing) : 0;

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_HOLIDAY_FORM);
    setAttempted(false);
    setSaveError(null);
    setDialogOpen(true);
  };

  const openEdit = (holiday: TenantHoliday) => {
    setEditing(holiday);
    setForm({
      name: holiday.name,
      start_date: holiday.start_date,
      end_date: holiday.end_date,
      surcharge_percent: holiday.surcharge_percent,
      recurs_annually: holiday.recurs_annually,
    });
    setAttempted(false);
    setSaveError(null);
    setDialogOpen(true);
  };

  const submit = async () => {
    if (saving) return;
    if (invalid) {
      setAttempted(true);
      return;
    }
    setSaveError(null);
    // The v1 payload, unchanged.
    const payload = {
      name: form.name,
      start_date: form.start_date,
      end_date: form.end_date,
      surcharge_percent: Number(form.surcharge_percent) || 0,
      recurs_annually: form.recurs_annually,
      excluded_vehicle_ids: [],
    };
    try {
      if (editing) {
        await updateHoliday({ id: editing.id, ...payload });
      } else {
        await addHoliday(payload as TenantHolidayInsert);
      }
      setDialogOpen(false);
    } catch (err) {
      setSaveError(err ?? new Error("Save failed"));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setDeleteError(null);
    try {
      await deleteHoliday(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err ?? new Error("Delete failed"));
    }
  };

  const setField = <K extends keyof HolidayFormFields>(key: K, value: HolidayFormFields[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaveError(null);
  };

  return (
    <section aria-labelledby="v2-holiday-pricing" className="space-y-3">
      <SectionHeader
        id="v2-holiday-pricing"
        title="Holiday pricing"
        description="Charge more on date ranges such as Christmas. It applies to every booking that includes those dates."
        action={
          // One place to add a holiday, with or without rows, once the list has
          // loaded (never over a skeleton or a failed read).
          canEdit && read.hasData ? (
            <Button type="button" onClick={openAdd} className="w-full sm:w-auto">
              <Plus data-icon="inline-start" />
              Add holiday
            </Button>
          ) : undefined
        }
      />

      <ReadGate read={read} thing="holiday pricing" rows={3} variant="table" columns={4} surface="settings">
        {holidays.length === 0 ? (
          // One line, not a table's worth of card: the header already has Add holiday.
          <SettingsEmptyState
            variant="inline"
            icon={CalendarRange}
            headline="No holiday surcharges yet"
            body={canEdit ? "Add one to charge more on your busiest dates." : "Ask an admin if you need one."}
          />
        ) : (
          <TooltipProvider delayDuration={300}>
            <ListTable rows={rows} minWidth="min-w-0" surface="settings">
              <ListTableHeader>
                <ListHead className="text-left">Holiday</ListHead>
                <ListHead className="hidden w-[30%] sm:table-cell">Dates</ListHead>
                <ListHead className="w-[8rem] sm:w-[16%]">Surcharge</ListHead>
                <ListHead className="hidden w-[12%] md:table-cell">Repeats</ListHead>
                {canEdit && (
                  <ListHead className="w-[5.5rem] text-right">
                    <span className="sr-only">Actions</span>
                  </ListHead>
                )}
              </ListTableHeader>
              <ListBody>
                {rows.visible.map((holiday) => {
                  const past = isHolidayPast(holiday, today);
                  const dates = formatHolidayDates(holiday.start_date, holiday.end_date);
                  return (
                    <ListRow key={holiday.id}>
                      <ListCell className="text-left">
                        {/* The name column reads left, like a list of names: centred in a
                            wide column it floated mid-cell with a gap down its left side. */}
                        <div className="flex min-w-0 items-center justify-start gap-2">
                          <TruncatedText
                            text={holiday.name}
                            className={cn(LIST_CLASSES.identifier, "min-w-0", past && "text-muted-foreground")}
                          />
                          {past && (
                            <span className="shrink-0" title="This one-time holiday has ended">
                              <ListMetaChip>Past</ListMetaChip>
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden" title={dates}>
                          {dates}
                          {holiday.recurs_annually ? " · Yearly" : ""}
                        </p>
                      </ListCell>
                      <ListCell className="hidden sm:table-cell">
                        <span
                          className={cn("block truncate tabular-nums", LIST_CLASSES.text, past && "text-muted-foreground")}
                          title={dates}
                        >
                          {dates}
                        </span>
                      </ListCell>
                      <ListCell>
                        {/* Never cut: a percentage missing digits reads as a different
                            one. Too wide for its column, it wraps at a thousands
                            separator inside the cell instead of running under Edit. */}
                        <TabularValue className={cn("max-w-full whitespace-normal", past && "text-muted-foreground")}>
                          <BreakAtCommas text={formatPercent(holiday.surcharge_percent, true)} />
                        </TabularValue>
                      </ListCell>
                      <ListCell className="hidden md:table-cell">
                        <span className={cn(LIST_CLASSES.text, past && "text-muted-foreground")}>
                          {holiday.recurs_annually ? "Yearly" : "Once"}
                        </span>
                      </ListCell>
                      {canEdit && (
                        <ListCell className="text-right">
                          <div className="flex justify-end gap-0.5">
                            <IconAction icon={Pencil} tooltip="Edit" label={`Edit ${holiday.name}`} onClick={() => openEdit(holiday)} />
                            <IconAction
                              icon={Trash2}
                              tooltip="Delete"
                              label={`Delete ${holiday.name}`}
                              onClick={() => {
                                setDeleteError(null);
                                setDeleteTarget(holiday);
                              }}
                              destructive
                            />
                          </div>
                        </ListCell>
                      )}
                    </ListRow>
                  );
                })}
              </ListBody>
            </ListTable>
            <ListFooter rows={rows} one="holiday" many="holidays" hideWhenAllShown />
          </TooltipProvider>
        )}
      </ReadGate>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!saving) setDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit holiday" : "Add holiday"}</DialogTitle>
            <DialogDescription>
              Added to the day&apos;s price on these dates, for every booking that includes them.
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {excluded > 0 && (
              <SettingsDependencyNotice
                tone="warning"
                title={`This holiday skips ${excluded} vehicle${excluded === 1 ? "" : "s"}`}
                body="Saving here clears that list, so the surcharge will apply to those vehicles again. Close without saving to keep it."
              />
            )}
            <SettingsField label="Name" htmlFor="v2-holiday-name" hint={shown.name && <FieldError>{shown.name}</FieldError>}>
              <Input
                id="v2-holiday-name"
                placeholder="e.g. Christmas, Bank Holiday"
                value={form.name}
                maxLength={200}
                onChange={(e) => setField("name", e.target.value)}
                aria-invalid={!!shown.name || undefined}
              />
            </SettingsField>
            <div className="grid gap-4 sm:grid-cols-2">
              <SettingsField
                label="First day"
                htmlFor="v2-holiday-start"
                hint={shown.start_date && <FieldError>{shown.start_date}</FieldError>}
              >
                <Input
                  id="v2-holiday-start"
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setField("start_date", e.target.value)}
                  aria-invalid={!!shown.start_date || undefined}
                />
              </SettingsField>
              <SettingsField
                label="Last day"
                htmlFor="v2-holiday-end"
                hint={shown.end_date && <FieldError>{shown.end_date}</FieldError>}
              >
                <Input
                  id="v2-holiday-end"
                  type="date"
                  value={form.end_date}
                  min={form.start_date}
                  onChange={(e) => setField("end_date", e.target.value)}
                  aria-invalid={!!shown.end_date || undefined}
                />
              </SettingsField>
            </div>
            <SettingsField
              label="Surcharge"
              htmlFor="v2-holiday-surcharge"
              hint={shown.surcharge_percent ? <FieldError>{shown.surcharge_percent}</FieldError> : "Leave blank or 0 for no surcharge."}
            >
              <div className="flex items-center gap-2">
                <Input
                  id="v2-holiday-surcharge"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={form.surcharge_percent}
                  onChange={(e) => setField("surcharge_percent", e.target.value === "" ? "" : Number(e.target.value))}
                  aria-invalid={!!shown.surcharge_percent || undefined}
                  className="w-28 tabular-nums"
                />
                <Unit>%</Unit>
              </div>
            </SettingsField>
            <div className="flex items-center gap-3">
              <Switch
                id="v2-holiday-recurs"
                checked={form.recurs_annually}
                onCheckedChange={(checked) => setField("recurs_annually", checked)}
              />
              <label htmlFor="v2-holiday-recurs" className="text-sm text-foreground">
                Repeat every year
              </label>
            </div>
            {saveError != null && (
              <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
                <span className="font-medium">Couldn&apos;t save.</span> {describeSaveError(saveError)}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
                {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
                {editing ? "Save holiday" : "Add holiday"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this holiday?</AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              &ldquo;{deleteTarget?.name}&rdquo; and any vehicle-specific overrides for it will be removed permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError != null && (
            <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
              <span className="font-medium">Couldn&apos;t delete.</span> {describeHolidayDeleteError(deleteError)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={isDeleting}
              aria-busy={isDeleting || undefined}
            >
              {isDeleting && <Loader2 className="animate-spin" data-icon="inline-start" />}
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** "+99,999,999,999.99%" with a line-break opportunity after each comma, so it never splits mid-group. */
function BreakAtCommas({ text }: { text: string }) {
  const parts = text.split(",");
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              ,<wbr />
            </>
          )}
        </Fragment>
      ))}
    </>
  );
}

function FieldError({ children }: { children: string }) {
  return <span className="text-destructive">{children}</span>;
}

function IconAction({
  icon: Icon,
  label,
  tooltip,
  onClick,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  tooltip: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(LIST_ROW_ACTION, destructive && "hover:text-destructive")}
          onClick={onClick}
          aria-label={label}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
