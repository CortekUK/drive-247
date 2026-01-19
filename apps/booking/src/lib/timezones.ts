/**
 * Timezone list for USA and UK
 * Each timezone includes IANA identifier and display label
 */

export interface TimezoneOption {
  value: string;       // IANA timezone identifier (e.g., "America/New_York")
  label: string;       // Display label (e.g., "Eastern Time (New York)")
  region: 'usa' | 'uk';
}

/**
 * USA Timezones (all states covered)
 */
export const USA_TIMEZONES: TimezoneOption[] = [
  // Eastern Time
  { value: 'America/New_York', label: 'Eastern Time (New York)', region: 'usa' },
  { value: 'America/Detroit', label: 'Eastern Time (Detroit)', region: 'usa' },
  { value: 'America/Indiana/Indianapolis', label: 'Eastern Time (Indianapolis)', region: 'usa' },
  { value: 'America/Kentucky/Louisville', label: 'Eastern Time (Louisville)', region: 'usa' },

  // Central Time
  { value: 'America/Chicago', label: 'Central Time (Chicago)', region: 'usa' },
  { value: 'America/Menominee', label: 'Central Time (Menominee)', region: 'usa' },
  { value: 'America/Indiana/Knox', label: 'Central Time (Knox, Indiana)', region: 'usa' },
  { value: 'America/North_Dakota/Center', label: 'Central Time (North Dakota)', region: 'usa' },

  // Mountain Time
  { value: 'America/Denver', label: 'Mountain Time (Denver)', region: 'usa' },
  { value: 'America/Boise', label: 'Mountain Time (Boise)', region: 'usa' },
  { value: 'America/Phoenix', label: 'Mountain Standard Time (Phoenix - No DST)', region: 'usa' },

  // Pacific Time
  { value: 'America/Los_Angeles', label: 'Pacific Time (Los Angeles)', region: 'usa' },

  // Alaska Time
  { value: 'America/Anchorage', label: 'Alaska Time (Anchorage)', region: 'usa' },
  { value: 'America/Juneau', label: 'Alaska Time (Juneau)', region: 'usa' },
  { value: 'America/Nome', label: 'Alaska Time (Nome)', region: 'usa' },
  { value: 'America/Sitka', label: 'Alaska Time (Sitka)', region: 'usa' },
  { value: 'America/Yakutat', label: 'Alaska Time (Yakutat)', region: 'usa' },

  // Hawaii Time
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (Honolulu - No DST)', region: 'usa' },

  // Aleutian Islands
  { value: 'America/Adak', label: 'Hawaii-Aleutian Time (Adak)', region: 'usa' },
];

/**
 * UK Timezones
 */
export const UK_TIMEZONES: TimezoneOption[] = [
  { value: 'Europe/London', label: 'United Kingdom (London)', region: 'uk' },
];

/**
 * All timezones combined, grouped by region
 */
export const ALL_TIMEZONES: TimezoneOption[] = [
  ...USA_TIMEZONES,
  ...UK_TIMEZONES,
];

/**
 * Get timezones grouped by region for UI display
 */
export function getTimezonesByRegion(): { region: string; label: string; timezones: TimezoneOption[] }[] {
  return [
    { region: 'usa', label: 'United States', timezones: USA_TIMEZONES },
    { region: 'uk', label: 'United Kingdom', timezones: UK_TIMEZONES },
  ];
}

/**
 * Find a timezone by its IANA identifier
 */
export function findTimezone(value: string): TimezoneOption | undefined {
  return ALL_TIMEZONES.find(tz => tz.value === value);
}

/**
 * Get the browser's detected timezone if it's in our list
 * Falls back to a default if not found
 */
export function getDetectedTimezone(fallback: string = 'America/Chicago'): string {
  try {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const found = ALL_TIMEZONES.find(tz => tz.value === browserTz);
    return found ? browserTz : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Get a formatted display string for a timezone
 * Includes current UTC offset
 */
export function getTimezoneDisplayLabel(timezone: string): string {
  const found = findTimezone(timezone);
  if (!found) return timezone;

  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');
    const offset = offsetPart?.value || '';

    return `${found.label} (${offset})`;
  } catch {
    return found.label;
  }
}
