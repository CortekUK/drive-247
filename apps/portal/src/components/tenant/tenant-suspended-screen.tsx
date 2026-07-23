"use client";

import { Ban } from "lucide-react";

/**
 * Full-screen, non-dismissible block shown when a tenant's `status` is
 * `suspended`. Unlike the subscription paywall there is NO action the operator
 * can take from here — reactivation is done by a Drive247 super admin flipping
 * the status back to `active`. Their data is untouched; access is simply frozen.
 */
export function TenantSuspendedScreen() {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/95 backdrop-blur-md">
      <div className="mx-4 w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-2xl">
        {/* Colored top bar */}
        <div className="h-1.5 bg-gradient-to-r from-destructive via-destructive/80 to-orange-500" />

        <div className="p-8">
          <div className="flex flex-col items-center text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 ring-4 ring-destructive/5">
              <Ban className="h-8 w-8 text-destructive" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">
              Account suspended
            </h2>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Access to this account is currently paused. Your data is safe and
              nothing has been lost — please get in touch to restore access.
            </p>
            <a
              href="mailto:support@drive-247.com"
              className="mt-8 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Contact Drive247
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
