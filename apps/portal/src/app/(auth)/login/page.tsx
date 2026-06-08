"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tile } from "@/components/bento";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, AlertCircle, ArrowLeft, ArrowRight, Mail, Lock, ShieldCheck } from "lucide-react";
import { motion, useReducedMotion, animate } from "motion/react";
import { toast } from "@/hooks/use-toast";
import { useRateLimiting } from "@/hooks/use-rate-limiting";
import { supabase } from "@/integrations/supabase/client";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { authUp, springs } from "@/lib/motion";
import { AuthShell, AuthBackground } from "../_components/auth-shell";

/** Google "G" mark (inline so it keeps its brand colours on glass). */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="18" height="18" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.6 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.4 14.7 2.4 12 2.4 6.9 2.4 2.8 6.5 2.8 11.6S6.9 20.8 12 20.8c5.5 0 9.1-3.9 9.1-9.3 0-.6-.06-1.1-.15-1.6H12z" />
    </svg>
  );
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hviqoaokxvlancmftwuo.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().default(false),
  acceptPolicies: z.boolean().default(false),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, signIn, loading, appUser } = useAuth();
  const { branding } = useTenantBranding();
  const { tenant } = useTenant();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const reduce = useReducedMotion();
  // True only for a sign-in the user just performed here — lets us play the
  // success animation before redirecting (vs. an already-authed visit, which
  // redirects instantly).
  const signingInRef = useRef(false);
  // Destination captured at sign-in time (role/appUser can settle async).
  const redirectTo = useRef("/");
  const [forgotStep, setForgotStep] = useState<"hidden" | "new-password">("hidden");
  const [resetEmail, setResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
      acceptPolicies: false,
    },
  });

  const {
    rateLimitStatus,
    checkRateLimit,
    recordLoginAttempt,
    getRateLimitMessage,
    isLocked,
  } = useRateLimiting();

  // Show policy checkbox if tenant has policy versions configured AND hasn't accepted yet
  const requiresPolicyAcceptance = !!(tenant?.privacy_policy_version || tenant?.terms_version) && !tenant?.policies_accepted_at;

  // Brand name for on-screen copy (logo + theme chrome handled by AuthShell)
  const appName = branding?.app_name || "Drive247";

  // Frosted field styling matching the concept — tall, rounded, glass, violet focus ring.
  const fieldClass =
    "h-14 rounded-[16px] px-4 text-[15px] bg-[var(--glass-input-bg)] backdrop-blur-md border-[color:var(--glass-border)] placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:border-primary/60";

  // Role-based redirect logic
  const getRedirectPath = (): string => {
    if (appUser?.role === "head_admin" || appUser?.role === "admin" || appUser?.role === "manager") {
      return "/";
    }
    if (appUser?.role === "ops") {
      return "/vehicles";
    }
    if (appUser?.role === "viewer") {
      return "/reports";
    }
    return "/"; // Default fallback
  };

  const from = searchParams.get("from") || getRedirectPath();

  // If already authenticated (e.g. revisiting /login), redirect immediately.
  // Skip while an interactive sign-in is in flight — that path shows the success
  // animation first, then redirects.
  useEffect(() => {
    if (user && !loading && !signingInRef.current) {
      router.replace(from);
    }
  }, [user, loading, router, from]);

  // After a successful interactive sign-in: hold on the success animation briefly,
  // then redirect to the destination captured at sign-in time. A hard fallback
  // guarantees we leave this screen even if SPA navigation no-ops.
  useEffect(() => {
    if (!signedIn) return;
    const target = redirectTo.current || "/";
    const t = setTimeout(() => router.replace(target), reduce ? 350 : 1500);
    const hard = setTimeout(() => {
      if (typeof window !== "undefined" && window.location.pathname.includes("/login")) {
        window.location.assign(target);
      }
    }, reduce ? 1200 : 2800);
    return () => {
      clearTimeout(t);
      clearTimeout(hard);
    };
  }, [signedIn, router, reduce]);

  // Drive the game-style loading bar from 0→100% over the redirect hold.
  useEffect(() => {
    if (!signedIn) return;
    const controls = animate(0, 100, {
      duration: reduce ? 0.3 : 1.45,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setLoadPct(Math.round(v)),
    });
    return () => controls.stop();
  }, [signedIn, reduce]);

  // Show loading screen while checking auth
  if (loading) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
        <AuthBackground />
        <Tile variant="glass" pad="roomy" className="relative z-10 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm font-medium text-muted-foreground">Loading…</span>
        </Tile>
      </div>
    );
  }

  const onSubmit = async (data: LoginFormValues) => {
    console.log("Sign in button clicked");
    setError("");

    // Check rate limiting
    const rateLimitCheck = await checkRateLimit(data.email);
    if (!rateLimitCheck.allowed) {
      setError(
        getRateLimitMessage() ||
        "Too many failed attempts. Please try again later."
      );
      return;
    }

    setIsSubmitting(true);
    signingInRef.current = true;

    try {
      const { error: signInError } = await signIn(
        data.email,
        data.password
      );

      if (signInError) {
        signingInRef.current = false;
        // Record failed attempt
        await recordLoginAttempt(data.email, false);

        // Log audit event
        try {
          await supabase.from("audit_logs").insert({
            action: "login_failed",
            details: {
              email: data.email,
              error_type: signInError.message.includes(
                "Invalid login credentials"
              )
                ? "invalid_credentials"
                : "other",
              user_agent: navigator.userAgent,
            },
          });
        } catch (auditError) {
          console.error("Failed to log audit event:", auditError);
        }

        // Security-safe error messages
        if (signInError.message.includes("Invalid login credentials")) {
          setError(
            "Invalid credentials. Please check your email and password and try again."
          );
        } else if (signInError.message.includes("Email not confirmed")) {
          setError("Please confirm your email address before signing in.");
        } else if (signInError.message.includes("Too many requests")) {
          setError("Too many login attempts. Please wait before trying again.");
        } else if (
          signInError.message.includes("deactivated") ||
          signInError.message.includes("inactive")
        ) {
          setError(
            "Your account has been deactivated. Please contact your system administrator."
          );
        } else {
          setError(
            "Unable to sign in. Please check your credentials and try again."
          );
        }

        const updatedRateLimit = await recordLoginAttempt(
          data.email,
          false
        );
        if (
          updatedRateLimit.attemptsRemaining <= 2 &&
          updatedRateLimit.attemptsRemaining > 0
        ) {
          toast({
            title: "Security Notice",
            description: `${updatedRateLimit.attemptsRemaining} attempt${updatedRateLimit.attemptsRemaining > 1 ? "s" : ""} remaining before temporary lockout.`,
            variant: "destructive",
          });
        }
      } else {
        // Record successful attempt
        await recordLoginAttempt(data.email, true);

        // Record policy acceptance via edge function (captures IP server-side)
        if (requiresPolicyAcceptance && data.acceptPolicies && tenant?.id) {
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/check-policy-acceptance`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
              body: JSON.stringify({
                action: "record",
                email: data.email.trim(),
                tenant_id: tenant.id,
                user_agent: navigator.userAgent,
              }),
            });
          } catch (e) {
            console.error("Policy acceptance recording failed:", e);
          }
        }

        // Log successful login
        try {
          await supabase.from("audit_logs").insert({
            action: "login_success",
            details: {
              email: data.email,
              remember_me: data.rememberMe,
              user_agent: navigator.userAgent,
            },
          });
        } catch (auditError) {
          console.error("Failed to log audit event:", auditError);
        }

        // Capture the destination now, play the success animation; the effect
        // below redirects shortly after.
        redirectTo.current = from || "/";
        setSignedIn(true);
      }
    } catch (error) {
      signingInRef.current = false;
      console.error("Login error:", error);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = () => {
    const email = form.getValues("email");
    if (!email) {
      setError("Please enter your email address first.");
      return;
    }

    const emailValidation = loginSchema.shape.email.safeParse(email);
    if (!emailValidation.success) {
      setError("Please enter a valid email address.");
      return;
    }

    setResetEmail(email);
    setNewPassword("");
    setConfirmNewPassword("");
    setForgotStep("new-password");
    setError("");
  };

  const handleSetNewPassword = async () => {
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("Passwords do not match");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const { data: result, error: fnError } = await supabase.functions.invoke("emergency-password-reset", {
        body: { email: resetEmail, tempPassword: newPassword },
      });
      if (fnError || !result?.success) {
        setError(result?.error || fnError?.message || "Failed to reset password");
        return;
      }
      toast({ title: "Password Reset", description: "Your password has been updated. Please sign in." });
      setForgotStep("hidden");
      setNewPassword("");
      setConfirmNewPassword("");
      form.setValue("email", resetEmail);
    } catch (error) {
      setError("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Google OAuth — real Supabase method; surfaces an error if the provider
  // isn't enabled in the project (no fake success).
  const handleGoogle = async () => {
    setError("");
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}${from}` },
      });
      if (oauthError) setError(oauthError.message || "Google sign-in is not available.");
    } catch (e) {
      setError("Google sign-in is not available right now.");
    }
  };

  // Company SSO — resolves the SAML/SSO provider from the work-email domain.
  const handleCompanySSO = async () => {
    setError("");
    const email = form.getValues("email")?.trim();
    const domain = email?.includes("@") ? email.split("@")[1] : "";
    if (!domain) {
      setError("Enter your work email first to continue with Company SSO.");
      return;
    }
    try {
      const { data, error: ssoError } = await supabase.auth.signInWithSSO({ domain });
      if (ssoError) {
        setError(ssoError.message || "SSO isn't configured for this domain.");
        return;
      }
      if (data?.url) window.location.href = data.url;
    } catch (e) {
      setError("SSO isn't configured for this domain.");
    }
  };

  return (
    <AuthShell width="max-w-[420px]">
      <motion.div key={signedIn ? "success" : forgotStep} variants={authUp} initial="hidden" animate="show">
        {signedIn ? (
          <div className="flex flex-col items-center py-8 text-center">
            <motion.div
              className="grid h-20 w-20 place-items-center rounded-full"
              style={{ background: "color-mix(in srgb, var(--bento-success) 16%, transparent)" }}
              initial={reduce ? { opacity: 0 } : { scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={reduce ? { duration: 0.15 } : springs.pop}
            >
              <svg viewBox="0 0 52 52" className="h-11 w-11" fill="none" aria-hidden>
                <circle cx="26" cy="26" r="23" stroke="var(--bento-success)" strokeWidth="2.5" strokeOpacity="0.25" />
                <motion.path
                  d="M15 27l7.5 7.5L37 19"
                  stroke="var(--bento-success)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: reduce ? 1 : 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: reduce ? 0 : 0.5, ease: "easeOut", delay: reduce ? 0 : 0.18 }}
                />
              </svg>
            </motion.div>
            <h1 className="mt-6 text-[30px] font-extrabold leading-none tracking-tight">You&apos;re in</h1>
            <p className="mt-3 text-[15px] text-muted-foreground">
              Taking you to your {appName} dashboard…
            </p>

            {/* Game/tech-style loading bar */}
            <div className="mt-8 w-full max-w-[340px]">
              <div className="relative h-4 w-full overflow-hidden rounded-full border border-[color:var(--glass-border)] bg-[var(--glass-input-bg)]">
                {/* glowing fill */}
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${loadPct}%`,
                    background:
                      "linear-gradient(90deg, color-mix(in srgb, var(--bento-info) 85%, transparent), hsl(var(--primary)))",
                    boxShadow: "0 0 14px hsl(var(--primary) / 0.75)",
                  }}
                />
                {/* leading edge spark */}
                <div
                  className="absolute inset-y-0 w-[3px] rounded-full bg-white/80"
                  style={{ left: `calc(${loadPct}% - 2px)`, opacity: loadPct > 0 && loadPct < 100 ? 1 : 0, boxShadow: "0 0 10px rgba(255,255,255,0.9)" }}
                />
                {/* sweeping scanline */}
                {!reduce && (
                  <motion.div
                    aria-hidden
                    className="absolute inset-y-0 w-1/3"
                    style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)" }}
                    initial={{ x: "-120%" }}
                    animate={{ x: "360%" }}
                    transition={{ duration: 1, ease: "linear", repeat: Infinity }}
                  />
                )}
              </div>
            </div>
          </div>
        ) : forgotStep === "new-password" ? (
            <div className="space-y-5">
              <button
                type="button"
                onClick={() => { setForgotStep("hidden"); setError(""); setNewPassword(""); setConfirmNewPassword(""); }}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>

              <div>
                <h1 className="text-[34px] font-extrabold leading-none tracking-tight">Set new password</h1>
                <p className="mt-3 text-[15px] text-muted-foreground">Enter a new password for {resetEmail}.</p>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <label className="text-[13px] font-bold text-foreground">New password</label>
                <PasswordInput
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={isSubmitting}
                  className={fieldClass}
                />
              </div>

              <div className="space-y-2">
                <label className="text-[13px] font-bold text-foreground">Confirm new password</label>
                <PasswordInput
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={isSubmitting}
                  className={fieldClass}
                />
              </div>

              {newPassword.length > 0 && (
                <div className="flex gap-3 text-xs font-medium">
                  <span className={newPassword.length >= 8 ? "text-[color:var(--bento-success)]" : "text-muted-foreground"}>
                    {newPassword.length >= 8 ? "✓" : "○"} 8+ chars
                  </span>
                  <span className={/[A-Z]/.test(newPassword) ? "text-[color:var(--bento-success)]" : "text-muted-foreground"}>
                    {/[A-Z]/.test(newPassword) ? "✓" : "○"} Uppercase
                  </span>
                  <span className={/\d/.test(newPassword) ? "text-[color:var(--bento-success)]" : "text-muted-foreground"}>
                    {/\d/.test(newPassword) ? "✓" : "○"} Number
                  </span>
                </div>
              )}

              <Button
                onClick={handleSetNewPassword}
                disabled={isSubmitting || newPassword.length < 8 || newPassword !== confirmNewPassword}
                className="h-14 w-full gap-2 rounded-[16px] text-[15px] font-bold shadow-[0_12px_28px_hsl(var(--primary)/0.4)]"
              >
                {isSubmitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Resetting…</>
                ) : (
                  "Reset password"
                )}
              </Button>
            </div>
          ) : (
            <>
              <h1 className="text-[34px] font-extrabold leading-none tracking-tight">Sign in</h1>
              <p className="mt-3 text-[15px] text-muted-foreground">
                Access your {appName} fleet dashboard.
              </p>

              {error && (
                <Alert variant="destructive" className="mt-5">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {getRateLimitMessage() && (
                <Alert variant="destructive" className="mt-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{getRateLimitMessage()}</AlertDescription>
                </Alert>
              )}

              {/* Google + Company SSO */}
              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={isSubmitting || isLocked}
                  className="glass-input flex h-12 items-center justify-center gap-2.5 rounded-[14px] border border-[color:var(--glass-border)] text-[15px] font-bold text-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
                >
                  <GoogleIcon /> Google
                </button>
                <button
                  type="button"
                  onClick={handleCompanySSO}
                  disabled={isSubmitting || isLocked}
                  className="glass-input flex h-12 items-center justify-center gap-2.5 rounded-[14px] border border-[color:var(--glass-border)] text-[15px] font-bold text-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
                >
                  <ShieldCheck className="h-[18px] w-[18px] text-primary" /> Company SSO
                </button>
              </div>

              {/* divider */}
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or with email</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[13px] font-bold text-foreground">Email address</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Mail className="pointer-events-none absolute left-4 top-1/2 z-10 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/50" />
                            <Input
                              type="email"
                              placeholder="you@company.com"
                              disabled={isSubmitting || isLocked}
                              autoComplete="email"
                              autoFocus
                              className={cn(fieldClass, "pl-12")}
                              {...field}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel className="text-[13px] font-bold text-foreground">Password</FormLabel>
                          <button
                            type="button"
                            onClick={handleForgotPassword}
                            disabled={isSubmitting}
                            className="text-[13px] font-bold text-primary hover:underline disabled:opacity-60"
                          >
                            Forgot password?
                          </button>
                        </div>
                        <FormControl>
                          <div className="relative">
                            <Lock className="pointer-events-none absolute left-4 top-1/2 z-10 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/50" />
                            <PasswordInput
                              placeholder="••••••••"
                              disabled={isSubmitting || isLocked}
                              autoComplete="current-password"
                              className={cn(fieldClass, "pl-12")}
                              {...field}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="rememberMe"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={isSubmitting || isLocked}
                          />
                        </FormControl>
                        <FormLabel className="cursor-pointer text-[14px] font-medium text-foreground">
                          Keep me signed in
                        </FormLabel>
                      </FormItem>
                    )}
                  />

                  {requiresPolicyAcceptance && (
                    <FormField
                      control={form.control}
                      name="acceptPolicies"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-2 space-y-0 rounded-tile border border-border p-4 [background:var(--bento-tile-2)]">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              disabled={isSubmitting || isLocked}
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="cursor-pointer text-sm font-normal">
                              I accept the{" "}
                              <a href="/privacy-policy" target="_blank" className="text-primary underline hover:text-primary/80">
                                Privacy Policy
                              </a>{" "}
                              and{" "}
                              <a href="/terms" target="_blank" className="text-primary underline hover:text-primary/80">
                                Terms &amp; Conditions
                              </a>
                            </FormLabel>
                          </div>
                        </FormItem>
                      )}
                    />
                  )}

                  <Button
                    type="submit"
                    className="h-14 w-full gap-2 rounded-[16px] text-[15px] font-bold shadow-[0_12px_28px_hsl(var(--primary)/0.4)]"
                    disabled={isSubmitting || !form.formState.isValid || (requiresPolicyAcceptance && !form.watch("acceptPolicies"))}
                  >
                    {isSubmitting ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</>
                    ) : (
                      <><ArrowRight className="h-[18px] w-[18px]" /> Sign in</>
                    )}
                  </Button>

                  {rateLimitStatus.attemptsRemaining < 5 &&
                    rateLimitStatus.attemptsRemaining > 0 && (
                      <div className="text-center text-sm font-medium text-[color:var(--bento-warn-accent)]">
                        {rateLimitStatus.attemptsRemaining} attempt
                        {rateLimitStatus.attemptsRemaining > 1 ? "s" : ""} remaining
                      </div>
                    )}
                </form>
              </Form>

              <p className="mt-6 text-center text-xs text-muted-foreground">
                By continuing you agree to our{" "}
                <a href="/terms" target="_blank" className="font-bold text-primary hover:underline">Terms</a>{" "}&amp;{" "}
                <a href="/privacy-policy" target="_blank" className="font-bold text-primary hover:underline">Privacy Policy</a>.
              </p>
              <p className="mt-4 text-center text-xs text-muted-foreground">
                © {new Date().getFullYear()} {appName} · Support · Status
              </p>
            </>
          )}
      </motion.div>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
        <AuthBackground />
        <Tile variant="glass" pad="roomy" className="relative z-10 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm font-medium text-muted-foreground">Loading…</span>
        </Tile>
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}
