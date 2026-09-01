"use client";

import { useMemo } from "react";

import { useCustomerAuth } from "@/contexts/CustomerAuthContext";
import type { CustomerProfile } from "@/lib/stores/customer-auth-store";

/**
 * The signed-in customer, ready to render.
 *
 * `useCustomerAuth()` is the transport — sessions, sign-in, sign-out. This is
 * the read model the portal actually wants: who is here, the ids its queries
 * need, and the two or three derived strings every header re-derives otherwise.
 *
 * `status` is the field to branch on. The two booleans are kept because
 * `isLoading` reads better in a guard clause, but they carry no information
 * `status` does not:
 *
 *     const { status, customer } = useCustomer();
 *     if (status === "loading") return <PortalSkeleton />;
 *     if (status === "anonymous") { router.replace("/login?next=…"); return null; }
 *
 * "anonymous" covers BOTH halves of the customer model: no Supabase session at
 * all, and a valid session belonging to somebody who is not a customer of this
 * tenant. Neither may see the portal, and the store has already signed the
 * second one out of this browser by the time it reaches here.
 */

export type CustomerStatus = "loading" | "anonymous" | "authenticated";

export interface UseCustomerResult {
  status: CustomerStatus;
  /** True while the answer is still unknown. Never true at the same time as `isAuthenticated`. */
  isLoading: boolean;
  isAuthenticated: boolean;

  customer: CustomerProfile | null;
  /** `customers.id` — the FK on rentals, invoices, payments. */
  customerId: string | null;
  /** `customer_users.id` — the FK on customer_notifications and chat channels. */
  customerUserId: string | null;
  /** `auth.users.id`. Storage paths and edge functions key off this. */
  authUserId: string | null;
  tenantId: string | null;

  email: string | null;
  phone: string | null;
  /** The customer's name, or their email local part when the name is blank. */
  displayName: string | null;
  /** One or two letters for an avatar. Null when there is nothing to derive one from. */
  initials: string | null;
  /** Identity documents have been checked and accepted. */
  isIdentityVerified: boolean;

  /** Re-read the customer row — call after a profile edit. */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * "Ada Lovelace" → "AL", "Prince" → "P", "ada@example.com" → "A".
 *
 * Takes the first and LAST word rather than the first two, so a middle name
 * does not push the surname out. Uses `Array.from` so a name whose first
 * character is an emoji or an astral-plane letter does not come back as half a
 * surrogate pair.
 */
function deriveInitials(name: string): string | null {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const first = Array.from(words[0])[0] ?? "";
  const last =
    words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";

  const initials = `${first}${last}`.toUpperCase();
  return initials === "" ? null : initials;
}

export function useCustomer(): UseCustomerResult {
  const { customer, membership, isLoading, isAuthenticated, refresh, signOut } =
    useCustomerAuth();

  return useMemo<UseCustomerResult>(() => {
    const status: CustomerStatus = isLoading
      ? "loading"
      : isAuthenticated
        ? "authenticated"
        : "anonymous";

    const email = customer?.email ?? null;

    // `customers.name` is NOT NULL but can be an empty string, and a header
    // rendering nothing at all reads as a bug. The email local part is the
    // honest fallback — it is what the customer typed.
    const trimmedName = customer?.name?.trim() ?? "";
    const displayName =
      trimmedName !== "" ? trimmedName : (email?.split("@")[0] ?? null);

    return {
      status,
      isLoading,
      isAuthenticated,

      customer: customer ?? null,
      customerId: membership?.customerId ?? null,
      customerUserId: membership?.id ?? null,
      authUserId: membership?.authUserId ?? null,
      tenantId: membership?.tenantId ?? null,

      email,
      phone: customer?.phone ?? null,
      displayName,
      initials: displayName === null ? null : deriveInitials(displayName),
      isIdentityVerified: customer?.identity_verification_status === "verified",

      refresh,
      signOut,
    };
  }, [customer, membership, isLoading, isAuthenticated, refresh, signOut]);
}
