// =============================================================================
// signup-attribution — "How did you hear about us?", "How many cars do you rent
// out?" and the optional phone number from the signup's account step.
//
// People see an ad on their phone and sign up later on a laptop, so Meta and
// PostHog record a "direct" visit. Asking is the only reliable answer.
//
// The answer is kept in three places:
//   app_metadata.d247_signup        what the later signup steps read
//   public.signup_attribution       the record to report from (service role only)
//   Stripe customer metadata        `heard_about` and `fleet_size`, next to the trial
//
// The fleet size also picks the plan in the browser (apps/web/src/lib/fleet-size.ts)
// and is copied onto `tenants.fleet_size` when the portal is built.
//
// "City and state" (free text, asked under the business name) rides with the
// answers too: `cityState` in the metadata, `signup_attribution.city_state`,
// Stripe `city_state`. It is for the team to look the business up and find
// another number to call. It is NOT the tenant's address (`tenants.address` is
// the booking site's real address) and is never written there.
//
// Nothing here may fail a signup. Bad input is dropped, not refused: the question
// is required by the form, and an old browser tab that does not send it still has
// to be able to sign up. The form asks again before the card if no answer arrived.
// =============================================================================

/** Keep in step with HEARD_ABOUT_OPTIONS in apps/web/src/lib/signup-attribution.ts. */
export const HEARD_ABOUT_VALUES = [
  "instagram",
  "facebook",
  "google_search",
  "youtube",
  "friend_or_host",
  "turo_group",
  "other",
] as const;

export type HeardAbout = (typeof HEARD_ABOUT_VALUES)[number];

export const HEARD_ABOUT_OTHER_MAX = 100;

/** Keep in step with FLEET_SIZE_OPTIONS in apps/web/src/lib/fleet-size.ts. */
export const FLEET_SIZE_VALUES = ["1-5", "6-20", "21+"] as const;

export type FleetSize = (typeof FLEET_SIZE_VALUES)[number];

export function isFleetSize(value: unknown): value is FleetSize {
  return typeof value === "string" && (FLEET_SIZE_VALUES as readonly string[]).includes(value);
}

/** Keep in step with FIELD_MAX.cityState in apps/web/src/lib/signup-validation.ts. */
export const CITY_STATE_MAX = 80;

/**
 * "City and state" as typed, made safe to store: control characters out, runs
 * of spaces folded, trimmed, capped. Undefined when nothing usable is left.
 */
export function normalizeCityState(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  // deno-lint-ignore no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
    .slice(0, CITY_STATE_MAX).trim();
  return text.length >= 2 ? text : undefined;
}

export interface SignupAttribution {
  heardAbout?: HeardAbout;
  /** Only ever set alongside `heardAbout: "other"`. */
  heardAboutOther?: string;
  /** "How many cars do you rent out?" */
  fleetSize?: FleetSize;
  /** `+` and digits when the country is known, otherwise the digits as typed. */
  phone?: string;
  /** "City and state", free text. See `normalizeCityState`. */
  cityState?: string;
}

export function isHeardAbout(value: unknown): value is HeardAbout {
  return typeof value === "string" && (HEARD_ABOUT_VALUES as readonly string[]).includes(value);
}

/**
 * The number in international form where that can be worked out.
 *
 * Meta only matches a phone hash that includes the country code. Signups are
 * US-first, so a 10-digit number (or 11 digits starting with 1) is read as US.
 * Anything else without a `+` is kept for staff to call, but never guessed at.
 */
export function normalizeSignupPhone(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const typed = raw.trim();
  if (!typed || typed.length > 40 || !/^[+\d\s().-]+$/.test(typed)) return undefined;

  const digits = typed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return undefined;

  if (typed.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00") && digits.length > 9) return `+${digits.slice(2)}`;
  if (/^[2-9]\d{9}$/.test(digits)) return `+1${digits}`;
  if (/^1[2-9]\d{9}$/.test(digits)) return `+${digits}`;
  return digits;
}

/** The phone to hash for Meta: only one that carries its country code. */
export function phoneForMeta(phone: string | null | undefined): string | null {
  return phone?.startsWith("+") ? phone : null;
}

/** The usable part of a request body. Never throws; unusable values are left out. */
export function readSignupAttribution(body: unknown): SignupAttribution {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: SignupAttribution = {};

  if (isHeardAbout(b.heardAbout)) {
    out.heardAbout = b.heardAbout;
    if (b.heardAbout === "other" && typeof b.heardAboutOther === "string") {
      // deno-lint-ignore no-control-regex
      const text = b.heardAboutOther.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
        .slice(0, HEARD_ABOUT_OTHER_MAX);
      if (text) out.heardAboutOther = text;
    }
  }

  if (isFleetSize(b.fleetSize)) out.fleetSize = b.fleetSize;

  const phone = normalizeSignupPhone(b.phone);
  if (phone) out.phone = phone;

  const cityState = normalizeCityState(b.cityState);
  if (cityState) out.cityState = cityState;
  return out;
}

/** The Stripe customer metadata for the answers. Empty when there is none. */
export function stripeAttributionMetadata(a: SignupAttribution): Record<string, string> {
  const cityState = normalizeCityState(a.cityState);
  return {
    ...(a.heardAbout
      ? {
        heard_about: a.heardAbout,
        ...(a.heardAboutOther ? { heard_about_other: a.heardAboutOther } : {}),
      }
      : {}),
    ...(isFleetSize(a.fleetSize) ? { fleet_size: a.fleetSize } : {}),
    ...(cityState ? { city_state: cityState } : {}),
  };
}

/**
 * PostgREST's "no such column" (PGRST204), i.e. the migration that adds
 * `fleet_size` / `exit_offer_seen_at` (20261120120000) or `city_state`
 * (20261121090000) has not been applied yet. The write is then retried without
 * them, so the heard-about answer is never lost to it.
 */
function isMissingColumn(error: any): boolean {
  const msg = String(error?.message ?? "");
  return String(error?.code ?? "") === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(msg);
}

/** Write the answers to `signup_attribution`. Logs and carries on if it cannot. */
export async function saveSignupAttribution(
  supabase: any,
  row: { authUserId: string; email: string; attribution: SignupAttribution; tenantId?: string | null },
): Promise<void> {
  const { heardAbout, heardAboutOther, phone, fleetSize } = row.attribution;
  const cityState = normalizeCityState(row.attribution.cityState);
  if (!heardAbout && !phone && !fleetSize && !cityState) return;
  try {
    const base = {
      auth_user_id: row.authUserId,
      email: row.email,
      ...(heardAbout ? { heard_about: heardAbout, heard_about_other: heardAboutOther ?? null } : {}),
      ...(phone ? { phone } : {}),
      ...(row.tenantId ? { tenant_id: row.tenantId } : {}),
      updated_at: new Date().toISOString(),
    };
    const withFleet = { ...base, ...(fleetSize ? { fleet_size: fleetSize } : {}) };
    // Newest column first: each retry drops the column a pending migration
    // adds, so whatever the database already has is still saved.
    const attempts: { row: Record<string, unknown>; drops: string | null }[] = [
      { row: { ...withFleet, ...(cityState ? { city_state: cityState } : {}) }, drops: null },
      ...(cityState ? [{ row: withFleet, drops: "city_state" }] : []),
      ...(fleetSize ? [{ row: base, drops: "fleet_size" }] : []),
    ];
    let error: any = null;
    for (const attempt of attempts) {
      if (attempt.drops) {
        console.warn(`[signup-attribution] a signup_attribution column is missing; retrying without ${attempt.drops}`);
      }
      ({ error } = await supabase.from("signup_attribution").upsert(attempt.row, { onConflict: "auth_user_id" }));
      if (!error || !isMissingColumn(error)) break;
    }
    if (error) throw error;
  } catch (e) {
    console.error(`[signup-attribution] could not save the answer for ${row.authUserId} (non-fatal):`, e);
  }
}

/**
 * "Not ready just yet?" was shown to this account: kept so it is never shown
 * again on another device, and so Bryan can see they were offered 20%.
 * Only the first time is kept. Logs and carries on if it cannot.
 */
export async function markExitOfferSeen(
  supabase: any,
  row: { authUserId: string; email: string; at?: string },
): Promise<void> {
  const at = row.at ?? new Date().toISOString();
  try {
    const { data, error: readError } = await supabase
      .from("signup_attribution")
      .select("auth_user_id, exit_offer_seen_at")
      .eq("auth_user_id", row.authUserId)
      .maybeSingle();
    if (readError) throw readError;
    if (data?.exit_offer_seen_at) return;
    const { error } = data
      ? await supabase.from("signup_attribution")
        .update({ exit_offer_seen_at: at, updated_at: at })
        .eq("auth_user_id", row.authUserId)
      : await supabase.from("signup_attribution")
        .insert({ auth_user_id: row.authUserId, email: row.email, exit_offer_seen_at: at, updated_at: at });
    if (error) throw error;
  } catch (e) {
    console.error(`[signup-attribution] could not record the exit offer for ${row.authUserId} (non-fatal):`, e);
  }
}

/** Point the answers at the tenant once there is one. */
export async function linkSignupAttributionTenant(
  supabase: any,
  authUserId: string,
  tenantId: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("signup_attribution")
      .update({ tenant_id: tenantId, updated_at: new Date().toISOString() })
      .eq("auth_user_id", authUserId);
    if (error) throw error;
  } catch (e) {
    console.error(`[signup-attribution] could not link tenant ${tenantId} (non-fatal):`, e);
  }
}

/**
 * Put the answer on the Stripe customer.
 *
 * A separate update, not a field on `customers.create`: that call uses an
 * idempotency key, and Stripe refuses a repeat of a key with different parameters.
 * Stripe merges metadata, so the keys already on the customer are kept.
 */
export async function stampStripeCustomer(
  stripe: any,
  customerId: string,
  attribution: SignupAttribution,
): Promise<void> {
  const metadata = stripeAttributionMetadata(attribution);
  if (!Object.keys(metadata).length) return;
  try {
    await stripe.customers.update(customerId, { metadata });
  } catch (e) {
    console.error(`[signup-attribution] could not update Stripe customer ${customerId} (non-fatal):`, e);
  }
}
