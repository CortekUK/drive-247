/**
 * Server-side source of truth for the Drive247 platform Terms of Service version.
 *
 * WHY THIS IS SERVER-SIDE AND NOT A REQUEST-BODY FIELD.
 * The whole point of storing tenants.platform_tos_version is to have an
 * evidentiary record of WHICH document an operator agreed to. A version taken
 * from the request body attests to nothing: anyone holding a portal session can
 * invoke the function directly and name any version string they like, including
 * one that was never rendered to them. So the client may assert *that* it
 * accepted; only the server decides *what* was accepted.
 *
 * This mirrors how create-subscription-checkout already refuses to trust the
 * client about price — it re-reads subscription_plans rather than believing the
 * amount it was handed.
 *
 * KEEPING THIS IN SYNC WITH THE RENDERED PAGE.
 * There is exactly ONE platform Terms of Service, served at the canonical URL
 * below by apps/web/src/app/(marketing)/terms/page.tsx. That page switches on
 * PLATFORM_TOS_IS_DRAFT (apps/web/src/lib/legal/platform-tos.ts): true renders
 * components/legal/legacy-marketing-terms.tsx — the document live today, which
 * the version string below identifies — and false renders the Appendix A
 * rewrite. apps/portal/src/__tests__/lib/platform-tos.test.ts asserts the two
 * files agree AND that the page really consumes the flag, because a mismatch
 * would silently record consent to a document nobody was shown.
 *
 * The portal used to serve a SECOND, differently-worded copy of this agreement
 * at {tenant}.portal.drive-247.com/terms. That is retired: the route now 307s to
 * the canonical URL (apps/portal/next.config.js). Do not reintroduce a
 * portal-local copy — two documents both claiming to be the platform terms is
 * precisely what this consolidation removed.
 *
 * RETIRED VERSIONS.
 * "2026-02-legacy" named the portal's own 13-section document, which this
 * consolidation removed. Nothing was ever stamped with it (the acceptance
 * columns were added in the same change and no row carries a timestamp), but if
 * a Stripe Checkout session created before the cutover completes afterwards its
 * frozen metadata can still carry that string. The text is recoverable from git:
 *   git show d54f96d7:apps/portal/src/components/legal/legacy-platform-terms.tsx
 *
 * WHEN TO BUMP.
 * Bump on any material change to the terms text. Do NOT bump for typo fixes or
 * styling: every bump means existing accepted records no longer match current,
 * which is what a future re-acceptance prompt would key off.
 */
export const PLATFORM_TOS_VERSION = "2026-02-web";

/**
 * Set to this once the solicitor signs off and apps/web/src/lib/legal/platform-tos.ts
 * flips PLATFORM_TOS_IS_DRAFT to false. Both constants move together — see that
 * file's header. The test fails until they do.
 */
export const PLATFORM_TOS_PENDING_VERSION = "2026-08-01";

/**
 * Canonical public URLs of the platform legal documents.
 *
 * PLATFORM_TOS_URL is what belongs in Stripe's account-level "Terms of service
 * URL" setting when STRIPE_TOS_CONSENT_ENABLED is turned on — it serves the same
 * document PLATFORM_TOS_VERSION names, which is the property that makes the
 * consent record meaningful.
 */
export const PLATFORM_TOS_URL = "https://drive-247.com/terms";
export const PLATFORM_PRIVACY_URL = "https://drive-247.com/privacy";
