import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2, LocateFixed } from "lucide-react";
import { useGoogleMapsLoader } from "@/hooks/useGoogleMapsLoader";
import { PlacesSessionManager } from "@/lib/google-places-session";

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

interface Suggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
  lat?: number;
  lng?: number;
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
  const { isLoaded } = useGoogleMapsLoader();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();
  const sessionManager = useRef(new PlacesSessionManager());

  const getCenterCoords = useCallback(() => {
    if (centerLat && centerLon) {
      return { lat: centerLat, lon: centerLon };
    }
    return null;
  }, [centerLat, centerLon]);

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
    if (!inputValue || inputValue.length < 3 || !isLoaded) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const center = getCenterCoords();

    setLoading(true);
    try {
      const request: google.maps.places.AutocompleteRequest = {
        input: inputValue,
        sessionToken: sessionManager.current.getToken(),
        includedRegionCodes: ["us"],
      };

      // Add location bias if we have center coordinates
      if (center) {
        request.locationBias = new google.maps.Circle({
          center: { lat: center.lat, lng: center.lon },
          radius: radiusKm * 1000,
        });
      }

      const { suggestions: autocompleteSuggestions } =
        await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);

      // We need coordinates for filtering, so refresh session and fetch details
      sessionManager.current.refreshToken();

      const detailsPromises = autocompleteSuggestions.slice(0, 10).map(async (s) => {
        const prediction = s.placePrediction!;
        const suggestion: Suggestion = {
          placeId: prediction.placeId,
          mainText: prediction.mainText!.text,
          secondaryText: prediction.secondaryText?.text || "",
          fullText: prediction.text.text,
        };

        try {
          const place = new google.maps.places.Place({ id: prediction.placeId });
          await place.fetchFields({ fields: ["location", "formattedAddress"] });

          if (place.location) {
            suggestion.lat = place.location.lat();
            suggestion.lng = place.location.lng();
            suggestion.fullText = place.formattedAddress || suggestion.fullText;

            if (center) {
              suggestion.distance = haversineDistance(
                center.lat,
                center.lon,
                suggestion.lat,
                suggestion.lng
              );
            }
          }
        } catch {
          // Skip places we can't get details for
        }

        return suggestion;
      });

      let results = await Promise.all(detailsPromises);

      // Filter by radius if we have a center point
      if (center) {
        results = results
          .filter((s) => s.distance !== undefined && s.distance <= radiusKm)
          .sort((a, b) => a.distance! - b.distance!);
      }

      // Limit to 5 results
      results = results.slice(0, 5);

      setSuggestions(results);
      setShowSuggestions(true);
    } catch (error) {
      console.error(
        "[LocationAutocompleteWithRadius] Error fetching suggestions:",
        error
      );
      setSuggestions([]);
      setShowSuggestions(false);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (inputValue: string) => {
    const sanitized = inputValue.replace(/[^a-zA-Z0-9\s,.\-']/g, "");
    onChange(sanitized);

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

  const handleSelectSuggestion = (suggestion: Suggestion) => {
    // Coordinates were already fetched during prediction filtering
    onChange(suggestion.fullText, suggestion.lat, suggestion.lng);
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
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.placeId}
              type="button"
              className="w-full px-4 py-3 text-left hover:bg-accent/10 flex items-start gap-3 transition-colors border-b border-border/50 last:border-0"
              onClick={() => handleSelectSuggestion(suggestion)}
            >
              <MapPin className="w-4 h-4 mt-1 text-accent flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground truncate">
                    {suggestion.mainText}
                  </span>
                  {suggestion.distance !== undefined && (
                    <span className="text-xs text-accent font-medium whitespace-nowrap">
                      {formatDistance(suggestion.distance)}
                    </span>
                  )}
                </div>
                {suggestion.secondaryText && (
                  <div className="text-xs text-muted-foreground truncate">
                    {suggestion.secondaryText}
                  </div>
                )}
              </div>
            </button>
          ))}
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
