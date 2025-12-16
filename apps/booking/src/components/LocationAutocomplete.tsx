import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2 } from "lucide-react";

interface LocationAutocompleteProps {
  id: string;
  value: string;
  onChange: (value: string, lat?: number, lon?: number) => void;
  placeholder: string;
  className?: string;
  disabled?: boolean;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  name: string;
  lat: string;
  lon: string;
  address?: {
    road?: string;
    city?: string;
    county?: string;
    postcode?: string;
  };
}

const LocationAutocomplete = ({
  id,
  value,
  onChange,
  placeholder,
  className,
  disabled = false
}: LocationAutocompleteProps) => {
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Close suggestions when clicking outside
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

    setLoading(true);
    try {
      // Using Photon API (powered by Komoot) - Free, no API key, better CORS support
      // Biasing results to Los Angeles (lat: 34.05, lon: -118.24)
      const response = await fetch(
        `https://photon.komoot.io/api/?` +
        `q=${encodeURIComponent(inputValue)}&` +
        `limit=10&` +
        `lang=en&` +
        `lat=34.05&` +
        `lon=-118.24`
      );

      if (response.ok) {
        const data = await response.json();
        // Convert Photon format to our format
        const results = data.features.map((feature: any) => ({
          place_id: feature.properties.osm_id,
          display_name: [
            feature.properties.name,
            feature.properties.street,
            feature.properties.city || feature.properties.county,
            feature.properties.postcode,
            feature.properties.country
          ].filter(Boolean).join(', '),
          name: feature.properties.name || '',
          lat: feature.geometry.coordinates[1].toString(),
          lon: feature.geometry.coordinates[0].toString(),
          country: feature.properties.country,
        }));

        // Sort results to prioritize US/California addresses
        const sortedResults = results.sort((a: any, b: any) => {
          const aIsCA = a.country === 'United States' || a.country === 'USA';
          const bIsCA = b.country === 'United States' || b.country === 'USA';

          if (aIsCA && !bIsCA) return -1;
          if (!aIsCA && bIsCA) return 1;
          return 0;
        });

        // Limit to 5 results after sorting
        setSuggestions(sortedResults.slice(0, 5));
        setShowSuggestions(sortedResults.length > 0);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    } catch (error) {
      console.error("Error fetching location suggestions:", error);
      setSuggestions([]);
      setShowSuggestions(false);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (inputValue: string) => {
    // Sanitize input: allow letters, numbers, spaces, commas, hyphens, apostrophes, and periods
    const sanitized = inputValue.replace(/[^a-zA-Z0-9\s,.\-']/g, '');
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
    // Show existing suggestions when focusing if there are any and input has text
    if (value.length >= 3 && suggestions.length > 0) {
      setShowSuggestions(true);
    } else if (value.length >= 3) {
      // Fetch suggestions if we have enough text but no suggestions
      fetchSuggestions(value);
    }
  };

  const handleSelectSuggestion = (suggestion: NominatimResult) => {
    onChange(suggestion.display_name, parseFloat(suggestion.lat), parseFloat(suggestion.lon));
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const formatSuggestion = (result: NominatimResult) => {
    const parts = result.display_name.split(', ');
    const mainText = parts[0] || result.name;
    const secondaryText = parts.slice(1).join(', ');

    return { mainText, secondaryText };
  };

  return (
    <div ref={wrapperRef} className="relative">
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
            const { mainText, secondaryText } = formatSuggestion(suggestion);
            return (
              <button
                key={suggestion.place_id}
                type="button"
                className="w-full px-4 py-3 text-left hover:bg-accent/10 flex items-start gap-3 transition-colors border-b border-border/50 last:border-0"
                onClick={() => handleSelectSuggestion(suggestion)}
              >
                <MapPin className="w-4 h-4 mt-1 text-accent flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {mainText}
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
    </div>
  );
};

export default LocationAutocomplete;
