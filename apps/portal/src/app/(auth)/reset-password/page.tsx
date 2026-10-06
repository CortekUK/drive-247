"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { AuthBrandShell } from "@/components/auth-v2/auth-brand-shell";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

/**
 * Reset Password
 *
 * Landing page for the recovery link sent by supabase.auth.resetPasswordForEmail.
 * Arriving with a valid recovery session is the proof that the visitor controls
 * the mailbox — that is what authorises the change, so the new password is set
 * with supabase.auth.updateUser on the recovery session itself.
 *
 * This page used to redirect away without letting anyone set anything, because
 * "Forgot password?" instead POSTed a chosen password to an edge function that
 * checked nothing at all. That was an account-takeover path; it is gone.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Supabase needs a moment to exchange the token in the URL for a session.
    const timer = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setHasSession(!!session);
      setChecking(false);
      if (!session) router.replace("/login");
    }, 600);
    return () => clearTimeout(timer);
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      toast({
        title: "Password updated",
        description: "You can now sign in with your new password.",
      });
      await supabase.auth.signOut({ scope: "local" });
      router.replace("/login");
    } catch (err: any) {
      setError(err?.message || "Could not update your password. Please request a new link.");
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    // Inside the shell too: the brand surface is the first thing painted on the
    // login, and a white flash between the two screens reads as a redirect to
    // somewhere else.
    return (
      <AuthBrandShell>
        <div className="space-y-4 text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground">Processing…</p>
        </div>
      </AuthBrandShell>
    );
  }

  if (!hasSession) return null;

  return (
    <AuthBrandShell>
      {/* Deliberately the same card the login's form sits in — rounded-3xl, the
          card ground, generous padding. This is the screen where somebody is
          asked to type a new password, and a page that does not look like the
          one that sent them here is indistinguishable from a phishing page. */}
      <form
        onSubmit={handleSubmit}
        className="w-full space-y-5 rounded-3xl border border-border/60 bg-card/80 p-7 shadow-xl shadow-black/5 backdrop-blur-sm"
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
          <p className="text-sm text-muted-foreground">
            Choose a new password for your account.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="new-password">New password</Label>
          {/* PasswordInput, not Input: the login offers a reveal toggle, and a
              password being TYPED FOR THE FIRST TIME is the one most worth
              being able to check before submitting. */}
          <PasswordInput
            id="new-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <PasswordInput
            id="confirm-password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={submitting}
          />
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" className="h-12 w-full rounded-2xl text-base" disabled={submitting}>
          {submitting ? "Updating…" : "Update password"}
        </Button>
      </form>
    </AuthBrandShell>
  );
}
