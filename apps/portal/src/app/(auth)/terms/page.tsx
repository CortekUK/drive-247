"use client";

/**
 * Drive247 platform Terms of Use — {tenant}.portal.drive-247.com/terms
 *
 * This is the document a tenant is shown when they tick the acceptance box on
 * the login page and in the subscribe flow (components/legal/terms-consent.tsx
 * links here), so what it renders MUST match the version string that
 * create-subscription-checkout stamps into tenants.platform_tos_version. That
 * coupling is the entire reason this page is a switch rather than a static
 * document:
 *
 *   PLATFORM_TOS_IS_DRAFT === true   → the previous terms (live today)
 *   PLATFORM_TOS_IS_DRAFT === false  → the Appendix A rewrite
 *
 * Flipping that one flag therefore changes BOTH what is rendered and — via the
 * paired constant in supabase/functions/_shared/platform-tos.ts, which the test
 * in __tests__/lib/platform-tos.test.ts holds in sync — what gets recorded.
 * Previously the Appendix A module rendered nowhere, so the flip would silently
 * have stamped consent to a document nobody was ever shown.
 *
 * The page stays public and inside the (auth) route group: (auth)/layout does no
 * auth check, which is required because the consent checkboxes open this in a
 * new tab for a user who is not signed in yet.
 */

import { ThemeToggle } from "@/components/shared/layout/theme-toggle";
import { LegacyPlatformTerms } from "@/components/legal/legacy-platform-terms";
import { PlatformTosDocument } from "@/components/legal/platform-tos-document";
import { PLATFORM_TOS_IS_DRAFT } from "@/lib/legal/platform-tos";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      {PLATFORM_TOS_IS_DRAFT ? <LegacyPlatformTerms /> : <PlatformTosDocument />}
    </div>
  );
}
