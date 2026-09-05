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
  MIN_PASSWORD_LENGTH,
  isClean,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePasswordConfirmation,
  validatePhone,
} from "./validation";

/**
 * Create a customer account with THIS operator.
 *
 * One submit creates three rows — the auth user, the `customers` record and the
 * `customer_users` link — and the store puts all three behind the
 * `customer-signup` edge function precisely so a failure half way through
 * cannot leave an account that can never be used. See the store's header for
 * why that matters more than it sounds.
 *
 * Fields: name, email, phone (optional), password, confirmation. Phone is asked
 * for here rather than left to the booking flow because it is what an operator
 * reaches for when a handover goes wrong — but it is explicitly optional, so it
 * cannot become a reason somebody abandons the form.
 *
 * There is no terms checkbox. The booking flow carries its own consents against
 * a specific rental, and inventing a second one here would be a contract nobody
 * has written.
 */

const FIELDS = ["name", "email", "phone", "password", "confirm"] as const;

interface FieldErrors {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirm?: string;
}

export function SignupForm() {
  const router = useRouter();
  const ids = useFieldIds(FIELDS);
  const { signUp } = useCustomerAuth();
  const { tenant, isLoading: tenantLoading } = useTenant();
  const next = useNextPath();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [pending, setPending] = useState(false);

  const company = tenant?.company_name ?? tenant?.app_name ?? null;

  const clearError = (field: keyof FieldErrors) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const nextErrors: FieldErrors = {
      name: validateName(name),
      email: validateEmail(email),
      phone: validatePhone(phone),
      password: validateNewPassword(password),
      confirm: validatePasswordConfirmation(password, confirm),
    };
    setErrors(nextErrors);
    if (!isClean(nextErrors)) return;

    setFailure(null);
    setPending(true);

    const result = await signUp({ name, email, password, phone });

    if (!result.ok) {
      setFailure(result.failure);
      setPending(false);
      return;
    }

    // `signUp` signs the new customer in as part of the same call, so there is
    // nothing to confirm and nowhere to wait: go straight where they were
    // heading. Stays pending across the navigation so the button cannot be
    // pressed a second time and create a second account.
    router.replace(next);
  };

  return (
    <AuthCard
      title="Create your account"
      description={
        company
          ? `One account for every booking you make with ${company}.`
          : "One account for every booking you make."
      }
      footer={
        <>
          Already have an account?{" "}
          <AuthLink href={withNext("/login", next)}>Sign in</AuthLink>
        </>
      }
    >
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {failure ? (
          <FormNotice tone="danger">
            {failure.message}
            {failure.kind === "email-taken" ? (
              <>
                {" "}
                <AuthLink href={withNext("/login", next)}>Sign in</AuthLink>
              </>
            ) : null}
          </FormNotice>
        ) : null}

        <AuthTextField
          id={ids.name}
          label="Full name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={name}
          autoFocus
          disabled={pending}
          error={errors.name}
          onChange={(value) => {
            setName(value);
            clearError("name");
          }}
          onBlur={() =>
            setErrors((prev) => ({ ...prev, name: validateName(name) }))
          }
        />

        <AuthTextField
          id={ids.email}
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          hint="Your booking confirmations and rental agreements go here."
          value={email}
          disabled={pending}
          error={errors.email}
          onChange={(value) => {
            setEmail(value);
            clearError("email");
          }}
          onBlur={() =>
            setErrors((prev) => ({ ...prev, email: validateEmail(email) }))
          }
        />

        <AuthTextField
          id={ids.phone}
          label="Phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+1 555 010 0100"
          optional
          hint="Only used if we need to reach you about a live rental."
          value={phone}
          disabled={pending}
          error={errors.phone}
          onChange={(value) => {
            setPhone(value);
            clearError("phone");
          }}
          onBlur={() =>
            setErrors((prev) => ({ ...prev, phone: validatePhone(phone) }))
          }
        />

        <AuthPasswordField
          id={ids.password}
          label="Password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          value={password}
          disabled={pending}
          error={errors.password}
          onChange={(value) => {
            setPassword(value);
            clearError("password");
            // Re-check the confirmation against the NEW password rather than
            // leaving a stale "those do not match" under a field the visitor
            // has already fixed.
            if (errors.confirm && confirm !== "") {
              setErrors((prev) => ({
                ...prev,
                confirm: validatePasswordConfirmation(value, confirm),
              }));
            }
          }}
          onBlur={() =>
            setErrors((prev) => ({
              ...prev,
              password: validateNewPassword(password),
            }))
          }
        />

        <AuthPasswordField
          id={ids.confirm}
          label="Confirm password"
          autoComplete="new-password"
          value={confirm}
          disabled={pending}
          error={errors.confirm}
          onChange={(value) => {
            setConfirm(value);
            clearError("confirm");
          }}
          onBlur={() =>
            setErrors((prev) => ({
              ...prev,
              confirm: validatePasswordConfirmation(password, confirm),
            }))
          }
        />

        {/*
          Held closed until the tenant resolves: the account being created
          belongs to ONE operator, and creating it before we know which would
          either fail or — worse — succeed against the wrong one.
        */}
        <SubmitButton
          pending={pending}
          pendingLabel="Creating your account…"
          disabled={tenantLoading}
        >
          Create account
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
