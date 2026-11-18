// =============================================================================
// signup-attribution — "How did you hear about us?" and the optional phone number
// from the signup's account step.
//
// People see an ad on their phone and sign up later on a laptop, so Meta and
// PostHog record a "direct" visit. Asking is the only reliable answer.
//
// The answer is kept in three places:
//   app_metadata.d247_signup        what the later signup steps read
//   public.signup_attribution       the record to report from (service role only)
//   Stripe customer metadata        `heard_about`, next to the trial
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

export interface SignupAttribution {
  heardAbout?: HeardAbout;
  /** Only ever set alongside `heardAbout: "other"`. */
  heardAboutOther?: string;
  /** `+` and digits when the country is known, otherwise the digits as typed. */
  phone?: string;
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

  const phone = normalizeSignupPhone(b.phone);
  if (phone) out.phone = phone;
  return out;
}

/** The Stripe customer metadata for an answer. Empty when there is no answer. */
export function stripeAttributionMetadata(a: SignupAttribution): Record<string, string> {
  if (!a.heardAbout) return {};
  return {
    heard_about: a.heardAbout,
    ...(a.heardAboutOther ? { heard_about_other: a.heardAboutOther } : {}),
  };
}

/** Write the answers to `signup_attribution`. Logs and carries on if it cannot. */
export async function saveSignupAttribution(
  supabase: any,
  row: { authUserId: string; email: string; attribution: SignupAttribution; tenantId?: string | null },
): Promise<void> {
  const { heardAbout, heardAboutOther, phone } = row.attribution;
  if (!heardAbout && !phone) return;
  try {
    const { error } = await supabase.from("signup_attribution").upsert(
      {
        auth_user_id: row.authUserId,
        email: row.email,
        ...(heardAbout ? { heard_about: heardAbout, heard_about_other: heardAboutOther ?? null } : {}),
        ...(phone ? { phone } : {}),
        ...(row.tenantId ? { tenant_id: row.tenantId } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "auth_user_id" },
    );
    if (error) throw error;
  } catch (e) {
    console.error(`[signup-attribution] could not save the answer for ${row.authUserId} (non-fatal):`, e);
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
