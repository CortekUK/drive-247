'use client';

/**
 * "Continue with Google" for the customer sign-in and sign-up pages, as the
 * operator portal v2's login draws it (apps/portal/src/components/auth-v2/
 * login-v2.tsx): an "or" rule under the form's own button, then the outline
 * button with Google's mark, tinted so it does not read as disabled beside the
 * solid primary above it.
 *
 * Two legs (customer-auth-store `startGoogleSignIn` / `completeGoogleSignIn`):
 *   1. the button leaves for Google, which returns to THIS page with
 *      `?oauth=google`;
 *   2. on that return this component finishes the sign-in: the Google account
 *      becomes (or is found to be) a customer of this site, the block checks
 *      run, and the page moves on to where the form would have sent it.
 *
 * The same component on both pages, because for a Google account signing in
 * and signing up are one action: a first visit creates the customer, a later
 * one finds it.
 *
 * V2 ONLY. Drawn only for a tenant on V2 (`portal_experience = 'v2'`, or a
 * canary slug: `isLeanTenant`, the rule every v2 gate uses), and the
 * `customer-google-link` function refuses anyone else with the same rule. A v1
 * tenant's customers keep email and password. Until the answer is in, nothing
 * is drawn, so a v1 site never flashes the button.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react-nw';

import { isLeanTenant, readTenantOnV2ById } from '@/lib/lean-tenants';
import { supabase } from '@nw/integrations/supabase/client';

import { useCustomerAuth } from '@nw/contexts/CustomerAuthContext';
import { useTenant } from '@nw/contexts/TenantContext';
import { GOOGLE_RETURN_PARAM, type AuthFailure } from '@nw/lib/stores/customer-auth-store';

/**
 * Google's four-colour mark, inline and unaltered, as Google's brand rules ask
 * (the operator portal's components/ui/google-mark.tsx). `aria-hidden`: the
 * button's text already says "Google".
 */
export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className={className}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.95 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58Z" />
    </svg>
  );
}

/** Is this site's tenant on V2? Null while the answer is not in. */
function useTenantOnV2(): boolean | null {
  const { tenant } = useTenant();
  const query = useQuery({
    queryKey: ['tenant-on-v2', tenant?.id],
    queryFn: () => readTenantOnV2ById(supabase, tenant?.id),
    enabled: !!tenant?.id,
    staleTime: 5 * 60_000,
  });
  if (!tenant?.id) return null;
  if (isLeanTenant(tenant.slug)) return true;
  return query.isSuccess ? isLeanTenant(tenant.slug, query.data) : null;
}

/** Drop the return marker (and anything Google added) so a reload does not repeat the finish. */
function cleanAddress() {
  const url = new URL(window.location.href);
  for (const key of [GOOGLE_RETURN_PARAM, 'error', 'error_code', 'error_description']) url.searchParams.delete(key);
  url.hash = '';
  window.history.replaceState({}, '', url.toString());
}

export function ContinueWithGoogle({
  disabled = false,
  onSignedIn,
  onBusyChange,
}: {
  /** The form is submitting. */
  disabled?: boolean;
  /** Signed in as a customer of this site: go where the form would go. */
  onSignedIn: () => void;
  /** Lets the page hold its own form while Google is in progress. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { startGoogleSignIn, completeGoogleSignIn } = useCustomerAuth();
  const { isLoading: tenantLoading } = useTenant();
  const onV2 = useTenantOnV2();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const finishing = useRef(false);

  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  // THE RETURN LEG: finish once the tenant is known (the link is per tenant).
  useEffect(() => {
    if (tenantLoading || finishing.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get(GOOGLE_RETURN_PARAM) !== 'google') return;
    finishing.current = true;

    // Google (or Supabase) says why it stopped, e.g. the person pressed Cancel.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const denied = params.get('error_description') ?? hash.get('error_description');
    if (denied) {
      cleanAddress();
      setFailure({ kind: 'unexpected', message: 'Google sign-in was cancelled. Please try again.' });
      return;
    }

    setBusy(true);
    void completeGoogleSignIn().then((result) => {
      cleanAddress();
      if (result.ok) {
        onSignedIn(); // stay busy through the navigation
        return;
      }
      setBusy(false);
      setFailure(result.failure);
    });
  }, [tenantLoading, completeGoogleSignIn, onSignedIn]);

  // A v1 tenant (or one not known yet) gets no Google option at all.
  if (onV2 !== true) return null;

  const start = async () => {
    setFailure(null);
    setBusy(true);
    const result = await startGoogleSignIn();
    if (!result.ok) {
      setBusy(false);
      setFailure(result.failure);
    }
    // On success the browser is leaving for Google; keep the spinner until it does.
  };

  return (
    <div className="space-y-4">
      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-pv-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-2 text-pv-muted-fg">or</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void start()}
        disabled={busy || disabled || tenantLoading}
        className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-2xl border border-pv-primary/20 bg-pv-primary/[0.06] text-base font-medium text-pv-fg shadow-sm transition-colors hover:border-pv-primary/30 hover:bg-pv-primary/[0.12] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-pv-primary/30 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
      >
        {busy ? (
          <>
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Connecting to Google…
          </>
        ) : (
          <>
            <GoogleMark className="size-5" />
            Continue with Google
          </>
        )}
      </button>

      {failure ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-pv-danger/30 bg-pv-danger-light px-4 py-3 text-sm text-pv-danger"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>{failure.message}</p>
        </div>
      ) : null}
    </div>
  );
}
