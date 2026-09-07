"use client";

// ── Twilio Messages — reads, writes and probes ────────────────────────────────
//
// The data half of `twilio-messages.tsx`. Split out so the panel file stays
// readable, and named with the panel's own prefix because seven panels are
// being written in parallel and must not collide (V2_PLAN §2).
//
// ⚠️ ISOLATION. RLS is OFF on `chat_channels` and `chat_channel_messages`
// (V2_PLAN §5), so the `tenant_id` filters below are the ONLY thing keeping one
// operator's message history out of another's screen. Every query here either
// filters on `tenant_id` / `id` directly, or filters on a set of primary keys
// that a tenant-filtered query produced. Do not "simplify" either away.
//
// WHAT SENDS SMS TODAY, since everything here is shaped by it:
//   `_shared/twilio-sms-client.ts` → `sendTenantSMS()` reads
//   `tenants.twilio_account_sid` + `twilio_auth_token`, authenticates to Twilio
//   with HTTP Basic, and posts to `/Messages.json` with `From` = the tenant's
//   own number. The API key pair (`twilio_api_key_sid` / `_secret`) is used
//   ONLY by `manage-twilio-voice` for Voice access tokens, and
//   `twilio_messaging_service_sid` is dead weight — it is null for all 57
//   tenants and no code path reads it. So this panel collects an Account SID
//   and an Auth Token, and nothing else.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";

/* ─────────────────────────────── keys ───────────────────────────────────── */

export const snapshotKey = (tenantId: string) =>
  ["twilio-messages", "snapshot", tenantId] as const;

export const deliveryKey = (tenantId: string) =>
  ["twilio-messages", "delivery", tenantId] as const;

/* ────────────────────────── stored connection ───────────────────────────── */

export type TwilioSnapshot = {
  /** Present ⇒ credentials are stored. The auth token itself is never read. */
  accountSid: string | null;
  phoneNumber: string | null;
  phoneNumberSid: string | null;
  /** Always null in production. Kept visible so a stray value cannot hide. */
  messagingServiceSid: string | null;
  /** `integration_twilio_sms` — the master switch every sender checks. */
  enabled: boolean;
  /** Stamped by `manage-twilio-connection` at connect time, and only then. */
  verifiedAt: string | null;
};

/**
 * The stored connection, straight from `tenants`.
 *
 * A direct PostgREST read rather than the `get-status` action of
 * `manage-twilio-connection`, because that action makes a live Twilio API call
 * on every invocation and the board renders a status chip for every card on
 * first paint. The live call is still available — as an explicit probe the
 * operator asks for (`useTwilioProbe`), which is where a network round trip
 * belongs.
 *
 * `twilio_auth_token` is deliberately absent from the select. `authenticated`
 * still holds a table-level SELECT on `tenants` (only `anon` was cut back in
 * 20260723090000), so asking for it would succeed — and put a live Twilio
 * password in a browser cache. The panel shows that a credential is set, never
 * what it is.
 */
export function useTwilioSnapshot(tenantId: string) {
  return useQuery({
    queryKey: snapshotKey(tenantId),
    queryFn: async (): Promise<TwilioSnapshot> => {
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "integration_twilio_sms, twilio_account_sid, twilio_phone_number, twilio_phone_number_sid, twilio_messaging_service_sid, twilio_connection_verified_at",
        )
        .eq("id", tenantId) // ← isolation
        .maybeSingle();

      if (error) throw error;
      // A tenant that does not resolve is a failed read, not a disconnected
      // integration. Throwing routes it to PanelError instead of inviting a
      // reconnect that would overwrite whatever is actually stored.
      if (!data) throw new Error("Tenant row not found");

      const t = data as Record<string, any>;
      return {
        accountSid: t.twilio_account_sid ?? null,
        phoneNumber: t.twilio_phone_number ?? null,
        phoneNumberSid: t.twilio_phone_number_sid ?? null,
        messagingServiceSid: t.twilio_messaging_service_sid ?? null,
        enabled: !!t.integration_twilio_sms,
        verifiedAt: t.twilio_connection_verified_at ?? null,
      };
    },
    enabled: !!tenantId,
    staleTime: 30_000,
  });
}

/* ───────────────────────── delivery / registration ──────────────────────── */

/**
 * Twilio delivery error codes we can explain, and whether the explanation is a
 * carrier *registration* problem.
 *
 * Registration codes are the ones that matter most here: every credential can
 * be correct and every message still be dropped by US carriers because the
 * number is not registered for A2P 10DLC. 30034 has fired 57 times in
 * production, so this is not a hypothetical.
 */
const ERROR_CODES: Record<string, { registration: boolean; text: string }> = {
  "30034": {
    registration: true,
    text: "This number is not registered for A2P 10DLC, so US carriers are rejecting messages sent from it.",
  },
  "30032": {
    registration: true,
    text: "This toll-free number is not verified, so US carriers are rejecting messages sent from it.",
  },
  "30007": {
    registration: true,
    text: "The carrier filtered these messages as spam — usually missing or incomplete campaign registration.",
  },
  "21408": {
    registration: false,
    text: "Your Twilio account is not permitted to send to this destination country.",
  },
  "21610": {
    registration: false,
    text: "The recipient replied STOP. Twilio blocks further messages to them until they reply START.",
  },
  "21211": { registration: false, text: "The destination number was not a valid phone number." },
  "30003": { registration: false, text: "The handset was unreachable — switched off, out of coverage, or blocking." },
  "30005": { registration: false, text: "The destination number is unknown or no longer in service." },
  "30006": { registration: false, text: "The destination is a landline or a carrier that cannot receive SMS." },
};

export function explainErrorCode(code: string) {
  return ERROR_CODES[code] ?? {
    registration: false,
    text: "Twilio rejected these messages. Look the code up in your Twilio console for the full reason.",
  };
}

export type SmsDelivery = {
  /** How many outbound chat SMS the figures below are drawn from. */
  sampled: number;
  delivered: number;
  failed: number;
  pending: number;
  oldestAt: string | null;
  newestAt: string | null;
  newestFailureAt: string | null;
  /**
   * The most recent message Twilio has settled was a failure — i.e. the
   * integration is broken NOW, not was broken once.
   *
   * Deliberately the newest settled outcome rather than "any failure in the
   * last N messages" or "any failure in the last N days". Both of those pin a
   * card at "Carrier blocked" for months after the operator has fixed their
   * registration, because a low-volume tenant's window never rolls over — one
   * live tenant has exactly four outbound chat messages, three of them 30034
   * rejections from May and a successful one from August. This rule clears
   * itself the moment a message gets through, and the historic failures stay
   * visible in the counts below where they belong.
   *
   * `queued` is skipped, not counted as success: a message waiting on a
   * delivery receipt is not evidence of anything yet.
   */
  failingNow: boolean;
  /** Distinct Twilio error codes behind the failures, newest first. */
  reasons: { code: string; count: number }[];
  /**
   * True when messages failed but Twilio's reason codes could not be read.
   * `sms_message_log` has RLS ON with a policy keyed on the caller's
   * `app_users.tenant_id`, and super admins carry `tenant_id = NULL` — so for a
   * super admin the reasons come back empty for every tenant. Empty must
   * therefore never be reported as "no problems found".
   */
  reasonsUnavailable: boolean;
};

/** Messages read for the figures. Small: the whole table holds ~230 rows. */
const SAMPLE_SIZE = 50;

const isFailed = (s: string | null) => s === "failed" || s === "undelivered";
const isDelivered = (s: string | null) => s === "delivered" || s === "sent";
/** Twilio has reached a verdict. `queued` and a missing status have not. */
const isSettled = (s: string | null) => isFailed(s) || isDelivered(s);

/**
 * What actually happened to this tenant's outbound SMS.
 *
 * This is the only registration signal we have. The `twilio_brand_*` and
 * `twilio_campaign_*` columns that once cached A2P state were dropped in
 * 20260410120001 when the product moved to bring-your-own Twilio — tenants now
 * register in their own console and we never learn the outcome. What we do
 * hold is Twilio's own verdict on each message, written by the
 * `twilio-sms-status` webhook, and a run of 30034s is exactly what an
 * unregistered campaign looks like from here.
 *
 * SCOPE, and it is a real limit worth stating on screen: only two-way chat SMS
 * lands in `chat_channel_messages`. The 16 `notify-*` senders call
 * `sendTenantSMS` directly and write no message row, so their status callbacks
 * arrive with `message_id = null` (67 of 131 log rows today) and cannot be
 * attributed to any tenant at all. These figures therefore describe chat, and
 * the panel says so rather than implying full coverage.
 */
export function useSmsDelivery(tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: deliveryKey(tenantId),
    queryFn: async (): Promise<SmsDelivery> => {
      // `chat_channels!inner(tenant_id)` + the eq below is the tenant filter.
      // `sender_type = 'tenant'` keeps INBOUND messages out: `twilio-inbound-sms`
      // writes them with a hardcoded `external_status = 'delivered'`, which
      // would otherwise pad the delivered count with messages we never sent.
      const { data, error } = await supabaseUntyped
        .from("chat_channel_messages")
        .select("id, external_status, created_at, chat_channels!inner(tenant_id)")
        .eq("chat_channels.tenant_id", tenantId) // ← isolation
        .eq("channel", "sms")
        .eq("sender_type", "tenant")
        .not("external_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(SAMPLE_SIZE);

      if (error) throw error;

      const rows: { id: number; external_status: string | null; created_at: string }[] =
        data ?? [];

      const failedRows = rows.filter((r) => isFailed(r.external_status));

      let reasons: { code: string; count: number }[] = [];
      let reasonsUnavailable = false;

      if (failedRows.length > 0) {
        // Filtered by primary keys that the tenant-scoped query above produced,
        // so this inherits its isolation. `sms_message_log` carries no
        // tenant_id of its own — it reaches a tenant only through this join.
        const { data: logs, error: logError } = await supabaseUntyped
          .from("sms_message_log")
          .select("message_id, error_code")
          .in("message_id", failedRows.map((r) => r.id))
          .not("error_code", "is", null);

        if (logError || !logs || logs.length === 0) {
          reasonsUnavailable = true;
        } else {
          const counts = new Map<string, number>();
          for (const l of logs as { error_code: string }[]) {
            counts.set(l.error_code, (counts.get(l.error_code) ?? 0) + 1);
          }
          reasons = [...counts.entries()]
            .map(([code, count]) => ({ code, count }))
            .sort((a, b) => b.count - a.count);
        }
      }

      return {
        sampled: rows.length,
        delivered: rows.filter((r) => isDelivered(r.external_status)).length,
        failed: failedRows.length,
        pending: rows.filter(
          (r) => !isDelivered(r.external_status) && !isFailed(r.external_status),
        ).length,
        oldestAt: rows.length ? rows[rows.length - 1].created_at : null,
        newestAt: rows.length ? rows[0].created_at : null,
        newestFailureAt: failedRows.length ? failedRows[0].created_at : null,
        // `rows` is newest-first, so the first settled entry is the last thing
        // Twilio actually told us about this tenant's sending.
        failingNow: isFailed(
          rows.find((r) => isSettled(r.external_status))?.external_status ?? null,
        ),
        reasons,
        reasonsUnavailable,
      };
    },
    enabled: !!tenantId && enabled,
    // Long, because this feeds a chip painted on every board render and the
    // underlying rows change at the speed an operator sends messages.
    staleTime: 5 * 60_000,
  });
}

/**
 * Does this delivery picture point at a carrier-registration problem?
 *
 * Deliberately FALSE when the reason codes could not be read. Messages failing
 * with an unknown cause is still `attention` — the caller reaches that through
 * `failingNow` — but naming it "carrier blocked" on a chip while the panel below
 * says the cause is unreadable would make the two disagree, and the chip would
 * be the one making it up.
 */
export function hasRegistrationProblem(d: SmsDelivery | undefined): boolean {
  if (!d || !d.failingNow || d.reasonsUnavailable) return false;
  return d.reasons.some((r) => explainErrorCode(r.code).registration);
}

/* ──────────────────────────── edge function ─────────────────────────────── */

/**
 * `supabase.functions.invoke` collapses every non-2xx into the same opaque
 * "Edge Function returned a non-2xx status code", discarding the body. Twilio's
 * own refusals ("Phone number ... was not found on this Twilio account",
 * "Invalid Twilio credentials: Authenticate") arrive in that body and are the
 * entire value of the Connect step, so they are dug back out here.
 */
async function invokeTwilio(action: string, params: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("manage-twilio-connection", {
    body: { action, ...params },
  });

  if (error) {
    const ctx = (error as { context?: { body?: ReadableStream<Uint8Array> } }).context;
    if (ctx?.body) {
      try {
        const chunk = await ctx.body.getReader().read();
        const parsed = JSON.parse(new TextDecoder().decode(chunk.value));
        if (parsed?.error) throw new Error(parsed.error);
      } catch (parseErr) {
        // Re-throw a real message we recovered; swallow a genuine parse failure
        // and fall through to the generic error below.
        if (parseErr instanceof Error && parseErr.message !== (error as Error).message) {
          throw parseErr;
        }
      }
    }
    throw error;
  }

  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data;
}

/**
 * A super admin's `app_users.tenant_id` is NULL, so `manage-twilio-connection`
 * cannot infer which tenant they mean and refuses without an explicit id. Every
 * call therefore carries one. For a normal operator the server ignores it and
 * uses their own `app_users.tenant_id`, so this cannot be used to reach across
 * tenants.
 */
const withTenant = (tenantId: string, params: Record<string, unknown> = {}) => ({
  tenantId,
  ...params,
});

export type TwilioProbe = {
  /** Twilio answered and confirmed the stored number on the stored account. */
  confirmed: boolean;
  phoneNumber: string | null;
  capabilities: { sms: boolean; voice: boolean; mms: boolean } | null;
  checkedAt: number;
};

/**
 * Ask Twilio, right now, whether the stored credentials still work.
 *
 * `get-status` looks like a plain database read and is not: when credentials
 * are present it calls Twilio's `/IncomingPhoneNumbers` endpoint and returns
 * the number's capabilities. So `capabilities === null` on a connected tenant
 * means Twilio would not confirm the number — a revoked auth token, a released
 * number, or a suspended account. That is the closest thing to a health check
 * the platform has.
 *
 * It does NOT refresh `twilio_connection_verified_at`; only `connect` writes
 * that column. The panel keeps the two facts visually separate rather than
 * passing this off as a re-verification.
 */
export function useTwilioProbe(tenantId: string) {
  return useMutation({
    mutationFn: async (): Promise<TwilioProbe> => {
      const data = (await invokeTwilio("get-status", withTenant(tenantId))) as {
        phoneNumber: string | null;
        capabilities: TwilioProbe["capabilities"];
      };
      return {
        confirmed: !!data?.capabilities,
        phoneNumber: data?.phoneNumber ?? null,
        capabilities: data?.capabilities ?? null,
        checkedAt: Date.now(),
      };
    },
  });
}

export type ConnectInput = {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
};

/**
 * Save and verify the tenant's Twilio credentials.
 *
 * The edge function does four things in order and stops at the first failure:
 * validates the credentials against Twilio, confirms the number exists on that
 * account and supports SMS, points the inbound and delivery-status webhooks at
 * our functions, then writes the row and stamps
 * `twilio_connection_verified_at`. Nothing is stored until Twilio has agreed,
 * so a failed attempt leaves an existing connection untouched.
 */
export function useTwilioConnect(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ConnectInput) =>
      (await invokeTwilio("connect", withTenant(tenantId, input))) as {
        friendlyName?: string;
        phoneNumber?: string;
      },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: snapshotKey(tenantId) });
      qc.invalidateQueries({ queryKey: deliveryKey(tenantId) });
    },
  });
}

/** A real SMS, from the tenant's number, billed to the tenant's Twilio account. */
export function useTwilioTest(tenantId: string) {
  return useMutation({
    mutationFn: async (input: { to: string; message?: string }) => {
      // A send that Twilio refuses comes back 200 with `{ success: false }`,
      // because the edge function returns the client's result verbatim. Without
      // this the UI would report every rejected message as sent.
      const data = (await invokeTwilio("test", withTenant(tenantId, input))) as {
        success?: boolean;
        messageId?: string;
        error?: string;
      };
      if (!data?.success) throw new Error(data?.error || "Twilio did not accept the message.");
      return data;
    },
  });
}

/**
 * Forget the credentials. The tenant's Twilio account, number and message
 * history are untouched — we only stop holding the keys to them.
 */
export function useTwilioDisconnect(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => invokeTwilio("disconnect", withTenant(tenantId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: snapshotKey(tenantId) });
      qc.invalidateQueries({ queryKey: deliveryKey(tenantId) });
    },
  });
}

/**
 * The master switch, `tenants.integration_twilio_sms`.
 *
 * Written directly rather than through an edge function because
 * `manage-twilio-connection` only flips it as a side effect of connecting and
 * disconnecting, and pausing SMS must not destroy the credentials. `tenants` is
 * one of the few tables with RLS actually ON, and `tenants_update_own_or_super`
 * limits an operator to their own row — but the `.eq('id')` below is what this
 * code relies on, not that policy.
 */
export function useTwilioSetEnabled(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase
        .from("tenants")
        .update({ integration_twilio_sms: next })
        .eq("id", tenantId); // ← isolation
      if (error) throw error;
      return next;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: snapshotKey(tenantId) });
    },
  });
}
