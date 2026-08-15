import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const aBytes = new Uint8Array(a);
  const bBytes = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < aBytes.length; index += 1) {
    difference |= aBytes[index] ^ bBytes[index];
  }
  return difference === 0 && left.length === right.length;
}

async function authorized(request: Request, serviceRoleKey: string): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  return Boolean(
    authorization?.startsWith("Bearer ") &&
      (await constantTimeEqual(authorization.slice(7), serviceRoleKey))
  );
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return response({ error: "Unavailable" }, 500);
  if (!(await authorized(request, serviceRoleKey))) {
    return response({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const staleCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { error: recoveryError } = await supabase
    .from("strategy_call_emails")
    .update({ delivery_status: "failed", last_error: "stale_send_recovered" })
    .eq("delivery_status", "sending")
    .lt("last_attempt_at", staleCutoff);
  if (recoveryError) return response({ error: "Dispatcher unavailable" }, 500);

  const { data: jobs, error: jobsError } = await supabase
    .from("strategy_call_emails")
    .select("id")
    .in("delivery_status", ["pending", "failed"])
    .is("sent_at", null)
    .lt("attempt_count", 5)
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(50);
  if (jobsError) return response({ error: "Dispatcher unavailable" }, 500);

  let requested = 0;
  let failed = 0;
  // Small batches keep the cron invocation bounded while the email function's
  // conditional DB claim provides concurrency safety across overlapping runs.
  for (let offset = 0; offset < (jobs?.length ?? 0); offset += 5) {
    const batch = (jobs ?? []).slice(offset, offset + 5);
    const results = await Promise.all(
      batch.map(async (job) => {
        try {
          const result = await fetch(
            `${supabaseUrl}/functions/v1/send-strategy-call-email`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${serviceRoleKey}`,
                apikey: serviceRoleKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ email_id: job.id }),
            }
          );
          return result.ok;
        } catch {
          return false;
        }
      })
    );
    requested += results.length;
    failed += results.filter((ok) => !ok).length;
  }

  console.log("strategy_call_email_dispatch_complete", {
    requested,
    failed,
  });
  return response({ success: failed === 0, requested, failed }, failed ? 500 : 200);
});
