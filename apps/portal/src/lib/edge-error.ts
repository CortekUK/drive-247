// supabase.functions.invoke wraps non-2xx responses in FunctionsHttpError whose
// .message is always the generic "Edge Function returned a non-2xx status code";
// the edge function's real JSON error body hides behind error.context. Without
// unwrapping it, operators see an opaque failure and retry blindly (Kedic
// incident: 12 retries against a stale Stripe customer id, real error unseen).
export const extractFunctionError = async (error: unknown, fallback: string): Promise<string> => {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.clone === "function") {
    try {
      const body = await ctx.clone().json();
      const msg = body?.error || body?.message;
      if (typeof msg === "string" && msg.trim()) return msg;
    } catch { /* body wasn't JSON — fall through to fallback */ }
  }
  const m = (error as { message?: string })?.message;
  return m && m !== "Edge Function returned a non-2xx status code" ? m : fallback;
};

/**
 * Throwing wrapper around extractFunctionError, for call sites that just want
 * the server's message to reach their existing onError/toast handler.
 *
 * The Finance Sync hooks originally hand-rolled their own unwrapping instead of
 * using the helper above, and got the shape wrong:
 *
 *     const ctx = (error as { context?: { response?: Response } }).context;
 *     if (ctx?.response) { ... }        // always undefined
 *
 * `error.context` IS the Response — there is no `.response` on it — so that
 * branch never ran and every Finance Sync failure surfaced as the generic
 * "Edge Function returned a non-2xx status code", exactly the opacity
 * extractFunctionError was written to prevent. Real messages discarded this way
 * included "the provider is not configured on the server yet" and the super-admin
 * tenant-resolution errors.
 */
export const throwEdgeError = async (error: unknown): Promise<never> => {
  const message = await extractFunctionError(error, "");
  if (message) throw new Error(message);
  throw error;
};

/**
 * The edge function's error BODY, not just its message.
 *
 * extractFunctionError deliberately collapses a failure to one human string, but
 * the payments seam answers with a machine-readable shape —
 * `{ error: true, reason: "square_payment_already_settled", status, hint }` —
 * and some of those reasons are not failures the operator should be shown as
 * errors at all. Callers that need to branch on `reason` need the object.
 *
 * Returns null when the error carries no JSON body (a network failure, a
 * non-2xx with an HTML body), so a caller can fall back to the string form.
 */
export const extractFunctionErrorPayload = async (
  error: unknown,
): Promise<Record<string, unknown> | null> => {
  const ctx = (error as { context?: Response })?.context;
  if (!ctx || typeof ctx.clone !== "function") return null;
  try {
    const body = await ctx.clone().json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
