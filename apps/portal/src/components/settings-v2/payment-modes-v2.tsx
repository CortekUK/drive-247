"use client";

/**
 * v2 (northwind): the Pay As You Go and Auto-extension settings pages.
 *
 * These were inline in `settings/page.tsx`. They moved here so every state has
 * an owner. Both are FORMS that save through the settings page's one save bar
 * (Sep 19 2026; they used to save each control the moment it changed):
 *
 * - DRAFT. Each control edits a draft. What differs from the saved row is the
 *   unsaved change; flipping a switch back, or typing the saved number again,
 *   is no change at all.
 * - SAVE BAR. While the draft holds a change the page is given this form's
 *   save and discard (`registerSave`, keys "payg" and "auto-extend"), so the
 *   bar's Save changes writes it, Reset puts it back, and leaving the page
 *   asks first ("Save your changes?"). The save writes ONLY the changed keys
 *   in one update, and rejects with what went wrong, so the bar and the leave
 *   dialog can say it. Inside the bar (`useSettingsPageSave`) the form shows no
 *   Save of its own, only a failed save; rendered outside one it keeps a Save.
 * - FIRST LOAD / FAILED READ. `useRentalSettings` shows defaults while it loads
 *   and after a failed read ("off", 0 h, 48 h, 3). A form must never render
 *   over those, or one Save writes a default over the real value. So: skeleton
 *   until a real row arrives, the load error with a retry if it never does,
 *   and the inline error above the controls if a refresh fails.
 * - READ-ONLY. A native disabled fieldset, so the keyboard cannot flip a switch
 *   the mouse cannot reach, and no Save or registration at all.
 * - NUMBERS. Auto-extend's hours and retries are checked as they are typed. An
 *   empty, negative, decimal or out-of-range value is never saved: the field
 *   says why and the save refuses with the same words. A value ALREADY saved
 *   outside the range (written before these checks) is shown as saved, marked,
 *   and explained; it is never corrected silently, and it is not written back
 *   unless it is edited. Each field widens for a long number instead of
 *   cutting digits off.
 *
 * The keys and values saved are exactly the ones the instant-save pages wrote.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Switch } from "@/components/ui-v2/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import { SettingsPanel, SettingsRow, useSettingsPageSave } from "@/components/settings-v2/settings-kit";
import { useRegisterLeaveSave } from "@/components/settings-v2/business-section-save";
import type { RegisterSectionSave } from "@/components/settings-v2/pricing-money-parts";
import {
  formatSettingsNumber,
  SettingsDependencyNotice,
  SettingsLoadError,
  SettingsReadOnlyFieldset,
  SettingsSaveState,
  SettingsSectionSkeleton,
  useSettingsSaveStatus,
  type SettingsSaveStatus,
} from "@/components/settings-v2/section-states";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import {
  AUTO_EXTEND_NUMBER_FIELDS,
  checkWholeNumber,
  paymentProviderState,
  type AutoExtendNumberKey,
} from "@/lib/settings-money-states";

type RentalSettingsApi = ReturnType<typeof useRentalSettings>;

/**
 * Loading and read-error states for a page built on `useRentalSettings`.
 * Returns the node to render instead of the page, or null when the page may
 * render (with `inlineError` to show above it when a refresh failed).
 */
export function rentalSettingsGate(api: RentalSettingsApi, thing: string, rows: number) {
  if (!api.hasLoaded) {
    return {
      block: api.error ? (
        <SettingsLoadError thing={thing} error={api.error} onRetry={() => api.refetch()} retrying={api.isFetching} />
      ) : (
        <SettingsSectionSkeleton variant="form" rows={rows} label={`Loading ${thing}`} />
      ),
      inlineError: null,
    };
  }
  return {
    block: null,
    inlineError: api.error ? (
      <SettingsLoadError
        variant="inline"
        thing={thing}
        error={api.error}
        onRetry={() => api.refetch()}
        retrying={api.isFetching}
      />
    ) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* One form's save                                                             */
/* -------------------------------------------------------------------------- */

interface DraftSave {
  isPending: boolean;
  error: unknown;
  status: SettingsSaveStatus;
  /**
   * Runs one save. REJECTS with what went wrong (the page's save bar and leave
   * dialog say it); a second call while one is running is ignored.
   */
  run: (work: () => Promise<unknown>) => Promise<void>;
}

function useDraftSave(isDirty: boolean): DraftSave {
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inFlight = useRef(false);

  // Putting every edit back (Reset, Don't save, or by hand) clears a stale error.
  useEffect(() => {
    if (!isDirty) setError(null);
  }, [isDirty]);

  const status = useSettingsSaveStatus({ isDirty, isPending, error });

  const run = async (work: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      const failure = e ?? new Error("Save failed");
      setError(failure);
      throw failure;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return { isPending, error, status, run };
}

/**
 * The form's save footer. Inside the page's save bar: only a failed save (the
 * bar has Save and Reset). Outside one: the status and a Save.
 */
function DraftSaveFooter({
  save,
  isDirty,
  invalid = false,
  onSave,
  onDiscard,
}: {
  save: DraftSave;
  isDirty: boolean;
  /** A field is invalid: Save waits; the field says why. */
  invalid?: boolean;
  onSave: () => Promise<void>;
  onDiscard: () => void;
}) {
  const pageSave = useSettingsPageSave();
  const trigger = () => void onSave().catch(() => undefined);
  if (pageSave) {
    return save.status === "error" ? <SettingsSaveState status="error" error={save.error} /> : null;
  }
  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-2">
      <SettingsSaveState status={save.status} error={save.error} onRetry={invalid ? undefined : trigger} onDiscard={onDiscard} className="mr-auto" />
      <Button type="button" size="sm" onClick={trigger} disabled={save.isPending || !isDirty || invalid} className="min-w-[88px]">
        {save.isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
        Save
      </Button>
    </div>
  );
}

/** Only the keys whose draft value differs from the saved one. */
function changedValues<T extends Record<string, unknown>>(values: T, saved: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(values) as (keyof T)[]) {
    if (values[key] !== saved[key]) out[key] = values[key];
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Pay As You Go                                                               */
/* -------------------------------------------------------------------------- */

interface PaygValues extends Record<string, unknown> {
  pay_as_you_go_enabled: boolean;
  payg_upfront_required: boolean;
  payg_auto_reminders_enabled: boolean;
}

function savedPayg(settings: unknown): PaygValues {
  const saved = (settings ?? {}) as Record<string, unknown>;
  return {
    pay_as_you_go_enabled: (saved.pay_as_you_go_enabled as boolean | null | undefined) ?? false,
    payg_upfront_required: (saved.payg_upfront_required as boolean | null | undefined) ?? false,
    payg_auto_reminders_enabled: (saved.payg_auto_reminders_enabled as boolean | null | undefined) ?? true,
  };
}

export function PayAsYouGoSettingsV2({
  canEdit,
  registerSave,
}: {
  canEdit: boolean;
  /** The settings page's `registerV2SectionSave`: the page's save bar and leave dialog save this form. */
  registerSave?: RegisterSectionSave;
}) {
  const api = useRentalSettings();
  const [draft, setDraft] = useState<Partial<PaygValues>>({});

  const saved = savedPayg(api.settings);
  const values: PaygValues = { ...saved, ...draft };
  const changes = changedValues(values, saved);
  const isDirty = api.hasLoaded && Object.keys(changes).length > 0;
  const save = useDraftSave(isDirty);
  const busy = save.isPending;

  const submit = () =>
    save.run(async () => {
      if (Object.keys(changes).length === 0) return;
      await api.updateSettings(changes as never);
      setDraft({});
    });
  const discard = () => setDraft({});
  useRegisterLeaveSave(canEdit ? registerSave : undefined, "payg", isDirty && canEdit, submit, discard);

  const gate = rentalSettingsGate(api, "pay as you go settings", 3);
  if (gate.block) return gate.block;

  const set = (key: keyof PaygValues) => (checked: boolean) => setDraft((prev) => ({ ...prev, [key]: checked }));

  return (
    <div className="space-y-4">
      {gate.inlineError}
      <SettingsReadOnlyFieldset readOnly={!canEdit}>
        <SettingsPanel
          footer={canEdit ? <DraftSaveFooter save={save} isDirty={isDirty} onSave={submit} onDiscard={discard} /> : undefined}
        >
          <SettingsRow
            label="Pay as you go"
            description="The rental, tax and percentage fees build up daily and are paid as the rental runs. Deposit, insurance and delivery are still paid upfront."
          >
            <Switch
              checked={values.pay_as_you_go_enabled}
              onCheckedChange={set("pay_as_you_go_enabled")}
              disabled={!canEdit || busy}
              aria-label="Enable Pay As You Go"
            />
          </SettingsRow>
          {values.pay_as_you_go_enabled ? (
            <>
              <SettingsRow label="Take the first week or month upfront" description="The keys cannot be handed over until it is paid.">
                <Switch
                  checked={values.payg_upfront_required}
                  onCheckedChange={set("payg_upfront_required")}
                  disabled={!canEdit || busy}
                  aria-label="Require upfront payment"
                />
              </SettingsRow>
              <SettingsRow
                label="Daily reminder emails"
                description="Sent while the customer owes money. You can always send one by hand."
              >
                <Switch
                  checked={values.payg_auto_reminders_enabled}
                  onCheckedChange={set("payg_auto_reminders_enabled")}
                  disabled={!canEdit || busy}
                  aria-label="Send automated reminders"
                />
              </SettingsRow>
            </>
          ) : (
            <SettingsRow
              label="Off for new rentals"
              description="Every rental is paid the usual way. Turn this on to offer pay as you go when you create a rental."
            />
          )}
        </SettingsPanel>
      </SettingsReadOnlyFieldset>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Auto-extension                                                              */
/* -------------------------------------------------------------------------- */

const NUMBER_KEYS = Object.keys(AUTO_EXTEND_NUMBER_FIELDS) as AutoExtendNumberKey[];

interface AutoExtendChoices {
  auto_extend_enabled?: boolean;
  auto_extend_default_charge_mode?: string;
}

export function AutoExtendSettingsV2({
  canEdit,
  registerSave,
}: {
  canEdit: boolean;
  /** The settings page's `registerV2SectionSave`: the page's save bar and leave dialog save this form. */
  registerSave?: RegisterSectionSave;
}) {
  const api = useRentalSettings();
  const [choices, setChoices] = useState<AutoExtendChoices>({});
  // What is typed in each number field, as typed. No entry: the field shows the saved value.
  const [drafts, setDrafts] = useState<Partial<Record<AutoExtendNumberKey, string>>>({});

  const saved = (api.settings ?? {}) as unknown as Record<string, unknown>;
  const savedEnabled = (saved.auto_extend_enabled as boolean | null | undefined) ?? false;
  const savedChargeMode = (saved.auto_extend_default_charge_mode as string | null | undefined) ?? "pay_link";
  const enabled = choices.auto_extend_enabled ?? savedEnabled;
  const chargeMode = choices.auto_extend_default_charge_mode ?? savedChargeMode;
  const savedNumber = (key: AutoExtendNumberKey) => {
    const value = saved[key];
    return typeof value === "number" && Number.isFinite(value) ? value : AUTO_EXTEND_NUMBER_FIELDS[key].fallback;
  };

  // Each typed number: its check, and whether it differs from what is saved.
  const typed = NUMBER_KEYS.filter((key) => drafts[key] !== undefined).map((key) => {
    const { min, max, unit } = AUTO_EXTEND_NUMBER_FIELDS[key];
    const check = checkWholeNumber(drafts[key] as string, min, max, unit);
    // `in`, not `!check.ok`: portal has strictNullChecks off, which stops a
    // boolean discriminant from narrowing the union.
    const message = "message" in check ? check.message : null;
    const value = "value" in check ? check.value : null;
    return { key, message, value, changed: message !== null || value !== savedNumber(key) };
  });
  const typedError = (key: AutoExtendNumberKey) => typed.find((t) => t.key === key)?.message ?? null;

  // The number rows show only while auto-extension is on, so their edits count
  // only then; turning it off and saving writes just the switch.
  const numberChanges = enabled ? typed.filter((t) => t.changed) : [];
  const invalid = numberChanges.find((t) => t.message !== null) ?? null;
  const changes: Record<string, unknown> = {};
  if (enabled !== savedEnabled) changes.auto_extend_enabled = enabled;
  if (chargeMode !== savedChargeMode) changes.auto_extend_default_charge_mode = chargeMode;
  for (const t of numberChanges) if (t.message === null) changes[t.key] = t.value;
  const isDirty = api.hasLoaded && (Object.keys(changes).length > 0 || invalid !== null);
  const save = useDraftSave(isDirty);
  const busy = save.isPending;

  const submit = async () => {
    if (invalid) {
      const { label } = AUTO_EXTEND_NUMBER_FIELDS[invalid.key];
      throw new Error(`${label}: ${invalid.message}.`);
    }
    await save.run(async () => {
      if (Object.keys(changes).length === 0) return;
      await api.updateSettings(changes as never);
      setChoices({});
      setDrafts({});
    });
  };
  const discard = () => {
    setChoices({});
    setDrafts({});
  };
  useRegisterLeaveSave(canEdit ? registerSave : undefined, "auto-extend", isDirty && canEdit, submit, discard);

  const gate = rentalSettingsGate(api, "auto-extension settings", 3);
  if (gate.block) return gate.block;

  const shownNumber = (key: AutoExtendNumberKey) => drafts[key] ?? String(savedNumber(key));
  const provider = paymentProviderState(api.settings as never);

  // A saved value outside the allowed range, while the field is not being edited.
  const savedOutOfRange = (key: AutoExtendNumberKey) => {
    if (drafts[key] !== undefined) return null;
    const value = saved[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const { min, max, unit } = AUTO_EXTEND_NUMBER_FIELDS[key];
    return Number.isInteger(value) && value >= min && value <= max
      ? null
      : `The saved value ${formatSettingsNumber(value)} is outside ${min}–${max} ${unit}. Enter a new value.`;
  };
  const numberMessage = (key: AutoExtendNumberKey) => typedError(key) ?? savedOutOfRange(key);
  const numberErrors = NUMBER_KEYS.filter((key) => numberMessage(key));

  return (
    <div className="space-y-4">
      {gate.inlineError}
      <SettingsReadOnlyFieldset readOnly={!canEdit}>
        <SettingsPanel
          footer={
            canEdit ? (
              <DraftSaveFooter save={save} isDirty={isDirty} invalid={invalid !== null} onSave={submit} onDiscard={discard} />
            ) : undefined
          }
        >
          <SettingsRow
            label="Auto-extension"
            description="A rental renews each week or month and the customer pays before each new period. The opposite of pay as you go."
          >
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => setChoices((prev) => ({ ...prev, auto_extend_enabled: checked }))}
              disabled={!canEdit || busy}
              aria-label="Enable auto-extension"
            />
          </SettingsRow>
          {enabled ? (
            <>
              <SettingsRow
                label="How to take payment"
                description="The default for new rentals. Charging the card needs the customer's card saved at booking."
                note={
                  chargeMode === "auto_charge" && provider === "missing" ? (
                    <SettingsDependencyNotice
                      tone="warning"
                      title="No payment provider is connected"
                      body="Renewals can't charge a saved card until one is. Emailing a payment link works either way."
                      action={{ label: "Open Integrations", href: "/integrations" }}
                    />
                  ) : undefined
                }
              >
                <Select
                  value={chargeMode}
                  onValueChange={(value) => setChoices((prev) => ({ ...prev, auto_extend_default_charge_mode: value }))}
                  disabled={!canEdit || busy}
                >
                  <SelectTrigger className="w-full max-w-60 sm:w-60" aria-label="How to take payment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pay_link">Email a payment link</SelectItem>
                    <SelectItem value="auto_charge">Charge the saved card</SelectItem>
                  </SelectContent>
                </Select>
              </SettingsRow>
              <SettingsRow
                label="Timing and retries"
                description="Charge this many hours before a period ends, keep trying for the grace window, and pause after the failed attempts."
                note={
                  numberErrors.length > 0 ? (
                    <ul role="alert" className="space-y-0.5 text-destructive">
                      {numberErrors.map((key) => (
                        <li key={key} className="[overflow-wrap:anywhere]">
                          {AUTO_EXTEND_NUMBER_FIELDS[key].label}: {numberMessage(key)}
                        </li>
                      ))}
                    </ul>
                  ) : undefined
                }
              >
                {NUMBER_KEYS.map((key) => {
                  const field = AUTO_EXTEND_NUMBER_FIELDS[key];
                  const fieldInvalid = Boolean(numberMessage(key));
                  const shown = shownNumber(key);
                  const [before, after] =
                    key === "auto_extend_default_lead_hours"
                      ? ["Charge", "h early"]
                      : key === "auto_extend_grace_hours"
                        ? ["Grace", "h"]
                        : ["Retries", ""];
                  return (
                    <label key={key} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      {before}
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={field.min}
                        max={field.max}
                        step={1}
                        value={shown}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        disabled={!canEdit || busy}
                        aria-invalid={fieldInvalid || undefined}
                        aria-label={`${field.label} (${field.min}–${field.max} ${field.unit})`}
                        className="w-20 tabular-nums"
                        // Wide enough for every digit: 80px cut "9999999" to "999999" on a phone.
                        style={shown.length > 4 ? { minWidth: `calc(${Math.min(shown.length, 16)}ch + 1.75rem)` } : undefined}
                      />
                      {after}
                    </label>
                  );
                })}
              </SettingsRow>
            </>
          ) : (
            <SettingsRow
              label="Off for new rentals"
              description="Rentals end on their return date. Turn this on to offer weekly or monthly renewals when you create a rental."
            />
          )}
        </SettingsPanel>
      </SettingsReadOnlyFieldset>
    </div>
  );
}
