/**
 * Client-side validation for the self-serve signup dialog.
 *
 * Every rule here is a MIRROR of a rule the edge functions enforce
 * (`supabase/functions/signup-begin`, `signup-slug-check`, `signup-provision`,
 * via `_shared/tenant-provisioning.ts`). The point of the mirror is that the
 * user never gets a server-side surprise on a field they could have been told
 * about while typing — it is NOT a security boundary. The server re-validates
 * everything and stays authoritative; a caller who bypasses this file gets a
 * 400 with the same message.
 *
 * Two deliberate non-goals:
 *
 * 1. **Nothing here truncates.** The server's `clean()` clips to `MAX`, but
 *    silently shortening what someone pasted is how a business ends up trading
 *    as "Elite Motors of Greater Manchest". We validate the length and say so
 *    instead, and the user keeps every character they typed.
 * 2. **Nothing here auto-corrects.** The email typo helper returns a
 *    *suggestion* the user has to click. Rewriting an address under someone is
 *    how you lock them out of the portal they just paid for.
 *
 * User-facing copy is taken from `SIGNUP_ERROR_COPY` wherever a matching error
 * code exists, so the client-side message and the server-side message for the
 * same failure are literally the same string and can never drift apart.
 */

import {
  SIGNUP_ERROR_COPY,
  type BusinessDraft,
  type OperatingScheduleDraft,
} from "@/components/onboarding/onboarding-types";
import {
  MAX_SELF_SERVE_VEHICLES,
  smallestPlanFor,
  type SignupPlan,
} from "@/lib/plans";

// ---------------------------------------------------------------------------
// Shared shapes (LOCAL to the client — the wire contracts all live in
// onboarding-types.ts and are never redeclared here).
// ---------------------------------------------------------------------------

/** field name -> the message to render under that field. */
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export type AccountField = "fullName" | "email" | "password";

/**
 * `slug` is deliberately absent: the operator no longer picks a web address, so
 * there is no field to hang a slug message on. A slug problem is now always a
 * problem with the BUSINESS NAME it was derived from, and is reported there.
 */
export type BusinessField =
  | "companyName"
  | "location"
  | "businessPhone"
  | "fleetSize"
  | "vehicleType"
  | "businessColours"
  | "logoUrl"
  | "schedule"
  | "acceptedTerms";

/**
 * Length caps, byte-for-byte the `MAX` object in
 * create-sales-onboarding/index.ts:40 (and therefore in
 * `_shared/tenant-provisioning.ts`). `fullName` maps to the server's
 * `MAX.firstName`.
 */
export const FIELD_MAX = {
  fullName: 60,
  email: 254,
  companyName: 100,
  slug: 50,
  location: 200,
  phone: 40,
  colours: 300,
  url: 2048,
} as const;

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/** Identical to EMAIL_RE in create-sales-onboarding/index.ts:52. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Trim + lowercase. GoTrue lowercases the address it stores, so a user who
 * types `Owner@Acme.com` at signup and `owner@acme.com` at login must land on
 * the same account — we normalise up front so both the identity probes and the
 * later `signInWithPassword` see one canonical string.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  return email.length <= FIELD_MAX.email && EMAIL_RE.test(email);
}

/**
 * Disposable-mailbox domains. Explicitly a speed bump, not a wall: the list is
 * short, public and trivially routed around. It exists because the address is
 * the *login for the portal they are about to pay for* — someone who signs up
 * on a 10-minute mailbox loses access to their own business the moment it
 * expires, and support cannot recover it.
 *
 * Kept in sync with `isDisposableEmail` in `_shared/signup-state.ts`.
 */
const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com",
  "mailinator.net",
  "yopmail.com",
  "guerrillamail.com",
  "sharklasers.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "tempr.email",
  "trashmail.com",
  "throwawaymail.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "fakeinbox.com",
  "mailnesia.com",
  "mintemail.com",
  "spamgourmet.com",
  "moakt.com",
  "emailondeck.com",
  "discard.email",
]);

export function emailDomain(raw: string): string {
  const at = normalizeEmail(raw).lastIndexOf("@");
  return at === -1 ? "" : normalizeEmail(raw).slice(at + 1);
}

export function isDisposableEmail(raw: string): boolean {
  return DISPOSABLE_DOMAINS.has(emailDomain(raw));
}

/**
 * Near-misses on the five domains that account for almost every consumer
 * address we see. Deliberately a lookup table rather than an edit-distance
 * score: a fuzzy matcher would also "helpfully" suggest gmail.com to someone at
 * `gmall-logistics.com`, which is a real company domain.
 */
const EMAIL_DOMAIN_TYPOS: Readonly<Record<string, string>> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.con": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmall.com": "hotmail.com",
  "homail.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.cm": "hotmail.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yahoo.cm": "yahoo.com",
  "outlok.com": "outlook.com",
  "outllok.com": "outlook.com",
  "outlook.co": "outlook.com",
  "outook.com": "outlook.com",
  "iclod.com": "icloud.com",
  "icloud.co": "icloud.com",
  "protonmai.com": "protonmail.com",
};

/**
 * Returns the corrected address, or null when there is nothing to suggest.
 * Never applied automatically — see the file header.
 */
export function suggestEmailCorrection(raw: string): string | null {
  const email = normalizeEmail(raw);
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const fixed = EMAIL_DOMAIN_TYPOS[email.slice(at + 1)];
  return fixed ? `${email.slice(0, at)}@${fixed}` : null;
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordRule {
  id: "length" | "mix";
  label: string;
  test(password: string): boolean;
}

/**
 * The two rules `signup-begin` enforces, and the only two. They are shown as a
 * live checklist rather than as an error on submit, because a password rule the
 * user only learns about after failing is the single most abandoned step in any
 * signup form.
 */
export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (p) => p.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "mix",
    label: "A letter and a number",
    test: (p) => /[a-zA-Z]/.test(p) && /\d/.test(p),
  },
] as const;

export function passwordRuleState(
  password: string,
): { rule: PasswordRule; met: boolean }[] {
  return PASSWORD_RULES.map((rule) => ({ rule, met: rule.test(password) }));
}

export function isPasswordAcceptable(password: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(password));
}

/** Fragments that make a password guessable no matter how long it is. */
const WEAK_FRAGMENTS: readonly string[] = [
  "password",
  "passw0rd",
  "qwerty",
  "letmein",
  "welcome",
  "iloveyou",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "master",
  "admin",
  "drive247",
  "drive-247",
  "carrental",
  "123456",
  "abc123",
  "111111",
  "000000",
];

/** 4+ characters running consecutively up or down the code points ("abcd", "4321"). */
function hasRun(password: string): boolean {
  const lower = password.toLowerCase();
  let up = 1;
  let down = 1;
  for (let i = 1; i < lower.length; i++) {
    const delta = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    up = delta === 1 ? up + 1 : 1;
    down = delta === -1 ? down + 1 : 1;
    if (up >= 4 || down >= 4) return true;
  }
  return false;
}

/** The same character three or more times in a row ("aaa", "!!!"). */
function hasRepeat(password: string): boolean {
  return /(.)\1{2,}/.test(password);
}

export interface PasswordStrength {
  /** 0–4. 0 and 1 are below the bar the two hard rules already set. */
  score: 0 | 1 | 2 | 3 | 4;
  label: "Too short" | "Weak" | "Fair" | "Strong" | "Very strong";
  /** 0–100, for the meter width. */
  percent: number;
}

/**
 * A genuine strength estimate, not a "does it have a symbol" checkbox count.
 *
 * Length is weighted heaviest because it is the only input that actually
 * multiplies the search space, and the two penalties exist because
 * `Passw0rdPassw0rd` and `aaaaaaaaaa1` both clear the hard rules while being
 * trivially guessable. The result is advisory only — `isPasswordAcceptable`
 * decides whether the form submits, and this decides what the meter says.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "Too short", percent: 0 };

  let points = 0;

  // Length: the dominant term.
  if (password.length >= 8) points += 1;
  if (password.length >= 12) points += 1;
  if (password.length >= 16) points += 1;
  if (password.length >= 20) points += 1;

  // Variety: one point per class beyond the first, capped at 2.
  const classes =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/\d/.test(password)) +
    Number(/[^a-zA-Z0-9]/.test(password));
  points += Math.min(2, Math.max(0, classes - 1));

  // Penalties.
  const lower = password.toLowerCase();
  if (WEAK_FRAGMENTS.some((f) => lower.includes(f))) points -= 2;
  if (hasRun(password) || hasRepeat(password)) points -= 1;

  if (password.length < PASSWORD_MIN_LENGTH) {
    return { score: 0, label: "Too short", percent: 12 };
  }

  const score = Math.max(1, Math.min(4, points)) as 1 | 2 | 3 | 4;
  const label = (
    { 1: "Weak", 2: "Fair", 3: "Strong", 4: "Very strong" } as const
  )[score];
  return { score, label, percent: score * 25 };
}

// ---------------------------------------------------------------------------
// Slug / subdomain
// ---------------------------------------------------------------------------

/**
 * Nobody types a slug any more — the business step dropped the web-address
 * field, and the subdomain is derived from the business name (here, and
 * authoritatively again on the server). What survives in this section is
 * exactly what that derivation needs: normalise, shape-check, reserved-check.
 * The keystroke-safe `sanitizeSlugInput` went with the input it existed for.
 */

/**
 * Canonical subdomain form. Byte-identical to `normalizeSlug` in
 * create-sales-onboarding/index.ts:120 — lowercase, `[a-z0-9-]` only, no
 * repeated hyphens, no leading or trailing hyphen. Anything else is an illegal
 * DNS label and produces a hostname that never resolves.
 */
export function normalizeSlugClient(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The subdomain a business name produces. Mirrors the server's derivation. */
export function deriveSlugFromCompanyName(companyName: string): string {
  return normalizeSlugClient(companyName.trim()).slice(0, FIELD_MAX.slug);
}

/**
 * Subdomains that resolve to their own Vercel deployments, plus the
 * infrastructure names we never want a tenant to own. A tenant minted on one of
 * these gets a hostname that serves a DIFFERENT app.
 *
 * Mirrors `RESERVED_SLUGS` in `_shared/tenant-provisioning.ts`, which in turn
 * mirrors apps/portal/src/middleware.ts and apps/booking/src/middleware.ts. The
 * server is authoritative; this copy exists purely so the field can go red
 * while the user types instead of after they submit.
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
  return RESERVED_SLUGS.includes(slug.toLowerCase());
}

export type SlugProblem = "empty" | "invalid" | "reserved";

export interface SlugVerdict {
  /** The normalised slug — this is what gets sent to the server. */
  slug: string;
  ok: boolean;
  problem: SlugProblem | null;
  /** Null when `ok`. Otherwise the message to render under the field. */
  message: string | null;
}

/**
 * Shape + reserved-list check only. Availability is a server round trip
 * (`signup-slug-check`) and is never guessed here.
 *
 * The three shape rules match `signup-provision` exactly: `/^[a-z][a-z0-9-]*$/`
 * after normalisation, 3–50 characters, and at least 3 alphanumerics (so `a-b`
 * and `x--` cannot become hostnames).
 */
export function checkSlugShape(raw: string): SlugVerdict {
  const slug = normalizeSlugClient(raw);

  if (!slug) {
    return {
      slug,
      ok: false,
      problem: "empty",
      message: "Please choose a web address for your booking site.",
    };
  }

  const alphanumerics = slug.replace(/[^a-z0-9]/g, "").length;
  const shapeOk =
    /^[a-z][a-z0-9-]*$/.test(slug) &&
    slug.length >= 3 &&
    slug.length <= FIELD_MAX.slug &&
    alphanumerics >= 3;

  if (!shapeOk) {
    return {
      slug,
      ok: false,
      problem: "invalid",
      message: SIGNUP_ERROR_COPY.SLUG_INVALID,
    };
  }

  if (isReservedSlug(slug)) {
    return {
      slug,
      ok: false,
      problem: "reserved",
      message: SIGNUP_ERROR_COPY.SLUG_RESERVED,
    };
  }

  return { slug, ok: true, problem: null, message: null };
}

// ---------------------------------------------------------------------------
// Phone / URL
// ---------------------------------------------------------------------------

/**
 * Digits plus an optional leading `+`. Identical to `normalizePhone` in
 * create-sales-onboarding/index.ts:142 — and, like it, we deliberately do NOT
 * guess a country code. A wrong prefix does not fail loudly; it silently breaks
 * every SMS and WhatsApp we send that tenant for the rest of their life.
 */
export function normalizePhoneClient(raw: string): string {
  const plus = raw.trim().startsWith("+") ? "+" : "";
  return plus + raw.replace(/\D/g, "");
}

export function phoneDigitCount(raw: string): number {
  return raw.replace(/\D/g, "").length;
}

/** Only http(s). A `javascript:` or `data:` "logo" must never reach an <img src>. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Step 1 — account form
// ---------------------------------------------------------------------------

export interface AccountInput {
  fullName: string;
  email: string;
  password: string;
}

export function validateAccount(values: AccountInput): FieldErrors<AccountField> {
  const errors: FieldErrors<AccountField> = {};

  const fullName = values.fullName.trim();
  if (fullName.length < 2) {
    errors.fullName = "Please enter your full name.";
  } else if (fullName.length > FIELD_MAX.fullName) {
    errors.fullName = `Please keep your name to ${FIELD_MAX.fullName} characters or fewer.`;
  }

  const email = normalizeEmail(values.email);
  if (!email) {
    errors.email = "Please enter your work email address.";
  } else if (!isValidEmail(email)) {
    errors.email = SIGNUP_ERROR_COPY.EMAIL_INVALID;
  } else if (isDisposableEmail(email)) {
    errors.email = SIGNUP_ERROR_COPY.EMAIL_DISPOSABLE;
  }

  if (!isPasswordAcceptable(values.password)) {
    errors.password = SIGNUP_ERROR_COPY.WEAK_PASSWORD;
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Step 3 — business form
// ---------------------------------------------------------------------------

/**
 * True when the schedule will produce usable opening-hours columns.
 *
 * The server's `scheduleToHourCols` returns null (and silently falls back to
 * platform defaults) when no day is ticked and 24/7 is off — so this is not a
 * hard server error, it is a quiet loss of the answer the user gave us. We
 * block it on the client instead, which is the only place it can be explained.
 */
export function isScheduleUsable(schedule: OperatingScheduleDraft): boolean {
  if (schedule.alwaysOpen) return true;
  return schedule.days.length > 0;
}

/**
 * The number the operator typed, or null when the box does not hold a positive
 * whole number.
 *
 * The input already strips non-digits, so this mostly guards paste, autofill
 * and a resumed draft that still carries one of the old band strings
 * ("5–10 vehicles") from before the field became numeric.
 */
export function parseFleetSize(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** True when no self-serve plan covers this fleet, so the answer is "call us". */
export function fleetNeedsSalesCall(raw: string): boolean {
  const n = parseFleetSize(raw);
  return n !== null && n > MAX_SELF_SERVE_VEHICLES;
}

/**
 * The check the user actually asked for. It can only be written now that a plan
 * carries a single `maxVehicles` number — the old band dropdown had no boundary
 * in common with the plan bands, so there was nothing to compare.
 *
 * Every failure names a way forward: the plan that does fit, or the strategy
 * call for a fleet no plan covers. This step runs AFTER the card is charged, so
 * a message that only says "no" is a dead end.
 */
export function validateFleetSize(
  raw: string,
  plan: SignupPlan,
): string | undefined {
  const count = parseFleetSize(raw);
  if (count === null) return "Enter how many vehicles you run.";
  if (count <= plan.maxVehicles) return undefined;

  const fits = smallestPlanFor(count);
  if (!fits) {
    // The link is rendered by the step — see `fleetNeedsSalesCall`. The
    // sentence stays complete on its own so it still reads correctly to a
    // screen reader that announces the text before reaching the link.
    return `Fleets over ${MAX_SELF_SERVE_VEHICLES} vehicles are set up with our team.`;
  }
  return `${plan.name} covers up to ${plan.maxVehicles} vehicles. For ${count} you'll need ${fits.name}.`;
}

export function validateBusiness(
  draft: BusinessDraft,
  plan: SignupPlan,
): FieldErrors<BusinessField> {
  const errors: FieldErrors<BusinessField> = {};

  const companyName = draft.companyName.trim();
  if (companyName.length < 2) {
    errors.companyName = "Please enter your business name.";
  } else if (companyName.length > FIELD_MAX.companyName) {
    errors.companyName = `Please keep your business name to ${FIELD_MAX.companyName} characters or fewer.`;
  } else {
    // The web address is derived from this name now, so a name that cannot
    // produce a legal DNS label is a problem with the NAME — and it has to be
    // caught here. `onboarding-provider.tsx` re-checks the derived slug before
    // it will start provisioning and refuses with SLUG_INVALID, which no longer
    // has a field of its own to land on.
    const derived = checkSlugShape(deriveSlugFromCompanyName(companyName));
    if (!derived.ok) {
      errors.companyName =
        derived.problem === "reserved"
          ? "That name maps to a web address we keep for ourselves. Please add a word to it."
          : "We couldn't build a web address from that name. Please use at least three letters or numbers.";
    }
  }

  // Assigned only when it fails: callers count `Object.keys(errors)`, so
  // writing `undefined` would leave a key behind and block submit forever.
  const fleetError = validateFleetSize(draft.fleetSize, plan);
  if (fleetError) errors.fleetSize = fleetError;

  if (draft.location.trim().length > FIELD_MAX.location) {
    errors.location = `Please keep this to ${FIELD_MAX.location} characters or fewer.`;
  }

  // Phone is optional; when supplied it must be dialable. 7–15 digits is the
  // E.164 range the server enforces.
  const phone = draft.businessPhone.trim();
  if (phone) {
    const digits = phoneDigitCount(phone);
    if (digits < 7 || digits > 15 || phone.length > FIELD_MAX.phone) {
      errors.businessPhone =
        "Please enter a phone number with 7 to 15 digits, including your country code.";
    }
  }

  if (draft.businessColours.trim().length > FIELD_MAX.colours) {
    errors.businessColours = `Please keep this to ${FIELD_MAX.colours} characters or fewer.`;
  }

  const logoUrl = draft.logoUrl.trim();
  if (logoUrl && (!isHttpUrl(logoUrl) || logoUrl.length > FIELD_MAX.url)) {
    errors.logoUrl =
      "Please use a full https:// link to an image, or leave this blank.";
  }

  if (!isScheduleUsable(draft.schedule)) {
    errors.schedule = "Pick at least one day you're open, or tick Open 24/7.";
  }

  if (!draft.acceptedTerms) {
    errors.acceptedTerms = SIGNUP_ERROR_COPY.TERMS_NOT_ACCEPTED;
  }

  return errors;
}

/** The order fields appear in, so "focus the first error" focuses the top one. */
export const BUSINESS_FIELD_ORDER: readonly BusinessField[] = [
  "companyName",
  "location",
  "businessPhone",
  "fleetSize",
  "vehicleType",
  "schedule",
  "businessColours",
  "logoUrl",
  "acceptedTerms",
];

export const ACCOUNT_FIELD_ORDER: readonly AccountField[] = [
  "fullName",
  "email",
  "password",
];

/** First key of `errors` in display order, or null when there are none. */
export function firstErrorField<K extends string>(
  errors: FieldErrors<K>,
  order: readonly K[],
): K | null {
  return order.find((k) => Boolean(errors[k])) ?? null;
}
