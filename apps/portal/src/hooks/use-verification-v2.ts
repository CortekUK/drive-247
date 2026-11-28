// feat-003 · React Query hooks for driver verification (specs 03, 04, 05).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/contexts/TenantContext";
import {
  callVerification,
  type VerificationContext,
  type VerificationStatusResponse,
} from "@/lib/verification-v2/api";

export function useVerificationContext(customerId: string | null | undefined, enabled = true) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["verification-v2-context", tenant?.id, customerId],
    queryFn: () => callVerification<VerificationContext>("context", { customerId }, tenant?.slug),
    enabled: !!tenant && !!customerId && enabled,
    staleTime: 10_000,
  });
}

/** The latest session of a customer, polled every 3 seconds while it is open (spec 05, screen 3). */
export function useVerificationStatus(customerId: string | null | undefined, enabled = true) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["verification-v2-status", tenant?.id, customerId],
    queryFn: () => callVerification<VerificationStatusResponse>("status", { customerId }, tenant?.slug),
    enabled: !!tenant && !!customerId && enabled,
    refetchInterval: (q) => {
      const s = (q.state.data as VerificationStatusResponse | undefined)?.status;
      return s === "link_sent" || s === "in_progress" ? 3000 : false;
    },
  });
}

export function useVerificationActions(customerId: string | null | undefined) {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["verification-v2-context", tenant?.id, customerId] });
    qc.invalidateQueries({ queryKey: ["verification-v2-status", tenant?.id, customerId] });
    qc.invalidateQueries({ queryKey: ["customers-list"] });
    qc.invalidateQueries({ queryKey: ["customer", customerId] });
  };
  const start = useMutation({
    mutationFn: (v: { services: string[]; sentVia: string; sendTo?: string; saveEmail?: boolean }) =>
      callVerification<{ sessionId: string; link: string; expiresAt: string; sendError?: string }>("start", { customerId, ...v }, tenant?.slug),
    onSettled: refresh,
  });
  const resend = useMutation({
    mutationFn: (v: { sessionId: string; sentVia: string; sendTo?: string }) =>
      callVerification<{ ok: boolean; link: string }>("resend", v, tenant?.slug),
    onSettled: refresh,
  });
  const cancel = useMutation({
    mutationFn: (sessionId: string) => callVerification<{ ok: boolean }>("cancel", { sessionId }, tenant?.slug),
    onSettled: refresh,
  });
  const runPremium = useMutation({
    mutationFn: (service: string) => callVerification<{ sessionId: string }>("run-premium", { customerId, service }, tenant?.slug),
    onSettled: refresh,
  });
  return { start, resend, cancel, runPremium, refresh };
}

export function useVerificationPhotos(sessionId: string | null | undefined, enabled: boolean) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["verification-v2-photos", tenant?.id, sessionId],
    queryFn: () => callVerification<{ front: string | null; back: string | null; selfie: string | null }>("photos", { sessionId }, tenant?.slug),
    enabled: !!tenant && !!sessionId && enabled,
    staleTime: 5 * 60_000, // signed links last 10 minutes
  });
}
