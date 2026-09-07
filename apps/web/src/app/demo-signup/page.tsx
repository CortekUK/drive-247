import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

/**
 * The journey moved to `/signup-preview`, which now hosts the whole thing on one
 * surface starting from the real pricing grid. This route is kept only as the
 * forwarding address.
 *
 * IT IS A REDIRECT AND NOT A DELETION because the portal's dev page links here:
 * `apps/portal/src/components/dev/dev-page.tsx` builds
 * `${NEXT_PUBLIC_WEB_BASE_URL}/demo-signup`, and a test in that app asserts the
 * literal URL. Deleting the route would turn that link into a 404 in a file this
 * change is not allowed to touch.
 *
 * The dev-branch-first guard is the same one `/signup-preview` carries, for the
 * same reason: `process.env.NODE_ENV` folds to a literal at build time, so in a
 * production build the branch — and the redirect with it — folds away and the
 * route is nothing but `notFound()`. The spelling
 * `if (!IS_DEV) notFound(); redirect(…)` would NOT fold, because no minifier
 * knows `notFound()` never returns.
 */
export const metadata: Metadata = {
  title: "Get started — Drive247",
  robots: { index: false, follow: false },
};

const IS_DEV = process.env.NODE_ENV === "development";

export default function DemoSignupPage() {
  if (IS_DEV) {
    redirect("/signup-preview");
  }

  notFound();
}
