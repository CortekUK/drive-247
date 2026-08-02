// ---------------------------------------------------------------------------
// COPIED from supabase/functions/create-sales-onboarding/index.ts.
//
// These helpers are byte-faithful copies, not a fork. They were duplicated
// rather than extracted because create-sales-onboarding is the deployed,
// battle-tested provisioner behind the Sales tab and the extraction could not
// be deployed or smoke-tested in the environment this was written in — an
// untested refactor of that function is a larger risk than this duplication.
//
// FOLLOW-UP (do this once both functions can be deployed and smoke-tested
// together): delete the local copies in create-sales-onboarding/index.ts and
// import from here instead. Until then, ANY FIX MADE IN ONE FILE MUST BE MADE
// IN THE OTHER. The source line range for each function is on its own comment.
// ---------------------------------------------------------------------------

// Field caps — the columns are unbounded `text`, but a 5,000-character company
// name would wreck every downstream email subject, sidebar and <title>.
// src: create-sales-onboarding/index.ts:40-50
export const MAX = {
  companyName: 100,
  firstName: 60,
  email: 254,
  phone: 40,
  short: 120,
  location: 200,
  colours: 300,
  url: 2048,
  notes: 5000,
} as const;

// src: create-sales-onboarding/index.ts:52
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Uppercase the first char, leave the rest untouched. */
// src: create-sales-onboarding/index.ts:91-93
export function capitalizeFirst(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Trim, strip control characters, collapse runs of whitespace and clip.
 * Unicode is preserved (the columns are `text`) — this only kills the things
 * that break rendering: NULs, tabs, stray newlines and unbounded length.
 */
// src: create-sales-onboarding/index.ts:100-107
export function clean(value: unknown, max: number, multiline = false): string {
  if (typeof value !== "string") return "";
  const stripped = multiline
    ? value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ").replace(/[^\S\n]+/g, " ")
    : value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ");
  return stripped.trim().slice(0, max);
}

/** `clean`, but empty becomes null so nullable text columns stay NULL. */
// src: create-sales-onboarding/index.ts:109-111
export function cleanOrNull(value: unknown, max: number, multiline = false): string | null {
  return clean(value, max, multiline) || null;
}

/**
 * Canonical subdomain form: lowercase, `[a-z0-9-]` only, no repeated hyphens
 * and no leading/trailing hyphen. Those are illegal DNS labels, so a slug like
 * `acme rentals!!` -> `acme-rentals--` would produce a hostname that never
 * resolves.
 */
// src: create-sales-onboarding/index.ts:120-126
export function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Only http(s) — a `javascript:`/`data:` "logo" must never reach an <img src>. */
// src: create-sales-onboarding/index.ts:129-136
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Digits plus an optional leading `+`. We deliberately do NOT guess a country
 * code — a wrong prefix silently breaks SMS/WhatsApp delivery later.
 */
// src: create-sales-onboarding/index.ts:142-145
export function normalizePhone(raw: string): string {
  const plus = raw.trim().startsWith("+") ? "+" : "";
  return plus + raw.replace(/\D/g, "");
}

/** Postgres unique_violation — used to close the slug check/insert race. */
// src: create-sales-onboarding/index.ts:148-150
export function isUniqueViolation(err: { code?: string } | null | undefined): boolean {
  return err?.code === "23505";
}

// ---------------------------------------------------------------------------
// Operating hours.
//
// The form captures hours as one free-text line ("Mon–Sat 9am–6pm"), but the
// portal and booking site read the STRUCTURED columns
// ({day}_enabled/_open/_close + working_hours_*). Storing only the free text
// leaves the tenant on the platform defaults, so their booking site advertises
// hours they never gave us.
// src: create-sales-onboarding/index.ts:166-334
// ---------------------------------------------------------------------------
const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const DAY_ALIASES: Record<string, number> = {
  mon: 0,
  monday: 0,
  tue: 1,
  tues: 1,
  tuesday: 1,
  wed: 2,
  weds: 2,
  wednesday: 2,
  thu: 3,
  thur: 3,
  thurs: 3,
  thursday: 3,
  fri: 4,
  friday: 4,
  sat: 5,
  saturday: 5,
  sun: 6,
  sunday: 6,
};

/** "6pm" | "18:00" | "6:30 p.m." -> "18:00:00". Null when unparseable. */
function parseTime(raw: string): string | null {
  const s = raw.trim();
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const min = ampm[2] || "00";
    if (h > 12) return null;
    const pm = /p/i.test(ampm[3]);
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${min}:00`;
  }
  const h24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const h = parseInt(h24[1], 10);
    const m = parseInt(h24[2], 10);
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  }
  return null;
}

/** Which weekday indexes the text names. Empty => "no idea", caller opens all 7. */
function parseOpenDays(text: string): number[] {
  if (/\b(every ?day|all week|7 days|daily|7\s*days?\s*a\s*week)\b/i.test(text)) {
    return [0, 1, 2, 3, 4, 5, 6];
  }
  const open = new Set<number>();
  const dayWord =
    "(mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)";

  // Ranges first ("Mon–Sat", "Monday to Friday").
  const rangeRe = new RegExp(`\\b${dayWord}\\s*(?:-|–|—|to|through|thru)\\s*${dayWord}\\b`, "gi");
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(text)) !== null) {
    const from = DAY_ALIASES[m[1].toLowerCase()];
    const to = DAY_ALIASES[m[2].toLowerCase()];
    // Wrap forward so "Sat-Mon" means Sat, Sun, Mon.
    for (let i = from;; i = (i + 1) % 7) {
      open.add(i);
      if (i === to) break;
    }
  }

  // Then any standalone day names ("Mon, Wed and Fri").
  const singleRe = new RegExp(`\\b${dayWord}\\b`, "gi");
  while ((m = singleRe.exec(text)) !== null) {
    open.add(DAY_ALIASES[m[1].toLowerCase()]);
  }

  return [...open];
}

// src: create-sales-onboarding/index.ts:229
// WIDENED while copying: the original is `Record<string, string | boolean>`,
// but scheduleToHourCols legitimately writes `business_hours: null` when no
// display text was given. The original compiles only because that function has
// `ignoreBuildErrors`-style latitude inside a single file; `null` is added here
// so the type tells the truth. No runtime behaviour differs.
export type HourCols = Record<string, string | boolean | null>;

/**
 * Free-text hours -> the structured tenants.* columns.
 * Returns `{}` when nothing usable was given so the tenant keeps its defaults.
 */
// src: create-sales-onboarding/index.ts:235-276
export function parseOperatingHours(text: string): HourCols {
  if (!text) return {};

  const dayCols = (
    open: string,
    close: string,
    alwaysOpen: boolean,
    openDays: number[],
  ): HourCols => {
    const cols: HourCols = {};
    DAY_KEYS.forEach((day, i) => {
      const enabled = openDays.includes(i);
      cols[`${day}_enabled`] = enabled;
      cols[`${day}_open`] = open;
      cols[`${day}_close`] = close;
    });
    return {
      ...cols,
      working_hours_enabled: true,
      working_hours_always_open: alwaysOpen,
      working_hours_open: open,
      working_hours_close: close,
    };
  };

  const allDays = [0, 1, 2, 3, 4, 5, 6];

  if (/24\s*\/\s*7|24x7|24 hours|always open|round the clock/i.test(text)) {
    return { business_hours: "Open 24/7", ...dayCols("00:00:00", "23:59:00", true, allDays) };
  }

  const range = text.match(
    /(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|\d{1,2}:\d{2})\s*(?:-|–|—|to|till|until)\s*(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|\d{1,2}:\d{2})/i,
  );
  if (!range) {
    // Hours were given but we can't read them — keep the free text for humans
    // and leave the structured columns on their defaults rather than guessing.
    return { business_hours: text };
  }

  const open = parseTime(range[1]);
  const close = parseTime(range[2]);
  if (!open || !close || open === close) return { business_hours: text };

  const named = parseOpenDays(text);
  return { business_hours: text, ...dayCols(open, close, false, named.length ? named : allDays) };
}

/**
 * Opening hours the form collected as STRUCTURED values (days ticked, times
 * picked from a list) rather than free text.
 *
 * Preferred over parseOperatingHours(): there is nothing to interpret, so
 * "9-6", "nine to five" and "Mon-Sat" can never be mis-read. Returns null when
 * the payload is absent or unusable so the caller can fall back to parsing.
 */
// src: create-sales-onboarding/index.ts:286-334
export function scheduleToHourCols(
  schedule:
    | { alwaysOpen?: boolean; days?: string[]; opensAt?: string; closesAt?: string }
    | undefined
    | null,
  displayText: string,
): HourCols | null {
  if (!schedule || typeof schedule !== "object") return null;

  const alwaysOpen = schedule.alwaysOpen === true;
  // "HH:MM" from the picker -> "HH:MM:SS" as the columns store it.
  // RANGE-checked, not just shape-checked: the targets are Postgres `time`
  // columns, so a shape-valid but impossible value like "99:99" does not merely
  // store nonsense — it throws on INSERT and aborts the whole provisioning run.
  // Returning null here instead makes it fall back to text parsing.
  const toSql = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const m = v.match(/^(\d{2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return `${v}:00`;
  };

  const open = alwaysOpen ? "00:00:00" : toSql(schedule.opensAt);
  const close = alwaysOpen ? "23:59:00" : toSql(schedule.closesAt);
  if (!open || !close) return null;

  const days = Array.isArray(schedule.days) ? schedule.days : [];
  const openIdx = DAY_KEYS.map((d, i) => (alwaysOpen || days.includes(d) ? i : -1)).filter(
    (i) => i >= 0,
  );
  // No day selected and not 24/7 => nothing meaningful to store.
  if (openIdx.length === 0) return null;

  const cols: HourCols = {};
  DAY_KEYS.forEach((day, i) => {
    cols[`${day}_enabled`] = openIdx.includes(i);
    cols[`${day}_open`] = open;
    cols[`${day}_close`] = close;
  });

  return {
    ...cols,
    business_hours: displayText || (alwaysOpen ? "Open 24/7" : null),
    working_hours_enabled: true,
    working_hours_always_open: alwaysOpen,
    working_hours_open: open,
    working_hours_close: close,
  };
}

// ---------------------------------------------------------------------------
// Timezone.
//
// tenants.timezone drives the "open now" badge, the working-hours booking gate,
// every pickup/return time the customer sees and every overdue/reminder cron.
// Left on the column default (America/New_York) a Los Angeles operator runs
// three hours out and has no way to work out why.
// src: create-sales-onboarding/index.ts:347-428
// ---------------------------------------------------------------------------
const US_STATE_TZ: Record<string, [string, string]> = {
  AL: ["alabama", "America/Chicago"],
  AK: ["alaska", "America/Anchorage"],
  AZ: ["arizona", "America/Phoenix"],
  AR: ["arkansas", "America/Chicago"],
  CA: ["california", "America/Los_Angeles"],
  CO: ["colorado", "America/Denver"],
  CT: ["connecticut", "America/New_York"],
  DE: ["delaware", "America/New_York"],
  FL: ["florida", "America/New_York"],
  GA: ["georgia", "America/New_York"],
  HI: ["hawaii", "Pacific/Honolulu"],
  ID: ["idaho", "America/Boise"],
  IL: ["illinois", "America/Chicago"],
  IN: ["indiana", "America/Indiana/Indianapolis"],
  IA: ["iowa", "America/Chicago"],
  KS: ["kansas", "America/Chicago"],
  KY: ["kentucky", "America/New_York"],
  LA: ["louisiana", "America/Chicago"],
  ME: ["maine", "America/New_York"],
  MD: ["maryland", "America/New_York"],
  MA: ["massachusetts", "America/New_York"],
  MI: ["michigan", "America/Detroit"],
  MN: ["minnesota", "America/Chicago"],
  MS: ["mississippi", "America/Chicago"],
  MO: ["missouri", "America/Chicago"],
  MT: ["montana", "America/Denver"],
  NE: ["nebraska", "America/Chicago"],
  NV: ["nevada", "America/Los_Angeles"],
  NH: ["new hampshire", "America/New_York"],
  NJ: ["new jersey", "America/New_York"],
  NM: ["new mexico", "America/Denver"],
  NY: ["new york", "America/New_York"],
  NC: ["north carolina", "America/New_York"],
  ND: ["north dakota", "America/Chicago"],
  OH: ["ohio", "America/New_York"],
  OK: ["oklahoma", "America/Chicago"],
  OR: ["oregon", "America/Los_Angeles"],
  PA: ["pennsylvania", "America/New_York"],
  RI: ["rhode island", "America/New_York"],
  SC: ["south carolina", "America/New_York"],
  SD: ["south dakota", "America/Chicago"],
  TN: ["tennessee", "America/Chicago"],
  TX: ["texas", "America/Chicago"],
  UT: ["utah", "America/Denver"],
  VT: ["vermont", "America/New_York"],
  VA: ["virginia", "America/New_York"],
  WA: ["washington", "America/Los_Angeles"],
  WV: ["west virginia", "America/New_York"],
  WI: ["wisconsin", "America/Chicago"],
  WY: ["wyoming", "America/Denver"],
  DC: ["district of columbia", "America/New_York"],
};

// Non-US anchors we actually sell into. Deliberately short, and free of names
// that are also US cities (Birmingham AL, Manchester NH, Melbourne FL…) — a
// wrong timezone is worse than the default.
const REGION_TZ: Array<[RegExp, string]> = [
  [/\b(australia|new south wales|sydney)\b/i, "Australia/Sydney"],
  [/\b(united kingdom|great britain|england|scotland|wales|london|u\.?k\.?)\b/i, "Europe/London"],
  [/\b(ireland|dublin)\b/i, "Europe/Dublin"],
  [/\b(dubai|abu dhabi|sharjah|u\.?a\.?e\.?|united arab emirates)\b/i, "Asia/Dubai"],
  [/\b(toronto|ottawa|ontario)\b/i, "America/Toronto"],
  [/\b(vancouver|british columbia)\b/i, "America/Vancouver"],
];

/**
 * Best-effort IANA timezone for a free-text location ("Los Angeles, CA").
 * Returns null when we cannot tell — the caller then leaves the DB default.
 */
// src: create-sales-onboarding/index.ts:384-428
export function deriveTimezone(location: string | null): string | null {
  if (!location) return null;
  const text = location.trim();
  if (!text) return null;

  // DC first: "Washington, DC" would otherwise match Washington STATE (Pacific).
  if (/\b(washington,?\s*d\.?\s?c\.?|district of columbia)\b/i.test(text)) return "America/New_York";

  // State abbreviations before anything else: a US location almost always
  // carries one ("London, KY"), so this settles the city names that exist on
  // both sides of the Atlantic. Matched CASE-SENSITIVELY against the original
  // text so the words "or"/"in"/"me" are never read as Oregon/Indiana/Maine.
  //
  // WHICH abbreviation wins matters: "LA, CA" contains both Louisiana and
  // California, and taking the FIRST hit put a Los Angeles operator on Central
  // time (two hours out, with no way to work out why). In the "City, ST" form
  // the state comes LAST and directly after a comma, so:
  //   1. an abbreviation sitting in the comma-anchored state slot beats a bare
  //      one anywhere else ("LA, CA" -> CA; "Kansas City, KS near MO" -> KS),
  //   2. otherwise the last hit wins ("Dallas TX").
  let abbrevTz: string | null = null;
  let abbrevAnchored = false;
  for (const m of text.matchAll(/\b[A-Z]{2}\b/g)) {
    const hit = US_STATE_TZ[m[0]];
    if (!hit) continue;
    const anchored = /,\s*$/.test(text.slice(0, m.index ?? 0));
    if (anchored || !abbrevAnchored) {
      abbrevTz = hit[1];
      abbrevAnchored = abbrevAnchored || anchored;
    }
  }
  if (abbrevTz) return abbrevTz;

  for (const [re, tz] of REGION_TZ) {
    if (re.test(text)) return tz;
  }

  // Full state names, longest first so "West Virginia" wins over "Virginia".
  const byName = Object.values(US_STATE_TZ).sort((a, b) => b[0].length - a[0].length);
  for (const [name, tz] of byName) {
    if (new RegExp(`\\b${name}\\b`, "i").test(text)) return tz;
  }

  return null;
}

/** Symbol/prefix for a client-facing amount line. */
// src: create-sales-onboarding/index.ts:871-885
export function currencySymbol(currency: string): string {
  switch (currency.toLowerCase()) {
    case "usd":
      return "$";
    case "gbp":
      return "£";
    case "eur":
      return "€";
    case "aed":
      return "AED ";
    default:
      return currency.toUpperCase() + " ";
  }
}

/** Dollars from cents, dropping a trailing ".00" for clean copy. */
// src: create-sales-onboarding/index.ts:887-890
export function formatDollars(amountCents: number): string {
  const dollars = amountCents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

// ---------------------------------------------------------------------------
// NEW — does not exist anywhere server-side today.
// ---------------------------------------------------------------------------

/**
 * Subdomains that resolve to their own Vercel deployments, plus the operational
 * names we must keep free. A tenant minted on one of these gets a hostname that
 * serves a DIFFERENT app — `portal.drive-247.com` is the portal deployment, so
 * a tenant with slug "portal" would have a booking site that is actually the
 * portal, and a "portal" tenant's portal URL would be
 * `portal.portal.drive-247.com`.
 *
 * Mirrors apps/portal/src/middleware.ts and apps/booking/src/middleware.ts,
 * which are the ONLY places this list existed until now — both client-side, and
 * therefore not a control. `create-sales-onboarding` does not check it at all.
 */
export const RESERVED_SLUGS: readonly string[] = [
  "www",
  "admin",
  "portal",
  "api",
  "app",
  "bonzah",
  "staging",
  "dev",
  "test",
  "mail",
  "ftp",
  "cdn",
  "assets",
  "static",
  "status",
  "support",
  "help",
  "blog",
  "docs",
  "auth",
  "login",
];

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug.trim().toLowerCase());
}

/**
 * Up to `limit` alternatives to an unavailable slug, each verified free.
 *
 * One round trip: build every candidate, ask which of them already exist, and
 * return the ones that do not. Suggestions that are reserved or malformed are
 * dropped rather than offered and then rejected on submit.
 */
export async function suggestSlugs(
  supabase: any,
  base: string,
  limit = 3,
): Promise<string[]> {
  const root = normalizeSlug(base).slice(0, 40).replace(/-+$/g, "");
  if (!root) return [];

  const candidates: string[] = [];
  const push = (s: string) => {
    const norm = normalizeSlug(s);
    if (
      norm.length >= 3 &&
      norm.length <= 50 &&
      /^[a-z][a-z0-9-]*$/.test(norm) &&
      !isReservedSlug(norm) &&
      norm !== base &&
      !candidates.includes(norm)
    ) {
      candidates.push(norm);
    }
  };

  push(`${root}-rentals`);
  push(`${root}-cars`);
  for (let n = 1; n <= 9 && candidates.length < limit + 6; n++) push(`${root}${n}`);

  if (!candidates.length) return [];

  try {
    const { data, error } = await supabase
      .from("tenants")
      .select("slug")
      .in("slug", candidates);
    if (error) throw error;
    const taken = new Set((data || []).map((t: { slug: string }) => t.slug));
    return candidates.filter((c) => !taken.has(c)).slice(0, limit);
  } catch (e) {
    // Suggestions are a nicety. A failed lookup must never turn "that slug is
    // taken" into a 500 — the user can still type another one themselves.
    console.warn("[tenant-provisioning] slug suggestion lookup failed (non-fatal):", e);
    return [];
  }
}
