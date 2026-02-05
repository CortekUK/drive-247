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
  AlertDialogTrigger,
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
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  usePickupLocations,
  PickupLocation,
} from '@/hooks/use-pickup-locations';
import { cn } from '@/lib/utils';

interface LocationFormData {
  name: string;
  address: string;
  delivery_fee: number | null;
  is_pickup_enabled: boolean;
  is_return_enabled: boolean;
}

const EMPTY_FORM: LocationFormData = {
  name: '',
  address: '',
  delivery_fee: null,
  is_pickup_enabled: true,
  is_return_enabled: true,
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
};

export function LocationSettings() {
  const {
    locationSettings,
    isLoadingSettings,
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

  const [hasChanges, setHasChanges] = useState(false);

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<PickupLocation | null>(null);
  const [formData, setFormData] = useState<LocationFormData>(EMPTY_FORM);
  const [dialogMode, setDialogMode] = useState<'pickup' | 'return'>('pickup');

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
      setAreaRadius(locationSettings.pickup_area_radius_km ?? 100);
      setAreaDeliveryFee(locationSettings.area_delivery_fee ?? 0);
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
  }, [pickupFixedEnabled, pickupMultipleEnabled, pickupAreaEnabled, returnFixedEnabled, returnMultipleEnabled, returnAreaEnabled, fixedPickupAddress, fixedReturnAddress, sameReturnAddress, areaRadius, areaDeliveryFee, areaCenterLat, areaCenterLon]);

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
        pickup_area_radius_km: areaUsed ? (areaRadius ?? 100) : null,
        return_area_radius_km: areaUsed ? (areaRadius ?? 100) : null,
        area_delivery_fee: areaUsed ? (areaDeliveryFee ?? 0) : 0,
        area_center_lat: areaUsed ? areaCenterLat : null,
        area_center_lon: areaUsed ? areaCenterLon : null,
      });
      setHasChanges(false);
    } catch (error) {}
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
    setEditingLocation(location);
    setDialogMode(mode);
    setFormData({
      name: location.name,
      address: location.address,
      delivery_fee: location.delivery_fee,
      is_pickup_enabled: location.is_pickup_enabled,
      is_return_enabled: location.is_return_enabled,
    });
    setIsDialogOpen(true);
  };

  const handleSaveLocation = async () => {
    if (!formData.name.trim() || !formData.address.trim()) {
      toast({ title: 'Error', description: 'Enter both name and address.', variant: 'destructive' });
      return;
    }
    try {
      // Set flags based on dialog mode
      const locationData = {
        name: formData.name.trim(),
        address: formData.address.trim(),
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

  if (isLoadingSettings) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Two Column Layout for Pickup & Return */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* PICKUP OPTIONS CARD */}
        <Card className="overflow-hidden">
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
          <CardContent className="p-0">
            {/* Fixed Address */}
            <div className={cn(
              "p-5 border-b transition-colors",
              pickupFixedEnabled && "bg-muted/20"
            )}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    pickupFixedEnabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-foreground/50"
                  )}>
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
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
                <div className="mt-4 pl-[52px]">
                  <LocationAutocomplete
                    value={fixedPickupAddress}
                    onChange={(v) => { setFixedPickupAddress(v); setHasChanges(true); }}
                    placeholder="Enter your pickup address..."
                    className="text-sm"
                  />
                </div>
              )}
            </div>

            {/* Predefined Locations */}
            <div className={cn(
              "p-5 border-b transition-colors",
              pickupMultipleEnabled && "bg-muted/20"
            )}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    pickupMultipleEnabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-foreground/50"
                  )}>
                    <MapPinned className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
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
                <div className="mt-4 pl-[52px]">
                  <LocationsGrid
                    locations={pickupLocations}
                    onAdd={() => handleOpenAddDialog('pickup')}
                    onEdit={(loc) => handleOpenEditDialog(loc, 'pickup')}
                    onDelete={handleDeleteLocation}
                    onToggleActive={handleToggleActive}
                    isUpdating={isUpdating}
                  />
                </div>
              )}
            </div>

            {/* Area Delivery */}
            <div className={cn(
              "p-5 transition-colors",
              pickupAreaEnabled && "bg-muted/20"
            )}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    pickupAreaEnabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-foreground/50"
                  )}>
                    <CircleDot className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
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
        <Card className="overflow-hidden">
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
          <CardContent className="p-0">
            {/* Fixed Address */}
            <div className={cn(
              "p-5 border-b transition-colors",
              returnFixedEnabled && "bg-muted/20"
            )}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    returnFixedEnabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-foreground/50"
                  )}>
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
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
                <div className="mt-4 pl-[52px] space-y-3">
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
                    />
                  )}
                </div>
              )}
            </div>

            {/* Predefined Locations */}
            <div className={cn(
              "p-5 border-b transition-colors",
              returnMultipleEnabled && "bg-muted/20"
            )}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    returnMultipleEnabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-foreground/50"
                  )}>
                    <MapPinned className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
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
                <div className="mt-4 pl-[52px]">
                  <LocationsGrid
                    locations={returnLocations}
                    onAdd={() => handleOpenAddDialog('return')}
                    onEdit={(loc) => handleOpenEditDialog(loc, 'return')}
                    onDelete={handleDeleteLocation}
                    onToggleActive={handleToggleActive}
                    isUpdating={isUpdating}
                  />
                </div>
              )}
            </div>

            {/* Area Collection */}
            <div className={cn(
              "p-5 transition-colors",
              returnAreaEnabled && "bg-muted/20"
            )}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                    returnAreaEnabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-foreground/50"
                  )}>
                    <CircleDot className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
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
        <Card className="overflow-hidden">
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
                        setAreaRadius(val === '' ? null : parseInt(val) || null);
                        setHasChanges(true);
                      }}
                      className="pr-10"
                      min={1}
                      max={100}
                      placeholder="100"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">km</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Fee</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
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
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-muted/50 border">
              <p className="text-sm text-muted-foreground">
                Customers can enter any address within <strong className="text-foreground">{areaRadius ?? 100}km</strong> of your center point.
                A fee of <strong className="text-foreground">{formatCurrency(areaDeliveryFee ?? 0)}</strong> will apply per delivery/collection.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* SAVE BUTTON */}
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
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Address</Label>
              <LocationAutocomplete
                value={formData.address}
                onChange={(v) => setFormData(p => ({ ...p, address: v }))}
                placeholder="Search for address..."
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">{dialogMode === 'pickup' ? 'Delivery' : 'Collection'} Fee</Label>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
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
    </div>
  );
}

// Locations Grid Component
function LocationsGrid({
  locations,
  onAdd,
  onEdit,
  onDelete,
  onToggleActive,
  isUpdating,
}: {
  locations: PickupLocation[];
  onAdd: () => void;
  onEdit: (location: PickupLocation) => void;
  onDelete: (id: string) => void;
  onToggleActive: (location: PickupLocation) => void;
  isUpdating: boolean;
}) {
  return (
    <div className="space-y-3">
      {locations.length > 0 && (
        <div className="space-y-2">
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
                  <span className="font-medium text-sm">{location.name}</span>
                  <span className="text-xs font-semibold text-amber-500">
                    {formatCurrency(location.delivery_fee)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{location.address}</p>
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
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete "{location.name}"?</AlertDialogTitle>
                      <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => onDelete(location.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button variant="outline" size="sm" onClick={onAdd} className="w-full border-dashed">
        <Plus className="mr-2 h-4 w-4" />
        Add Location
      </Button>
    </div>
  );
}

export default LocationSettings;
