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
import { Loader2, MapPinned, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Switch } from "@/components/ui-v2/switch";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { SettingsPanel, SettingsRow, useSettingsPageSave } from "@/components/settings-v2/settings-kit";
import type { RegisterSectionSave } from "@/components/settings-v2/pricing-money-parts";
import {
  SettingsEmptyState,
  SettingsLoadError,
  SettingsNoMatch,
  SettingsSaveState,
  SettingsSectionSkeleton,
  TabularValue,
  TruncatedText,
  describeSaveError,
  formatSettingsMoney,
  formatSettingsNumber,
  settingsControlProps,
  useSettingsSaveStatus,
} from "@/components/settings-v2/section-states";
import type { LocationSettings, PickupLocation } from "@/hooks/use-pickup-locations";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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
 * (bordered, a title bar when `title`, one ~64px row per setting), so the page
 * does not jump when the real panel replaces it.
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
      className={cn("rounded-xl border bg-card", className)}
    >
      <span className="sr-only">{label}</span>
      {title && (
        <div aria-hidden="true" className="space-y-1.5 px-5 pt-4 pb-1">
          <Skeleton className="h-4 w-32 rounded-full" />
          <Skeleton className="h-3 w-72 max-w-full rounded-full" />
        </div>
      )}
      <div aria-hidden="true" className="divide-y">
        {Array.from({ length: Math.max(1, rows) }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 px-5 py-4 md:grid md:grid-cols-[minmax(0,420px)_minmax(0,1fr)] md:items-center md:gap-x-10"
          >
            <div className="min-w-0 space-y-1.5">
              <Skeleton className="h-3.5 w-24 rounded-full" />
              <Skeleton className="h-3 w-56 max-w-full rounded-full" />
              {descriptionLines === 2 && <Skeleton className="h-3 w-40 max-w-full rounded-full" />}
            </div>
            <Skeleton className="h-9 w-56 max-w-full shrink-0 rounded-3xl" />
          </div>
        ))}
      </div>
      {footer && (
        <div aria-hidden="true" className="flex items-center justify-end border-t px-5 py-3">
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

export interface GeneralSaveDeps {
  tenantId: string | null | undefined;
  values: GeneralSaveValues;
  policyVersionChanged: boolean;
  /** `tenants` update ending in `.select('id')`, so a zero-row (RLS) write is not read as success. */
  writeTenant: (patch: Record<string, unknown>) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
  /** The org-settings edge function. Its hook toasts its own failure. */
  writeOrg: (patch: { currency_code: string; distance_unit: "km" | "miles" }) => Promise<unknown>;
}

export const PARTIAL_GENERAL_SAVE_MESSAGE =
  "Only part of this change was saved, so some screens may still show the old setting. Retry to finish saving it.";

/** Marks an error whose toast has already been shown by a hook. */
export function isAlreadyToasted(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { alreadyToasted?: unknown }).alreadyToasted === true;
}

/**
 * The v2 General save. The `tenants` row (what TenantContext and every screen
 * read) is written FIRST and checked, so a failed or zero-row write throws
 * before anything reports success. v1 wrote the org settings first, whose hook
 * toasts "Settings Updated", and then only logged a failed tenants write.
 */
export async function saveGeneralSettingsV2({
  tenantId,
  values,
  policyVersionChanged,
  writeTenant,
  writeOrg,
}: GeneralSaveDeps): Promise<void> {
  if (!tenantId) {
    throw new Error("Your business details haven't loaded yet. Reload the page and try again.");
  }
  const { data, error } = await writeTenant({
    distance_unit: values.distance_unit,
    currency_code: values.currency_code,
    privacy_policy_version: values.privacy_policy_version,
    terms_version: values.terms_version,
    ...(policyVersionChanged ? { policies_accepted_at: null } : {}),
  });
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("You don't have permission to change these settings.");
  }
  try {
    await writeOrg({ currency_code: values.currency_code, distance_unit: values.distance_unit });
  } catch (orgError) {
    // The tenants row is already written, so say it was a partial save: a Retry
    // writes both again (the tenants write is idempotent) and finishes the job.
    // The org hook has toasted the transport failure itself.
    throw Object.assign(new Error(PARTIAL_GENERAL_SAVE_MESSAGE), { alreadyToasted: true, cause: orgError });
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
        <SettingsRow
          label="Currency"
          description="The symbol on prices, invoices and reports."
          htmlFor="v2_currency_code"
          note={
            unsupported ? (
              <p className="text-muted-foreground">
                Your currency is{" "}
                <span className="font-medium text-foreground">{form.currency_code || "not set"}</span>. It isn&apos;t
                one of the options here, so contact support if it needs to change.
              </p>
            ) : currencyChanged ? (
              <p className="text-amber-700 dark:text-amber-400">
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
            <SelectTrigger id="v2_currency_code" className="w-56 max-w-full">
              <SelectValue placeholder="Choose a currency" />
            </SelectTrigger>
            <SelectContent>
              {unsupported && form.currency_code && (
                <SelectItem value={form.currency_code} disabled>
                  {form.currency_code} (current)
                </SelectItem>
              )}
              <SelectItem value="USD">USD - US Dollar ($)</SelectItem>
              <SelectItem value="GBP">GBP - British Pound (£)</SelectItem>
              <SelectItem value="EUR">EUR - Euro (€)</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Distance unit" description="Used for mileage and delivery distances." htmlFor="v2_distance_unit">
          <Select
            value={form.distance_unit}
            onValueChange={(value: "km" | "miles") => onFormChange({ distance_unit: value })}
            disabled={!canEdit || saving}
          >
            <SelectTrigger id="v2_distance_unit" className="w-56 max-w-full">
              <SelectValue placeholder="Choose a unit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="miles">Miles</SelectItem>
              <SelectItem value="km">Kilometres</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsPanel>

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
  areaRadius: number | null;
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
  radius?: string;
  fee?: string;
  /** The price bands as a whole: none left, or two at the same distance. */
  bands?: string;
  /** One reason per invalid band, keyed by its index in `tiers`. */
  bandRows?: Record<number, string>;
  maxDistance?: string;
}

/**
 * Inline errors for the Area Settings fields. Empty when area delivery is off.
 * The price-band checks are v1's save-time checks (which only ever toasted),
 * shown beside the band instead.
 */
export function areaFieldErrors(f: LocationFormState, unitLabel: string): AreaFieldErrors {
  const out: AreaFieldErrors = {};
  if (!(f.pickupAreaEnabled || f.returnAreaEnabled)) return out;
  if (!f.areaCenterLat || !f.areaCenterLon) out.center = "Pick a center point from the address suggestions.";
  if (f.areaRadius == null || !Number.isFinite(f.areaRadius)) {
    out.radius = `Enter a radius of at least 1 ${unitLabel}.`;
  } else if (f.areaRadius < 1) {
    out.radius = `Radius must be at least 1 ${unitLabel}.`;
  }
  if (!f.deliveryTiersEnabled && f.areaDeliveryFee != null && f.areaDeliveryFee < 0) {
    out.fee = "Fee can't be negative.";
  }
  if (f.deliveryTiersEnabled) {
    if (f.tiers.length === 0) out.bands = "Add at least one price band, or turn off tiered pricing.";
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

/**
 * The first reason the form can't be saved, or null. Mirrors the v1 checks and
 * adds the ones v1 let through: a delivery/collection list with nothing active,
 * a zero/negative/blank radius (v1 silently saved 100) and a negative fee.
 * Active-location counts are `null` while the list is loading or failed.
 */
export function validateLocationSettingsV2(
  f: LocationFormState,
  ctx: { unitLabel: string; pickupActiveLocations: number | null; returnActiveLocations: number | null },
): string | null {
  if (!f.pickupFixedEnabled && !f.pickupMultipleEnabled && !f.pickupAreaEnabled) return "Turn on at least one pickup option.";
  if (!f.returnFixedEnabled && !f.returnMultipleEnabled && !f.returnAreaEnabled) return "Turn on at least one return option.";
  if (f.pickupFixedEnabled && !f.fixedPickupAddress.trim()) return "Enter your pickup address.";
  if (f.returnFixedEnabled && !f.sameReturnAddress && !f.fixedReturnAddress.trim()) return "Enter your return address.";
  if (f.pickupMultipleEnabled && ctx.pickupActiveLocations === 0) {
    return "Delivery locations is on but none are active. Add or switch on a location, or turn it off.";
  }
  if (f.returnMultipleEnabled && ctx.returnActiveLocations === 0) {
    return "Collection locations is on but none are active. Add or switch on a location, or turn it off.";
  }
  const area = areaFieldErrors(f, ctx.unitLabel);
  const firstBand = area.bandRows ? Number(Object.keys(area.bandRows)[0]) : null;
  const bandRow =
    firstBand !== null && area.bandRows
      ? `Price band "${bandLabel(f.tiers[firstBand], ctx.unitLabel)}": ${area.bandRows[firstBand]}`
      : undefined;
  return area.center ?? area.radius ?? area.fee ?? area.bands ?? bandRow ?? area.maxDistance ?? null;
}

/**
 * v1 markup inside the v2 Locations page tints icons and dialog glyphs with
 * `text-primary`. The v2 dark primary is a deep indigo that nearly disappears
 * on a dark card, so text-primary reads as a lighter indigo in dark mode there.
 */
export const LOCATIONS_V2_CLASS = "dark:[&_.text-primary]:text-indigo-300";

/** Phone layout and contrast for the Area Settings card, applied from a wrapper. */
export const AREA_SETTINGS_V2_CLASS = [
  // Price bands: the distance takes its own line, then fee and delete.
  "max-sm:[&_.space-y-3>div.gap-2]:flex-wrap",
  "max-sm:[&_.space-y-3>div.gap-2>.flex-1]:basis-full",
  "max-sm:[&_.space-y-3>div.gap-2>.w-32]:flex-1",
  // Maximum delivery distance: the explanation above a full-width input.
  "max-sm:[&_.space-y-3>div.border-t]:flex-col",
  "max-sm:[&_.space-y-3>div.border-t]:items-stretch",
  "max-sm:[&_.space-y-3>div.border-t>.w-32]:w-full",
  // amber-500 text is too faint on a light card.
  "[&_.text-amber-500]:text-amber-700",
  "dark:[&_.text-amber-500]:text-amber-400",
].join(" ");

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
  onAdd: () => void;
  onEdit: (location: PickupLocation) => void;
  onConfirmDelete: (id: string, name: string) => void;
  onToggleActive: (location: PickupLocation) => void;
  isUpdating: boolean;
  currencyCode: string;
  readOnly: boolean;
  /** The row whose delete is in flight: it shows "Deleting…" and can't be acted on. */
  pendingDeleteId?: string | null;
}

function IconAction({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          className={destructive ? "text-destructive hover:text-destructive" : undefined}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function LocationsListV2({
  side,
  locations,
  isLoading,
  error,
  onRetry,
  retrying,
  onAdd,
  onEdit,
  onConfirmDelete,
  onToggleActive,
  isUpdating,
  currencyCode,
  readOnly,
  pendingDeleteId = null,
}: LocationsListV2Props) {
  const [query, setQuery] = useState("");
  const noun = side === "pickup" ? "delivery" : "collection";

  if (isLoading && locations.length === 0) {
    return <SettingsSectionSkeleton variant="table" rows={2} columns={2} label={`Loading ${noun} locations`} />;
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
      <SettingsEmptyState
        variant="compact"
        icon={MapPinned}
        headline={`No ${noun} locations yet`}
        body={
          side === "pickup"
            ? "Places customers can choose for delivery at checkout, like an airport terminal or a hotel. Until you add one, they see an empty list."
            : "Places customers can choose for returning the car, like an airport terminal or a hotel. Until you add one, they see an empty list."
        }
        primaryAction={readOnly ? undefined : { label: "Add your first location", icon: Plus, onClick: onAdd }}
        footnote={readOnly ? undefined : "A location saves as soon as you add it."}
      />
    );
  }

  const activeCount = locations.filter((l) => l.is_active).length;
  const showSearch = locations.length > LOCATION_SEARCH_THRESHOLD;
  const visible = showSearch ? filterLocations(locations, query) : locations;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-3" data-settings-state="content">
        {!!error && (
          <SettingsLoadError variant="inline" thing={`${noun} locations`} error={error} onRetry={onRetry} retrying={retrying} />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatSettingsNumber(locations.length)} {locations.length === 1 ? "location" : "locations"} ·{" "}
            {formatSettingsNumber(activeCount)} active
          </p>
          {showSearch && (
            <div className="relative w-full sm:w-56">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${noun} locations`}
                aria-label={`Search ${noun} locations`}
                className="h-8 pl-8 text-sm"
              />
            </div>
          )}
        </div>

        {visible.length === 0 ? (
          <SettingsNoMatch size="compact" query={query} noun={`${noun} locations`} onClear={() => setQuery("")} />
        ) : (
          <ul
            aria-label={`${side === "pickup" ? "Delivery" : "Collection"} locations`}
            className="max-h-[22rem] space-y-2 overflow-y-auto overscroll-contain pr-1"
          >
            {visible.map((location) => {
              const fee = Number(location.delivery_fee);
              const free = !Number.isFinite(fee) || fee === 0;
              const deleting = pendingDeleteId === location.id;
              return (
                <li
                  key={location.id}
                  aria-busy={deleting || undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl bg-muted/50 px-3 py-2.5",
                    (!location.is_active || deleting) && "opacity-60",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <TruncatedText text={location.name} className="text-sm font-medium text-foreground" />
                      {free ? (
                        <span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400">Free</span>
                      ) : (
                        <TabularValue negative={fee < 0} className="shrink-0 text-xs font-medium">
                          {formatSettingsMoney(fee, currencyCode)}
                        </TabularValue>
                      )}
                    </div>
                    <TruncatedText text={location.address} className="text-xs text-muted-foreground" />
                    {location.description && (
                      <TruncatedText text={location.description} className="text-xs text-muted-foreground/80" />
                    )}
                  </div>
                  {deleting ? (
                    <span role="status" className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      Deleting…
                    </span>
                  ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={location.is_active}
                      onCheckedChange={() => onToggleActive(location)}
                      aria-label={`${location.is_active ? "Switch off" : "Switch on"} ${location.name}`}
                      {...settingsControlProps(!readOnly, isUpdating)}
                    />
                    {!readOnly && (
                      <>
                        <IconAction label={`Edit ${location.name}`} onClick={() => onEdit(location)}>
                          <Pencil />
                        </IconAction>
                        <IconAction
                          label={`Delete ${location.name}`}
                          destructive
                          onClick={() => onConfirmDelete(location.id, location.name)}
                        >
                          <Trash2 />
                        </IconAction>
                      </>
                    )}
                  </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!readOnly && (
          <Button type="button" variant="outline" size="sm" onClick={onAdd} className="w-full">
            <Plus data-icon="inline-start" />
            Add location
          </Button>
        )}
      </div>
    </TooltipProvider>
  );
}
