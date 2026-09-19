"use client";

/**
 * v2 Settings → Locations. `LocationSettings` renders this behind
 * `useV2('chrome')` (the canary slug list OR `tenants.portal_experience`);
 * every other tenant keeps its v1 markup, unchanged.
 *
 * Team lead's review (Sep 19 2026):
 *   - Two sections, "Pickup and delivery" and "Return". Each heading sits
 *     OUTSIDE its panel with its line of help and a divider under it.
 *   - Every option is ONE row: title and help on the left, its control at the
 *     end. "Add location" sits in its option's row, beside the switch, while
 *     the option is on.
 *   - A delivery or return location is a table row whose Actions (Edit, No fee,
 *     Delete) are on screen. Edit opens a dialog with name, address, fee and
 *     Available to customers. No fee opens the same dialog with the fee at 0
 *     and the fee field focused: it moves money, so it waits for Save there.
 *   - The area's price is ONE row: "One fee" / "Price by distance" as radio
 *     buttons, each opening a dialog. The row then says what is set.
 *   - Every distance is in the tenant's unit (`tenants.distance_unit`), stored
 *     in km as before.
 *   - A problem reads as a faded red row: what is wrong on the left, the fix on
 *     the right. No toast, no bright red.
 *
 * The form's state stays in `LocationSettings` (shared with v1), so v1 and v2
 * read the same data the same way. Only the area radius is per side: the center
 * point, fee, price bands and maximum distance are single tenant columns, so
 * Return shows them only when Pickup's area option is off.
 *
 * What writes when (unchanged from before this review):
 *   - option switches, addresses, center point, radius and the area's price wait
 *     for the page's Save changes (registered under "locations"). The price
 *     dialogs' Done only changes the form.
 *   - a location is a row of its own and writes at once: its dialog's Save or
 *     Add location (No fee included, since it only opens that dialog), and
 *     Delete after its confirm step.
 */

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Checkbox } from "@/components/ui-v2/checkbox";
import { Input } from "@/components/ui-v2/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui-v2/radio-group";
import { Skeleton } from "@/components/ui-v2/skeleton";
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
  SETTINGS_SECTION_TITLE,
  SettingsField,
  SettingsPanel,
  SettingsRow,
  SettingsRowAlignProvider,
  Unit,
  UnitGroup,
  useSettingsPageSave,
} from "@/components/settings-v2/settings-kit";
import {
  SettingsLoadError,
  SettingsReadOnlyFieldset,
  describeSaveError,
  formatSettingsMoney,
  formatSettingsNumber,
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
  locationNoun,
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
  getDistanceUnitLong,
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
 *
 * `saved` is what is stored. A distance that still shows what is stored keeps
 * the stored km exactly: in miles, 40 km shows as 24.9 mi and 24.9 mi converts
 * back to 40.1 km, so without it every Save moved each untouched distance by
 * 0.1 km. Only a distance the operator changed is converted.
 */
export function buildLocationSettingsPayloadV2(
  f: LocationFormState,
  unit: DistanceUnit,
  saved?: Partial<LocationSettings> | null,
): Partial<LocationSettings> {
  const toKm = (value: number) => displayUnitToKm(value, unit);
  /** The first stored km that shows as `value`, else `value` converted. */
  const keepOrToKm = (value: number, ...stored: (number | null | undefined)[]) =>
    stored.find((km): km is number => km != null && Number.isFinite(km) && kmToDisplayUnit(km, unit) === value) ??
    toKm(value);
  const areaUsed = f.pickupAreaEnabled || f.returnAreaEnabled;
  const tiersActive = areaUsed && f.deliveryTiersEnabled;
  const radiusKm = (radius: number | null, storedKm: number | null | undefined) =>
    areaUsed ? (radius != null && Number.isFinite(radius) && radius >= 1 ? keepOrToKm(radius, storedKm) : toKm(100)) : null;
  // A band is matched to the stored band in its place first, then to any other
  // (so removing one band doesn't move the ones after it).
  const savedBands = (saved?.delivery_distance_tiers ?? []).map((t) => t.up_to_km);
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
    pickup_area_radius_km: radiusKm(f.areaRadius, saved?.pickup_area_radius_km),
    return_area_radius_km: radiusKm(f.returnAreaRadius, saved?.return_area_radius_km),
    area_delivery_fee: areaUsed ? (f.areaDeliveryFee ?? 0) : 0,
    area_center_lat: areaUsed ? f.areaCenterLat : null,
    area_center_lon: areaUsed ? f.areaCenterLon : null,
    delivery_tiers_enabled: tiersActive,
    delivery_distance_tiers: tiersActive
      ? f.tiers.map((t, i) => ({
          up_to_km: t.up_to === null ? null : keepOrToKm(t.up_to, savedBands[i], ...savedBands),
          fee: t.fee,
        }))
      : [],
    delivery_max_distance_km:
      tiersActive && f.maxDeliveryDistance != null
        ? keepOrToKm(f.maxDeliveryDistance, saved?.delivery_max_distance_km)
        : null,
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

export type LocationSide = "pickup" | "return";

export type LocationOptionKey =
  | "pickupFixed"
  | "pickupMultiple"
  | "pickupArea"
  | "returnFixed"
  | "returnMultiple"
  | "returnArea";

const SIDE_OPTIONS: Record<LocationSide, readonly LocationOptionKey[]> = {
  pickup: ["pickupFixed", "pickupMultiple", "pickupArea"],
  return: ["returnFixed", "returnMultiple", "returnArea"],
};

const OPTION_FIELD: Record<LocationOptionKey, keyof LocationFormState> = {
  pickupFixed: "pickupFixedEnabled",
  pickupMultiple: "pickupMultipleEnabled",
  pickupArea: "pickupAreaEnabled",
  returnFixed: "returnFixedEnabled",
  returnMultiple: "returnMultipleEnabled",
  returnArea: "returnAreaEnabled",
};

/** The switch each option renders. */
const OPTION_SWITCH_ID: Record<LocationOptionKey, string> = {
  pickupFixed: "v2-pickup-fixed",
  pickupMultiple: "v2-pickup-multiple",
  pickupArea: "v2-pickup-area",
  returnFixed: "v2-return-fixed",
  returnMultiple: "v2-return-multiple",
  returnArea: "v2-return-area",
};

export function optionSide(key: LocationOptionKey): LocationSide {
  return key.startsWith("pickup") ? "pickup" : "return";
}

/**
 * Would this switch leave its side with no option on? v2 keeps it on and says
 * why in a row (v1 toasted for the address option and quietly switched the
 * address option back on for the other two).
 */
export function wouldTurnOffLastOption(form: LocationFormState, key: LocationOptionKey, checked: boolean): boolean {
  if (checked) return false;
  return SIDE_OPTIONS[optionSide(key)].every((k) => k === key || !form[OPTION_FIELD[k]]);
}

/** The switch the "Choose an option" fix moves to: the side's first option that is off, else its first. */
export function optionToFocus(form: LocationFormState, side: LocationSide): string {
  const key = SIDE_OPTIONS[side].find((k) => !form[OPTION_FIELD[k]]) ?? SIDE_OPTIONS[side][0];
  return OPTION_SWITCH_ID[key];
}

export type PriceBand = { up_to: number | null; fee: number };
export type PriceMode = "flat" | "distance";

/** v1's "Add band": 10 past the furthest band, at the one-fee price, kept before "Anywhere further". */
export function addPriceBand(tiers: PriceBand[], fee: number | null): PriceBand[] {
  const bounded = tiers.filter((t) => t.up_to !== null);
  const open = tiers.filter((t) => t.up_to === null);
  const lastBound = bounded.reduce((max, t) => Math.max(max, t.up_to as number), 0);
  return [...bounded, { up_to: lastBound + 10, fee: fee ?? 0 }, ...open];
}

/** v1's "Charge a flat fee for anywhere beyond the last band" checkbox. */
export function setOpenPriceBand(tiers: PriceBand[], on: boolean, fee: number | null): PriceBand[] {
  const bounded = tiers.filter((t) => t.up_to !== null);
  if (!on) return bounded;
  return [...bounded, tiers.find((t) => t.up_to === null) ?? { up_to: null, fee: fee ?? 0 }];
}

/** The first time a tenant prices by distance: two bands, as v1 started them. */
export function startingPriceBands(tiers: PriceBand[], fee: number | null): PriceBand[] {
  if (tiers.length > 0) return tiers.map((t) => ({ ...t }));
  const base = fee ?? 0;
  return [
    { up_to: 20, fee: base },
    { up_to: null, fee: base + 25 },
  ];
}

/**
 * What the Delivery price row says is set, in the tenant's unit: "One fee:
 * $25.00", "No fee" (the words the locations table uses for 0), "3 price
 * bands, up to 50 km", "2 price bands, no distance limit".
 * With no maximum and no "Anywhere further" band, the furthest band is the
 * limit, so that is the distance shown.
 */
export function describeAreaPrice(
  form: Pick<LocationFormState, "deliveryTiersEnabled" | "areaDeliveryFee" | "tiers" | "maxDeliveryDistance">,
  currencyCode: string,
  unitLabel: string,
): string {
  if (!form.deliveryTiersEnabled) {
    const fee = form.areaDeliveryFee;
    return fee == null || !Number.isFinite(fee) || fee === 0
      ? "No fee"
      : `One fee: ${formatSettingsMoney(fee, currencyCode)}`;
  }
  const count = form.tiers.length;
  if (count === 0) return "Price by distance: no price bands yet";
  const bands = `${formatSettingsNumber(count)} price band${count === 1 ? "" : "s"}`;
  const max = form.maxDeliveryDistance;
  if (max != null && Number.isFinite(max) && max > 0) return `${bands}, up to ${formatSettingsNumber(max)} ${unitLabel}`;
  if (form.tiers.some((t) => t.up_to === null)) return `${bands}, no distance limit`;
  const furthest = form.tiers.reduce((m, t) => (t.up_to != null && Number.isFinite(t.up_to) ? Math.max(m, t.up_to) : m), 0);
  return furthest > 0 ? `${bands}, up to ${formatSettingsNumber(furthest)} ${unitLabel}` : bands;
}

/** A price dialog's working copy. Nothing reaches the form until Done. */
export interface PriceDraft {
  fee: number | null;
  tiers: PriceBand[];
  maxDistance: number | null;
}

/** The checks the page's save runs on the price, for the dialog's own fields only. */
export function priceDialogErrors(
  form: LocationFormState,
  draft: PriceDraft,
  mode: PriceMode,
  unitLabel: string,
): AreaFieldErrors {
  const all = areaFieldErrors(
    {
      ...form,
      pickupAreaEnabled: true,
      deliveryTiersEnabled: mode === "distance",
      areaDeliveryFee: draft.fee,
      tiers: draft.tiers,
      maxDeliveryDistance: draft.maxDistance,
    },
    unitLabel,
  );
  const out: AreaFieldErrors = {};
  if (mode === "flat") {
    if (all.fee) out.fee = all.fee;
    return out;
  }
  if (all.bands) out.bands = all.bands;
  if (all.bandRows) out.bandRows = all.bandRows;
  if (all.maxDistance) out.maxDistance = all.maxDistance;
  return out;
}

/** What Done writes into the form. Choosing One fee keeps the bands for later (v1 did too). */
export function priceDialogPatch(mode: PriceMode, draft: PriceDraft): Partial<LocationFormState> {
  if (mode === "flat") return { deliveryTiersEnabled: false, areaDeliveryFee: draft.fee };
  return { deliveryTiersEnabled: true, tiers: draft.tiers, maxDeliveryDistance: draft.maxDistance };
}

/** The first price problem, for the Delivery price row (the dialog shows each beside its field). */
function firstPriceIssue(form: LocationFormState, errors: AreaFieldErrors, unitLabel: string): string | undefined {
  const firstBand = errors.bandRows ? Number(Object.keys(errors.bandRows)[0]) : null;
  const bandRow =
    firstBand !== null && errors.bandRows && form.tiers[firstBand]
      ? `Price band "${bandLabel(form.tiers[firstBand], unitLabel)}": ${errors.bandRows[firstBand]}`
      : undefined;
  return errors.fee ?? errors.bands ?? bandRow ?? errors.maxDistance;
}

/* -------------------------------------------------------------------------- */
/* The page                                                                    */
/* -------------------------------------------------------------------------- */

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
  /** The option switches (v1's handlers). v2 never lets one turn off its side's last option. */
  onOptionChange: Record<LocationOptionKey, (checked: boolean) => void>;
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
  /** `tenants.distance_unit`: every distance on the page is shown and typed in it. */
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

type DialogTarget = {
  side: LocationSide;
  location: PickupLocation | null;
  key: number;
  /** Opened from the row's No fee: the fee starts at 0 and has the focus. */
  noFee?: boolean;
};

export function LocationsV2({
  data,
  form,
  onFormChange,
  onOptionChange,
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
  // The side whose last option someone just tried to switch off. Any other edit,
  // a save or a reset clears it.
  const [lastOptionSide, setLastOptionSide] = useState<LocationSide | null>(null);
  const changeForm = (patch: Partial<LocationFormState>) => {
    setLastOptionSide(null);
    onFormChange(patch);
  };

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
      await data.updateSettings(buildLocationSettingsPayloadV2(form, distanceUnit, data.locationSettings));
    } catch (error) {
      throw alreadyToasted(error);
    }
    setLastOptionSide(null);
  };
  const discard = () => {
    setAttempted(false);
    setLastOptionSide(null);
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

  // Add / Edit a location.
  const [editTarget, setEditTarget] = useState<DialogTarget>({ side: "pickup", location: null, key: 0 });
  const [editOpen, setEditOpen] = useState(false);
  const openEdit = (side: LocationSide, location: PickupLocation | null, noFee = false) => {
    setEditTarget((prev) => ({ side, location, key: prev.key + 1, noFee }));
    setEditOpen(true);
  };
  // Delete a location (its confirm step).
  const [deleteTarget, setDeleteTarget] = useState<DialogTarget>({ side: "pickup", location: null, key: 0 });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const openDelete = (side: LocationSide, location: PickupLocation) => {
    setDeleteTarget((prev) => ({ side, location, key: prev.key + 1 }));
    setDeleteOpen(true);
  };
  // The area's price dialog.
  const [priceTarget, setPriceTarget] = useState<{ mode: PriceMode; side: LocationSide; key: number }>({
    mode: "flat",
    side: "pickup",
    key: 0,
  });
  const [priceOpen, setPriceOpen] = useState(false);
  const openPrice = (side: LocationSide, mode: PriceMode) => {
    setPriceTarget((prev) => ({ mode, side, key: prev.key + 1 }));
    setPriceOpen(true);
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
      // The loaded page's frame: a heading over a divider, then its panel.
      <div className="space-y-6">
        {(["pickup", "return"] as const).map((side) => (
          <div key={side} className="space-y-3">
            <div aria-hidden="true" className="space-y-1.5 border-b pb-2.5">
              <Skeleton className="h-4 w-40 rounded-full" />
              <Skeleton className="h-3 w-56 max-w-full rounded-full" />
            </div>
            <SettingsPanelSkeleton rows={3} label={`Loading ${side} options`} />
          </div>
        ))}
      </div>
    );
  }

  const changeOption = (key: LocationOptionKey) => (checked: boolean) => {
    const side = optionSide(key);
    if (wouldTurnOffLastOption(form, key, checked)) {
      setLastOptionSide(side);
      return;
    }
    if (lastOptionSide === side) setLastOptionSide(null);
    onOptionChange[key](checked);
  };
  const focusOption = (side: LocationSide) => {
    if (typeof document === "undefined") return;
    document.getElementById(optionToFocus(form, side))?.focus();
  };

  const listFor = (side: LocationSide) => (side === "pickup" ? pickupLocations : returnLocations);
  const listFailed = (side: LocationSide) => !!data.locationsError && listFor(side).length === 0;
  const noneAvailable = (side: LocationSide) =>
    !listUnknown && listFor(side).length > 0 && !listFor(side).some((l) => l.is_active);

  const addButton = (side: LocationSide, on: boolean) =>
    on && !readOnly && !listFailed(side) ? (
      <Button type="button" variant="outline" size="sm" onClick={() => openEdit(side, null)}>
        Add location
      </Button>
    ) : null;

  const optionNotice = (side: LocationSide) => {
    const noun = side === "pickup" ? "pickup" : "return";
    const need = side === "pickup" ? "get the car" : "bring the car back";
    const issue = side === "pickup" ? optionIssues.pickupOptions : optionIssues.returnOptions;
    if (lastOptionSide === side) {
      return (
        <LocationNotice
          title={`At least one ${noun} option must be on`}
          actionLabel={readOnly ? undefined : "Choose an option"}
          onAction={() => focusOption(side)}
        >
          Customers need a way to {need}. Turn on another option first, then turn this one off.
        </LocationNotice>
      );
    }
    if (issue) {
      return (
        <LocationNotice
          title={`Turn on a ${noun} option`}
          actionLabel={readOnly ? undefined : "Choose an option"}
          onAction={() => focusOption(side)}
        >
          Customers need at least one way to {need}.
        </LocationNotice>
      );
    }
    return null;
  };

  const listNotice = (side: LocationSide) => {
    const issue = side === "pickup" ? optionIssues.pickupList : optionIssues.returnList;
    const none = noneAvailable(side);
    if (!issue && !none) return null;
    const noun = locationNoun(side);
    const empty = listFor(side).length === 0;
    return (
      <LocationNotice
        urgent={!!issue}
        title={empty ? `Add a ${noun} location` : `No ${noun} location is available to customers`}
        actionLabel={readOnly ? undefined : "Add location"}
        onAction={() => openEdit(side, null)}
      >
        {empty
          ? "This option is on, but customers have nothing to choose. Add a location, or turn the option off."
          : "Customers see an empty list. Edit a location and turn on Available to customers, add one, or turn the option off."}
      </LocationNotice>
    );
  };

  const listProps = (side: LocationSide) => ({
    side,
    locations: listFor(side),
    isLoading: data.isLoadingLocations,
    error: data.locationsError,
    onRetry: data.refetchLocations,
    retrying: data.isFetchingLocations,
    onEdit: (location: PickupLocation) => openEdit(side, location),
    onDelete: (location: PickupLocation) => openDelete(side, location),
    // The Edit dialog with the fee at 0: nothing is written until its Save.
    onNoFee: (location: PickupLocation) => openEdit(side, location, true),
    // A location write, or the list's read after one, is still running.
    writing: data.isCreating || data.isUpdating || data.isFetchingLocations,
    currencyCode,
    readOnly,
  });

  const areaProps = {
    form,
    onFormChange: changeForm,
    center,
    errors: areaErrors,
    attempted,
    readOnly,
    unitLabel,
    distanceUnit,
    currencyCode,
    onEditPrice: openPrice,
  };

  return (
    <SettingsRowAlignProvider align="end">
      <div className="space-y-6" data-locations-v2="">
        {!!data.settingsError && (
          <SettingsLoadError
            variant="inline"
            thing="your pickup and return settings"
            error={data.settingsError}
            onRetry={data.refetchSettings}
            retrying={data.isFetchingSettings}
          />
        )}

        <LocationSection id="v2-locations-pickup" title="Pickup and delivery" description="How customers get the car.">
          {optionNotice("pickup")}
          <SettingsPanel>
            <OptionRow
              id="v2-pickup-fixed"
              label="Collect from your address"
              description="Customers pick the car up from you. Free for them."
              checked={form.pickupFixedEnabled}
              onCheckedChange={changeOption("pickupFixed")}
              readOnly={readOnly}
            >
              <AddressRow
                id="v2-pickup-address"
                label="Pickup address"
                description="Where customers collect the car."
                value={form.fixedPickupAddress}
                onChange={(value) => changeForm({ fixedPickupAddress: value })}
                placeholder="Search for your pickup address"
                readOnly={readOnly}
                issue={optionIssues.pickupAddress}
                hint={form.fixedPickupAddress.trim() ? undefined : "Customers see no pickup address until you add one."}
              />
            </OptionRow>
            <OptionRow
              id="v2-pickup-multiple"
              label="Delivery locations"
              description="Places customers choose, like an airport, each with its own fee."
              checked={form.pickupMultipleEnabled}
              onCheckedChange={changeOption("pickupMultiple")}
              readOnly={readOnly}
              action={addButton("pickup", form.pickupMultipleEnabled)}
            >
              <ListArea>
                <LocationsListV2 {...listProps("pickup")} />
                {listNotice("pickup")}
              </ListArea>
            </OptionRow>
            <OptionRow
              id="v2-pickup-area"
              label="Deliver within an area"
              description="You deliver to any address within a set distance of your center point."
              checked={form.pickupAreaEnabled}
              onCheckedChange={changeOption("pickupArea")}
              readOnly={readOnly}
            >
              <AreaRows side="pickup" full {...areaProps} />
            </OptionRow>
          </SettingsPanel>
        </LocationSection>

        <LocationSection id="v2-locations-return" title="Return" description="How customers bring the car back.">
          {optionNotice("return")}
          <SettingsPanel>
            <OptionRow
              id="v2-return-fixed"
              label="Return to your address"
              description="Customers bring the car back to you. Free for them."
              checked={form.returnFixedEnabled}
              onCheckedChange={changeOption("returnFixed")}
              readOnly={readOnly}
            >
              <SubRow
                label="Same as pickup address"
                description="Customers bring the car back to your pickup address."
                htmlFor="v2-return-same-address"
              >
                <Switch
                  id="v2-return-same-address"
                  checked={form.sameReturnAddress}
                  onCheckedChange={(checked) => changeForm({ sameReturnAddress: checked })}
                  {...settingsControlProps(!readOnly)}
                />
              </SubRow>
              {!form.sameReturnAddress && (
                <AddressRow
                  id="v2-return-address"
                  label="Return address"
                  description="Where customers bring the car back."
                  value={form.fixedReturnAddress}
                  onChange={(value) => changeForm({ fixedReturnAddress: value })}
                  placeholder="Search for your return address"
                  readOnly={readOnly}
                  issue={optionIssues.returnAddress}
                />
              )}
            </OptionRow>
            <OptionRow
              id="v2-return-multiple"
              label="Return locations"
              description="Places customers can leave the car, like an airport, each with its own fee."
              checked={form.returnMultipleEnabled}
              onCheckedChange={changeOption("returnMultiple")}
              readOnly={readOnly}
              action={addButton("return", form.returnMultipleEnabled)}
            >
              <ListArea>
                <LocationsListV2 {...listProps("return")} />
                {listNotice("return")}
              </ListArea>
            </OptionRow>
            <OptionRow
              id="v2-return-area"
              label="Collect within an area"
              description="You collect the car from any address within a set distance of your center point."
              checked={form.returnAreaEnabled}
              onCheckedChange={changeOption("returnArea")}
              readOnly={readOnly}
            >
              <AreaRows side="return" full={!form.pickupAreaEnabled} {...areaProps} />
            </OptionRow>
          </SettingsPanel>
        </LocationSection>

        <LocationDialogV2
          key={`edit-${editTarget.key}`}
          open={editOpen}
          onOpenChange={setEditOpen}
          side={editTarget.side}
          location={editTarget.location}
          noFee={editTarget.noFee}
          currencySymbol={getCurrencySymbol(currencyCode)}
          saving={data.isCreating || data.isUpdating}
          onSave={async (payload) => {
            if ("id" in payload) await data.updateLocation(payload as UpdatePickupLocationInput);
            else await data.createLocation(payload as CreatePickupLocationInput);
          }}
        />
        <LocationDeleteDialogV2
          key={`delete-${deleteTarget.key}`}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          side={deleteTarget.side}
          location={deleteTarget.location}
          onDelete={async (id) => {
            await data.deleteLocation(id);
            await data.refetchLocations();
          }}
        />
        <AreaPriceDialogV2
          key={`price-${priceTarget.key}`}
          open={priceOpen}
          onOpenChange={setPriceOpen}
          mode={priceTarget.mode}
          side={priceTarget.side}
          form={form}
          currencySymbol={getCurrencySymbol(currencyCode)}
          unitLabel={unitLabel}
          unitLong={getDistanceUnitLong(distanceUnit)}
          onApply={changeForm}
        />
      </div>
    </SettingsRowAlignProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                       */
/* -------------------------------------------------------------------------- */

/** A section heading OUTSIDE its panel: the title, its line of help, and a divider under them. */
function LocationSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} data-location-section={id} className="space-y-3">
      <div className="border-b pb-2.5">
        <h2 id={id} className={SETTINGS_SECTION_TITLE}>
          {title}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * A problem, in the toned-down red: a short heading and why on the left, the
 * fix on the right. `urgent` (a save was refused, or a switch was held on) makes
 * it an alert; otherwise it is a status line.
 */
function LocationNotice({
  title,
  children,
  actionLabel,
  onAction,
  urgent = true,
}: {
  title: string;
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  urgent?: boolean;
}) {
  return (
    <div
      role={urgent ? "alert" : "status"}
      data-location-notice=""
      className="flex flex-col gap-3 rounded-xl bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
    >
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <p className="text-sm font-medium text-destructive panel-ink-danger">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{children}</p>
      </div>
      {actionLabel && onAction && (
        <Button type="button" variant="outline" size="sm" onClick={onAction} className="shrink-0 self-start sm:self-center">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

/** One option: its label, a line of help and, at the end of the row, its action and ONE switch. What it needs shows under it while it is on. */
function OptionRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  readOnly,
  action,
  children,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  readOnly: boolean;
  /** Shown beside the switch (Add location, while the option is on). */
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div data-location-option={id}>
      <SettingsRow label={label} description={description} htmlFor={id} align="end">
        {action}
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} {...settingsControlProps(!readOnly)} />
      </SettingsRow>
      {checked && children && <div className="pb-2">{children}</div>}
    </div>
  );
}

/** A row that belongs to the option above it: indented, its control at the end, no divider between them. */
function SubRow({ className, ...props }: ComponentProps<typeof SettingsRow>) {
  return <SettingsRow align="end" {...props} className={cn("py-3 md:pl-10", className)} />;
}

/** The locations table under its option, lined up with the sub-rows. */
function ListArea({ children }: { children: ReactNode }) {
  return <div className="space-y-3 px-5 pt-1 pb-3 md:pl-10">{children}</div>;
}

/** The toned-down red for a field's problem. */
const ISSUE_TEXT = "text-destructive panel-ink-danger";
/** An advisory note under a field, in the contrast-corrected amber. */
const HINT_WARN = "panel-ink-warn";

/**
 * A field's problem under its row: a compact faded-red note (never bright red)
 * with what is wrong in the toned-down red, why in muted text, and the fix on
 * the right when it isn't the field right beside it.
 */
function IssueNote({
  title,
  children,
  actionLabel,
  onAction,
}: {
  title: string;
  children?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      role="alert"
      data-location-issue=""
      className="flex flex-col gap-2 rounded-xl bg-destructive/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <p className={cn("font-medium", ISSUE_TEXT)}>{title}</p>
        {children && <p className="mt-0.5 text-muted-foreground">{children}</p>}
      </div>
      {actionLabel && onAction && (
        <Button type="button" variant="outline" size="xs" onClick={onAction} className="shrink-0 self-start sm:self-center">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
/** An address search at the end of a row. */
const ROW_ADDRESS_WIDTH = "w-full md:w-[22rem]";

/** The v1 address search, dressed as a v2 field, at the end of a sub-row. */
function AddressRow({
  id,
  label,
  description,
  value,
  onChange,
  placeholder,
  readOnly,
  issue,
  hint,
}: {
  id: string;
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  readOnly: boolean;
  issue?: string;
  hint?: string;
}) {
  return (
    <SubRow
      label={label}
      description={description}
      htmlFor={id}
      note={
        issue ? (
          <IssueNote title={issue} />
        ) : hint ? (
          <p className="text-muted-foreground">{hint}</p>
        ) : undefined
      }
    >
      <div className={ROW_ADDRESS_WIDTH}>
        <LocationAutocomplete
          id={id}
          value={value}
          onChange={(next) => onChange(next)}
          placeholder={placeholder}
          className={V2_ADDRESS_FIELD}
          v2States
          disabled={readOnly}
        />
      </div>
    </SubRow>
  );
}

/** The v1 Input under LocationAutocomplete, given the ui-v2 field's size, fill and a rounded-xl corner. */
const V2_ADDRESS_FIELD = "h-9 rounded-xl border-transparent bg-input/50 md:text-sm";

/** A number typed into a field: blank is `null`, anything else as typed. */
function numberOrNull(raw: string): number | null {
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className={cn("text-xs", ISSUE_TEXT)}>
      {children}
    </p>
  );
}

/**
 * One side's area, as sub-rows. `full` shows the center point, the radius and
 * the price; otherwise (Return, while Pickup's area is on) only the side's own
 * radius, since the rest is shared.
 */
function AreaRows({
  side,
  full,
  form,
  onFormChange,
  center,
  errors,
  attempted,
  readOnly,
  unitLabel,
  distanceUnit,
  currencyCode,
  onEditPrice,
}: {
  side: LocationSide;
  full: boolean;
  form: LocationFormState;
  onFormChange: (patch: Partial<LocationFormState>) => void;
  center: LocationsV2Props["center"];
  errors: AreaFieldErrors;
  attempted: boolean;
  readOnly: boolean;
  unitLabel: string;
  distanceUnit: DistanceUnit;
  currencyCode: string;
  onEditPrice: (side: LocationSide, mode: PriceMode) => void;
}) {
  const radius = side === "pickup" ? form.areaRadius : form.returnAreaRadius;
  const radiusError = side === "pickup" ? errors.radius : errors.returnRadius;
  const hardMax = Math.floor(kmToDisplayUnit(1000, distanceUnit));
  const suggestionLimit = Math.floor(kmToDisplayUnit(50, distanceUnit));
  const coords = centerCoordinateLabel(form.areaCenterLat, form.areaCenterLon);
  const coordsOnly = !!coords && center.address === coords;
  const radiusId = `v2-${side}-area-radius`;
  const priceLabel = side === "pickup" ? "Delivery price" : "Collection price";
  const mode: PriceMode = form.deliveryTiersEnabled ? "distance" : "flat";
  const priceIssue = firstPriceIssue(form, errors, unitLabel);

  const setRadius = (raw: string) => {
    const value = numberOrNull(raw);
    const next = value != null && value > hardMax ? hardMax : value;
    onFormChange(side === "pickup" ? { areaRadius: next } : { returnAreaRadius: next });
  };

  const centerNote = (() => {
    if (attempted && errors.center) return <IssueNote title={errors.center} />;
    if (center.typed) {
      return (
        <p className={HINT_WARN}>
          {coords ? (
            <>
              Pick an address from the suggestions to move your center point. Until you do, it stays at{" "}
              <span className="tabular-nums">{coords}</span>.
            </>
          ) : (
            "Pick an address from the suggestions to set your center point."
          )}
        </p>
      );
    }
    if (!coords) return undefined;
    return (
      <p className="text-muted-foreground">
        {coordsOnly ? "Your saved center point is at " : "Saved at "}
        <span className="tabular-nums">{coords}</span>.
      </p>
    );
  })();

  return (
    <SettingsReadOnlyFieldset readOnly={readOnly}>
      {!full && (
        <p className="px-5 py-2 text-[13px] leading-snug text-muted-foreground md:pl-10">
          Uses the center point and price set under Pickup and delivery.
        </p>
      )}

      {full && (
        <SubRow
          label="Center point"
          description="The address distances are measured from, usually your shop."
          htmlFor="v2-area-center"
          note={centerNote}
        >
          <div className={ROW_ADDRESS_WIDTH}>
            <LocationAutocomplete
              id="v2-area-center"
              value={coordsOnly ? "" : center.address}
              onChange={center.onChange}
              placeholder={coords ? (readOnly ? "Saved as a map point" : "Search an address to move it") : "Search for your center point"}
              className={V2_ADDRESS_FIELD}
              v2States
              disabled={readOnly}
            />
          </div>
        </SubRow>
      )}

      <SubRow
        label="Radius"
        description={`How far from your center point you ${side === "pickup" ? "deliver" : "collect"}, in ${getDistanceUnitLong(distanceUnit)}.`}
        htmlFor={radiusId}
        note={
          radiusError ? (
            <IssueNote title={radiusError} />
          ) : (radius ?? 0) > suggestionLimit ? (
            <p className={HINT_WARN}>
              For the most accurate address suggestions, keep this under {suggestionLimit} {unitLabel}. Above that,
              suggestions are filtered by distance instead.
            </p>
          ) : undefined
        }
      >
        <UnitGroup>
          <Input
            id={radiusId}
            type="number"
            inputMode="decimal"
            min={1}
            max={hardMax}
            placeholder="50"
            value={radius ?? ""}
            onChange={(e) => setRadius(e.target.value)}
            aria-invalid={!!radiusError || undefined}
            // The faded red of the note under it, not the full-strength border.
            className="w-24 rounded-xl tabular-nums aria-[invalid=true]:border-destructive/40"
          />
          <Unit>{unitLabel}</Unit>
        </UnitGroup>
      </SubRow>

      {full && (
        <SubRow
          label={priceLabel}
          description={<span data-area-price-summary="">{describeAreaPrice(form, currencyCode, unitLabel)}</span>}
          note={
            priceIssue ? (
              // The price is fixed in its dialog, so the fix opens it.
              <IssueNote
                title={priceIssue}
                actionLabel={readOnly ? undefined : "Edit price"}
                onAction={() => onEditPrice(side, mode)}
              />
            ) : undefined
          }
        >
          <RadioGroup
            value={mode}
            onValueChange={(value) => onEditPrice(side, value as PriceMode)}
            aria-label={priceLabel}
            disabled={readOnly}
            className="flex w-auto flex-wrap items-center gap-x-5 gap-y-2"
          >
            <label htmlFor={`v2-${side}-price-flat`} className="flex items-center gap-2 text-sm text-foreground">
              <RadioGroupItem id={`v2-${side}-price-flat`} value="flat" />
              One fee
            </label>
            <label htmlFor={`v2-${side}-price-distance`} className="flex items-center gap-2 text-sm text-foreground">
              <RadioGroupItem id={`v2-${side}-price-distance`} value="distance" />
              Price by distance
            </label>
          </RadioGroup>
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onEditPrice(side, mode)}
              aria-label={`Edit ${priceLabel.toLowerCase()}`}
              className="hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]"
            >
              Edit
            </Button>
          )}
        </SubRow>
      )}
    </SettingsReadOnlyFieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* The area's price dialog                                                     */
/* -------------------------------------------------------------------------- */

/**
 * "One fee" or "Price by distance". It edits a copy; Done checks it with the
 * same rules the page's save runs and only then puts it in the form, which the
 * page's Save changes writes. Cancel leaves the form as it was. Remount it (a
 * new `key`) for each opening so it starts from the form.
 */
export function AreaPriceDialogV2({
  open,
  onOpenChange,
  mode,
  side,
  form,
  currencySymbol,
  unitLabel,
  unitLong,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PriceMode;
  side: LocationSide;
  form: LocationFormState;
  currencySymbol: string;
  unitLabel: string;
  unitLong: string;
  onApply: (patch: Partial<LocationFormState>) => void;
}) {
  const [draft, setDraft] = useState<PriceDraft>(() => ({
    fee: form.areaDeliveryFee,
    tiers: mode === "distance" ? startingPriceBands(form.tiers, form.areaDeliveryFee) : form.tiers.map((t) => ({ ...t })),
    maxDistance: form.maxDeliveryDistance,
  }));
  const errors = priceDialogErrors(form, draft, mode, unitLabel);
  const hasOpenBand = draft.tiers.some((t) => t.up_to === null);
  // From Pickup the fee covers collections too only while Collect within an area is on.
  const charged =
    side === "pickup"
      ? form.returnAreaEnabled
        ? "each delivery and each collection"
        : "each delivery"
      : "each collection";

  const setTiers = (tiers: PriceBand[]) => setDraft((prev) => ({ ...prev, tiers }));
  const updateBand = (index: number, patch: Partial<PriceBand>) =>
    setTiers(draft.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  const done = () => {
    if (Object.keys(errors).length > 0) return;
    onApply(priceDialogPatch(mode, draft));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "flat" ? "One fee" : "Price by distance"}</DialogTitle>
          <DialogDescription>
            {mode === "flat"
              ? `One price for every address in the area, charged for ${charged}.`
              : `Customers pay by how far the address is from your center point. Distances are in ${unitLong}.`}{" "}
            Nothing is saved until you press Save changes.
          </DialogDescription>
        </DialogHeader>

        {mode === "flat" ? (
          <SettingsField label="Fee" htmlFor="v2-area-fee" hint={errors.fee ? undefined : "Leave blank or 0 for no fee."}>
            <UnitGroup>
              <Unit>{currencySymbol}</Unit>
              <Input
                id="v2-area-fee"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                placeholder="0"
                value={draft.fee ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, fee: numberOrNull(e.target.value) }))}
                aria-invalid={!!errors.fee || undefined}
                className="w-28 rounded-xl tabular-nums"
              />
            </UnitGroup>
            <FieldError>{errors.fee}</FieldError>
          </SettingsField>
        ) : (
          <div className="space-y-4">
            <ul aria-label="Price bands" className="space-y-2">
              {draft.tiers.map((tier, index) => (
                <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
                          updateBand(index, { up_to: e.target.value === "" ? 0 : parseFloat(e.target.value) || 0 })
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
                        updateBand(index, { fee: e.target.value === "" ? 0 : parseFloat(e.target.value) || 0 })
                      }
                      aria-label={`${bandLabel(tier, unitLabel)} fee`}
                      className="w-24 rounded-xl tabular-nums"
                    />
                  </UnitGroup>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setTiers(draft.tiers.filter((_, i) => i !== index))}
                    aria-label={`Remove ${bandLabel(tier, unitLabel)}`}
                    className="text-muted-foreground hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]"
                  >
                    Remove
                  </Button>
                  {errors.bandRows?.[index] && (
                    <p role="alert" className={cn("basis-full text-xs", ISSUE_TEXT)}>
                      {errors.bandRows[index]}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <FieldError>{errors.bands}</FieldError>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setTiers(addPriceBand(draft.tiers, draft.fee))}>
                Add band
              </Button>
              <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Checkbox
                  checked={hasOpenBand}
                  onCheckedChange={(checked) => setTiers(setOpenPriceBand(draft.tiers, checked === true, draft.fee))}
                />
                Charge a flat fee for anywhere beyond the last band
              </label>
            </div>
            {!hasOpenBand && draft.maxDistance == null && (
              <p className={cn("text-xs", HINT_WARN)}>
                Without an &ldquo;Anywhere further&rdquo; band, your furthest band is the limit. Addresses beyond it
                can&apos;t be booked for delivery.
              </p>
            )}

            <SettingsField
              label="Maximum distance"
              htmlFor="v2-area-max-distance"
              hint={errors.maxDistance ? undefined : "Addresses further than this can't be booked. Leave blank for no limit."}
            >
              <UnitGroup>
                <Input
                  id="v2-area-max-distance"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  placeholder="None"
                  value={draft.maxDistance ?? ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, maxDistance: numberOrNull(e.target.value) }))}
                  aria-invalid={!!errors.maxDistance || undefined}
                  className="w-24 rounded-xl tabular-nums"
                />
                <Unit>{unitLabel}</Unit>
              </UnitGroup>
              <FieldError>{errors.maxDistance}</FieldError>
            </SettingsField>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={done} className="min-w-[96px]">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* The location dialogs                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Add or edit one delivery or return location: its name, address, description,
 * fee and whether customers can pick it. Save writes at once; it doesn't wait
 * for the page's Save changes. Delete is the row's own action. Remount it (a new
 * `key`) for each opening so it starts from the location.
 *
 * `noFee` (the row's No fee): the fee starts at 0 with the focus on it, and
 * still nothing is written until Save. Cancel leaves the fee as it was.
 */
export function LocationDialogV2({
  open,
  onOpenChange,
  side,
  location,
  noFee = false,
  currencySymbol,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: LocationSide;
  location: PickupLocation | null;
  noFee?: boolean;
  currencySymbol: string;
  saving: boolean;
  onSave: (payload: CreatePickupLocationInput | UpdatePickupLocationInput) => Promise<void>;
}) {
  const noun = locationNoun(side);
  const startAtNoFee = noFee && !!location;
  const [draft, setDraft] = useState<LocationDraft>(() => ({
    name: location?.name ?? "",
    address: location?.address ?? "",
    description: location?.description ?? "",
    delivery_fee: startAtNoFee ? 0 : location ? location.delivery_fee : null,
  }));
  const [active, setActive] = useState(location ? location.is_active : true);
  const [errors, setErrors] = useState<LocationDraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

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

  const fieldId = (name: string) => `v2-location-${name}`;

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          if (!startAtNoFee) return;
          // No fee: straight to the fee it set, so the operator sees what Save will write.
          event.preventDefault();
          document.getElementById(fieldId("fee"))?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {location ? "Edit" : "Add"} {noun} location
          </DialogTitle>
          <DialogDescription>
            {startAtNoFee
              ? "The fee is set to 0. Nothing changes until you press Save."
              : location
                ? "Changes save as soon as you press Save."
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
              placeholder="Search for the address"
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
            label={side === "pickup" ? "Delivery fee" : "Return fee"}
            htmlFor={fieldId("fee")}
            hint={errors.fee ? undefined : "Leave blank or 0 for no fee."}
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

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <label htmlFor={fieldId("active")} className="text-[13px] font-medium text-foreground">
                Available to customers
              </label>
              <p className="text-xs text-muted-foreground">Off hides it at checkout without deleting it.</p>
            </div>
            <Switch id={fieldId("active")} checked={active} onCheckedChange={setActive} />
          </div>

          {failure && (
            <p role="alert" className={cn("text-[13px]", ISSUE_TEXT)}>
              {failure}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving} className="min-w-[112px]">
            {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {location ? "Save" : "Add location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The confirm step before a location is deleted (the row's Delete). A location
 * a booking used can't be deleted; the dialog says so and how to hide it.
 */
export function LocationDeleteDialogV2({
  open,
  onOpenChange,
  side,
  location,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: LocationSide;
  location: PickupLocation | null;
  onDelete: (id: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useAuditLogOnOpen({
    open: open && !!location,
    action: "location_delete_warning_shown",
    entityType: "settings",
    entityId: location?.id ?? null,
  });

  const confirm = async () => {
    if (!location) return;
    setDeleting(true);
    setFailure(null);
    try {
      await onDelete(location.id);
      onOpenChange(false);
    } catch (error) {
      setFailure(describeLocationDeleteError(error));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open && !!location} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{location?.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            Customers can no longer choose it for {side === "pickup" ? "delivery" : "returning the car"}. This
            can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        {failure && (
          <p role="alert" className={cn("text-[13px]", ISSUE_TEXT)}>
            {failure}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Keep location
          </Button>
          {/* The faded red tint, in the same contrast-corrected ink as the row's Delete. */}
          <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={deleting} className="panel-ink-danger">
            {deleting && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {deleting ? "Deleting…" : "Delete location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
