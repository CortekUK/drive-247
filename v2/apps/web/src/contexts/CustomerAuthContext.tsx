"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";

import { useTenant } from "@/contexts/TenantContext";
import {
  useCustomerAuthStore,
  type AuthResult,
  type CustomerMembership,
  type CustomerProfile,
  type SignUpInput,
} from "@/lib/stores/customer-auth-store";

/**
 * Wires `customer-auth-store` to the tenant, and hands the tree one API.
 *
 * The store cannot resolve anything on its own: "who is signed in" is only
 * answerable together with "whose site is this", and that lives in
 * `TenantContext`. This provider is the seam between the two — it pushes the
 * resolved tenant down and starts the session listener, in that order of
 * dependency, and must therefore be mounted INSIDE `TenantProvider`.
 *
 * `setTenant` is called only once `TenantContext` has stopped loading, so a
 * `null` argument genuinely means "there is no tenant for this host" rather
 * than "not yet". The store relies on that distinction: without it a signed-in
 * customer would sit on a loading state forever on a host that resolves to no
 * tenant at all.
 */

export interface CustomerAuthContextValue {
  /** The Supabase auth user. Signed in ≠ a customer of THIS site — see `customer`. */
  user: User | null;
  /** The customer record for the CURRENT tenant, or null. */
  customer: CustomerProfile | null;
  /** The `customer_users` link, for callers that need its id or the customer id. */
  membership: CustomerMembership | null;
  /** True until both the session and (if signed in) the membership are known. */
  isLoading: boolean;
  /** Signed in AND a customer of this tenant. Both halves are required. */
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (input: SignUpInput) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  /** Step 1 of a password reset: email a six-digit code. */
  resetPassword: (email: string) => Promise<AuthResult>;
  /** Step 2: verify that code and set the new password. */
  confirmPasswordReset: (
    email: string,
    code: string,
    newPassword: string,
  ) => Promise<AuthResult>;
  /** Re-read the customer row — after a profile edit, say. */
  refresh: () => Promise<void>;
}

const CustomerAuthContext = createContext<CustomerAuthContextValue | undefined>(
  undefined,
);

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const { tenant, isLoading: tenantLoading } = useTenant();

  const user = useCustomerAuthStore((state) => state.user);
  const membership = useCustomerAuthStore((state) => state.membership);
  const sessionResolved = useCustomerAuthStore((state) => state.sessionResolved);
  const membershipResolved = useCustomerAuthStore(
    (state) => state.membershipResolved,
  );

  // Actions are stable for the life of the store, so selecting them here costs
  // nothing and keeps the memo below honest about its dependencies.
  const initialize = useCustomerAuthStore((state) => state.initialize);
  const setTenant = useCustomerAuthStore((state) => state.setTenant);
  const signIn = useCustomerAuthStore((state) => state.signIn);
  const signUp = useCustomerAuthStore((state) => state.signUp);
  const signOut = useCustomerAuthStore((state) => state.signOut);
  const resetPassword = useCustomerAuthStore((state) => state.resetPassword);
  const confirmPasswordReset = useCustomerAuthStore(
    (state) => state.confirmPasswordReset,
  );
  const refresh = useCustomerAuthStore((state) => state.refresh);

  const tenantId = tenant?.id ?? null;
  // `company_name` is nullable in the schema; the fallback is what appears in
  // "not registered with …" copy, so it must never render as "null".
  const tenantName = tenant?.company_name ?? tenant?.app_name ?? "this site";

  useEffect(() => {
    // Wait for a real answer. Calling `setTenant(null)` while the tenant query
    // is still in flight would tell the store "no tenant exists here", and it
    // would settle a signed-in customer as having no account.
    if (tenantLoading) return;

    setTenant(tenantId === null ? null : { id: tenantId, name: tenantName });
  }, [tenantLoading, tenantId, tenantName, setTenant]);

  useEffect(() => {
    // Idempotent: the store returns early once it has a listener, so React 18+
    // double-invoking effects in development does not attach a second one.
    void initialize();
  }, [initialize]);

  const value = useMemo<CustomerAuthContextValue>(() => {
    // A signed-out visitor is never "loading" — the membership question does
    // not arise. A signed-in one is, right up until we know whether they hold
    // an account on THIS tenant.
    const isLoading = !sessionResolved || (user !== null && !membershipResolved);

    return {
      user,
      customer: membership?.customer ?? null,
      membership,
      isLoading,
      isAuthenticated: user !== null && membership !== null,
      signIn,
      signUp,
      signOut,
      resetPassword,
      confirmPasswordReset,
      refresh,
    };
  }, [
    user,
    membership,
    sessionResolved,
    membershipResolved,
    signIn,
    signUp,
    signOut,
    resetPassword,
    confirmPasswordReset,
    refresh,
  ]);

  return (
    <CustomerAuthContext.Provider value={value}>
      {children}
    </CustomerAuthContext.Provider>
  );
}

/**
 * Safe outside a provider — server rendering, isolated tests — where it reports
 * a settled signed-out state rather than throwing, so one stray consumer cannot
 * take a page down. The actions reject instead of pretending to work.
 */
const EMPTY_CUSTOMER_AUTH: CustomerAuthContextValue = {
  user: null,
  customer: null,
  membership: null,
  isLoading: false,
  isAuthenticated: false,
  signIn: async () => ({
    ok: false,
    failure: {
      kind: "unexpected",
      message: "Sign-in is unavailable on this page.",
    },
  }),
  signUp: async () => ({
    ok: false,
    failure: {
      kind: "unexpected",
      message: "Sign-up is unavailable on this page.",
    },
  }),
  signOut: async () => {},
  resetPassword: async () => ({
    ok: false,
    failure: {
      kind: "unexpected",
      message: "Password reset is unavailable on this page.",
    },
  }),
  confirmPasswordReset: async () => ({
    ok: false,
    failure: {
      kind: "unexpected",
      message: "Password reset is unavailable on this page.",
    },
  }),
  refresh: async () => {},
};

export function useCustomerAuth(): CustomerAuthContextValue {
  return useContext(CustomerAuthContext) ?? EMPTY_CUSTOMER_AUTH;
}
