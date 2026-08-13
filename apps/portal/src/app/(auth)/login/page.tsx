"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, AlertCircle, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useRateLimiting } from "@/hooks/use-rate-limiting";
import { supabase } from "@/integrations/supabase/client";
import { ThemeToggle } from "@/components/shared/layout/theme-toggle";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { useTenant } from "@/contexts/TenantContext";
import { useTheme } from "next-themes";

import { PLATFORM_PRIVACY_URL, PLATFORM_TERMS_URL } from "@/lib/legal/urls";
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
  const [resetEmail, setResetEmail] = useState("");

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: "onChange",
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

  // Hero panel visuals — prefer a configured hero image, else a brand-colour gradient.
  //
  // The gradient is expressed in `--primary`/`--accent` rather than hex values read
  // off `branding`. DynamicThemeProvider wraps this route group and sets both vars
  // from the tenant's colours, so the panel tracks the brand automatically — and a
  // tenant with no colours configured falls back to the theme defaults instead of a
  // hardcoded pair that belonged to no one.
  const heroImage = branding?.hero_background_url || null;
  // Logo that reads well on the dark hero panel
  const heroLogo = authLogoUrl || branding?.dark_logo_url || (logoUrl !== "/logo.png" ? logoUrl : null);
  const heroFeatures = [
    "Real-time fleet & availability tracking",
    "Automated bookings, payments & deposits",
    "Insurance and e-signatures built in",
  ];

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

  // If already authenticated, redirect to dashboard.
  //
  // `appUser` is required here, not just `user`. The dashboard refuses to render
  // without a profile, so redirecting on a session alone sent the user straight
  // back here — an endless login<->dashboard bounce whenever the profile lookup
  // had failed. Waiting for the profile means the loop cannot form.
  // `appUser.is_active` is part of the guard: the dashboard bounces deactivated
  // users back here, so redirecting them in without checking it produced its own
  // endless loop.
  useEffect(() => {
    if (user && appUser && appUser.is_active && !loading) {
      router.replace(from);
    }
  }, [user, appUser, loading, router, from]);

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
        // The credentials were CORRECT — we just couldn't load the profile.
        // Don't record a failed attempt, don't write a login_failed audit row,
        // and don't blame the password.
        // (the enclosing finally clears isSubmitting)
        if ((signInError as { code?: string }).code === "profile_unavailable") {
          setError(signInError.message);
          return;
        }

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

    // Send an email-verified recovery link instead of letting the visitor type a
    // new password on the spot.
    //
    // This used to jump straight to a "choose a new password" step and POST it to
    // emergency-password-reset, which performed no authorization at all — so
    // anyone who knew a staff member's email address could set their password and
    // take the account. Proving control of the mailbox is the whole point of a
    // password reset.
    //
    // The v2 redesign this page's layout came from still carries that old step.
    // It was deliberately NOT ported back: only the markup was taken from v2, the
    // auth flow below is main's.
    setResetEmail(email);
    setError("");
    setIsSubmitting(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) throw resetError;
      // Always report success: revealing whether an address exists lets anyone
      // enumerate staff accounts.
      toast({
        title: "Check your email",
        description:
          "If that address belongs to an account, we've sent a link to reset your password.",
      });
    } catch {
      toast({
        title: "Check your email",
        description:
          "If that address belongs to an account, we've sent a link to reset your password.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // handleSetNewPassword was removed with the "type a new password here" step.
  // Setting a password now happens on /reset-password, which is only reachable
  // with a valid recovery session from the emailed link.

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* ---------- Left: branded hero panel (hidden on small screens) ---------- */}
      <div
        className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 text-white"
        style={
          heroImage
            ? { backgroundImage: `url(${heroImage})`, backgroundSize: "cover", backgroundPosition: "center" }
            : { backgroundImage: "linear-gradient(150deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)" }
        }
      >
        {/* readability overlay (mainly for image backgrounds) + soft glow */}
        <div className="absolute inset-0 bg-black/40" />
        <div
          className="absolute -top-24 -left-24 h-96 w-96 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.35), transparent 70%)" }}
        />
        <div
          className="absolute -bottom-32 -right-16 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.3), transparent 70%)" }}
        />

        {/* Logo */}
        <div className="relative z-10">
          {heroLogo ? (
            <div className="inline-flex rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 p-6">
              <img src={heroLogo} alt={appName} className="h-20 w-auto max-w-[240px] object-contain" />
            </div>
          ) : (
            <span className="text-3xl font-bold tracking-tight">{appName}</span>
          )}
        </div>

        {/* Tagline + feature bullets */}
        <div className="relative z-10 space-y-6 max-w-md">
          <h2 className="text-4xl font-bold leading-tight">
            Manage your fleet,
            <br />
            your way.
          </h2>
          <p className="text-white/80 text-lg">
            The all-in-one platform to run bookings, payments and your whole rental operation.
          </p>
          <ul className="space-y-3 pt-2">
            {heroFeatures.map((feature) => (
              <li key={feature} className="flex items-center gap-3 text-white/90">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm">{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-xs text-white/60">
          © {appName}. All rights reserved.
        </div>
      </div>

      {/* ---------- Right: form column ---------- */}
      <div className="relative flex items-center justify-center p-6 sm:p-10 bg-app-gradient">
        {/* Theme Toggle - positioned in top right */}
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-md">
          {/* Logo (mobile only — hero is hidden there) */}
          <div className="flex justify-center mb-6 lg:hidden">
            {authLogoUrl ? (
              <img src={authLogoUrl} alt={appName} className="h-20 w-auto max-w-[200px] object-contain" />
            ) : logoUrl && logoUrl !== "/logo.png" ? (
              <img
                src={logoUrl}
                alt={appName}
                className="h-16 w-auto max-w-[200px] object-contain invert dark:invert-0"
                style={{ imageRendering: "crisp-edges" }}
              />
            ) : (
              <span className="text-2xl font-bold text-primary">{appName}</span>
            )}
          </div>

          <div className="mb-8 space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Sign In</h1>
            <p className="text-muted-foreground">
              Enter your email and password to access the fleet management system
            </p>
          </div>

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
                          <a href={PLATFORM_PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">
                            Privacy Policy
                          </a>{" "}
                          and{" "}
                          <a href={PLATFORM_TERMS_URL} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">
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

          <div className="mt-6 text-center text-sm text-muted-foreground">
            <p>Need help? Contact your system administrator.</p>
          </div>
        </div>
      </div>
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
