"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { fetchAppUserResult, useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { CodeInput } from "@/components/ui-v2/code-input";
import { Label } from "@/components/ui-v2/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";

/** Seconds before another code may be asked for (Supabase's own limit is 60). */
export const SIGN_IN_CODE_WAIT = 60;

/**
 * "Email me a sign-in code" (feat-001 spec 05): the way in for someone who has
 * no password yet, or has forgotten it and only wants to get in.
 *
 *   1. the address → `signInWithOtp({ shouldCreateUser: false })`. The auth
 *      email hook sends staff a six-digit code, not a link (`otp=1` asks for
 *      it outright as well).
 *   2. the code → `verifyOtp({ type: "email" })`, which signs the person in.
 *      The login page then does what it does after a password: the
 *      wrong-portal sign-out (05.5) or the way in. A pending signup flag
 *      brings up the verify window on the dashboard (05.3).
 *
 * Step 1 always says the same thing, and every error from it is swallowed:
 * an unknown email is refused by Supabase at once, a known one is not, so
 * showing either would tell anyone who has an account (05.2). The wait before
 * a second code is kept here for the same reason, for every address alike.
 */
export function SignInCodeDialog({
  open,
  onOpenChange,
  initialEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEmail: string;
}) {
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wait, setWait] = useState(0);
  const sending = useRef(false);

  useEffect(() => {
    if (!open) return;
    setEmail(initialEmail);
    setCodeSent(false);
    setCode("");
    setError("");
  }, [open, initialEmail]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const sendCode = async () => {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter the email address you sign in with.");
      return;
    }
    if (sending.current || wait > 0) return;
    sending.current = true;
    setError("");
    setBusy(true);
    try {
      await supabase.auth.signInWithOtp({
        email: address,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/login?otp=1`,
        },
      });
    } catch {
      /* Same answer either way — see the header. */
    } finally {
      sending.current = false;
      setBusy(false);
      setCode("");
      setCodeSent(true);
      setWait(SIGN_IN_CODE_WAIT);
    }
  };

  const checkCode = async (value = code) => {
    if (value.trim().length < 6) {
      setError("Enter the six-digit code from your email.");
      return;
    }
    if (sending.current) return;
    sending.current = true;
    setError("");
    setBusy(true);
    try {
      const { data: verified, error: codeError } = await supabase.auth.verifyOtp({
        type: "email",
        email: email.trim(),
        token: value.trim(),
      });
      if (codeError) {
        setCode("");
        // Supabase answers a mistyped code and an expired one with the same
        // "Token has expired or is invalid", so one message covers both.
        setError(
          /too many|rate limit/i.test(codeError.message)
            ? "Too many tries. Wait a minute, then ask for a new code."
            : "That code didn't work, or it has expired. Check it, or ask for a new one.",
        );
        return;
      }
      // The same profile checks a password sign-in makes (auth-store signIn):
      // without them a deactivated person, or one with no portal profile (a
      // booking-site customer), was left signed in on the login page with no
      // word of why (found testing step 6).
      let signedIn: { id: string; tenant_id: string | null } | null = null;
      if (verified?.user) {
        const profile = await fetchAppUserResult(verified.user);
        if (profile.status === "unavailable") {
          setError("We could not load your account just now. Please check your connection and try again.");
          return;
        }
        if (profile.status === "absent") {
          await supabase.auth.signOut({ scope: "local" });
          setError("There is no portal account for this email. Ask your administrator to invite you.");
          return;
        }
        if (!profile.appUser.is_super_admin && !profile.appUser.is_active) {
          await supabase.auth.signOut({ scope: "local" });
          setError("Your account has been deactivated. Please contact your system administrator.");
          return;
        }
        signedIn = profile.appUser;
        // Hand the session to the login page now. It redirects on user +
        // appUser from the store, which otherwise waited on the deferred
        // auth listener; the first code sign-in tested closed this window
        // and left the person on the login page.
        useAuthStore.setState({ user: verified.user, appUser: profile.appUser, loading: false, initialized: true });
      }
      // Signed in: the login page takes it from here. The row names the person
      // and their company, as the password sign-in's does: Health Score counts
      // only identified login rows as engagement (review finding 2).
      try {
        await supabase.from("audit_logs").insert({
          action: "login_success",
          tenant_id: signedIn?.tenant_id ?? null,
          actor_id: signedIn?.id ?? null,
          entity_type: "session",
          details: { email: email.trim(), method: "email_code", user_agent: navigator.userAgent },
        });
      } catch {
        /* an audit row is never a reason to stop someone signing in */
      }
      onOpenChange(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-md max-sm:px-5">
        <DialogHeader>
          <DialogTitle>Sign in with a code</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            {codeSent
              ? `If ${email.trim()} has an account here, a six-digit code is on its way. Enter it below.`
              : "We'll email you a six-digit code. No password needed."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {!codeSent ? (
            <div className="space-y-1.5">
              <Label htmlFor="code-email">Email</Label>
              <Input
                id="code-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && sendCode()}
                placeholder="you@example.com"
                autoFocus
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="code-digits">Six-digit code</Label>
              <CodeInput
                id="code-digits"
                className="mx-auto"
                value={code}
                onChange={setCode}
                onComplete={(v) => void checkCode(v)}
                disabled={busy}
                autoFocus
              />
              <p className="text-[12px] text-muted-foreground">
                {wait > 0 ? (
                  `You can ask for a new code in ${wait}s.`
                ) : (
                  <button
                    type="button"
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                    onClick={sendCode}
                    disabled={busy}
                  >
                    Send a new code
                  </button>
                )}
                {" · "}
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                  onClick={() => { setCodeSent(false); setCode(""); setError(""); }}
                  disabled={busy}
                >
                  Use a different email
                </button>
              </p>
            </div>
          )}

          {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}

          <Button
            onClick={() => (codeSent ? checkCode() : sendCode())}
            disabled={busy || (!codeSent && wait > 0)}
            className="w-full max-sm:min-h-11"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : codeSent ? (
              "Sign in"
            ) : wait > 0 ? (
              `Wait ${wait}s`
            ) : (
              "Email me a code"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
