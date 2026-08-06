/**
 * Canonical public URLs of the Drive247 platform legal documents.
 *
 * ONE definition, because these are consent links: the portal has four separate
 * surfaces that point at them (the subscribe/credits checkbox, the login
 * acceptance checkbox, the policy gate, and the next.config redirects), and a
 * developer who overrode the origin for local testing previously moved only two
 * of them — so the two screens where acceptance is MANDATORY silently kept
 * opening production while the others followed the override.
 *
 * Absolute by necessity: the portal runs on {tenant}.portal.drive-247.com, so a
 * root-relative /terms resolves against that origin and can never reach the
 * marketing site, which is where the canonical documents live.
 *
 * Mirrored (not imported) in apps/portal/next.config.js, which cannot import
 * from src/. Keep the two in step — the test in
 * src/__tests__/lib/platform-tos.test.ts asserts they agree, and also that this
 * origin matches PLATFORM_TOS_URL in supabase/functions/_shared/platform-tos.ts,
 * which is the URL Stripe shows when consent_collection is enabled.
 */
export const MARKETING_URL =
  process.env.NEXT_PUBLIC_MARKETING_URL || "https://drive-247.com";

export const PLATFORM_TERMS_URL = `${MARKETING_URL}/terms`;
export const PLATFORM_PRIVACY_URL = `${MARKETING_URL}/privacy`;
