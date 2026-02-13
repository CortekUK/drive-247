'use client';

import { useEffect } from 'react';
import { usePickupLocations, PickupLocation } from '@/hooks/use-pickup-locations';
import { LocationAutocomplete } from '@/components/ui/location-autocomplete';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin } from 'lucide-react';

interface LocationPickerProps {
  type: 'pickup' | 'return';
  value: string;
  locationId?: string;
  onChange: (address: string, locationId?: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Smart location picker component that adapts based on tenant's location mode setting.
 *
 * Modes:
 * - 'fixed': Shows read-only fixed address from tenant settings
 * - 'custom': Shows LocationAutocomplete for free-form address entry
 * - 'multiple': Shows dropdown to select from predefined locations
 */
export function LocationPicker({
  type,
  value,
  locationId,
  onChange,
  placeholder,
  className,
  disabled = false,
}: LocationPickerProps) {
  const {
    locationSettings,
    isLoadingSettings,
    pickupLocations,
    returnLocations,
    isLoadingLocations,
  } = usePickupLocations();

  // Determine the mode for this location type
  const mode = type === 'pickup'
    ? locationSettings.pickup_location_mode
    : locationSettings.return_location_mode;

  // Get fixed address if mode is 'fixed'
  const fixedAddress = type === 'pickup'
    ? locationSettings.fixed_pickup_address
    : locationSettings.fixed_return_address;

  // Get locations for this type
  const locations: PickupLocation[] = type === 'pickup' ? pickupLocations : returnLocations;

  // Auto-set fixed address when mode is 'fixed' and value is empty
  useEffect(() => {
    if (mode === 'fixed' && fixedAddress && !value) {
      onChange(fixedAddress, undefined);
    }
  }, [mode, fixedAddress, value, onChange]);

  // Show skeleton while loading
  if (isLoadingSettings) {
    return <Skeleton className={`w-full h-10 ${className}`} />;
  }

  // Mode: Fixed - show read-only fixed address
  if (mode === 'fixed') {
    return (
      <div
        className={`flex items-center gap-2 px-3 h-10 border rounded-md bg-muted/50 text-foreground ${className}`}
      >
        <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="flex-1 truncate text-sm">
          {fixedAddress || 'No address configured'}
        </span>
      </div>
    );
  }

  // Mode: Multiple - show dropdown selector
  if (mode === 'multiple') {
    if (isLoadingLocations) {
      return <Skeleton className={`w-full h-10 ${className}`} />;
    }

    if (!locations || locations.length === 0) {
      // Fallback to autocomplete if no locations configured
      return (
        <LocationAutocomplete
          id={`${type}Location`}
          value={value}
          onChange={(address) => onChange(address, undefined)}
          placeholder={placeholder || `Enter ${type} address`}
          className={className}
          disabled={disabled}
        />
      );
    }

    return (
      <Select
        value={locationId || ''}
        onValueChange={(selectedId) => {
          const location = locations.find((l) => l.id === selectedId);
          if (location) {
            onChange(location.address, location.id);
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger className={className}>
          <SelectValue placeholder={placeholder || `Select ${type} location`}>
            {locationId && locations.find((l) => l.id === locationId)?.name}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {locations.map((location) => (
            <SelectItem key={location.id} value={location.id}>
              <div className="flex flex-col">
                <span className="font-medium">{location.name}</span>
                <span className="text-xs text-muted-foreground">{location.address}</span>
                {location.description && (
                  <span className="text-xs text-muted-foreground/70">{location.description}</span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Mode: Custom (default) - show autocomplete
  return (
    <LocationAutocomplete
      id={`${type}Location`}
      value={value}
      onChange={(address) => onChange(address, undefined)}
      placeholder={placeholder || `Enter ${type} address`}
      className={className}
      disabled={disabled}
    />
  );
}

export default LocationPicker;
