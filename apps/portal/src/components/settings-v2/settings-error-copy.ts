/**
 * v2 Settings: the operator-facing copy for a failed save. A plain module (no
 * React) so hooks can use it for their toasts without pulling in the kit's
 * components. `section-states.tsx` re-exports it, so callers import it from
 * either place.
 */

/**
 * A short reason for a failed save, in the operator's words. Database and
 * transport internals ("violates check constraint", "duplicate key", SQL
 * codes) are translated; a plain human message (e.g. from an edge function)
 * passes through, capped at 140 characters. The form keeps its values either
 * way, so every branch can promise that.
 */
export function describeSaveError(error: unknown): string {
  const msg =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const clean = msg.replace(/\s+/g, " ").trim();
  const text = clean.toLowerCase();

  if (!clean && !code) return "Your changes are still here. Try again.";
  if ((typeof navigator !== "undefined" && navigator.onLine === false) || text.includes("failed to fetch") || text.includes("network")) {
    return "We couldn't reach the server. Your changes are still here.";
  }
  // supabase-js wraps every edge-function transport failure in one generic
  // sentence ("Edge Function returned a non-2xx status code", "Failed to send a
  // request to the Edge Function", "Relay Error invoking the Edge Function").
  if (text.includes("edge function") || text.includes("non-2xx")) {
    return "The server couldn't save this right now. Your changes are still here. Try again.";
  }
  if (code === "23505" || text.includes("duplicate key") || text.includes("already exists")) {
    return "Something with that name already exists. Use a different one.";
  }
  if (code === "42501" || text.includes("permission denied") || text.includes("row-level security") || text.includes("not authorized")) {
    return "You don't have permission to change this. Ask an admin.";
  }
  if (
    /^(23|22|42|P0)/.test(code) ||
    /violates|constraint|null value in column|invalid input syntax|out of range|relation "|column "|syntax error/.test(text)
  ) {
    return "One of the values isn't allowed. Check the fields and try again.";
  }
  return clean.length > 140 ? `${clean.slice(0, 137)}…` : clean;
}
