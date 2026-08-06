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
 * The document tenants actually read is served by
 * apps/portal/src/app/(auth)/terms/page.tsx, which switches on
 * PLATFORM_TOS_IS_DRAFT: true renders components/legal/legacy-platform-terms.tsx
 * (the document live today), false renders the Appendix A rewrite from
 * apps/portal/src/lib/legal/platform-tos.ts. That module re-declares the pending
 * version string, and apps/portal/src/__tests__/lib/platform-tos.test.ts asserts
 * the two files agree AND that the page really consumes the flag — because a
 * mismatch would silently record consent to a document nobody was shown.
 *
 * WHEN TO BUMP.
 * Bump on any material change to the terms text. Do NOT bump for typo fixes or
 * styling: every bump means existing accepted records no longer match current,
 * which is what a future re-acceptance prompt would key off.
 */
export const PLATFORM_TOS_VERSION = "2026-02-legacy";

/**
 * Set to the Appendix A rewrite version once the solicitor signs off and
 * apps/portal/src/lib/legal/platform-tos.ts flips PLATFORM_TOS_IS_DRAFT to
 * false. Both constants move together — see that file's header.
 */
export const PLATFORM_TOS_PENDING_VERSION = "2026-08-01";

/** Canonical public URL of the platform terms, for Stripe Checkout + emails. */
export const PLATFORM_TOS_URL = "https://drive-247.com/terms";
