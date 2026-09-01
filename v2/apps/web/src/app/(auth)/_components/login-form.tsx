"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { useCustomerAuth } from "@/contexts/CustomerAuthContext";
import { useTenant } from "@/contexts/TenantContext";
import type { AuthFailure } from "@/lib/stores/customer-auth-store";

import { AuthCard, AuthLink } from "./auth-card";
import {
  AuthPasswordField,
  AuthTextField,
  FormNotice,
  SubmitButton,
  useFieldIds,
} from "./auth-fields";
import { useNextPath, withNext } from "./next-path";
import {
  isClean,
  validateEmail,
  validateExistingPassword,
} from "./validation";

/**
 * Sign in to the customer portal.
 *
 * The one thing worth reading carefully is how the two failures are told apart,
 * because they look identical to a visitor and are not:
 *
 *   • `invalid-credentials` — Supabase rejected the pair. It will not say which
 *     half was wrong, on purpose: a form that distinguishes "no such account"
 *     from "wrong password" is an account-enumeration oracle. So the copy names
 *     both halves and offers a password reset.
 *
 *   • `no-account-for-tenant` — the password was RIGHT. This person has a
 *     Drive247 account, just not with this operator. Telling them to check
 *     their password would send them round a loop they can never finish; what
 *     they need is the signup link, so that is what the notice carries.
 *
 * Field errors are shown after a field is left, not on every keystroke —
 * flagging an address as malformed while it is still being typed is noise.
 */

const FIELDS = ["email", "password"] as const;

interface FieldErrors {
  email?: string;
  password?: string;
}

export function LoginForm() {
  const router = useRouter();
  const ids = useFieldIds(FIELDS);
  const { signIn } = useCustomerAuth();
  const { tenant, isLoading: tenantLoading } = useTenant();
  const next = useNextPath();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [pending, setPending] = useState(false);

  const company = tenant?.company_name ?? tenant?.app_name ?? null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const nextErrors: FieldErrors = {
      email: validateEmail(email),
      password: validateExistingPassword(password),
    };
    setErrors(nextErrors);
    if (!isClean(nextErrors)) return;

    setFailure(null);
    setPending(true);

    const result = await signIn(email, password);

    if (!result.ok) {
      setFailure(result.failure);
      setPending(false);
      return;
    }

    // Stay pending through the navigation. Dropping it here would flash an
    // enabled "Sign in" button for the frame between success and the route
    // change — long enough to be clicked a second time.
    router.replace(next);
  };

  return (
    <AuthCard
      title="Sign in"
      description={
        company
          ? `Manage your bookings, documents and payments with ${company}.`
          : "Manage your bookings, documents and payments."
      }
      footer={
        <>
          New here?{" "}
          <AuthLink href={withNext("/signup", next)}>Create an account</AuthLink>
        </>
      }
    >
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {failure ? (
          <FormNotice tone="danger">
            {failure.message}
            {failure.kind === "no-account-for-tenant" ? (
              <>
                {" "}
                <AuthLink href={withNext("/signup", next)}>
                  Create an account
                </AuthLink>
              </>
            ) : null}
          </FormNotice>
        ) : null}

        <AuthTextField
          id={ids.email}
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          autoFocus
          disabled={pending}
          error={errors.email}
          onChange={(value) => {
            setEmail(value);
            if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
          }}
          onBlur={() =>
            setErrors((prev) => ({ ...prev, email: validateEmail(email) }))
          }
        />

        <AuthPasswordField
          id={ids.password}
          label="Password"
          autoComplete="current-password"
          value={password}
          disabled={pending}
          error={errors.password}
          action={
            <AuthLink
              href="/forgot-password"
              className="text-xs font-normal no-underline hover:underline"
            >
              Forgot password?
            </AuthLink>
          }
          onChange={(value) => {
            setPassword(value);
            if (errors.password) {
              setErrors((prev) => ({ ...prev, password: undefined }));
            }
          }}
          onBlur={() =>
            setErrors((prev) => ({
              ...prev,
              password: validateExistingPassword(password),
            }))
          }
        />

        {/*
          Held closed until the tenant resolves. Sign-in is scoped to one
          operator, so submitting before we know which one can only fail — and
          it would fail with a message about the site rather than about them.
        */}
        <SubmitButton
          pending={pending}
          pendingLabel="Signing you in…"
          disabled={tenantLoading}
        >
          Sign in
        </SubmitButton>

        {tenantLoading ? (
          <p className="text-center text-xs text-brand-text-subtle">
            Loading this site…
          </p>
        ) : null}
      </form>
    </AuthCard>
  );
}
