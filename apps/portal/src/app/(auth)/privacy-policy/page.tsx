"use client";

/**
 * Portal Privacy Policy — {tenant}.portal.drive-247.com/privacy-policy
 *
 * WHY THIS ROUTE EXISTS.
 * The login page renders a MANDATORY acceptance checkbox whose label reads
 * "I accept the Privacy Policy and Terms & Conditions" and hard-blocks the
 * submit button until it is ticked (see (auth)/login/page.tsx). The "Terms &
 * Conditions" half linked to /terms and resolved; the "Privacy Policy" half
 * linked to /privacy-policy, which did not exist — so on the one screen where a
 * user legally attests to having read a document, that document 404'd onto an
 * unbranded grey error page. This route closes that.
 *
 * It deliberately lives in the (auth) route group and is PUBLIC: (auth)/layout
 * does no auth check, which is required because the link opens in a new tab for
 * a user who is by definition not signed in yet. It mirrors (auth)/terms so the
 * two read as a pair, since the checkbox presents them as one.
 *
 * DO NOT point this at apps/web's /privacy. That document is written for the
 * RENTER's data and takes a data-PROCESSOR stance ("we act as a data processor
 * on behalf of the independent rental operators"). This page's audience is the
 * operator's own staff, which is a controller relationship — the wrong stance
 * would be legally misleading, not merely imprecise. Also note web's route is
 * /privacy, not /privacy-policy, and the portal is a separate deployment on a
 * different origin, so a root-relative link can never reach it anyway.
 *
 * ── INTERIM CONTENT ───────────────────────────────────────────────────────────
 * The full Privacy Policy is being drafted (it is an open item on the 6 Aug 2026
 * handoff: "Privacy Policy document doesn't exist yet — Ghulam will get this
 * drafted separately"). Everything below is deliberately limited to facts that
 * are already true and already published elsewhere: the controlling entity, the
 * contact route for data requests, and a plain statement that the full document
 * is pending. No retention periods, lawful bases, sub-processor lists, or rights
 * mechanics are asserted here — inventing those would create commitments nobody
 * has approved, which is worse than the 404 this replaces.
 *
 * WHEN GHULAM DELIVERS: replace the <CardContent> body below. Keep the shell,
 * the route, and the (auth) placement.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/shared/layout/theme-toggle";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <Card className="max-w-3xl mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">
            DRIVE247 PRIVACY POLICY
          </CardTitle>
          <p className="text-sm text-muted-foreground text-center mt-2">
            How Cortek Systems Ltd (&quot;Cortek&quot;), operating the Drive247
            platform, handles personal information belonging to platform users.
          </p>
        </CardHeader>

        <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
            <h2 className="text-lg font-semibold">Full policy in preparation</h2>
            <p className="text-sm text-muted-foreground">
              Our complete Privacy Policy is being finalised and will be
              published on this page. Until it is, this page records who is
              responsible for your information and how to contact us about it.
              We would rather tell you that plainly than publish an incomplete
              policy you might rely on.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Who is responsible</h2>
            <p className="text-sm text-muted-foreground">
              The Drive247 platform is operated by{" "}
              <em>Cortek Systems Ltd (&quot;Cortek&quot;)</em>, a UK-registered
              company. Cortek is responsible for personal information relating to
              the portal accounts of rental operators and their staff.
            </p>
            <p className="text-sm text-muted-foreground">
              Where a rental operator collects information about its own
              customers (renters) through the platform, that operator determines
              how that information is used, and Cortek processes it on the
              operator&apos;s behalf. Renters should refer to the privacy policy
              published on the rental operator&apos;s own booking site.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Contacting us</h2>
            <p className="text-sm text-muted-foreground">
              For any question about your personal information — including
              requests to access, correct, or delete it — contact:
            </p>
            <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-1">
              <li>
                Privacy enquiries:{" "}
                <a
                  href="mailto:privacy@cortek.co"
                  className="text-primary underline hover:text-primary/80"
                >
                  privacy@cortek.co
                </a>
              </li>
              <li>
                General support:{" "}
                <a
                  href="mailto:support@drive-247.com"
                  className="text-primary underline hover:text-primary/80"
                >
                  support@drive-247.com
                </a>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Related documents</h2>
            <p className="text-sm text-muted-foreground">
              Your use of the platform is also governed by the{" "}
              <a
                href="/terms"
                className="text-primary underline hover:text-primary/80"
              >
                Platform Terms of Use
              </a>
              .
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
