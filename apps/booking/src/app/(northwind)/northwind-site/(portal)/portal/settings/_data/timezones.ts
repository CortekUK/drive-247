/**
 * The timezone picker's options.
 *
 * Ported from `apps/booking/src/lib/timezones.ts`, same IANA identifiers in the
 * same order, because `customers.timezone` already holds these exact strings —
 * a row written by v1 has to keep resolving to a label here or the customer's
 * saved choice would silently render as raw text.
 *
 * Deliberately NOT the full IANA database. Drive247's operators are US and UK,
 * and a 400-entry list is a worse control than a 22-entry one: the customer is
 * telling us which clock to show their pickup time on, not filing a bug against
 * tzdata. `resolveTimezoneLabel` below is what keeps an unrecognised value —
 * seeded, or set before this list existed — readable rather than blank.
 */

export interface TimezoneOption {
  /** IANA identifier, e.g. "America/New_York". This is what is stored. */
  value: string;
  label: string;
}

export interface TimezoneGroup {
  label: string;
  timezones: readonly TimezoneOption[];
}

const USA_TIMEZONES: readonly TimezoneOption[] = [
  // Eastern
  { value: "America/New_York", label: "Eastern Time (New York)" },
  { value: "America/Detroit", label: "Eastern Time (Detroit)" },
  {
    value: "America/Indiana/Indianapolis",
    label: "Eastern Time (Indianapolis)",
  },
  {
    value: "America/Kentucky/Louisville",
    label: "Eastern Time (Louisville)",
  },
  // Central
  { value: "America/Chicago", label: "Central Time (Chicago)" },
  { value: "America/Menominee", label: "Central Time (Menominee)" },
  { value: "America/Indiana/Knox", label: "Central Time (Knox, Indiana)" },
  {
    value: "America/North_Dakota/Center",
    label: "Central Time (North Dakota)",
  },
  // Mountain
  { value: "America/Denver", label: "Mountain Time (Denver)" },
  { value: "America/Boise", label: "Mountain Time (Boise)" },
  {
    value: "America/Phoenix",
    label: "Mountain Standard Time (Phoenix — no DST)",
  },
  // Pacific
  { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
  // Alaska
  { value: "America/Anchorage", label: "Alaska Time (Anchorage)" },
  { value: "America/Juneau", label: "Alaska Time (Juneau)" },
  { value: "America/Nome", label: "Alaska Time (Nome)" },
  { value: "America/Sitka", label: "Alaska Time (Sitka)" },
  { value: "America/Yakutat", label: "Alaska Time (Yakutat)" },
  // Hawaii / Aleutians
  { value: "Pacific/Honolulu", label: "Hawaii Time (Honolulu — no DST)" },
  { value: "America/Adak", label: "Hawaii-Aleutian Time (Adak)" },
] as const;

const UK_TIMEZONES: readonly TimezoneOption[] = [
  { value: "Europe/London", label: "United Kingdom (London)" },
] as const;

export const TIMEZONE_GROUPS: readonly TimezoneGroup[] = [
  { label: "United States", timezones: USA_TIMEZONES },
  { label: "United Kingdom", timezones: UK_TIMEZONES },
] as const;

const ALL_TIMEZONES: readonly TimezoneOption[] = [
  ...USA_TIMEZONES,
  ...UK_TIMEZONES,
];

export function findTimezone(value: string): TimezoneOption | undefined {
  return ALL_TIMEZONES.find((zone) => zone.value === value);
}

/**
 * The browser's own timezone, but only when it is one this picker offers.
 *
 * Used as the SUGGESTED value when the customer has never chosen one — never
 * auto-saved. Writing a preference the customer did not express is how a
 * traveller ends up permanently pinned to the airport they signed up in.
 */
export function detectTimezone(): string | null {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return findTimezone(detected) ? detected : null;
  } catch {
    return null;
  }
}

/**
 * Append the CURRENT UTC offset to a timezone's label — "Eastern Time
 * (New York) · GMT-4".
 *
 * `shortOffset` is resolved at render time rather than stored, so the label
 * follows daylight saving instead of going an hour wrong for half the year.
 * Falls back to the bare label if the runtime cannot format the zone.
 */
export function timezoneOffsetLabel(zone: TimezoneOption): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone.value,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    const offset = parts.find((part) => part.type === "timeZoneName")?.value;
    return offset ? `${zone.label} · ${offset}` : zone.label;
  } catch {
    return zone.label;
  }
}

/**
 * What to show for a stored value.
 *
 * A value we do not recognise is echoed back rather than dropped: it is still
 * the customer's saved setting, and rendering an empty picker over a non-empty
 * column would invite them to "fix" it by overwriting something valid.
 */
export function resolveTimezoneLabel(value: string): string {
  const found = findTimezone(value);
  return found ? timezoneOffsetLabel(found) : value;
}
