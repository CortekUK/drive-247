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

import { SIGNUP_ERROR_COPY } from "@/components/onboarding/onboarding-types";

// ---------------------------------------------------------------------------
// Shared shapes (LOCAL to the client — the wire contracts all live in
// onboarding-types.ts and are never redeclared here).
// ---------------------------------------------------------------------------

/** field name -> the message to render under that field. */
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/**
 * One form now, so one field union.
 *
 * `companyName`, `slug` and `acceptedTerms` moved up from the deleted business
 * step. `slug` has a field of its own again — the operator picks the address
 * rather than having one derived from their trading name — so a SLUG_TAKEN can
 * be reported against the input that caused it instead of being rewritten into
 * a message about the business name.
 */
export type AccountField =
  | "fullName"
  | "email"
  | "password"
  | "companyName"
  | "slug"
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
 * The operator types this again. It is the single most consequential thing on
 * the form — it becomes {slug}.drive-247.com AND {slug}.portal.drive-247.com,
 * and nothing in the platform renames a tenant slug afterwards — so it gets its
 * own input, live availability, and suggestions when it is taken.
 *
 * Three functions, three jobs: `sanitizeSlugInput` is safe to run on every
 * keystroke, `normalizeSlugClient` produces the canonical form we send, and
 * `checkSlugShape` decides whether that form is legal.
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

/**
 * Keystroke-safe normalisation for the live input.
 *
 * Deliberately NOT `normalizeSlugClient`: that strips trailing hyphens, so
 * typing "acme-" to get to "acme-rentals" would delete the hyphen the moment it
 * was typed and the word could never be started. Runs of hyphens and leading
 * ones are still collapsed — those are always mistakes — and the canonical form
 * is applied on blur and again before anything is sent.
 */
export function sanitizeSlugInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, FIELD_MAX.slug);
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
// The one form
// ---------------------------------------------------------------------------

export interface AccountInput {
  fullName: string;
  email: string;
  password: string;
  companyName: string;
  slug: string;
  acceptedTerms: boolean;
}

/** Just the three tenant fields — what the Google path and `tenant` mode collect. */
export type TenantInput = Pick<
  AccountInput,
  "companyName" | "slug" | "acceptedTerms"
>;

/**
 * The tenant half, validated on its own.
 *
 * Availability is NOT checked here — that is a network round trip the step owns
 * and debounces. This decides only whether the values are worth sending.
 */
export function validateTenant(values: TenantInput): FieldErrors<AccountField> {
  const errors: FieldErrors<AccountField> = {};

  const companyName = values.companyName.trim();
  if (companyName.length < 2) {
    errors.companyName = "Please enter your business name.";
  } else if (companyName.length > FIELD_MAX.companyName) {
    errors.companyName = `Please keep your business name to ${FIELD_MAX.companyName} characters or fewer.`;
  }

  // The address is its own field again, so a slug problem is reported against
  // the slug — not rewritten into a message about the business name, which is
  // what the previous derived-slug design had to do.
  const verdict = checkSlugShape(values.slug);
  if (!verdict.ok) errors.slug = verdict.message ?? SIGNUP_ERROR_COPY.SLUG_INVALID;

  if (!values.acceptedTerms) {
    errors.acceptedTerms = SIGNUP_ERROR_COPY.TERMS_NOT_ACCEPTED;
  }

  return errors;
}

/**
 * The whole account step.
 *
 * `requireCredentials` is false on the Google path: the name, the address and
 * the credential all come back from Google, so asking for them here would be
 * asking for something we are about to throw away.
 */
export function validateAccount(
  values: AccountInput,
  { requireCredentials = true }: { requireCredentials?: boolean } = {},
): FieldErrors<AccountField> {
  const errors: FieldErrors<AccountField> = { ...validateTenant(values) };

  if (requireCredentials) {
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
  }

  return errors;
}

/** The order fields appear in, so "focus the first error" focuses the top one. */
export const ACCOUNT_FIELD_ORDER: readonly AccountField[] = [
  "fullName",
  "email",
  "password",
  "companyName",
  "slug",
  "acceptedTerms",
];

/** `tenant` mode renders a subset, so it needs its own order. */
export const TENANT_FIELD_ORDER: readonly AccountField[] = [
  "companyName",
  "slug",
  "acceptedTerms",
];

/** First key of `errors` in display order, or null when there are none. */
export function firstErrorField<K extends string>(
  errors: FieldErrors<K>,
  order: readonly K[],
): K | null {
  return order.find((k) => Boolean(errors[k])) ?? null;
}
