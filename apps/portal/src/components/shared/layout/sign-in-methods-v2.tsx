"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui-v2/button";
import { Label } from "@/components/ui-v2/label";
import { toast } from "@/hooks/use-toast";
import { callAccountFn, type AccountAnswer } from "@/lib/account-functions";

/**
 * feat-001 spec 07 · "Sign-in methods" in the profile.
 *
 * Shows how this account signs in (07.1) and connects / disconnects Google.
 * Every rule is enforced by `account-identity-check` on the server; this only
 * asks and shows. Connecting is Supabase's `linkIdentity`, a trip to Google
 * and back; `GoogleLinkReturn` (mounted in the dashboard layout) checks the
 * link the moment the person lands back, and this panel checks again each time
 * it opens, so a Google account with another email never stays linked (07.4).
 */

/** Instagram and Facebook's own browsers: Google refuses to sign in there (07.10). */
export const isInAppBrowser = () =>
  typeof navigator !== "undefined" && /Instagram|FBAN|FBAV|FB_IAB/i.test(navigator.userAgent);

/** Marker on the way back from Google, so the return can be told apart. */
const RETURN_FLAG = "google_link";

export type SignInMethods = { password: boolean; google: string | null };

export function useSignInMethods(enabled: boolean) {
  const [methods, setMethods] = useState<SignInMethods | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    setFailed(false);
    // check_google first: it removes a wrongly linked Google account on the
    // server before anything is shown.
    const checked = await callAccountFn("account-identity-check", { action: "check_google" });
    if (checked.code === "GOOGLE_EMAIL_MISMATCH") {
      toast({ title: "Google not connected", description: checked.error, variant: "destructive" });
    }
    const r = await callAccountFn("account-identity-check", { action: "status" });
    if (!r.ok) {
      setFailed(true);
      return null;
    }
    const next = { password: !!r.password, google: r.google ?? null };
    setMethods(next);
    return next;
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return { methods, failed, refresh };
}

export function SignInMethodsV2({
  methods,
  failed,
  onChanged,
  onSetPassword,
}: {
  methods: SignInMethods | null;
  failed: boolean;
  onChanged: () => void;
  onSetPassword: () => void;
}) {
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const inApp = isInAppBrowser();

  const connect = async () => {
    setBusy("connect");
    const url = new URL(window.location.href);
    url.searchParams.set(RETURN_FLAG, "1");
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: url.toString() },
    });
    // On success the browser is already on its way to Google.
    if (error) {
      setBusy(null);
      toast({
        title: "Couldn't connect Google",
        // Supabase Auth needs the Google provider AND "manual linking" on.
        description: /manual linking|provider is not enabled|unsupported provider/i.test(error.message)
          ? "Connecting Google is not switched on for this portal yet."
          : error.message,
        variant: "destructive",
      });
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    const r: AccountAnswer = await callAccountFn("account-identity-check", { action: "unlink_google" });
    setBusy(null);
    if (r.ok) {
      toast({ title: "Google disconnected", description: "You now sign in with your email and password." });
      onChanged();
      return;
    }
    toast({ title: "Couldn't disconnect Google", description: r.error || "Please try again.", variant: "destructive" });
    if (r.code === "NO_PASSWORD") onSetPassword();
  };

  return (
    <div className="space-y-2" data-testid="sign-in-methods">
      <Label>Sign-in methods</Label>
      {failed ? (
        <p className="text-[12px] text-muted-foreground">We couldn&apos;t load your sign-in methods just now.</p>
      ) : !methods ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          <div className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Email and password</p>
              <p className="text-[12px] text-muted-foreground">
                {methods.password ? "Set" : "No password yet"}
              </p>
            </div>
            {!methods.password && (
              <Button variant="outline" size="sm" className="max-sm:min-h-11" onClick={onSetPassword}>
                Set a password
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Google</p>
              <p className="truncate text-[12px] text-muted-foreground">
                {methods.google !== null ? `Connected (${methods.google || "Google account"})` : "Not connected"}
              </p>
            </div>
            {inApp ? (
              <p className="max-w-[45%] text-right text-[11px] text-muted-foreground">
                Open this page in your browser to change Google.
              </p>
            ) : methods.google !== null ? (
              <Button
                variant="outline"
                size="sm"
                className="max-sm:min-h-11"
                onClick={disconnect}
                disabled={busy !== null}
              >
                {busy === "disconnect" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disconnect"}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="max-sm:min-h-11"
                onClick={connect}
                disabled={busy !== null}
              >
                {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect Google"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Back from Google (07.3–07.5): checks the new link on the server and says how
 * it went, then takes the marker out of the address. Supabase reports a Google
 * account that already belongs to someone else as an error in the address.
 */
export function GoogleLinkReturn() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const errorText = url.searchParams.get("error_description") || hash.get("error_description") || "";
    if (!url.searchParams.has(RETURN_FLAG)) return;

    url.searchParams.delete(RETURN_FLAG);
    for (const k of ["error", "error_code", "error_description"]) url.searchParams.delete(k);
    window.history.replaceState(null, "", url.pathname + (url.search || "") );

    void (async () => {
      if (errorText) {
        toast({
          title: "Google not connected",
          description: /already linked|already exists|in use/i.test(errorText)
            ? "This Google account is already connected to another Drive247 account."
            : errorText.replace(/\+/g, " "),
          variant: "destructive",
        });
        return;
      }
      const r = await callAccountFn("account-identity-check", { action: "check_google" });
      if (r.ok && r.google !== null && r.google !== undefined) {
        toast({ title: "Google connected", description: "You can now sign in with Google as well." });
      } else if (!r.ok) {
        toast({ title: "Google not connected", description: r.error || "Please try again.", variant: "destructive" });
      }
    })();
  }, []);
  return null;
}
