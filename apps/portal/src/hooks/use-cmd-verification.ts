import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";

export type CmdLicenseStatus = "Pending" | "Valid" | "Invalid" | "Expired" | null;
export type CmdInsuranceStatus = "LinkSent" | "Verifying" | "Verified" | "Unverified" | null;
export type CmdChannel = "email" | "sms" | "whatsapp";

export interface CmdApplicantInput {
  firstName: string;
  middleName?: string;
  lastName: string;
  applicantType: "Primary" | "Joint" | "Cosigner";
  applicantEmail: string;
  phoneNumber: string;
  mobile: string;
  state: string;
  zipCode: string;
  city: string;
  addressLine1: string;
  addressLine2?: string;
}

export interface CmdVerificationRow {
  id: string;
  customer_id: string;
  tenant_id: string | null;
  status: string;
  verification_completed_at: string | null;
  cmd_verification_id: string | null;
  cmd_applicant_verification_id: string | null;
  cmd_status: CmdInsuranceStatus;
  cmd_license_status: CmdLicenseStatus;
  cmd_last_event_at: string | null;
  cmd_magic_link: string | null;
  cmd_magic_link_expires_at: string | null;
  cmd_delivery_channels: string[] | null;
  created_at: string | null;
}

export interface CmdLiveResults {
  ok: boolean;
  status: string | null;
  disposition: string | null;
  rawStatusTimestamp: string | null;
  license?: {
    licenseNumber?: string | null;
    licenseExpiryDate?: string | null;
    licenseHolderFullName?: string | null;
    licenseHolderDOB?: string | null;
    licenseAddress?: string | null;
    licenseCity?: string | null;
    licenseState?: string | null;
    licenseZipCode?: string | null;
    documentURLs?: string[] | null;
  };
}

const queryKey = {
  byCustomer: (tenantId: string | undefined, customerId: string | undefined) =>
    ["cmd-verification", tenantId, customerId] as const,
  results: (applicantVerificationId: string | null | undefined) =>
    ["cmd-results", applicantVerificationId] as const,
};

/**
 * Latest CMD verification record for a customer (or null if never started).
 * Polls every 5s while a record is in a non-terminal state so the UI tracks
 * webhook updates without forcing a page reload.
 */
export function useCmdVerification(customerId: string | undefined) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: queryKey.byCustomer(tenant?.id, customerId),
    queryFn: async (): Promise<CmdVerificationRow | null> => {
      if (!customerId) return null;
      const { data, error } = await supabase
        .from("identity_verifications")
        .select(
          "id, customer_id, tenant_id, status, verification_completed_at, cmd_verification_id, cmd_applicant_verification_id, cmd_status, cmd_license_status, cmd_last_event_at, cmd_magic_link, cmd_magic_link_expires_at, cmd_delivery_channels, created_at"
        )
        .eq("customer_id", customerId)
        .eq("provider", "cmd")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return (data as CmdVerificationRow | null) ?? null;
    },
    enabled: !!customerId && !!tenant?.id,
    refetchInterval: (q) => {
      const v = q.state.data as CmdVerificationRow | null | undefined;
      if (!v) return false;
      // Keep polling while license is still pending — webhook will land soon.
      return v.cmd_license_status === "Pending" || v.cmd_license_status === null ? 5000 : false;
    },
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

/**
 * Fetch live results from Modives (license details, document URLs).
 * Per Modives compliance the result is NOT cached server-side — keep
 * staleTime at 0 so we always fetch fresh when the user opens the panel.
 */
export function useCmdResults(applicantVerificationId: string | null | undefined) {
  return useQuery({
    queryKey: queryKey.results(applicantVerificationId),
    queryFn: async (): Promise<CmdLiveResults | null> => {
      if (!applicantVerificationId) return null;
      const { data, error } = await supabase.functions.invoke<CmdLiveResults>("cmd-get-results", {
        body: { applicantVerificationId },
      });
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!applicantVerificationId,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

interface CreateInput {
  customerId: string;
  channels: CmdChannel[];
  applicant: CmdApplicantInput;
  leaseTermDays?: number;
  leaseStartDate?: string;
}

/**
 * supabase-js's invoke() throws a FunctionsHttpError on non-2xx with the generic
 * message "Edge Function returned a non-2xx status code", swallowing our actual
 * `{ error: "..." }` JSON body. This helper unwraps the response and surfaces
 * the real message — fall back to the generic only if there's no body.
 */
async function extractInvokeError(err: unknown): Promise<string> {
  const e = err as { context?: Response; message?: string };
  try {
    const body = await e?.context?.clone().json();
    if (body && typeof body === "object" && typeof body.error === "string") {
      return body.error;
    }
  } catch {}
  return e?.message ?? "Unknown error";
}

export function useCreateCmdVerification() {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  return useMutation({
    mutationFn: async (input: CreateInput) => {
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        verificationRowId?: string;
        applicantVerificationId?: string;
        modivesVerificationId?: string;
        magicLink?: string;
        deliveredVia?: CmdChannel[];
        deliveryErrors?: Record<string, string>;
        error?: string;
      }>("cmd-create-verification", { body: input });
      if (error) throw new Error(await extractInvokeError(error));
      if (!data?.ok) throw new Error(data?.error ?? "CMD verification failed");
      return data;
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKey.byCustomer(tenant?.id, vars.customerId) });
      const channels = data.deliveredVia ?? [];
      toast({
        title: "Verification link sent",
        description: channels.length
          ? `Delivered via ${channels.join(", ")}.`
          : "Magic link generated. Delivery is still pending.",
      });
    },
    // Errors are surfaced inline in the dialog — no toast to avoid double-display.
  });
}

export function useResendCmdLink() {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  return useMutation({
    mutationFn: async (input: { verificationId: string; customerId: string; channels: CmdChannel[] }) => {
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        deliveredVia?: CmdChannel[];
        deliveryErrors?: Record<string, string>;
      }>("cmd-resend-link", {
        body: { verificationId: input.verificationId, channels: input.channels },
      });
      if (error) throw new Error(await extractInvokeError(error));
      return data;
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKey.byCustomer(tenant?.id, vars.customerId) });
      toast({
        title: "Link re-sent",
        description: `Delivered via ${(data?.deliveredVia ?? []).join(", ") || "—"}.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Resend failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });
}

/**
 * Convenience: detect whether the verification is in a terminal state.
 */
export function isCmdTerminal(row: CmdVerificationRow | null | undefined): boolean {
  if (!row) return false;
  return row.cmd_license_status === "Valid"
    || row.cmd_license_status === "Invalid"
    || row.cmd_license_status === "Expired";
}
