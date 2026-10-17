"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { CodeInput } from "@/components/ui-v2/code-input";
import { Label } from "@/components/ui-v2/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { toast } from "@/hooks/use-toast";

/**
 * Forgot password on the v2 login — a six-digit code, not a link.
 *
 * Two screens in one dialog:
 *   1. the address → `resetPasswordForEmail` with `?otp=1` on the redirect,
 *      which tells `custom-auth-email` to send a code instead of a button;
 *   2. the code + the new password → `verifyOtp({ type: "recovery" })`, which
 *      is Supabase checking the code itself, then `updateUser({ password })`.
 *
 * Checking the code signs the person in, so the login page's own redirect takes
 * them into the portal once the password is set. The new password is typed
 * BEFORE the code is checked, so that redirect can never land someone inside
 * with the reset half done.
 *
 * Step one always reports success: saying whether an address exists would let
 * anyone list a tenant's staff.
 *
 * v1's login is untouched and still sends the link to /reset-password.
 */
export function ForgotPasswordDialogV2({
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
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setEmail(initialEmail);
    setCodeSent(false);
    setCode("");
    setPassword("");
    setConfirm("");
    setError("");
  }, [open, initialEmail]);

  const sendCode = async () => {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter the email address you sign in with.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: `${window.location.origin}/reset-password?otp=1`,
      });
    } catch {
      /* Same answer either way — see the header. */
    } finally {
      setBusy(false);
      setCodeSent(true);
      toast({
        title: "Check your email",
        description: "If that address belongs to an account, I've sent it a six-digit code.",
      });
    }
  };

  const problem = (): string | null => {
    if (code.trim().length < 6) return "Enter the six-digit code from your email.";
    if (password !== confirm) return "Passwords do not match.";
    if (password.length < 12) return "Password must be at least 12 characters long.";
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      return "Password must contain uppercase, lowercase, and numeric characters.";
    }
    return null;
  };

  const resetPassword = async () => {
    const issue = problem();
    if (issue) {
      setError(issue);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { error: codeError } = await supabase.auth.verifyOtp({
        type: "recovery",
        email: email.trim(),
        token: code.trim(),
      });
      if (codeError) throw new Error("That code didn't work. Check it, or send a new one.");

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      toast({ title: "Password updated", description: "You're signed in with your new password." });
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset your password</DialogTitle>
          <DialogDescription>
            {codeSent
              ? `Enter the code I sent to ${email.trim()} and choose a new password.`
              : "I'll email you a six-digit code to confirm it's you."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {!codeSent ? (
            <div className="space-y-1.5">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
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
            <>
              <div className="space-y-1.5">
                <Label htmlFor="reset-code">Six-digit code</Label>
                <CodeInput id="reset-code" value={code} onChange={setCode} disabled={busy} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-password">New password</Label>
                <PasswordInput
                  id="reset-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 12 characters"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-confirm">Confirm password</Label>
                <PasswordInput
                  id="reset-confirm"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Type it again"
                />
              </div>
              <p className="text-[12px] text-muted-foreground">
                At least 12 characters, with an uppercase letter, a lowercase letter and a
                number.{" "}
                <button
                  type="button"
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                  onClick={sendCode}
                  disabled={busy}
                >
                  Send a new code
                </button>
              </p>
            </>
          )}

          {error && <p className="text-[13px] text-destructive">{error}</p>}

          <Button onClick={codeSent ? resetPassword : sendCode} disabled={busy} className="w-full">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : codeSent ? (
              "Reset password"
            ) : (
              "Send code"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
