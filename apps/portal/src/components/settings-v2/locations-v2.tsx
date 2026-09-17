"use client";

/**
 * v2 Settings → Locations (northwind only). `LocationSettings` renders this
 * behind `useV2('chrome')`; every other tenant keeps its v1 markup, unchanged.
 *
 * Team lead's review: v1 nested a card, an option switch, a list-row switch and
 * edit/delete icons, put Pickup and Return side by side, and saved with its own
 * button. Here Pickup sits above Return, each option is ONE row with ONE switch,
 * each side's area has its own radius, a location is one row that opens a
 * dialog, and the page's save bar and leave dialog save it like the rest of
 * Settings.
 *
 * The form's state stays in `LocationSettings` (shared with v1), so v1 and v2
 * read the same data the same way. Only the area radius is per side: the center
 * point, fee, price bands and maximum distance are single tenant columns, so
 * Return shows them only when Pickup's area option is off.
 *
 * Saving: the option switches, addresses and area fields wait for the page's
 * Save changes (registered under "locations"). A delivery or collection
 * location is a row of its own and saves from its dialog straight away (Save,
 * or Delete after its confirm), exactly as v1's row controls did.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Checkbox } from "@/components/ui-v2/checkbox";
import { Input } from "@/components/ui-v2/input";
import { Switch } from "@/components/ui-v2/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { LocationAutocomplete } from "@/components/ui/location-autocomplete";
import {
  SettingsField,
  SettingsPanel,
  SettingsRow,
  Unit,
  UnitGroup,
  useSettingsPageSave,
} from "@/components/settings-v2/settings-kit";
import {
  SettingsLoadError,
  SettingsReadOnlyFieldset,
  describeSaveError,
  settingsControlProps,
} from "@/components/settings-v2/section-states";
import {
  LOCATION_NAME_MAX,
  LOCATION_TEXT_MAX,
  LocationsListV2,
  SettingsPanelSkeleton,
  areaFieldErrors,
  bandLabel,
  buildLocationPayload,
  centerCoordinateLabel,
  locationOptionIssues,
  validateLocationDraft,
  validateLocationSettingsV2,
  type AreaFieldErrors,
  type LocationDraft,
  type LocationDraftErrors,
  type LocationFormState,
  type LocationSaveContext,
} from "@/components/settings-v2/business-settings-states";
import { useRegisterLeaveSave } from "@/components/settings-v2/business-section-save";
import type { RegisterSectionSave } from "@/components/settings-v2/pricing-money-parts";
import type {
  CreatePickupLocationInput,
  LocationSettings,
  PickupLocation,
  UpdatePickupLocationInput,
} from "@/hooks/use-pickup-locations";
import { useAuditLogOnOpen } from "@/hooks/use-audit-log-on-open";
import {
  displayUnitToKm,
  getCurrencySymbol,
  getDistanceUnitShort,
  kmToDisplayUnit,
  type DistanceUnit,
} from "@/lib/format-utils";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Pure rules                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The v2 save payload. The same columns, order and rules as v1's save, except
 * that each side's area radius is written from its own field (v1 wrote the
 * pickup radius to both). A radius whose area option is off is not validated,
 * so an unusable value there falls back to v1's 100.
 */
export function buildLocationSettingsPayloadV2(f: LocationFormState, unit: DistanceUnit): Partial<LocationSettings> {
  const toKm = (value: number) => displayUnitToKm(value, unit);
  const areaUsed = f.pickupAreaEnabled || f.returnAreaEnabled;
  const tiersActive = areaUsed && f.deliveryTiersEnabled;
  const radiusKm = (radius: number | null) =>
    areaUsed ? toKm(radius != null && Number.isFinite(radius) && radius >= 1 ? radius : 100) : null;
  return {
    // Legacy combined flags (for backwards compatibility)
    fixed_address_enabled: f.pickupFixedEnabled || f.returnFixedEnabled,
    multiple_locations_enabled: f.pickupMultipleEnabled || f.returnMultipleEnabled,
    area_around_enabled: areaUsed,
    pickup_fixed_enabled: f.pickupFixedEnabled,
    return_fixed_enabled: f.returnFixedEnabled,
    pickup_multiple_locations_enabled: f.pickupMultipleEnabled,
    return_multiple_locations_enabled: f.returnMultipleEnabled,
    pickup_area_enabled: f.pickupAreaEnabled,
    return_area_enabled: f.returnAreaEnabled,
    fixed_pickup_address: f.pickupFixedEnabled ? f.fixedPickupAddress : null,
    fixed_return_address: f.returnFixedEnabled ? (f.sameReturnAddress ? f.fixedPickupAddress : f.fixedReturnAddress) : null,
    pickup_area_radius_km: radiusKm(f.areaRadius),
    return_area_radius_km: radiusKm(f.returnAreaRadius),
    area_delivery_fee: areaUsed ? (f.areaDeliveryFee ?? 0) : 0,
    area_center_lat: areaUsed ? f.areaCenterLat : null,
    area_center_lon: areaUsed ? f.areaCenterLon : null,
    delivery_tiers_enabled: tiersActive,
    delivery_distance_tiers: tiersActive
      ? f.tiers.map((t) => ({ up_to_km: t.up_to === null ? null : toKm(t.up_to), fee: t.fee }))
      : [],
    delivery_max_distance_km: tiersActive && f.maxDeliveryDistance != null ? toKm(f.maxDeliveryDistance) : null,
  };
}

/**
 * Why a location couldn't be deleted. A location a booking used is still
 * referenced by that rental (no ON DELETE rule), so say how to hide it instead.
 */
export function describeLocationDeleteError(error: unknown): string {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if (code === "23503" || /foreign key/i.test(message)) {
    return "Bookings still use this location, so it can't be deleted. Turn off Available to customers to hide it instead.";
  }
  return describeSaveError(error);
}

/**
 * The payload for the location dialog's Save. `is_active` is sent only when it
 * changes (a new location is on unless switched off), so an edit that leaves it
 * alone writes exactly what it did before.
 */
export function buildLocationDialogPayload(
  draft: LocationDraft,
  active: boolean,
  { location, side }: { location: PickupLocation | null; side: "pickup" | "return" },
): CreatePickupLocationInput | UpdatePickupLocationInput {
  const payload = buildLocationPayload(draft, { editing: !!location, mode: side });
  const activeChanged = active !== (location ? location.is_active : true);
  if (location) return { id: location.id, ...payload, ...(activeChanged ? { is_active: active } : {}) };
  return { ...payload, ...(activeChanged ? { is_active: active } : {}) };
}

/* -------------------------------------------------------------------------- */
/* The page                                                                    */
/* -------------------------------------------------------------------------- */

export type LocationOptionKey =
  | "pickupFixed"
  | "pickupMultiple"
  | "pickupArea"
  | "returnFixed"
  | "returnMultiple"
  | "returnArea";

export interface LocationsV2Props {
  /** What `usePickupLocations` returns (the parts this page reads and writes). */
  data: {
    locationSettings: LocationSettings;
    hasSettingsData: boolean;
    settingsError: unknown;
    refetchSettings: () => unknown;
    isFetchingSettings: boolean;
    updateSettings: (patch: Partial<LocationSettings>) => Promise<unknown>;
    locations: PickupLocation[];
    isLoadingLocations: boolean;
    locationsError: unknown;
    refetchLocations: () => unknown;
    isFetchingLocations: boolean;
    createLocation: (input: CreatePickupLocationInput) => Promise<unknown>;
    updateLocation: (input: UpdatePickupLocationInput) => Promise<unknown>;
    deleteLocation: (id: string) => Promise<unknown>;
    isCreating: boolean;
    isUpdating: boolean;
  };
  form: LocationFormState;
  onFormChange: (patch: Partial<LocationFormState>) => void;
  /** The option switches, which keep at least one option on per side (as v1). */
  onOptionChange: Record<LocationOptionKey, (checked: boolean) => void>;
  bands: {
    add: () => void;
    remove: (index: number) => void;
    update: (index: number, patch: Partial<{ up_to: number | null; fee: number }>) => void;
    toggleOpen: (checked: boolean) => void;
  };
  center: {
    /** What the center field holds (a stored point with no address shows as "lat, lon"). */
    address: string;
    /** Typed without picking a suggestion, so the point has not moved. */
    typed: boolean;
    onChange: (address: string, lat?: number, lon?: number) => void;
  };
  /** The form differs from what is saved (derived in `LocationSettings`). */
  isDirty: boolean;
  /** Puts every field back to what is saved (the page's Reset and "Don't save"). */
  onDiscard: () => void;
  readOnly: boolean;
  currencyCode: string;
  distanceUnit: DistanceUnit;
  onDirtyChange?: (dirty: boolean) => void;
  registerSave?: RegisterSectionSave;
}

/** A save failure the pickup-locations hook has already toasted. */
function alreadyToasted(error: unknown): Error {
  const source = (error ?? {}) as { message?: unknown; code?: unknown };
  return Object.assign(new Error(String(source.message ?? "")), {
    code: source.code,
    alreadyToasted: true,
    cause: error,
  });
}

export function LocationsV2({
  data,
  form,
  onFormChange,
  onOptionChange,
  bands,
  center,
  isDirty,
  onDiscard,
  readOnly,
  currencyCode,
  distanceUnit,
  onDirtyChange,
  registerSave,
}: LocationsV2Props) {
  const pageSave = useSettingsPageSave();
  const unitLabel = getDistanceUnitShort(distanceUnit);
  // A save was tried with something missing: the rows say what, until the form
  // is clean again (saved or reset).
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    if (!isDirty) setAttempted(false);
  }, [isDirty]);

  const pickupLocations = data.locations.filter((l) => l.is_pickup_enabled);
  const returnLocations = data.locations.filter((l) => l.is_return_enabled);
  const listUnknown = data.isLoadingLocations || !!data.locationsError;
  const ctx: LocationSaveContext = {
    unitLabel,
    pickupActiveLocations: listUnknown ? null : pickupLocations.filter((l) => l.is_active).length,
    returnActiveLocations: listUnknown ? null : returnLocations.filter((l) => l.is_active).length,
  };
  const areaErrors = areaFieldErrors(form, unitLabel);
  const optionIssues = attempted ? locationOptionIssues(form, ctx) : {};

  // The page's Save changes. Rejects when nothing was saved, so the bar and the
  // leave dialog say why and stay put; the fields say where.
  const save = async () => {
    setAttempted(true);
    const message = validateLocationSettingsV2(form, ctx);
    if (message) throw new Error(message);
    try {
      await data.updateSettings(buildLocationSettingsPayloadV2(form, distanceUnit));
    } catch (error) {
      throw alreadyToasted(error);
    }
  };
  const discard = () => {
    setAttempted(false);
    onDiscard();
  };
  useRegisterLeaveSave(
    pageSave && !readOnly && data.hasSettingsData ? registerSave : undefined,
    "locations",
    isDirty,
    save,
    discard,
  );
  // Nothing is unsaved once this page is gone (its edits go with it).
  const latestDirtyChange = useRef(onDirtyChange);
  latestDirtyChange.current = onDirtyChange;
  useEffect(() => () => latestDirtyChange.current?.(false), []);

  // The delivery / collection location dialog.
  const [dialog, setDialog] = useState<{ side: "pickup" | "return"; location: PickupLocation | null; key: number }>({
    side: "pickup",
    location: null,
    key: 0,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const openDialog = (side: "pickup" | "return", location: PickupLocation | null) => {
    setDialog((prev) => ({ side, location, key: prev.key + 1 }));
    setDialogOpen(true);
  };

  if (!data.hasSettingsData && data.settingsError) {
    return (
      <SettingsLoadError
        thing="your pickup and return settings"
        error={data.settingsError}
        onRetry={data.refetchSettings}
        retrying={data.isFetchingSettings}
      />
    );
  }
  if (!data.hasSettingsData) {
    return (
      <div className="space-y-6">
        <SettingsPanelSkeleton title rows={3} label="Loading pickup options" />
        <SettingsPanelSkeleton title rows={3} label="Loading return options" />
      </div>
    );
  }

  const listProps = (side: "pickup" | "return") => ({
    side,
    locations: side === "pickup" ? pickupLocations : returnLocations,
    isLoading: data.isLoadingLocations,
    error: data.locationsError,
    onRetry: data.refetchLocations,
    retrying: data.isFetchingLocations,
    onAdd: () => openDialog(side, null),
    onOpen: (location: PickupLocation) => openDialog(side, location),
    currencyCode,
    readOnly,
  });

  const areaProps = {
    form,
    onFormChange,
    bands,
    center,
    errors: areaErrors,
    attempted,
    readOnly,
    unitLabel,
    distanceUnit,
    currencySymbol: getCurrencySymbol(currencyCode),
  };

  const noActive = (list: PickupLocation[]) =>
    !listUnknown && list.length > 0 && !list.some((l) => l.is_active);

  return (
    <div className="space-y-6">
      {!!data.settingsError && (
        <SettingsLoadError
          variant="inline"
          thing="your pickup and return settings"
          error={data.settingsError}
          onRetry={data.refetchSettings}
          retrying={data.isFetchingSettings}
        />
      )}

      <SettingsPanel title="Pickup" description="How customers get the car.">
        <OptionRow
          id="v2-pickup-fixed"
          label="Collect from your address"
          description="Customers pick the car up from you. Free for them."
          checked={form.pickupFixedEnabled}
          onCheckedChange={onOptionChange.pickupFixed}
          readOnly={readOnly}
          issue={optionIssues.pickupOptions}
        >
          <AddressField
            id="v2-pickup-address"
            label="Pickup address"
            value={form.fixedPickupAddress}
            onChange={(value) => onFormChange({ fixedPickupAddress: value })}
            placeholder="Enter your pickup address..."
            readOnly={readOnly}
            issue={optionIssues.pickupAddress}
            hint={form.fixedPickupAddress.trim() ? undefined : "Customers see no pickup address until you add one here."}
          />
        </OptionRow>
        <OptionRow
          id="v2-pickup-multiple"
          label="Delivery locations"
          description="Places customers choose, like an airport, each with its own fee."
          checked={form.pickupMultipleEnabled}
          onCheckedChange={onOptionChange.pickupMultiple}
          readOnly={readOnly}
        >
          <LocationsListV2 {...listProps("pickup")} />
          <ListNote
            issue={optionIssues.pickupList}
            warning={
              noActive(pickupLocations)
                ? "None of these are available to customers, so they see an empty list. Turn one on, or turn this option off."
                : undefined
            }
          />
        </OptionRow>
        <OptionRow
          id="v2-pickup-area"
          label="Deliver within an area"
          description="Any address within a set distance of your center point."
          checked={form.pickupAreaEnabled}
          onCheckedChange={onOptionChange.pickupArea}
          readOnly={readOnly}
        >
          <AreaFields side="pickup" full {...areaProps} />
        </OptionRow>
      </SettingsPanel>

      <SettingsPanel title="Return" description="How the car comes back to you.">
        <OptionRow
          id="v2-return-fixed"
          label="Return to your address"
          description="Customers bring the car back to you. Free for them."
          checked={form.returnFixedEnabled}
          onCheckedChange={onOptionChange.returnFixed}
          readOnly={readOnly}
          issue={optionIssues.returnOptions}
        >
          <label className="flex w-fit items-center gap-2 text-[13px] text-foreground">
            <Checkbox
              checked={form.sameReturnAddress}
              onCheckedChange={(checked) => onFormChange({ sameReturnAddress: checked === true })}
              disabled={readOnly}
            />
            Same as pickup address
          </label>
          {!form.sameReturnAddress && (
            <AddressField
              id="v2-return-address"
              label="Return address"
              value={form.fixedReturnAddress}
              onChange={(value) => onFormChange({ fixedReturnAddress: value })}
              placeholder="Enter return address..."
              readOnly={readOnly}
              issue={optionIssues.returnAddress}
            />
          )}
        </OptionRow>
        <OptionRow
          id="v2-return-multiple"
          label="Collection locations"
          description="Places customers can leave the car, like an airport, each with its own fee."
          checked={form.returnMultipleEnabled}
          onCheckedChange={onOptionChange.returnMultiple}
          readOnly={readOnly}
        >
          <LocationsListV2 {...listProps("return")} />
          <ListNote
            issue={optionIssues.returnList}
            warning={
              noActive(returnLocations)
                ? "None of these are available to customers, so they see an empty list. Turn one on, or turn this option off."
                : undefined
            }
          />
        </OptionRow>
        <OptionRow
          id="v2-return-area"
          label="Collect within an area"
          description="You collect the car from any address within a set distance of your center point."
          checked={form.returnAreaEnabled}
          onCheckedChange={onOptionChange.returnArea}
          readOnly={readOnly}
        >
          <AreaFields side="return" full={!form.pickupAreaEnabled} {...areaProps} />
        </OptionRow>
      </SettingsPanel>

      <LocationDialogV2
        key={dialog.key}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        side={dialog.side}
        location={dialog.location}
        currencySymbol={getCurrencySymbol(currencyCode)}
        saving={data.isCreating || data.isUpdating}
        onSave={async (payload) => {
          if ("id" in payload) await data.updateLocation(payload as UpdatePickupLocationInput);
          else await data.createLocation(payload as CreatePickupLocationInput);
        }}
        onDelete={async (id) => {
          await data.deleteLocation(id);
          await data.refetchLocations();
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                       */
/* -------------------------------------------------------------------------- */

/** One option: its label, a line of help and ONE switch; what it needs shows under it while it is on. */
function OptionRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  readOnly,
  issue,
  children,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  readOnly: boolean;
  issue?: string;
  children?: ReactNode;
}) {
  return (
    <div data-location-option={id}>
      <SettingsRow
        label={label}
        description={description}
        htmlFor={id}
        note={issue ? <p role="alert" className="text-destructive">{issue}</p> : undefined}
      >
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} {...settingsControlProps(!readOnly)} />
      </SettingsRow>
      {checked && children && <div className="-mt-1 max-w-3xl space-y-3 px-5 pb-5">{children}</div>}
    </div>
  );
}

/** The v1 address search, dressed as a v2 field. */
function AddressField({
  id,
  label,
  value,
  onChange,
  placeholder,
  readOnly,
  issue,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  readOnly: boolean;
  issue?: string;
  hint?: string;
}) {
  return (
    <SettingsField
      label={label}
      htmlFor={id}
      hint={issue ? <span role="alert" className="text-destructive">{issue}</span> : hint}
      className="max-w-xl"
    >
      <LocationAutocomplete
        id={id}
        value={value}
        onChange={(next) => onChange(next)}
        placeholder={placeholder}
        className={V2_ADDRESS_FIELD}
        v2States
        disabled={readOnly}
      />
    </SettingsField>
  );
}

/** The v1 Input under LocationAutocomplete, given the ui-v2 field's size, fill and a rounded-xl corner. */
const V2_ADDRESS_FIELD = "h-9 rounded-xl border-transparent bg-input/50 md:text-sm";

function ListNote({ issue, warning }: { issue?: string; warning?: string }) {
  if (issue) return <p role="alert" className="text-[13px] text-destructive">{issue}</p>;
  if (warning) return <p className="text-[13px] text-amber-700 dark:text-amber-400">{warning}</p>;
  return null;
}

/** "One fee" / "Price by distance": a two-option segmented control. */
function PricingModeControl({
  labelledBy,
  byDistance,
  onChange,
}: {
  labelledBy: string;
  byDistance: boolean;
  onChange: (byDistance: boolean) => void;
}) {
  const options = [
    { value: false, label: "One fee" },
    { value: true, label: "Price by distance" },
  ];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = event.key === "ArrowRight";
    onChange(next);
    const target = event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]")[next ? 1 : 0];
    target?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-full border p-1"
    >
      {options.map((option) => {
        const selected = option.value === byDistance;
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-8 rounded-full px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
                : "text-muted-foreground hover:bg-primary/10 hover:text-foreground dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A number typed into a field: blank is `null`, anything else as typed. */
function numberOrNull(raw: string): number | null {
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return <p role="alert" className="text-xs text-destructive">{children}</p>;
}

/**
 * One side's area. `full` shows the center point, the price and the maximum
 * distance with the radius; otherwise (Return, while Pickup's area is on) only
 * the side's own radius, since the rest is shared.
 */
function AreaFields({
  side,
  full,
  form,
  onFormChange,
  bands,
  center,
  errors,
  attempted,
  readOnly,
  unitLabel,
  distanceUnit,
  currencySymbol,
}: {
  side: "pickup" | "return";
  full: boolean;
  form: LocationFormState;
  onFormChange: (patch: Partial<LocationFormState>) => void;
  bands: LocationsV2Props["bands"];
  center: LocationsV2Props["center"];
  errors: AreaFieldErrors;
  attempted: boolean;
  readOnly: boolean;
  unitLabel: string;
  distanceUnit: DistanceUnit;
  currencySymbol: string;
}) {
  const radius = side === "pickup" ? form.areaRadius : form.returnAreaRadius;
  const radiusError = side === "pickup" ? errors.radius : errors.returnRadius;
  const hardMax = Math.floor(kmToDisplayUnit(1000, distanceUnit));
  const suggestionLimit = Math.floor(kmToDisplayUnit(50, distanceUnit));
  const coords = centerCoordinateLabel(form.areaCenterLat, form.areaCenterLon);
  const coordsOnly = !!coords && center.address === coords;
  const hasOpenBand = form.tiers.some((t) => t.up_to === null);
  const priceLabelId = `v2-${side}-area-price`;

  const setRadius = (raw: string) => {
    const value = numberOrNull(raw);
    const next = value != null && value > hardMax ? hardMax : value;
    onFormChange(side === "pickup" ? { areaRadius: next } : { returnAreaRadius: next });
  };

  const setByDistance = (byDistance: boolean) => {
    const fee = form.areaDeliveryFee ?? 0;
    onFormChange({
      deliveryTiersEnabled: byDistance,
      // The first time, start from two bands (as v1 did).
      ...(byDistance && form.tiers.length === 0 ? { tiers: [{ up_to: 20, fee }, { up_to: null, fee: fee + 25 }] } : {}),
    });
  };

  const centerHint = (() => {
    if (attempted && errors.center) return <span role="alert" className="text-destructive">{errors.center}</span>;
    if (center.typed) {
      return (
        <span className="text-amber-700 dark:text-amber-400">
          {coords ? (
            <>
              Pick an address from the suggestions to move your center point. Until you do, it stays at{" "}
              <span className="tabular-nums">{coords}</span>.
            </>
          ) : (
            "Pick an address from the suggestions to set your center point."
          )}
        </span>
      );
    }
    if (!coords) return "Distances are measured from here.";
    return (
      <>
        {coordsOnly ? "Your saved center point is at " : "Distances are measured from this address, at "}
        <span className="tabular-nums">{coords}</span>.
      </>
    );
  })();

  return (
    <SettingsReadOnlyFieldset readOnly={readOnly} className="space-y-4">
      {!full && (
        <p className="text-[13px] text-muted-foreground">Uses the same center point and delivery prices as Pickup.</p>
      )}

      {full && (
        <SettingsField label="Center point" htmlFor="v2-area-center" hint={centerHint} className="max-w-xl">
          <LocationAutocomplete
            id="v2-area-center"
            value={coordsOnly ? "" : center.address}
            onChange={center.onChange}
            placeholder={coords ? (readOnly ? "Saved as a map point (below)" : "Search an address to move it") : "Search for center location..."}
            className={V2_ADDRESS_FIELD}
            v2States
            disabled={readOnly}
          />
        </SettingsField>
      )}

      <SettingsField label="Radius" htmlFor={`v2-${side}-area-radius`}>
        <UnitGroup>
          <Input
            id={`v2-${side}-area-radius`}
            type="number"
            inputMode="decimal"
            min={1}
            max={hardMax}
            placeholder="50"
            value={radius ?? ""}
            onChange={(e) => setRadius(e.target.value)}
            aria-invalid={!!radiusError || undefined}
            className="w-24 rounded-xl tabular-nums"
          />
          <Unit>{unitLabel}</Unit>
        </UnitGroup>
        <FieldError>{radiusError}</FieldError>
        {!radiusError && (radius ?? 0) > suggestionLimit && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            For the most accurate address suggestions, keep this under {suggestionLimit} {unitLabel}. Above that,
            suggestions are filtered by distance instead.
          </p>
        )}
      </SettingsField>

      {full && (
        <div className="space-y-3">
          <p id={priceLabelId} className="text-[13px] font-medium text-foreground">
            {side === "pickup" ? "Delivery price" : "Collection price"}
          </p>
          <PricingModeControl labelledBy={priceLabelId} byDistance={form.deliveryTiersEnabled} onChange={setByDistance} />

          {!form.deliveryTiersEnabled ? (
            <SettingsField label="Fee" htmlFor="v2-area-fee" hint="Charged for each delivery and each collection in the area.">
              <UnitGroup>
                <Unit>{currencySymbol}</Unit>
                <Input
                  id="v2-area-fee"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                  placeholder="0"
                  value={form.areaDeliveryFee ?? ""}
                  onChange={(e) => onFormChange({ areaDeliveryFee: numberOrNull(e.target.value) })}
                  aria-invalid={!!errors.fee || undefined}
                  className="w-28 rounded-xl tabular-nums"
                />
              </UnitGroup>
              <FieldError>{errors.fee}</FieldError>
            </SettingsField>
          ) : (
            <>
              <ul aria-label="Price bands" className="space-y-2">
                {form.tiers.map((tier, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {tier.up_to === null ? (
                      <span className="w-40 text-sm text-foreground">Anywhere further</span>
                    ) : (
                      <UnitGroup className="w-40">
                        <Unit>Up to</Unit>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={1}
                          placeholder="20"
                          value={tier.up_to ?? ""}
                          onChange={(e) =>
                            bands.update(index, { up_to: e.target.value === "" ? 0 : parseFloat(e.target.value) || 0 })
                          }
                          aria-label={`Band ${index + 1} distance`}
                          className="w-20 rounded-xl tabular-nums"
                        />
                        <Unit>{unitLabel}</Unit>
                      </UnitGroup>
                    )}
                    <UnitGroup>
                      <Unit>{currencySymbol}</Unit>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.01}
                        placeholder="0"
                        value={Number.isFinite(tier.fee) ? tier.fee : ""}
                        onChange={(e) =>
                          bands.update(index, { fee: e.target.value === "" ? 0 : parseFloat(e.target.value) || 0 })
                        }
                        aria-label={`${bandLabel(tier, unitLabel)} fee`}
                        className="w-24 rounded-xl tabular-nums"
                      />
                    </UnitGroup>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => bands.remove(index)}
                      aria-label={`Remove ${bandLabel(tier, unitLabel)}`}
                      className="text-muted-foreground"
                    >
                      <X />
                    </Button>
                    {errors.bandRows?.[index] && (
                      <p role="alert" className="basis-full text-xs text-destructive">
                        {errors.bandRows[index]}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <FieldError>{errors.bands}</FieldError>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Button type="button" variant="outline" size="sm" onClick={bands.add}>
                  Add band
                </Button>
                <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Checkbox checked={hasOpenBand} onCheckedChange={(checked) => bands.toggleOpen(checked === true)} />
                  Charge a flat fee for anywhere beyond the last band
                </label>
              </div>
              {!hasOpenBand && form.maxDeliveryDistance == null && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Without an &ldquo;Anywhere further&rdquo; band, your furthest band is the limit. Addresses beyond it
                  can&apos;t be booked for delivery.
                </p>
              )}

              <SettingsField
                label="Maximum distance"
                htmlFor="v2-area-max-distance"
                hint="Addresses further than this can't be booked. Leave blank for no limit."
              >
                <UnitGroup>
                  <Input
                    id="v2-area-max-distance"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    placeholder="None"
                    value={form.maxDeliveryDistance ?? ""}
                    onChange={(e) => onFormChange({ maxDeliveryDistance: numberOrNull(e.target.value) })}
                    aria-invalid={!!errors.maxDistance || undefined}
                    className="w-24 rounded-xl tabular-nums"
                  />
                  <Unit>{unitLabel}</Unit>
                </UnitGroup>
                <FieldError>{errors.maxDistance}</FieldError>
              </SettingsField>
            </>
          )}
        </div>
      )}
    </SettingsReadOnlyFieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* The location dialog                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Add or edit one delivery or collection location. It holds the fields, whether
 * customers can pick it, and (for an existing one) Delete with a confirm step.
 * Save and Delete write at once; neither waits for the page's Save changes.
 * Remount it (a new `key`) for each opening so it starts from the location.
 */
export function LocationDialogV2({
  open,
  onOpenChange,
  side,
  location,
  currencySymbol,
  saving,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "pickup" | "return";
  location: PickupLocation | null;
  currencySymbol: string;
  saving: boolean;
  onSave: (payload: CreatePickupLocationInput | UpdatePickupLocationInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const noun = side === "pickup" ? "delivery" : "collection";
  const [draft, setDraft] = useState<LocationDraft>(() => ({
    name: location?.name ?? "",
    address: location?.address ?? "",
    description: location?.description ?? "",
    delivery_fee: location ? location.delivery_fee : null,
  }));
  const [active, setActive] = useState(location ? location.is_active : true);
  const [errors, setErrors] = useState<LocationDraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useAuditLogOnOpen({
    open: open && confirmingDelete,
    action: "location_delete_warning_shown",
    entityType: "settings",
    entityId: location?.id ?? null,
  });

  const busy = saving || deleting;
  const change = (patch: Partial<LocationDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setFailure(null);
  };

  const save = async () => {
    const found = validateLocationDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setFailure(null);
    try {
      await onSave(buildLocationDialogPayload(draft, active, { location, side }));
      onOpenChange(false);
    } catch (error) {
      // The hook has toasted it too; this stays while the dialog is open.
      setFailure(describeSaveError(error));
    }
  };

  const confirmDelete = async () => {
    if (!location) return;
    setDeleting(true);
    setFailure(null);
    try {
      await onDelete(location.id);
      onOpenChange(false);
    } catch (error) {
      setConfirmingDelete(false);
      setFailure(describeLocationDeleteError(error));
    } finally {
      setDeleting(false);
    }
  };

  const fieldId = (name: string) => `v2-location-${name}`;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        {confirmingDelete && location ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete &ldquo;{location.name}&rdquo;?</DialogTitle>
              <DialogDescription>
                Customers can no longer choose it for {noun}. This can&apos;t be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                Keep location
              </Button>
              <Button type="button" variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting && <Loader2 className="animate-spin" data-icon="inline-start" />}
                {deleting ? "Deleting…" : "Delete location"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {location ? "Edit" : "Add"} {noun} location
              </DialogTitle>
              <DialogDescription>
                {location
                  ? "Changes here save as soon as you press Save."
                  : "The location is added as soon as you press Add location."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <SettingsField label="Name" htmlFor={fieldId("name")}>
                <Input
                  id={fieldId("name")}
                  value={draft.name}
                  onChange={(e) => change({ name: e.target.value })}
                  placeholder="e.g. Heathrow Airport Terminal 5"
                  maxLength={LOCATION_NAME_MAX}
                  aria-invalid={!!errors.name || undefined}
                  className="rounded-xl"
                />
                <FieldError>{errors.name}</FieldError>
              </SettingsField>

              <SettingsField label="Address" htmlFor={fieldId("address")}>
                <LocationAutocomplete
                  id={fieldId("address")}
                  value={draft.address}
                  onChange={(value) => change({ address: value })}
                  placeholder="Search for address..."
                  className={V2_ADDRESS_FIELD}
                  v2States
                />
                <FieldError>{errors.address}</FieldError>
              </SettingsField>

              <SettingsField label="Description (optional)" htmlFor={fieldId("description")}>
                <Input
                  id={fieldId("description")}
                  value={draft.description}
                  onChange={(e) => change({ description: e.target.value })}
                  placeholder="e.g. Meet at arrivals hall, bay 3"
                  maxLength={LOCATION_TEXT_MAX}
                  aria-invalid={!!errors.description || undefined}
                  className="rounded-xl"
                />
                <FieldError>{errors.description}</FieldError>
              </SettingsField>

              <SettingsField
                label={side === "pickup" ? "Delivery fee" : "Collection fee"}
                htmlFor={fieldId("fee")}
                hint={errors.fee ? undefined : "Leave blank or 0 to make it free for customers."}
              >
                <UnitGroup>
                  <Unit>{currencySymbol}</Unit>
                  <Input
                    id={fieldId("fee")}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.01}
                    placeholder="0"
                    value={draft.delivery_fee ?? ""}
                    onChange={(e) => change({ delivery_fee: numberOrNull(e.target.value) })}
                    aria-invalid={!!errors.fee || undefined}
                    className="w-28 rounded-xl tabular-nums"
                  />
                </UnitGroup>
                <FieldError>{errors.fee}</FieldError>
              </SettingsField>

              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <label htmlFor={fieldId("active")} className="text-[13px] font-medium text-foreground">
                    Available to customers
                  </label>
                  <p className="text-xs text-muted-foreground">Off hides it at checkout without deleting it.</p>
                </div>
                <Switch id={fieldId("active")} checked={active} onCheckedChange={setActive} />
              </div>

              {failure && (
                <p role="alert" className="text-[13px] text-destructive">
                  {failure}
                </p>
              )}
            </div>

            <DialogFooter className="sm:justify-between">
              {location ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setFailure(null);
                    setConfirmingDelete(true);
                  }}
                  disabled={busy}
                >
                  Delete location
                </Button>
              ) : (
                <span className="hidden sm:block" />
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void save()} disabled={busy} className="min-w-[112px]">
                  {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
                  {location ? "Save" : "Add location"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
