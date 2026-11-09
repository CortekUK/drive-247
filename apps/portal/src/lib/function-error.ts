/**
 * The server's own message for a failed `supabase.functions.invoke`.
 *
 * supabase-js wraps any non-2xx reply in a FunctionsHttpError whose `message`
 * is always "Edge Function returned a non-2xx status code". The real reason
 * ("Invalid tab keys: enquiries", "Manager role requires at least one
 * permission", ...) sits unread in `error.context`, the Response. Toasting the
 * wrapper's message tells the operator nothing, so a rejected save looks like
 * "it just spins and nothing happens" (Luxurious Car Rentals, Nov 2026).
 *
 * Reads the body (a clone, so the caller can still read it) and prefers its
 * `error` / `message` string; falls back to the error's own message when that
 * is not the generic wrapper text, then to the caller's wording.
 */
const GENERIC_WRAPPER = "Edge Function returned a non-2xx status code";

export async function functionErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  const ctx = (error as { context?: unknown } | null | undefined)?.context;
  if (ctx && typeof (ctx as Response).clone === "function") {
    try {
      const body = await (ctx as Response).clone().json();
      const msg = body?.error ?? body?.message;
      if (typeof msg === "string" && msg.trim()) return msg;
    } catch {
      // Not JSON (gateway HTML, empty body): fall through.
    }
  }
  const own =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (own && own !== GENERIC_WRAPPER) return own;
  return fallback;
}
