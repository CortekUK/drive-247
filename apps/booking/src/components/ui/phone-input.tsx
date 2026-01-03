"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

// Common country codes with flags
const COUNTRY_CODES = [
    { code: "+44", country: "GB", flag: "🇬🇧", name: "United Kingdom" },
    { code: "+1", country: "US", flag: "🇺🇸", name: "United States" },
    { code: "+1", country: "CA", flag: "🇨🇦", name: "Canada" },
    { code: "+353", country: "IE", flag: "🇮🇪", name: "Ireland" },
    { code: "+49", country: "DE", flag: "🇩🇪", name: "Germany" },
    { code: "+33", country: "FR", flag: "🇫🇷", name: "France" },
    { code: "+34", country: "ES", flag: "🇪🇸", name: "Spain" },
    { code: "+39", country: "IT", flag: "🇮🇹", name: "Italy" },
    { code: "+31", country: "NL", flag: "🇳🇱", name: "Netherlands" },
    { code: "+32", country: "BE", flag: "🇧🇪", name: "Belgium" },
    { code: "+41", country: "CH", flag: "🇨🇭", name: "Switzerland" },
    { code: "+43", country: "AT", flag: "🇦🇹", name: "Austria" },
    { code: "+46", country: "SE", flag: "🇸🇪", name: "Sweden" },
    { code: "+47", country: "NO", flag: "🇳🇴", name: "Norway" },
    { code: "+45", country: "DK", flag: "🇩🇰", name: "Denmark" },
    { code: "+48", country: "PL", flag: "🇵🇱", name: "Poland" },
    { code: "+351", country: "PT", flag: "🇵🇹", name: "Portugal" },
    { code: "+61", country: "AU", flag: "🇦🇺", name: "Australia" },
    { code: "+64", country: "NZ", flag: "🇳🇿", name: "New Zealand" },
    { code: "+91", country: "IN", flag: "🇮🇳", name: "India" },
    { code: "+92", country: "PK", flag: "🇵🇰", name: "Pakistan" },
    { code: "+971", country: "AE", flag: "🇦🇪", name: "United Arab Emirates" },
    { code: "+966", country: "SA", flag: "🇸🇦", name: "Saudi Arabia" },
    { code: "+65", country: "SG", flag: "🇸🇬", name: "Singapore" },
    { code: "+852", country: "HK", flag: "🇭🇰", name: "Hong Kong" },
    { code: "+81", country: "JP", flag: "🇯🇵", name: "Japan" },
    { code: "+82", country: "KR", flag: "🇰🇷", name: "South Korea" },
    { code: "+86", country: "CN", flag: "🇨🇳", name: "China" },
    { code: "+55", country: "BR", flag: "🇧🇷", name: "Brazil" },
    { code: "+52", country: "MX", flag: "🇲🇽", name: "Mexico" },
    { code: "+27", country: "ZA", flag: "🇿🇦", name: "South Africa" },
    { code: "+234", country: "NG", flag: "🇳🇬", name: "Nigeria" },
    { code: "+254", country: "KE", flag: "🇰🇪", name: "Kenya" },
    { code: "+20", country: "EG", flag: "🇪🇬", name: "Egypt" },
] as const;

interface PhoneInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
    value?: string;
    onChange?: (value: string) => void;
    defaultCountry?: string;
    error?: boolean;
}

/**
 * Phone input component with country code selector
 * Combines a dropdown for country code selection with a phone number input
 */
export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
    ({ className, value = "", onChange, defaultCountry = "GB", error, ...props }, ref) => {
        // Parse the current value to extract country code and number
        const parseValue = (val: string): { countryCode: string; number: string } => {
            if (!val) return { countryCode: getDefaultCode(), number: "" };

            // Find matching country code
            const matchedCountry = COUNTRY_CODES.find(c => val.startsWith(c.code));
            if (matchedCountry) {
                return {
                    countryCode: matchedCountry.code,
                    number: val.slice(matchedCountry.code.length).trim(),
                };
            }

            // If starts with +, assume it's a country code we don't know
            if (val.startsWith("+")) {
                const firstSpaceOrDigit = val.slice(1).search(/\s|\d{4}/);
                if (firstSpaceOrDigit > 0) {
                    return {
                        countryCode: val.slice(0, firstSpaceOrDigit + 2),
                        number: val.slice(firstSpaceOrDigit + 2).trim(),
                    };
                }
            }

            return { countryCode: getDefaultCode(), number: val };
        };

        const getDefaultCode = () => {
            const defaultEntry = COUNTRY_CODES.find(c => c.country === defaultCountry);
            return defaultEntry?.code || "+44";
        };

        const [selectedCountryCode, setSelectedCountryCode] = React.useState(() => {
            const parsed = parseValue(value);
            return parsed.countryCode;
        });

        const [phoneNumber, setPhoneNumber] = React.useState(() => {
            const parsed = parseValue(value);
            return parsed.number;
        });

        // Update internal state when external value changes
        React.useEffect(() => {
            const parsed = parseValue(value);
            setSelectedCountryCode(parsed.countryCode);
            setPhoneNumber(parsed.number);
        }, [value]);

        const handleCountryChange = (code: string) => {
            setSelectedCountryCode(code);
            const newValue = phoneNumber ? `${code}${phoneNumber}` : "";
            onChange?.(newValue);
        };

        const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            // Only allow digits, spaces, and hyphens in the number part
            const raw = e.target.value;
            const cleaned = raw.replace(/[^\d\s\-]/g, "");
            setPhoneNumber(cleaned);
            const newValue = cleaned ? `${selectedCountryCode}${cleaned}` : "";
            onChange?.(newValue);
        };

        // Get the selected country's flag
        const selectedCountry = COUNTRY_CODES.find(c => c.code === selectedCountryCode);
        const displayFlag = selectedCountry?.flag || "🌍";

        return (
            <div className={cn("flex gap-2", className)}>
                {/* Country Code Selector */}
                <Select value={selectedCountryCode} onValueChange={handleCountryChange}>
                    <SelectTrigger
                        className={cn(
                            "w-[100px] flex-shrink-0",
                            error && "border-destructive focus-visible:ring-destructive"
                        )}
                    >
                        <SelectValue>
                            <span className="flex items-center gap-1.5">
                                <span className="text-base">{displayFlag}</span>
                                <span className="text-sm">{selectedCountryCode}</span>
                            </span>
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                        {COUNTRY_CODES.map((country, index) => (
                            <SelectItem
                                key={`${country.country}-${index}`}
                                value={country.code}
                                className="cursor-pointer"
                            >
                                <span className="flex items-center gap-2">
                                    <span className="text-base">{country.flag}</span>
                                    <span className="text-sm font-medium">{country.code}</span>
                                    <span className="text-xs text-muted-foreground">{country.name}</span>
                                </span>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {/* Phone Number Input */}
                <Input
                    ref={ref}
                    type="tel"
                    value={phoneNumber}
                    onChange={handleNumberChange}
                    placeholder="Phone number"
                    className={cn(
                        "flex-1",
                        error && "border-destructive focus-visible:ring-destructive"
                    )}
                    {...props}
                />
            </div>
        );
    }
);

PhoneInput.displayName = "PhoneInput";

export default PhoneInput;
