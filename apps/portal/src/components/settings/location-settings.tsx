'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { LocationAutocomplete } from '@/components/ui/location-autocomplete';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  MapPin,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Save,
  Building2,
  Navigation,
  RotateCcw,
  Truck,
  MapPinned,
  CircleDot,
  AlertTriangle,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  usePickupLocations,
  PickupLocation,
  DeliveryTier,
} from '@/hooks/use-pickup-locations';
import { useTenant } from '@/contexts/TenantContext';
import { cn } from '@/lib/utils';
import { useAuditLogOnOpen } from '@/hooks/use-audit-log-on-open';
import {
  formatCurrency,
  getCurrencySymbol,
  kmToDisplayUnit,
  displayUnitToKm,
  getDistanceUnitShort,
} from '@/lib/format-utils';
import type { DistanceUnit } from '@/lib/format-utils';
import { useV2 } from '@/lib/v2-context';
import { Button as ButtonV2 } from '@/components/ui-v2/button';
import {
  SettingsDependencyNotice,
  SettingsLoadError,
  SettingsReadOnlyFieldset,
  SettingsSaveState,
  SettingsSectionSkeleton,
  useSettingsAccess,
  useSettingsSaveStatus,
} from '@/components/settings-v2/section-states';
import {
  AREA_SETTINGS_V2_CLASS,
  LOCATION_NAME_MAX,
  LOCATION_TEXT_MAX,
  LocationsListV2,
  ScopeIf,
  areaFieldErrors,
  buildLocationPayload,
  isLocationFormDirty,
  locationFormFromSettings,
  validateLocationDraft,
  validateLocationSettingsV2,
  type LocationDraftErrors,
  type LocationFormState,
} from '@/components/settings-v2/business-settings-states';

interface LocationFormData {
  name: string;
  address: string;
  description: string;
  delivery_fee: number | null;
  is_pickup_enabled: boolean;
  is_return_enabled: boolean;
}

const EMPTY_FORM: LocationFormData = {
  name: '',
  address: '',
  description: '',
  delivery_fee: null,
  is_pickup_enabled: true,
  is_return_enabled: true,
};

interface LocationSettingsProps {
  onDirtyChange?: (dirty: boolean) => void;
  /** v2 (northwind): derived dirty state. The v2 page passes this instead of onDirtyChange. */
  onDirtyChangeV2?: (dirty: boolean) => void;
}

export function LocationSettings({ onDirtyChange, onDirtyChangeV2 }: LocationSettingsProps = {}) {
  const {
    locationSettings,
    isLoadingSettings,
    hasSettingsData,
    settingsError,
    refetchSettings,
    isFetchingSettings,
    settingsUpdateError,
    locationsError,
    refetchLocations,
    isFetchingLocations,
    updateSettings,
    isUpdatingSettings,
    locations,
    isLoadingLocations,
    createLocation,
    isCreating,
    updateLocation,
    isUpdating,
    deleteLocation,
    isDeleting,
  } = usePickupLocations();

  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'USD';
  const distanceUnit: DistanceUnit = (tenant?.distance_unit as DistanceUnit) || 'miles';
  const distanceUnitLabel = getDistanceUnitShort(distanceUnit);
  const currencySymbol = getCurrencySymbol(currencyCode);

  // v2 (northwind): the settings kit's states. Every other tenant keeps v1.
  const v2 = useV2('chrome');
  const { readOnly: v2ReadOnly } = useSettingsAccess('locations');
  const readOnly = v2 && v2ReadOnly;
  const [v2SaveMessage, setV2SaveMessage] = useState<string | null>(null);
  const [locationDraftErrors, setLocationDraftErrors] = useState<LocationDraftErrors>({});
  const [v2SyncedSettings, setV2SyncedSettings] = useState<typeof locationSettings | null>(null);

  // PICKUP options
  const [pickupFixedEnabled, setPickupFixedEnabled] = useState(true);
  const [pickupMultipleEnabled, setPickupMultipleEnabled] = useState(false);
  const [pickupAreaEnabled, setPickupAreaEnabled] = useState(false);

  // RETURN options
  const [returnFixedEnabled, setReturnFixedEnabled] = useState(true);
  const [returnMultipleEnabled, setReturnMultipleEnabled] = useState(false);
  const [returnAreaEnabled, setReturnAreaEnabled] = useState(false);

  // Fixed addresses
  const [fixedPickupAddress, setFixedPickupAddress] = useState('');
  const [fixedReturnAddress, setFixedReturnAddress] = useState('');
  const [sameReturnAddress, setSameReturnAddress] = useState(true);

  // Area settings
  const [areaRadius, setAreaRadius] = useState<number | null>(100);
  const [areaDeliveryFee, setAreaDeliveryFee] = useState<number | null>(0);
  const [areaCenterAddress, setAreaCenterAddress] = useState('');
  const [areaCenterLat, setAreaCenterLat] = useState<number | null>(null);
  const [areaCenterLon, setAreaCenterLon] = useState<number | null>(null);

  // Tiered (distance-banded) delivery pricing.
  // up_to is held in the tenant's DISPLAY unit (mi/km) for editing; converted to
  // km on save. up_to === null is the open-ended "anywhere further" band (last only).
  type TierRow = { up_to: number | null; fee: number };
  const [deliveryTiersEnabled, setDeliveryTiersEnabled] = useState(false);
  const [tiers, setTiers] = useState<TierRow[]>([]);
  // Optional hard cap on delivery distance (held in display unit; null = no limit).
  const [maxDeliveryDistance, setMaxDeliveryDistance] = useState<number | null>(null);

  const [hasChanges, setHasChanges] = useState(false);

  // Report dirty state to parent
  useEffect(() => {
    onDirtyChange?.(hasChanges);
  }, [hasChanges, onDirtyChange]);

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<PickupLocation | null>(null);
  const [formData, setFormData] = useState<LocationFormData>(EMPTY_FORM);
  const [dialogMode, setDialogMode] = useState<'pickup' | 'return'>('pickup');
  const [deleteLocationId, setDeleteLocationId] = useState<string | null>(null);
  const [deleteLocationName, setDeleteLocationName] = useState<string>('');

  useAuditLogOnOpen({
    open: !!deleteLocationId,
    action: "location_delete_warning_shown",
    entityType: "settings",
    entityId: deleteLocationId,
  });

  // Sync local state with fetched settings
  useEffect(() => {
    if (locationSettings) {
      // Use the new separate columns
      setPickupFixedEnabled(locationSettings.pickup_fixed_enabled ?? true);
      setPickupMultipleEnabled(locationSettings.pickup_multiple_locations_enabled ?? false);
      setPickupAreaEnabled(locationSettings.pickup_area_enabled ?? false);
      setReturnFixedEnabled(locationSettings.return_fixed_enabled ?? true);
      setReturnMultipleEnabled(locationSettings.return_multiple_locations_enabled ?? false);
      setReturnAreaEnabled(locationSettings.return_area_enabled ?? false);
      setFixedPickupAddress(locationSettings.fixed_pickup_address || '');
      setFixedReturnAddress(locationSettings.fixed_return_address || '');
      setSameReturnAddress(
        !locationSettings.fixed_return_address ||
        locationSettings.fixed_return_address === locationSettings.fixed_pickup_address
      );
      setAreaRadius(locationSettings.pickup_area_radius_km != null ? kmToDisplayUnit(locationSettings.pickup_area_radius_km, distanceUnit) : 100);
      setAreaDeliveryFee(locationSettings.area_delivery_fee ?? 0);
      setDeliveryTiersEnabled(locationSettings.delivery_tiers_enabled ?? false);
      setTiers(
        (locationSettings.delivery_distance_tiers ?? []).map((t) => ({
          up_to: t.up_to_km == null ? null : kmToDisplayUnit(t.up_to_km, distanceUnit),
          fee: t.fee,
        }))
      );
      setMaxDeliveryDistance(
        locationSettings.delivery_max_distance_km != null
          ? kmToDisplayUnit(locationSettings.delivery_max_distance_km, distanceUnit)
          : null
      );
      setAreaCenterLat(locationSettings.area_center_lat);
      setAreaCenterLon(locationSettings.area_center_lon);
      if (locationSettings.area_center_lat && locationSettings.area_center_lon && !areaCenterAddress) {
        setAreaCenterAddress(`${locationSettings.area_center_lat.toFixed(4)}, ${locationSettings.area_center_lon.toFixed(4)}`);
      }
      setHasChanges(false);
    }
  }, [locationSettings]);

  useEffect(() => {
    if (!locationSettings) return;
    setHasChanges(true);
  }, [pickupFixedEnabled, pickupMultipleEnabled, pickupAreaEnabled, returnFixedEnabled, returnMultipleEnabled, returnAreaEnabled, fixedPickupAddress, fixedReturnAddress, sameReturnAddress, areaRadius, areaDeliveryFee, areaCenterLat, areaCenterLon, deliveryTiersEnabled, tiers, maxDeliveryDistance]);

  // v2: dirty is DERIVED from stored vs local values. The effect above marks the
  // form dirty on mount and after every sync, so v1 always looked unsaved.
  // `v2SyncedSettings` trails the sync effect by one commit, so the render where
  // fresh data has arrived but local state hasn't caught up isn't an "edit".
  useEffect(() => {
    if (v2) setV2SyncedSettings(locationSettings);
  }, [v2, locationSettings]);
  const v2Form: LocationFormState = {
    pickupFixedEnabled, pickupMultipleEnabled, pickupAreaEnabled,
    returnFixedEnabled, returnMultipleEnabled, returnAreaEnabled,
    fixedPickupAddress, fixedReturnAddress, sameReturnAddress,
    areaRadius, areaDeliveryFee, areaCenterLat, areaCenterLon,
    deliveryTiersEnabled, tiers, maxDeliveryDistance,
  };
  const v2Dirty =
    v2 &&
    hasSettingsData &&
    v2SyncedSettings === locationSettings &&
    isLocationFormDirty(v2Form, locationFormFromSettings(locationSettings, (km) => kmToDisplayUnit(km, distanceUnit)));
  useEffect(() => {
    if (v2) onDirtyChangeV2?.(v2Dirty);
  }, [v2, v2Dirty, onDirtyChangeV2]);
  const v2AreaErrors = v2 ? areaFieldErrors(v2Form, distanceUnitLabel) : {};
  const v2SaveStatus = useSettingsSaveStatus({
    isDirty: v2Dirty,
    isPending: isUpdatingSettings,
    error: v2SaveMessage ?? settingsUpdateError,
  });
  const v2FormKey = v2 ? JSON.stringify(v2Form) : '';
  useEffect(() => {
    setV2SaveMessage(null);
  }, [v2FormKey]);

  const pickupLocations = locations.filter(loc => loc.is_pickup_enabled);
  const returnLocations = locations.filter(loc => loc.is_return_enabled);

  // Handlers to ensure at least one option is always selected
  const handlePickupFixedChange = (checked: boolean) => {
    if (!checked && !pickupMultipleEnabled && !pickupAreaEnabled) {
      // Can't disable - it's the only option enabled, keep it on
      toast({ title: 'Required', description: 'At least one pickup option must be enabled.', variant: 'destructive' });
      return;
    }
    setPickupFixedEnabled(checked);
    setHasChanges(true);
  };

  const handlePickupMultipleChange = (checked: boolean) => {
    if (!checked && !pickupFixedEnabled && !pickupAreaEnabled) {
      // Last option being disabled - enable fixed address as default
      setPickupFixedEnabled(true);
    }
    setPickupMultipleEnabled(checked);
    setHasChanges(true);
  };

  const handlePickupAreaChange = (checked: boolean) => {
    if (!checked && !pickupFixedEnabled && !pickupMultipleEnabled) {
      // Last option being disabled - enable fixed address as default
      setPickupFixedEnabled(true);
    }
    setPickupAreaEnabled(checked);
    setHasChanges(true);
  };

  const handleReturnFixedChange = (checked: boolean) => {
    if (!checked && !returnMultipleEnabled && !returnAreaEnabled) {
      // Can't disable - it's the only option enabled, keep it on
      toast({ title: 'Required', description: 'At least one return option must be enabled.', variant: 'destructive' });
      return;
    }
    setReturnFixedEnabled(checked);
    setHasChanges(true);
  };

  const handleReturnMultipleChange = (checked: boolean) => {
    if (!checked && !returnFixedEnabled && !returnAreaEnabled) {
      // Last option being disabled - enable fixed address as default
      setReturnFixedEnabled(true);
    }
    setReturnMultipleEnabled(checked);
    setHasChanges(true);
  };

  const handleReturnAreaChange = (checked: boolean) => {
    if (!checked && !returnFixedEnabled && !returnMultipleEnabled) {
      // Last option being disabled - enable fixed address as default
      setReturnFixedEnabled(true);
    }
    setReturnAreaEnabled(checked);
    setHasChanges(true);
  };

  const handleSaveSettings = async () => {
    if (!pickupFixedEnabled && !pickupMultipleEnabled && !pickupAreaEnabled) {
      toast({ title: 'Error', description: 'Enable at least one pickup option.', variant: 'destructive' });
      return;
    }
    if (!returnFixedEnabled && !returnMultipleEnabled && !returnAreaEnabled) {
      toast({ title: 'Error', description: 'Enable at least one return option.', variant: 'destructive' });
      return;
    }
    if (pickupFixedEnabled && !fixedPickupAddress.trim()) {
      toast({ title: 'Error', description: 'Enter the fixed pickup address.', variant: 'destructive' });
      return;
    }
    if (returnFixedEnabled && !sameReturnAddress && !fixedReturnAddress.trim()) {
      toast({ title: 'Error', description: 'Enter the fixed return address.', variant: 'destructive' });
      return;
    }
    const areaUsed = pickupAreaEnabled || returnAreaEnabled;
    if (areaUsed && (!areaCenterLat || !areaCenterLon)) {
      toast({ title: 'Error', description: 'Set the center point for area delivery.', variant: 'destructive' });
      return;
    }

    // Validate tiered pricing bands and convert display units → km
    const tiersActive = areaUsed && deliveryTiersEnabled;
    let tiersForSave: DeliveryTier[] = [];
    let maxDistanceForSave: number | null = null;
    if (tiersActive) {
      if (tiers.length === 0) {
        toast({ title: 'Error', description: 'Add at least one delivery price band, or turn off tiered pricing.', variant: 'destructive' });
        return;
      }
      const bounded = tiers.filter((t) => t.up_to !== null);
      for (const t of tiers) {
        if (!Number.isFinite(t.fee) || t.fee < 0) {
          toast({ title: 'Error', description: 'Each band needs a valid fee.', variant: 'destructive' });
          return;
        }
        if (t.up_to !== null && (!Number.isFinite(t.up_to) || t.up_to <= 0)) {
          toast({ title: 'Error', description: 'Each distance band needs a positive distance.', variant: 'destructive' });
          return;
        }
      }
      // bounded distances must be strictly ascending
      const sortedBounded = [...bounded].sort((a, b) => (a.up_to as number) - (b.up_to as number));
      for (let i = 1; i < sortedBounded.length; i++) {
        if ((sortedBounded[i].up_to as number) <= (sortedBounded[i - 1].up_to as number)) {
          toast({ title: 'Error', description: 'Band distances must increase (e.g. 20, then 40).', variant: 'destructive' });
          return;
        }
      }
      tiersForSave = tiers.map((t) => ({
        up_to_km: t.up_to === null ? null : displayUnitToKm(t.up_to, distanceUnit),
        fee: t.fee,
      }));

      // Optional hard cap on delivery distance.
      if (maxDeliveryDistance != null) {
        if (!Number.isFinite(maxDeliveryDistance) || maxDeliveryDistance <= 0) {
          toast({ title: 'Error', description: 'Maximum delivery distance must be a positive number, or leave it blank.', variant: 'destructive' });
          return;
        }
        const furthestBounded = bounded.reduce((max, t) => Math.max(max, t.up_to as number), 0);
        if (furthestBounded > 0 && maxDeliveryDistance < furthestBounded) {
          toast({ title: 'Error', description: 'Maximum delivery distance must be at least your furthest price band.', variant: 'destructive' });
          return;
        }
        maxDistanceForSave = displayUnitToKm(maxDeliveryDistance, distanceUnit);
      }
    }

    try {
      await updateSettings({
        // Legacy combined flags (for backwards compatibility)
        fixed_address_enabled: pickupFixedEnabled || returnFixedEnabled,
        multiple_locations_enabled: pickupMultipleEnabled || returnMultipleEnabled,
        area_around_enabled: pickupAreaEnabled || returnAreaEnabled,
        // Separate pickup/return settings
        pickup_fixed_enabled: pickupFixedEnabled,
        return_fixed_enabled: returnFixedEnabled,
        pickup_multiple_locations_enabled: pickupMultipleEnabled,
        return_multiple_locations_enabled: returnMultipleEnabled,
        pickup_area_enabled: pickupAreaEnabled,
        return_area_enabled: returnAreaEnabled,
        // Addresses and area settings
        fixed_pickup_address: pickupFixedEnabled ? fixedPickupAddress : null,
        fixed_return_address: returnFixedEnabled ? (sameReturnAddress ? fixedPickupAddress : fixedReturnAddress) : null,
        pickup_area_radius_km: areaUsed ? displayUnitToKm(areaRadius ?? 100, distanceUnit) : null,
        return_area_radius_km: areaUsed ? displayUnitToKm(areaRadius ?? 100, distanceUnit) : null,
        area_delivery_fee: areaUsed ? (areaDeliveryFee ?? 0) : 0,
        area_center_lat: areaUsed ? areaCenterLat : null,
        area_center_lon: areaUsed ? areaCenterLon : null,
        delivery_tiers_enabled: tiersActive,
        delivery_distance_tiers: tiersForSave,
        delivery_max_distance_km: maxDistanceForSave,
      });
      setHasChanges(false);
    } catch (error) {}
  };

  // ---- Tiered pricing row helpers ----
  const boundedTiers = tiers.filter((t) => t.up_to !== null);
  const hasOpenBand = tiers.some((t) => t.up_to === null);

  const addBand = () => {
    const lastBound = boundedTiers.reduce((max, t) => Math.max(max, t.up_to as number), 0);
    const newRow: TierRow = { up_to: lastBound + 10, fee: areaDeliveryFee ?? 0 };
    // keep the open-ended band (if any) at the end
    setTiers((prev) => {
      const open = prev.filter((t) => t.up_to === null);
      const bounded = prev.filter((t) => t.up_to !== null);
      return [...bounded, newRow, ...open];
    });
    setHasChanges(true);
  };

  const removeBand = (index: number) => {
    setTiers((prev) => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const updateBand = (index: number, patch: Partial<TierRow>) => {
    setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
    setHasChanges(true);
  };

  const toggleOpenBand = (checked: boolean) => {
    setTiers((prev) => {
      const bounded = prev.filter((t) => t.up_to !== null);
      if (checked) {
        const existingOpen = prev.find((t) => t.up_to === null);
        return [...bounded, existingOpen ?? { up_to: null, fee: areaDeliveryFee ?? 0 }];
      }
      return bounded;
    });
    setHasChanges(true);
  };

  const handleCenterAddressChange = (address: string, lat?: number, lon?: number) => {
    setAreaCenterAddress(address);
    if (lat !== undefined && lon !== undefined) {
      setAreaCenterLat(lat);
      setAreaCenterLon(lon);
    }
    setHasChanges(true);
  };

  const handleOpenAddDialog = (mode: 'pickup' | 'return') => {
    if (v2) setLocationDraftErrors({});
    setEditingLocation(null);
    setDialogMode(mode);
    setFormData({
      ...EMPTY_FORM,
      is_pickup_enabled: mode === 'pickup',
      is_return_enabled: mode === 'return',
    });
    setIsDialogOpen(true);
  };

  const handleOpenEditDialog = (location: PickupLocation, mode: 'pickup' | 'return') => {
    if (v2) setLocationDraftErrors({});
    setEditingLocation(location);
    setDialogMode(mode);
    setFormData({
      name: location.name,
      address: location.address,
      description: location.description || '',
      delivery_fee: location.delivery_fee,
      is_pickup_enabled: location.is_pickup_enabled,
      is_return_enabled: location.is_return_enabled,
    });
    setIsDialogOpen(true);
  };

  // v2: inline field errors, fees rounded to cents, and an EDIT that keeps the
  // location's pickup/return flags (v1 forced them to the dialog's side, which
  // silently dropped a dual-purpose location from the other list).
  const saveLocationV2 = async () => {
    const errors = validateLocationDraft(formData);
    setLocationDraftErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const payload = buildLocationPayload(formData, { editing: !!editingLocation, mode: dialogMode });
    try {
      if (editingLocation) {
        await updateLocation({ id: editingLocation.id, ...payload });
      } else {
        await createLocation(payload);
      }
      setIsDialogOpen(false);
      setFormData(EMPTY_FORM);
      setEditingLocation(null);
    } catch (error) {}
  };

  const handleSaveLocation = async () => {
    if (v2) return saveLocationV2();
    if (!formData.name.trim() || !formData.address.trim()) {
      toast({ title: 'Error', description: 'Enter both name and address.', variant: 'destructive' });
      return;
    }
    try {
      // Set flags based on dialog mode
      const locationData = {
        name: formData.name.trim(),
        address: formData.address.trim(),
        description: formData.description.trim() || null,
        delivery_fee: formData.delivery_fee ?? 0,
        is_pickup_enabled: dialogMode === 'pickup',
        is_return_enabled: dialogMode === 'return',
      };

      if (editingLocation) {
        await updateLocation({
          id: editingLocation.id,
          ...locationData,
        });
      } else {
        await createLocation(locationData);
      }
      setIsDialogOpen(false);
      setFormData(EMPTY_FORM);
      setEditingLocation(null);
    } catch (error) {}
  };

  const handleDeleteLocation = async (id: string) => {
    try { await deleteLocation(id); } catch (error) {}
  };

  const handleToggleActive = async (location: PickupLocation) => {
    try { await updateLocation({ id: location.id, is_active: !location.is_active }); } catch (error) {}
  };

  // v2: check what v1 doesn't (a missing active location, the radius and fee)
  // and say why inline, beside Save, before the v1 save runs its own checks.
  const handleSaveSettingsV2 = async () => {
    const listUnknown = isLoadingLocations || !!locationsError;
    const message = validateLocationSettingsV2(v2Form, {
      unitLabel: distanceUnitLabel,
      pickupActiveLocations: listUnknown ? null : pickupLocations.filter((l) => l.is_active).length,
      returnActiveLocations: listUnknown ? null : returnLocations.filter((l) => l.is_active).length,
    });
    setV2SaveMessage(message);
    if (message) return;
    await handleSaveSettings();
  };

  // v2: never render the placeholder defaults as the tenant's setup. A failed
  // read offers a retry instead of a form whose Save would overwrite it.
  if (v2 && !hasSettingsData && settingsError) {
    return (
      <SettingsLoadError
        thing="your pickup and return settings"
        error={settingsError}
        onRetry={refetchSettings}
        retrying={isFetchingSettings}
      />
    );
  }
  if (v2 && !hasSettingsData) {
    return (
      <div className="grid gap-6 xl:grid-cols-2">
        <SettingsSectionSkeleton variant="form" rows={3} header label="Loading pickup options" />
        <SettingsSectionSkeleton variant="form" rows={3} header label="Loading return options" />
      </div>
    );
  }

  if (isLoadingSettings) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ScopeIf on={v2} wrap={(children) => <SettingsReadOnlyFieldset readOnly={readOnly}>{children}</SettingsReadOnlyFieldset>}>
    <div className="space-y-6">
      {v2 && settingsError && hasSettingsData && (
        <SettingsLoadError
          variant="inline"
          thing="your pickup and return settings"
          error={settingsError}
          onRetry={refetchSettings}
          retrying={isFetchingSettings}
        />
      )}
      {/* Two Column Layout for Pickup & Return */}
      <div className="grid xl:grid-cols-2 gap-6">
        {/* PICKUP OPTIONS CARD */}
        <Card className="overflow-hidden flex flex-col">
          <div className="bg-muted/30 border-b px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <Truck className="h-5 w-5 text-foreground" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Pickup Options</h2>
                <p className="text-muted-foreground text-sm">How customers receive vehicles</p>
              </div>
            </div>
          </div>
          <CardContent className="p-0 flex-1 flex flex-col">
            {/* Fixed Address */}
            <div className={cn(
              "p-5 border-b transition-colors xl:min-h-[180px]",
              pickupFixedEnabled && "bg-muted/20"
            )}>
              <div className="flex items-start justify-between gap-3 sm:gap-4">
                <div className="flex gap-3 min-w-0">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    pickupFixedEnabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-foreground/50"
                  )}>
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold text-sm">Your Location</span>
                      <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        Free
                      </span>
                      <span className={cn(
                        "text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full",
                        pickupFixedEnabled
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      )}>
                        {pickupFixedEnabled ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">Customer picks up at your address</p>
                  </div>
                </div>
                <Switch
                  checked={pickupFixedEnabled}
                  onCheckedChange={handlePickupFixedChange}
                />
              </div>
              {pickupFixedEnabled && (
                <div className="mt-4 pl-3 sm:pl-[52px]">
                  <LocationAutocomplete
                    value={fixedPickupAddress}
                    onChange={(v) => { setFixedPickupAddress(v); setHasChanges(true); }}
                    placeholder="Enter your pickup address..."
                    className="text-sm"
                    v2States={v2}
                  />
                  {v2 && !fixedPickupAddress.trim() && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Customers see no pickup address until you add one here.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Predefined Locations */}
            <div className={cn(
              "p-5 border-b transition-colors flex-1",
              pickupMultipleEnabled && "bg-muted/20"
            )}>
              <div className="flex items-start justify-between gap-3 sm:gap-4">
                <div className="flex gap-3 min-w-0">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    pickupMultipleEnabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-foreground/50"
                  )}>
                    <MapPinned className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold text-sm">Delivery Locations</span>
                      <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        Paid
                      </span>
                      <span className={cn(
                        "text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full",
                        pickupMultipleEnabled
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      )}>
                        {pickupMultipleEnabled ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">Deliver to predefined spots</p>
                  </div>
                </div>
                <Switch
                  checked={pickupMultipleEnabled}
                  onCheckedChange={handlePickupMultipleChange}
                />
              </div>
              {pickupMultipleEnabled && (
                <div className="mt-4 pl-3 sm:pl-[52px]">
                  {v2 ? (
                    <div className="space-y-3">
                      {!isLoadingLocations && !locationsError && pickupLocations.length > 0 && !pickupLocations.some((l) => l.is_active) && (
                        <SettingsDependencyNotice
                          tone="warning"
                          title="No active delivery locations"
                          body="Customers will see an empty list. Switch a location on, or turn this option off."
                        />
                      )}
                      <LocationsListV2
                        side="pickup"
                        locations={pickupLocations}
                        isLoading={isLoadingLocations}
                        error={locationsError}
                        onRetry={refetchLocations}
                        retrying={isFetchingLocations}
                        onAdd={() => handleOpenAddDialog('pickup')}
                        onEdit={(loc) => handleOpenEditDialog(loc, 'pickup')}
                        onConfirmDelete={(id, name) => { setDeleteLocationId(id); setDeleteLocationName(name); }}
                        onToggleActive={handleToggleActive}
                        isUpdating={isUpdating}
                        currencyCode={currencyCode}
                        readOnly={readOnly}
                      />
                    </div>
                  ) : (
                  <LocationsGrid
                    locations={pickupLocations}
                    onAdd={() => handleOpenAddDialog('pickup')}
                    onEdit={(loc) => handleOpenEditDialog(loc, 'pickup')}
                    onDelete={handleDeleteLocation}
                    onConfirmDelete={(id, name) => { setDeleteLocationId(id); setDeleteLocationName(name); }}
                    onToggleActive={handleToggleActive}
                    isUpdating={isUpdating}
                    currencyCode={currencyCode}
                  />
                  )}
                </div>
              )}
            </div>

            {/* Area Delivery */}
            <div className={cn(
              "p-5 transition-colors xl:min-h-[88px]",
              pickupAreaEnabled && "bg-muted/20"
            )}>
              <div className="flex items-start justify-between gap-3 sm:gap-4">
                <div className="flex gap-3 min-w-0">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    pickupAreaEnabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-foreground/50"
                  )}>
                    <CircleDot className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold text-sm">Area Delivery</span>
                      <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        Paid
                      </span>
                      <span className={cn(
                        "text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full",
                        pickupAreaEnabled
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      )}>
                        {pickupAreaEnabled ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">Deliver anywhere within radius</p>
                  </div>
                </div>
                <Switch
                  checked={pickupAreaEnabled}
                  onCheckedChange={handlePickupAreaChange}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* RETURN OPTIONS CARD */}
        <Card className="overflow-hidden flex flex-col">
          <div className="bg-muted/30 border-b px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <RotateCcw className="h-5 w-5 text-foreground" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Return Options</h2>
                <p className="text-muted-foreground text-sm">How customers return vehicles</p>
              </div>
            </div>
          </div>
          <CardContent className="p-0 flex-1 flex flex-col">
            {/* Fixed Address */}
            <div className={cn(
              "p-5 border-b transition-colors xl:min-h-[180px]",
              returnFixedEnabled && "bg-muted/20"
            )}>
              <div className="flex items-start justify-between gap-3 sm:gap-4">
                <div className="flex gap-3 min-w-0">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    returnFixedEnabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-foreground/50"
                  )}>
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold text-sm">Your Location</span>
                      <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        Free
                      </span>
                      <span className={cn(
                        "text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full",
                        returnFixedEnabled
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      )}>
                        {returnFixedEnabled ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">Customer returns at your address</p>
                  </div>
                </div>
                <Switch
                  checked={returnFixedEnabled}
                  onCheckedChange={handleReturnFixedChange}
                />
              </div>
              {returnFixedEnabled && (
                <div className="mt-4 pl-3 sm:pl-[52px] space-y-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={sameReturnAddress}
                      onCheckedChange={(c) => { setSameReturnAddress(c as boolean); setHasChanges(true); }}
                    />
                    <span className="text-muted-foreground">Same as pickup address</span>
                  </label>
                  {!sameReturnAddress && (
                    <LocationAutocomplete
                      value={fixedReturnAddress}
                      onChange={(v) => { setFixedReturnAddress(v); setHasChanges(true); }}
                      placeholder="Enter return address..."
                      className="text-sm"
                      v2States={v2}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Predefined Locations */}
            <div className={cn(
              "p-5 border-b transition-colors flex-1",
              returnMultipleEnabled && "bg-muted/20"
            )}>
              <div className="flex items-start justify-between gap-3 sm:gap-4">
                <div className="flex gap-3 min-w-0">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    returnMultipleEnabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-foreground/50"
                  )}>
                    <MapPinned className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold text-sm">Collection Locations</span>
                      <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        Paid
                      </span>
                      <span className={cn(
                        "text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full",
                        returnMultipleEnabled
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      )}>
                        {returnMultipleEnabled ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">Collect from predefined spots</p>
                  </div>
                </div>
                <Switch
                  checked={returnMultipleEnabled}
                  onCheckedChange={handleReturnMultipleChange}
                />
              </div>
              {returnMultipleEnabled && (
                <div className="mt-4 pl-3 sm:pl-[52px]">
                  {v2 ? (
                    <div className="space-y-3">
                      {!isLoadingLocations && !locationsError && returnLocations.length > 0 && !returnLocations.some((l) => l.is_active) && (
                        <SettingsDependencyNotice
                          tone="warning"
                          title="No active collection locations"
                          body="Customers will see an empty list. Switch a location on, or turn this option off."
                        />
                      )}
                      <LocationsListV2
                        side="return"
                        locations={returnLocations}
                        isLoading={isLoadingLocations}
                        error={locationsError}
                        onRetry={refetchLocations}
                        retrying={isFetchingLocations}
                        onAdd={() => handleOpenAddDialog('return')}
                        onEdit={(loc) => handleOpenEditDialog(loc, 'return')}
                        onConfirmDelete={(id, name) => { setDeleteLocationId(id); setDeleteLocationName(name); }}
                        onToggleActive={handleToggleActive}
                        isUpdating={isUpdating}
                        currencyCode={currencyCode}
                        readOnly={readOnly}
                      />
                    </div>
                  ) : (
                  <LocationsGrid
                    locations={returnLocations}
                    onAdd={() => handleOpenAddDialog('return')}
                    onEdit={(loc) => handleOpenEditDialog(loc, 'return')}
                    onDelete={handleDeleteLocation}
                    onConfirmDelete={(id, name) => { setDeleteLocationId(id); setDeleteLocationName(name); }}
                    onToggleActive={handleToggleActive}
                    isUpdating={isUpdating}
                    currencyCode={currencyCode}
                  />
                  )}
                </div>
              )}
            </div>

            {/* Area Collection */}
            <div className={cn(
              "p-5 transition-colors xl:min-h-[88px]",
              returnAreaEnabled && "bg-muted/20"
            )}>
              <div className="flex items-start justify-between gap-3 sm:gap-4">
                <div className="flex gap-3 min-w-0">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    returnAreaEnabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-foreground/50"
                  )}>
                    <CircleDot className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold text-sm">Area Collection</span>
                      <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        Paid
                      </span>
                      <span className={cn(
                        "text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full",
                        returnAreaEnabled
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      )}>
                        {returnAreaEnabled ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">Collect from anywhere within radius</p>
                  </div>
                </div>
                <Switch
                  checked={returnAreaEnabled}
                  onCheckedChange={handleReturnAreaChange}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AREA SETTINGS */}
      {(pickupAreaEnabled || returnAreaEnabled) && (
        <ScopeIf on={v2} wrap={(children) => <div className={AREA_SETTINGS_V2_CLASS}>{children}</div>}>
        <Card>
          <div className="bg-muted/30 border-b px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <Navigation className="h-5 w-5 text-foreground" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Area Settings</h2>
                <p className="text-muted-foreground text-sm">Configure delivery radius and fees</p>
              </div>
            </div>
          </div>
          <CardContent className="p-6">
            <div className="grid md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-2">
                <Label className="text-sm font-medium">Service Center Point</Label>
                <LocationAutocomplete
                  value={areaCenterAddress}
                  onChange={handleCenterAddressChange}
                  placeholder="Search for center location..."
                  v2States={v2}
                />
                {areaCenterLat && areaCenterLon && (
                  <p className="text-xs text-muted-foreground">
                    Coordinates: {areaCenterLat.toFixed(4)}, {areaCenterLon.toFixed(4)}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Radius</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={areaRadius ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') {
                          setAreaRadius(null);
                        } else {
                          const hardMax = Math.floor(kmToDisplayUnit(1000, distanceUnit));
                          const num = parseInt(val) || null;
                          setAreaRadius(num && num > hardMax ? hardMax : num);
                        }
                        setHasChanges(true);
                      }}
                      className="pr-10"
                      min={1}
                      max={Math.floor(kmToDisplayUnit(1000, distanceUnit))}
                      placeholder="50"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{distanceUnitLabel}</span>
                  </div>
                  {v2AreaErrors.radius && (
                    <p role="alert" className="text-xs text-destructive">{v2AreaErrors.radius}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Fee</Label>
                  {deliveryTiersEnabled ? (
                    <div className="flex items-center h-10 px-3 rounded-md border bg-muted/40 text-xs text-muted-foreground">
                      Set by distance bands below
                    </div>
                  ) : (
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{currencySymbol}</span>
                      <Input
                        type="number"
                        value={areaDeliveryFee ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setAreaDeliveryFee(val === '' ? null : parseFloat(val) || null);
                          setHasChanges(true);
                        }}
                        className="pl-7"
                        min={0}
                        step={0.01}
                        placeholder="0"
                      />
                    </div>
                  )}
                  {v2AreaErrors.fee && (
                    <p role="alert" className="text-xs text-destructive">{v2AreaErrors.fee}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Tiered (distance-banded) pricing */}
            <div className="mt-6 rounded-lg border">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-muted/20">
                <div>
                  <p className="text-sm font-medium">Tiered pricing by distance</p>
                  <p className="text-xs text-muted-foreground">Charge more the further you deliver, instead of one flat fee.</p>
                </div>
                <Switch
                  checked={deliveryTiersEnabled}
                  onCheckedChange={(checked) => {
                    setDeliveryTiersEnabled(checked);
                    // seed a sensible first band the first time it's turned on
                    if (checked && tiers.length === 0) {
                      setTiers([{ up_to: 20, fee: areaDeliveryFee ?? 0 }, { up_to: null, fee: (areaDeliveryFee ?? 0) + 25 }]);
                    }
                    setHasChanges(true);
                  }}
                />
              </div>

              {deliveryTiersEnabled && (
                <div className="p-4 space-y-3">
                  {tiers.map((tier, index) => (
                    <div key={index} className="flex items-center gap-2">
                      {tier.up_to === null ? (
                        <div className="flex-1 flex items-center h-10 px-3 rounded-md border bg-muted/30 text-sm text-foreground">
                          Anywhere further
                        </div>
                      ) : (
                        <div className="flex-1 relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Up to</span>
                          <Input
                            type="number"
                            value={tier.up_to ?? ''}
                            onChange={(e) => updateBand(index, { up_to: e.target.value === '' ? 0 : parseFloat(e.target.value) || 0 })}
                            className="pl-12 pr-10"
                            min={1}
                            placeholder="20"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{distanceUnitLabel}</span>
                        </div>
                      )}
                      <span className="text-muted-foreground text-sm">→</span>
                      <div className="relative w-32">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{currencySymbol}</span>
                        <Input
                          type="number"
                          value={Number.isFinite(tier.fee) ? tier.fee : ''}
                          onChange={(e) => updateBand(index, { fee: e.target.value === '' ? 0 : parseFloat(e.target.value) || 0 })}
                          className="pl-7"
                          min={0}
                          step={0.01}
                          placeholder="0"
                        />
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeBand(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}

                  <div className="flex items-center justify-between pt-1">
                    <Button type="button" variant="outline" size="sm" onClick={addBand}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Add band
                    </Button>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <Checkbox checked={hasOpenBand} onCheckedChange={(c) => toggleOpenBand(!!c)} />
                      Charge a flat fee for anywhere beyond the last band
                    </label>
                  </div>

                  {/* Optional hard cap on delivery distance */}
                  <div className="flex items-center justify-between gap-3 pt-2 mt-1 border-t">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Maximum delivery distance</p>
                      <p className="text-xs text-muted-foreground">
                        Beyond this we won&apos;t deliver — those addresses can&apos;t be booked. Leave blank for no limit.
                      </p>
                    </div>
                    <div className="relative w-32 shrink-0">
                      <Input
                        type="number"
                        value={maxDeliveryDistance ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMaxDeliveryDistance(val === '' ? null : parseFloat(val) || null);
                          setHasChanges(true);
                        }}
                        className="pr-10"
                        min={1}
                        placeholder="None"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{distanceUnitLabel}</span>
                    </div>
                  </div>

                  {!hasOpenBand && maxDeliveryDistance == null && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-[11px] text-amber-500 leading-relaxed">
                        Without an open-ended band, your furthest band is the limit — addresses beyond it can&apos;t be booked for delivery.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {(areaRadius ?? 0) > Math.floor(kmToDisplayUnit(50, distanceUnit)) && (
              <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-500 leading-relaxed">
                  For best results, keep the radius below <strong>{Math.floor(kmToDisplayUnit(50, distanceUnit))}{distanceUnitLabel}</strong>. Radii within this limit use Google&apos;s location-aware suggestions for more accurate address results. Larger areas fall back to distance-based filtering.
                </p>
              </div>
            )}

            <div className="mt-4 p-3 rounded-lg bg-muted/50 border">
              <p className="text-sm text-muted-foreground">
                Customers can enter any address {deliveryTiersEnabled ? 'measured from' : 'within '}
                {!deliveryTiersEnabled && <strong className="text-foreground">{areaRadius ?? 100}{distanceUnitLabel} of</strong>}
                {' '}your center point.{' '}
                {deliveryTiersEnabled
                  ? 'The delivery fee is picked automatically from the distance bands above.'
                  : <>A fee of <strong className="text-foreground">{formatCurrency(areaDeliveryFee ?? 0, currencyCode)}</strong> will apply per delivery/collection.</>}
              </p>
            </div>
          </CardContent>
        </Card>
        </ScopeIf>
      )}

      {/* SAVE BUTTON */}
      {v2 ? (
        !readOnly && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <SettingsSaveState
              status={v2SaveStatus}
              error={v2SaveMessage ?? settingsUpdateError}
              onRetry={v2SaveStatus === 'error' ? handleSaveSettingsV2 : undefined}
              className="mr-auto"
            />
            <ButtonV2
              type="button"
              onClick={handleSaveSettingsV2}
              disabled={!v2Dirty || isUpdatingSettings}
              className="min-w-[140px]"
            >
              {isUpdatingSettings ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              {isUpdatingSettings ? 'Saving…' : 'Save changes'}
            </ButtonV2>
          </div>
        )
      ) : (
      <div className="flex justify-end">
        <Button
          onClick={handleSaveSettings}
          disabled={!hasChanges || isUpdatingSettings}
          size="lg"
          className="min-w-[160px]"
        >
          {isUpdatingSettings ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </>
          )}
        </Button>
      </div>
      )}

      {/* ADD/EDIT DIALOG */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialogMode === 'pickup' ? (
                <Truck className="h-5 w-5 text-primary" />
              ) : (
                <RotateCcw className="h-5 w-5 text-primary" />
              )}
              {editingLocation ? 'Edit' : 'Add'} {dialogMode === 'pickup' ? 'Delivery' : 'Collection'} Location
            </DialogTitle>
            <DialogDescription>
              {editingLocation
                ? `Update the ${dialogMode === 'pickup' ? 'delivery' : 'collection'} location details`
                : `Add a new ${dialogMode === 'pickup' ? 'delivery point for pickup' : 'collection point for returns'}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Location Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g., Heathrow Airport Terminal 5"
                maxLength={v2 ? LOCATION_NAME_MAX : undefined}
              />
              {v2 && locationDraftErrors.name && (
                <p role="alert" className="text-xs text-destructive">{locationDraftErrors.name}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Address</Label>
              <LocationAutocomplete
                value={formData.address}
                onChange={(v) => setFormData(p => ({ ...p, address: v }))}
                placeholder="Search for address..."
                v2States={v2}
              />
              {v2 && locationDraftErrors.address && (
                <p role="alert" className="text-xs text-destructive">{locationDraftErrors.address}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))}
                placeholder="e.g., Meet at arrivals hall, bay 3"
                maxLength={v2 ? LOCATION_TEXT_MAX : undefined}
              />
              {v2 && locationDraftErrors.description && (
                <p role="alert" className="text-xs text-destructive">{locationDraftErrors.description}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">{dialogMode === 'pickup' ? 'Delivery' : 'Collection'} Fee</Label>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{currencySymbol}</span>
                <Input
                  type="number"
                  value={formData.delivery_fee ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData(p => ({ ...p, delivery_fee: val === '' ? null : parseFloat(val) || null }));
                  }}
                  className="pl-7"
                  min={0}
                  step={0.01}
                  placeholder="0"
                />
              </div>
              {v2 && (locationDraftErrors.fee ? (
                <p role="alert" className="text-xs text-destructive">{locationDraftErrors.fee}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Leave blank or 0 to make it free for customers.</p>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveLocation} disabled={isCreating || isUpdating}>
              {(isCreating || isUpdating) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingLocation ? 'Save Changes' : 'Add Location'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Location Confirmation */}
      <AlertDialog open={!!deleteLocationId} onOpenChange={(open) => !open && setDeleteLocationId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deleteLocationName}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteLocationId) {
                  handleDeleteLocation(deleteLocationId);
                  setDeleteLocationId(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </ScopeIf>
  );
}

// Locations Grid Component
function LocationsGrid({
  locations,
  onAdd,
  onEdit,
  onDelete,
  onConfirmDelete,
  onToggleActive,
  isUpdating,
  currencyCode,
}: {
  locations: PickupLocation[];
  onAdd: () => void;
  onEdit: (location: PickupLocation) => void;
  onDelete: (id: string) => void;
  onConfirmDelete?: (id: string, name: string) => void;
  onToggleActive: (location: PickupLocation) => void;
  isUpdating: boolean;
  currencyCode: string;
}) {
  return (
    <div className="space-y-3">
      {/* Fixed-height container — always fits 2 cards, scrolls beyond that */}
      <div className="h-[168px] overflow-y-auto pr-1 rounded-xl border border-dashed border-border/50 bg-muted/10">
        {locations.length > 0 ? (
          <div className="space-y-2 p-2">
            {locations.map((location) => (
              <div
                key={location.id}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border bg-background transition-all",
                  location.is_active
                    ? "border-border"
                    : "border-border/40 opacity-60"
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <MapPin className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{location.name}</span>
                    <span className="text-xs font-semibold text-amber-500 shrink-0">
                      {formatCurrency(location.delivery_fee, currencyCode)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{location.address}</p>
                  {location.description && (
                    <p className="text-xs text-muted-foreground/70 truncate">{location.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Switch
                    checked={location.is_active}
                    onCheckedChange={() => onToggleActive(location)}
                    disabled={isUpdating}
                    className="scale-90"
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(location)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => onConfirmDelete ? onConfirmDelete(location.id, location.name) : onDelete(location.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No locations added
          </div>
        )}
      </div>

      <Button variant="outline" size="sm" onClick={onAdd} className="w-full border-dashed">
        <Plus className="mr-2 h-4 w-4" />
        Add Location
      </Button>
    </div>
  );
}

export default LocationSettings;
