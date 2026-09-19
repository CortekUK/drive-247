"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useCustomerAuthStore } from "@/stores/customer-auth-store";
import { useTenant } from "@/contexts/TenantContext";
import { CbpAuthDialog } from "./auth-dialog";
import { CbpEnquiryDialog } from "./enquiry-dialog";
import { CBP } from "./use-site-content";

/* ========================================================================== *
 * The two things any page of this site can ask for: sign in, and enquire.
 *
 * Both dialogs are mounted ONCE here rather than beside each button. A header
 * button, a drawer button and a card's "Enquire" all open the same instance, so
 * two of them can never be open at once and a half-typed enquiry cannot be lost
 * because the button that opened it scrolled out of the tree.
 *
 * `/portal` — the customer's own account area — bounces a signed-out visitor
 * back with `?auth=login&from=…`. That lands here: the dialog opens on arrival
 * and, once they are in, sends them on to the page they actually wanted.
 * ========================================================================== */

interface CbpActions {
  openLogin: (returnTo?: string | null) => void;
  openEnquiry: (vehicleId?: string | null) => void;
  /** Whether this operator takes enquiries at all. */
  enquiriesEnabled: boolean;
  signOut: () => void;
}

const ActionsContext = createContext<CbpActions | null>(null);

export function useCbpActions(): CbpActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useCbpActions must be used inside <CbpActionsProvider>");
  return ctx;
}

/** The signed-in customer, or null. Reads the app's own store — no second session. */
export function useCbpCustomer() {
  const customerUser = useCustomerAuthStore(s => s.customerUser);
  const session = useCustomerAuthStore(s => s.session);
  const loading = useCustomerAuthStore(s => s.loading);
  const initialized = useCustomerAuthStore(s => s.initialized);
  const { tenant } = useTenant();

  // Belt and braces on top of the store's own tenant filter: never greet a
  // customer of one operator on another operator's site.
  const belongsHere = !tenant?.id || !customerUser || customerUser.customer?.tenant_id === tenant.id;

  return {
    customer: session && customerUser && belongsHere ? customerUser.customer : null,
    ready: initialized && !loading,
  };
}

export function CbpActionsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const storeSignOut = useCustomerAuthStore(s => s.signOut);

  const [authOpen, setAuthOpen] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState<string | null>(null);

  const openLogin = useCallback((to?: string | null) => {
    setReturnTo(to ?? null);
    setAuthOpen(true);
  }, []);

  const openEnquiry = useCallback((id?: string | null) => {
    setVehicleId(id ?? null);
    setEnquiryOpen(true);
  }, []);

  // Arriving with ?auth=login (from a protected page, or a shared link) opens
  // the dialog and remembers where the visitor was heading. The parameters are
  // then stripped so a refresh, or a back-navigation later, does not reopen it.
  useEffect(() => {
    if (searchParams?.get("auth") !== "login") return;
    const from = searchParams.get("from");
    openLogin(from ? decodeURIComponent(from) : null);
    router.replace(pathname || CBP, { scroll: false });
  }, [searchParams, pathname, router, openLogin]);

  const signOut = useCallback(() => {
    void storeSignOut().then(() => {
      toast.success("Signed out.");
      router.push(CBP);
    });
  }, [storeSignOut, router]);

  const value = useMemo<CbpActions>(() => ({
    openLogin,
    openEnquiry,
    // The operator's switch, read the same way the existing header reads it:
    // only an explicit `false` turns enquiries off.
    enquiriesEnabled: (tenant as { enquiries_enabled?: boolean | null } | null)?.enquiries_enabled !== false,
    signOut,
  }), [openLogin, openEnquiry, tenant, signOut]);

  return (
    <ActionsContext.Provider value={value}>
      {children}
      <CbpAuthDialog open={authOpen} onOpenChange={setAuthOpen} returnTo={returnTo} />
      <CbpEnquiryDialog open={enquiryOpen} onOpenChange={setEnquiryOpen} defaultVehicleId={vehicleId} />
    </ActionsContext.Provider>
  );
}
