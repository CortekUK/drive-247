"use client";

/**
 * v2 Settings (northwind only): the Business-rules pages, with every state.
 *
 *   Driver requirements  -> RequirementsPageV2
 *   Booking rules        -> DurationPageV2
 *   Key handover         -> LockboxPageV2 (the lockbox messages editor below it is
 *                           LockboxTemplatesSectionV2, built with the Templates states)
 *   Customer messages    -> ReturnReminderPanelV2 (the return reminder panel)
 *
 * Mounted only from the `if (v2Chrome)` branch of settings/page.tsx, so the
 * other 56 tenants never render any of this. The form state still lives in the
 * page (`rentalForm`), which keeps the page's leave-with-unsaved-changes guard.
 *
 * States, in the kit's order:
 *   1. first load  BusinessRentalGate: a form skeleton until the tenant's real
 *                  row is in. useRentalSettings shows DEFAULTS as placeholder
 *                  data, so without this "18", "lockbox off" and "reminders
 *                  off" showed as real, and Save wrote them.
 *   2. read error  BusinessRentalGate: SettingsLoadError + Try again, never the
 *                  form. Stale data + a failed refresh keeps the form with a
 *                  one-line notice above it.
 *   3. dependency  Twilio not connected, WhatsApp no longer sent, lockbox off,
 *                  each with what happens and where to fix it.
 *   4. empty       blank age = no minimum; lockbox off = what it is for.
 *   5. content     native fieldset-disabled when view-only (keyboard too);
 *                  per-section save status; inline validation instead of the
 *                  silent clamps (23 hours, 4,320 minutes, max 90).
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsPanel, SettingsRow, Unit } from "@/components/settings-v2/settings-kit";
import {
  SettingsDependencyNotice,
  SettingsReadOnlyFieldset,
  SettingsSectionBoundary,
} from "@/components/settings-v2/section-states";
import { SectionSaveBar, useSectionSave } from "@/components/settings-v2/business-section-save";
import {
  AVAILABLE_VARIABLES,
  DEFAULT_LOCKBOX_EMAIL,
  DEFAULT_LOCKBOX_INSTRUCTIONS,
  DEFAULT_LOCKBOX_SMS,
} from "@/components/settings/lockbox-templates-section";
import { LockboxTemplatesSectionV2 } from "@/components/settings-v2/lockbox-templates-v2";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import {
  businessPageDirty,
  clampReminderHours,
  describeBuffer,
  describeDurationRange,
  describeLeadHours,
  describeReminderLead,
  documentTypeOptions,
  hasErrors,
  leadTimeHours,
  lockboxMethodStatus,
  normalizeLoadedLead,
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
}

const digitsOnly = (value: string) => value.replace(/[^0-9]/g, "");
const inlineLink = "font-medium text-primary underline-offset-4 hover:underline";
const warnText = "text-amber-600 dark:text-amber-400";
const METHOD_NAMES: Record<string, string> = { email: "Email", sms: "Text message", whatsapp: "WhatsApp" };

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
 * settings. `pointer-events-auto` undoes the page wrapper's view-only
 * `pointer-events-none` so Try again still works for a viewer; the controls
 * themselves are disabled by each page's fieldset.
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
  idWaiver,
}: PageProps & { idWaiver: IdWaiverControl }) {
  const isDirty = businessPageDirty("requirements", form, saved);
  const save = useSectionSave(isDirty);
  const ageError = validateDriverAge(form.minimum_rental_age);
  const docOptions = documentTypeOptions(form.verification_document_type);
  const noMinimum = form.minimum_rental_age === "" || form.minimum_rental_age === null || form.minimum_rental_age === undefined;

  const submit = () =>
    save.run(() =>
      onSave({
        minimum_rental_age: form.minimum_rental_age || null,
        verification_document_type: form.verification_document_type,
      }),
    );
  const discard = () => setForm((prev) => ({ ...prev, ...savedFieldsFor("requirements", saved) }));

  return (
    <SettingsReadOnlyFieldset readOnly={!canEdit}>
      <SettingsPanel
        footer={
          canEdit ? (
            <SectionSaveBar save={save} isDirty={isDirty} invalid={!!ageError} onSave={submit} onDiscard={discard} />
          ) : undefined
        }
      >
        <SettingsRow
          label="Minimum driver age"
          description={
            noMinimum
              ? "No minimum is set, so any licensed driver can book. Enter an age to set one."
              : "Customers younger than this cannot book. Clear it for no minimum."
          }
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
        >
          <Select
            value={form.verification_document_type || undefined}
            onValueChange={(value) => setForm((prev) => ({ ...prev, verification_document_type: value }))}
          >
            <SelectTrigger id="v2_verification_document_type" className="w-48">
              <SelectValue placeholder="Choose a document" />
            </SelectTrigger>
            <SelectContent>
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
            <>
              {idWaiver.enabled && (
                <p className={warnText}>
                  Insurance still needs the customer&apos;s date of birth, and agreements will show blank ID fields.
                </p>
              )}
              <p className="text-muted-foreground">
                {idWaiver.canChange ? "Saves as soon as you switch it." : "Only a head admin can change this."}
              </p>
            </>
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
    </SettingsReadOnlyFieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Booking rules                                                              */
/* -------------------------------------------------------------------------- */

export function DurationPageV2({ form, setForm, saved, canEdit, onSave }: PageProps) {
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

  return (
    <SettingsReadOnlyFieldset readOnly={!canEdit}>
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
              {leadHint && <span className="tabular-nums"> ({leadHint})</span>}
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
            className="w-20 tabular-nums"
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
            <SelectContent>
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
          <Input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={form.min_rental_days || ""}
            onChange={(e) => setNumber("min_rental_days", e.target.value)}
            placeholder="0"
            className="w-16 tabular-nums"
            aria-label="Shortest rental days"
            aria-invalid={errors.min ? true : undefined}
          />
          <Unit>days</Unit>
          <Input
            type="text"
            inputMode="numeric"
            maxLength={2}
            value={form.min_rental_hours || ""}
            onChange={(e) => setNumber("min_rental_hours", e.target.value)}
            placeholder="0"
            className="w-16 tabular-nums"
            aria-label="Shortest rental hours"
            aria-invalid={errors.min ? true : undefined}
          />
          <Unit>hours</Unit>
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
            className="w-20 tabular-nums"
            aria-label="Longest rental days"
            aria-invalid={errors.max ? true : undefined}
          />
          <Unit>days</Unit>
        </SettingsRow>

        <SettingsRow
          label="Time between rentals"
          description={
            <>
              {buffer > 0 && !errors.buffer
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
            className="w-20 tabular-nums"
            aria-label="Time between rentals in minutes"
            aria-invalid={errors.buffer ? true : undefined}
          />
          <Unit>minutes</Unit>
        </SettingsRow>
      </SettingsPanel>
    </SettingsReadOnlyFieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Key handover                                                               */
/* -------------------------------------------------------------------------- */

export function LockboxPageV2({
  form,
  setForm,
  saved,
  canEdit,
  onSave,
  smsReady,
  integrationsHref,
  vehiclesHref,
}: PageProps & { smsReady: boolean; integrationsHref: string; vehiclesHref: string }) {
  const isDirty = businessPageDirty("lockbox", form, saved);
  const save = useSectionSave(isDirty);
  const enabled = !!form.lockbox_enabled;
  const codeError = enabled ? validateCodeLength(form.lockbox_code_length) : null;
  const methodStatus = lockboxMethodStatus(form.lockbox_notification_methods, { smsReady });
  const offsetOptions = sendOffsetOptions(form.lockbox_send_offset_minutes);
  const offsetValue =
    form.lockbox_send_offset_minutes === null || form.lockbox_send_offset_minutes === undefined
      ? "manual"
      : String(form.lockbox_send_offset_minutes);

  const submit = () =>
    save.run(() =>
      onSave({
        lockbox_enabled: enabled,
        lockbox_code_length: form.lockbox_code_length ?? null,
        lockbox_notification_methods: form.lockbox_notification_methods,
        lockbox_send_offset_minutes: form.lockbox_send_offset_minutes ?? null,
      }),
    );
  const discard = () => setForm((prev) => ({ ...prev, ...savedFieldsFor("lockbox", saved) }));

  const methodNote = methodStatus.warning ? (
    <SettingsDependencyNotice
      tone="warning"
      title={methodStatus.warning.title}
      body={methodStatus.warning.body}
      action={methodStatus.warning.needsTwilio ? { label: "Connect Twilio", href: integrationsHref } : undefined}
    />
  ) : !smsReady || methodStatus.extraSaved.length > 0 ? (
    <div className="space-y-1 text-muted-foreground">
      {!smsReady && (
        <p>
          Text messages need Twilio.{" "}
          <Link href={integrationsHref} className={inlineLink}>
            Connect it in Integrations
          </Link>
          .
        </p>
      )}
      {methodStatus.extraSaved.length > 0 && (
        <p>
          Also saved: {methodStatus.extraSaved.map((m) => METHOD_NAMES[m] ?? m).join(", ")}. Saving keeps only the
          method selected here.
        </p>
      )}
    </div>
  ) : undefined;

  return (
    <div className="space-y-6">
      <SettingsReadOnlyFieldset readOnly={!canEdit}>
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
            note={
              !enabled ? (
                <p className="text-muted-foreground">
                  Once it&apos;s on, you set each car&apos;s code on its{" "}
                  <Link href={vehiclesHref} className={inlineLink}>
                    vehicle page
                  </Link>
                  , and edit the message customers get below.
                </p>
              ) : undefined
            }
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
              </SettingsRow>

              <SettingsRow label="Send the code by" note={methodNote}>
                <RadioGroup
                  value={methodStatus.method}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, lockbox_notification_methods: [value] }))}
                  className="flex flex-wrap gap-5"
                  aria-label="Send the code by"
                >
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <RadioGroupItem value="email" id="v2-lockbox-method-email" />
                    Email
                  </label>
                  <label
                    className={cn("flex items-center gap-2 text-sm", smsReady ? "cursor-pointer" : "cursor-not-allowed opacity-60")}
                  >
                    <RadioGroupItem value="sms" id="v2-lockbox-method-sms" disabled={!smsReady} />
                    Text message
                  </label>
                  {methodStatus.method === "whatsapp" && (
                    <label className="flex cursor-not-allowed items-center gap-2 text-sm opacity-60">
                      <RadioGroupItem value="whatsapp" id="v2-lockbox-method-whatsapp" disabled />
                      WhatsApp
                    </label>
                  )}
                </RadioGroup>
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
                  <SelectContent>
                    {offsetOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsRow>
            </>
          )}
        </SettingsPanel>
      </SettingsReadOnlyFieldset>

      <LockboxTemplatesSectionV2
        defaults={{ instructions: DEFAULT_LOCKBOX_INSTRUCTIONS, email: DEFAULT_LOCKBOX_EMAIL, sms: DEFAULT_LOCKBOX_SMS }}
        variables={AVAILABLE_VARIABLES}
      />
    </div>
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

  return (
    <SettingsReadOnlyFieldset readOnly={!canEdit}>
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
                  Edit the email
                </Link>
              </>
            ) : (
              "Remind customers by email before their car is due back."
            )
          }
          note={
            enabled ? (
              <div className="space-y-1">
                <p className={clampNote ? warnText : "text-muted-foreground"}>{clampNote ?? "Between 1 and 168 hours (7 days)."}</p>
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
          {enabled && (
            <>
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
            </>
          )}
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => setForm((prev) => ({ ...prev, return_reminder_enabled: checked }))}
            aria-label="Send return reminders"
            className="ml-2"
          />
        </SettingsRow>
      </SettingsPanel>
    </SettingsReadOnlyFieldset>
  );
}
