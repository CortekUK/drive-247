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
