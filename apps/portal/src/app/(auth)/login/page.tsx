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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, AlertCircle, Shield, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useRateLimiting } from "@/hooks/use-rate-limiting";
import { supabase } from "@/integrations/supabase/client";
import { ThemeToggle } from "@/components/shared/layout/theme-toggle";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { useTenant } from "@/contexts/TenantContext";
import { useTheme } from "next-themes";

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
  const [forgotStep, setForgotStep] = useState<"hidden" | "email-sent" | "otp" | "new-password">("hidden");
  const [resetEmail, setResetEmail] = useState("");
  const [otpValues, setOtpValues] = useState<string[]>(["", "", "", "", "", ""]);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

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

  // Get logo from tenant branding or use default
  const { resolvedTheme } = useTheme();
  const authLogoUrl = branding?.auth_logo_url;
  const logoUrl = (resolvedTheme === 'dark' && branding?.dark_logo_url ? branding.dark_logo_url : branding?.logo_url) || "/logo.png";
  const appName = branding?.app_name || "Drive247";

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

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (user && !loading) {
      router.replace(from);
    }
  }, [user, loading, router, from]);

  // Cooldown timer for resend
  useEffect(() => {
    if (resetCooldown <= 0) return;
    const timer = setTimeout(() => setResetCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resetCooldown]);

  // Auto-focus first OTP input
  useEffect(() => {
    if (forgotStep === "otp") {
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    }
  }, [forgotStep]);

  // Show loading screen while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-muted-foreground">Loading...</span>
        </div>
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

    try {
      const { error: signInError } = await signIn(
        data.email,
        data.password
      );

      if (signInError) {
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

        // Redirect
        router.replace(from);
      }
    } catch (error) {
      console.error("Login error:", error);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
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

    setIsSubmitting(true);
    try {
      await supabase.functions.invoke("send-verification-otp", {
        body: { email, tenant_id: tenant?.id, type: "password_reset" },
      });

      setResetEmail(email);
      setOtpValues(["", "", "", "", "", ""]);
      setResetCooldown(60);
      setForgotStep("otp");
      setError("");

      // Log password reset request
      try {
        await supabase.from("audit_logs").insert({
          action: "password_reset_requested",
          details: { email },
        });
      } catch (auditError) {
        console.error("Failed to log audit event:", auditError);
      }
    } catch (error) {
      console.error("Password reset error:", error);
      // Always show OTP screen for security (don't reveal if email exists)
      setResetEmail(email);
      setOtpValues(["", "", "", "", "", ""]);
      setResetCooldown(60);
      setForgotStep("otp");
      setError("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setOtpValues((prev) => {
      const next = [...prev];
      next[index] = digit;
      if (digit && index < 5) {
        setTimeout(() => otpRefs.current[index + 1]?.focus(), 0);
      }
      return next;
    });
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (!otpValues[index] && index > 0) {
        otpRefs.current[index - 1]?.focus();
        setOtpValues((prev) => {
          const next = [...prev];
          next[index - 1] = "";
          return next;
        });
        e.preventDefault();
      }
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 0) return;
    const newValues = [...otpValues];
    for (let i = 0; i < pasted.length && i < 6; i++) {
      newValues[i] = pasted[i];
    }
    setOtpValues(newValues);
    const nextEmptyIndex = newValues.findIndex((v) => v === "");
    const focusIndex = nextEmptyIndex === -1 ? 5 : nextEmptyIndex;
    setTimeout(() => otpRefs.current[focusIndex]?.focus(), 0);
  };

  const handleVerifyResetOTP = async () => {
    const code = otpValues.join("");
    if (code.length !== 6) {
      setError("Please enter the full 6-digit code");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const { data: result, error: fnError } = await supabase.functions.invoke("verify-otp", {
        body: { email: resetEmail, code, tenant_id: tenant?.id },
      });
      if (fnError || !result?.verified) {
        setError(result?.error || "Invalid or expired code");
        setOtpValues(["", "", "", "", "", ""]);
        setTimeout(() => otpRefs.current[0]?.focus(), 100);
        return;
      }
      setForgotStep("new-password");
      setError("");
    } catch (error) {
      setError("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendResetOTP = async () => {
    if (resetCooldown > 0) return;
    setIsSubmitting(true);
    try {
      await supabase.functions.invoke("send-verification-otp", {
        body: { email: resetEmail, tenant_id: tenant?.id, type: "password_reset" },
      });
      toast({ title: "Code Resent", description: "A new verification code has been sent." });
      setResetCooldown(60);
      setOtpValues(["", "", "", "", "", ""]);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (error) {
      setError("Failed to resend code");
    } finally {
      setIsSubmitting(false);
    }
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
      const { data: result, error: fnError } = await supabase.functions.invoke("reset-password-with-otp", {
        body: { email: resetEmail, new_password: newPassword },
      });
      if (fnError || result?.error) {
        setError(result?.error || "Failed to reset password");
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      {/* Theme Toggle - positioned in top right */}
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-md border-primary">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center py-4">
            <div className={`rounded-2xl p-8 border border-primary/40 transition-all duration-300 hover:border-primary/60 hover:shadow-[0_0_20px_rgba(198,162,86,0.15)] ${authLogoUrl ? 'bg-black' : 'bg-white dark:bg-[hsl(159,21%,15%)]/30'}`}>
              {authLogoUrl ? (
                <img
                  src={authLogoUrl}
                  alt={appName}
                  className="h-64 w-64 object-contain transition-transform duration-300 hover:scale-105"
                />
              ) : logoUrl && logoUrl !== "/logo.png" ? (
                <img
                  src={logoUrl}
                  alt={appName}
                  className="h-48 w-auto max-w-[260px] object-contain transition-transform duration-300 hover:scale-105 invert dark:invert-0"
                  style={{
                    imageRendering: "crisp-edges",
                  }}
                />
              ) : (
                <div className="h-32 w-32 flex items-center justify-center">
                  <span className="text-3xl font-bold text-primary text-center leading-tight">
                    {appName}
                  </span>
                </div>
              )}
            </div>
          </div>

          <CardTitle className="text-2xl font-bold">Sign In</CardTitle>
          <CardDescription>
            Enter your email and password to access the fleet management system
          </CardDescription>
        </CardHeader>
        <CardContent>
          {forgotStep === "otp" ? (
            <div className="space-y-4">
              <div className="text-center space-y-2">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                  <Shield className="h-7 w-7 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">Enter Reset Code</h3>
                <p className="text-sm text-muted-foreground">
                  We sent a 6-digit code to
                </p>
                <p className="text-sm font-medium">{resetEmail}</p>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
                {otpValues.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => { otpRefs.current[index] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                    className="w-11 h-12 text-center text-xl font-bold rounded-lg border-2 border-input bg-background focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    disabled={isSubmitting}
                  />
                ))}
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Code expires in 15 minutes
              </p>

              <Button
                onClick={handleVerifyResetOTP}
                disabled={isSubmitting || otpValues.join("").length !== 6}
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify Code"
                )}
              </Button>

              <div className="flex items-center justify-center gap-1 text-sm">
                <span className="text-muted-foreground">Didn't receive it?</span>
                <Button
                  variant="link"
                  size="sm"
                  onClick={handleResendResetOTP}
                  disabled={resetCooldown > 0 || isSubmitting}
                  className="p-0 h-auto"
                >
                  {resetCooldown > 0 ? `Resend in ${resetCooldown}s` : "Resend code"}
                </Button>
              </div>

              <Button
                variant="ghost"
                onClick={() => { setForgotStep("hidden"); setError(""); }}
                className="w-full text-sm"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Sign In
              </Button>
            </div>
          ) : forgotStep === "new-password" ? (
            <div className="space-y-4">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold">Set New Password</h3>
                <p className="text-sm text-muted-foreground">
                  Enter a new password for {resetEmail}
                </p>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">New Password</label>
                <PasswordInput
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Confirm New Password</label>
                <PasswordInput
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Confirm new password"
                  disabled={isSubmitting}
                />
              </div>

              {newPassword.length > 0 && (
                <div className="flex gap-3 text-xs">
                  <span className={newPassword.length >= 8 ? "text-green-600" : "text-muted-foreground"}>
                    {newPassword.length >= 8 ? "✓" : "○"} 8+ chars
                  </span>
                  <span className={/[A-Z]/.test(newPassword) ? "text-green-600" : "text-muted-foreground"}>
                    {/[A-Z]/.test(newPassword) ? "✓" : "○"} Uppercase
                  </span>
                  <span className={/\d/.test(newPassword) ? "text-green-600" : "text-muted-foreground"}>
                    {/\d/.test(newPassword) ? "✓" : "○"} Number
                  </span>
                </div>
              )}

              <Button
                onClick={handleSetNewPassword}
                disabled={isSubmitting || newPassword.length < 8 || newPassword !== confirmNewPassword}
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  "Reset Password"
                )}
              </Button>

              <Button
                variant="ghost"
                onClick={() => { setForgotStep("hidden"); setError(""); setNewPassword(""); setConfirmNewPassword(""); }}
                className="w-full text-sm"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Sign In
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {getRateLimitMessage() && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{getRateLimitMessage()}</AlertDescription>
                  </Alert>
                )}

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="Enter your email"
                          disabled={isSubmitting || isLocked}
                          autoComplete="email"
                          autoFocus
                          {...field}
                        />
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
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <PasswordInput
                          placeholder="Enter your password"
                          disabled={isSubmitting || isLocked}
                          autoComplete="current-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex items-center justify-between">
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
                        <FormLabel className="text-sm font-normal cursor-pointer">
                          Keep me signed in
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                  <Button
                    type="button"
                    variant="link"
                    className="px-0 text-sm"
                    onClick={handleForgotPassword}
                    disabled={isSubmitting}
                  >
                    Forgot password?
                  </Button>
                </div>

                {requiresPolicyAcceptance && (
                  <FormField
                    control={form.control}
                    name="acceptPolicies"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-2 space-y-0 rounded-md border p-4">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={isSubmitting || isLocked}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="text-sm font-normal cursor-pointer">
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
                  className="w-full"
                  disabled={isSubmitting || !form.formState.isValid || (requiresPolicyAcceptance && !form.watch("acceptPolicies"))}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>

                {rateLimitStatus.attemptsRemaining < 5 &&
                  rateLimitStatus.attemptsRemaining > 0 && (
                    <div className="text-center text-sm text-amber-600">
                      {rateLimitStatus.attemptsRemaining} attempt
                      {rateLimitStatus.attemptsRemaining > 1 ? "s" : ""} remaining
                    </div>
                  )}
              </form>
            </Form>
          )}

          <div className="mt-6 text-center text-sm text-muted-foreground">
            <p>Need help? Contact your system administrator.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-muted-foreground">Loading...</span>
        </div>
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}
