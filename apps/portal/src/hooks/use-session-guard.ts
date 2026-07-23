"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/hooks/use-toast";

/**
 * Bulletproof force-logout listener for portal staff.
 *
 * The server (`admin-force-logout`) deletes the tenant's rows from
 * `auth.sessions`, which kills their refresh tokens. But that alone is NOT
 * immediate: the access JWT already in the browser stays valid until it expires
 * (~1h), and `getSession()` reads it straight from localStorage with no server
 * round-trip — which is exactly why "force logout" appeared to do nothing until
 * a token refresh happened to fail.
 *
 * This hook closes that gap with two mechanisms:
 *   1. Realtime BROADCAST (instant) — the edge function broadcasts `force_logout`
 *      on `tenant:{id}:auth` / `platform:auth`; any open tab signs out at once.
 *      Broadcast (not postgres_changes) so it never depends on the
 *      `supabase_realtime` publication.
 *   2. Server re-validation (covers reopened tabs / a missed broadcast) — on
 *      mount and whenever the tab regains focus, ask `verify-session` whether
 *      this session still exists server-side; if it was revoked, sign out.
 *
 * Super admins are exempt: neither per-tenant nor global force-logout revokes a
 * super admin's session server-side (they are not tenant users), so we must not
 * boot them client-side either.
 *
 * Everything fails OPEN: a network error, our own outage, or an ambiguous
 * response never logs a working operator out — only a definitive "your session
 * no longer exists" (or an explicit broadcast) does.
 */
export function useSessionGuard() {
  const router = useRouter();
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;

  // Reactive auth state. The store hydrates asynchronously — `getSession()`
  // resolves AFTER this hook first mounts — so we subscribe to `session` /
  // `initialized` and re-validate the moment the session actually lands, rather
  // than only on the first (still-null) mount render. Without this the reopen
  // backstop never runs: `revalidate` short-circuits on `session === null` at
  // mount and, being stable, is never retried.
  const session = useAuthStore((s) => s.session);
  const initialized = useAuthStore((s) => s.initialized);

  // Guards against firing the sign-out / redirect more than once when the
  // broadcast and a focus re-validation race each other.
  const signingOutRef = useRef(false);
  // Throttle the server check so rapid tab in/out doesn't hammer the function.
  const lastCheckRef = useRef(0);

  const forceSignOut = useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    toast({
      title: "You've been signed out",
      description:
        "An administrator ended your session. Please sign in again.",
    });
    try {
      await useAuthStore.getState().signOut();
    } catch {
      /* signOut already clears local state; ignore transport errors */
    } finally {
      router.replace("/login");
    }
  }, [router]);

  const revalidate = useCallback(async () => {
    const state = useAuthStore.getState();
    // Only meaningful while we believe we are authenticated.
    if (!state.session) return;
    // Super admins are never a force-logout target — skip the check entirely.
    if (state.appUser?.is_super_admin) return;

    const now = Date.now();
    if (now - lastCheckRef.current < 5000) return;
    lastCheckRef.current = now;

    try {
      const { data, error } = await supabase.functions.invoke("verify-session");
      // Act ONLY on an unambiguous "session revoked" answer. `error` (network /
      // 5xx / our own outage) and any other shape fail open.
      if (!error && data && data.valid === false) {
        await forceSignOut();
      }
    } catch {
      /* fail open */
    }
  }, [forceSignOut]);

  // Instant path: broadcast on the platform + tenant auth channels.
  useEffect(() => {
    const onSignal = () => {
      if (useAuthStore.getState().appUser?.is_super_admin) return;
      void forceSignOut();
    };

    const channels = [
      supabase
        .channel("platform:auth")
        .on("broadcast", { event: "force_logout" }, onSignal)
        .subscribe(),
    ];
    if (tenantId) {
      channels.push(
        supabase
          .channel(`tenant:${tenantId}:auth`)
          .on("broadcast", { event: "force_logout" }, onSignal)
          .subscribe(),
      );
    }

    return () => {
      channels.forEach((c) => {
        void supabase.removeChannel(c);
      });
    };
  }, [tenantId, forceSignOut]);

  // Backstop path #1: re-validate the moment the session hydrates. The auth
  // store starts null and sets `session` only after `getSession()` resolves,
  // which happens AFTER this hook's first mount — so a plain mount-time call
  // sees `session === null`, short-circuits, and never retries. Keying this
  // effect on `initialized`/`session` fires it exactly when the session lands,
  // which is the "reopened the portal after a force-logout" case.
  useEffect(() => {
    if (initialized && session) void revalidate();
  }, [initialized, session, revalidate]);

  // Backstop path #2: re-validate whenever the tab regains focus.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void revalidate();
    };
    window.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [revalidate]);
}
