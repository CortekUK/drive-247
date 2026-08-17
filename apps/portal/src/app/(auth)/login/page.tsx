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
import { Loader2, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useRateLimiting } from "@/hooks/use-rate-limiting";
import { supabase } from "@/integrations/supabase/client";
import { ThemeToggle } from "@/components/shared/layout/theme-toggle";
import { BrandLogo } from "@/components/shared/layout/brand-logo";
import { TraxLoginTip } from "@/components/shared/layout/trax-login-tip";
import { CloudShader } from "@/components/ui/cloud-shader";
import { brandInk, brandSky, brandSurface } from "@/lib/brand-surface";
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

  const authLogoUrl = branding?.auth_logo_url;
  const appName = branding?.app_name || "Drive247";

  // ---- Hero panel ----
  //
  // One flat colour, derived from the brand hex and never from a literal. v2
  // built this as a gradient of `accent_color || secondary_color || "#6366f1"`,
  // so every tenant who had left their accent unset landed on that one indigo —
  // a purple hero on a green brand, the same bug the shell's corner wash had.
  // See `brandSurface` for why the chart ramp is the wrong source too.
  const hero = brandSurface(branding?.primary_color);
  const sky = brandSky(branding?.primary_color);
  const heroImage = branding?.hero_background_url || null;
  // Link colour for the form column. See `brandInk` — `text-primary` is
  // invisible on the pale-branded tenants.
  const { resolvedTheme } = useTheme();
  const ink = brandInk(branding?.primary_color, resolvedTheme === "dark");
  // `auth_logo_url` is drawn for a dark ground; that is the whole reason the old
  // layout sat it on a hardcoded black square. The hero panel *is* a dark
  // ground, so the logo goes here and the square is no longer needed.
  const heroLogo = authLogoUrl || branding?.dark_logo_url || branding?.logo_url || null;

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
    <div className="relative min-h-screen overflow-hidden bg-background lg:grid lg:grid-cols-2">
      {/* Brand wash.
          Deliberately NOT a background on the hero column: a column paints to
          its own edge and that edge is a hard vertical line down the middle of
          the screen. This layer is wider than the column it sits under and is
          masked away before it gets there, so the dark side dissolves into the
          light one and the two halves read as one page. */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 hidden w-[58%] overflow-hidden lg:block"
        style={{
          ...(heroImage
            ? {
                backgroundImage: `url(${heroImage})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : { backgroundColor: hero.color }),
          maskImage:
            "linear-gradient(to right, #000 0%, #000 74%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, #000 0%, #000 74%, transparent 100%)",
        }}
      >
        {/* A tenant who uploaded a hero photograph gets their photograph; the
            sky is what stands in when they have not. `hero.color` stays on the
            wrapper underneath either way, so a machine with no WebGL — the
            shader bails silently on a null context — lands on the flat brand
            colour rather than a hole. */}
        {!heroImage && (
          <CloudShader
            className="absolute inset-0 h-full min-h-0"
            speed={0.7}
            count={6}
            {...sky}
          />
        )}

        {/* Legibility scrim, weighted to the bottom-left where every line of
            copy sits. Clouds are near-white by design, and white text over a
            cloud is not readable at any opacity — this keeps the sky bright at
            the top-right and hands the text a dark ground. */}
        <div
          className={`absolute inset-0 bg-gradient-to-tr ${
            heroImage
              ? "from-black/75 via-black/55 to-black/35"
              : "from-black/70 via-black/35 to-transparent"
          }`}
        />
      </div>

      {/* ---------- Left: hero content (lg and up) ---------- */}
      <aside className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="relative z-10">
          {heroLogo ? (
            <img
              src={heroLogo}
              alt={appName}
              className="h-14 w-auto max-w-[220px] object-contain"
            />
          ) : (
            <span className="text-2xl font-semibold tracking-tight">{appName}</span>
          )}
        </div>

        <div className="relative z-10 max-w-md space-y-6">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Manage your fleet,
            <br />
            your way.
          </h2>
          <p className="text-lg text-white/80">
            One place to run bookings, payments and your whole rental operation.
          </p>
          <TraxLoginTip appName={appName} />
        </div>

        <p className="relative z-10 text-xs text-white/60">
          © {new Date().getFullYear()} {appName}. All rights reserved.
        </p>
      </aside>

      {/* ---------- Right: sign-in form ---------- */}
      <main className="relative flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-md">
          {/* Small screens only — from lg up the hero carries the brand. */}
          <div className="mb-8 flex justify-center lg:hidden">
            <BrandLogo className="h-12 w-auto max-w-[200px]" />
          </div>

          <div className="mb-8 space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Sign in
            </h1>
            <p className="text-sm text-muted-foreground">
              Enter your email and password to access {appName}.
            </p>
          </div>

          {(
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
                    style={{ color: ink }}
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
                            <a href={PLATFORM_PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80" style={{ color: ink }}>
                              Privacy Policy
                            </a>{" "}
                            and{" "}
                            <a href={PLATFORM_TERMS_URL} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80" style={{ color: ink }}>
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

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Need help? Contact your system administrator.
          </p>
        </div>
      </main>
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
