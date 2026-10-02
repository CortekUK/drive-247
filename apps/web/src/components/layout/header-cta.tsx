"use client";

/**
 * The header's one button: "Book a strategy call", or "Dashboard" for an
 * operator who already pays.
 *
 * ── WHY IT STARTS AS THE STRATEGY CALL ──────────────────────────────────────
 *
 * This page is served statically to everyone, so the first paint cannot know
 * who is reading it. It renders the marketing button and swaps only once the
 * server has confirmed, for this caller, that a live portal exists. The wrong
 * order — "Dashboard" first, corrected to the marketing button — would show a
 * link to a portal that may not be theirs, and would flicker for the visitors
 * this page is actually written for.
 *
 * ── WHOSE SESSION THIS IS ───────────────────────────────────────────────────
 *
 * The session read here belongs to drive-247.com: the one "Continue with
 * Google" and the signup dialog create. Signing in at portal.drive-247.com is a
 * DIFFERENT origin with its own storage, and this page cannot see it — so an
 * operator who has only ever logged into their portal still sees the marketing
 * button here. That is a limitation of the two domains, not a bug to chase.
 *
 * The decision itself is `my_portal_access()`, a security-definer function that
 * answers for `auth.uid()` and nothing else. The browser is never given the
 * staff or billing tables it would otherwise need to work this out.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getBrowserSupabase } from "@/lib/supabase/browser";

const BUTTON_CLASS =
  "bg-indigo-600 px-5 text-sm font-normal text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600";

interface PortalAccess {
  portal_url: string | null;
  company_name: string | null;
  is_active: boolean | null;
}

export function HeaderCta() {
  const [portalUrl, setPortalUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const resolve = async () => {
      try {
        const supabase = getBrowserSupabase();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!alive) return;
        if (!session) {
          setPortalUrl(null);
          return;
        }

        const { data, error } = await supabase.rpc("my_portal_access");
        if (!alive) return;
        if (error) {
          // A header button is not worth a broken page: the marketing button
          // stays, which is the correct answer for everyone who is not a paying
          // operator anyway. Logged, because a persistent failure here means the
          // migration has not been applied.
          console.warn("[header] portal access check failed:", error.message);
          setPortalUrl(null);
          return;
        }

        const row = (Array.isArray(data) ? data[0] : data) as PortalAccess | undefined;
        setPortalUrl(row?.is_active && row.portal_url ? row.portal_url : null);
      } catch (e) {
        if (alive) {
          console.warn("[header] portal access check threw:", e);
          setPortalUrl(null);
        }
      }
    };

    void resolve();

    // Signing in or out happens on this page — the signup dialog's Google
    // button returns to it — so the button follows the session rather than
    // waiting for a reload.
    const { data: sub } = getBrowserSupabase().auth.onAuthStateChange(() => {
      void resolve();
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (portalUrl) {
    return (
      <Button asChild size="sm" className={BUTTON_CLASS}>
        {/* A full navigation, not a client route: the portal is another app on
            another subdomain. */}
        <a href={portalUrl}>Dashboard</a>
      </Button>
    );
  }

  return (
    <Button asChild size="sm" className={BUTTON_CLASS}>
      <a href="/strategy-call">Book a strategy call</a>
    </Button>
  );
}
