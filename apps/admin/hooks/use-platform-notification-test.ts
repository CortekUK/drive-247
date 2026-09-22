'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { NotificationTestRequest, NotificationTestResponse } from '@/lib/notifications-v2/types';

/**
 * Notifications v2, SYSTEM set: Send test.
 *
 * Calls the notification-test-v2 edge function with `scope: 'platform'`, which
 * sends as Drive247 itself — the From is "Drive 247 <noreply@drive-247.com>",
 * the email carries our branding rather than an operator's, and a push test goes
 * to the caller's OWN platform-audience devices (the ones enrolled by
 * hooks/use-platform-push.ts). The function re-checks app_users.is_super_admin
 * before it does any of that, so this hook is not the access control.
 *
 * It ALWAYS resolves to a NotificationTestResponse with a `message` that can be
 * shown as it is, and never throws — the Send test box needs a sentence for
 * every outcome, not an exception:
 *   - a 2xx reply is passed through (a push that reached no device is a 2xx with
 *     success:false and code "no_devices");
 *   - a non-2xx reply (FunctionsHttpError) is unwrapped from error.context, the
 *     real JSON body the function sent ({ error, code }), instead of supabase-js'
 *     generic "Edge Function returned a non-2xx status code";
 *   - a function that is not deployed yet (404 with no body of ours), a session
 *     the gateway refused (401), and a network failure get their own sentences.
 * The `{ error }` from invoke is always inspected — it is never treated as a
 * send that happened; it is turned into `success: false` with the server's own
 * reason.
 *
 * Plain state rather than React Query for the same reason as
 * use-platform-notification-settings.ts: this app mounts no QueryClientProvider.
 */

export const NOTIFICATION_TEST_V2_FUNCTION = 'notification-test-v2';

/** The scope this hook always sends. 'tenant' is the portal's; see the function's header. */
export const PLATFORM_TEST_SCOPE = 'platform';

const NOT_DEPLOYED_MESSAGE = "Sending tests isn't switched on yet. Try again later.";
const NETWORK_MESSAGE = "Couldn't reach the server. Check your connection and try again.";
const SESSION_MESSAGE = 'Your session has ended. Sign in again, then send the test.';
const GENERIC_MESSAGE = "The test wasn't sent. Try again in a moment.";

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * The edge function's error BODY, not just its message. supabase-js hangs the
 * original Response off `error.context`; lib/push.ts readEdgeFunctionError digs
 * out the string, and this keeps the object so `code` survives.
 */
async function extractFunctionErrorPayload(fnError: unknown): Promise<Record<string, unknown> | null> {
  const ctx = (fnError as { context?: Response } | null)?.context;
  if (!ctx || typeof ctx.clone !== 'function') return null;
  try {
    const body = await ctx.clone().json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A reply body as a NotificationTestResponse, with a `message` always set. */
export function normaliseTestResponse(data: unknown, fallbackMessage = GENERIC_MESSAGE): NotificationTestResponse {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { success: false, error: fallbackMessage, message: fallbackMessage, code: 'empty_reply' };
  }
  const d = data as Record<string, unknown>;
  const success = d.success === true;
  const error = str(d.error);
  const message = str(d.message) ?? error ?? (success ? 'Sent.' : fallbackMessage);
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
 * every failure with { success:false, error, code }; anything else came from the
 * gateway or the network and gets a plain sentence instead of its raw text.
 */
export async function responseFromInvokeError(fnError: unknown): Promise<NotificationTestResponse> {
  const name = (fnError as { name?: string } | null)?.name;
  if (name === 'FunctionsFetchError') {
    return { success: false, error: NETWORK_MESSAGE, message: NETWORK_MESSAGE, code: 'network' };
  }

  const payload = await extractFunctionErrorPayload(fnError);
  if (payload && str(payload.error)) return normaliseTestResponse({ ...payload, success: false });

  const status = (fnError as { context?: { status?: number } } | null)?.context?.status;
  if (status === 404) {
    // The gateway's { code: "NOT_FOUND", message: "Requested function was not found" }.
    return { success: false, error: NOT_DEPLOYED_MESSAGE, message: NOT_DEPLOYED_MESSAGE, code: 'not_deployed' };
  }
  if (status === 401) {
    // The gateway rejected the session before the function ran (verify_jwt).
    return { success: false, error: SESSION_MESSAGE, message: SESSION_MESSAGE, code: 'invalid_session' };
  }
  return { success: false, error: GENERIC_MESSAGE, message: GENERIC_MESSAGE, code: 'request_failed' };
}

export interface UsePlatformNotificationTest {
  /** Sends one test. Always resolves; check `success` and show `message`. */
  sendTest: (req: NotificationTestRequest) => Promise<NotificationTestResponse>;
  isSending: boolean;
  /** The last reply, for showing the result inline under the button. */
  lastResult: NotificationTestResponse | null;
}

export function usePlatformNotificationTest(): UsePlatformNotificationTest {
  const [isSending, setIsSending] = useState(false);
  const [lastResult, setLastResult] = useState<NotificationTestResponse | null>(null);

  // Guards state writes after unmount: a test send is a multi-second round trip
  // the user can easily navigate away from (as in hooks/use-platform-push.ts).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const sendTest = useCallback(async (req: NotificationTestRequest): Promise<NotificationTestResponse> => {
    setIsSending(true);
    let result: NotificationTestResponse;
    try {
      const { data, error } = await supabase.functions.invoke(NOTIFICATION_TEST_V2_FUNCTION, {
        // scope last: a caller cannot turn this into a tenant send by accident.
        body: { ...req, scope: PLATFORM_TEST_SCOPE },
      });
      result = error ? await responseFromInvokeError(error) : normaliseTestResponse(data);
    } catch (err) {
      console.error('[platform-notification-test] send failed:', err);
      result = { success: false, error: GENERIC_MESSAGE, message: GENERIC_MESSAGE, code: 'request_failed' };
    } finally {
      if (mounted.current) setIsSending(false);
    }
    if (mounted.current) setLastResult(result);
    return result;
  }, []);

  return { sendTest, isSending, lastResult };
}
