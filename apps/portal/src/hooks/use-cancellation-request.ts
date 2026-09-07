import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";

/**
 * "Need to cancel? Contact support" — the request, and its state.
 *
 * ── why there is no Cancel button ───────────────────────────────────────────
 *
 * A one-click cancel on a billing page ends a business relationship with no
 * conversation, usually over something a person could have fixed. So the
 * customer-facing action files a REQUEST and a human answers it. Nothing here
 * touches Stripe; the subscription keeps running until somebody decides
 * otherwise.
 *
 * ── why it reuses `go_live_requests` ────────────────────────────────────────
 *
 * That table is already a generic tenant→platform request queue: tenant,
 * requester, a free-text type, a note, a pending/approved/rejected status, and
 * a super admin dashboard at /admin/requests that already renders it with the
 * tenant name and the requester's email. `integration_type` has no CHECK
 * constraint, so a cancellation is simply another type in the queue.
 *
 * Building a second table would have meant a second admin page, a second RLS
 * policy set and a second place to look — for a row shape that already exists.
 *
 * ── the request must not be a dead end ──────────────────────────────────────
 *
 * The insert alone puts it in a list nobody is watching. `notify-cancellation-
 * request` emails the team, and it is called fire-and-forget: the row is
 * committed before the email is attempted, so a mail failure can never lose the
 * request or tell the operator their ask did not go through. The function logs
 * loudly and leaves `notified_at` unset so a retry can still reach the team.
 */

export const CANCELLATION_TYPE = "subscription_cancellation";

export interface CancellationRequest {
  id: string;
  tenant_id: string;
  requested_by: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export function useCancellationRequest() {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["cancellation-request", tenant?.id];

  /* Only the OPEN one. A tenant who asked, was talked round, and asked again a
     year later should see the second request, not the first. */
  const { data: pending, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("go_live_requests")
        .select("id, tenant_id, requested_by, status, note, admin_note, created_at, reviewed_at")
        .eq("tenant_id", tenant!.id)
        .eq("integration_type", CANCELLATION_TYPE)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return (data as CancellationRequest) ?? null;
    },
    enabled: !!tenant?.id,
    staleTime: 30_000,
  });

  const submit = useMutation({
    mutationFn: async ({ reason }: { reason?: string }) => {
      if (!tenant?.id || !appUser?.id) {
        throw new Error("You must be signed in to request cancellation.");
      }

      const { data, error } = await (supabase as any)
        .from("go_live_requests")
        .insert({
          tenant_id: tenant.id,
          requested_by: appUser.id,
          integration_type: CANCELLATION_TYPE,
          note: reason?.trim() || null,
        })
        .select()
        .single();

      if (error) throw error;

      /* Fire-and-forget, and deliberately so: the request is SAVED at this
         point. Awaiting the email would let a Resend outage surface as "your
         request failed" for a request that is sitting in the queue, and the
         operator would send it again. Failures are logged inside the function
         and leave it re-sendable. */
      void supabase.functions
        .invoke("notify-cancellation-request", { body: { requestId: data.id } })
        .then((res) => {
          if (res.error) console.error("Cancellation email failed to dispatch:", res.error);
        })
        .catch((err) => console.error("Cancellation email failed to dispatch:", err));

      return data as CancellationRequest;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    /** The open request, if the tenant has one. */
    pending: pending ?? null,
    hasPending: !!pending,
    isLoading,
    submit,
  };
}
