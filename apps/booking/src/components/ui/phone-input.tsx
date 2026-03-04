"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

// Country codes with phone number length rules (digits after country code)
export const COUNTRY_CODES = [
    { code: "+1", country: "US", flag: "🇺🇸", name: "United States", minLen: 10, maxLen: 10 },
    { code: "+44", country: "GB", flag: "🇬🇧", name: "United Kingdom", minLen: 10, maxLen: 10 },
    { code: "+1", country: "CA", flag: "🇨🇦", name: "Canada", minLen: 10, maxLen: 10 },
    { code: "+353", country: "IE", flag: "🇮🇪", name: "Ireland", minLen: 7, maxLen: 9 },
    { code: "+49", country: "DE", flag: "🇩🇪", name: "Germany", minLen: 6, maxLen: 11 },
    { code: "+33", country: "FR", flag: "🇫🇷", name: "France", minLen: 9, maxLen: 9 },
    { code: "+34", country: "ES", flag: "🇪🇸", name: "Spain", minLen: 9, maxLen: 9 },
    { code: "+39", country: "IT", flag: "🇮🇹", name: "Italy", minLen: 9, maxLen: 10 },
    { code: "+31", country: "NL", flag: "🇳🇱", name: "Netherlands", minLen: 9, maxLen: 9 },
    { code: "+32", country: "BE", flag: "🇧🇪", name: "Belgium", minLen: 8, maxLen: 9 },
    { code: "+41", country: "CH", flag: "🇨🇭", name: "Switzerland", minLen: 9, maxLen: 9 },
    { code: "+43", country: "AT", flag: "🇦🇹", name: "Austria", minLen: 7, maxLen: 11 },
    { code: "+46", country: "SE", flag: "🇸🇪", name: "Sweden", minLen: 7, maxLen: 10 },
    { code: "+47", country: "NO", flag: "🇳🇴", name: "Norway", minLen: 8, maxLen: 8 },
    { code: "+45", country: "DK", flag: "🇩🇰", name: "Denmark", minLen: 8, maxLen: 8 },
    { code: "+48", country: "PL", flag: "🇵🇱", name: "Poland", minLen: 9, maxLen: 9 },
    { code: "+351", country: "PT", flag: "🇵🇹", name: "Portugal", minLen: 9, maxLen: 9 },
    { code: "+61", country: "AU", flag: "🇦🇺", name: "Australia", minLen: 9, maxLen: 9 },
    { code: "+64", country: "NZ", flag: "🇳🇿", name: "New Zealand", minLen: 8, maxLen: 9 },
    { code: "+91", country: "IN", flag: "🇮🇳", name: "India", minLen: 10, maxLen: 10 },
    { code: "+92", country: "PK", flag: "🇵🇰", name: "Pakistan", minLen: 10, maxLen: 10 },
    { code: "+971", country: "AE", flag: "🇦🇪", name: "United Arab Emirates", minLen: 7, maxLen: 9 },
    { code: "+966", country: "SA", flag: "🇸🇦", name: "Saudi Arabia", minLen: 9, maxLen: 9 },
    { code: "+65", country: "SG", flag: "🇸🇬", name: "Singapore", minLen: 8, maxLen: 8 },
    { code: "+852", country: "HK", flag: "🇭🇰", name: "Hong Kong", minLen: 8, maxLen: 8 },
    { code: "+81", country: "JP", flag: "🇯🇵", name: "Japan", minLen: 9, maxLen: 10 },
    { code: "+82", country: "KR", flag: "🇰🇷", name: "South Korea", minLen: 9, maxLen: 10 },
    { code: "+86", country: "CN", flag: "🇨🇳", name: "China", minLen: 11, maxLen: 11 },
    { code: "+55", country: "BR", flag: "🇧🇷", name: "Brazil", minLen: 10, maxLen: 11 },
    { code: "+52", country: "MX", flag: "🇲🇽", name: "Mexico", minLen: 10, maxLen: 10 },
    { code: "+27", country: "ZA", flag: "🇿🇦", name: "South Africa", minLen: 9, maxLen: 9 },
    { code: "+234", country: "NG", flag: "🇳🇬", name: "Nigeria", minLen: 7, maxLen: 8 },
    { code: "+254", country: "KE", flag: "🇰🇪", name: "Kenya", minLen: 9, maxLen: 9 },
    { code: "+20", country: "EG", flag: "🇪🇬", name: "Egypt", minLen: 10, maxLen: 10 },
] as const;

interface PhoneInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
    value?: string;
    onChange?: (value: string) => void;
    defaultCountry?: string;
    error?: boolean;
}

/**
 * Phone input component with searchable country code selector
 * and per-country digit length validation
 */
export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
    ({ className, value = "", onChange, defaultCountry = "US", error, ...props }, ref) => {
        const [open, setOpen] = React.useState(false);

        const parseValue = (val: string): { countryKey: string; number: string } => {
            if (!val) return { countryKey: getDefaultKey(), number: "" };

            const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
            const matched = sorted.find(c => val.startsWith(c.code));
            if (matched) {
                return {
                    countryKey: matched.country,
                    number: val.slice(matched.code.length).trim(),
                };
            }

            if (val.startsWith("+")) {
                const firstSpaceOrDigit = val.slice(1).search(/\s|\d{4}/);
                if (firstSpaceOrDigit > 0) {
                    return {
                        countryKey: getDefaultKey(),
                        number: val.slice(firstSpaceOrDigit + 2).trim(),
                    };
                }
            }

            return { countryKey: getDefaultKey(), number: val };
        };

        const getDefaultKey = () => {
            const entry = COUNTRY_CODES.find(c => c.country === defaultCountry);
            return entry?.country || "GB";
        };

        const [selectedKey, setSelectedKey] = React.useState(() => parseValue(value).countryKey);
        const [phoneNumber, setPhoneNumber] = React.useState(() => parseValue(value).number);

        React.useEffect(() => {
            const parsed = parseValue(value);
            setSelectedKey(parsed.countryKey);
            setPhoneNumber(parsed.number);
        }, [value]);

        const selectedCountry = COUNTRY_CODES.find(c => c.country === selectedKey);
        const selectedCode = selectedCountry?.code || "+44";
        const displayFlag = selectedCountry?.flag || "🌍";
        const maxLen = selectedCountry?.maxLen || 12;
        const minLen = selectedCountry?.minLen || 7;

        // Count only digits in the phone number (ignore spaces/hyphens)
        const digitCount = phoneNumber.replace(/[^\d]/g, "").length;

        // Validation state
        const isEmpty = digitCount === 0;
        const isTooShort = !isEmpty && digitCount < minLen;
        const isValid = digitCount >= minLen && digitCount <= maxLen;
        const isTooLong = digitCount > maxLen;

        const handleCountrySelect = (countryKey: string) => {
            setSelectedKey(countryKey);
            setOpen(false);
            const country = COUNTRY_CODES.find(c => c.country === countryKey);
            if (country) {
                const newValue = phoneNumber ? `${country.code}${phoneNumber}` : "";
                onChange?.(newValue);
            }
        };

        const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const raw = e.target.value;
            const cleaned = raw.replace(/[^\d\s\-]/g, "");
            // Block typing beyond max digits
            const cleanedDigits = cleaned.replace(/[^\d]/g, "").length;
            if (cleanedDigits > maxLen) return;

            setPhoneNumber(cleaned);
            const newValue = cleaned ? `${selectedCode}${cleaned}` : "";
            onChange?.(newValue);
        };

        return (
            <div className={cn("space-y-1", className)}>
                <div className="flex gap-2">
                    {/* Searchable Country Code Selector */}
                    <Popover open={open} onOpenChange={setOpen}>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                role="combobox"
                                aria-expanded={open}
                                className={cn(
                                    "flex h-10 w-[110px] flex-shrink-0 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                                    error && "border-destructive focus:ring-destructive"
                                )}
                            >
                                <span className="flex items-center gap-1.5 truncate">
                                    <span className="text-base">{displayFlag}</span>
                                    <span className="text-sm">{selectedCode}</span>
                                </span>
                                <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[280px] p-0" align="start">
                            <Command>
                                <CommandInput placeholder="Search country or code..." />
                                <CommandList>
                                    <CommandEmpty>No country found.</CommandEmpty>
                                    <CommandGroup>
                                        {COUNTRY_CODES.map((country) => (
                                            <CommandItem
                                                key={country.country}
                                                value={`${country.name} ${country.code} ${country.country}`}
                                                onSelect={() => handleCountrySelect(country.country)}
                                            >
                                                <Check
                                                    className={cn(
                                                        "mr-2 h-4 w-4 flex-shrink-0",
                                                        selectedKey === country.country ? "opacity-100" : "opacity-0"
                                                    )}
                                                />
                                                <span className="text-base mr-2">{country.flag}</span>
                                                <span className="text-sm font-medium mr-2">{country.code}</span>
                                                <span className="text-xs text-muted-foreground truncate">{country.name}</span>
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>

                    {/* Phone Number Input */}
                    <div className="flex-1 relative">
                        <Input
                            ref={ref}
                            type="tel"
                            value={phoneNumber}
                            onChange={handleNumberChange}
                            placeholder="Phone number"
                            className={cn(
                                "pr-16",
                                error && "border-destructive focus-visible:ring-destructive",
                                !isEmpty && isTooShort && "border-yellow-500 focus-visible:ring-yellow-500",
                                isTooLong && "border-destructive focus-visible:ring-destructive",
                                isValid && "border-green-500 focus-visible:ring-green-500",
                            )}
                            {...props}
                        />
                        {/* Digit counter */}
                        {!isEmpty && (
                            <span
                                className={cn(
                                    "absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium pointer-events-none",
                                    isTooShort && "text-yellow-500",
                                    isValid && "text-green-500",
                                    isTooLong && "text-destructive",
                                )}
                            >
                                {digitCount}/{minLen === maxLen ? maxLen : `${minLen}-${maxLen}`}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        );
    }
);

PhoneInput.displayName = "PhoneInput";

export default PhoneInput;
