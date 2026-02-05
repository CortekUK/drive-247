'use client';

import { useState, useEffect } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { useDeliveryLocations, DeliveryLocation } from '@/hooks/useDeliveryLocations';
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
import { MapPin, Building2, Navigation, Check, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LocationPickerProps {
  type: 'pickup' | 'return';
  value: string;
  locationId?: string;
  onChange: (address: string, locationId?: string, lat?: number, lon?: number, deliveryFee?: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

type DeliveryMethod = 'fixed' | 'location' | 'area';

/**
 * Smart location picker component that adapts based on tenant's enabled delivery options.
 *
 * New approach with boolean flags:
 * - fixed_address_enabled: FREE - customer picks up/returns at fixed address
 * - multiple_locations_enabled: PAID - customer selects from predefined locations with fees
 * - area_around_enabled: PAID - customer enters custom address within area (flat fee)
 *
 * When multiple options are enabled, shows elegant cards to let customer choose.
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
  const { pickupLocations, returnLocations, isLoading: locationsLoading } = useDeliveryLocations();

  // Get the right locations list based on type
  const locations = type === 'pickup' ? pickupLocations : returnLocations;

  // Check which options are enabled
  const fixedEnabled = tenant?.fixed_address_enabled ?? false;
  const multipleEnabled = (tenant?.multiple_locations_enabled ?? false) && locations.length > 0;
  const areaEnabled = tenant?.area_around_enabled ?? false;

  // Count enabled options
  const enabledOptions = [fixedEnabled, multipleEnabled, areaEnabled].filter(Boolean);
  const showRadioOptions = enabledOptions.length > 1;

  // Track selected delivery method
  const [selectedMethod, setSelectedMethod] = useState<DeliveryMethod>('fixed');

  // Get fixed address based on type
  const fixedAddress =
    type === 'pickup'
      ? tenant?.fixed_pickup_address
      : tenant?.fixed_return_address;

  // Calculate fee display for multiple locations
  const getLocationFeeDisplay = () => {
    const fees = locations.map(l => l.delivery_fee).filter(f => f > 0);
    if (fees.length === 0) return null;
    const minFee = Math.min(...fees);
    const maxFee = Math.max(...fees);
    return {
      min: minFee,
      max: maxFee,
      isSame: minFee === maxFee,
      text: minFee === maxFee
        ? formatCurrency(minFee, tenant?.currency_code)
        : `from ${formatCurrency(minFee, tenant?.currency_code)}`
    };
  };

  const locationFees = getLocationFeeDisplay();

  // Initialize selected method based on what's enabled
  useEffect(() => {
    if (fixedEnabled) {
      setSelectedMethod('fixed');
    } else if (multipleEnabled) {
      setSelectedMethod('location');
    } else if (areaEnabled) {
      setSelectedMethod('area');
    }
  }, [fixedEnabled, multipleEnabled, areaEnabled]);

  // Auto-set fixed address when method is fixed
  useEffect(() => {
    if (selectedMethod === 'fixed' && fixedAddress && !value) {
      onChange(fixedAddress, undefined, undefined, undefined, 0);
    }
  }, [selectedMethod, fixedAddress, value, onChange]);

  // Handle method change
  const handleMethodChange = (method: DeliveryMethod) => {
    setSelectedMethod(method);

    // Clear current value when switching methods
    if (method === 'fixed' && fixedAddress) {
      onChange(fixedAddress, undefined, undefined, undefined, 0);
    } else {
      onChange('', undefined, undefined, undefined, undefined);
    }
  };

  // Show skeleton while loading
  if (tenantLoading || locationsLoading) {
    return <Skeleton className={`w-full ${className}`} />;
  }

  // If no options are enabled, fall back to simple autocomplete
  if (!fixedEnabled && !multipleEnabled && !areaEnabled) {
    return (
      <LocationAutocomplete
        id={`${type}Location`}
        value={value}
        onChange={(address, lat, lon) => onChange(address, undefined, lat, lon, 0)}
        placeholder={placeholder || `Enter ${type} address`}
        className={className}
        disabled={disabled}
      />
    );
  }

  // If only ONE option is enabled, show it directly (no selection needed)
  if (!showRadioOptions) {
    if (fixedEnabled) {
      return (
        <div className="p-4 rounded-xl border-2 border-primary/30 bg-primary/5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-sm">Our Location</span>
                <span className="text-xs font-medium text-green-600 bg-green-100 px-2 py-0.5 rounded-full">FREE</span>
              </div>
              <p className="text-sm text-muted-foreground truncate">{fixedAddress || 'Address not configured'}</p>
            </div>
          </div>
        </div>
      );
    }

    if (multipleEnabled) {
      return (
        <LocationDropdown
          type={type}
          locations={locations}
          locationId={locationId}
          onChange={onChange}
          placeholder={placeholder}
          className={className}
          disabled={disabled}
        />
      );
    }

    if (areaEnabled) {
      return (
        <div className="space-y-3">
          <LocationAutocompleteWithRadius
            id={`${type}Location`}
            value={value}
            onChange={(address, lat, lon) =>
              onChange(address, undefined, lat, lon, tenant?.area_delivery_fee || 0)
            }
            placeholder={placeholder || `Enter ${type} address`}
            className={className}
            disabled={disabled}
            radiusKm={type === 'pickup' ? tenant?.pickup_area_radius_km ?? 25 : tenant?.return_area_radius_km ?? 25}
            centerLat={tenant?.area_center_lat}
            centerLon={tenant?.area_center_lon}
          />
          {tenant?.area_delivery_fee && tenant.area_delivery_fee > 0 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Truck className="w-3 h-3" />
              Delivery fee: <span className="font-semibold text-foreground">{formatCurrency(tenant.area_delivery_fee, tenant.currency_code)}</span>
            </p>
          )}
        </div>
      );
    }
  }

  // Multiple options enabled - show elegant card selection
  return (
    <div className="space-y-2">
      {/* Fixed Address Option */}
      {fixedEnabled && (
        <OptionCard
          selected={selectedMethod === 'fixed'}
          onClick={() => handleMethodChange('fixed')}
          disabled={disabled}
        >
          <div className="flex items-center gap-3 w-full">
            <div className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
              selectedMethod === 'fixed' ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
            )}>
              <Building2 className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">
                {type === 'pickup' ? 'Pick up from our location' : 'Return to our location'}
              </p>
              {selectedMethod === 'fixed' && fixedAddress && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">{fixedAddress}</p>
              )}
            </div>
            <span className="text-xs font-semibold text-green-600 bg-green-500/10 px-2.5 py-1 rounded-full flex-shrink-0">
              FREE
            </span>
          </div>
        </OptionCard>
      )}

      {/* Multiple Locations Option */}
      {multipleEnabled && (
        <OptionCard
          selected={selectedMethod === 'location'}
          onClick={() => handleMethodChange('location')}
          disabled={disabled}
        >
          <div className="flex items-center gap-3 w-full">
            <div className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
              selectedMethod === 'location' ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
            )}>
              <MapPin className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">
                {type === 'pickup' ? 'Deliver to a location' : 'Collect from a location'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {locations.length} location{locations.length !== 1 ? 's' : ''} available
              </p>
            </div>
            {locationFees && (
              <span className="text-xs font-semibold text-amber-600 bg-amber-500/10 px-2.5 py-1 rounded-full flex-shrink-0">
                {locationFees.isSame ? `+ ${locationFees.text}` : locationFees.text}
              </span>
            )}
          </div>

          {/* Expanded location selector */}
          {selectedMethod === 'location' && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <LocationDropdown
                type={type}
                locations={locations}
                locationId={locationId}
                onChange={onChange}
                placeholder={placeholder}
                className="h-11"
                disabled={disabled}
              />
            </div>
          )}
        </OptionCard>
      )}

      {/* Area Around Option */}
      {areaEnabled && (
        <OptionCard
          selected={selectedMethod === 'area'}
          onClick={() => handleMethodChange('area')}
          disabled={disabled}
        >
          <div className="flex items-center gap-3 w-full">
            <div className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
              selectedMethod === 'area' ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
            )}>
              <Navigation className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">
                {type === 'pickup' ? 'Deliver to my address' : 'Collect from my address'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Within {type === 'pickup' ? tenant?.pickup_area_radius_km ?? 25 : tenant?.return_area_radius_km ?? 25}km service area
              </p>
            </div>
            {tenant?.area_delivery_fee && tenant.area_delivery_fee > 0 && (
              <span className="text-xs font-semibold text-amber-600 bg-amber-500/10 px-2.5 py-1 rounded-full flex-shrink-0">
                + {formatCurrency(tenant.area_delivery_fee, tenant.currency_code)}
              </span>
            )}
          </div>

          {/* Expanded address input */}
          {selectedMethod === 'area' && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <LocationAutocompleteWithRadius
                id={`${type}Location`}
                value={value}
                onChange={(address, lat, lon) =>
                  onChange(address, undefined, lat, lon, tenant?.area_delivery_fee || 0)
                }
                placeholder={placeholder || `Enter your address`}
                className="h-11"
                disabled={disabled}
                radiusKm={type === 'pickup' ? tenant?.pickup_area_radius_km ?? 25 : tenant?.return_area_radius_km ?? 25}
                centerLat={tenant?.area_center_lat}
                centerLon={tenant?.area_center_lon}
              />
            </div>
          )}
        </OptionCard>
      )}
    </div>
  );
}

/**
 * Styled option card component
 */
function OptionCard({
  selected,
  onClick,
  disabled,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={cn(
        "relative p-3 rounded-xl border transition-all cursor-pointer",
        selected
          ? "border-primary/40 bg-primary/[0.03]"
          : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/20",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {/* Selection indicator */}
      <div className={cn(
        "absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
        selected
          ? "border-primary/60 bg-primary/80"
          : "border-muted-foreground/20 bg-transparent"
      )}>
        {selected && <Check className="w-3 h-3 text-primary-foreground" />}
      </div>

      <div className="pr-8">
        {children}
      </div>
    </div>
  );
}

/**
 * Dropdown component for selecting from predefined locations
 */
function LocationDropdown({
  type,
  locations,
  locationId,
  onChange,
  placeholder,
  className,
  disabled,
}: {
  type: 'pickup' | 'return';
  locations: DeliveryLocation[];
  locationId?: string;
  onChange: (address: string, locationId?: string, lat?: number, lon?: number, deliveryFee?: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { tenant } = useTenant();
  const selectedLocation = locations.find((l) => l.id === locationId);

  if (locations.length === 0) {
    return (
      <div className={cn("flex items-center gap-2 px-3 border rounded-lg bg-muted/30 text-muted-foreground", className)}>
        <MapPin className="w-4 h-4" />
        <span className="text-sm">No locations available</span>
      </div>
    );
  }

  return (
    <Select
      value={locationId || ''}
      onValueChange={(selectedId) => {
        const location = locations.find((l) => l.id === selectedId);
        if (location) {
          onChange(location.address, location.id, undefined, undefined, location.delivery_fee);
        }
      }}
      disabled={disabled}
    >
      <SelectTrigger className={cn("bg-background", className)}>
        <SelectValue placeholder={placeholder || `Select ${type} location`}>
          {selectedLocation && (
            <div className="flex items-center justify-between w-full gap-2">
              <span className="truncate">{selectedLocation.name}</span>
              {selectedLocation.delivery_fee > 0 && (
                <span className="text-xs font-medium text-amber-600 flex-shrink-0">
                  + {formatCurrency(selectedLocation.delivery_fee, tenant?.currency_code)}
                </span>
              )}
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {locations.map((location) => (
          <SelectItem key={location.id} value={location.id} className="py-3">
            <div className="flex items-center justify-between w-full gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium">{location.name}</p>
                <p className="text-xs text-muted-foreground truncate">{location.address}</p>
              </div>
              {location.delivery_fee > 0 && (
                <span className="text-xs font-semibold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full flex-shrink-0">
                  + {formatCurrency(location.delivery_fee, tenant?.currency_code)}
                </span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Format currency with proper symbol
 */
function formatCurrency(amount: number, currencyCode?: string | null): string {
  const currency = currencyCode || 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
