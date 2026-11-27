// =============================================================================
// account-identity-check — feat-001 spec 07: Google on a portal account.
//
//   { action: "status" }                      → { password, google }
//   { action: "check_google", googleEmail? }  after the Google redirect (07.3–07.5)
//   { action: "unlink_google" }               "Disconnect Google" (07.6–07.8)
//   { action: "email_changed", newEmail? }    after a confirmed email change (07.9)
//   { action: "password_set" }                after the profile saves a password (07.2)
//
// Works on the caller's own account only (from their token). The decisions are
// in _shared/account-identity-rules.ts; this reads the state and acts on it.
//
// Why straight SQL on auth.identities: the admin API cannot list identities by
// email (07.5) or remove one identity, and the user's own unlink endpoint needs
// "manual linking" switched on. SUPABASE_DB_URL is injected by the edge runtime
// (as signout-tenant-users uses it).
// =============================================================================

import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { decide, PASSWORD_SET, type IdentityState } from "../_shared/account-identity-rules.ts";
import { PENDING_PASSWORD } from "../_shared/signup-account-rules.ts";

const LOG = "[account-identity-check]";

const answer = (status: number, code: string, error: string) => jsonResponse({ ok: false, code, error }, status);

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return answer(405, "METHOD_NOT_ALLOWED", "Use POST.");

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const { data: who } = bearer ? await supabase.auth.getUser(bearer) : { data: null };
    if (!who?.user) return answer(401, "UNAUTHORIZED", "Please sign in again.");
    const userId = who.user.id;

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action ?? "");
    const googleEmail = typeof body.googleEmail === "string" ? body.googleEmail.trim() : "";

    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) return answer(500, "UNAVAILABLE", "Something went wrong. Please try again.");
    sql = postgres(dbUrl, { prepare: false, max: 1 });

    // "Has a password" cannot be read from encrypted_password: Supabase stores a
    // random hash even for an account made without one. So: an email identity
    // (email-and-password signups and invited staff have one, Google-only
    // signups do not), or the marker the profile sets after a password is chosen
    // there (07.2), and never a signup whose stand-in is still waiting.
    const [account] = await sql`
      select u.email,
             exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email') as has_email_identity,
             coalesce((u.raw_app_meta_data ->> ${PASSWORD_SET})::boolean, false) as password_set,
             coalesce((u.raw_app_meta_data ->> ${PENDING_PASSWORD})::boolean, false) as password_pending
        from auth.users u where u.id = ${userId}`;
    if (!account) return answer(401, "UNAUTHORIZED", "Please sign in again.");

    const googles = await sql`
      select id::text as id, identity_data ->> 'email' as email
        from auth.identities where user_id = ${userId} and provider = 'google'
       order by created_at`;

    let ownedByOther = false;
    if (googleEmail) {
      const rows = await sql`
        select 1 from auth.identities
         where provider = 'google' and user_id <> ${userId}
           and lower(trim(identity_data ->> 'email')) = lower(${googleEmail})
         limit 1`;
      ownedByOther = rows.length > 0;
    }

    const state: IdentityState = {
      accountEmail: account.email ?? "",
      // A signup stand-in is a secret nobody knows: it is not a way to sign in.
      hasPassword: (account.has_email_identity || account.password_set) && !account.password_pending,
      googles: googles.map((g: { id: string; email: string | null }) => ({ id: g.id, email: g.email })),
      googleEmailOwnedByOther: ownedByOther,
    };
    // 07.2: the profile saved a password for an account that may have had
    // only Google. Taken on the person's word: getting it wrong could only lock
    // themselves out of Google, and "Email me a sign-in code" still lets them in.
    if (action === "password_set") {
      const { error } = await supabase.auth.admin.updateUserById(userId, { app_metadata: { [PASSWORD_SET]: true } });
      if (error) return answer(500, "UNAVAILABLE", "Something went wrong. Please try again.");
      return jsonResponse({ ok: true, password: true });
    }

    const decision = decide(action, state);

    if (decision.removeIdentityIds.length) {
      await sql`delete from auth.identities where user_id = ${userId} and id::text in ${sql(decision.removeIdentityIds)}`;
      console.log(`${LOG} ${userId} ${action}: removed ${decision.removeIdentityIds.length} Google identity(ies)`);
    }

    if (!decision.ok) return answer(decision.status, decision.code, decision.error);
    return jsonResponse({ ok: true, ...decision.body });
  } catch (err) {
    console.error(`${LOG} unexpected`, err);
    return answer(500, "UNAVAILABLE", "Something went wrong. Please try again.");
  } finally {
    await sql?.end({ timeout: 2 }).catch(() => {});
  }
});
