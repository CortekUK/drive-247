"use client";

/**
 * Shown when the portal cannot resolve a tenant for the address in the browser bar.
 *
 * WHY THIS EXISTS
 * A tenant is identified by subdomain. When the subdomain matches no tenant —
 * most often a single mistyped character — `TenantContext` correctly gave up and
 * recorded an error, but nothing rendered it: `DynamicThemeProvider` gated the
 * whole app on a tenant that was never going to arrive, so the page sat on a
 * skeleton and a spinner forever.
 *
 * That made a typo indistinguishable from a total outage. An operator reported it
 * as "the app is down, I can't take bookings" on a busy evening, on both mobile
 * and desktop, when in fact they were one letter off their own address and the
 * platform was healthy the entire time. The cost of the missing screen was an
 * evening of lost business and an escalation; the address was correct in their
 * browser history the whole time.
 *
 * WHY IT DOES NOT SUGGEST A CLOSEST MATCH
 * "Did you mean moore-luxe-rentals?" would have resolved that incident in one
 * second, and it is deliberately not here. Answering it requires looking up
 * tenants by partial name from an unauthenticated page, which turns the portal
 * into a confirmed customer list for anyone who wants to enumerate it — every
 * operator on the platform, discoverable by guessing. The address is knowable to
 * the people who should have it, so the fix is to tell the user plainly what went
 * wrong and let them check their own records.
 */

import { AlertCircle } from "lucide-react";

interface TenantNotFoundProps {
  /** The subdomain we tried to resolve, if one was present at all. */
  slug: string | null;
  /** The message from TenantContext — already distinguishes "no subdomain". */
  message: string | null;
}

export function TenantNotFound({ slug, message }: TenantNotFoundProps) {
  // Rendered before any tenant branding is known, so it uses base tokens only
  // and never a tenant colour — there is no tenant to take a colour from.
  const host = typeof window !== "undefined" ? window.location.host : "";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8">
        <div className="flex items-center gap-3 mb-5">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
          <h1 className="text-lg font-medium text-foreground">
            We couldn&rsquo;t find a portal at this address
          </h1>
        </div>

        {host && (
          <p className="text-sm text-muted-foreground mb-4">
            You are visiting{" "}
            <span className="font-mono text-foreground break-all">{host}</span>
          </p>
        )}

        <p className="text-sm text-muted-foreground mb-5">
          {slug
            ? "That address does not match any account on the platform. It is usually a small typing mistake in the part before .portal.drive-247.com."
            : "No account name was found in the address. A portal address looks like your-company.portal.drive-247.com."}
        </p>

        <div className="rounded-md border border-border bg-muted/40 p-4 mb-5">
          <p className="text-xs font-medium text-foreground mb-2">
            What to try
          </p>
          <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
            <li>Check the spelling of your company name in the address.</li>
            <li>Open the portal from your saved bookmark or a link in one of our emails.</li>
            <li>If it still does not load, contact your administrator for the exact address.</li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">
          Your account and your data are unaffected. This address simply does not
          point to a portal.
        </p>

        {/* The raw reason, kept small and last. It is what support will ask for,
            and it is what turns "the site is broken" into a one-minute fix. */}
        {message && (
          <p className="mt-5 pt-4 border-t border-border text-xs text-muted-foreground font-mono break-all">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

export default TenantNotFound;
