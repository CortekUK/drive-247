"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { loginSchema, signupSchema, type LoginFormData, type SignupFormData } from "@/client-schemas/auth";
import { useCustomerAuthStore } from "@/stores/customer-auth-store";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { CbpModal } from "./modal";
import { Icon } from "./icons";
import { CBP } from "./use-site-content";

/* ========================================================================== *
 * Sign in, register, and password recovery — this site's design over the
 * existing implementation.
 *
 * Nothing about the mechanism is new. Every call goes through the same places
 * the existing site's dialog uses:
 *
 *   · `useCustomerAuthStore`  — signIn / signUp / verifyOTP / resendOTP, which
 *                               carry the tenant scoping, the customer_users
 *                               linking, and the blocked-account checks
 *   · `client-schemas/auth`   — the same zod rules, so a password accepted here
 *                               is accepted there
 *   · `send-verification-otp` / `verify-otp` / `reset-password-with-otp`
 *                             — the same edge functions, called with the same
 *                               bodies including `tenant_id`
 *
 * What is new is only the surface: the site's own inputs, buttons and modal.
 * ========================================================================== */

type Mode = "login" | "signup" | "verify-otp" | "reset-otp" | "reset-password";

/**
 * `functions.invoke` reports any non-2xx as "Edge Function returned a non-2xx
 * status code", which tells a customer nothing. Where the function sent a
 * reason we show that; otherwise we say what actually happened in words.
 */
const friendly = (raw: string | undefined | null, fallback: string) => {
  const text = (raw || "").trim();
  if (!text || /non-2xx status code/i.test(text) || /FunctionsHttpError/i.test(text)) return fallback;
  return text;
};

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

export function CbpAuthDialog({
  open, onOpenChange, returnTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where to land after a successful sign-in. Defaults to the customer portal,
   * as on the existing site; a visitor bounced out of a protected page arrives
   * with the page they wanted, and goes back to it.
   */
  returnTo?: string | null;
}) {
  const router = useRouter();
  const { tenant } = useTenant();
  const { signIn, signUp, verifyOTP, resendOTP } = useCustomerAuthStore();

  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Sign-up → OTP hand-off. The password is held only for the moment between
  // the code being confirmed and the session being created, exactly as the
  // existing dialog does it.
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingPassword, setPendingPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const signupForm = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  // A fresh dialog every time it opens: no stale error from a previous attempt,
  // and never a password left sitting in a field.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setMode("login");
      setFormError(null);
      setPendingPassword("");
      setNewPassword("");
      setConfirmPassword("");
      loginForm.reset();
      signupForm.reset();
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const finish = () => {
    onOpenChange(false);
    router.push(returnTo || "/portal");
  };

  const onLogin = async (data: LoginFormData) => {
    setBusy(true);
    setFormError(null);
    try {
      const result = await signIn(data.email, data.password, tenant?.id);
      if (result.error) {
        // The same three cases the existing dialog distinguishes, shown in the
        // form rather than only as a toast so the message survives a re-read.
        const message = result.error.message || "";
        if (result.isBlocked) {
          setFormError("This account has been blocked. Please contact us.");
        } else if (message.includes("Invalid login")) {
          setFormError("That email and password don't match. Please try again.");
        } else if (message.includes("No customer")) {
          setFormError("No account here yet — create one below.");
          signupForm.setValue("email", data.email);
          setMode("signup");
        } else {
          setFormError(message || "We couldn't sign you in. Please try again.");
        }
        return;
      }
      toast.success("Signed in.");
      finish();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onSignup = async (data: SignupFormData) => {
    setBusy(true);
    setFormError(null);
    try {
      const result = await signUp(data.email, data.password, {
        tenantId: tenant?.id,
        customerName: data.name,
      });
      if (result.error) {
        const message = result.error.message || "";
        if (result.isBlocked) {
          setFormError("This account has been blocked. Please contact us.");
        } else if (message.toLowerCase().includes("already")) {
          setFormError("An account with this email already exists — sign in instead.");
          loginForm.setValue("email", data.email);
          setMode("login");
        } else {
          setFormError(message || "We couldn't create your account. Please try again.");
        }
        return;
      }
      if (result.data?.needsOTPVerification) {
        setPendingEmail(data.email);
        setPendingPassword(data.password);
        setMode("verify-otp");
        return;
      }
      toast.success("Account created.");
      finish();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const startReset = async () => {
    const email = (loginForm.getValues("email") || "").trim();
    if (!email) {
      setFormError("Enter your email address first, then choose 'Forgot password'.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const { error } = await supabase.functions.invoke("send-verification-otp", {
        body: { email, tenant_id: tenant?.id, type: "password_reset" },
      });
      if (error) {
        setFormError(friendly(
          error.message,
          "We couldn't send a reset code to that address. Check it is the email you registered with.",
        ));
        return;
      }
      setResetEmail(email);
      setMode("reset-otp");
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onVerifySignup = async (code: string) => {
    if (!tenant?.id) {
      setFormError("We could not identify this site. Please reload and try again.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const result = await verifyOTP(pendingEmail, code, pendingPassword, tenant.id);
      if (result.error) {
        setFormError(friendly(result.error.message, "That code is invalid or has expired."));
        return;
      }
      setPendingPassword("");
      toast.success("Account verified.");
      finish();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onVerifyReset = async (code: string) => {
    setBusy(true);
    setFormError(null);
    try {
      const { data, error } = await supabase.functions.invoke("verify-otp", {
        body: { email: resetEmail, code, tenant_id: tenant?.id },
      });
      if (error || !(data as { verified?: boolean })?.verified) {
        setFormError(friendly(
          (data as { error?: string })?.error || error?.message,
          "That code is invalid or has expired.",
        ));
        return;
      }
      setMode("reset-password");
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onSetPassword = async () => {
    // The same two rules the sign-up schema enforces, checked here because this
    // step is a pair of plain fields rather than a react-hook-form.
    if (newPassword.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setFormError("Password must contain an uppercase letter and a number.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const { data, error } = await supabase.functions.invoke("reset-password-with-otp", {
        body: { email: resetEmail, new_password: newPassword, tenant_id: tenant?.id },
      });
      if (error || (data as { error?: string })?.error) {
        setFormError(friendly(
          (data as { error?: string })?.error || error?.message,
          "We couldn't reset your password. Please request a new code and try again.",
        ));
        return;
      }
      toast.success("Password updated — sign in with it now.");
      setNewPassword("");
      setConfirmPassword("");
      loginForm.setValue("email", resetEmail);
      loginForm.setValue("password", "");
      setMode("login");
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const resendSignupCode = async () => {
    if (!tenant?.id) return { error: { message: "No tenant" } };
    return resendOTP(pendingEmail, tenant.id);
  };

  const resendResetCode = async () => {
    const { error } = await supabase.functions.invoke("send-verification-otp", {
      body: { email: resetEmail, tenant_id: tenant?.id, type: "password_reset" },
    });
    return { error };
  };

  const titles: Record<Mode, { title: string; sub: string }> = {
    login: { title: "Welcome back", sub: "Sign in to manage your bookings and documents." },
    signup: { title: "Create your account", sub: "One account for every booking you make with us." },
    "verify-otp": { title: "Check your email", sub: `We sent a ${OTP_LENGTH}-digit code to ${pendingEmail}.` },
    "reset-otp": { title: "Check your email", sub: `We sent a ${OTP_LENGTH}-digit code to ${resetEmail}.` },
    "reset-password": { title: "Set a new password", sub: "Choose something you haven't used here before." },
  };

  return (
    <CbpModal
      open={open}
      onOpenChange={onOpenChange}
      title={titles[mode].title}
      description={titles[mode].sub}
      icon="user"
      width="26rem"
    >
      {formError && (
        <p className="cbp-form-error" role="alert">
          <Icon name="info" className="h-4 w-4 shrink-0" />
          <span>{formError}</span>
        </p>
      )}

      {mode === "login" && (
        <form onSubmit={loginForm.handleSubmit(onLogin)} noValidate className="mt-4 flex flex-col gap-3.5">
          <TextField
            label="Email" type="email" autoComplete="email" autoFocus
            error={loginForm.formState.errors.email?.message}
            {...loginForm.register("email")}
          />
          <PasswordField
            label="Password" autoComplete="current-password"
            error={loginForm.formState.errors.password?.message}
            {...loginForm.register("password")}
          />
          <button type="button" className="cbp-form-link self-end" onClick={startReset} disabled={busy}>
            Forgot password?
          </button>
          <SubmitButton busy={busy}>Sign in</SubmitButton>
          <Switcher
            question="New here?"
            action="Create an account"
            onClick={() => { setFormError(null); setMode("signup"); }}
          />
        </form>
      )}

      {mode === "signup" && (
        <form onSubmit={signupForm.handleSubmit(onSignup)} noValidate className="mt-4 flex flex-col gap-3.5">
          <TextField
            label="Full name" autoComplete="name" autoFocus
            error={signupForm.formState.errors.name?.message}
            {...signupForm.register("name")}
          />
          <TextField
            label="Email" type="email" autoComplete="email"
            error={signupForm.formState.errors.email?.message}
            {...signupForm.register("email")}
          />
          <PasswordField
            label="Password" autoComplete="new-password"
            hint="At least 8 characters, with an uppercase letter and a number."
            error={signupForm.formState.errors.password?.message}
            {...signupForm.register("password")}
          />
          <PasswordField
            label="Confirm password" autoComplete="new-password"
            error={signupForm.formState.errors.confirmPassword?.message}
            {...signupForm.register("confirmPassword")}
          />
          <SubmitButton busy={busy}>Create account</SubmitButton>
          <p className="text-center text-[11.5px] leading-relaxed text-[var(--meta)]">
            By continuing you agree to our{" "}
            <Link href={`${CBP}/terms`} className="cbp-form-link">Terms</Link> and{" "}
            <Link href={`${CBP}/privacy`} className="cbp-form-link">Privacy Policy</Link>.
          </p>
          <Switcher
            question="Already have an account?"
            action="Sign in"
            onClick={() => { setFormError(null); setMode("login"); }}
          />
        </form>
      )}

      {mode === "verify-otp" && (
        <OtpStep
          busy={busy}
          onSubmit={onVerifySignup}
          onResend={resendSignupCode}
          onBack={() => { setFormError(null); setMode("signup"); }}
          submitLabel="Verify and continue"
        />
      )}

      {mode === "reset-otp" && (
        <OtpStep
          busy={busy}
          onSubmit={onVerifyReset}
          onResend={resendResetCode}
          onBack={() => { setFormError(null); setMode("login"); }}
          submitLabel="Continue"
        />
      )}

      {mode === "reset-password" && (
        <form
          className="mt-4 flex flex-col gap-3.5"
          noValidate
          onSubmit={e => { e.preventDefault(); onSetPassword(); }}
        >
          <PasswordField
            label="New password" autoComplete="new-password" autoFocus
            hint="At least 8 characters, with an uppercase letter and a number."
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
          />
          <PasswordField
            label="Confirm new password" autoComplete="new-password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
          />
          <SubmitButton busy={busy}>Update password</SubmitButton>
        </form>
      )}
    </CbpModal>
  );
}

/* ------------------------------------------------------------------ otp -- */

/**
 * Six single-character boxes that behave like one field: typing advances,
 * backspace retreats, and a pasted code fills the row. Lifted straight from
 * the existing dialog's behaviour so muscle memory carries over.
 */
function OtpStep({
  busy, onSubmit, onResend, onBack, submitLabel,
}: {
  busy: boolean;
  onSubmit: (code: string) => void;
  onResend: () => Promise<{ error: unknown }>;
  onBack: () => void;
  submitLabel: string;
}) {
  const [values, setValues] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { refs.current[0]?.focus(); }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const setAt = (i: number, digit: string) => {
    setValues(prev => {
      const next = [...prev];
      next[i] = digit;
      return next;
    });
  };

  const code = values.join("");

  return (
    <form
      className="mt-4 flex flex-col gap-4"
      noValidate
      onSubmit={e => { e.preventDefault(); onSubmit(code); }}
    >
      <div className="flex justify-center gap-2" onPaste={e => {
        e.preventDefault();
        const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
        if (!pasted) return;
        const next = Array(OTP_LENGTH).fill("");
        pasted.split("").forEach((d, i) => { next[i] = d; });
        setValues(next);
        refs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
      }}>
        {values.map((v, i) => (
          <input
            key={i}
            ref={el => { refs.current[i] = el; }}
            className="cbp-otp"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
            value={v}
            onChange={e => {
              const digit = e.target.value.replace(/\D/g, "").slice(-1);
              setAt(i, digit);
              if (digit && i < OTP_LENGTH - 1) refs.current[i + 1]?.focus();
            }}
            onKeyDown={e => {
              if (e.key === "Backspace" && !values[i] && i > 0) {
                e.preventDefault();
                setAt(i - 1, "");
                refs.current[i - 1]?.focus();
              }
            }}
          />
        ))}
      </div>

      <SubmitButton busy={busy} disabled={code.length !== OTP_LENGTH}>{submitLabel}</SubmitButton>

      <div className="flex items-center justify-between gap-3">
        <button type="button" className="cbp-form-link" onClick={onBack} disabled={busy}>
          <Icon name="chevronLeft" className="h-3.5 w-3.5" /> Back
        </button>
        <button
          type="button"
          className="cbp-form-link"
          disabled={cooldown > 0 || busy}
          onClick={async () => {
            const { error } = await onResend();
            if (error) {
              toast.error("We couldn't resend the code. Please try again.");
              return;
            }
            toast.success("A new code is on its way.");
            setValues(Array(OTP_LENGTH).fill(""));
            setCooldown(RESEND_SECONDS);
            refs.current[0]?.focus();
          }}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
      </div>
    </form>
  );
}

/* --------------------------------------------------------------- fields -- */

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
};

const TextField = ({ label, error, hint, ...rest }: InputProps) => {
  const id = rest.id || `f-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="cbp-form-row">
      <label htmlFor={id} className="cbp-form-label">{label}</label>
      <input id={id} className="cbp-input" aria-invalid={!!error} {...rest} />
      {hint && !error && <p className="cbp-form-hint">{hint}</p>}
      {error && <p className="cbp-form-msg" role="alert">{error}</p>}
    </div>
  );
};

/** Same field with a show/hide control, so a typo is recoverable. */
const PasswordField = ({ label, error, hint, ...rest }: InputProps) => {
  const [shown, setShown] = useState(false);
  const id = rest.id || `f-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="cbp-form-row">
      <label htmlFor={id} className="cbp-form-label">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={shown ? "text" : "password"}
          className="cbp-input !pr-11"
          aria-invalid={!!error}
          {...rest}
        />
        <button
          type="button"
          className="cbp-input-affix"
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown(v => !v)}
          tabIndex={-1}
        >
          <Icon name={shown ? "eyeOff" : "eye"} className="h-4 w-4" />
        </button>
      </div>
      {hint && !error && <p className="cbp-form-hint">{hint}</p>}
      {error && <p className="cbp-form-msg" role="alert">{error}</p>}
    </div>
  );
};

function SubmitButton({
  busy, disabled, children,
}: {
  busy: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button type="submit" className="cbp-btn cbp-btn-primary mt-1 w-full justify-center" disabled={busy || disabled}>
      {busy ? <><span className="cbp-spinner" aria-hidden="true" /> Please wait…</> : children}
    </button>
  );
}

const Switcher = ({ question, action, onClick }: { question: string; action: string; onClick: () => void }) => (
  <p className="text-center text-[13px] text-[var(--body)]">
    {question}{" "}
    <button type="button" className="cbp-form-link" onClick={onClick}>{action}</button>
  </p>
);
