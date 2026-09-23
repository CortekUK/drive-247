"use client";

/**
 * v2 Settings → Business (General, Locations, Appearance): the state logic and
 * the two v2-only sections those pages need, built on the shared state kit in
 * `section-states.tsx`.
 *
 * v2 ONLY. Every caller renders these behind `useV2('chrome')` (northwind), so
 * the other 56 tenants never mount anything in here.
 *
 * The pure helpers are exported on their own so the rules can be tested
 * without rendering: a placeholder read is never treated as the tenant's real
 * configuration, a zero-row write is never treated as a save, and an edit to a
 * location never changes which lists it appears in.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
// Every SelectContent below is `tone="surface"`: Settings is a light,
// text-heavy screen, and the dropdown's default translucent near-black panel
// reads there as an OS menu rather than as part of the page. The surface tone
// uses the page's own popover, border and highlight tokens — see
// components/ui-v2/select.tsx.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import { Skeleton } from "@/components/ui-v2/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-v2/alert-dialog";
import {
  SETTINGS_PANEL_FLUSH,
  SettingsPanel,
  SettingsRow,
  SettingsRowAlignProvider,
  useSettingsPageSave,
} from "@/components/settings-v2/settings-kit";
import type { RegisterSectionSave } from "@/components/settings-v2/pricing-money-parts";
import {
  SettingsLoadError,
  SettingsNoMatch,
  SettingsSaveState,
  SettingsSectionSkeleton,
  TabularValue,
  describeSaveError,
  formatSettingsMoney,
  formatSettingsNumber,
  useSettingsSaveStatus,
} from "@/components/settings-v2/section-states";
import type { LocationSettings, PickupLocation } from "@/hooks/use-pickup-locations";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
// Locations: the delivery / return locations table.
import { Table } from "@/components/ui-v2/table";
import {
  LIST_CLASSES,
  LIST_SETTINGS_SURFACE,
  ListBody,
  ListCell,
  ListHead,
  ListRow,
  ListStatusText,
  ListTableHeader,
} from "@/components/shared/list-table-v2";

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

/** Wraps `children` only when `on`; otherwise renders them untouched (no extra DOM). */
export function ScopeIf({
  on,
  wrap,
  children,
}: {
  on: boolean;
  wrap: (children: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  return <>{on ? wrap(children) : children}</>;
}

/** A complete `#RRGGBB` colour. Anything shorter is still being typed. */
export function isHexColor6(value: string | null | undefined): boolean {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * True once `src` has failed to load (a deleted storage object, an expired or
 * hotlink-blocked URL). The caller keeps its own layout and adds an explanation;
 * `SettingsImage` is the kit's answer where an icon tile fits instead.
 */
export function useImageLoadFailed(src: string | null | undefined): boolean {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!src || typeof window === "undefined" || typeof window.Image === "undefined") return;
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled) setFailedSrc((current) => (current === src ? null : current));
    };
    img.onerror = () => {
      if (!cancelled) setFailedSrc(src);
    };
    img.src = src;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  return !!src && failedSrc === src;
}

/**
 * Loading placeholder with the exact frame of a `SettingsPanel` of `SettingsRow`s
 * (flush with the section heading, a title block when `title`, one ~64px row
 * per setting), so the page does not jump when the real panel replaces it.
 *
 * It carries `SETTINGS_PANEL_FLUSH` and no `divide-y` for the same reason the
 * panel does (settings-kit.tsx): a bordered card here would flash a box that
 * the loaded panel no longer draws, and shift every label 20px sideways as it
 * went.
 *
 * Its rows mirror an `align="end"` row — an elastic label column and the
 * control at the end — because every panel it stands in for (regional, the
 * location options, optional modules) lays its rows out that way. With the
 * 420px label column it used, each control box jumped from the middle of the
 * row to its end the moment the real panel arrived.
 */
export function SettingsPanelSkeleton({
  rows = 2,
  title = false,
  footer = false,
  descriptionLines = 1,
  label = "Loading",
  className,
}: {
  rows?: number;
  title?: boolean;
  /** The Save footer a panel shows to someone who can edit (never inside a page save bar). */
  footer?: boolean;
  /** Help lines under each row label (a long description wraps to two). */
  descriptionLines?: 1 | 2;
  label?: string;
  className?: string;
}) {
  return (
    <section
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-settings-state="loading"
      className={cn(SETTINGS_PANEL_FLUSH, className)}
    >
      <span className="sr-only">{label}</span>
      {title && (
        <div aria-hidden="true" className="space-y-1.5 pb-2">
          <Skeleton className="h-4 w-32 rounded-full" />
          <Skeleton className="h-3 w-72 max-w-full rounded-full" />
        </div>
      )}
      <div aria-hidden="true" data-settings-rows="">
        {Array.from({ length: Math.max(1, rows) }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 py-4 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-x-10"
          >
            <div className="min-w-0 space-y-1.5 md:max-w-2xl">
              <Skeleton className="h-3.5 w-24 rounded-full" />
              <Skeleton className="h-3 w-56 max-w-full rounded-full" />
              {descriptionLines === 2 && <Skeleton className="h-3 w-40 max-w-full rounded-full" />}
            </div>
            <Skeleton className="h-9 w-56 max-w-full shrink-0 rounded-3xl" />
          </div>
        ))}
      </div>
      {footer && (
        <div aria-hidden="true" className="flex items-center justify-end pt-2">
          <Skeleton className="h-8 w-[88px] rounded-full" />
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* General: regional settings                                                  */
/* -------------------------------------------------------------------------- */

export const SUPPORTED_CURRENCIES = ["USD", "GBP", "EUR"] as const;

export function isSupportedCurrency(code: string | null | undefined): boolean {
  return !!code && (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

/** How each currency reads in the picker: the plain name and its symbol. */
export const CURRENCY_OPTION_LABELS: Readonly<Record<(typeof SUPPORTED_CURRENCIES)[number], string>> = {
  USD: "US dollar ($)",
  GBP: "British pound (£)",
  EUR: "Euro (€)",
};

/** The one currency a tenant can switch TO for now (team lead review, Sep 19 2026). */
export const SELECTABLE_CURRENCY = "USD";

/**
 * Can this currency be picked? US dollar always; any other only when it is the
 * tenant's SAVED currency, so the picker never forces a saved GBP or EUR (or a
 * currency the list does not offer) off the page, and a tenant who tried US
 * dollar can pick their own currency again. Every other option shows, disabled.
 */
export function isCurrencySelectable(code: string, savedCurrency: string | null | undefined): boolean {
  return code === SELECTABLE_CURRENCY || (!!savedCurrency && code === savedCurrency);
}

/** The regional pickers share one width, so their boxes line up at the end of the rows. */
const REGIONAL_SELECT_WIDTH = "w-44 max-w-full";

/** `useOrgSettings` shows a hard-coded USD / miles placeholder until the edge function answers. */
export function hasRealOrgSettings(settings: { org_id?: string } | null | undefined): boolean {
  return !!settings && settings.org_id !== "placeholder";
}

/**
 * `useRentalSettings` shows DEFAULT_RENTAL_SETTINGS until the tenant row
 * arrives. Every real result (the read and every save) carries
 * `_paygMigrationReady`; the placeholder never does.
 */
export function hasRealRentalSettings(settings: object | null | undefined): boolean {
  return !!settings && Object.prototype.hasOwnProperty.call(settings, "_paygMigrationReady");
}

export interface GeneralSaveValues {
  currency_code: string;
  distance_unit: "km" | "miles";
  privacy_policy_version: string;
  terms_version: string;
}

/** The two regional values the v2 General page shows and saves. */
export type RegionalValues = Pick<GeneralSaveValues, "currency_code" | "distance_unit">;

/**
 * What the v2 Regional panel shows as saved: the tenant's own row first
 * (`tenants.currency_code` / `tenants.distance_unit`, what Locations, rentals
 * and every other screen read), then the org settings, then USD / miles.
 *
 * The org settings come from the `settings` edge function, which reads ONE
 * `org_settings` row with no tenant filter. Read first, as v1 does, a tenant
 * who picked Kilometres saw Kilometres here while every other screen said
 * miles, and General never looked unsaved, so the tenant row could not be
 * fixed from this page. v1 keeps its own order.
 */
export function savedRegionalV2(
  tenant: { currency_code?: string | null; distance_unit?: string | null } | null | undefined,
  settings: { currency_code?: string | null; distance_unit?: string | null } | null | undefined,
): RegionalValues {
  return {
    currency_code: tenant?.currency_code || settings?.currency_code || "USD",
    distance_unit: ((tenant?.distance_unit || settings?.distance_unit) as RegionalValues["distance_unit"]) || "miles",
  };
}

/**
 * Cached reads of the `tenants` row that carry its currency or distance unit,
 * besides TenantContext (which the save refetches itself). Invalidated after a
 * v2 General save so nothing keeps showing the old value.
 */
export const TENANT_REGIONAL_QUERY_KEYS: readonly (readonly string[])[] = [["rental-settings"], ["tenant-provider-choice"]];

export interface GeneralSaveDeps {
  tenantId: string | null | undefined;
  values: RegionalValues;
  /** `tenants` update ending in `.select('id')`, so a zero-row (RLS) write is not read as success. */
  writeTenant: (patch: RegionalValues) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
}

/** Marks an error whose toast has already been shown by a hook. */
export function isAlreadyToasted(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { alreadyToasted?: unknown }).alreadyToasted === true;
}

/**
 * The v2 General save: the tenant's own row, and only its currency and
 * distance unit. Checked, so a refused or zero-row write throws before
 * anything reports success (supabase-js reports it in `error`, never throws).
 *
 * v2 never calls the `settings` edge function for these two: it updates ONE
 * `org_settings` row with no tenant filter, so a save there could change what
 * other tenants see. v1 still writes both, org settings first.
 */
export async function saveGeneralSettingsV2({ tenantId, values, writeTenant }: GeneralSaveDeps): Promise<void> {
  if (!tenantId) {
    throw new Error("Your business details haven't loaded yet. Reload the page and try again.");
  }
  const { data, error } = await writeTenant({
    currency_code: values.currency_code,
    distance_unit: values.distance_unit,
  });
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("You don't have permission to change these settings.");
  }
}

export interface BusinessRegionalPanelProps {
  form: GeneralSaveValues;
  onFormChange: (patch: Partial<GeneralSaveValues>) => void;
  /** The stored currency, to tell a relabel apart from no change. */
  savedCurrency: string;
  isDirty: boolean;
  canEdit: boolean;
  /** Real org settings and the tenant have both arrived. */
  ready: boolean;
  loadError?: unknown;
  onRetryLoad: () => unknown;
  retryingLoad?: boolean;
  /** Persist. Throws on failure (see `saveGeneralSettingsV2`). */
  onSave: () => Promise<void>;
  onDiscard: () => void;
  /**
   * The settings page's section registry. Inside a page save bar the panel has
   * no Save of its own: it registers its save (which still asks before a
   * currency change) and its discard under `general-regional`.
   */
  registerSave?: RegisterSectionSave;
}

/** Thrown when Save changes was pressed but the currency change was not confirmed. */
export const CURRENCY_NOT_CONFIRMED_MESSAGE = "The currency change wasn't confirmed, so it wasn't saved.";

export function BusinessRegionalPanel({
  form,
  onFormChange,
  savedCurrency,
  isDirty,
  canEdit,
  ready,
  loadError,
  onRetryLoad,
  retryingLoad,
  onSave,
  onDiscard,
  registerSave,
}: BusinessRegionalPanelProps) {
  const pageSave = useSettingsPageSave();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const status = useSettingsSaveStatus({ isDirty, isPending: saving, error: saveError });
  /** A page Save waiting on the currency confirm. */
  const pendingConfirm = useRef<{ resolve: () => void; reject: (error: unknown) => void } | null>(null);

  // Discarding (or a later successful save) clears a stale failure.
  useEffect(() => {
    if (!isDirty) setSaveError(null);
  }, [isDirty]);

  const currencyChanged = form.currency_code !== savedCurrency;
  const unsupported = !isSupportedCurrency(form.currency_code);

  const runSave = async () => {
    setConfirmOpen(false);
    setSaving(true);
    setSaveError(null);
    try {
      await onSave();
    } catch (error) {
      setSaveError(error);
      if (!isAlreadyToasted(error)) {
        toast({ title: "Couldn't save regional settings", description: describeSaveError(error), variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const requestSave = () => {
    if (saving) return;
    if (currencyChanged) setConfirmOpen(true);
    else void runSave();
  };

  // The page's Save changes: the same confirm before a currency change, then the
  // same save. Rejects when it did not save, so the page reports it and stays.
  // The page toasts a failure itself, so none is shown here.
  const latestPageSave = useRef<() => Promise<void>>(async () => undefined);
  latestPageSave.current = async () => {
    if (currencyChanged) {
      await new Promise<void>((resolve, reject) => {
        pendingConfirm.current = { resolve, reject };
        setConfirmOpen(true);
      });
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave();
    } catch (error) {
      setSaveError(error);
      throw error;
    } finally {
      setSaving(false);
    }
  };
  const stablePageSave = useCallback(() => latestPageSave.current(), []);
  const latestDiscard = useRef(onDiscard);
  latestDiscard.current = onDiscard;
  const stableDiscard = useCallback(() => latestDiscard.current(), []);
  const registered = pageSave && canEdit && ready ? registerSave : undefined;
  useEffect(() => {
    if (isDirty) registered?.("general-regional", stablePageSave, stableDiscard);
    else registered?.("general-regional", null);
  }, [registered, isDirty, stablePageSave, stableDiscard]);
  useEffect(() => () => registered?.("general-regional", null), [registered]);

  const onConfirmOpenChange = (open: boolean) => {
    setConfirmOpen(open);
    if (!open && pendingConfirm.current) {
      pendingConfirm.current.reject(Object.assign(new Error(CURRENCY_NOT_CONFIRMED_MESSAGE), { alreadyToasted: true }));
      pendingConfirm.current = null;
    }
  };

  const confirmCurrency = () => {
    if (pendingConfirm.current) {
      const pending = pendingConfirm.current;
      pendingConfirm.current = null;
      setConfirmOpen(false);
      pending.resolve();
      return;
    }
    void runSave();
  };

  if (!ready && loadError) {
    return (
      <SettingsLoadError thing="your regional settings" error={loadError} onRetry={onRetryLoad} retrying={retryingLoad} />
    );
  }
  if (!ready) {
    return <SettingsPanelSkeleton rows={2} footer={canEdit && !pageSave} label="Loading regional settings" />;
  }

  return (
    <>
      <SettingsRowAlignProvider align="end">
        <SettingsPanel
          footer={
            canEdit && pageSave ? (
              status === "error" ? <SettingsSaveState status="error" error={saveError} /> : null
            ) : canEdit ? (
              <>
                <SettingsSaveState
                  status={status}
                  error={saveError}
                  onRetry={status === "error" ? requestSave : undefined}
                  onDiscard={status === "dirty" ? onDiscard : undefined}
                  className="mr-auto"
                />
                <Button size="sm" onClick={requestSave} disabled={saving || !isDirty} className="min-w-[88px]">
                  {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
                  {saving ? "Saving…" : "Save"}
                </Button>
              </>
            ) : undefined
          }
        >
          {/* Both controls at the end of their row (the panel's align
              provider), the same width, each menu opening under its own box's
              right edge. */}
          <SettingsRow
            label="Currency"
            description="The symbol on prices, invoices and reports. Only US dollar can be chosen for now."
            htmlFor="v2_currency_code"
            note={
              unsupported ? (
                <p className="text-muted-foreground">
                  Your currency is{" "}
                  <span className="font-medium text-foreground">{form.currency_code || "not set"}</span>. It stays as it
                  is unless you pick US dollar. Contact support for any other currency.
                </p>
              ) : currencyChanged ? (
                <p className="panel-ink-warn">
                  Changing currency relabels your prices. It doesn&apos;t convert them.
                </p>
              ) : undefined
            }
          >
            <Select
              value={form.currency_code}
              onValueChange={(value) => onFormChange({ currency_code: value })}
              disabled={!canEdit || saving}
            >
              <SelectTrigger id="v2_currency_code" className={REGIONAL_SELECT_WIDTH}>
                <SelectValue placeholder="Choose a currency" />
              </SelectTrigger>
              <SelectContent tone="surface" align="end">
                {/* A saved currency the list doesn't offer stays shown and can be
                    picked again after trying US dollar. */}
                {savedCurrency && !isSupportedCurrency(savedCurrency) && (
                  <SelectItem value={savedCurrency}>{savedCurrency} (current)</SelectItem>
                )}
                {SUPPORTED_CURRENCIES.map((code) => (
                  <SelectItem key={code} value={code} disabled={!isCurrencySelectable(code, savedCurrency)}>
                    {CURRENCY_OPTION_LABELS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow
            label="Distance unit"
            description="Used for mileage and delivery distances."
            htmlFor="v2_distance_unit"
          >
            <Select
              value={form.distance_unit}
              onValueChange={(value: "km" | "miles") => onFormChange({ distance_unit: value })}
              disabled={!canEdit || saving}
            >
              <SelectTrigger id="v2_distance_unit" className={REGIONAL_SELECT_WIDTH}>
                <SelectValue placeholder="Choose a unit" />
              </SelectTrigger>
              <SelectContent tone="surface" align="end">
                <SelectItem value="km">Kilometres</SelectItem>
                <SelectItem value="miles">Miles</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsPanel>
      </SettingsRowAlignProvider>

      <AlertDialog open={confirmOpen} onOpenChange={onConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Change currency from {savedCurrency || "—"} to {form.currency_code}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This relabels your prices. It doesn&apos;t convert them: vehicles, extras, fees and deposits keep the
              same numbers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCurrency}>Change currency</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Locations: pickup / return form                                             */
/* -------------------------------------------------------------------------- */

/** The editable state of `LocationSettings`, in the tenant's display unit. */
export interface LocationFormState {
  pickupFixedEnabled: boolean;
  pickupMultipleEnabled: boolean;
  pickupAreaEnabled: boolean;
  returnFixedEnabled: boolean;
  returnMultipleEnabled: boolean;
  returnAreaEnabled: boolean;
  fixedPickupAddress: string;
  fixedReturnAddress: string;
  sameReturnAddress: boolean;
  /** The pickup (delivery) area's radius. */
  areaRadius: number | null;
  /** The return (collection) area's own radius. v1 wrote `areaRadius` to both. */
  returnAreaRadius: number | null;
  areaDeliveryFee: number | null;
  areaCenterLat: number | null;
  areaCenterLon: number | null;
  deliveryTiersEnabled: boolean;
  tiers: { up_to: number | null; fee: number }[];
  maxDeliveryDistance: number | null;
}

/** Exactly what `LocationSettings`' sync effect puts into local state. */
export function locationFormFromSettings(
  s: LocationSettings,
  kmToDisplay: (km: number) => number,
): LocationFormState {
  return {
    pickupFixedEnabled: s.pickup_fixed_enabled ?? true,
    pickupMultipleEnabled: s.pickup_multiple_locations_enabled ?? false,
    pickupAreaEnabled: s.pickup_area_enabled ?? false,
    returnFixedEnabled: s.return_fixed_enabled ?? true,
    returnMultipleEnabled: s.return_multiple_locations_enabled ?? false,
    returnAreaEnabled: s.return_area_enabled ?? false,
    fixedPickupAddress: s.fixed_pickup_address || "",
    fixedReturnAddress: s.fixed_return_address || "",
    sameReturnAddress: !s.fixed_return_address || s.fixed_return_address === s.fixed_pickup_address,
    areaRadius: s.pickup_area_radius_km != null ? kmToDisplay(s.pickup_area_radius_km) : 100,
    returnAreaRadius: s.return_area_radius_km != null ? kmToDisplay(s.return_area_radius_km) : 100,
    areaDeliveryFee: s.area_delivery_fee ?? 0,
    areaCenterLat: s.area_center_lat,
    areaCenterLon: s.area_center_lon,
    deliveryTiersEnabled: s.delivery_tiers_enabled ?? false,
    tiers: (s.delivery_distance_tiers ?? []).map((t) => ({
      up_to: t.up_to_km == null ? null : kmToDisplay(t.up_to_km),
      fee: t.fee,
    })),
    maxDeliveryDistance: s.delivery_max_distance_km != null ? kmToDisplay(s.delivery_max_distance_km) : null,
  };
}

/** Derived dirty: the form differs from what is stored. */
export function isLocationFormDirty(current: LocationFormState, saved: LocationFormState): boolean {
  const scalarKeys = (Object.keys(saved) as (keyof LocationFormState)[]).filter((k) => k !== "tiers");
  if (scalarKeys.some((k) => current[k] !== saved[k])) return true;
  if (current.tiers.length !== saved.tiers.length) return true;
  return current.tiers.some((t, i) => t.up_to !== saved.tiers[i].up_to || t.fee !== saved.tiers[i].fee);
}

export interface AreaFieldErrors {
  center?: string;
  /** The pickup area's radius (checked while pickup area delivery is on). */
  radius?: string;
  /** The return area's radius (checked while return area collection is on). */
  returnRadius?: string;
  fee?: string;
  /** The price bands as a whole: none left, or two at the same distance. */
  bands?: string;
  /** One reason per invalid band, keyed by its index in `tiers`. */
  bandRows?: Record<number, string>;
  maxDistance?: string;
}

/**
 * Inline errors for the area fields. Empty when area delivery is off. Each
 * side's radius is checked only while that side's area option is on (a hidden
 * field never blocks a save). The price-band checks are v1's save-time checks
 * (which only ever toasted), shown beside the band instead.
 */
export function areaFieldErrors(f: LocationFormState, unitLabel: string): AreaFieldErrors {
  const out: AreaFieldErrors = {};
  if (!(f.pickupAreaEnabled || f.returnAreaEnabled)) return out;
  if (!f.areaCenterLat || !f.areaCenterLon) out.center = "Pick a center point from the address suggestions.";
  const radiusError = (radius: number | null) =>
    radius == null || !Number.isFinite(radius)
      ? `Enter a radius of at least 1 ${unitLabel}.`
      : radius < 1
        ? `Radius must be at least 1 ${unitLabel}.`
        : undefined;
  if (f.pickupAreaEnabled) {
    const radius = radiusError(f.areaRadius);
    if (radius) out.radius = radius;
  }
  if (f.returnAreaEnabled) {
    const radius = radiusError(f.returnAreaRadius);
    if (radius) out.returnRadius = radius;
  }
  if (!f.deliveryTiersEnabled && f.areaDeliveryFee != null && f.areaDeliveryFee < 0) {
    out.fee = "Fee can't be negative.";
  }
  if (f.deliveryTiersEnabled) {
    if (f.tiers.length === 0) out.bands = "Add at least one price band, or choose One fee.";
    const rows: Record<number, string> = {};
    f.tiers.forEach((t, i) => {
      if (t.up_to !== null && (!Number.isFinite(t.up_to) || t.up_to <= 0)) {
        rows[i] = `Distance must be more than 0 ${unitLabel}.`;
      } else if (!Number.isFinite(t.fee)) {
        rows[i] = "Enter a valid fee.";
      } else if (t.fee < 0) {
        rows[i] = "Fee can't be negative.";
      }
    });
    if (Object.keys(rows).length > 0) out.bandRows = rows;
    const bounded = f.tiers
      .map((t) => t.up_to)
      .filter((u): u is number => u !== null && Number.isFinite(u) && u > 0)
      .sort((a, b) => a - b);
    if (!out.bands && bounded.some((u, i) => i > 0 && u <= bounded[i - 1])) {
      out.bands = "Two bands have the same distance. Give each band its own distance.";
    }
    if (f.maxDeliveryDistance != null) {
      const furthest = bounded.length > 0 ? bounded[bounded.length - 1] : 0;
      if (!Number.isFinite(f.maxDeliveryDistance) || f.maxDeliveryDistance <= 0) {
        out.maxDistance = "Enter a distance above 0, or leave it blank for no limit.";
      } else if (furthest > 0 && f.maxDeliveryDistance < furthest) {
        out.maxDistance = `Must be at least your furthest band (${formatSettingsNumber(furthest)} ${unitLabel}).`;
      }
    }
  }
  return out;
}

/** "Up to 20 mi" / "Anywhere further": how a band is named in an error. */
export function bandLabel(tier: { up_to: number | null }, unitLabel: string): string {
  return tier.up_to === null ? "Anywhere further" : `Up to ${formatSettingsNumber(tier.up_to)} ${unitLabel}`;
}

/** v1 shows a stored centre point (it has no address) as "lat, lon" in the address field. */
export function centerCoordinateLabel(lat: number | null, lon: number | null): string | null {
  if (!lat || !lon) return null;
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

export interface LocationSaveContext {
  unitLabel: string;
  /** Active locations on each side, or `null` while the list is loading or failed. */
  pickupActiveLocations: number | null;
  returnActiveLocations: number | null;
}

/** Why an option can't be saved, keyed by the row that shows it. */
export interface LocationOptionIssues {
  pickupOptions?: string;
  returnOptions?: string;
  pickupAddress?: string;
  returnAddress?: string;
  pickupList?: string;
  returnList?: string;
}

/** The option checks `locationSaveIssueV2` runs before the area checks. */
export function locationOptionIssues(f: LocationFormState, ctx: LocationSaveContext): LocationOptionIssues {
  const out: LocationOptionIssues = {};
  if (!f.pickupFixedEnabled && !f.pickupMultipleEnabled && !f.pickupAreaEnabled) out.pickupOptions = "Turn on at least one pickup option.";
  if (!f.returnFixedEnabled && !f.returnMultipleEnabled && !f.returnAreaEnabled) out.returnOptions = "Turn on at least one return option.";
  if (f.pickupFixedEnabled && !f.fixedPickupAddress.trim()) out.pickupAddress = "Enter your pickup address.";
  if (f.returnFixedEnabled && !f.sameReturnAddress && !f.fixedReturnAddress.trim()) out.returnAddress = "Enter your return address.";
  // A location is "active" when Available to customers is on (its Edit dialog).
  if (f.pickupMultipleEnabled && ctx.pickupActiveLocations === 0) {
    out.pickupList =
      "Delivery locations is on but none are available to customers. Add a location or make one available, or turn the option off.";
  }
  if (f.returnMultipleEnabled && ctx.returnActiveLocations === 0) {
    out.returnList =
      "Return locations is on but none are available to customers. Add a location or make one available, or turn the option off.";
  }
  return out;
}

/** Which row a refused save belongs to, so the page can take the operator there. */
export type LocationIssueField =
  | "pickupOptions"
  | "returnOptions"
  | "pickupAddress"
  | "returnAddress"
  | "pickupList"
  | "returnList"
  | "center"
  | "pickupRadius"
  | "returnRadius"
  /** The fee, the price bands and the maximum: all edited in the price dialog. */
  | "price";

export interface LocationSaveIssue {
  message: string;
  field: LocationIssueField;
}

/** The option checks in the order they are reported. */
const OPTION_ISSUE_ORDER = [
  "pickupOptions",
  "returnOptions",
  "pickupAddress",
  "returnAddress",
  "pickupList",
  "returnList",
] as const;

/**
 * The first reason the form can't be saved AND the row it belongs to, or null.
 * Mirrors the v1 checks and adds the ones v1 let through: a delivery/collection
 * list with nothing active, a zero/negative/blank radius (v1 silently saved 100)
 * and a negative fee. Active-location counts are `null` while the list is
 * loading or failed.
 */
export function locationSaveIssueV2(f: LocationFormState, ctx: LocationSaveContext): LocationSaveIssue | null {
  const options = locationOptionIssues(f, ctx);
  const option = OPTION_ISSUE_ORDER.find((key) => options[key]);
  if (option) return { message: options[option], field: option };
  const area = areaFieldErrors(f, ctx.unitLabel);
  const firstBand = area.bandRows ? Number(Object.keys(area.bandRows)[0]) : null;
  const bandRow =
    firstBand !== null && area.bandRows
      ? `Price band "${bandLabel(f.tiers[firstBand], ctx.unitLabel)}": ${area.bandRows[firstBand]}`
      : undefined;
  if (area.center) return { message: area.center, field: "center" };
  if (area.radius) return { message: area.radius, field: "pickupRadius" };
  if (area.returnRadius) return { message: area.returnRadius, field: "returnRadius" };
  const price = area.fee ?? area.bands ?? bandRow ?? area.maxDistance;
  if (price) return { message: price, field: "price" };
  return null;
}

/** The same first reason, as a sentence. */
export function validateLocationSettingsV2(f: LocationFormState, ctx: LocationSaveContext): string | null {
  return locationSaveIssueV2(f, ctx)?.message ?? null;
}

/* -------------------------------------------------------------------------- */
/* Locations: delivery / collection list                                       */
/* -------------------------------------------------------------------------- */

export const LOCATION_NAME_MAX = 80;
export const LOCATION_TEXT_MAX = 200;
/** Above this many rows the list gets a search box. */
export const LOCATION_SEARCH_THRESHOLD = 8;

export interface LocationDraft {
  name: string;
  address: string;
  description: string;
  delivery_fee: number | null;
}

export type LocationDraftErrors = Partial<Record<"name" | "address" | "description" | "fee", string>>;

export function validateLocationDraft(d: LocationDraft): LocationDraftErrors {
  const out: LocationDraftErrors = {};
  const name = d.name.trim();
  const address = d.address.trim();
  const description = d.description.trim();
  if (!name) out.name = "Enter a name customers will recognise.";
  else if (name.length > LOCATION_NAME_MAX) out.name = `Keep the name to ${LOCATION_NAME_MAX} characters (it has ${name.length}).`;
  if (!address) out.address = "Enter the address.";
  else if (address.length > LOCATION_TEXT_MAX) out.address = `Keep the address to ${LOCATION_TEXT_MAX} characters (it has ${address.length}).`;
  if (description.length > LOCATION_TEXT_MAX) {
    out.description = `Keep the description to ${LOCATION_TEXT_MAX} characters (it has ${description.length}).`;
  }
  if (d.delivery_fee != null) {
    if (!Number.isFinite(d.delivery_fee)) out.fee = "Enter a valid fee.";
    else if (d.delivery_fee < 0) out.fee = "Fee can't be negative.";
  }
  return out;
}

/**
 * The row to write. A NEW location is put on the side its dialog was opened
 * from. An EDIT sends no flags at all, so a location used for both delivery and
 * collection stays in both lists (v1 forced the flags to the dialog's side).
 */
export function buildLocationPayload(
  d: LocationDraft,
  { editing, mode }: { editing: boolean; mode: "pickup" | "return" },
): {
  name: string;
  address: string;
  description: string | null;
  delivery_fee: number;
  is_pickup_enabled?: boolean;
  is_return_enabled?: boolean;
} {
  const base = {
    name: d.name.trim(),
    address: d.address.trim(),
    description: d.description.trim() || null,
    // Exactly what v1 sends. pickup_locations.delivery_fee is numeric(10,2), so
    // Postgres rounds half-cents; Math.round(x * 100) / 100 disagrees (1.005 -> 1.00).
    delivery_fee: d.delivery_fee ?? 0,
  };
  if (editing) return base;
  return { ...base, is_pickup_enabled: mode === "pickup", is_return_enabled: mode === "return" };
}

export function filterLocations(locations: PickupLocation[], query: string): PickupLocation[] {
  const q = query.trim().toLowerCase();
  if (!q) return locations;
  return locations.filter((l) =>
    [l.name, l.address, l.description ?? ""].some((field) => field.toLowerCase().includes(q)),
  );
}

export interface LocationsListV2Props {
  side: "pickup" | "return";
  /** Already narrowed to this side. */
  locations: PickupLocation[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => unknown;
  retrying?: boolean;
  /** Opens the location's Edit dialog (name, address, fee, Available to customers). */
  onEdit: (location: PickupLocation) => void;
  /** Asks to delete it. The page shows the confirm step before anything is deleted. */
  onDelete: (location: PickupLocation) => void;
  /**
   * No fee: opens the location's Edit dialog with the fee at 0. Nothing is
   * written until Save is pressed there (it moves money, so never on one click).
   */
  onNoFee: (location: PickupLocation) => void;
  /** A location write, or the list's read after one, is in flight: No fee waits for it. */
  writing?: boolean;
  currencyCode: string;
  readOnly: boolean;
}

/** What the list calls its locations: "delivery" and "return" (v2 renamed collection to return). */
export function locationNoun(side: "pickup" | "return"): "delivery" | "return" {
  return side === "pickup" ? "delivery" : "return";
}

/** A location's fee as the list shows it: "No fee" for 0 (or an unreadable value). */
export function locationFeeLabel(fee: number | string | null | undefined, currencyCode: string): string {
  const n = Number(fee);
  return !Number.isFinite(n) || n === 0 ? "No fee" : formatSettingsMoney(n, currencyCode);
}

/**
 * The v2 hover pair on a row action: a light brand tint, never a grey or white
 * fill. `xs` buttons, pulled in so a row is no taller than a plain one.
 */
const LOCATION_ACTION = "-my-1 hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]";
/** Delete reads in the toned-down red, on a faded red hover. */
const LOCATION_ACTION_DANGER =
  "-my-1 text-destructive panel-ink-danger hover:bg-destructive/10 dark:hover:bg-destructive/20";
/**
 * The list's scroll box. The shared one hides its scrollbar, which on a narrow
 * screen cut Delete off with nothing to say the row scrolls; this one keeps a
 * thin bar.
 */
const LOCATION_SCROLL_ROOT = cn(
  LIST_CLASSES.scrollRoot.replace(/\bno-scrollbar\b/, ""),
  "[scrollbar-width:thin] max-h-[24rem] overscroll-contain",
);

/**
 * One side's delivery or return locations, as a table: Name, Address, Fee,
 * Available and (for anyone who can edit) Actions, whose Edit, No fee and
 * Delete sit in every row. Add location lives in the option's own row on the
 * page, so the list has no button of its own. A viewer gets the same table
 * without the Actions column.
 */
export function LocationsListV2({
  side,
  locations,
  isLoading,
  error,
  onRetry,
  retrying,
  onEdit,
  onDelete,
  onNoFee,
  writing = false,
  currencyCode,
  readOnly,
}: LocationsListV2Props) {
  const [query, setQuery] = useState("");
  const noun = locationNoun(side);
  const listName = side === "pickup" ? "Delivery locations" : "Return locations";

  if (isLoading && locations.length === 0) {
    // The loaded table's columns: Name, Address, Fee, Available, and Actions for an editor.
    return (
      <SettingsSectionSkeleton variant="table" rows={2} columns={readOnly ? 4 : 5} label={`Loading ${noun} locations`} />
    );
  }
  if (error && locations.length === 0) {
    return (
      <SettingsLoadError
        thing={`your ${noun} locations`}
        error={error}
        onRetry={onRetry}
        retrying={retrying}
        className="px-4 py-6 sm:px-6"
      />
    );
  }

  if (locations.length === 0) {
    return (
      <p className="text-[13px] leading-snug text-muted-foreground" data-settings-state="empty">
        No {noun} locations yet.
        {!readOnly &&
          (side === "pickup"
            ? " Use Add location to add places customers can choose for delivery, like an airport terminal or a hotel."
            : " Use Add location to add places customers can choose for returning the car, like an airport terminal or a hotel.")}
      </p>
    );
  }

  const activeCount = locations.filter((l) => l.is_active).length;
  const showSearch = locations.length > LOCATION_SEARCH_THRESHOLD;
  const visible = showSearch ? filterLocations(locations, query) : locations;

  return (
    <div className="space-y-3" data-settings-state="content">
      {!!error && (
        <SettingsLoadError variant="inline" thing={`${noun} locations`} error={error} onRetry={onRetry} retrying={retrying} />
      )}

      {showSearch && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatSettingsNumber(locations.length)} locations · {formatSettingsNumber(activeCount)} available
          </p>
          <div className="w-full sm:w-56">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${noun} locations`}
              aria-label={`Search ${noun} locations`}
              className="h-8 rounded-xl text-sm"
            />
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <SettingsNoMatch size="compact" query={query} noun={`${noun} locations`} onClear={() => setQuery("")} />
      ) : (
        // The settings table surface every other v2 settings list uses
        // (promo codes, extras, holidays): a flat bordered box, no card
        // shadow inside a settings panel. Spelled out here rather than
        // rendered through `ListTable` because the body scrolls under the
        // sticky header past ~8 rows, which `ListTable` does not do.
        <div data-list-surface="settings" className={LIST_SETTINGS_SURFACE}>
          <div className={LOCATION_SCROLL_ROOT}>
            <Table aria-label={listName} className={cn("table-fixed", readOnly ? "min-w-[520px]" : "min-w-[680px]")}>
              <ListTableHeader>
                <ListHead className="w-[20%]">Name</ListHead>
                <ListHead>Address</ListHead>
                {/* The one money column: right, so the figures stack. */}
                <ListHead className="w-[13%] text-right">Fee</ListHead>
                <ListHead className="w-[13%]">Available</ListHead>
                {/* Trailing and right, as the actions column is on every other v2 list. */}
                {!readOnly && <ListHead className="w-[12.5rem] text-right">Actions</ListHead>}
              </ListTableHeader>
              <ListBody>
                {visible.map((location) => {
                  const fee = Number(location.delivery_fee);
                  const free = !Number.isFinite(fee) || fee === 0;
                  return (
                    <ListRow key={location.id} data-location-row={location.id}>
                      <ListCell>
                        <span title={location.name} className={cn("block truncate", LIST_CLASSES.text)}>
                          {location.name}
                        </span>
                      </ListCell>
                      <ListCell>
                        <span title={location.address} className="block truncate text-muted-foreground">
                          {location.address}
                        </span>
                      </ListCell>
                      <ListCell className="text-right">
                        <TabularValue negative={fee < 0}>{locationFeeLabel(location.delivery_fee, currencyCode)}</TabularValue>
                      </ListCell>
                      <ListCell>
                        <ListStatusText tone={location.is_active ? "success" : "muted"}>
                          {location.is_active ? "Available" : "Off"}
                        </ListStatusText>
                      </ListCell>
                      {!readOnly && (
                        <ListCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => onEdit(location)}
                              aria-label={`Edit ${location.name}`}
                              className={LOCATION_ACTION}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => onNoFee(location)}
                              disabled={free || writing}
                              aria-label={`Set no fee for ${location.name}`}
                              className={LOCATION_ACTION}
                            >
                              No fee
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => onDelete(location)}
                              aria-label={`Delete ${location.name}`}
                              className={LOCATION_ACTION_DANGER}
                            >
                              Delete
                            </Button>
                          </div>
                        </ListCell>
                      )}
                    </ListRow>
                  );
                })}
              </ListBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
