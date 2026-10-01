"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuthStore } from "@/stores/auth-store";

/**
 * "Continue with Google" for the OPERATOR portal login.
 *
 * ── why this is not just a button ──────────────────────────────────────────
 *
 * The portal is tenant-scoped by subdomain. A password login makes landing on
 * the wrong one unlikely — you have to type credentials at
 * `someone-elses.portal.drive-247.com` on purpose. Google makes it one click
 * from anywhere, so the check that was implicit has to become explicit.
 *
 * `app_users.auth_user_id` is unique: one login belongs to exactly one tenant.
 * So after the redirect, `appUser.tenant_id` either matches the tenant this
 * subdomain resolved to or it does not, and "does not" means this person has
 * no business being on this portal. They are signed out again and told so.
 *
 * Without that, a Northwind operator clicking Google on Moore Luxe's login
 * would land inside a portal shell branded for a company they do not work for.
 * RLS would still scope the DATA to their own tenant — so this is not a leak —
 * but every label, logo and link around it would be someone else's, which reads
 * as a far worse bug than it is.
 *
 * ── the flag ───────────────────────────────────────────────────────────────
 *
 * OFF unless `NEXT_PUBLIC_PORTAL_GOOGLE_ENABLED` is exactly "true", mirroring
 * the signup side's `NEXT_PUBLIC_SIGNUP_GOOGLE_ENABLED`. Two things must be
 * true on the server before this can work — a Google provider on the Supabase
 * project, and this origin registered as a redirect URL — and neither is
 * visible from the browser. This is the login screen for every operator, so a
 * button that answers with a Supabase 400 is worse than no button.
 */
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_PORTAL_GOOGLE_ENABLED === "true";

/** Marks the return leg so the effect below knows to check membership. */
export const OAUTH_RETURN_PARAM = "oauth";

export interface GoogleSignIn {
  /** Render the button at all. */
  enabled: boolean;
  /** Redirecting to Google, or checking membership on the way back. */
  busy: boolean;
  /** Set when the Google account is not a user of THIS portal. */
  error: string | null;
  start: () => Promise<void>;
  clearError: () => void;
}

export function useGoogleSignIn(): GoogleSignIn {
  const { tenant } = useTenant();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(OAUTH_RETURN_PARAM, "1");
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: url.toString(),
          // `select_account` so a shared machine does not silently sign the
          // last person back in — on a staff portal that is a real hazard.
          queryParams: { prompt: "select_account" },
        },
      });
      if (oauthError) throw oauthError;
      // The browser is leaving; keep the spinner until it does.
    } catch (e) {
      setBusy(false);
      setError(
        e instanceof Error ? e.message : "Could not start Google sign-in.",
      );
    }
  }, []);

  /*
   * THE RETURN LEG. Supabase has already set a session by the time this runs,
   * so a mismatch means signing an authenticated user back OUT — which is the
   * point: the session is valid, it just does not belong on this subdomain.
   */
  useEffect(() => {
    if (!GOOGLE_ENABLED || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get(OAUTH_RETURN_PARAM) !== "1") return;

    let cancelled = false;
    setBusy(true);

    void (async () => {
      // `appUser` resolves asynchronously after the session lands. Poll rather
      // than assume: reading it too early reports "not a member" for someone
      // who is one, and signs them out of their own portal.
      const deadline = Date.now() + 10_000;
      let appUser = useAuthStore.getState().appUser;
      while (!appUser && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 150));
        if (cancelled) return;
        appUser = useAuthStore.getState().appUser;
      }
      if (cancelled) return;

      const stripParam = () => {
        const url = new URL(window.location.href);
        url.searchParams.delete(OAUTH_RETURN_PARAM);
        window.history.replaceState({}, "", url.toString());
      };

      if (!appUser) {
        await supabase.auth.signOut();
        stripParam();
        setBusy(false);
        setError(
          "That Google account has no Drive247 login. Ask your administrator to add you, then try again.",
        );
        return;
      }

      // The explicit check this hook exists for.
      if (tenant?.id && appUser.tenant_id && appUser.tenant_id !== tenant.id) {
        await supabase.auth.signOut();
        stripParam();
        setBusy(false);
        setError(
          "That Google account belongs to a different company's portal. Check the web address and try again.",
        );
        return;
      }

      // Member of this tenant. Leave the session alone — the dashboard's own
      // redirect takes it from here — and just tidy the URL.
      stripParam();
      setBusy(false);
    })();

    return () => {
      cancelled = true;
    };
    // `tenant?.id` only: re-running on any other change would re-check a
    // session this effect has already accepted.
  }, [tenant?.id]);

  return {
    enabled: GOOGLE_ENABLED,
    busy,
    error,
    start,
    clearError: useCallback(() => setError(null), []),
  };
}
