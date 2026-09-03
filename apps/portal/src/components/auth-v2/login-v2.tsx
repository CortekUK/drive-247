"use client";

/**
 * The v2 login screen — a split hero with the tenant's brand wash on the left
 * and the sign-in form on the right.
 *
 * Ported from `improv/portal-side`'s `(auth)/login/page.tsx`. It is a COMPONENT
 * here, not a page: `(auth)/login/page.tsx` stays v1 for the other 56 tenants
 * and hands off to this one behind `useV2('login')` — V2_PLAN §3.
 *
 * ── This is the auth path ──────────────────────────────────────────────────
 * Every behaviour of the v1 screen is reproduced below, deliberately and
 * line-for-line: the same `signIn` from the same store, the same rate limiting,
 * the same audit rows, the same policy acceptance, the same reset-password
 * flow, the same role-based redirect. Where the branch had dropped or assumed
 * something, v1 wins. The three places that happened are marked `V1 PARITY`.
 */

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth, useAuthStore } from "@/stores/auth-store";
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
import { BrandLogo } from "@/components/shared/layout/brand-logo";
import { HeroTypedHeadline } from "@/components/shared/layout/hero-typed-headline";
import { ThemeToggle } from "@/components/shared/layout/theme-toggle";
import { brandInk, brandSurface } from "@/components/auth-v2/brand-surface";
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

/**
 * How the brand wash dissolves into the page.
 *
 * Two things make a blend read as a blend rather than as an edge, and the
 * first attempt at this had neither.
 *
 * Length: the fade is measured against the viewport, not against the wash's
 * own box. A percentage of a 58%-wide layer is a different number of pixels at
 * every window size, so the transition tightened as the window narrowed —
 * exactly when it could least afford to. Spanning the viewport keeps it
 * proportional, and it runs well past the halfway line so the seam has no
 * fixed place to be.
 *
 * Curve: a two-stop mask is linear in alpha, and the eye finds the corners
 * where it starts and stops. The intermediate stops approximate a smoothstep,
 * so the rate of change itself eases in and out and there is no kink to catch.
 */
const WASH_MASK = `linear-gradient(to right,
  rgb(0 0 0) 0%,
  rgb(0 0 0) 34%,
  rgb(0 0 0 / 0.96) 42%,
  rgb(0 0 0 / 0.88) 49%,
  rgb(0 0 0 / 0.74) 56%,
  rgb(0 0 0 / 0.56) 63%,
  rgb(0 0 0 / 0.38) 70%,
  rgb(0 0 0 / 0.22) 77%,
  rgb(0 0 0 / 0.10) 84%,
  rgb(0 0 0 / 0.03) 92%,
  rgb(0 0 0 / 0) 100%)`;

/**
 * The same dissolve for a tenant who uploaded a hero photograph, compressed
 * into a half-width layer.
 *
 * A photograph cannot take the page-wide treatment. A flat tint at a tenth of
 * its opacity is still a flat tint, but a photograph at a tenth is legible
 * imagery sitting underneath the password field, and it arrives with a dark
 * scrim that would drag the form's background down with it. So the picture
 * stays on its own side and only its trailing edge is dissolved.
 *
 * No tenant has set `hero_background_url` today — this is the path staying
 * correct rather than the path anyone is on.
 */
const PHOTO_MASK = `linear-gradient(to right,
  rgb(0 0 0) 0%,
  rgb(0 0 0) 55%,
  rgb(0 0 0 / 0.86) 66%,
  rgb(0 0 0 / 0.60) 76%,
  rgb(0 0 0 / 0.32) 86%,
  rgb(0 0 0 / 0.10) 94%,
  rgb(0 0 0 / 0) 100%)`;

/**
 * The mobile wash runs top-to-bottom instead of left-to-right, and eases the
 * same way — the eye finds the corners of a two-stop fade whichever axis it is
 * on.
 */
const MOBILE_WASH_MASK = `linear-gradient(to bottom,
  rgb(0 0 0) 0%,
  rgb(0 0 0) 18%,
  rgb(0 0 0 / 0.88) 34%,
  rgb(0 0 0 / 0.68) 48%,
  rgb(0 0 0 / 0.44) 62%,
  rgb(0 0 0 / 0.22) 76%,
  rgb(0 0 0 / 0.08) 88%,
  rgb(0 0 0 / 0) 100%)`;

/**
 * The sign-in fields.
 *
 * The shared `Input` is built for dense dashboard forms: 36px tall, a
 * transparent border and a half-opacity fill. On a page where the controls are
 * the only thing to do, that reads as pale strips floating on the background
 * with no edge. Overridden here rather than in `ui/input.tsx`, which the rest
 * of the portal depends on staying compact.
 *
 * The border does all the defining, because there is no panel behind these to
 * do it — and it has to hold at both ends of the column: over the tint on the
 * left, and over near-white where the wash has faded out on the right. A
 * hairline that reads on the tint disappears against the white, so it is set
 * for the harder of the two. `hover` and the existing focus ring take it
 * further on contact rather than shouting at rest.
 *
 * V1 PARITY — the `dark:` half. On `improv/portal-side` this route was pinned
 * light by a `forcedTheme` in `providers.tsx`, so a single light treatment was
 * enough. That pin does not exist on `main`: `providers.tsx` here is
 * `defaultTheme="system"` with no override, and v1's login keeps a working
 * `ThemeToggle`. A white field on the deep panel would have been the same
 * unreadable-on-its-own-ground problem the light treatment exists to avoid.
 */
const FIELD_CLASS =
  "h-12 rounded-2xl border-slate-900/20 bg-white px-4 text-[15px] shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-colors placeholder:text-slate-400 hover:border-slate-900/30 dark:border-white/20 dark:bg-white/[0.06] dark:text-white dark:shadow-none dark:placeholder:text-white/40 dark:hover:border-white/30";

/**
 * "Keep me signed in", same problem as the fields one size down: the shared
 * `Checkbox` is a 16px square with a transparent border on a pale fill, which
 * on the tint is a faint smudge rather than something that looks clickable.
 * Given the same white fill and visible border as the inputs it belongs to, and
 * a couple of pixels more to sit against 48px controls. The checked state is
 * untouched — the primitive's own `data-[state=checked]:bg-primary` still
 * fills it with the brand, and `bg-white` cannot displace it because
 * tailwind-merge treats the two as different variants of the same utility.
 *
 * `data-[state=unchecked]:hover:` rather than the branch's
 * `not-data-checked:hover:` — the `not-*` variant is Tailwind v4 syntax and
 * this app is on 3.4, where it would have compiled to nothing at all.
 */
const CHECKBOX_CLASS =
  "size-[18px] rounded-[6px] border-slate-900/25 bg-white transition-colors data-[state=unchecked]:hover:border-slate-900/40 dark:border-white/25 dark:bg-white/[0.06] dark:data-[state=unchecked]:hover:border-white/40";

function LoginV2Content() {
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

  // V1 PARITY — the theme is READ, not assumed.
  //
  // The branch hardcoded `isDarkMode = false` because its `providers.tsx`
  // pinned this route light with `forcedTheme`. `main` has no such pin — see
  // `app/providers.tsx`, which is `defaultTheme="system" enableSystem` — so
  // hardcoding it here would paint the pale tint and near-black type onto a
  // dark page for every operator whose portal is in dark mode. v1 reads
  // `resolvedTheme` for exactly this reason (its logo swap depends on it), and
  // v1 wins.
  //
  // No hydration risk from reading it during render: `(auth)/layout.tsx` wraps
  // this route in `DynamicThemeProvider`, which renders a skeleton until the
  // tenant and its branding have loaded on the client, so this component's
  // first paint is already a client paint.
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === "dark";

  // ---- Brand colours ----
  //
  // Resolved exactly the way `use-dynamic-theme` resolves them: the
  // mode-specific override first, the base column second. Settings → Appearance
  // writes both, and they are not always the same value — `amgroadside` has a
  // blue `accent_color` and a dark red `light_accent_color`, so reading the
  // base here would paint their login screen a colour the rest of their portal
  // never shows.
  //
  // Both branches are present because, unlike the source branch, this route is
  // not pinned to light.
  const accentSource = isDarkMode
    ? branding?.dark_accent_color ||
      branding?.accent_color ||
      branding?.dark_primary_color ||
      branding?.primary_color
    : branding?.light_accent_color ||
      branding?.accent_color ||
      branding?.light_primary_color ||
      branding?.primary_color;
  const primarySource = isDarkMode
    ? branding?.dark_primary_color || branding?.primary_color
    : branding?.light_primary_color || branding?.primary_color;

  // ---- Hero panel ----
  //
  // One flat colour, taken from the accent and never from a literal. An earlier
  // pass built this as a gradient of `accent_color || secondary_color ||
  // "#6366f1"`, so every tenant who had left their accent unset landed on that
  // one indigo — a purple hero on a green brand. Falling back through to
  // primary keeps the chain brand-derived end to end. See `brandSurface` for
  // why the chart ramp is the wrong source too.
  const hero = brandSurface(accentSource, isDarkMode);
  const heroImage = branding?.hero_background_url || null;

  // A photograph is always a dark ground once scrimmed; the flat panel is only
  // dark in dark mode. Everything drawn on the hero keys off this one value.
  const heroOnDark = !!heroImage || !hero.isLight;

  // Link colour for the form column. See `brandInk` — `text-primary` is
  // invisible on the pale-branded tenants.
  const ink = brandInk(primarySource, isDarkMode);

  // The hero headline, in the accent. Run through `brandInk` for the same
  // reason: the panel behind it is a pale tint of this very colour, so the raw
  // accent would sit roughly 2.5:1 against its own background.
  const accentInk = brandInk(accentSource, heroOnDark);

  // The mobile wash is always the flat tint, never a tenant's hero photograph,
  // so its ground can only go dark with the theme — which is a different
  // question from `heroOnDark` on a tenant who has uploaded a picture.
  const mobileOnDark = !hero.isLight;
  const mobileAccentInk = brandInk(accentSource, mobileOnDark);

  // `auth_logo_url` and `dark_logo_url` are both drawn for a dark ground — that
  // is the whole reason the old layout sat the logo on a hardcoded black
  // square. On the pale panel they would be the same invisible-on-light problem
  // one layer along, so the light-ground logo is the one that belongs there.
  const heroLogo = heroOnDark
    ? authLogoUrl || branding?.dark_logo_url || branding?.logo_url || null
    : branding?.logo_url || authLogoUrl || null;

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

        // V1 PARITY — the identified login_success row.
        //
        // signIn resolves only after the app_users profile is loaded. Read the
        // freshly committed store value rather than this render's stale
        // `appUser`, otherwise the login audit row has no tenant/actor and
        // cannot be used as real tenant engagement by Health Score. The branch
        // had dropped this read along with `tenant_id`/`actor_id`/`entity_type`
        // from the insert below, which would have written anonymous rows.
        const signedInAppUser = useAuthStore.getState().appUser;

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
            tenant_id: signedInAppUser?.tenant_id || tenant?.id || null,
            actor_id: signedInAppUser?.id || null,
            entity_type: "session",
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
          its own edge, and that edge is a hard vertical line down the middle of
          the screen. This layer spans the whole page and is dissolved by
          `WASH_MASK` instead, so there is no boundary anywhere for the eye to
          land on and the two halves read as one surface. */}
      <div
        aria-hidden
        className={`absolute inset-y-0 left-0 hidden overflow-hidden lg:block ${
          heroImage ? "w-[58%]" : "w-full"
        }`}
        style={{
          ...(heroImage
            ? {
                backgroundImage: `url(${heroImage})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                maskImage: PHOTO_MASK,
                WebkitMaskImage: PHOTO_MASK,
              }
            : {
                backgroundColor: hero.color,
                maskImage: WASH_MASK,
                WebkitMaskImage: WASH_MASK,
              }),
        }}
      >
        {/* Scrim only over a photograph, which is an unknown and needs one to
            carry white text. The flat colour gets nothing laid over it — a
            scrim, a glow or a gradient would each undo the one thing it is. */}
        {heroImage && (
          <div className="absolute inset-0 bg-gradient-to-tr from-black/75 via-black/55 to-black/35" />
        )}
      </div>

      {/* Brand wash, phones and small tablets.
          The hero column is hidden below `lg`, and it was taking every trace of
          the tenant's colour with it — a green-branded operator and an indigo
          one opened the same near-white page, with the logo the only thing
          telling them apart. This brings the colour down from the top edge and
          fades it out above the fields, so the brand is present without sitting
          behind anything that has to stay readable.

          Always the flat tint, never the photograph: a scrimmed picture behind
          a form on a 390px screen is the legibility problem the desktop layout
          keeps at arm's length by giving it its own column. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[42vh] lg:hidden"
        style={{
          backgroundColor: hero.color,
          maskImage: MOBILE_WASH_MASK,
          WebkitMaskImage: MOBILE_WASH_MASK,
        }}
      />

      {/* V1 PARITY — the theme toggle.
          The branch deleted this on the grounds that its `providers.tsx` pinned
          the route light, so the control had nothing to switch. `main` has no
          such pin, and v1's login carries this toggle in exactly this corner —
          removing it would take a working affordance away from every operator
          on the canary. Above the washes so it stays clickable. */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* ---------- Left: hero content (lg and up) ----------
          Type colour follows the panel, not the app theme: in light mode the
          panel is a pale tint and white text on it would be unreadable. */}
      <aside
        className={`relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between ${
          heroOnDark ? "text-white" : "text-slate-900"
        }`}
      >
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

        {/* The whole middle band is one line of copy. The Trax chip and the
            greeting that used to sit around it are gone — three competing
            voices in one column, where the big line already says it. */}
        <div className="relative z-10">
          <HeroTypedHeadline
            appName={appName}
            accentInk={accentInk}
            onDark={heroOnDark}
          />
        </div>

        <p
          className={`relative z-10 text-xs ${
            heroOnDark ? "text-white/60" : "text-slate-900/50"
          }`}
        >
          © {new Date().getFullYear()} {appName}. All rights reserved.
        </p>
      </aside>

      {/* ---------- Right: sign-in form ---------- */}
      {/* Mobile brand mark, pinned near the top edge rather than riding on the
          form. In the flow it was the first thing in a vertically centred
          column, which put it a third of the way down the screen — floating,
          and low in the brand wash it is supposed to sit in. Lifting it out
          lets the form centre on its own and gives the page the same shape the
          desktop layout has: mark at the top, content in the middle.

          `h-9` with a width cap rather than a fixed box: tenant logos range
          from wide wordmarks to square marks, so height is what keeps them
          optically equal and `max-w` stops the widest ones running to the
          screen edges. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-8 lg:hidden">
        <BrandLogo className="h-9 w-auto max-w-[168px]" />
      </div>

      {/* `min-h-screen` so the form centres on a phone too. Below `lg` the
          parent stops being a grid, so this is an ordinary block that shrank to
          its content — `items-center` had nothing to centre within, and the
          form sat against the top edge with the dead space all below it.

          The extra top padding below `lg` reserves the pinned mark's band, so a
          centred form can never ride up into it on a short screen. */}
      {/* Top-anchored on a phone, centred from `lg`.
          Centring in the viewport put the block wherever the middle happened to
          be, which on a tall phone left a large void under the pinned mark that
          grew with the screen. Anchoring to the top makes the distance from the
          mark a spacing decision rather than a by-product of the device height,
          and it stays put across every phone size. Desktop keeps centring —
          there `main` is a grid item filling a full-height row, so the middle
          is exactly where the form belongs. */}
      <main className="relative flex min-h-screen items-start justify-center px-6 pt-[104px] pb-10 sm:px-10 lg:items-center lg:py-12">
        {/* Between the 448px this started at, which read as a thin strip, and
            the 560px that replaced it, which ran too wide once the panel came
            back off. */}
        <div className="w-full max-w-[480px]">
          {/* Below `lg` the hero column is gone and with it the product story,
              leaving a band of empty tint between the pinned mark and the form.
              The same copy runs here at a phone-sized scale, so the two layouts
              say the same thing rather than the small one saying nothing. */}
          <div className="mb-7 lg:hidden">
            <HeroTypedHeadline
              appName={appName}
              accentInk={mobileAccentInk}
              onDark={mobileOnDark}
              compact
            />
          </div>

          {/* No panel — the form sits directly on the wash. The width that
              fixed the "thin strip" problem is on the column above, so it does
              not depend on a card to hold it; the fields carry their own edge
              instead. */}
          <div className="mb-6 space-y-1.5">
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
                          className={FIELD_CLASS}
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
                          className={FIELD_CLASS}
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
                            className={CHECKBOX_CLASS}
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
                            className={CHECKBOX_CLASS}
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
                  className="h-12 w-full rounded-2xl text-base"
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

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Need help? Contact your system administrator.
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * `useSearchParams` needs a Suspense boundary of its own. v1's page provides
 * one; this component is rendered from inside v1's `LoginPage` *before* that
 * boundary, so it carries its own — with the identical fallback, so the two
 * paths look the same while they load.
 */
export function LoginV2() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-muted-foreground">Loading...</span>
        </div>
      </div>
    }>
      <LoginV2Content />
    </Suspense>
  );
}

export default LoginV2;
