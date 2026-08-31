"use client";

import { Loader2, MapPin, Package, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import type { QuoteResult } from "@/lib/quote/types";
import { useBookingStore, type DeliveryOption } from "@/lib/stores/booking-store";
import { cn } from "@/lib/utils";
import type { PickupLocation, RentalExtra } from "@/lib/vehicles/types";

import type { BookingRules, DeliveryModeAvailability } from "./booking-rules";
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
  SELECT_ITEM_CLASS,
  TextField,
  TimeField,
} from "./field-primitives";
import {
  formatClockLabel,
  formatDuration,
  formatIsoDateLabel,
} from "./time-utils";
import type { UsePromoCodeResult } from "./use-promo-code";
import type { BookingField } from "./validation";

/**
 * The booking form — every field v1 collects before payment.
 *
 * It is the RIGHT column on a desktop and the whole width on a phone. The
 * money does not live here: the total, the itemised bill and the CTA are in
 * `booking-checkout.tsx`, pinned beside the vehicle so they stay on screen
 * while this column scrolls.
 *
 * DENSITY IS THE POINT. Every field used to be one row of a ~420px gutter,
 * which made the page roughly twice as tall as it needed to be. Fields now pair
 * two-up from `sm` — dates with their times, name with email, phone with date
 * of birth, the two legs of the journey side by side — and only the things that
 * genuinely need the width (an address, the promo row, a consent sentence) span
 * both columns.
 *
 * It renders only what the tenant has switched on. Extras, the unlimited-mileage
 * upgrade, installments, SMS consent and the delivery chooser each disappear
 * entirely rather than appearing disabled — a control a customer cannot use is
 * worse than no control at all, and every one of them is genuinely optional
 * configuration.
 */

/**
 * Which legs of the journey the validator will actually insist on.
 *
 * This is the one place in the form where "required" is not a constant: the
 * validator asks for a location, an address, or nothing at all, depending on
 * the delivery mode and on whether the tenant configured a fixed address. A
 * static asterisk would therefore be a lie in two of the three modes.
 *
 * The branches below mirror `validateBooking` §2 — same inputs, same order,
 * same conditions — so the marker cannot drift away from the rule it is
 * advertising. Anything that changes there has to change here to stay honest.
 *
 * The asymmetry in the fallthrough is real, not a slip in the mirror: in
 * 'fixed' mode the validator requires a PICKUP address when the tenant has
 * none configured (validation.ts:189), but it never requires the return
 * address on that path. That field is genuinely optional, and is labelled so.
 */
function requiredLegs(
  mode: DeliveryOption,
  sameAsPickup: boolean,
  fixedPickupAddress: string | null,
): { pickup: boolean; return: boolean } {
  if (mode === "location" || mode === "area") {
    return { pickup: true, return: !sameAsPickup };
  }
  return { pickup: fixedPickupAddress === null, return: false };
}

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
  const mode: DeliveryOption = form.deliveryOption ?? modes.enabled[0] ?? "fixed";

  const required = requiredLegs(mode, form.sameAsPickup, rules.fixedPickupAddress);

  const returnAddressFallback = rules.fixedReturnAddress ?? rules.fixedPickupAddress;
  const canChooseReturn =
    mode === "fixed"
      ? rules.fixedPickupAddress === null
      : returnLocations.length > 0 || mode === "area";

  /*
    Two captions, one line. They were two stacked paragraphs; each cost a row of
    a page whose whole complaint was its height, and neither is a sentence the
    customer reads twice.
  */
  const dateCaptions: string[] = [];
  if (rentalDays !== null && form.pickupDate !== "" && form.dropoffDate !== "") {
    dateCaptions.push(
      `${formatDuration(rentalDays, rules.monthlyTierDays)} · ${formatIsoDateLabel(form.pickupDate)} → ${formatIsoDateLabel(form.dropoffDate)}`,
    );
  }
  if (rules.workingHours) {
    dateCaptions.push(
      `Collection and return between ${formatClockLabel(rules.workingHours.open)} and ${formatClockLabel(rules.workingHours.close)}`,
    );
  }

  /*
    The two legs of the journey, resolved once and then placed in the field
    grid. Building them here rather than inside the JSX keeps the "which control
    does this mode need" decision in one place instead of three nested ternaries
    that each have to remember the fixed-address special case.
  */
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
        secondary={
          rules.fixedReturnAddress &&
          rules.fixedReturnAddress !== rules.fixedPickupAddress
            ? rules.fixedReturnAddress
            : null
        }
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

  const showOptions = quote.unlimitedMileage.available || rules.installmentsEnabled;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[18px] border border-brand-border-soft bg-white",
        className,
      )}
    >
      {/*
        The key for the asterisk, before the first field that uses one. A lone
        asterisk with nothing explaining it is a well-known accessibility
        complaint, and the convention is to answer it once at the top rather
        than repeat "required" on every label.
      */}
      <RequiredLegend />

      {/* ── When ─────────────────────────────────────────────────────── */}
      <Section title="Your dates">
        {/*
          The ONE pair that stays two-up even on a 360px phone. A date and its
          time read as a single answer ("Tuesday at 10am"), a time picker has no
          use for 312px, and stacking all four cost 150px of scroll on the exact
          screen the scrolling complaint came from. The date column is given the
          larger share so "Tue, Sep 1, 2026" never truncates.
        */}
        <FieldGrid className="grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <DateField
            id="pickup-date"
            label="Pickup date"
            value={form.pickupDate}
            onChange={(iso) => {
              form.set("pickupDate", iso);
              // A return that is now before the pickup is not a choice the
              // customer made — clear it rather than leaving it illegal.
              if (form.dropoffDate !== "" && form.dropoffDate < iso) {
                form.set("dropoffDate", "");
              }
            }}
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
          <FieldHint>{dateCaptions.join(" · ")}</FieldHint>
        ) : null}
      </Section>

      {/* ── Where ────────────────────────────────────────────────────── */}
      <Section title="Pickup &amp; return">
        {modes.showChooser ? (
          <div
            role="radiogroup"
            aria-label="Pickup and return"
            className={cn(
              "grid grid-cols-1 gap-2.5",
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

        {/*
          Both legs in one row. The pickup control widens to the full row on its
          own — when the return is the same place, or when the fixed address is
          a read-only panel rather than a field.
        */}
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
      <Section title="Your details">
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
      <Section title="Promo code" action={<OptionalTag />}>
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
              className={FIELD_INPUT_CLASS}
            />
          </div>
          {promo.promo ? (
            <Button
              type="button"
              variant="brand-outline"
              size="lg"
              className="h-11 shrink-0"
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
              className="h-11 shrink-0"
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
          <p className="flex items-center gap-1.5 text-xs text-success">
            <Ticket aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0" />
            {promo.promo.code} applied —{" "}
            {promo.promo.type === "percentage"
              ? `${promo.promo.value}% off`
              : `${formatCurrency(promo.promo.value)} off`}{" "}
            the rental.
          </p>
        ) : null}
        <FieldError message={promo.error ?? undefined} />
      </Section>

      {/* ── Extras ───────────────────────────────────────────────────── */}
      {extras.length > 0 ? (
        <Section title="Extras" action={<OptionalTag />}>
          {/*
            Tiles, two across, rather than one full-width row per extra. Six
            extras used to be six rows of a narrow column; they are now three.
          */}
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
        <Section title="Options" action={<OptionalTag />}>
          {quote.unlimitedMileage.available ? (
            <div className="rounded-[14px] border border-brand-border-soft bg-brand-cream/50 px-3 py-2.5">
              <CheckboxRow
                id="unlimited-mileage"
                checked={form.addUnlimitedMileage}
                onChange={(checked) => form.set("addUnlimitedMileage", checked)}
              >
                <span className="font-medium text-brand-text">
                  Add unlimited mileage
                </span>{" "}
                — {formatCurrency(quote.unlimitedMileage.price)} for the whole
                rental. Drive as far as you like with no excess charge.
              </CheckboxRow>
            </div>
          ) : null}

          {rules.installmentsEnabled ? (
            <CheckboxRow
              id="wants-installments"
              checked={form.wantsInstallments}
              onChange={(checked) => form.set("wantsInstallments", checked)}
            >
              I would like to pay in installments. A member of the team will set
              up your schedule after the booking is confirmed.
            </CheckboxRow>
          ) : null}
        </Section>
      ) : null}

      {/* ── Consent ──────────────────────────────────────────────────── */}
      <Section title="Before you book">
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

        {/*
          SEPARATE from the terms, and equally required. v1 gates its pay
          button on `agreeTerms && agreeCharges` — authorising post-rental
          charges is its own statement, and folding it into the terms
          checkbox would be a weaker record of consent than v1 keeps.
        */}
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

/**
 * One extra, as a tile.
 *
 * Selected state is drawn on the tile itself rather than only in the stepper,
 * so a customer scanning the grid can see what they have added without reading
 * six little numbers.
 */
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
  const cap = extra.bookableQuantity;
  const soldOut = cap !== null && cap <= 0;
  const shown = Math.min(quantity, cap ?? quantity);
  const image = extra.imageUrls[0];

  const stock = soldOut
    ? " · Unavailable for these dates"
    : cap !== null && cap <= 3
      ? ` · ${cap} left`
      : "";

  return (
    <div
      className={cn(
        "flex h-full items-center gap-2.5 rounded-[14px] border bg-white p-2.5 transition-colors",
        shown > 0
          ? "border-brand-forest ring-1 ring-brand-forest/20"
          : "border-brand-border-soft",
        soldOut && "opacity-60",
      )}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          loading="lazy"
          className="size-11 shrink-0 rounded-[10px] border border-brand-border-soft object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-[10px] border border-brand-border-soft bg-brand-stone/60"
        >
          <Package strokeWidth={1.75} className="size-4 text-brand-text-subtle" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        {/*
          `line-clamp-2`, not `truncate`. A 312px phone leaves the tile ~88px of
          text and "Roadside Assistance" was arriving as "Roadside …". Two lines
          cost nothing on a tile that is already 44px tall for its stepper.
        */}
        <p className="line-clamp-2 text-sm font-medium leading-snug text-brand-text">
          {extra.name}
        </p>
        <p className="text-xs leading-snug text-brand-text-subtle">
          {formatCurrency(extra.price)}
          {extra.billingType === "per_day" ? " per day" : " per rental"}
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
      <p className="text-xs text-brand-text-subtle">
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
          className={cn(FIELD_TRIGGER_CLASS, error && "border-danger")}
        >
          <SelectValue placeholder="Select a location" />
        </SelectTrigger>
        <SelectContent>
          {locations.map((location) => (
            <SelectItem
              key={location.id}
              value={location.id}
              className={SELECT_ITEM_CLASS}
            >
              {location.name} ·{" "}
              {location.deliveryFee > 0
                ? `+${formatCurrency(location.deliveryFee)}`
                : "Free"}
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
        "rounded-[14px] border border-brand-border-soft bg-brand-cream/50 px-3.5 py-3",
        className,
      )}
    >
      <p className="text-[11px] uppercase tracking-[0.07em] text-brand-text-subtle">
        {label}
      </p>
      <p className="mt-1 flex items-start gap-1.5 text-sm text-brand-text">
        <MapPin
          aria-hidden
          strokeWidth={1.75}
          className="mt-0.5 size-3.5 shrink-0 text-brand-text-subtle"
        />
        <span>{address}</span>
      </p>
      {secondary ? (
        <p className="mt-1.5 pl-5 text-xs text-brand-text-soft">
          Return to {secondary}
        </p>
      ) : null}
    </div>
  );
}
