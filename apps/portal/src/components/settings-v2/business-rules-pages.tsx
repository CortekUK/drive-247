"use client";

/**
 * v2 Settings (northwind only): the Business-rules sections, with every state.
 *
 *   General › Driver requirements  -> RequirementsPageV2 (a tab of General)
 *   Booking rules                  -> DurationPageV2 (its own page, ?tab=duration)
 *   Lockbox                        -> LockboxPageV2 (its own page, ?tab=lockbox;
 *                                     was Key handover. The code goes by email;
 *                                     its Templates link opens the lockbox message
 *                                     on Customer messages, LockboxTemplatesSectionV2)
 *   Customer messages              -> ReturnReminderPanelV2 (the return reminder panel)
 *
 * Mounted only from the `if (v2Chrome)` branch of settings/page.tsx, so the
 * other 56 tenants never render any of this. The form state still lives in the
 * page (`rentalForm`), which keeps the page's leave-with-unsaved-changes guard.
 *
 * LAYOUT. Each panel carries its own `SettingsRowAlignProvider align="end"`:
 * the label and its help take the row and the control sits at its end, the
 * house style for a v2 settings form (settings-kit.tsx, locations-v2.tsx).
 * Owning it here rather than leaning on the page's `V2_PAGES_CONTROLS_AT_END`
 * means every one of these panels reads the same wherever it is mounted — the
 * return reminder sits on Customer messages, not on a General-lane page.
 *
 * States, in the kit's order:
 *   1. first load  BusinessRentalGate: a form skeleton until the tenant's real
 *                  row is in. useRentalSettings shows DEFAULTS as placeholder
 *                  data, so without this "18", "lockbox off" and "reminders
 *                  off" showed as real, and Save wrote them.
 *   2. read error  BusinessRentalGate: SettingsLoadError + Try again, never the
 *                  form. Stale data + a failed refresh keeps the form with a
 *                  one-line notice above it.
 *   3. dependency  lockbox off (where codes are set and the message is
 *                  edited); the return reminder's Twilio note.
 *   4. empty       blank age = no minimum; lockbox off = what it is for.
 *   5. content     native fieldset-disabled when view-only (keyboard too);
 *                  per-section save status; inline validation instead of the
 *                  silent clamps (23 hours, 4,320 minutes, max 90).
 *   6. leaving     each page registers its save AND its discard with the page
 *                  while dirty (`registerSave`), so the page's one save bar
 *                  saves or resets it, leaving for another screen warns, and
 *                  "Save" in that dialog really saves; "Don't save" puts the
 *                  fields back when the page closes (useDiscardOnUnmount).
 *                  Inside the page's save bar a panel shows no Save of its own,
 *                  only an inline error when its save failed.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Input } from "@/components/ui-v2/input";
import { Switch } from "@/components/ui-v2/switch";
// Every SelectContent below is `tone="surface"`: Settings is a light,
// text-heavy screen, and the dropdown's default translucent near-black panel
// reads there as an OS menu rather than as part of the page. The surface tone
// uses the page's own popover, border and highlight tokens — see
// components/ui-v2/select.tsx.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import {
  SettingsPanel,
  SettingsRow,
  SettingsRowAlignProvider,
  Unit,
  UnitGroup,
  UnitGroups,
  settingsSaveIssue,
  useSettingsPageSave,
} from "@/components/settings-v2/settings-kit";
import { SettingsReadOnlyFieldset, SettingsSectionBoundary } from "@/components/settings-v2/section-states";
import {
  SectionSaveBar,
  useDiscardOnUnmount,
  useRegisterLeaveSave,
  useSectionSave,
} from "@/components/settings-v2/business-section-save";
import type { RegisterSectionSave } from "@/components/settings-v2/pricing-money-parts";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import {
  businessPageDirty,
  clampReminderHours,
  describeBuffer,
  describeDriverAge,
  describeDurationRange,
  describeLeadHours,
  describeReminderLead,
  documentTypeOptions,
  hasErrors,
  leadTimeHours,
  normalizeLoadedLead,
  numberBoxWidth,
  reminderHoursRangeNote,
  savedFieldsFor,
  sendOffsetOptions,
  switchLeadUnit,
  validateCodeLength,
  validateDriverAge,
  validateDuration,
  type LeadUnit,
} from "@/components/settings-v2/business-rules-logic";
import { cn } from "@/lib/utils";

type Rec = Record<string, any>;

/** The page's `setRentalForm`, accepting an updater. */
export type SetBusinessForm = (update: (prev: any) => any) => void;

/** Writes rental settings and rejects on failure. `withTenant` also refetches TenantContext. */
export type SaveBusinessRules = (values: Rec, withTenant?: boolean) => Promise<unknown>;

/**
 * Builds a save that REJECTS on failure (the page's own `saveRental` swallows
 * errors, so a section could never show one). A failed TenantContext refresh
 * after a successful write is not a failed save.
 */
export function makeBusinessSave(
  update: (values: any) => Promise<unknown>,
  refetchTenant?: () => unknown,
): SaveBusinessRules {
  return async (values, withTenant = false) => {
    await update(values);
    if (withTenant && refetchTenant) {
      try {
        await refetchTenant();
      } catch {
        // The settings were written; the context catches up on its next load.
      }
    }
  };
}

interface PageProps {
  form: Rec;
  setForm: SetBusinessForm;
  saved: Rec | null | undefined;
  canEdit: boolean;
  onSave: SaveBusinessRules;
  /** The settings page's `registerV2SectionSave`: makes leaving with unsaved edits warn, and Save & Leave save them. */
  registerSave?: RegisterSectionSave;
}

/**
 * A save for the page's leave dialog: rejects when the section is invalid or
 * the write failed. Given `field`, an invalid section names the box to fix, so
 * the page's save bar scrolls to it and focuses it.
 */
const leaveSave = (invalid: string | null, run: () => Promise<boolean>, what: string, field?: string) => async () => {
  if (invalid) throw field ? settingsSaveIssue(invalid, field) : new Error(invalid);
  if (!(await run())) throw new Error(`Couldn't save ${what}.`);
};

const digitsOnly = (value: string) => value.replace(/[^0-9]/g, "");
// Dark v2 --primary is a deep indigo (about 1.8:1 on the card), so links lighten in dark mode.
const inlineLink = "font-medium text-primary underline-offset-4 hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]";
/** Lockbox's Templates: a link to another page, in the brand colour, with an arrow after it. */
const templatesLink =
  "inline-flex items-center gap-1 rounded-full text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30 dark:text-[hsl(var(--v2-link,var(--primary)))]";
/** A warning line, in the contrast-corrected v2 ink (styles/v2-theme.css),
 *  the same one locations-v2 uses. Never a hardcoded amber: at 13px on the
 *  card, `text-amber-600` measures under 4.5:1 in the light theme. */
const warnText = "panel-ink-warn";
/** How the lockbox code is sent. Email only: no text message or WhatsApp option. */
const LOCKBOX_METHODS = ["email"] as const;

function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="text-destructive">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Load gate                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Loading and read-error states for any page that edits the tenant's rental
 * settings. The pages using it sit outside the settings page's read-only
 * fieldset (V2_PAGES_GATING_OWN_CONTROLS), so Try again, here and on the
 * stale-data notice, still works for a viewer; each page's own fieldset
 * disables its controls.
 */
export function BusinessRentalGate({
  thing,
  rows = 3,
  children,
}: {
  thing: string;
  rows?: number;
  children: ReactNode;
}) {
  const { hasLoaded, error, refetch, isFetching } = useRentalSettings();
  return (
    <div className="pointer-events-auto select-auto">
      <SettingsSectionBoundary
        isLoading={!hasLoaded && !error}
        isError={!!error}
        error={error}
        hasData={!!hasLoaded}
        refetch={refetch}
        isFetching={isFetching}
        thing={thing}
        skeleton={{ variant: "form", rows }}
      >
        {children}
      </SettingsSectionBoundary>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Driver requirements                                                        */
/* -------------------------------------------------------------------------- */

export interface IdWaiverControl {
  enabled: boolean;
  /** Head admins only. */
  canChange: boolean;
  saving: boolean;
  onToggle: (next: boolean) => void;
}

export function RequirementsPageV2({
  form,
  setForm,
  saved,
  canEdit,
  onSave,
  registerSave,
  idWaiver,
}: PageProps & { idWaiver: IdWaiverControl }) {
  const isDirty = businessPageDirty("requirements", form, saved);
  const save = useSectionSave(isDirty);
  const ageError = validateDriverAge(form.minimum_rental_age);
  const docOptions = documentTypeOptions(form.verification_document_type);
  const docLabel = docOptions.find((option) => option.value === form.verification_document_type)?.label;
  // A stored type that isn't one of the choices ("residence_permit_with_…"): its
  // long "(current)" label is cut off in the box, so say it in full below too.
  const customDoc = !!docLabel && docLabel.endsWith(" (current)");
  const noMinimum = form.minimum_rental_age === "" || form.minimum_rental_age === null || form.minimum_rental_age === undefined;

  const submit = () =>
    save.run(() =>
      onSave({
        minimum_rental_age: form.minimum_rental_age || null,
        verification_document_type: form.verification_document_type,
      }),
    );
  const discard = () => setForm((prev) => ({ ...prev, ...savedFieldsFor("requirements", saved) }));
  useRegisterLeaveSave(canEdit ? registerSave : undefined, "business-requirements", isDirty, leaveSave(ageError, submit, "your driver requirements", "v2_minimum_rental_age"), discard);
  useDiscardOnUnmount(isDirty, discard);

  return (
    <SettingsReadOnlyFieldset readOnly={!canEdit}>
      <SettingsRowAlignProvider align="end">
        <SettingsPanel
          footer={
            canEdit ? (
              <SectionSaveBar save={save} isDirty={isDirty} invalid={!!ageError} onSave={submit} onDiscard={discard} />
            ) : undefined
          }
        >
          <SettingsRow
            label="Minimum driver age"
            description={describeDriverAge(noMinimum ? "" : form.minimum_rental_age)}
            htmlFor="v2_minimum_rental_age"
            note={ageError ? <FieldError id="v2_minimum_rental_age_error">{ageError}</FieldError> : undefined}
          >
            <Input
              id="v2_minimum_rental_age"
              type="text"
              inputMode="numeric"
              maxLength={3}
              value={form.minimum_rental_age ?? ""}
              onChange={(e) => {
                const raw = digitsOnly(e.target.value);
                setForm((prev) => ({ ...prev, minimum_rental_age: raw === "" ? "" : parseInt(raw, 10) }));
              }}
              placeholder="None"
              aria-invalid={ageError ? true : undefined}
              aria-describedby={ageError ? "v2_minimum_rental_age_error" : undefined}
              className="w-20 tabular-nums"
            />
            <Unit>years</Unit>
          </SettingsRow>

          <SettingsRow
            label="ID document"
            description="The document customers verify before they can drive."
            htmlFor="v2_verification_document_type"
            note={
              customDoc && docLabel ? (
                <p className="text-muted-foreground [overflow-wrap:anywhere]">
                  Saved as &ldquo;{docLabel.slice(0, -" (current)".length)}&rdquo;, which isn&apos;t one of the standard choices.
                </p>
              ) : undefined
            }
          >
            <Select
              value={form.verification_document_type || undefined}
              onValueChange={(value) => setForm((prev) => ({ ...prev, verification_document_type: value }))}
            >
              <SelectTrigger id="v2_verification_document_type" className="w-48" title={docLabel}>
                <SelectValue placeholder="Choose a document" />
              </SelectTrigger>
              <SelectContent tone="surface" align="end">
                {docOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow
            label="Allow rentals without ID verification"
            description="For when you have checked the ID yourself. Staff must type a reason, which is saved on the rental and in your audit log."
            note={
              <div className="space-y-1">
                {idWaiver.enabled && (
                  <p className={warnText}>
                    Insurance still needs the customer&apos;s date of birth, and agreements will show blank ID fields.
                  </p>
                )}
                <p className="text-muted-foreground">
                  {idWaiver.canChange ? "Saves as soon as you switch it." : "Only a head admin can change this."}
                </p>
              </div>
            }
          >
            <Switch
              checked={idWaiver.enabled}
              disabled={idWaiver.saving || !idWaiver.canChange}
              onCheckedChange={idWaiver.onToggle}
              aria-label="Allow rentals without ID verification"
            />
          </SettingsRow>
        </SettingsPanel>
      </SettingsRowAlignProvider>
    </SettingsReadOnlyFieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Booking rules                                                              */
/* -------------------------------------------------------------------------- */

export function DurationPageV2({ form, setForm, saved, canEdit, onSave, registerSave }: PageProps) {
  const [unitNote, setUnitNote] = useState<string | null>(null);
  const unit: LeadUnit = form.booking_lead_time_unit === "days" ? "days" : "hours";

  // A stored notice that is not a whole number of days (36 hours, unit "days")
  // loads as "1.5", which the digits-only box cannot edit. Show it in hours.
  useEffect(() => {
    const next = normalizeLoadedLead(form.booking_lead_time_value, unit);
    if (next.unit !== unit) {
      setForm((prev) => ({ ...prev, booking_lead_time_unit: next.unit, booking_lead_time_value: next.value }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.booking_lead_time_value, unit]);

  const leadHours = leadTimeHours(form.booking_lead_time_value, unit);
  const values = {
    leadHours,
    minDays: form.min_rental_days || 0,
    minHours: form.min_rental_hours || 0,
    maxDays: form.max_rental_days || 0,
    bufferMinutes: form.buffer_time_minutes || 0,
  };
  const errors = validateDuration(values);
  const invalid = hasErrors(errors);
  const isDirty = businessPageDirty("duration", form, saved);
  const save = useSectionSave(isDirty);
  const minTotal = values.minDays * 24 + values.minHours;
  const leadHint = describeLeadHours(leadHours, unit);
  const buffer = values.bufferMinutes;

  const setNumber = (key: string, raw: string) => {
    const digits = digitsOnly(raw);
    setForm((prev) => ({ ...prev, [key]: digits === "" ? 0 : parseInt(digits, 10) }));
  };

  const submit = () =>
    save.run(() =>
      onSave(
        {
          booking_lead_time_hours: leadHours,
          booking_lead_time_unit: unit,
          min_rental_days: values.minDays,
          min_rental_hours: values.minHours,
          max_rental_days: values.maxDays,
          buffer_time_minutes: values.bufferMinutes,
        },
        true,
      ),
    );
  const discard = () => {
    setUnitNote(null);
    setForm((prev) => ({ ...prev, ...savedFieldsFor("duration", saved) }));
  };
  const firstError = errors.lead ?? errors.min ?? errors.max ?? errors.buffer ?? null;
  // The box the first reason belongs to. "Shortest rental" is two boxes; its
  // days box is the one a refused save lands on.
  const firstErrorField = errors.lead
    ? "v2_booking_lead_time_value"
    : errors.min
      ? "v2_min_rental_days"
      : errors.max
        ? "v2_max_rental_days"
        : "v2_buffer_time_minutes";
  useRegisterLeaveSave(canEdit ? registerSave : undefined, "business-duration", isDirty, leaveSave(firstError, submit, "your booking rules", firstErrorField), discard);
  useDiscardOnUnmount(isDirty, discard);

  return (
    <SettingsReadOnlyFieldset readOnly={!canEdit}>
      <SettingsRowAlignProvider align="end">
        <SettingsPanel
          footer={
            canEdit ? (
              <SectionSaveBar save={save} isDirty={isDirty} invalid={invalid} onSave={submit} onDiscard={discard} />
            ) : undefined
          }
        >
          <SettingsRow
            label="Advance notice"
            description={
              <>
                How long before pickup a booking must be made.
                {leadHint && <span className="whitespace-nowrap tabular-nums"> ({leadHint})</span>}
              </>
            }
            note={
              errors.lead ? (
                <FieldError>{errors.lead}</FieldError>
              ) : unitNote ? (
                <p className="text-muted-foreground">{unitNote}</p>
              ) : undefined
            }
          >
            <Input
              type="text"
              inputMode="numeric"
              maxLength={unit === "days" ? 3 : 4}
              value={form.booking_lead_time_value || ""}
              onChange={(e) => {
                setUnitNote(null);
                setNumber("booking_lead_time_value", e.target.value);
              }}
              placeholder={unit === "days" ? "2" : "24"}
              className={cn(numberBoxWidth(form.booking_lead_time_value, "w-20"), "tabular-nums")}
              id="v2_booking_lead_time_value"
              aria-label="Advance notice"
              aria-invalid={errors.lead ? true : undefined}
            />
            <Select
              value={unit}
              onValueChange={(next: LeadUnit) => {
                const result = switchLeadUnit(leadHours, next);
                setUnitNote(result.blocked);
                setForm((prev) => ({ ...prev, booking_lead_time_unit: result.unit, booking_lead_time_value: result.value }));
              }}
            >
              <SelectTrigger className="w-24" aria-label="Advance notice unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent tone="surface" align="end">
                <SelectItem value="hours">hours</SelectItem>
                <SelectItem value="days">days</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow
            label="Shortest rental"
            description="Bookings shorter than this are not allowed. Hours can be 0–23."
            note={errors.min ? <FieldError>{errors.min}</FieldError> : undefined}
          >
            {/* Each box keeps its own unit: "[2] days  [4] hours", not "[2] days [4] hours". */}
            <UnitGroups>
              <UnitGroup>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={form.min_rental_days || ""}
                  onChange={(e) => setNumber("min_rental_days", e.target.value)}
                  placeholder="0"
                  className={cn(numberBoxWidth(form.min_rental_days, "w-16"), "tabular-nums")}
                  id="v2_min_rental_days"
                  aria-label="Shortest rental days"
                  aria-invalid={errors.min ? true : undefined}
                />
                <Unit>days</Unit>
              </UnitGroup>
              <UnitGroup>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  value={form.min_rental_hours || ""}
                  onChange={(e) => setNumber("min_rental_hours", e.target.value)}
                  placeholder="0"
                  className={cn(numberBoxWidth(form.min_rental_hours, "w-16"), "tabular-nums")}
                  aria-label="Shortest rental hours"
                  aria-invalid={errors.min ? true : undefined}
                />
                <Unit>hours</Unit>
              </UnitGroup>
            </UnitGroups>
          </SettingsRow>

          <SettingsRow
            label="Longest rental"
            description="Bookings longer than this are not allowed."
            note={
              errors.max ? (
                <FieldError>{errors.max}</FieldError>
              ) : !errors.min ? (
                <p className="tabular-nums text-muted-foreground">{describeDurationRange(minTotal, values.maxDays)}</p>
              ) : undefined
            }
          >
            <Input
              type="text"
              inputMode="numeric"
              maxLength={5}
              value={form.max_rental_days || ""}
              onChange={(e) => setNumber("max_rental_days", e.target.value)}
              placeholder="90"
              className={cn(numberBoxWidth(form.max_rental_days, "w-20"), "tabular-nums")}
              id="v2_max_rental_days"
              aria-label="Longest rental days"
              aria-invalid={errors.max ? true : undefined}
            />
            <Unit>days</Unit>
          </SettingsRow>

          <SettingsRow
            label="Time between rentals"
            description={
              <>
                {errors.buffer
                  ? "How long a car stays off the booking site after a rental ends, so you can clean and check it."
                  : buffer > 0
                    ? `A car stays off the booking site for ${describeBuffer(buffer)} after a rental ends, so you can clean and check it.`
                    : "A car can be booked again as soon as a rental ends."}{" "}
                Up to 4,320 minutes (3 days).
              </>
            }
            note={errors.buffer ? <FieldError>{errors.buffer}</FieldError> : undefined}
          >
            <Input
              type="text"
              inputMode="numeric"
              maxLength={5}
              value={form.buffer_time_minutes || ""}
              onChange={(e) => setNumber("buffer_time_minutes", e.target.value)}
              placeholder="0"
              className={cn(numberBoxWidth(form.buffer_time_minutes, "w-20"), "tabular-nums")}
              id="v2_buffer_time_minutes"
              aria-label="Time between rentals in minutes"
              aria-invalid={errors.buffer ? true : undefined}
            />
            <Unit>minutes</Unit>
          </SettingsRow>
        </SettingsPanel>
      </SettingsRowAlignProvider>
    </SettingsReadOnlyFieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Lockbox (was Key handover)                                                 */
/* -------------------------------------------------------------------------- */

export function LockboxPageV2({
  form,
  setForm,
  saved,
  canEdit,
  onSave,
  registerSave,
  vehiclesHref,
  templatesHref,
}: PageProps & {
  vehiclesHref: string;
  /** The lockbox message on Customer messages (`/settings?tab=templates#settings-lockbox-messages`). */
  templatesHref: string;
}) {
  const isDirty = businessPageDirty("lockbox", form, saved);
  const save = useSectionSave(isDirty);
  const pageSave = useSettingsPageSave();
  const enabled = !!form.lockbox_enabled;
  const codeError = enabled ? validateCodeLength(form.lockbox_code_length) : null;
  const offsetOptions = sendOffsetOptions(form.lockbox_send_offset_minutes);
  const offsetValue =
    form.lockbox_send_offset_minutes === null || form.lockbox_send_offset_minutes === undefined
      ? "manual"
      : String(form.lockbox_send_offset_minutes);

  // The code always goes by email: `notify-lockbox-code` sends email whenever
  // it is asked for, so saving writes exactly that. A method saved before
  // (text message, WhatsApp) is replaced the next time this section saves.
  const submit = () =>
    save.run(() =>
      onSave({
        lockbox_enabled: enabled,
        lockbox_code_length: form.lockbox_code_length ?? null,
        lockbox_notification_methods: [...LOCKBOX_METHODS],
        lockbox_send_offset_minutes: form.lockbox_send_offset_minutes ?? null,
      }),
    );
  const discard = () => setForm((prev) => ({ ...prev, ...savedFieldsFor("lockbox", saved) }));
  useRegisterLeaveSave(canEdit ? registerSave : undefined, "business-lockbox", isDirty, leaveSave(codeError, submit, "your lockbox settings", "v2_lockbox_code_length"), discard);
  useDiscardOnUnmount(isDirty, discard);

  // The switch is part of the form, not a live toggle like the waiver: say so
  // while it differs from what is saved.
  const enableChanged = canEdit && enabled !== !!saved?.lockbox_enabled;
  const enableNote =
    enableChanged || !enabled ? (
      <div className="space-y-1">
        {enableChanged && (
          <p className={warnText}>
            Not applied yet. Press {pageSave ? "Save changes" : "Save"} to turn lockbox handover {enabled ? "on" : "off"}.
          </p>
        )}
        {!enabled && (
          <p className="text-muted-foreground">
            Once it&apos;s on, you set each car&apos;s code on its{" "}
            <Link href={vehiclesHref} className={inlineLink}>
              vehicle page
            </Link>
            , and edit the email customers get in{" "}
            <Link href={templatesHref} className={inlineLink}>
              Customer messages
            </Link>
            .
          </p>
        )}
      </div>
    ) : undefined;

  return (
    <SettingsReadOnlyFieldset readOnly={!canEdit}>
      <SettingsRowAlignProvider align="end">
        <SettingsPanel
          footer={
            canEdit ? (
              <SectionSaveBar save={save} isDirty={isDirty} invalid={!!codeError} onSave={submit} onDiscard={discard} />
            ) : undefined
          }
        >
          <SettingsRow
            label="Lockbox handover"
            description="On delivery rentals, staff can leave the keys in a lockbox and the code is sent to the customer."
            note={enableNote}
          >
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, lockbox_enabled: checked }))}
              aria-label="Enable lockbox handover"
            />
          </SettingsRow>

          {enabled && (
            <>
              <SettingsRow
                label="Code length"
                description={
                  form.lockbox_code_length && !codeError
                    ? `The Generate button on a vehicle makes a random ${form.lockbox_code_length}-digit code.`
                    : "Leave empty to let staff type any code. Generate makes a 4-digit one."
                }
                htmlFor="v2_lockbox_code_length"
                note={codeError ? <FieldError id="v2_lockbox_code_length_error">{codeError}</FieldError> : undefined}
              >
                <UnitGroup>
                  <Input
                    id="v2_lockbox_code_length"
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={form.lockbox_code_length ?? ""}
                    onChange={(e) => {
                      const digits = digitsOnly(e.target.value);
                      setForm((prev) => ({ ...prev, lockbox_code_length: digits === "" ? null : parseInt(digits, 10) }));
                    }}
                    placeholder="Any"
                    className="w-20 tabular-nums"
                    aria-invalid={codeError ? true : undefined}
                    aria-describedby={codeError ? "v2_lockbox_code_length_error" : undefined}
                  />
                  <Unit>digits</Unit>
                </UnitGroup>
              </SettingsRow>

              <SettingsRow label="Send the code by" description="Customers get their lockbox code in an email.">
                <span data-lockbox-method="email" className="text-sm font-medium text-foreground">
                  Email
                </span>
              </SettingsRow>

              <SettingsRow label="Send it automatically" description="After you approve the rental." htmlFor="v2_lockbox_send_offset">
                <Select
                  value={offsetValue}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, lockbox_send_offset_minutes: value === "manual" ? null : parseInt(value, 10) }))
                  }
                >
                  <SelectTrigger id="v2_lockbox_send_offset" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent tone="surface" align="end">
                    {offsetOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsRow>

              <SettingsRow label="Lockbox message" description="The email that carries the code, and the instructions in it.">
                {/* A link, not a button: the templates are managed in Customer
                    messages, and the arrow says it opens another page. A
                    view-only user's disabled fieldset never disables an <a>,
                    and the page's leave guard asks first when there are
                    unsaved edits. */}
                <Link href={templatesHref} data-lockbox-templates="" className={templatesLink}>
                  Templates
                  <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
                </Link>
              </SettingsRow>
            </>
          )}
        </SettingsPanel>
      </SettingsRowAlignProvider>
    </SettingsReadOnlyFieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Return reminder                                                            */
/* -------------------------------------------------------------------------- */

export function ReturnReminderPanelV2({
  form,
  setForm,
  saved,
  canEdit,
  onSave,
  registerSave,
  smsReady,
  emailTemplateHref,
  integrationsHref,
}: PageProps & { smsReady: boolean; emailTemplateHref: string; integrationsHref: string }) {
  const isDirty = businessPageDirty("return-reminder", form, saved);
  const save = useSectionSave(isDirty);
  const enabled = !!form.return_reminder_enabled;
  const hours: number = form.return_reminder_hours ?? 24;

  // The box keeps what is typed (even blank) and only settles on blur. The old
  // `parseInt(...) || 24` snapped a cleared field back to 24 mid-edit.
  const [draft, setDraft] = useState(String(hours));
  const [clampNote, setClampNote] = useState<string | null>(null);
  // A stored value outside 1–168 (e.g. 9,999) is flagged on load, not only after a blur.
  const rangeNote = reminderHoursRangeNote(hours);
  useEffect(() => {
    setDraft((current) => (parseInt(current, 10) === hours ? current : String(hours)));
  }, [hours]);

  const commitDraft = () => {
    const result = clampReminderHours(draft, hours);
    setClampNote(result.note);
    setDraft(String(result.value));
    if (result.value !== hours) setForm((prev) => ({ ...prev, return_reminder_hours: result.value }));
  };

  const submit = () =>
    save.run(() => onSave({ return_reminder_enabled: enabled, return_reminder_hours: hours }, true));
  const discard = () => {
    setClampNote(null);
    setForm((prev) => ({ ...prev, ...savedFieldsFor("return-reminder", saved) }));
  };
  useRegisterLeaveSave(canEdit ? registerSave : undefined, "business-return-reminder", isDirty, leaveSave(null, submit, "your return reminder"), discard);
  useDiscardOnUnmount(isDirty, discard);

  return (
    <SettingsReadOnlyFieldset readOnly={!canEdit}>
      <SettingsRowAlignProvider align="end">
        <SettingsPanel
          footer={
            canEdit ? <SectionSaveBar save={save} isDirty={isDirty} onSave={submit} onDiscard={discard} /> : undefined
          }
        >
          <SettingsRow
            label="Return reminder"
            description={
              enabled ? (
                <>
                  Emailed <span className="tabular-nums">{describeReminderLead(hours)}</span> before the car is due back.{" "}
                  <Link href={emailTemplateHref} className={inlineLink}>
                    {canEdit ? "Edit the email" : "View the email"}
                  </Link>
                </>
              ) : (
                "Remind customers by email before their car is due back."
              )
            }
            note={
              enabled ? (
                <div className="space-y-1">
                  <p className={clampNote || rangeNote ? warnText : "text-muted-foreground"}>
                    {clampNote ?? rangeNote ?? "Between 1 and 168 hours (7 days)."}
                  </p>
                  <p className="text-muted-foreground">
                    {smsReady ? (
                      "Also sent as a text message, because Twilio is connected."
                    ) : (
                      <>
                        Email only for now.{" "}
                        <Link href={integrationsHref} className={inlineLink}>
                          Connect Twilio
                        </Link>{" "}
                        to text it too.
                      </>
                    )}
                  </p>
                </div>
              ) : undefined
            }
          >
            <UnitGroups>
              {enabled && (
                <UnitGroup>
                  <Input
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    value={draft}
                    onChange={(e) => {
                      const digits = digitsOnly(e.target.value).slice(0, 3);
                      setDraft(digits);
                      setClampNote(null);
                      const n = parseInt(digits, 10);
                      if (n >= 1 && n <= 168) setForm((prev) => ({ ...prev, return_reminder_hours: n }));
                    }}
                    onBlur={commitDraft}
                    className="w-20 tabular-nums"
                    aria-label="Hours before return"
                  />
                  <Unit>hours before</Unit>
                </UnitGroup>
              )}
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, return_reminder_enabled: checked }))}
                aria-label="Send return reminders"
              />
            </UnitGroups>
          </SettingsRow>
        </SettingsPanel>
      </SettingsRowAlignProvider>
    </SettingsReadOnlyFieldset>
  );
}
