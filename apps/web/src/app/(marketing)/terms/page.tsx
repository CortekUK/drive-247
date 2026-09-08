import type { Metadata } from "next";

import { InterimPlatformTerms } from "@/components/legal/interim-platform-terms";
import { PlatformTosDocument } from "@/components/legal/platform-tos-document";
import { PublishedLegalDocument } from "@/components/legal/published-legal-document";
import { fetchLegalDocument } from "@/lib/legal/legal-documents-server";
import { PLATFORM_TOS_IS_DRAFT } from "@/lib/legal/platform-tos";

/**
 * THE CANONICAL Drive247 platform Terms of Service — drive-247.com/terms
 *
 * This is the single public home for the operator↔Drive247 contract. The portal
 * used to serve a second, different version of the same agreement at
 * {tenant}.portal.drive-247.com/terms; that route now 307s here (see
 * apps/portal/next.config.js) so there is exactly one document, one URL, and one
 * version string.
 *
 * WHAT THIS PAGE RENDERS IS COUPLED TO WHAT GETS RECORDED. The acceptance
 * checkbox in the portal links here, and create-subscription-checkout stamps
 * tenants.platform_tos_version from supabase/functions/_shared/platform-tos.ts.
 * So the flag below must move together with that constant:
 *
 *   PLATFORM_TOS_IS_DRAFT === true   → the interim Platform Terms of Use
 *   PLATFORM_TOS_IS_DRAFT === false  → the Appendix A rewrite
 *
 * The interim document is the 13-section text the portal used to serve, NOT the
 * 8-section marketing summary that previously sat on this URL. The summary had
 * no payment terms, no governing law, no liability cap and no warranty
 * disclaimer, which is not a contract to charge a tenant against — even for the
 * few weeks of a sign-off window.
 *
 * apps/portal/src/__tests__/lib/platform-tos.test.ts holds the two in sync and
 * fails if only one is changed.
 *
 * NOT a tenant's rental terms. apps/booking serves those per-tenant at
 * {tenant}.drive-247.com/terms from the CMS — a different contract between the
 * renter and the operator, under A2P 10DLC carrier review. Never cross-link them.
 */

export const metadata: Metadata = {
  title: "Terms of Service — Drive247",
  description: "Terms governing use of the Drive247 platform.",
};

/**
 * A super admin can now author this document in apps/admin, and what they
 * publish wins. Everything below that is unchanged and stays as the fallback.
 *
 * The fallback is not a nicety. `fetchLegalDocument` returns null on ANY
 * failure — no table yet, an outage, nothing published, a row with an empty
 * body — and this page is prerendered, so without a compiled document to fall
 * back on a Supabase blip would fail `next build` and take the marketing site
 * down over a page that changes twice a year.
 */
export default async function TermsPage() {
  const doc = await fetchLegalDocument("terms");
  if (doc) return <PublishedLegalDocument doc={doc} />;

  return PLATFORM_TOS_IS_DRAFT ? <InterimPlatformTerms /> : <PlatformTosDocument />;
}
