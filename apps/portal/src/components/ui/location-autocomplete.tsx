'use client';

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2 } from "lucide-react";

interface LocationAutocompleteProps {
  id?: string;
  value: string;
  onChange: (value: string, lat?: number, lon?: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

interface PhotonResult {
  place_id: number;
  display_name: string;
  name: string;
  lat: string;
  lon: string;
  country?: string;
}

export function LocationAutocomplete({
  id,
  value,
  onChange,
  placeholder = "Enter address",
  className,
  disabled = false
}: LocationAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<PhotonResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();

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

    setLoading(true);
    try {
      // Using Photon API - biased to Los Angeles, USA
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
        const results = data.features.map((feature: any) => ({
          place_id: feature.properties.osm_id,
          display_name: [
            feature.properties.name,
            feature.properties.street,
            feature.properties.city || feature.properties.county,
            feature.properties.state,
            feature.properties.postcode,
            feature.properties.country
          ].filter(Boolean).join(', '),
          name: feature.properties.name || '',
          lat: feature.geometry.coordinates[1].toString(),
          lon: feature.geometry.coordinates[0].toString(),
          country: feature.properties.country,
        }));

        // Prioritize USA addresses
        const sortedResults = results.sort((a: any, b: any) => {
          const aIsUSA = a.country === 'United States' || a.country === 'USA';
          const bIsUSA = b.country === 'United States' || b.country === 'USA';

          if (aIsUSA && !bIsUSA) return -1;
          if (!aIsUSA && bIsUSA) return 1;
          return 0;
        });

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
    const sanitized = inputValue.replace(/[^a-zA-Z0-9\s,.\-']/g, '');
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

  const handleSelectSuggestion = (suggestion: PhotonResult) => {
    onChange(suggestion.display_name, parseFloat(suggestion.lat), parseFloat(suggestion.lon));
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const formatSuggestion = (result: PhotonResult) => {
    const parts = result.display_name.split(', ');
    const mainText = parts[0] || result.name;
    const secondaryText = parts.slice(1).join(', ');
    return { mainText, secondaryText };
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
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
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-auto">
          {suggestions.map((suggestion) => {
            const { mainText, secondaryText } = formatSuggestion(suggestion);
            return (
              <button
                key={suggestion.place_id}
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-accent flex items-start gap-2 transition-colors border-b border-border/50 last:border-0"
                onClick={() => handleSelectSuggestion(suggestion)}
              >
                <MapPin className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{mainText}</div>
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
}

export default LocationAutocomplete;
