import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2, LocateFixed } from "lucide-react";

interface LocationAutocompleteWithRadiusProps {
  id: string;
  value: string;
  onChange: (value: string, lat?: number, lon?: number) => void;
  placeholder: string;
  className?: string;
  disabled?: boolean;
  radiusKm: number;
  centerLat?: number | null;
  centerLon?: number | null;
}

interface PhotonResult {
  place_id: number;
  display_name: string;
  name: string;
  lat: string;
  lon: string;
  distance?: number;
}

// Haversine formula to calculate distance between two coordinates
const haversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const LocationAutocompleteWithRadius = ({
  id,
  value,
  onChange,
  placeholder,
  className,
  disabled = false,
  radiusKm,
  centerLat,
  centerLon,
}: LocationAutocompleteWithRadiusProps) => {
  const [suggestions, setSuggestions] = useState<PhotonResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();

  // Get configured center coordinates
  const getCenterCoords = useCallback(() => {
    if (centerLat && centerLon) {
      return { lat: centerLat, lon: centerLon };
    }
    return null;
  }, [centerLat, centerLon]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchSuggestions = async (inputValue: string) => {
    if (!inputValue || inputValue.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const center = getCenterCoords();

    setLoading(true);
    try {
      // Build API URL - with or without location bias
      let apiUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(inputValue)}&limit=20&lang=en`;

      // Add location bias if we have coordinates
      if (center) {
        apiUrl += `&lat=${center.lat}&lon=${center.lon}`;
      }

      const response = await fetch(apiUrl);

      if (response.ok) {
        const data = await response.json();
        // Convert Photon format to our format
        let results: PhotonResult[] = data.features.map((feature: any) => {
          const lat = feature.geometry.coordinates[1];
          const lon = feature.geometry.coordinates[0];
          const distance = center
            ? haversineDistance(center.lat, center.lon, lat, lon)
            : undefined;

          return {
            place_id: feature.properties.osm_id,
            display_name: [
              feature.properties.name,
              feature.properties.street,
              feature.properties.city || feature.properties.county,
              feature.properties.postcode,
              feature.properties.country,
            ]
              .filter(Boolean)
              .join(", "),
            name: feature.properties.name || "",
            lat: lat.toString(),
            lon: lon.toString(),
            distance,
          };
        });

        // Filter by radius if we have a center point configured
        if (center) {
          results = results
            .filter((result: PhotonResult) => result.distance! <= radiusKm)
            .sort((a: PhotonResult, b: PhotonResult) => a.distance! - b.distance!);
        }

        // Limit to 5 results
        results = results.slice(0, 5);

        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    } catch (error) {
      console.error("[LocationAutocompleteWithRadius] Error fetching suggestions:", error);
      setSuggestions([]);
      setShowSuggestions(false);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (inputValue: string) => {
    // Sanitize input
    const sanitized = inputValue.replace(/[^a-zA-Z0-9\s,.\-']/g, "");
    onChange(sanitized);

    // Debounce API calls
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      fetchSuggestions(sanitized);
    }, 300);
  };

  const handleFocus = () => {
    if (value.length >= 3 && suggestions.length > 0) {
      setShowSuggestions(true);
    } else if (value.length >= 3) {
      fetchSuggestions(value);
    }
  };

  const handleSelectSuggestion = (suggestion: PhotonResult) => {
    onChange(suggestion.display_name, parseFloat(suggestion.lat), parseFloat(suggestion.lon));
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const formatDistance = (km: number): string => {
    if (km < 1) {
      return `${Math.round(km * 1000)}m`;
    }
    return `${km.toFixed(1)}km`;
  };

  const center = getCenterCoords();

  return (
    <div ref={wrapperRef} className="relative">
      {/* Location status indicator */}
      {center && (
        <div className="flex items-center gap-2 mb-2 text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <LocateFixed className="w-3 h-3 text-accent" />
            Searching within {radiusKm}km of service area
          </span>
        </div>
      )}

      <div className="relative h-auto">
        <Input
          id={id}
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={placeholder}
          className={className}
          autoComplete="off"
          disabled={disabled}
        />
        {loading && (
          <div className="absolute right-3 top-0 bottom-0 flex items-center pointer-events-none">
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          </div>
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-auto left-0 top-full">
          {suggestions.map((suggestion) => {
            const mainText = suggestion.display_name.split(", ")[0] || suggestion.name;
            const secondaryText = suggestion.display_name.split(", ").slice(1).join(", ");

            return (
              <button
                key={suggestion.place_id}
                type="button"
                className="w-full px-4 py-3 text-left hover:bg-accent/10 flex items-start gap-3 transition-colors border-b border-border/50 last:border-0"
                onClick={() => handleSelectSuggestion(suggestion)}
              >
                <MapPin className="w-4 h-4 mt-1 text-accent flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                      {mainText}
                    </span>
                    {suggestion.distance !== undefined && (
                      <span className="text-xs text-accent font-medium whitespace-nowrap">
                        {formatDistance(suggestion.distance)}
                      </span>
                    )}
                  </div>
                  {secondaryText && (
                    <div className="text-xs text-muted-foreground truncate">
                      {secondaryText}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Show message when no results within radius */}
      {showSuggestions && suggestions.length === 0 && !loading && value.length >= 3 && center && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg p-4 left-0 top-full">
          <p className="text-sm text-muted-foreground text-center">
            No locations found within {radiusKm}km of your location.
          </p>
        </div>
      )}
    </div>
  );
};

export default LocationAutocompleteWithRadius;
