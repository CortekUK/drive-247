// =============================================================================
// signup-set-password — feat-001 spec 03: the second half of the portal's
// window. A person from the 3-step signup chooses their first password here,
// after proving their email.
//
//   { password }   8+ characters, a letter and a number (signup-begin's rule)
//
// Works on the caller's own account only (from their token). Once a password
// is chosen, changing it is the profile panel's job (a code first), not this.
// =============================================================================

import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { isEmailPending, isPasswordPending, passwordProblem, PENDING_PASSWORD } from "../_shared/signup-account-rules.ts";

const LOG = "[signup-set-password]";

const answer = (status: number, code: string, error: string) => jsonResponse({ ok: false, code, error }, status);

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return answer(405, "METHOD_NOT_ALLOWED", "Use POST.");

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const { data: who } = bearer ? await supabase.auth.getUser(bearer) : { data: null };
    if (!who?.user) return answer(401, "UNAUTHORIZED", "Please sign in again.");
    const { data: fresh, error: readError } = await supabase.auth.admin.getUserById(who.user.id);
    if (readError || !fresh?.user) return answer(401, "UNAUTHORIZED", "Please sign in again.");
    const user = fresh.user;
    const appMeta = (user.app_metadata ?? {}) as Record<string, unknown>;

    // The code comes first (spec 03.2): a password on an unproved address would
    // let someone who typed a stranger's email keep the account.
    if (isEmailPending(appMeta)) return answer(400, "EMAIL_NOT_CONFIRMED", "Confirm your email first.");
    if (!isPasswordPending(appMeta)) return answer(400, "NOT_PENDING", "You already have a password. Change it from your profile.");

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const problem = passwordProblem(body.password);
    if (problem) return answer(400, "PASSWORD_RULE", problem);

    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password: String(body.password),
      app_metadata: { [PENDING_PASSWORD]: false },
    });
    if (error) {
      console.error(`${LOG} could not set the password for ${user.id}: ${error.message}`);
      return answer(500, "UNAVAILABLE", "We could not save your password. Please try again.");
    }
    console.log(`${LOG} ${user.id} chose a password`);
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error(`${LOG} unexpected`, err);
    return answer(500, "UNAVAILABLE", "Something went wrong. Please try again.");
  }
});
