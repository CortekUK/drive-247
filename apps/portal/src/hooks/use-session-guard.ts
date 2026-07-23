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
 * Super admins:
 *   - A PER-TENANT force-logout boots a super admin who has THAT tenant's portal
 *     open — "force logout all users of this tenant" includes a support session
 *     viewing it. Their own session isn't deleted server-side (they're not a
 *     tenant user), so only the live tenant broadcast evicts them; forceSignOut
 *     then self-revokes the current session.
 *   - A GLOBAL (platform-wide) logout NEVER boots super admins — that is the
 *     escape hatch that stops a global logout from locking every platform admin
 *     (including whoever triggered it) out at once.
 * The server-side revocation also skips super admins on a global logout, so the
 * two halves agree.
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
      // scope: 'local' — revoke ONLY this browser's session, not every session
      // the user has. This matters for a super admin booted from a tenant portal:
      // a global sign-out would also kill the admin-panel session they triggered
      // the logout from (and all their other tabs). An operator's session was
      // already deleted server-side, so local is equally correct for them.
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      /* ignore transport errors — we clear local state + redirect regardless */
    } finally {
      // Clear store state immediately (the onAuthStateChange listener also fires,
      // but don't wait on it) then leave for /login.
      useAuthStore.setState({ user: null, session: null, appUser: null });
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
    // Per-tenant logout: boot EVERYONE viewing this tenant's portal, including a
    // super admin who has it open — a tenant force-logout means every session in
    // that tenant's portal (support included) should re-authenticate.
    const bootNow = () => void forceSignOut();
    // Global logout: never boot super admins, or a platform-wide logout would
    // lock out every admin at once (including whoever triggered it).
    const bootUnlessSuperAdmin = () => {
      if (useAuthStore.getState().appUser?.is_super_admin) return;
      void forceSignOut();
    };

    const channels = [
      supabase
        .channel("platform:auth")
        .on("broadcast", { event: "force_logout" }, bootUnlessSuperAdmin)
        .subscribe(),
    ];
    if (tenantId) {
      channels.push(
        supabase
          .channel(`tenant:${tenantId}:auth`)
          .on("broadcast", { event: "force_logout" }, bootNow)
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
