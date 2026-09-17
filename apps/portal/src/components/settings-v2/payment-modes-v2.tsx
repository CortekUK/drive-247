"use client";

/**
 * v2 (northwind): the Pay As You Go and Auto-extension settings pages.
 *
 * These were inline in `settings/page.tsx`. They moved here so every state has
 * an owner, because both pages save each control the moment it changes:
 *
 * - FIRST LOAD / FAILED READ. `useRentalSettings` shows defaults while it loads
 *   and after a failed read ("off", 0 h, 48 h, 3). A switch that writes on click
 *   must never render over those, or one click writes a default over the real
 *   value. So: skeleton until a real row arrives, the load error with a retry if
 *   it never does, and the inline error above the controls if a refresh fails.
 * - SAVE FAILURE. The control shows the saved value again (the database kept
 *   it), and the row explains what failed with a Retry. The hook's own toast is
 *   the only toast.
 * - SAVING. The control being written is disabled and its row says "Saving…".
 * - READ-ONLY. A native disabled fieldset, so the keyboard cannot flip a switch
 *   the mouse cannot reach.
 * - NUMBERS. Auto-extend's hours and retries are checked on blur. An empty,
 *   negative, decimal or out-of-range value is not saved: the field shows why.
 *   An unchanged value is not re-saved. A value ALREADY saved outside the range
 *   (written before these checks) is shown as saved, marked, and explained; it
 *   is never corrected silently. Each field widens for a long number instead of
 *   cutting digits off.
 *
 * Values that ARE saved are exactly the ones the inline page saved.
 */

import { useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsPanel, SettingsRow } from "@/components/settings-v2/settings-kit";
import {
  formatSettingsNumber,
  SettingsDependencyNotice,
  SettingsLoadError,
  SettingsReadOnlyFieldset,
  SettingsSaveState,
  SettingsSectionSkeleton,
} from "@/components/settings-v2/section-states";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import {
  AUTO_EXTEND_NUMBER_FIELDS,
  checkWholeNumber,
  paymentProviderState,
  type AutoExtendNumberKey,
} from "@/lib/settings-money-states";
import { cn } from "@/lib/utils";

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

/**
 * One instant-save setting at a time: the value being written shows while it
 * is in flight, the saved value shows again if the write fails, and the failure
 * is kept for its row to explain.
 */
export function useInstantRentalSetting(updateSettings: RentalSettingsApi["updateSettings"]) {
  const [pending, setPending] = useState<Record<string, unknown>>({});
  const [failure, setFailure] = useState<{ key: string; error: unknown; value: unknown } | null>(null);

  const save = async (key: string, value: unknown) => {
    setFailure(null);
    setPending((prev) => ({ ...prev, [key]: value }));
    try {
      await updateSettings({ [key]: value } as never);
      return true;
    } catch (error) {
      setFailure({ key, error, value });
      return false;
    } finally {
      setPending((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  return {
    save,
    valueOf: <T,>(key: string, saved: T): T => (key in pending ? (pending[key] as T) : saved),
    isPending: (key: string) => key in pending,
    anyPending: Object.keys(pending).length > 0,
    failure,
    retry: () => (failure ? save(failure.key, failure.value) : undefined),
  };
}

type InstantSetting = ReturnType<typeof useInstantRentalSetting>;

/** The row note for one key: "Saving…", or what failed with a Retry. */
function rowNote(instant: InstantSetting, keys: string[], failedCopy: string): ReactNode {
  if (keys.some((key) => instant.isPending(key))) return <SettingsSaveState status="saving" />;
  if (instant.failure && keys.includes(instant.failure.key)) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-destructive">
        <span>{failedCopy} Nothing was changed.</span>
        <button
          type="button"
          onClick={() => void instant.retry()}
          className="font-medium underline underline-offset-2 hover:no-underline"
        >
          Try again
        </button>
      </div>
    );
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Pay As You Go                                                               */
/* -------------------------------------------------------------------------- */

export function PayAsYouGoSettingsV2({ canEdit }: { canEdit: boolean }) {
  const api = useRentalSettings();
  const instant = useInstantRentalSetting(api.updateSettings);

  const gate = rentalSettingsGate(api, "pay as you go settings", 3);
  if (gate.block) return gate.block;

  const saved = api.settings as unknown as Record<string, unknown>;
  const enabled = instant.valueOf("pay_as_you_go_enabled", (saved.pay_as_you_go_enabled as boolean | null) ?? false);
  const upfront = instant.valueOf("payg_upfront_required", (saved.payg_upfront_required as boolean | null) ?? false);
  const reminders = instant.valueOf(
    "payg_auto_reminders_enabled",
    (saved.payg_auto_reminders_enabled as boolean | null | undefined) ?? true,
  );
  const busy = api.isUpdating || instant.anyPending;

  return (
    <div className="space-y-4">
      {gate.inlineError}
      <SettingsReadOnlyFieldset readOnly={!canEdit}>
        <SettingsPanel>
          <SettingsRow
            label="Pay as you go"
            description="The rental, tax and percentage fees build up daily and are paid as the rental runs. Deposit, insurance and delivery are still paid upfront."
            note={rowNote(
              instant,
              ["pay_as_you_go_enabled"],
              `Couldn't turn pay as you go ${instant.failure?.value ? "on" : "off"}.`,
            )}
          >
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => void instant.save("pay_as_you_go_enabled", checked)}
              disabled={!canEdit || busy}
              aria-label="Enable Pay As You Go"
            />
          </SettingsRow>
          {enabled ? (
            <>
              <SettingsRow
                label="Take the first week or month upfront"
                description="The keys cannot be handed over until it is paid."
                note={rowNote(instant, ["payg_upfront_required"], "Couldn't update upfront payment.")}
              >
                <Switch
                  checked={upfront}
                  onCheckedChange={(checked) => void instant.save("payg_upfront_required", checked)}
                  disabled={!canEdit || busy}
                  aria-label="Require upfront payment"
                />
              </SettingsRow>
              <SettingsRow
                label="Daily reminder emails"
                description="Sent while the customer owes money. You can always send one by hand."
                note={rowNote(instant, ["payg_auto_reminders_enabled"], "Couldn't update reminder emails.")}
              >
                <Switch
                  checked={reminders}
                  onCheckedChange={(checked) => void instant.save("payg_auto_reminders_enabled", checked)}
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

export function AutoExtendSettingsV2({ canEdit }: { canEdit: boolean }) {
  const api = useRentalSettings();
  const instant = useInstantRentalSetting(api.updateSettings);
  const [drafts, setDrafts] = useState<Partial<Record<AutoExtendNumberKey, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AutoExtendNumberKey, string>>>({});

  const gate = rentalSettingsGate(api, "auto-extension settings", 3);
  if (gate.block) return gate.block;

  const saved = api.settings as unknown as Record<string, unknown>;
  const enabled = instant.valueOf("auto_extend_enabled", (saved.auto_extend_enabled as boolean | null) ?? false);
  const chargeMode = instant.valueOf(
    "auto_extend_default_charge_mode",
    (saved.auto_extend_default_charge_mode as string | null) ?? "pay_link",
  );
  const savedNumber = (key: AutoExtendNumberKey) => {
    const value = saved[key];
    return typeof value === "number" && Number.isFinite(value) ? value : AUTO_EXTEND_NUMBER_FIELDS[key].fallback;
  };
  const shownNumber = (key: AutoExtendNumberKey) => drafts[key] ?? String(instant.valueOf(key, savedNumber(key)));
  const provider = paymentProviderState(api.settings as never);

  const commitNumber = async (key: AutoExtendNumberKey) => {
    const field = AUTO_EXTEND_NUMBER_FIELDS[key];
    const raw = drafts[key];
    if (raw === undefined) return;
    const check = checkWholeNumber(raw, field.min, field.max, field.unit);
    // `in`, not `!check.ok`: portal has strictNullChecks off, which stops a
    // boolean discriminant from narrowing the union.
    if ("message" in check) {
      const { message } = check;
      setFieldErrors((prev) => ({ ...prev, [key]: message }));
      return;
    }
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (check.value === savedNumber(key)) return;
    await instant.save(key, check.value);
  };

  // A saved value outside the allowed range, while the field is not being edited.
  const savedOutOfRange = (key: AutoExtendNumberKey) => {
    if (drafts[key] !== undefined || instant.isPending(key)) return null;
    const value = saved[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const { min, max, unit } = AUTO_EXTEND_NUMBER_FIELDS[key];
    return Number.isInteger(value) && value >= min && value <= max
      ? null
      : `The saved value ${formatSettingsNumber(value)} is outside ${min}–${max} ${unit}. Enter a new value.`;
  };
  const numberMessage = (key: AutoExtendNumberKey) => fieldErrors[key] ?? savedOutOfRange(key);
  const numberErrors = NUMBER_KEYS.filter((key) => numberMessage(key));

  return (
    <div className="space-y-4">
      {gate.inlineError}
      <SettingsReadOnlyFieldset readOnly={!canEdit}>
        <SettingsPanel>
          <SettingsRow
            label="Auto-extension"
            description="A rental renews each week or month and the customer pays before each new period. The opposite of pay as you go."
            note={rowNote(
              instant,
              ["auto_extend_enabled"],
              `Couldn't turn auto-extension ${instant.failure?.value ? "on" : "off"}.`,
            )}
          >
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => void instant.save("auto_extend_enabled", checked)}
              disabled={!canEdit || instant.isPending("auto_extend_enabled")}
              aria-label="Enable auto-extension"
            />
          </SettingsRow>
          {enabled ? (
            <>
              <SettingsRow
                label="How to take payment"
                description="The default for new rentals. Charging the card needs the customer's card saved at booking."
                note={
                  rowNote(instant, ["auto_extend_default_charge_mode"], "Couldn't change how payment is taken.") ??
                  (chargeMode === "auto_charge" && provider === "missing" ? (
                    <SettingsDependencyNotice
                      tone="warning"
                      title="No payment provider is connected"
                      body="Renewals can't charge a saved card until one is. Emailing a payment link works either way."
                      action={{ label: "Open Integrations", href: "/integrations" }}
                    />
                  ) : undefined)
                }
              >
                <Select
                  value={chargeMode}
                  onValueChange={(value) => void instant.save("auto_extend_default_charge_mode", value)}
                  disabled={!canEdit || instant.isPending("auto_extend_default_charge_mode")}
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
                  rowNote(instant, NUMBER_KEYS, "Couldn't save the timing.") ??
                  (numberErrors.length > 0 ? (
                    <ul role="alert" className="space-y-0.5 text-destructive">
                      {numberErrors.map((key) => (
                        <li key={key} className="[overflow-wrap:anywhere]">
                          {AUTO_EXTEND_NUMBER_FIELDS[key].label}: {numberMessage(key)}
                        </li>
                      ))}
                    </ul>
                  ) : undefined)
                }
              >
                {NUMBER_KEYS.map((key) => {
                  const field = AUTO_EXTEND_NUMBER_FIELDS[key];
                  const invalid = Boolean(numberMessage(key));
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
                        onBlur={() => void commitNumber(key)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        disabled={!canEdit || instant.isPending(key)}
                        aria-invalid={invalid || undefined}
                        aria-label={`${field.label} (${field.min}–${field.max} ${field.unit})`}
                        className={cn("w-20 tabular-nums", invalid && "border-destructive")}
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
