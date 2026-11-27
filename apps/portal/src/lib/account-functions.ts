import { supabase } from "@/integrations/supabase/client";

/** What the account functions answer (feat-001 specs 03 and 07). */
export type AccountAnswer = {
  ok?: boolean;
  code?: string;
  error?: string;
  attemptsRemaining?: number;
  retryAfterSeconds?: number;
  email?: string;
  delivered?: boolean;
  password?: boolean;
  google?: string | null;
  googleRemoved?: boolean;
};

export type AccountFunction = "signup-verify-email" | "signup-set-password" | "account-identity-check";

/**
 * Local testing only: `NEXT_PUBLIC_SIGNUP_FUNCTIONS_URL` in apps/portal/.env.local
 * points these calls at functions served on this machine (Deno), so they can be
 * tested before anything is deployed. `NODE_ENV` folds to "production" in every
 * build, so this branch does not exist outside `next dev`.
 */
const LOCAL_FUNCTIONS_URL =
  process.env.NODE_ENV === "development" ? process.env.NEXT_PUBLIC_SIGNUP_FUNCTIONS_URL || "" : "";

/** Calls one of the account functions and returns its JSON, even on a refusal. */
export async function callAccountFn(name: AccountFunction, body: Record<string, unknown>): Promise<AccountAnswer> {
  if (LOCAL_FUNCTIONS_URL) {
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch(`${LOCAL_FUNCTIONS_URL.replace(/\/+$/, "")}/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res) return { ok: false, code: "UNAVAILABLE", error: "Could not reach the local functions." };
    return (await res.json().catch(() => ({ ok: false, code: "UNAVAILABLE" }))) as AccountAnswer;
  }
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return (data ?? {}) as AccountAnswer;
  const response = (error as { context?: Response }).context;
  if (response && typeof response.json === "function") {
    try {
      return (await response.clone().json()) as AccountAnswer;
    } catch {
      /* not JSON */
    }
  }
  return { ok: false, code: "UNAVAILABLE", error: "Something went wrong. Please try again." };
}
