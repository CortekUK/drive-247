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
import { Loader2, AlertCircle, Shield } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useRateLimiting } from "@/hooks/use-rate-limiting";
import { supabase } from "@/integrations/supabase/client";
import { ThemeToggle } from "@/components/shared/layout/theme-toggle";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { useTheme } from "next-themes";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().default(false),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, signIn, loading, appUser } = useAuth();
  const { branding } = useTenantBranding();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
  });

  const {
    rateLimitStatus,
    checkRateLimit,
    recordLoginAttempt,
    getRateLimitMessage,
    isLocked,
  } = useRateLimiting();

  // Get logo from tenant branding or use default
  const { resolvedTheme } = useTheme();
  const logoUrl = (resolvedTheme === 'dark' && branding?.dark_logo_url ? branding.dark_logo_url : branding?.logo_url) || "/logo.png";
  const appName = branding?.app_name || "Drive247";

  // Role-based redirect logic
  const getRedirectPath = (): string => {
    if (appUser?.role === "head_admin" || appUser?.role === "admin") {
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

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${window.location.origin}/reset-password`,
        }
      );

      if (error) throw error;

      setShowForgotPassword(true);

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
      // Always show success message for security (don't reveal if email exists)
      setShowForgotPassword(true);
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
            <div className="bg-[hsl(159,21%,30%)] dark:bg-[hsl(159,21%,15%)]/30 rounded-2xl p-6 border border-primary/20 transition-all duration-300 hover:border-primary/40 hover:shadow-[0_0_20px_rgba(198,162,86,0.15)]">
              {logoUrl && logoUrl !== "/logo.png" ? (
                <img
                  src={logoUrl}
                  alt={appName}
                  className="h-32 w-auto max-w-[160px] object-contain transition-transform duration-300 hover:scale-105"
                  style={{
                    filter: "drop-shadow(0 2px 8px rgba(198, 162, 86, 0.2))",
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
          {showForgotPassword ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <Shield className="h-12 w-12 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Password Reset Sent</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  If an account exists with that email address, you will receive
                  password reset instructions.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setShowForgotPassword(false)}
                className="w-full"
              >
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

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting || !form.formState.isValid}
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
