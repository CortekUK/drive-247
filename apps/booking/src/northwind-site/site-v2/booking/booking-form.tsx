"use client";

import { Check, Loader2, MapPin, Package, Ticket } from "lucide-react-nw";

import {
  applyPickupDate,
  deriveBookingFormModel,
  describeExtra,
  describeLocationOption,
  describePromoDiscount,
  fixedReturnSecondary,
} from "@nw/components/booking/booking-form-logic";
import type { BookingRules, DeliveryModeAvailability } from "@nw/components/booking/booking-rules";
import type { UsePromoCodeResult } from "@nw/components/booking/use-promo-code";
import type { BookingField } from "@nw/components/booking/validation";
import { Button } from "@nw/components/ui/button";
import { Input } from "@nw/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nw/components/ui/select";
import { useTenantBranding } from "@nw/hooks/use-tenant-branding";
import type { QuoteResult } from "@nw/lib/quote/types";
import { useBookingStore } from "@nw/lib/stores/booking-store";
import { cn } from "@nw/lib/utils";
import { ICON_TILE } from "@nw/site-v2/kit";
import type { PickupLocation, RentalExtra } from "@nw/lib/vehicles/types";

import {
  CheckboxRow,
  DateField,
  FIELD_FULL_WIDTH,
  FIELD_INPUT_CLASS,
  FIELD_TRIGGER_CLASS,
  FieldError,
  FieldGrid,
  FieldHint,
  FieldLabel,
  FormSection as Section,
  ModeCard,
  NativeDateField,
  OptionalTag,
  Pill,
  QuantityStepper,
  RequiredLegend,
  SELECT_CONTENT,
  SELECT_ITEM_CLASS,
  TextField,
  TimeField,
} from "./field-primitives";

/**
 * The booking form, v2 — every field v1 collects before payment.
 *
 * Same export and props as v1's `components/booking/booking-form.tsx`; the v2
 * vehicle page composes it by that contract. Only the markup is forked: which
 * legs are required, which return control appears, the date caption, an
 * extra's stock line and the pickup-date write all come from v1's
 * `booking-form-logic.ts`, and every value is read from and written to the same
 * `useBookingStore` — so the validator, the quote and the checkout see exactly
 * what they see on v1.
 *
 * The DOM ids are v1's, unchanged. The page's `FIELD_BY_DOM_ID` map keys on
 * them to reveal an error on blur, so renaming one would silently break that.
 *
 * Each section is its own calm card (v1 stacked them inside one box), the
 * fields are the kit's 44px / 10px shape, and anything selectable — a delivery
 * mode, an extra — is a bordered card that tints when chosen.
 */

export interface BookingFormProps {
  rules: BookingRules;
  modes: DeliveryModeAvailability;
  pickupLocations: readonly PickupLocation[];
  returnLocations: readonly PickupLocation[];
  extras: readonly RentalExtra[];
  quote: QuoteResult;
  /** Resolves an error message for a field, already gated on "has the customer tried yet". */
  errorFor: (field: BookingField) => string | undefined;
  /** Days the customer may not pick, per leg. */
  isPickupDateDisabled: (date: Date) => boolean;
  isReturnDateDisabled: (date: Date) => boolean;
  /** How the area-delivery fee is described before an address is priced. */
  areaFeeHint: string | null;
  /** True when this tenant prices area delivery by distance and we cannot yet. */
  areaFeePending: boolean;
  promo: UsePromoCodeResult;
  rentalDays: number | null;
  className?: string;
}

export function BookingForm({
  rules,
  modes,
  pickupLocations,
  returnLocations,
  extras,
  quote,
  errorFor,
  isPickupDateDisabled,
  isReturnDateDisabled,
  areaFeeHint,
  areaFeePending,
  promo,
  rentalDays,
  className,
}: BookingFormProps) {
  const { formatCurrency } = useTenantBranding();
  const form = useBookingStore();
  const {
    mode,
    required,
    returnAddressFallback,
    canChooseReturnLeg,
    dateCaptions,
    showOptions,
  } = deriveBookingFormModel({ form, rules, modes, quote, rentalDays });
  const canChooseReturn = canChooseReturnLeg(returnLocations.length);

  /* The two legs, resolved once and then placed in the field grid (as v1). */
  const pickupControl =
    mode === "location" ? (
      <LocationPicker
        id="pickup-location"
        label="Pickup location"
        locations={pickupLocations}
        value={form.pickupLocationId}
        onChange={(id) => form.set("pickupLocationId", id)}
        formatCurrency={formatCurrency}
        required={required.pickup}
        error={errorFor("pickupLocation")}
      />
    ) : mode === "area" ? (
      <TextField
        id="delivery-address"
        label="Delivery address"
        value={form.pickupAddress}
        onChange={(value) => form.set("pickupAddress", value)}
        placeholder="Street, city, postcode"
        autoComplete="street-address"
        required={required.pickup}
        error={errorFor("pickupLocation")}
        className={form.sameAsPickup ? FIELD_FULL_WIDTH : undefined}
      />
    ) : rules.fixedPickupAddress ? (
      <AddressPanel
        label="Collect from and return to"
        address={rules.fixedPickupAddress}
        secondary={fixedReturnSecondary(rules)}
        className={FIELD_FULL_WIDTH}
      />
    ) : (
      <TextField
        id="pickup-address"
        label="Pickup address"
        value={form.pickupAddress}
        onChange={(value) => form.set("pickupAddress", value)}
        placeholder="Where should we meet you?"
        autoComplete="street-address"
        required={required.pickup}
        error={errorFor("pickupLocation")}
        className={form.sameAsPickup ? FIELD_FULL_WIDTH : undefined}
      />
    );

  const returnControl =
    canChooseReturn && !form.sameAsPickup ? (
      mode === "location" ? (
        <LocationPicker
          id="return-location"
          label="Return location"
          locations={returnLocations}
          value={form.returnLocationId}
          onChange={(id) => form.set("returnLocationId", id)}
          formatCurrency={formatCurrency}
          required={required.return}
          error={errorFor("returnLocation")}
        />
      ) : (
        <TextField
          id="return-address"
          label={mode === "area" ? "Collection address" : "Return address"}
          value={form.returnAddress}
          onChange={(value) => form.set("returnAddress", value)}
          placeholder={returnAddressFallback ?? "Street, city, postcode"}
          autoComplete="street-address"
          required={required.return}
          optional={!required.return}
          error={errorFor("returnLocation")}
        />
      )
    ) : null;

  return (
    <div className={cn("space-y-4", className)}>
      <RequiredLegend />

      {/* ── When ─────────────────────────────────────────────────────── */}
      <Section
        title="Your dates"
        description="When you collect the car, and when you bring it back."
      >
        {/*
          A date and its time stay two-up even on a phone (v1's reasoning: they
          read as one answer, and a time picker has no use for the full width).
        */}
        <FieldGrid className="grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <DateField
            id="pickup-date"
            label="Pickup date"
            value={form.pickupDate}
            onChange={(iso) => applyPickupDate(form, iso)}
            isDisabledDate={isPickupDateDisabled}
            required
            error={errorFor("pickupDate")}
          />
          <TimeField
            id="pickup-time"
            label="Pickup time"
            value={form.pickupTime}
            onChange={(time) => form.set("pickupTime", time)}
            slots={rules.timeSlots}
            required
            error={errorFor("pickupTime")}
          />
          <DateField
            id="return-date"
            label="Return date"
            value={form.dropoffDate}
            onChange={(iso) => form.set("dropoffDate", iso)}
            isDisabledDate={isReturnDateDisabled}
            defaultMonthIso={form.pickupDate}
            required
            error={errorFor("dropoffDate")}
          />
          <TimeField
            id="return-time"
            label="Return time"
            value={form.dropoffTime}
            onChange={(time) => form.set("dropoffTime", time)}
            slots={rules.timeSlots}
            required
            error={errorFor("dropoffTime")}
          />
        </FieldGrid>

        {dateCaptions.length > 0 ? (
          <p className="rounded-[10px] bg-pv-muted px-3 py-2 text-xs leading-relaxed text-pv-muted-fg">
            {dateCaptions.join(" · ")}
          </p>
        ) : null}
      </Section>

      {/* ── Where ────────────────────────────────────────────────────── */}
      <Section
        title="Pickup and return"
        description="Where you collect the car and where it comes back to."
      >
        {modes.showChooser ? (
          <div
            role="radiogroup"
            aria-label="Pickup and return"
            className={cn(
              "grid grid-cols-1 gap-3",
              modes.enabled.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
            )}
          >
            {modes.fixed ? (
              <ModeCard
                selected={mode === "fixed"}
                onSelect={() => form.set("deliveryOption", "fixed")}
                title="Collect from us"
                badge={<Pill tone="positive">Free</Pill>}
                description={
                  rules.fixedPickupAddress ??
                  "Pick the vehicle up from, and return it to, our location."
                }
              />
            ) : null}

            {modes.location ? (
              <ModeCard
                selected={mode === "location"}
                onSelect={() => form.set("deliveryOption", "location")}
                title="Choose a location"
                description="Collect from one of our pickup points."
              />
            ) : null}

            {modes.area ? (
              <ModeCard
                selected={mode === "area"}
                onSelect={() => form.set("deliveryOption", "area")}
                title="Deliver to me"
                badge={areaFeeHint ? <Pill>{areaFeeHint}</Pill> : undefined}
                description="We bring the vehicle to your address and collect it afterwards."
              />
            ) : null}
          </div>
        ) : null}

        {canChooseReturn ? (
          <CheckboxRow
            id="same-as-pickup"
            checked={form.sameAsPickup}
            onChange={(checked) => form.set("sameAsPickup", checked)}
          >
            Return to the same place
          </CheckboxRow>
        ) : null}

        <FieldGrid>
          {pickupControl}
          {returnControl}
        </FieldGrid>

        {mode === "area" && areaFeePending ? (
          <FieldHint>
            Delivery to this address is priced by distance
            {areaFeeHint ? ` (${areaFeeHint})` : ""}. The exact fee is confirmed
            before you pay and is not in the total.
          </FieldHint>
        ) : null}
      </Section>

      {/* ── Driver ───────────────────────────────────────────────────── */}
      <Section
        title="Your details"
        description="The main driver. We use these to confirm the booking with you."
      >
        <FieldGrid>
          <TextField
            id="customer-name"
            label="Full name"
            value={form.customerName}
            onChange={(value) => form.set("customerName", value)}
            placeholder="As it appears on your licence"
            autoComplete="name"
            required
            error={errorFor("customerName")}
          />
          <TextField
            id="customer-email"
            label="Email"
            type="email"
            inputMode="email"
            value={form.customerEmail}
            onChange={(value) => form.set("customerEmail", value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            error={errorFor("customerEmail")}
          />
          <TextField
            id="customer-phone"
            label="Phone"
            type="tel"
            inputMode="tel"
            value={form.customerPhone}
            onChange={(value) => form.set("customerPhone", value)}
            placeholder="+1 555 000 0000"
            autoComplete="tel"
            required
            error={errorFor("customerPhone")}
          />
          <NativeDateField
            id="driver-dob"
            label="Date of birth"
            value={form.driverDOB}
            onChange={(value) => form.set("driverDOB", value)}
            autoComplete="bday"
            required
            hint={`Drivers must be at least ${rules.minimumAge}.`}
            error={errorFor("driverDOB")}
          />
        </FieldGrid>
      </Section>

      {/* ── Promo ────────────────────────────────────────────────────── */}
      <Section
        title="Promo code"
        description="Have a code? Apply it here and we take it off the rental."
        action={<OptionalTag />}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Input
              id="promo-code"
              value={form.promoCode}
              placeholder="Enter a code"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={promo.promo !== null}
              aria-label="Promo code"
              aria-invalid={promo.error ? true : undefined}
              onChange={(event) => form.set("promoCode", event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || promo.promo !== null) return;
                event.preventDefault();
                void promo.apply(form.promoCode);
              }}
              className={cn(FIELD_INPUT_CLASS, "uppercase placeholder:normal-case")}
            />
          </div>
          {promo.promo ? (
            <Button
              type="button"
              variant="brand-outline"
              size="lg"
              className="h-11 shrink-0 px-5"
              onClick={() => {
                promo.clear();
                form.set("promoCode", "");
              }}
            >
              Clear
            </Button>
          ) : (
            <Button
              type="button"
              variant="brand-outline"
              size="lg"
              className="h-11 min-w-[88px] shrink-0 px-5"
              disabled={promo.isValidating || form.promoCode.trim() === ""}
              onClick={() => void promo.apply(form.promoCode)}
            >
              {promo.isValidating ? (
                <Loader2 className="animate-spin" aria-label="Checking" />
              ) : (
                "Apply"
              )}
            </Button>
          )}
        </div>

        {promo.promo ? (
          <p className="flex items-center gap-2 rounded-[10px] bg-pv-success-light px-3 py-2 text-xs font-medium text-pv-success">
            <Ticket aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0" />
            {promo.promo.code} applied —{" "}
            {describePromoDiscount(promo.promo, formatCurrency)}{" "}
            the rental.
          </p>
        ) : null}
        <FieldError message={promo.error ?? undefined} />
      </Section>

      {/* ── Extras ───────────────────────────────────────────────────── */}
      {extras.length > 0 ? (
        <Section
          title="Extras"
          description="Add anything you would like ready with the car."
          action={<OptionalTag />}
        >
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {extras.map((extra) => (
              <li key={extra.id}>
                <ExtraTile
                  extra={extra}
                  quantity={form.selectedExtras[extra.id] ?? 0}
                  onChange={(next) => form.setExtraQuantity(extra.id, next)}
                  formatCurrency={formatCurrency}
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* ── Mileage upgrade & installments ───────────────────────────── */}
      {showOptions ? (
        <Section
          title="Options"
          description="Ways to tailor the rental to how you will use it."
          action={<OptionalTag />}
        >
          {quote.unlimitedMileage.available ? (
            <OptionCard selected={form.addUnlimitedMileage}>
              <CheckboxRow
                id="unlimited-mileage"
                checked={form.addUnlimitedMileage}
                onChange={(checked) => form.set("addUnlimitedMileage", checked)}
              >
                <span className="font-semibold text-pv-fg">
                  Add unlimited mileage
                </span>{" "}
                — {formatCurrency(quote.unlimitedMileage.price)} for the whole
                rental. Drive as far as you like with no excess charge.
              </CheckboxRow>
            </OptionCard>
          ) : null}

          {rules.installmentsEnabled ? (
            <OptionCard selected={form.wantsInstallments}>
              <CheckboxRow
                id="wants-installments"
                checked={form.wantsInstallments}
                onChange={(checked) => form.set("wantsInstallments", checked)}
              >
                I would like to pay in installments. A member of the team will set
                up your schedule after the booking is confirmed.
              </CheckboxRow>
            </OptionCard>
          ) : null}
        </Section>
      ) : null}

      {/* ── Consent ──────────────────────────────────────────────────── */}
      <Section
        title="Before you book"
        description="Two quick confirmations, so we both know where we stand."
      >
        <CheckboxRow
          id="agree-terms"
          checked={form.agreeTerms}
          onChange={(checked) => form.set("agreeTerms", checked)}
          required
          error={errorFor("agreeTerms")}
        >
          I have read and agree to the rental terms and conditions and the
          privacy policy.
        </CheckboxRow>

        {/* Separate from the terms and equally required — see v1. */}
        <CheckboxRow
          id="agree-charges"
          checked={form.agreeCharges}
          onChange={(checked) => form.set("agreeCharges", checked)}
          required
          error={errorFor("agreeCharges")}
        >
          I authorise charges after the rental for fuel, excess mileage, tolls,
          fines or damage, in line with the rental agreement.
        </CheckboxRow>

        {rules.smsConsentRequired ? (
          <CheckboxRow
            id="sms-consent"
            checked={form.smsConsent}
            onChange={(checked) => form.set("smsConsent", checked)}
            optional
          >
            Text me booking updates. Message and data rates may apply; reply STOP
            to opt out.
          </CheckboxRow>
        ) : null}
      </Section>
    </div>
  );
}

/* ─────────────────────────────── sub-parts ───────────────────────────── */

const CARD_MOTION = "transition-colors duration-200 ease-out motion-reduce:transition-none";

/** A bordered option that tints when its checkbox is ticked. */
function OptionCard({
  selected,
  children,
}: {
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3.5 py-3",
        CARD_MOTION,
        selected ? "border-pv-primary bg-pv-tint" : "border-pv-border bg-pv-card",
      )}
    >
      {children}
    </div>
  );
}

/** One extra, as a bordered card that tints once it is added. */
function ExtraTile({
  extra,
  quantity,
  onChange,
  formatCurrency,
}: {
  extra: RentalExtra;
  quantity: number;
  onChange: (next: number) => void;
  formatCurrency: (amount: number) => string;
}) {
  const { cap, soldOut, shown, image, stock, billing } = describeExtra(
    extra,
    quantity,
  );
  const added = shown > 0;

  return (
    <div
      className={cn(
        "flex h-full items-center gap-3 rounded-xl border p-3",
        CARD_MOTION,
        added ? "border-pv-primary bg-pv-tint" : "border-pv-border bg-pv-card",
        soldOut && "opacity-60",
      )}
    >
      <span className="relative shrink-0">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            loading="lazy"
            className="size-11 rounded-[10px] border border-pv-border object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-11 place-items-center rounded-[10px] bg-pv-tint text-pv-primary"
          >
            <Package strokeWidth={1.75} className="size-4" />
          </span>
        )}
        {added ? (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-1.5 grid size-[18px] place-items-center rounded-full bg-pv-primary text-pv-primary-fg ring-2 ring-pv-card"
          >
            <Check strokeWidth={3} className="size-2.5" />
          </span>
        ) : null}
      </span>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-pv-fg">
          {extra.name}
        </p>
        <p className="mt-0.5 text-xs leading-snug text-pv-muted-fg">
          {formatCurrency(extra.price)}
          {billing}
          {stock}
        </p>
      </div>

      <QuantityStepper
        label={extra.name}
        value={shown}
        max={cap}
        onChange={onChange}
      />
    </div>
  );
}

function LocationPicker({
  id,
  label,
  locations,
  value,
  onChange,
  formatCurrency,
  required,
  error,
}: {
  id: string;
  label: string;
  locations: readonly PickupLocation[];
  value: string | null;
  onChange: (id: string) => void;
  formatCurrency: (amount: number) => string;
  required?: boolean;
  error?: string;
}) {
  if (locations.length === 0) {
    return (
      <p className="rounded-[10px] bg-pv-muted px-3 py-2.5 text-xs text-pv-muted-fg">
        No locations are available for this leg right now.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger
          id={id}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          className={FIELD_TRIGGER_CLASS}
        >
          <SelectValue placeholder="Select a location" />
        </SelectTrigger>
        <SelectContent className={SELECT_CONTENT}>
          {locations.map((location) => (
            <SelectItem
              key={location.id}
              value={location.id}
              className={SELECT_ITEM_CLASS}
            >
              {describeLocationOption(location, formatCurrency)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError message={error} />
    </div>
  );
}

function AddressPanel({
  label,
  address,
  secondary,
  className,
}: {
  label: string;
  address: string;
  secondary: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-pv-border bg-pv-muted/60 p-3.5",
        className,
      )}
    >
      <span aria-hidden className={ICON_TILE}>
        <MapPin strokeWidth={1.75} className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-pv-muted-fg">{label}</p>
        <p className="mt-0.5 text-sm font-medium text-pv-fg">{address}</p>
        {secondary ? (
          <p className="mt-1 text-xs text-pv-muted-fg">Return to {secondary}</p>
        ) : null}
      </div>
    </div>
  );
}
