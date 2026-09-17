"use client";

/**
 * v2 Settings (northwind): the Tax and fees and Security deposit pages, with
 * every state an operator can meet: first load, a failed read, a missing Stripe
 * connection, unsaved / saving / failed saves, view-only access, and extreme
 * values.
 *
 * The form still lives in `settings/page.tsx` (`rentalForm`, synced from
 * `useRentalSettings`), because other pages share it. These components take it
 * as props, run the same input transforms the page ran, and send the same
 * payloads through the same `updateRentalSettings`. Only what is shown changed.
 */

import type { ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Switch } from "@/components/ui-v2/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import { SettingsPanel, SettingsRow, Unit } from "@/components/settings-v2/settings-kit";
import { SettingsDependencyNotice, SettingsReadOnlyFieldset } from "@/components/settings-v2/section-states";
import {
  IssueLine,
  ReadGate,
  SaveFooter,
  useSectionSave,
  type RegisterSectionSave,
  type SettingsReadState,
} from "@/components/settings-v2/pricing-money-parts";
import {
  BLOCKED_SAVE_MESSAGE,
  ISSUE_TEXT_CLASS,
  NOT_DIRTY,
  depositAmountIssue,
  depositChargeGuard,
  depositDirtyState,
  depositPayload,
  feesPayload,
  hasBlockingIssue,
  isFeesDirty,
  liveHoldsMessage,
  savedDepositValues,
  savedFeesValues,
  serviceFeeIssue,
  taxIssue,
  toFiniteNumber,
  type DepositFormFields,
  type DepositSavedFields,
  type FeesFormFields,
  type FeesSavedFields,
} from "@/components/settings-v2/pricing-money-logic";
import { isStripeConnectUsable, type StripeConnectTenant } from "@/lib/stripe-connect-status";
import { formatCurrency, getCurrencySymbol } from "@/lib/format-utils";
import { cn } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FormUpdater = (update: (prev: any) => any) => void;

/** Above this an amount is echoed formatted, so 1000000 reads as $1,000,000.00. */
const ECHO_FROM = 10_000;

function Notes({ children }: { children: ReactNode[] }) {
  const items = children.filter(Boolean);
  return items.length ? <div className="space-y-1">{items}</div> : undefined;
}

function prefixPadding(symbol: string) {
  return symbol.length > 1 ? "pl-12" : "pl-7";
}

/* -------------------------------------------------------------------------- */
/* Tax and fees                                                                */
/* -------------------------------------------------------------------------- */

export interface FeesSettingsV2Props {
  form: FeesFormFields;
  setForm: FormUpdater;
  saved: FeesSavedFields | null | undefined;
  read: SettingsReadState;
  canEdit: boolean;
  currencyCode: string;
  onSave: (values: Record<string, unknown>) => Promise<unknown>;
  registerSave?: RegisterSectionSave;
}

export function FeesSettingsV2({ form, setForm, saved, read, canEdit, currencyCode, onSave, registerSave }: FeesSettingsV2Props) {
  const dirty = read.hasData && isFeesDirty(form, saved);
  const tax = taxIssue(form);
  const fee = serviceFeeIssue(form, currencyCode);
  const blocked = hasBlockingIssue([tax, fee]);
  const payload = feesPayload(form);

  const save = useSectionSave({
    sectionKey: "fees",
    isDirty: dirty,
    registerSave,
    signature: JSON.stringify(payload),
    run: async () => {
      if (blocked) throw new Error(BLOCKED_SAVE_MESSAGE);
      await onSave(payload);
    },
  });

  const discard = () => {
    if (saved) setForm((prev) => ({ ...prev, ...savedFeesValues(saved) }));
  };

  const symbol = getCurrencySymbol(currencyCode);
  const isPercent = form.service_fee_type === "percentage";
  const feeValue = toFiniteNumber(form.service_fee_value) ?? 0;

  return (
    <ReadGate read={read} thing="tax and fee settings" rows={2}>
      <SettingsReadOnlyFieldset readOnly={!canEdit}>
        <SettingsPanel footer={canEdit ? <SaveFooter save={save} disabled={!dirty || blocked} onDiscard={discard} /> : undefined}>
          <SettingsRow
            label="Sales tax"
            description="Added on top of the rental as its own line on invoices."
            note={tax ? <IssueLine issue={tax} /> : undefined}
          >
            {form.tax_enabled && (
              <>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={form.tax_percentage ?? ""}
                  onChange={(e) => {
                    let rawValue = e.target.value.replace(/[^0-9.]/g, "");
                    const firstDot = rawValue.indexOf(".");
                    if (firstDot !== -1) {
                      rawValue = rawValue.slice(0, firstDot + 1) + rawValue.slice(firstDot + 1).replace(/\./g, "");
                    }
                    const [whole, decimals] = rawValue.split(".");
                    if (decimals !== undefined) {
                      rawValue = `${whole}.${decimals.slice(0, 2)}`;
                    }
                    const numValue = parseFloat(rawValue);
                    if (!isNaN(numValue) && numValue > 100) {
                      rawValue = "100";
                    }
                    setForm((prev) => ({ ...prev, tax_percentage: rawValue }));
                  }}
                  onBlur={(e) => {
                    const value = parseFloat(e.target.value);
                    setForm((prev) => ({ ...prev, tax_percentage: isNaN(value) ? 0 : Math.max(0, Math.min(100, value)) }));
                  }}
                  className="w-20 tabular-nums"
                  aria-label="Tax rate"
                />
                <Unit>%</Unit>
              </>
            )}
            <Switch
              checked={form.tax_enabled ?? false}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, tax_enabled: checked }))}
              aria-label="Enable tax"
              className="ml-2"
            />
          </SettingsRow>

          <SettingsRow
            label="Service fee"
            description="Added to every booking, as a percentage of the rental or a fixed amount."
            note={Notes({
              children: [
                fee ? <IssueLine key="issue" issue={fee} /> : null,
                form.service_fee_enabled && !isPercent && feeValue >= ECHO_FROM ? (
                  <p key="echo" className="tabular-nums text-muted-foreground">
                    {formatCurrency(feeValue, currencyCode)} on every booking.
                  </p>
                ) : null,
              ],
            })}
          >
            {form.service_fee_enabled && (
              <>
                <Select
                  value={form.service_fee_type}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, service_fee_type: value as FeesFormFields["service_fee_type"] }))
                  }
                >
                  <SelectTrigger className="w-36" aria-label="Service fee type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="fixed_amount">Fixed amount</SelectItem>
                  </SelectContent>
                </Select>
                <div className="relative">
                  {!isPercent && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                    >
                      {symbol}
                    </span>
                  )}
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={form.service_fee_value ?? ""}
                    onChange={(e) => {
                      const rawValue = e.target.value.replace(/[^0-9.]/g, "");
                      if (rawValue === "" || rawValue === ".") {
                        setForm((prev) => ({ ...prev, service_fee_value: rawValue, service_fee_amount: rawValue }));
                      } else {
                        let value = parseFloat(rawValue) || 0;
                        if (form.service_fee_type === "percentage" && value > 100) value = 100;
                        setForm((prev) => ({ ...prev, service_fee_value: Math.max(0, value), service_fee_amount: Math.max(0, value) }));
                      }
                    }}
                    onBlur={(e) => {
                      const value = parseFloat(e.target.value);
                      const finalValue = isNaN(value) ? 0 : Math.max(0, value);
                      setForm((prev) => ({ ...prev, service_fee_value: finalValue, service_fee_amount: finalValue }));
                    }}
                    className={cn("w-28 tabular-nums", isPercent ? "pr-7" : prefixPadding(symbol))}
                    aria-label={isPercent ? "Service fee percentage" : `Service fee amount in ${currencyCode}`}
                    aria-invalid={fee?.blocksSave || undefined}
                  />
                  {isPercent && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                    >
                      %
                    </span>
                  )}
                </div>
              </>
            )}
            <Switch
              checked={form.service_fee_enabled ?? false}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, service_fee_enabled: checked }))}
              aria-label="Enable service fee"
              className="ml-2"
            />
          </SettingsRow>
        </SettingsPanel>
      </SettingsReadOnlyFieldset>
    </ReadGate>
  );
}

/* -------------------------------------------------------------------------- */
/* Security deposit                                                            */
/* -------------------------------------------------------------------------- */

export interface DepositSettingsV2Props {
  form: DepositFormFields;
  setForm: FormUpdater;
  /** The tenants row from `useRentalSettings` (SELECT *, so the Connect fields come with it). */
  saved: (DepositSavedFields & StripeConnectTenant) | null | undefined;
  read: SettingsReadState;
  /** The `deposit-live-holds` count query. */
  holds: SettingsReadState;
  liveHoldCount: number;
  canEdit: boolean;
  currencyCode: string;
  paymentProvider?: string | null;
  /** Where Stripe is connected for this tenant. */
  connectHref: string;
  /** Opens the page's "Start charging the deposit?" confirm. */
  onRequestCharge: () => void;
  onSave: (values: Record<string, unknown>) => Promise<unknown>;
  registerSave?: RegisterSectionSave;
}

export function DepositSettingsV2({
  form,
  setForm,
  saved,
  read,
  holds,
  liveHoldCount,
  canEdit,
  currencyCode,
  paymentProvider,
  connectHref,
  onRequestCharge,
  onSave,
  registerSave,
}: DepositSettingsV2Props) {
  const { dirty, chargeNotSaved } = read.hasData ? depositDirtyState(form, saved) : NOT_DIRTY;
  const amountIssue = depositAmountIssue(form, currencyCode);
  const guard = depositChargeGuard({
    chargeEnabled: !!form.deposit_charge_enabled,
    holdsKnown: holds.hasData,
    holdsFailed: holds.isError,
    liveHoldCount,
  });
  const payload = depositPayload(form);

  const save = useSectionSave({
    sectionKey: "preauth",
    isDirty: dirty,
    registerSave,
    signature: JSON.stringify(payload),
    run: () => onSave(payload),
  });

  const discard = () => {
    if (saved) setForm((prev) => ({ ...prev, ...savedDepositValues(saved) }));
  };

  const needsConnect = read.hasData && (paymentProvider ?? "stripe") !== "square" && !isStripeConnectUsable(saved);
  const symbol = getCurrencySymbol(currencyCode);
  const amount = toFiniteNumber(form.global_deposit_amount) ?? 0;
  const warn = ISSUE_TEXT_CLASS.warning;

  return (
    <ReadGate read={read} thing="deposit settings" rows={3}>
      {needsConnect && (
        <SettingsDependencyNotice
          tone={form.security_deposit_enabled ? "warning" : "info"}
          title="Connect Stripe before you take deposits"
          body="Deposit holds and charges are taken through Stripe, and your Stripe account isn't connected and active yet."
          action={{ label: "Connect Stripe", href: connectHref }}
        />
      )}
      <SettingsReadOnlyFieldset readOnly={!canEdit}>
        <SettingsPanel footer={canEdit ? <SaveFooter save={save} disabled={!dirty} onDiscard={discard} /> : undefined}>
          <SettingsRow
            label="Deposit on online bookings"
            description="When off, customers booking online are not asked for one. You can still take a deposit on a rental you create."
          >
            <Switch
              checked={!!form.security_deposit_enabled}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, security_deposit_enabled: checked }))}
              aria-label="Take a security deposit on online bookings"
            />
          </SettingsRow>
          {form.security_deposit_enabled && (
            <>
              <SettingsRow
                label="Amount"
                description={
                  form.deposit_charge_enabled
                    ? "Charged on every booking. Refund it from the rental page when the car comes back."
                    : "Held on the card at pickup and released after the car is returned."
                }
                note={Notes({
                  children: [
                    form.deposit_mode === "per_vehicle" ? (
                      <p key="per-vehicle" className={warn}>
                        Your deposits are set per vehicle. This amount is only used for vehicles without their own.
                      </p>
                    ) : null,
                    amountIssue ? <IssueLine key="amount" issue={amountIssue} /> : null,
                    amount >= ECHO_FROM ? (
                      <p key="echo" className="tabular-nums text-muted-foreground">
                        {formatCurrency(amount, currencyCode)} per booking.
                      </p>
                    ) : null,
                  ],
                })}
              >
                <div className="relative">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                  >
                    {symbol}
                  </span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={form.global_deposit_amount ?? ""}
                    onChange={(e) => {
                      const rawValue = e.target.value.replace(/[^0-9.]/g, "");
                      if (rawValue === "" || rawValue === ".") {
                        setForm((prev) => ({ ...prev, global_deposit_amount: rawValue }));
                      } else {
                        setForm((prev) => ({ ...prev, global_deposit_amount: Math.max(0, parseFloat(rawValue) || 0) }));
                      }
                    }}
                    onBlur={(e) => {
                      const value = parseFloat(e.target.value);
                      setForm((prev) => ({ ...prev, global_deposit_amount: isNaN(value) ? 0 : Math.max(0, value) }));
                    }}
                    className={cn("w-32 tabular-nums", prefixPadding(symbol))}
                    aria-label={`Deposit amount in ${currencyCode}`}
                  />
                </div>
              </SettingsRow>
              <SettingsRow
                label="Charge the card instead of holding it"
                description={
                  form.deposit_charge_enabled
                    ? "The money reaches your account. Nothing is refunded automatically when a rental closes."
                    : "A temporary hold is placed and released. No money moves unless you charge against it."
                }
                note={Notes({
                  // The live-holds lines explain why switching to charges is locked.
                  // A view-only user can't switch either way, so they are not shown
                  // (and the check's Try again would sit inside the disabled fieldset).
                  children: [
                    canEdit && guard === "blocked" ? (
                      <p key="blocked" className="text-destructive">
                        {liveHoldsMessage(liveHoldCount)}
                      </p>
                    ) : null,
                    canEdit && guard === "checking" ? (
                      <p key="checking" className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        Checking for live deposit holds…
                      </p>
                    ) : null,
                    canEdit && guard === "unknown" ? (
                      <div key="unknown" role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-destructive">
                          Couldn&apos;t check for live deposit holds, so switching to charges is locked for now.
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => void holds.refetch()}
                          disabled={holds.isFetching}
                        >
                          {holds.isFetching ? (
                            <Loader2 className="animate-spin" data-icon="inline-start" />
                          ) : (
                            <RefreshCw data-icon="inline-start" />
                          )}
                          Try again
                        </Button>
                      </div>
                    ) : null,
                    chargeNotSaved && canEdit ? (
                      <p key="not-saved" className={warn}>
                        Not saved yet. Save to start charging the deposit on new bookings.
                      </p>
                    ) : null,
                  ],
                })}
              >
                <Unit>{form.deposit_charge_enabled ? "Charge" : "Hold"}</Unit>
                <Switch
                  checked={!!form.deposit_charge_enabled}
                  onCheckedChange={(checked) => {
                    // Switching ON changes what real customers are charged, so it
                    // confirms. Switching OFF is the safe direction and does not.
                    if (checked) {
                      onRequestCharge();
                      return;
                    }
                    setForm((prev) => ({ ...prev, deposit_charge_enabled: false }));
                  }}
                  disabled={guard !== "allowed"}
                  aria-label="Collect the deposit as a real charge"
                />
              </SettingsRow>
            </>
          )}
        </SettingsPanel>
      </SettingsReadOnlyFieldset>
    </ReadGate>
  );
}
