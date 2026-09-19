import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { extractFunctionErrorPayload } from "@/lib/edge-error";
import type { NotificationTestRequest, NotificationTestResponse } from "@/lib/notifications-v2/types";

/**
 * Notifications v2: Send test (build-spec §Edge function, send-test-box.tsx).
 *
 * Calls the notification-test-v2 edge function and ALWAYS resolves to a
 * NotificationTestResponse with an operator-facing `message`; it never throws,
 * so the Send test box can show the sentence inline whatever happened:
 *   - a 2xx reply is passed through (a push that reached no device is a 2xx
 *     with success:false and code "no_devices");
 *   - a non-2xx reply (FunctionsHttpError) is unwrapped from error.context, the
 *     real JSON body the function sent ({ error, code }), instead of supabase-js'
 *     generic "Edge Function returned a non-2xx status code" (lib/edge-error.ts;
 *     the same unwrapping as lib/push.ts readEdgeFunctionError);
 *   - a function that is not deployed yet (a 404 with no body of ours), a
 *     session the gateway refused, and a network failure get their own plain
 *     sentences.
 *
 * tenantId and tenantSlug always go in the body: a super admin has no tenant of
 * their own and the function needs to know which company to send as. For
 * everyone else the function ignores them and uses their own account's tenant.
 */

export const NOTIFICATION_TEST_V2_FUNCTION = "notification-test-v2";

const NOT_DEPLOYED_MESSAGE = "Sending tests isn't switched on yet. Try again later.";
const NETWORK_MESSAGE = "Couldn't reach the server. Check your connection and try again.";
const SESSION_MESSAGE = "Your session has ended. Sign in again, then send the test.";
const GENERIC_MESSAGE = "The test wasn't sent. Try again in a moment.";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A reply body as a NotificationTestResponse, with a `message` always set. */
export function normaliseTestResponse(data: unknown, fallbackMessage = GENERIC_MESSAGE): NotificationTestResponse {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { success: false, error: fallbackMessage, message: fallbackMessage, code: "empty_reply" };
  }
  const d = data as Record<string, unknown>;
  const success = d.success === true;
  const error = str(d.error);
  const message = str(d.message) ?? error ?? (success ? "Sent." : fallbackMessage);
  const out: NotificationTestResponse = { success, message };
  const sent = num(d.sent);
  const failed = num(d.failed);
  if (sent !== undefined) out.sent = sent;
  if (failed !== undefined) out.failed = failed;
  if (!success) out.error = error ?? message;
  const code = str(d.code);
  if (code) out.code = code;
  return out;
}

/**
 * A failed functions.invoke as a NotificationTestResponse. The function answers
 * every failure with { success:false, error, code }; anything else came from
 * the gateway or the network and gets a plain sentence instead of its raw text.
 */
export async function responseFromInvokeError(fnError: unknown): Promise<NotificationTestResponse> {
  const name = (fnError as { name?: string } | null)?.name;
  if (name === "FunctionsFetchError") {
    return { success: false, error: NETWORK_MESSAGE, message: NETWORK_MESSAGE, code: "network" };
  }

  const payload = await extractFunctionErrorPayload(fnError);
  if (payload && str(payload.error)) return normaliseTestResponse({ ...payload, success: false });

  const status = (fnError as { context?: { status?: number } } | null)?.context?.status;
  if (status === 404) {
    // The gateway's { code: "NOT_FOUND", message: "Requested function was not found" }.
    return { success: false, error: NOT_DEPLOYED_MESSAGE, message: NOT_DEPLOYED_MESSAGE, code: "not_deployed" };
  }
  if (status === 401) {
    // The gateway rejected the session before the function ran (verify_jwt).
    return { success: false, error: SESSION_MESSAGE, message: SESSION_MESSAGE, code: "invalid_session" };
  }
  return { success: false, error: GENERIC_MESSAGE, message: GENERIC_MESSAGE, code: "request_failed" };
}

export function useNotificationTestV2() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (req: NotificationTestRequest): Promise<NotificationTestResponse> => {
      if (!tenant) {
        const message = "Your account details haven't loaded yet. Try again in a moment.";
        return { success: false, error: message, message, code: "no_tenant" };
      }
      try {
        const { data, error } = await supabase.functions.invoke(NOTIFICATION_TEST_V2_FUNCTION, {
          body: { ...req, tenantId: tenant.id, tenantSlug: tenant.slug },
        });
        if (error) return await responseFromInvokeError(error);
        return normaliseTestResponse(data);
      } catch (err) {
        console.error("[notification-test-v2] send failed:", err);
        return { success: false, error: GENERIC_MESSAGE, message: GENERIC_MESSAGE, code: "request_failed" };
      }
    },
    onSuccess: (_result, req) => {
      // A push test writes delivery rows and may retire a dead device.
      if (req.channel === "push") {
        void queryClient.invalidateQueries({ queryKey: ["push-log", tenant?.id] });
        void queryClient.invalidateQueries({ queryKey: ["push-devices", tenant?.id] });
      }
    },
  });

  const { mutateAsync } = mutation;
  /** Sends one test. Always resolves; check `success` and show `message`. */
  const sendTest = useCallback((req: NotificationTestRequest) => mutateAsync(req), [mutateAsync]);

  return { sendTest, isSending: mutation.isPending };
}
