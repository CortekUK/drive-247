'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import LocationAutocompleteWithRadius from '@/components/LocationAutocompleteWithRadius';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin } from 'lucide-react';

interface PickupLocation {
  id: string;
  name: string;
  address: string;
  is_pickup_enabled: boolean;
  is_return_enabled: boolean;
}

interface LocationPickerProps {
  type: 'pickup' | 'return';
  value: string;
  locationId?: string;
  onChange: (address: string, locationId?: string, lat?: number, lon?: number) => void;
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
 * - 'area_around': Shows autocomplete filtered by radius from user's live location
 */
export default function LocationPicker({
  type,
  value,
  locationId,
  onChange,
  placeholder,
  className = 'h-12',
  disabled = false,
}: LocationPickerProps) {
  const { tenant, loading: tenantLoading } = useTenant();

  // Determine the mode for this location type
  const mode =
    type === 'pickup'
      ? tenant?.pickup_location_mode
      : tenant?.return_location_mode;

  // Get fixed address if mode is 'fixed'
  const fixedAddress =
    type === 'pickup'
      ? tenant?.fixed_pickup_address
      : tenant?.fixed_return_address;

  // Fetch predefined locations when mode is 'multiple'
  const { data: locations, isLoading: locationsLoading } = useQuery({
    queryKey: ['pickup-locations', tenant?.id, type],
    queryFn: async (): Promise<PickupLocation[]> => {
      if (!tenant?.id) return [];

      const enabledField = type === 'pickup' ? 'is_pickup_enabled' : 'is_return_enabled';

      const { data, error } = await supabase
        .from('pickup_locations')
        .select('id, name, address, is_pickup_enabled, is_return_enabled')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .eq(enabledField, true)
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('[LocationPicker] Error fetching locations:', error);
        return [];
      }

      return data as PickupLocation[];
    },
    enabled: mode === 'multiple' && !!tenant?.id,
    staleTime: 60 * 1000, // 1 minute cache
  });

  // Auto-set fixed address when mode is 'fixed' and value is empty
  useEffect(() => {
    if (mode === 'fixed' && fixedAddress && !value) {
      onChange(fixedAddress, undefined);
    }
  }, [mode, fixedAddress, value, onChange]);

  // Show skeleton while loading tenant
  if (tenantLoading) {
    return <Skeleton className={`w-full ${className}`} />;
  }

  // Mode: Fixed - show read-only fixed address
  if (mode === 'fixed') {
    return (
      <div
        className={`flex items-center gap-2 px-3 border rounded-md bg-muted/50 text-foreground ${className}`}
      >
        <MapPin className="w-4 h-4 text-accent flex-shrink-0" />
        <span className="flex-1 truncate">
          {fixedAddress || 'No address configured'}
        </span>
      </div>
    );
  }

  // Mode: Multiple - show dropdown selector
  if (mode === 'multiple') {
    if (locationsLoading) {
      return <Skeleton className={`w-full ${className}`} />;
    }

    if (!locations || locations.length === 0) {
      // Fallback to autocomplete if no locations configured
      return (
        <LocationAutocomplete
          id={`${type}Location`}
          value={value}
          onChange={(address, lat, lon) => onChange(address, undefined, lat, lon)}
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
                <span className="text-xs opacity-70">{location.address}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Mode: Area Around - show autocomplete with geolocation filtering
  if (mode === 'area_around') {
    const radiusKm =
      type === 'pickup'
        ? tenant?.pickup_area_radius_km
        : tenant?.return_area_radius_km;

    return (
      <LocationAutocompleteWithRadius
        id={`${type}Location`}
        value={value}
        onChange={(address, lat, lon) => onChange(address, undefined, lat, lon)}
        placeholder={placeholder || `Enter ${type} address`}
        className={className}
        disabled={disabled}
        radiusKm={radiusKm ?? 25}
        centerLat={tenant?.area_center_lat}
        centerLon={tenant?.area_center_lon}
      />
    );
  }

  // Mode: Custom (default) - show autocomplete
  return (
    <LocationAutocomplete
      id={`${type}Location`}
      value={value}
      onChange={(address, lat, lon) => onChange(address, undefined, lat, lon)}
      placeholder={placeholder || `Enter ${type} address`}
      className={className}
      disabled={disabled}
    />
  );
}
