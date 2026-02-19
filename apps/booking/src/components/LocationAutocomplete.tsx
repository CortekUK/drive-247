import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2 } from "lucide-react";
import { useGoogleMapsLoader } from "@/hooks/useGoogleMapsLoader";
import { PlacesSessionManager } from "@/lib/google-places-session";

interface LocationAutocompleteProps {
  id: string;
  value: string;
  onChange: (value: string, lat?: number, lon?: number) => void;
  placeholder: string;
  className?: string;
  disabled?: boolean;
}

interface Suggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
}

const LocationAutocomplete = ({
  id,
  value,
  onChange,
  placeholder,
  className,
  disabled = false
}: LocationAutocompleteProps) => {
  const { isLoaded } = useGoogleMapsLoader();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();
  const sessionManager = useRef(new PlacesSessionManager());

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

    setLoading(true);
    try {
      const { suggestions: autocompleteSuggestions } =
        await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: inputValue,
          sessionToken: sessionManager.current.getToken(),
        });

      const results: Suggestion[] = autocompleteSuggestions.slice(0, 5).map((s) => ({
        placeId: s.placePrediction!.placeId,
        mainText: s.placePrediction!.mainText!.text,
        secondaryText: s.placePrediction!.secondaryText?.text || "",
        fullText: s.placePrediction!.text.text,
      }));

      setSuggestions(results);
      setShowSuggestions(results.length > 0);
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

  const handleSelectSuggestion = async (suggestion: Suggestion) => {
    try {
      const place = new google.maps.places.Place({ id: suggestion.placeId });
      await place.fetchFields({
        fields: ["formattedAddress", "location"],
      });

      sessionManager.current.refreshToken();

      if (place.location) {
        const address = place.formattedAddress || suggestion.fullText;
        const lat = place.location.lat();
        const lng = place.location.lng();
        onChange(address, lat, lng);
      } else {
        onChange(suggestion.fullText);
      }
    } catch {
      onChange(suggestion.fullText);
    }

    setSuggestions([]);
    setShowSuggestions(false);
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
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.placeId}
              type="button"
              className="w-full px-4 py-3 text-left hover:bg-accent/10 flex items-start gap-3 transition-colors border-b border-border/50 last:border-0"
              onClick={() => handleSelectSuggestion(suggestion)}
            >
              <MapPin className="w-4 h-4 mt-1 text-accent flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {suggestion.mainText}
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
    </div>
  );
};

export default LocationAutocomplete;
