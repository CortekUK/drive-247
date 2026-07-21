// =============================================================================
// create-sales-onboarding
//
// One-shot super-admin / sales-agent provisioning for George's Sales tab.
// Given a filled onboarding form it:
//   1. verifies the caller (super admin OR sales agent),
//   2. validates + normalises every field BEFORE anything is written,
//   3. guards slug + email uniqueness (fixes a real duplicate-credential bug),
//   4. extracts brand colours from free text -> full tenant palette,
//   5. inserts the tenant with its OWN identity (app_name / meta / hours / tz),
//   6. grants 100 live welcome credits,
//   7. creates the head_admin auth user + app_user,
//   8. creates the live 0-day subscription plan (the hard paywall),
//   9. writes + publishes the tenant's booking-site CMS content,
//  10. records the submission (best-effort), and
//  11. returns a ready-to-send client message with the login details.
//
// Everything after the tenant insert is fully rolled back on failure so a
// half-provisioned tenant (or a password that won't work) never reaches George.
//
// Validation is deliberately front-loaded: every check that can fail (slug,
// email, amount, currency, logo URL, phone) runs before the tenant insert so a
// typo costs a 400, never a provision-then-rollback.
// =============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { extractBrandColorsFromText, buildTenantPalette } from "../_shared/brand-colors.ts";
import { getSubscriptionStripeClientForAccount } from "../_shared/subscription-stripe.ts";

const LOG = "[create-sales-onboarding]";

// Stripe rejects unit_amount outside this range. Guarded up front so a typo
// ("30000" instead of "300") can't cost a full provision + rollback.
const MIN_AMOUNT_CENTS = 50;
const MAX_AMOUNT_CENTS = 99_999_999;

// Field caps — the columns are unbounded `text`, but a 5,000-character company
// name would wreck every downstream email subject, sidebar and <title>.
const MAX = {
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Opening hours as the sales form now collects them: days ticked, times picked
 * from a fixed list. Sent ALONGSIDE `operatingHours` (the human-readable form),
 * and preferred over parsing that text. Optional so older clients still work.
 */
interface OperatingSchedule {
  alwaysOpen?: boolean;
  /** tenants.* day prefixes: "monday" … "sunday". */
  days?: string[];
  /** "HH:MM", 24-hour. */
  opensAt?: string;
  closesAt?: string;
}

interface OnboardingRequest {
  companyName?: string;
  firstName?: string;
  slug?: string;
  contactEmail?: string;
  businessPhone?: string;
  vehicleType?: string;
  fleetSize?: string;
  location?: string;
  operatingHours?: string;
  operatingSchedule?: OperatingSchedule;
  businessColours?: string;
  logoUrl?: string;
  wantsMarketing?: boolean;
  hasMetaAdAccount?: boolean;
  metaDailyBudget?: string;
  otherInfo?: string;
  tenantType?: "production" | "test";
  subscriptionAmount?: number;
  subscriptionCurrency?: string;
}

/** Uppercase the first char, leave the rest untouched. */
function capitalizeFirst(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Trim, strip control characters, collapse runs of whitespace and clip.
 * Unicode is preserved (the columns are `text`) — this only kills the things
 * that break rendering: NULs, tabs, stray newlines and unbounded length.
 */
function clean(value: unknown, max: number, multiline = false): string {
  if (typeof value !== "string") return "";
  const stripped = multiline
    ? value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ").replace(/[^\S\n]+/g, " ")
    : value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ");
  return stripped.trim().slice(0, max);
}

/** `clean`, but empty becomes null so nullable text columns stay NULL. */
function cleanOrNull(value: unknown, max: number, multiline = false): string | null {
  return clean(value, max, multiline) || null;
}

/**
 * Canonical subdomain form: lowercase, `[a-z0-9-]` only, no repeated hyphens
 * and no leading/trailing hyphen. Those are illegal DNS labels, so a slug like
 * `acme rentals!!` -> `acme-rentals--` would produce a hostname that never
 * resolves. Collapsing hyphens does NOT change the derived password (which is
 * built from the alphanumerics only).
 */
function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Only http(s) — a `javascript:`/`data:` "logo" must never reach an <img src>. */
function isHttpUrl(value: string): boolean {
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
function normalizePhone(raw: string): string {
  const plus = raw.trim().startsWith("+") ? "+" : "";
  return plus + raw.replace(/\D/g, "");
}

/** Postgres unique_violation — used to close the slug check/insert race. */
function isUniqueViolation(err: { code?: string } | null | undefined): boolean {
  return err?.code === "23505";
}

// ---------------------------------------------------------------------------
// Operating hours.
//
// George's form captures hours as one free-text line ("Mon–Sat 9am–6pm"), but
// the portal and booking site read the STRUCTURED columns
// ({day}_enabled/_open/_close + working_hours_*). Storing only the free text
// left every sales-onboarded tenant on the platform defaults, so their booking
// site advertised hours they never gave us.
//
// Ported from scripts/tenant-onboarding.mjs `parseHours()` (the canonical
// implementation) and extended with 24-hour times and day-range detection.
// Anything we cannot parse falls back to the tenant defaults rather than
// inventing hours.
// ---------------------------------------------------------------------------
const DAY_KEYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

const DAY_ALIASES: Record<string, number> = {
  mon: 0, monday: 0, tue: 1, tues: 1, tuesday: 1, wed: 2, weds: 2, wednesday: 2,
  thu: 3, thur: 3, thurs: 3, thursday: 3, fri: 4, friday: 4,
  sat: 5, saturday: 5, sun: 6, sunday: 6,
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
  const dayWord = "(mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)";

  // Ranges first ("Mon–Sat", "Monday to Friday").
  const rangeRe = new RegExp(`\\b${dayWord}\\s*(?:-|–|—|to|through|thru)\\s*${dayWord}\\b`, "gi");
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(text)) !== null) {
    const from = DAY_ALIASES[m[1].toLowerCase()];
    const to = DAY_ALIASES[m[2].toLowerCase()];
    // Wrap forward so "Sat-Mon" means Sat, Sun, Mon.
    for (let i = from; ; i = (i + 1) % 7) {
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

type HourCols = Record<string, string | boolean>;

/**
 * Free-text hours -> the structured tenants.* columns.
 * Returns `{}` when nothing usable was given so the tenant keeps its defaults.
 */
function parseOperatingHours(text: string): HourCols {
  if (!text) return {};

  const dayCols = (open: string, close: string, alwaysOpen: boolean, openDays: number[]): HourCols => {
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
 * Opening hours the sales form collected as STRUCTURED values (days ticked,
 * times picked from a list) rather than free text.
 *
 * Preferred over parseOperatingHours(): there is nothing to interpret, so
 * "9-6", "nine to five" and "Mon-Sat" can never be mis-read. Returns null when
 * the payload is absent or unusable so the caller can fall back to parsing.
 */
function scheduleToHourCols(
  schedule: OperatingSchedule | undefined,
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
// three hours out and has no way to work out why — so we derive it from the
// free-text Location the same way scripts/tenant-onboarding.mjs derives it from
// its `state` field. When the location tells us nothing we leave the column
// default alone rather than guessing.
// ---------------------------------------------------------------------------
const US_STATE_TZ: Record<string, [string, string]> = {
  // abbrev -> [full name, IANA tz] (ported from scripts/tenant-onboarding.mjs)
  AL: ["alabama", "America/Chicago"], AK: ["alaska", "America/Anchorage"], AZ: ["arizona", "America/Phoenix"],
  AR: ["arkansas", "America/Chicago"], CA: ["california", "America/Los_Angeles"], CO: ["colorado", "America/Denver"],
  CT: ["connecticut", "America/New_York"], DE: ["delaware", "America/New_York"], FL: ["florida", "America/New_York"],
  GA: ["georgia", "America/New_York"], HI: ["hawaii", "Pacific/Honolulu"], ID: ["idaho", "America/Boise"],
  IL: ["illinois", "America/Chicago"], IN: ["indiana", "America/Indiana/Indianapolis"], IA: ["iowa", "America/Chicago"],
  KS: ["kansas", "America/Chicago"], KY: ["kentucky", "America/New_York"], LA: ["louisiana", "America/Chicago"],
  ME: ["maine", "America/New_York"], MD: ["maryland", "America/New_York"], MA: ["massachusetts", "America/New_York"],
  MI: ["michigan", "America/Detroit"], MN: ["minnesota", "America/Chicago"], MS: ["mississippi", "America/Chicago"],
  MO: ["missouri", "America/Chicago"], MT: ["montana", "America/Denver"], NE: ["nebraska", "America/Chicago"],
  NV: ["nevada", "America/Los_Angeles"], NH: ["new hampshire", "America/New_York"], NJ: ["new jersey", "America/New_York"],
  NM: ["new mexico", "America/Denver"], NY: ["new york", "America/New_York"], NC: ["north carolina", "America/New_York"],
  ND: ["north dakota", "America/Chicago"], OH: ["ohio", "America/New_York"], OK: ["oklahoma", "America/Chicago"],
  OR: ["oregon", "America/Los_Angeles"], PA: ["pennsylvania", "America/New_York"], RI: ["rhode island", "America/New_York"],
  SC: ["south carolina", "America/New_York"], SD: ["south dakota", "America/Chicago"], TN: ["tennessee", "America/Chicago"],
  TX: ["texas", "America/Chicago"], UT: ["utah", "America/Denver"], VT: ["vermont", "America/New_York"],
  VA: ["virginia", "America/New_York"], WA: ["washington", "America/Los_Angeles"], WV: ["west virginia", "America/New_York"],
  WI: ["wisconsin", "America/Chicago"], WY: ["wyoming", "America/Denver"], DC: ["district of columbia", "America/New_York"],
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
function deriveTimezone(location: string | null): string | null {
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

// ---------------------------------------------------------------------------
// Booking-site CMS content.
//
// The seed_cms_pages_for_tenant trigger creates ten EMPTY page shells, all in
// 'draft'. The booking site only reads published pages in production, so a
// tenant with no sections falls through to the app's hard-coded defaults —
// which are Drive247's own copy: Drive247's phone number and info@drive247.com
// on the client's homepage, "Why Choose Drive247", a 20% promo badge nobody
// authorised, and "Drive247 is committed to protecting your privacy" in the
// client's own Privacy Policy. That is what path A (tenant-onboarding.mjs)
// fixes, and it is the single biggest gap between the two paths.
//
// Structure + section keys are ported from scripts/tenant-onboarding.mjs
// generateContent() — they are the exact shapes the booking components read.
// The copy, however, states ONLY what the onboarding form actually told us.
// Nothing about the operator's fleet, inclusions, prices, insurance, mileage or
// history is invented, because every one of those is a contractual claim on the
// client's own website. Everything here is editable in Portal → CMS.
// ---------------------------------------------------------------------------
interface ContentVars {
  name: string;
  location: string | null;
  phoneHref: string;  // tel: target — "" when no phone was given
  phoneLabel: string; // as the client wrote it — "" when no phone was given
  email: string;
  hours: string;      // business_hours as stored — "" when none
  logoUrl: string;
  year: number;
  today: string;      // YYYY-MM-DD
}

function buildCmsContent(t: ContentVars): Record<string, Record<string, unknown>> {
  const at = t.location ? ` in ${t.location}` : "";
  const serving = t.location ? ` throughout ${t.location} and the surrounding area` : " in the areas we serve";
  // Every phone CTA is rendered unconditionally by the booking components, and a
  // blank one falls back to Drive247's number — so when no phone was given we
  // point the customer at the booking flow instead.
  const callCta = t.phoneLabel ? `Call ${t.phoneLabel}` : "Book Online";

  return {
    home: {
      home_hero: {
        headline: `Car Rentals with ${t.name}`,
        subheading: `Quality vehicles and straightforward pricing${at}.`,
        background_image: "",
        phone_number: t.phoneHref,
        phone_cta_text: callCta,
        book_cta_text: "Book Your Ride",
        trust_line: "Quality Fleet • Clear Pricing • Local Service",
      },
      // Off by default — the app's fallback badge advertises "20% OFF when you
      // book online", a discount the operator never agreed to and checkout will
      // not honour. They switch it on from the CMS once they have a real offer.
      promo_badge: { enabled: false, discount_amount: "", discount_label: "OFF", line1: "", line2: "" },
      service_highlights: {
        title: `Why Choose ${t.name}?`,
        subtitle: "Straightforward rentals, handled by a local team.",
        // Icon names must exist in the booking components' icon maps, otherwise
        // they silently fall back to a generic one.
        services: [
          { icon: "Car", title: "Well-Maintained Vehicles", description: "Our fleet is looked after so it is ready when you are." },
          { icon: "CheckCircle", title: "Transparent Pricing", description: "The rate you see at booking is the rate you pay." },
          { icon: "MapPin", title: t.location ? `${t.location} and Nearby` : "Local Service", description: `Convenient service${serving}.` },
          { icon: "Clock", title: "Flexible Durations", description: "Daily, weekly and monthly rentals to fit your schedule." },
          { icon: "Shield", title: "Book Online Securely", description: "Reserve, pay and manage your rental online." },
          { icon: "Headphones", title: "Personal Support", description: "Talk to the people who actually run the fleet." },
        ],
      },
      booking_header: {
        title: "Book Your Rental",
        subtitle: `Pick your dates and vehicle — we'll take care of the rest${at}.`,
        trust_points: [t.location || "Local Service", "Transparent Rates", "Quality Vehicles"],
      },
      testimonials_header: { title: `What Customers Say About ${t.name}` },
      home_cta: {
        title: `Ready to Book with ${t.name}?`,
        description: `Reliable car rentals${at} with clear pricing and friendly service.`,
        primary_cta_text: "Book Now",
        secondary_cta_text: "Get in Touch",
        trust_points: ["Reliable Service", "Clean Vehicles", "Clear Rates"],
      },
      contact_card: {
        title: "Have Questions?",
        description: "We're here to help. Reach out for quick answers and booking support.",
        phone_number: t.phoneHref,
        email: t.email,
        call_button_text: "Call Now",
        email_button_text: "Email Us",
      },
      seo: {
        title: `${t.name} — Car Rentals${at}`,
        description: `Rent a car with ${t.name}${at}. Quality vehicles, clear pricing and easy online booking.`,
        keywords: [`${t.name}`, "car rental", t.location ? `car rental ${t.location}` : "", "car hire"].filter(Boolean).join(", "),
      },
    },
    about: {
      hero: { title: `About ${t.name}`, subtitle: `Car rentals${at}, run by a team that knows the area.` },
      about_story: {
        title: "Quality Rentals, Fair Prices",
        // The About component renders "Founded in {founded_year}" and hard-codes
        // "2010" when this is blank — so it cannot be left empty. We write the
        // year the operator came online rather than inventing a history; they
        // correct it in the CMS if the business is older.
        founded_year: String(t.year),
        content: `<p>${t.name} provides car rentals${at} for everyday driving, work trips and longer stays.</p>
<p>We keep it simple: a clear rate, a vehicle that is ready when you arrive, and someone to talk to if anything changes.</p>
<p>Daily, weekly and monthly rentals are available, and you can book, pay and manage your rental online.</p>
<p>Questions before you book? Get in touch — we're happy to help you pick the right vehicle.</p>`,
      },
      // All four tiles read live data (rentals, vehicles, ratings) — nothing here
      // is a hard-coded number.
      stats: {
        items: [
          { icon: "clock", label: "YEARS EXPERIENCE", value: "", suffix: "+", use_dynamic: true, dynamic_source: "years_experience" },
          { icon: "car", label: "RENTALS COMPLETED", value: "", suffix: "+", use_dynamic: true, dynamic_source: "total_rentals" },
          { icon: "crown", label: "VEHICLES", value: "", suffix: "+", use_dynamic: true, dynamic_source: "active_vehicles" },
          { icon: "star", label: "CLIENT RATING", value: "", suffix: "", use_dynamic: true, dynamic_source: "avg_rating" },
        ],
      },
      why_choose_us: {
        title: `Why Choose ${t.name}`,
        items: [
          { icon: "car", title: "Quality Fleet", description: "Well-maintained vehicles you can rely on." },
          { icon: "check", title: "Clear Pricing", description: "The rate you see at booking is the rate you pay." },
          {
            icon: "clock",
            title: "Convenient Hours",
            description: t.hours
              ? `${/^\s*open\b/i.test(t.hours) ? t.hours : "Open " + t.hours}. We work around your schedule.`
              : "Get in touch to arrange a pickup time that suits you.",
          },
          { icon: "phone", title: "Local Service", description: `Proudly serving${serving}.` },
        ],
      },
      faq_cta: { title: "Still have questions?", description: "Our team is happy to help.", button_text: callCta },
      final_cta: {
        title: `Ready to Rent with ${t.name}?`,
        description: "Book your rental today and see how easy it can be.",
        tagline: "Reliable • Local • Straightforward",
      },
      seo: {
        title: `About Us — ${t.name}`,
        description: `Learn about ${t.name} and our car rental service${at}.`,
        keywords: [`about ${t.name}`, t.location ? `${t.location} car rental company` : "car rental company"].join(", "),
      },
    },
    contact: {
      hero: { title: `Contact ${t.name}`, subtitle: `Get in touch about your rental${at}.` },
      contact_info: {
        phone: { number: t.phoneHref, availability: t.hours || "Contact us for availability" },
        email: { address: t.email, response_time: "We reply as quickly as we can" },
        office: { address: t.location || "" },
        whatsapp: { number: t.phoneHref, description: "Message us for a quick reply" },
      },
      contact_form: {
        title: "Send Us a Message",
        subtitle: "We'll get back to you as soon as possible.",
        success_message: `Thanks for contacting ${t.name} — we'll respond shortly.`,
        gdpr_text: "I consent to being contacted regarding my enquiry.",
        submit_button_text: "Send Message",
        subject_options: ["General Enquiry", "Booking Question", "Vehicle Availability", "Pricing", "Feedback"],
      },
      // No star-rating or "trusted by" badge — we have no reviews to back it up.
      trust_badges: {
        badges: [
          { icon: "lock", label: "Secure Booking", tooltip: "Your details and payment are handled securely" },
          { icon: "clock", label: "Quick Response", tooltip: "We reply to enquiries as quickly as we can" },
          { icon: "shield", label: "Local Team", tooltip: `Managed by the ${t.name} team` },
        ],
      },
      pwa_install: { title: `Install ${t.name}`, description: `Add ${t.name} to your home screen for quick access to bookings.` },
      seo: {
        title: `Contact Us — ${t.name}`,
        description: `Contact ${t.name} about car rentals${at}.`,
        keywords: [`contact ${t.name}`, t.location ? `${t.location} car rental contact` : "car rental contact"].join(", "),
      },
    },
    fleet: {
      fleet_hero: {
        headline: "Our Fleet & Pricing",
        subheading: "Browse our vehicles with daily, weekly and monthly rates.",
        background_image: "",
        primary_cta_text: "Book Now",
        secondary_cta_text: "View Fleet Below",
      },
      rental_rates: {
        section_title: "Flexible Rental Rates",
        daily: { title: "Daily", description: "Ideal for short trips and day use." },
        weekly: { title: "Weekly", description: "Better value for week-long rentals." },
        monthly: { title: "Monthly", description: "Our best rates for extended rentals." },
      },
      // Only platform-level facts. The app's fallback promises "Comprehensive
      // Insurance Coverage", "Full Tank of Premium Fuel" and "Unlimited Mileage"
      // under the operator's name — commitments we cannot make on their behalf.
      inclusions: {
        section_title: `Every ${t.name} Rental Includes`,
        section_subtitle: "What comes as standard when you book with us.",
        standard_title: "Standard Inclusions",
        standard_items: [
          { icon: "Phone", title: "Online Booking & Confirmation" },
          { icon: "Shield", title: "Secure Online Payment" },
          { icon: "FileCheck", title: "Digital Rental Agreement" },
          { icon: "Clock", title: "Daily, Weekly & Monthly Rates" },
          { icon: "Sparkles", title: "Vehicle Prepared for Handover" },
          { icon: "User", title: "Direct Support from Our Team" },
        ],
        premium_title: "Optional Add-ons",
        // Left as a pointer rather than a priced list: the operator has not set
        // up any rental_extras yet, and inventing add-ons at invented prices is
        // worse than showing none.
        premium_items: [{ icon: "Sparkles", title: "Any available extras are shown during booking" }],
      },
      extras: { items: [], footer_text: "Add-ons can be selected during booking." },
      seo: {
        title: `Fleet & Pricing — ${t.name}`,
        description: `Browse the ${t.name} fleet and rental rates${at}.`,
        keywords: [`${t.name} fleet`, "rental pricing", t.location ? `car rental ${t.location}` : "car rental"].join(", "),
      },
    },
    promotions: {
      promotions_hero: {
        headline: "Deals & Promotions",
        subheading: "Any current offers will appear here.",
        primary_cta_text: "View Fleet & Pricing",
        primary_cta_href: "/fleet",
        secondary_cta_text: "Book Now",
      },
      how_it_works: {
        title: "How Promotions Work",
        subtitle: "Three steps to save on your rental",
        steps: [
          { number: "1", title: "Select Offer", description: "Browse our active promotions" },
          { number: "2", title: "Choose Vehicle", description: "Pick from our fleet" },
          { number: "3", title: "Apply at Checkout", description: "Savings are applied automatically" },
        ],
      },
      empty_state: {
        title_active: "No active promotions right now",
        title_default: "No promotions found",
        description: "Check back soon, or browse our Fleet & Pricing for our everyday rates.",
        button_text: "Browse Fleet & Pricing",
      },
      terms: {
        title: "Terms & Conditions",
        terms: [
          "Promotions are subject to availability",
          "Discounts cannot be combined with other offers",
          "Valid for new bookings only",
          "Promo codes must be applied at the time of booking",
          `${t.name} reserves the right to modify or withdraw promotions`,
          "Standard rental terms apply",
        ],
      },
      seo: {
        title: `Deals & Promotions — ${t.name}`,
        description: `Current car rental offers from ${t.name}${at}.`,
        keywords: [`${t.name} deals`, "car rental promotions", "car rental offers"].join(", "),
      },
    },
    reviews: {
      hero: { title: "Customer Reviews", subtitle: `What our customers say about ${t.name}.` },
      feedback_cta: {
        title: "Share your experience",
        description: `We'd love to hear about your rental with ${t.name}.`,
        button_text: "Leave a Review",
        empty_state_message: `Be the first to review ${t.name}!`,
      },
      seo: {
        title: `Customer Reviews — ${t.name}`,
        description: `Read customer reviews of ${t.name}${at}.`,
        keywords: [`${t.name} reviews`, "car rental reviews"].join(", "),
      },
    },
    // Legal pages: a neutral starting point in the OPERATOR's name. The app's
    // fallback puts "Drive247 is committed to protecting your privacy" on their
    // site — the wrong legal entity in the client's own policy. The booking site
    // appends the required SMS disclosure to whatever is stored here.
    privacy: {
      privacy_content: {
        title: "Privacy Policy",
        content: `<h2>Introduction</h2>
<p>${t.name} is committed to protecting your privacy. This policy explains how we handle your information.</p>
<h2>Information We Collect</h2>
<ul><li>Contact details (name, email, phone)</li><li>Booking information (dates, vehicle preferences)</li><li>Identity and licence documents where required to rent</li><li>Payment information (processed securely by our payment provider)</li></ul>
<h2>How We Use Your Information</h2>
<ul><li>Processing and managing your rental bookings</li><li>Communicating with you about your reservation</li><li>Meeting our legal and insurance obligations</li><li>Improving our service</li></ul>
<h2>Sharing</h2>
<p>We do not sell your information. We share it only with the providers needed to deliver your rental (for example payment, e-signature and verification providers) and where the law requires it.</p>
<h2>Contact Us</h2>
<p>For any privacy question, contact us at <a href="mailto:${t.email}">${t.email}</a>.</p>`,
        last_updated: t.today,
      },
      seo: {
        title: `Privacy Policy — ${t.name}`,
        description: `How ${t.name} collects, uses and protects your information.`,
        keywords: "privacy policy, data protection",
      },
    },
    terms: {
      terms_content: {
        title: "Terms of Service",
        content: `<h2>Rental Agreement</h2>
<p>By booking with ${t.name} you agree to these terms and to the rental agreement you sign before collecting a vehicle.</p>
<h2>Booking and Payment</h2>
<ul><li>All bookings are subject to vehicle availability</li><li>Payment is taken through our secure online checkout</li><li>Cancellation and amendment terms are set out in your rental agreement</li></ul>
<h2>Vehicle Use</h2>
<ul><li>A valid driving licence is required for every driver</li><li>Only drivers named on the agreement may drive the vehicle</li><li>The vehicle must be returned in the condition it was collected in</li><li>Please report any damage, fault or incident to us immediately</li></ul>
<h2>Contact</h2>
<p>Questions about these terms? Email <a href="mailto:${t.email}">${t.email}</a>${t.phoneLabel ? ` or call ${t.phoneLabel}` : ""}.</p>`,
        last_updated: t.today,
      },
      seo: {
        title: `Terms of Service — ${t.name}`,
        description: `${t.name} rental terms and conditions.`,
        keywords: "terms of service, rental terms",
      },
    },
    // Header/footer/logo layer. useSiteSettings only applies these when the page
    // is PUBLISHED, otherwise the operator's own CMS edits appear to do nothing.
    // City/state/zip stay blank so the footer keeps tenants.address rather than
    // us splitting a free-text location into fields it may not map to.
    "site-settings": {
      logo: { logo_url: t.logoUrl, logo_alt: t.name, favicon_url: t.logoUrl },
      contact: {
        phone: t.phoneHref,
        phone_display: t.phoneLabel,
        email: t.email,
        address_line1: "",
        address_line2: "",
        city: "",
        state: "",
        zip: "",
        country: "",
        google_maps_url: "",
      },
      social: {},
      footer: {
        copyright_text: `© ${t.year} ${t.name}. All rights reserved.`,
        tagline: t.location ? `Car Rentals in ${t.location}` : "Car Rentals",
      },
      pwa_install: { title: `Install ${t.name}`, description: `Add ${t.name} to your home screen for quick bookings.` },
    },
    // NOTE: 'blog' is intentionally absent — it stays a draft shell so an empty
    // blog page never reaches the live site (same as scripts/tenant-onboarding.mjs).
  };
}

type ServiceClient = ReturnType<typeof createClient>;

/**
 * Write the generated sections onto the trigger-created page shells and publish
 * them. Throws on the first hard failure; the caller treats content as
 * non-fatal (a provisioned tenant with fallback copy beats no tenant at all).
 *
 * `missing` lists the slugs we generated copy for but found no page shell to
 * write it onto. It is what makes the caller's success flag honest: if only the
 * 'site-settings' shell exists we still write sections and publish a page, but
 * every real content page (home, about, contact…) was skipped and the booking
 * site is still serving Drive247's own copy under the client's name.
 */
async function seedTenantCmsContent(
  supabase: ServiceClient,
  tenantId: string,
  content: Record<string, Record<string, unknown>>,
): Promise<{ pages: number; sections: number; missing: string[] }> {
  const now = new Date().toISOString();

  const { data: existing, error: pagesError } = await supabase
    .from("cms_pages")
    .select("id, slug")
    .eq("tenant_id", tenantId);
  if (pagesError) throw pagesError;

  const pageIdBySlug = new Map<string, string>(
    (existing || []).map((p: { id: string; slug: string }): [string, string] => [p.slug, p.id]),
  );

  // seed_cms_pages_for_tenant creates all ten shells, but a project still on the
  // pre-20260720 version of that function has no 'site-settings' page — create
  // it so the footer/logo layer applies either way.
  if (!pageIdBySlug.has("site-settings")) {
    const { data: created, error } = await supabase
      .from("cms_pages")
      .insert({
        tenant_id: tenantId,
        slug: "site-settings",
        name: "Site Settings",
        description: "Global header, footer, logo and social links",
        status: "draft",
      })
      .select("id")
      .single();
    if (error) throw error;
    pageIdBySlug.set("site-settings", created.id);
  }

  const rows: Array<Record<string, unknown>> = [];
  const publishIds: string[] = [];
  const missing: string[] = [];

  for (const [slug, sections] of Object.entries(content)) {
    const pageId = pageIdBySlug.get(slug);
    if (!pageId) {
      // Page shell missing — skip rather than invent one, but report it so the
      // caller never claims the site was seeded when this page was not.
      missing.push(slug);
      continue;
    }
    Object.entries(sections).forEach(([section_key, sectionContent], i) => {
      rows.push({
        page_id: pageId,
        section_key,
        content: sectionContent,
        display_order: i,
        is_visible: true,
        tenant_id: tenantId,
      });
    });
    publishIds.push(pageId);
  }

  // The tenant is brand new, so these are always fresh inserts — one round trip.
  if (rows.length) {
    const { error } = await supabase.from("cms_page_sections").insert(rows);
    if (error) throw error;
  }

  // Publishing is the half that matters: the booking site filters on
  // status='published' in production, so draft pages render the app defaults.
  if (publishIds.length) {
    const { error } = await supabase
      .from("cms_pages")
      .update({ status: "published", published_at: now, updated_at: now })
      .in("id", publishIds);
    if (error) throw error;
  }

  return { pages: publishIds.length, sections: rows.length, missing };
}

/** Symbol/prefix for the client-facing amount line. */
function currencySymbol(currency: string): string {
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
function formatDollars(amountCents: number): string {
  const dollars = amountCents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Service-role client — everything runs with this (bypasses RLS).
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // ---------------------------------------------------------------------
    // 2. Auth — caller must be an active super admin OR sales agent.
    // ---------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return errorResponse("Missing authorization header", 401);
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseAuth = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) {
      return errorResponse("Unauthorized", 401);
    }

    const { data: caller, error: callerError } = await supabase
      .from("app_users")
      .select("id, is_active, is_super_admin, is_sales_agent")
      .eq("auth_user_id", user.id)
      .single();

    if (callerError || !caller) {
      return errorResponse("User not found", 403);
    }
    if (!caller.is_active || !(caller.is_super_admin || caller.is_sales_agent)) {
      return errorResponse("Only super admins or sales agents can onboard tenants", 403);
    }
    const createdBy: string = caller.id;

    // ---------------------------------------------------------------------
    // 3. Validate + sanitize.
    // ---------------------------------------------------------------------
    let body: OnboardingRequest;
    try {
      body = (await req.json()) as OnboardingRequest;
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }
    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", 400);
    }

    const companyName = clean(body.companyName, MAX.companyName);
    const firstName = clean(body.firstName, MAX.firstName);
    // Lowercased so the duplicate check, the auth user and app_users.email all
    // agree (Supabase Auth stores addresses lowercased anyway).
    const contactEmail = clean(body.contactEmail, MAX.email).toLowerCase();
    const rawSlug = clean(body.slug, 100);
    const location = cleanOrNull(body.location, MAX.location);
    const operatingHours = clean(body.operatingHours, MAX.short);
    const businessColours = cleanOrNull(body.businessColours, MAX.colours);
    // +1 so an over-long URL overflows the cap and is rejected below rather
    // than being silently truncated into a broken <img src>.
    const logoUrl = clean(body.logoUrl, MAX.url + 1);
    const rawPhone = clean(body.businessPhone, MAX.phone);
    const tenantType: "production" | "test" = body.tenantType === "test" ? "test" : "production";
    const isProduction = tenantType === "production";
    const currency = (clean(body.subscriptionCurrency, 8) || "usd").toLowerCase();
    const subscriptionAmount = Number(body.subscriptionAmount);

    if (!companyName) {
      return errorResponse("Company name is required", 400);
    }
    if (!contactEmail) {
      return errorResponse("Contact email is required", 400);
    }
    if (!EMAIL_RE.test(contactEmail)) {
      return errorResponse("Contact email is not a valid email address", 400);
    }
    if (!Number.isFinite(subscriptionAmount) || subscriptionAmount <= 0) {
      return errorResponse("Subscription amount must be greater than 0", 400);
    }
    // ISO-4217 shape. An unknown code would only blow up inside Stripe, i.e.
    // AFTER the tenant + login already exist.
    if (!/^[a-z]{3}$/.test(currency)) {
      return errorResponse("Subscription currency must be a 3-letter ISO code (e.g. usd)", 400);
    }

    const slug = normalizeSlug(rawSlug);
    if (!/^[a-z][a-z0-9-]*$/.test(slug) || slug.length < 3 || slug.length > 50) {
      return errorResponse(
        "Slug must start with a letter, be 3–50 characters, and use only lowercase letters, numbers, and hyphens",
        400,
      );
    }
    // The first-login password is capitalizeFirst(<slug alphanumerics>) + "123!",
    // so a slug like "a-b" would yield a 6-char password that Supabase Auth may
    // reject — and we would only find out after the tenant exists.
    const slugAlnum = slug.replace(/[^a-z0-9]/g, "");
    if (slugAlnum.length < 3) {
      return errorResponse("Slug must contain at least 3 letters or numbers", 400);
    }

    // Logos are rendered straight into <img src> on the portal, booking site and
    // signing emails — only absolute http(s) URLs are acceptable.
    if (logoUrl && (!isHttpUrl(logoUrl) || logoUrl.length > MAX.url)) {
      return errorResponse("Logo URL must be a valid http(s) URL", 400);
    }

    // Phone is optional, but a malformed one silently breaks SMS/WhatsApp later.
    const phoneDigits = rawPhone.replace(/\D/g, "");
    if (rawPhone && (phoneDigits.length < 7 || phoneDigits.length > 15)) {
      return errorResponse("Business phone must have between 7 and 15 digits", 400);
    }
    const phoneDisplay = rawPhone || null;
    const phoneE164 = rawPhone ? normalizePhone(rawPhone) : null;

    const amountCents = Math.round(subscriptionAmount * 100);
    if (amountCents < MIN_AMOUNT_CENTS || amountCents > MAX_AMOUNT_CENTS) {
      const sym = currencySymbol(currency);
      return errorResponse(
        `Subscription amount must be between ${sym}${formatDollars(MIN_AMOUNT_CENTS)} and ${sym}${formatDollars(MAX_AMOUNT_CENTS)}`,
        400,
      );
    }

    const portalUrl = `https://${slug}.portal.drive-247.com`;
    const bookingUrl = `https://${slug}.drive-247.com`;

    // Shared field set for the best-effort submission row (created OR failed).
    const submissionBase = {
      created_by: createdBy,
      first_name: firstName || null,
      business_name: companyName,
      slug,
      vehicle_type: cleanOrNull(body.vehicleType, MAX.short),
      // Fleet size is a vehicle COUNT. The dialog validates it, but the client
      // is not a trust boundary — a direct call could otherwise persist "-5" or
      // "banana" into a record the onboarding digest reads as real. Anything
      // that isn't a plain positive whole number is dropped rather than stored.
      fleet_size: (() => {
        const raw = (cleanOrNull(body.fleetSize, MAX.short) || "").trim();
        if (!/^\d+$/.test(raw)) return null;
        const n = Number(raw);
        return n >= 1 && n <= 10_000 ? String(n) : null;
      })(),
      location,
      business_phone: phoneDisplay,
      business_email: contactEmail,
      operating_hours: operatingHours || null,
      business_colours: businessColours,
      logo_url: logoUrl || null,
      wants_marketing: typeof body.wantsMarketing === "boolean" ? body.wantsMarketing : null,
      has_meta_ad_account: typeof body.hasMetaAdAccount === "boolean" ? body.hasMetaAdAccount : null,
      meta_daily_budget: cleanOrNull(body.metaDailyBudget, MAX.short),
      other_info: cleanOrNull(body.otherInfo, MAX.notes, true),
      subscription_amount: amountCents,
      subscription_currency: currency,
      portal_url: portalUrl,
      booking_url: bookingUrl,
    };

    /** Best-effort failed-submission record. Never throws. */
    const recordFailure = async (message: string) => {
      try {
        await supabase.from("sales_onboarding_submissions").insert({
          ...submissionBase,
          status: "failed",
          error_message: message,
        });
      } catch (e) {
        console.error(`${LOG} could not record failed submission:`, e);
      }
    };

    // ---------------------------------------------------------------------
    // 4. Uniqueness guards (fix the known duplicate-credential bug).
    // ---------------------------------------------------------------------
    const { data: existingSlug } = await supabase
      .from("tenants")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existingSlug) {
      return errorResponse("Slug already taken", 409);
    }

    // Business name must be unique too. Unlike the slug there is no DB unique
    // index on company_name, so this check IS the constraint — two tenants
    // sharing a name makes them indistinguishable in the admin lists, in the
    // onboarding digest and in support conversations. Case-insensitive, with
    // an exact JS re-check so an underscore in the name can't wildcard-match.
    const { data: nameMatches } = await supabase
      .from("tenants")
      .select("id, company_name")
      .ilike("company_name", companyName);
    const nameTaken = (nameMatches || []).some(
      (t: { company_name: string | null }) =>
        (t.company_name || "").trim().toLowerCase() === companyName.toLowerCase(),
    );
    if (nameTaken) {
      return errorResponse("Another rental company already uses this name", 409);
    }

    // Case-insensitive email match. `ilike` narrows; JS verifies exactly so a
    // legal underscore in the address can't cause a false duplicate.
    const { data: emailMatches } = await supabase
      .from("app_users")
      .select("id, email")
      .ilike("email", contactEmail);
    const emailTaken = (emailMatches || []).some(
      (u: { email: string | null }) => (u.email || "").toLowerCase() === contactEmail.toLowerCase(),
    );
    if (emailTaken) {
      return errorResponse("An account already exists for this email", 409);
    }

    // ---------------------------------------------------------------------
    // 5. Password (deterministic; client must change on first login).
    // ---------------------------------------------------------------------
    const password = capitalizeFirst(slugAlnum) + "123!";

    // ---------------------------------------------------------------------
    // 6. Brand colours -> full tenant palette.
    // ---------------------------------------------------------------------
    const colors = await extractBrandColorsFromText(businessColours, null);
    const palette = buildTenantPalette(colors);

    // ---------------------------------------------------------------------
    // 7. Insert tenant. AFTER-INSERT triggers auto-grant 1000 test credits +
    //    seed CMS pages (incl. site-settings).
    // ---------------------------------------------------------------------
    // tenantType drives everything that costs real money.
    // NOTE: stripe_mode (booking payments) and bonzah_mode stay on their 'test'
    // DB defaults for BOTH tenant types on purpose — live Stripe Connect and
    // live Bonzah both require per-tenant onboarding that has not happened yet,
    // so flipping them here would break checkout on day one. The tenant turns
    // them on from Portal → Settings once onboarding completes.
    const modeCols = isProduction
      ? { boldsign_mode: "live", subscription_stripe_mode: "live", subscription_account: "uk" }
      : { boldsign_mode: "test", subscription_stripe_mode: "test", subscription_account: "uk" };

    // favicon included: without it the client's browser tab keeps the platform icon.
    const logoCols = logoUrl
      ? { logo_url: logoUrl, dark_logo_url: logoUrl, auth_logo_url: logoUrl, favicon_url: logoUrl }
      : {};

    // Identity. WITHOUT these the tenant inherits the platform defaults —
    // tenants.app_name DEFAULTs to the literal 'Drive 917', which the portal
    // sidebar/login/<title> render verbatim (it is not NULL, so the
    // `app_name || company_name` fallbacks never kick in). Same story for the
    // SEO meta on the booking site.
    const identityCols = {
      app_name: companyName,
      admin_email: contactEmail,
      phone: phoneE164,
      meta_title: location
        ? `${companyName} — Car Rentals in ${location}`
        : `${companyName} — Car Rentals`,
      meta_description: location
        ? `Car rental services from ${companyName} in ${location}.`
        : `Car rental services from ${companyName}.`,
    };

    // Opening hours -> the structured columns the portal/booking site read.
    // Prefer the STRUCTURED payload (days ticked + times picked in the form):
    // there is nothing to interpret, so "9-6" or "Mon-Sat" can't be mis-read.
    // Fall back to parsing the free text for older clients or a malformed
    // schedule, and finally to nothing at all.
    const hourCols =
      scheduleToHourCols(body.operatingSchedule, operatingHours) ??
      parseOperatingHours(operatingHours);

    // Location -> IANA timezone. Only set when we could actually work it out;
    // otherwise the column default (America/New_York) stands, exactly as it does
    // for a script-onboarded tenant whose state we don't recognise.
    const derivedTimezone = deriveTimezone(location);
    const tzCols = derivedTimezone ? { timezone: derivedTimezone } : {};

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .insert({
        company_name: companyName,
        admin_name: firstName || null,
        slug,
        contact_email: contactEmail,
        contact_phone: phoneDisplay,
        address: location,
        business_hours: operatingHours || null,
        status: "active",
        tenant_type: tenantType,
        ...identityCols,
        ...palette,
        ...logoCols,
        ...modeCols,
        ...hourCols,
        ...tzCols,
      })
      .select()
      .single();

    if (tenantError || !tenant) {
      console.error(`${LOG} tenant insert failed:`, tenantError);
      // Closes the check-then-insert race on the slug: two agents submitting the
      // same slug concurrently both pass the SELECT above, and only the unique
      // index (tenants_slug_key) stops the second one.
      if (isUniqueViolation(tenantError)) {
        await recordFailure(`Tenant insert failed: slug "${slug}" already taken`);
        return errorResponse("Slug already taken", 409);
      }
      await recordFailure(`Tenant insert failed: ${tenantError?.message || "unknown error"}`);
      return errorResponse("Failed to create tenant", 500);
    }

    const tenantId: string = tenant.id;

    // ---------------------------------------------------------------------
    // 8. 100 live welcome credits (non-fatal).
    // ---------------------------------------------------------------------
    try {
      const { error: creditError } = await supabase.rpc("add_credits", {
        p_tenant_id: tenantId,
        p_amount: 100,
        p_type: "gift",
        p_description: "Welcome bonus: 100 live credits",
        p_is_test_mode: false,
      });
      if (creditError) {
        console.error(`${LOG} add_credits failed (non-fatal):`, creditError);
      }
    } catch (e) {
      console.error(`${LOG} add_credits threw (non-fatal):`, e);
    }

    // Rollback bookkeeping. Every cleanup step records whether it actually
    // succeeded so a partial rollback is reported instead of silently leaving
    // an orphan behind.
    const orphans: string[] = [];

    /** Suffix appended to the recorded failure when a cleanup step didn't land. */
    const rollbackNote = () =>
      orphans.length ? ` | MANUAL CLEANUP REQUIRED: ${orphans.join(", ")}` : "";

    // Tenant cleanup. All tenant-scoped rows created by the AFTER-INSERT
    // triggers (credit wallet, CMS pages, audit logs) are ON DELETE CASCADE, so
    // this is a clean removal. If it somehow fails we suspend the tenant so a
    // half-provisioned record can never be logged into or billed.
    const deleteTenant = async () => {
      try {
        const { error } = await supabase.from("tenants").delete().eq("id", tenantId);
        if (!error) return;
        throw error;
      } catch (e) {
        console.error(`${LOG} rollback: delete tenant ${tenantId} failed:`, e);
        orphans.push(`tenant ${tenantId} (${slug})`);
        try {
          await supabase.from("tenants").update({ status: "suspended" }).eq("id", tenantId);
        } catch (e2) {
          console.error(`${LOG} rollback: could not suspend tenant ${tenantId}:`, e2);
        }
      }
    };

    // ---------------------------------------------------------------------
    // 9. Create the head_admin auth user.
    // ---------------------------------------------------------------------
    const { data: authUser, error: createAuthError } = await supabase.auth.admin.createUser({
      email: contactEmail,
      password,
      email_confirm: true,
      user_metadata: { name: `${companyName} Admin`, role: "head_admin" },
    });

    if (createAuthError || !authUser?.user) {
      console.error(`${LOG} auth.admin.createUser failed:`, createAuthError);
      await deleteTenant();
      await recordFailure(
        `Auth user creation failed: ${createAuthError?.message || "unknown error"}${rollbackNote()}`,
      );
      // The step-4 guard only sees app_users; an auth.users row with no
      // app_users profile still blocks the address, so say so plainly rather
      // than returning a generic 500 George can't act on.
      if (/already (been )?registered|already exists/i.test(createAuthError?.message || "")) {
        return errorResponse("A login already exists for this email", 409);
      }
      return errorResponse("Failed to create login user", 500);
    }
    const authUserId = authUser.user.id;

    const deleteAuthUser = async () => {
      try {
        const { error } = await supabase.auth.admin.deleteUser(authUserId);
        if (!error) return;
        throw error;
      } catch (e) {
        console.error(`${LOG} rollback: delete auth user ${authUserId} failed:`, e);
        orphans.push(`auth user ${authUserId} (${contactEmail})`);
      }
    };

    // ---------------------------------------------------------------------
    // 10. Create the app_user (head_admin, must change password).
    // ---------------------------------------------------------------------
    const { data: appUser, error: appUserError } = await supabase
      .from("app_users")
      .insert({
        auth_user_id: authUserId,
        email: contactEmail,
        name: `${companyName} Admin`,
        role: "head_admin",
        is_active: true,
        must_change_password: true,
        tenant_id: tenantId,
      })
      .select()
      .single();

    if (appUserError || !appUser) {
      console.error(`${LOG} app_users insert failed:`, appUserError);
      await deleteAuthUser();
      await deleteTenant();
      await recordFailure(
        `App user creation failed: ${appUserError?.message || "unknown error"}${rollbackNote()}`,
      );
      return errorResponse("Failed to create user profile", 500);
    }

    const deleteAppUser = async () => {
      try {
        const { error } = await supabase.from("app_users").delete().eq("id", appUser.id);
        if (!error) return;
        throw error;
      } catch (e) {
        console.error(`${LOG} rollback: delete app_user ${appUser.id} failed:`, e);
        orphans.push(`app_user ${appUser.id}`);
      }
    };

    // ---------------------------------------------------------------------
    // 11. Live 0-day subscription plan — this is the hard paywall. Any failure
    //     here fully rolls back (no active plan => the paywall never fires).
    // ---------------------------------------------------------------------
    try {
      const mode: "test" | "live" = isProduction ? "live" : "test";
      const stripe = getSubscriptionStripeClientForAccount("uk", mode);

      const price = await stripe.prices.create({
        unit_amount: amountCents,
        currency,
        recurring: { interval: "month" },
        product_data: { name: "Drive247 Platform Subscription" },
        metadata: { tenant_id: tenantId, plan_name: "Monthly Subscription" },
      });

      const { error: planError } = await supabase.from("subscription_plans").insert({
        tenant_id: tenantId,
        name: "Monthly Subscription",
        description: null,
        features: [],
        amount: amountCents,
        currency,
        interval: "month",
        stripe_price_id: price.id,
        stripe_product_id: price.product,
        stripe_account: "uk",
        trial_days: 0,
        billing_model: "trial",
        is_active: true,
        sort_order: 0,
      });

      if (planError) {
        throw planError;
      }
    } catch (e) {
      console.error(`${LOG} subscription plan creation failed:`, e);
      await deleteAppUser();
      await deleteAuthUser();
      await deleteTenant();
      await recordFailure(
        `Subscription plan creation failed: ${(e as Error)?.message || "unknown error"}${rollbackNote()}`,
      );
      return errorResponse("Failed to create subscription plan", 500);
    }

    // ---------------------------------------------------------------------
    // 12. Booking-site content: write the tenant's own CMS sections onto the
    //     trigger-created page shells and PUBLISH them. Non-fatal — a live
    //     tenant showing fallback copy is recoverable (re-run from the CMS),
    //     rolling back a fully provisioned tenant over it is not.
    // ---------------------------------------------------------------------
    let contentSeeded = false;
    try {
      const { pages, sections, missing } = await seedTenantCmsContent(
        supabase,
        tenantId,
        buildCmsContent({
          name: companyName,
          location,
          phoneHref: phoneE164 || "",
          phoneLabel: phoneDisplay || "",
          email: contactEmail,
          hours: (hourCols.business_hours as string) || operatingHours || "",
          logoUrl: logoUrl || "",
          year: new Date().getFullYear(),
          today: new Date().toISOString().split("T")[0],
        }),
      );
      // `sections > 0` was a lie: with only the 'site-settings' shell present we
      // write 5 sections and publish 1 page while all eight real content pages
      // are skipped — i.e. the client's site still shows Drive247's phone
      // number, email and copy. Only claim success when the pages that carry
      // the customer-facing copy actually landed, home page included.
      const homeSeeded = !missing.includes("home");
      contentSeeded = sections > 0 && homeSeeded && missing.length === 0;
      console.log(`${LOG} CMS: published ${sections} sections across ${pages} pages for ${slug}`);
      if (missing.length) {
        console.error(
          `${LOG} CMS: no page shell for [${missing.join(", ")}] on ${slug} — those pages still render platform defaults`,
        );
      }
    } catch (e) {
      // Loud, because the site is live either way — it just renders the platform
      // defaults until someone re-publishes from Portal → CMS.
      console.error(`${LOG} CMS content seeding failed (non-fatal) for ${slug}:`, e);
    }

    // ---------------------------------------------------------------------
    // 13. Record the successful submission (best-effort, non-fatal).
    // ---------------------------------------------------------------------
    try {
      await supabase.from("sales_onboarding_submissions").insert({
        ...submissionBase,
        tenant_id: tenantId,
        extracted_colors: colors,
        generated_email: contactEmail,
        status: "created",
      });
    } catch (e) {
      console.error(`${LOG} could not record submission (non-fatal):`, e);
    }

    // ---------------------------------------------------------------------
    // 14. Build the client message + respond.
    // ---------------------------------------------------------------------
    const amountLabel = `${currencySymbol(currency)}${formatDollars(amountCents)}`;
    const message =
      `Hi ${firstName || "there"},\n\n` +
      `Your ${companyName} portal is ready! 🎉\n\n` +
      `🔑 Login details\n` +
      `Email: ${contactEmail}\n` +
      `Password: ${password}\n` +
      `(You'll set your own password on first login.)\n\n` +
      `🖥️  Admin portal (log in here): ${portalUrl}\n` +
      `🚗  Your booking site: ${bookingUrl}\n\n` +
      `When you first log in you'll activate your subscription (${amountLabel}/month) to unlock your dashboard.\n\n` +
      `Any questions, just reply here!`;

    console.log(`${LOG} provisioned tenant ${tenantId} (${slug}) for ${contactEmail}`);

    return jsonResponse({
      success: true,
      tenantId,
      slug,
      companyName,
      adminEmail: contactEmail,
      adminPassword: password,
      portalUrl,
      bookingUrl,
      subscriptionAmount: amountCents,
      subscriptionCurrency: currency,
      colors,
      // true only when EVERY generated page landed and published. false => the
      // booking site is live but at least one page (possibly all of them) still
      // renders platform default copy; re-publish from Portal → CMS. The
      // function logs exactly which slugs were missing.
      contentSeeded,
      timezone: derivedTimezone,
      message,
    });
  } catch (error) {
    console.error(`${LOG} unexpected error:`, error);
    return errorResponse((error as Error)?.message || "Internal server error", 500);
  }
});
