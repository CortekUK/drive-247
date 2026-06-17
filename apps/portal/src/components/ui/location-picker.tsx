'use client';

import { useEffect, useState } from 'react';
import { usePickupLocations, PickupLocation } from '@/hooks/use-pickup-locations';
import { LocationAutocomplete } from '@/components/ui/location-autocomplete';
import { LocationAutocompleteWithRadius } from '@/components/ui/location-autocomplete-with-radius';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Building2, MapPin, Navigation, AlertTriangle, PenLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format-utils';
import type { DistanceUnit } from '@/lib/format-utils';
import { resolveDeliveryFee, getTierFeeRange, hasActiveTiers } from '@/lib/delivery-tiers';

export type LocationMethod = 'fixed' | 'location' | 'area';

interface LocationPickerProps {
  type: 'pickup' | 'return';
  value: string;
  locationId?: string;
  method: LocationMethod;
  onMethodChange: (method: LocationMethod) => void;
  onChange: (address: string, locationId?: string, fee?: number, outOfRadius?: boolean) => void;
  /** Called when the admin toggles custom address entry on/off */
  onCustomAddressChange?: (isCustom: boolean) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Currency code for fee display */
  currency?: string;
  /** Distance unit for area radius display */
  distanceUnit?: DistanceUnit;
}

/**
 * Smart location picker with 3 method cards: Fixed, Multiple Locations, Area.
 * All methods are always shown. Disabled methods show a soft warning but remain selectable.
 * Designed for portal admin use — admins can override tenant settings.
 */
export function LocationPicker({
  type,
  value,
  locationId,
  method,
  onMethodChange,
  onChange,
  onCustomAddressChange,
  placeholder,
  className,
  disabled = false,
  currency = 'USD',
  distanceUnit = 'miles',
}: LocationPickerProps) {
  const {
    locationSettings,
    isLoadingSettings,
    pickupLocations,
    returnLocations,
    isLoadingLocations,
  } = usePickupLocations();

  const fixedAddress = type === 'pickup'
    ? locationSettings.fixed_pickup_address
    : locationSettings.fixed_return_address;

  const locations: PickupLocation[] = type === 'pickup' ? pickupLocations : returnLocations;

  const isFixedEnabled = type === 'pickup'
    ? locationSettings.pickup_fixed_enabled
    : locationSettings.return_fixed_enabled;
  const isMultipleEnabled = type === 'pickup'
    ? locationSettings.pickup_multiple_locations_enabled
    : locationSettings.return_multiple_locations_enabled;
  const isAreaEnabled = type === 'pickup'
    ? locationSettings.pickup_area_enabled
    : locationSettings.return_area_enabled;

  // Tiered (distance-banded) delivery pricing config for area mode
  const tierCfg = {
    delivery_tiers_enabled: locationSettings.delivery_tiers_enabled,
    delivery_distance_tiers: locationSettings.delivery_distance_tiers,
    area_delivery_fee: locationSettings.area_delivery_fee,
  };
  const tiersOn = hasActiveTiers(tierCfg);
  const tierRange = getTierFeeRange(tierCfg);
  const areaFee = locationSettings.area_delivery_fee || 0;
  // Fee shown on the area method card: cheapest band when tiered, else the flat fee
  const areaCardFee = tiersOn ? (tierRange?.min ?? 0) : areaFee;
  const radiusKm = type === 'pickup'
    ? locationSettings.pickup_area_radius_km || 25
    : locationSettings.return_area_radius_km || 25;

  // Auto-set fixed address when fixed method is active. For the 'location'
  // method we only auto-pick when there is exactly ONE location configured —
  // when multiple exist the operator must choose explicitly. Auto-filling
  // locations[0] silently overwrote whatever the operator was about to type
  // and shipped the wrong address to the rental insert payload (May 8 bug).
  useEffect(() => {
    if (method === 'fixed' && fixedAddress && !value) {
      onChange(fixedAddress, undefined, 0);
    }
    if (method === 'location' && !value && !locationId && locations.length === 1) {
      const only = locations[0];
      onChange(only.address, only.id, only.delivery_fee || 0);
    }
  }, [method, fixedAddress, locations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoadingSettings) {
    return <Skeleton className="w-full h-24" />;
  }

  const methods: { key: LocationMethod; label: string; description: string; icon: typeof Building2; enabled: boolean; fee?: number }[] = [
    {
      key: 'fixed',
      label: 'Our Location',
      description: fixedAddress ? 'Pickup from fixed address' : 'No fixed address set',
      icon: Building2,
      enabled: isFixedEnabled,
      fee: 0,
    },
    {
      key: 'location',
      label: 'Locations',
      description: `${locations.length} location${locations.length !== 1 ? 's' : ''} available`,
      icon: MapPin,
      enabled: isMultipleEnabled,
    },
    {
      key: 'area',
      label: 'Area Delivery',
      description: tiersOn ? 'Priced by distance' : 'Deliver to customer address',
      icon: Navigation,
      enabled: isAreaEnabled,
      fee: areaCardFee,
    },
  ];

  return (
    <div className={cn("space-y-3", className)}>
      {/* Method cards */}
      <div className="grid grid-cols-3 gap-2">
        {methods.map(({ key, label, description, icon: Icon, enabled, fee }) => {
          const isSelected = method === key;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => {
                onMethodChange(key);
                if (key === 'fixed') {
                  onChange(fixedAddress || '', undefined, 0);
                } else if (key === 'location' && locations.length === 1) {
                  // Single configured location → auto-pick it. When multiple
                  // exist the operator must choose explicitly (otherwise we
                  // silently ship the wrong address to the rental).
                  const only = locations[0];
                  onChange(only.address, only.id, only.delivery_fee || 0);
                } else {
                  // Area, or location with 0 / 2+ entries — clear address so
                  // the dropdown / area input is empty until the user picks.
                  onChange('', undefined, key === 'area' ? areaCardFee : undefined);
                }
              }}
              className={cn(
                "relative flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all cursor-pointer",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/50 border-border",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <div className={cn(
                "flex items-center justify-center h-8 w-8 rounded-md shrink-0 mt-0.5",
                isSelected ? "bg-primary/10" : "bg-muted"
              )}>
                <Icon className={cn(
                  "w-4 h-4",
                  isSelected ? "text-primary" : "text-muted-foreground"
                )} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={cn(
                    "text-sm font-medium leading-tight",
                    isSelected ? "text-foreground" : "text-foreground"
                  )}>
                    {label}
                  </span>
                  {!enabled && (
                    <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground leading-tight line-clamp-1">
                  {fee !== undefined && fee > 0
                    ? formatCurrency(fee, currency)
                    : fee === 0
                    ? 'Free'
                    : description}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Soft warning for disabled method */}
      {!methods.find(m => m.key === method)?.enabled && (
        <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            This method is not enabled for customers in your settings. It will only apply to this portal-created rental.
          </span>
        </div>
      )}

      {/* Method-specific input */}
      {method === 'fixed' && (
        <FixedLocationInput
          fixedAddress={fixedAddress}
          value={value}
          onChange={onChange}
          onCustomChange={onCustomAddressChange}
          type={type}
          placeholder={placeholder}
          disabled={disabled}
        />
      )}

      {method === 'location' && (
        <MultipleLocationInput
          locations={locations}
          isLoading={isLoadingLocations}
          locationId={locationId}
          value={value}
          onChange={onChange}
          onCustomChange={onCustomAddressChange}
          type={type}
          placeholder={placeholder}
          disabled={disabled}
          currency={currency}
        />
      )}

      {method === 'area' && (
        <div className="space-y-2">
          <LocationAutocompleteWithRadius
            id={`${type}LocationArea`}
            value={value}
            onChange={(address, lat, lon, outOfRadius, distanceKm) => {
              const fee = tiersOn ? resolveDeliveryFee(distanceKm, tierCfg).fee : areaFee;
              onChange(address, undefined, fee, outOfRadius);
            }}
            placeholder={placeholder || `Enter ${type === 'pickup' ? 'delivery' : 'collection'} address`}
            radiusKm={radiusKm}
            centerLat={locationSettings.area_center_lat}
            centerLon={locationSettings.area_center_lon}
            distanceUnit={distanceUnit}
            disabled={disabled}
            allowOutOfRadius={true}
          />
          {tiersOn && (
            <p className="text-[11px] text-muted-foreground">
              Tiered pricing on — fee is set automatically from the address distance. You can still override it below.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Fixed location with option to use a custom address for this rental */
function FixedLocationInput({
  fixedAddress,
  value,
  onChange,
  onCustomChange,
  type,
  placeholder,
  disabled,
}: {
  fixedAddress: string | null;
  value: string;
  onChange: (address: string, locationId?: string, fee?: number, outOfRadius?: boolean) => void;
  onCustomChange?: (isCustom: boolean) => void;
  type: 'pickup' | 'return';
  placeholder?: string;
  disabled?: boolean;
}) {
  const [useCustom, setUseCustom] = useState(false);

  // If value differs from fixed address, it was a custom entry — show the autocomplete
  useEffect(() => {
    if (value && fixedAddress && value !== fixedAddress) {
      setUseCustom(true);
      onCustomChange?.(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (useCustom) {
    return (
      <div className="space-y-2">
        <LocationAutocomplete
          id={`${type}LocationCustom`}
          value={value}
          onChange={(address) => onChange(address, undefined, undefined)}
          placeholder={placeholder || `Enter custom ${type} address`}
          disabled={disabled}
        />
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          onClick={() => {
            setUseCustom(false);
            onCustomChange?.(false);
            onChange(fixedAddress || '', undefined, 0);
          }}
        >
          <Building2 className="w-3 h-3" />
          Use fixed address
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-3 h-10 border rounded-md bg-muted/50 text-foreground">
        <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="flex-1 truncate text-sm">
          {fixedAddress || 'No fixed address configured in settings'}
        </span>
      </div>
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        onClick={() => {
          setUseCustom(true);
          onCustomChange?.(true);
          onChange('', undefined, undefined);
        }}
      >
        <PenLine className="w-3 h-3" />
        Use a different address for this rental
      </button>
    </div>
  );
}

/** Multiple locations dropdown with option to use a custom address for this rental */
function MultipleLocationInput({
  locations,
  isLoading,
  locationId,
  value,
  onChange,
  onCustomChange,
  type,
  placeholder,
  disabled,
  currency,
}: {
  locations: PickupLocation[];
  isLoading: boolean;
  locationId?: string;
  value: string;
  onChange: (address: string, locationId?: string, fee?: number, outOfRadius?: boolean) => void;
  onCustomChange?: (isCustom: boolean) => void;
  type: 'pickup' | 'return';
  placeholder?: string;
  disabled?: boolean;
  currency: string;
}) {
  const [useCustom, setUseCustom] = useState(false);

  // If there's a value but no matching locationId, it was a custom entry
  useEffect(() => {
    if (value && !locationId && locations.length > 0) {
      setUseCustom(true);
      onCustomChange?.(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return <Skeleton className="w-full h-10" />;
  }

  if (useCustom) {
    return (
      <div className="space-y-2">
        <LocationAutocomplete
          id={`${type}LocationCustom`}
          value={value}
          onChange={(address) => onChange(address, undefined, undefined)}
          placeholder={placeholder || `Enter custom ${type} address`}
          disabled={disabled}
        />
        {locations.length > 0 && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            onClick={() => {
              setUseCustom(false);
              onCustomChange?.(false);
              onChange('', undefined, 0);
            }}
          >
            <MapPin className="w-3 h-3" />
            Choose from saved locations
          </button>
        )}
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <LocationAutocomplete
        id={`${type}Location`}
        value={value}
        onChange={(address) => onChange(address, undefined, 0)}
        placeholder={placeholder || `Enter ${type} address`}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="space-y-2">
      <Select
        value={locationId || ''}
        onValueChange={(selectedId) => {
          const location = locations.find((l) => l.id === selectedId);
          if (location) {
            onChange(location.address, location.id, location.delivery_fee || 0);
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder={placeholder || `Select ${type} location`}>
            {locationId && locations.find((l) => l.id === locationId)?.name}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {locations.map((location) => (
            <SelectItem key={location.id} value={location.id}>
              <div className="flex items-center justify-between gap-4 w-full">
                <div className="flex flex-col">
                  <span className="font-medium">{location.name}</span>
                  <span className="text-xs text-muted-foreground">{location.address}</span>
                </div>
                {location.delivery_fee > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
                    {formatCurrency(location.delivery_fee, currency)}
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        onClick={() => {
          setUseCustom(true);
          onCustomChange?.(true);
          onChange('', undefined, undefined);
        }}
      >
        <PenLine className="w-3 h-3" />
        Use a different address for this rental
      </button>
    </div>
  );
}

export default LocationPicker;
