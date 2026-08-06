import type { Metadata } from "next";

import { LegacyMarketingTerms } from "@/components/legal/legacy-marketing-terms";
import { PlatformTosDocument } from "@/components/legal/platform-tos-document";
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
 *   PLATFORM_TOS_IS_DRAFT === true   → the previous marketing terms (live today)
 *   PLATFORM_TOS_IS_DRAFT === false  → the Appendix A rewrite
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

export default function TermsPage() {
  return PLATFORM_TOS_IS_DRAFT ? <LegacyMarketingTerms /> : <PlatformTosDocument />;
}
