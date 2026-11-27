"use client";

/**
 * feat-001 specs 03 and 04: the portal window for an account made by the
 * 3-step signup. The person landed here straight after the card, signed in by
 * a one-time link, with no proved email and no password.
 *
 *   1. "Check your email": the 6-digit code signup-begin emailed. Wrong code →
 *      tries left; "Send a new code" (60 s apart); "Wrong email?" corrects the
 *      address and sends the code there.
 *   2. "Choose a password": the signup rule (8+, a letter, a number), drawn by
 *      the portal's own PasswordChangePanelV2 in its password-only mode.
 *
 * When it shows (spec 04): on every visit while a flag is set, after the
 * first-run questions; it can be closed ("Not now") until 72 hours after the
 * account was made, and after that it stays until both parts are done.
 *
 * The server does every check (signup-verify-email, signup-set-password); this
 * only draws the answers. The rules for when it shows are lib/signup-verify.ts.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Mail } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { callAccountFn, type AccountAnswer } from "@/lib/account-functions";
import { useAuth } from "@/stores/auth-store";
import { useFirstRunWizard } from "@/hooks/use-first-run-wizard";
import { Button } from "@/components/ui-v2/button";
import { CodeInput } from "@/components/ui-v2/code-input";
import { Input } from "@/components/ui-v2/input";
import { Label } from "@/components/ui-v2/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { PasswordChangePanelV2 } from "@/components/shared/layout/password-change-panel-v2";
import {
  isEmailPending,
  isSignupVerifyOverdue,
  needsSignupVerify,
  SIGNUP_PASSWORD_RULES,
  timeLeftText,
} from "@/lib/signup-verify";

/**
 * Is any part of a tour on screen? The window comes AFTER the tour (Ghulam's
 * guide), and the tours are not ours to change, so this reads the marks the
 * first-rental tour already puts on its cards, prompt and transit, and waits
 * while any is present. (The 7-card quick tour being built elsewhere should add
 * its mark here when the branches meet.)
 */
const TOUR_SELECTOR = "[data-first-rental-tour],[data-tour-prompt],[data-tour-transit]";

function useTourOnScreen(): boolean {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const check = () => setOnScreen(!!document.querySelector(TOUR_SELECTOR));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return onScreen;
}

type Answer = AccountAnswer;
const callSignupFn = (name: "signup-verify-email" | "signup-set-password", body: Record<string, unknown>) => callAccountFn(name, body);

export function VerifyAccountDialogV2({ suppressed = false }: { suppressed?: boolean }) {
  const { user } = useAuth();
  const { shouldShow: firstRunShowing, isLoading: firstRunLoading } = useFirstRunWizard();
  const tourOnScreen = useTourOnScreen();

  const pending = needsSignupVerify(user);
  const overdue = !!user?.created_at && isSignupVerifyOverdue(user.created_at);
  const left = user?.created_at ? timeLeftText(user.created_at) : null;

  const [dismissed, setDismissed] = useState(false);
  const [stage, setStage] = useState<"code" | "email" | "password">("code");
  const [email, setEmail] = useState<string>(user?.email ?? "");
  const [code, setCode] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Where the window starts: the code, unless the email is already proved.
  useEffect(() => {
    if (user?.email) setEmail(user.email);
    if (user && !isEmailPending(user)) setStage("password");
  }, [user]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Every visit: a page load or a new sign-in opens it again (spec 04.3).
  // After the first-run questions and any tour (spec 04.1). Once overdue it no
  // longer waits for a tour either: the portal waits for it (04.5).
  const open = pending && !suppressed && !firstRunShowing && !firstRunLoading && (!tourOnScreen || overdue) && (!dismissed || overdue);

  /** The token's copy of app_metadata is stale after a change: fetch a fresh one. */
  const refresh = useCallback(async () => {
    await supabase.auth.refreshSession().catch(() => undefined);
  }, []);

  const verify = useCallback(
    async (value: string) => {
      if (value.trim().length !== 6 || busy) return;
      setBusy(true);
      setMessage(null);
      const r = await callSignupFn("signup-verify-email", { action: "verify", code: value.trim() });
      setBusy(false);
      if (r.ok) {
        setCode("");
        setStage("password");
        await refresh();
        return;
      }
      setCode("");
      setMessage({ tone: "error", text: r.error ?? "That code is not right." });
    },
    [busy, refresh],
  );

  const resend = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const r = await callSignupFn("signup-verify-email", { action: "resend" });
    setBusy(false);
    if (r.ok) {
      setCooldown(60);
      setMessage({ tone: "info", text: `A new code is on its way to ${email}.` });
    } else {
      if (r.retryAfterSeconds) setCooldown(r.retryAfterSeconds);
      setMessage({ tone: "error", text: r.error ?? "We could not send a code." });
    }
  }, [email]);

  const changeEmail = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const r = await callSignupFn("signup-verify-email", { action: "change_email", newEmail });
    setBusy(false);
    if (r.ok && r.email) {
      setEmail(r.email);
      setNewEmail("");
      setStage("code");
      setCooldown(r.delivered === false ? 0 : 60);
      setMessage(
        r.delivered === false
          ? { tone: "error", text: `Your email is now ${r.email}, but the code didn't send. Tap "Send a new code".` }
          : { tone: "info", text: `Done. The code is on its way to ${r.email}.` },
      );
      await refresh();
      return;
    }
    if (r.retryAfterSeconds) setCooldown(r.retryAfterSeconds);
    setMessage({ tone: "error", text: r.error ?? "We could not change your email." });
  }, [newEmail, refresh]);

  const savePassword = useCallback(
    async (password: string) => {
      const r = await callSignupFn("signup-set-password", { password });
      if (!r.ok) return r.error ?? "We could not save your password.";
      // Supabase ends the account's sessions when its password changes (found
      // testing step 5: the person was sent to /login). Sign straight back in
      // with the password they just chose, so they stay where they are; this
      // is also when the phone offers to save it.
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) await refresh();
      setDismissed(true);
      return null;
    },
    [email, refresh],
  );

  const deadlineLine = useMemo(() => {
    if (overdue) return "Please finish this to keep using your portal.";
    return left ? `${left} to finish this.` : null;
  }, [left, overdue]);

  if (!pending) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !overdue) setDismissed(true);
      }}
    >
      <DialogContent
        showCloseButton={!overdue}
        // minmax(0,1fr): the content may shrink to the window, so nothing in it
        // (code boxes, a long email) can push past the edge on a 360px phone.
        className="grid-cols-[minmax(0,1fr)] sm:max-w-lg max-sm:px-5"
        onEscapeKeyDown={(e) => overdue && e.preventDefault()}
        onPointerDownOutside={(e) => overdue && e.preventDefault()}
        onInteractOutside={(e) => overdue && e.preventDefault()}
        data-testid="verify-account-dialog"
      >
        {stage === "password" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Choose a password</DialogTitle>
              <DialogDescription>
                So you can sign in from any device. {deadlineLine}
              </DialogDescription>
            </DialogHeader>
            <PasswordChangePanelV2
              email={email}
              passwordOnly
              required={overdue}
              rules={SIGNUP_PASSWORD_RULES}
              onSendCode={async () => null}
              onSave={(password) => savePassword(password)}
              onCancel={() => !overdue && setDismissed(true)}
            />
          </>
        ) : stage === "email" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Fix your email</DialogTitle>
              <DialogDescription>
                We&apos;ll change your account to this address and send the code there.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void changeEmail();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="verify-new-email">Your email</Label>
                <Input
                  id="verify-new-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="you@yourcompany.com"
                  autoFocus
                />
              </div>
              {message && (
                <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-[13px] text-destructive" : "text-[13px] text-muted-foreground"}>
                  {message.text}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStage("code");
                    setMessage(null);
                  }}
                  disabled={busy}
                  className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft aria-hidden className="size-3.5" />
                  Back
                </button>
                <Button type="submit" className="min-h-11" disabled={busy || !newEmail.trim() || cooldown > 0}>
                  {busy && <Loader2 className="animate-spin" aria-hidden />}
                  {cooldown > 0 ? `Wait ${cooldown}s` : busy ? "Saving…" : "Send the code here"}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Check your email</DialogTitle>
              <DialogDescription>
                <Mail aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
                We sent a 6-digit code to <span className="font-medium text-foreground [overflow-wrap:anywhere]">{email}</span>. {deadlineLine}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <CodeInput id="verify-code" value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} autoFocus />
              {message && (
                <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-[13px] text-destructive" : "text-[13px] text-muted-foreground"}>
                  {message.text}
                </p>
              )}
              <Button className="min-h-11 w-full" onClick={() => void verify(code)} disabled={busy || code.trim().length !== 6}>
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                {busy ? "Checking…" : "Verify"}
              </Button>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <button
                  type="button"
                  onClick={() => void resend()}
                  disabled={busy || cooldown > 0}
                  className="min-h-11 font-medium text-foreground underline-offset-2 hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline"
                >
                  {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStage("email");
                    setMessage(null);
                  }}
                  disabled={busy}
                  className="min-h-11 font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Wrong email?
                </button>
              </div>
              {!overdue && (
                <div className="border-t border-border pt-3 text-right">
                  <Button variant="ghost" className="min-h-11" onClick={() => setDismissed(true)} disabled={busy}>
                    Not now
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
