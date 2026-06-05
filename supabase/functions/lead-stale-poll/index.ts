/**
 * lead-stale-poll — Spec Section 17 Phase 1 (Hardcoded automations stand-in).
 *
 * Hourly cron. For each tenant with lead_management_enabled = true:
 *   - Find leads in active stages with no activity for ≥ 24h, ≥ 48h, ≥ auto-lost threshold.
 *   - Send reminder SMS via send-lead-message (idempotent: tracked by lead_activity).
 *   - Auto-transition leads past the auto-lost threshold to stage='lost'.
 *   - Sweep expired lead_offers → mark expired, emit lead.offer_expired.
 *
 * Idempotency:
 *   - 24h / 48h reminders use lead_activity event_type ('stale_24h_sent','stale_48h_sent')
 *     to guarantee at-most-once per lead per stale window.
 *   - Offer expiry uses lead_offers.status — only fires when row transitions to 'expired'.
 *
 * Scheduled via pg_cron at the DB layer (separate migration). This function reads
 * X-Cron-Secret to authorise cron callers.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const ACTIVE_REMINDER_STAGES = ["new", "contacted", "docs_requested"];
const ACTIVE_AUTO_LOST_STAGES = [
  "new",
  "contacted",
  "docs_requested",
  "docs_submitted",
  "docs_failed",
  "approved",
  "vehicle_offered",
];

interface TenantSettings {
  id: string;
  company_name: string | null;
  lead_management_enabled: boolean;
  lead_stale_threshold_hours: number;
  lead_auto_lost_threshold_hours: number;
}

interface LeadForPoll {
  id: string;
  tenant_id: string;
  full_name: string;
  stage: string;
  last_activity_at: string;
}

interface OfferToExpire {
  id: string;
  tenant_id: string;
  lead_id: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  // Lightweight auth: shared secret for cron callers
  const cronSecret = Deno.env.get("AUTOMATION_CRON_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (cronSecret && headerSecret !== cronSecret) {
    return errorResponse("Unauthorised", 401);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const now = Date.now();
    const summary = {
      tenants_processed: 0,
      reminders_24h_sent: 0,
      reminders_48h_sent: 0,
      auto_lost: 0,
      offers_expired: 0,
    };

    // 1. Active tenants only
    const { data: tenants } = await supabase
      .from("tenants")
      .select("id, company_name, lead_management_enabled, lead_stale_threshold_hours, lead_auto_lost_threshold_hours")
      .eq("lead_management_enabled", true);

    for (const t of ((tenants ?? []) as TenantSettings[])) {
      summary.tenants_processed++;
      const reminderHours = t.lead_stale_threshold_hours ?? 48;
      const autoLostHours = t.lead_auto_lost_threshold_hours ?? 168;

      const reminderCutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      const reminder48Cutoff = new Date(now - reminderHours * 60 * 60 * 1000).toISOString();
      const autoLostCutoff = new Date(now - autoLostHours * 60 * 60 * 1000).toISOString();

      // 2. 24h reminders
      const { data: due24 } = await supabase
        .from("leads")
        .select("id, tenant_id, full_name, stage, last_activity_at")
        .eq("tenant_id", t.id)
        .in("stage", ACTIVE_REMINDER_STAGES)
        .lte("last_activity_at", reminderCutoff)
        .gt("last_activity_at", reminder48Cutoff);

      for (const lead of ((due24 ?? []) as LeadForPoll[])) {
        const alreadySent = await wasEventEmitted(supabase, lead.id, "stale_24h_sent");
        if (alreadySent) continue;
        await sendReminder(supabase, t.id, lead.id, "reminder");
        await supabase.from("lead_activity").insert({
          tenant_id: t.id,
          lead_id: lead.id,
          actor_type: "system",
          event_type: "stale_24h_sent",
          payload: {},
        });
        await supabase.rpc("notify_automation_event", {
          p_event_type: "lead.stale_24h",
          p_tenant_id: t.id,
          p_entity_type: "lead",
          p_entity_id: lead.id,
          p_payload: { last_activity_at: lead.last_activity_at },
        });
        summary.reminders_24h_sent++;
      }

      // 3. 48h reminders (tenant-configurable threshold)
      const { data: due48 } = await supabase
        .from("leads")
        .select("id, tenant_id, full_name, stage, last_activity_at")
        .eq("tenant_id", t.id)
        .in("stage", ACTIVE_REMINDER_STAGES)
        .lte("last_activity_at", reminder48Cutoff)
        .gt("last_activity_at", autoLostCutoff);

      for (const lead of ((due48 ?? []) as LeadForPoll[])) {
        const alreadySent = await wasEventEmitted(supabase, lead.id, "stale_48h_sent");
        if (alreadySent) continue;
        await sendReminder(supabase, t.id, lead.id, "reminder");
        await supabase.from("lead_activity").insert({
          tenant_id: t.id,
          lead_id: lead.id,
          actor_type: "system",
          event_type: "stale_48h_sent",
          payload: {},
        });
        await supabase.rpc("notify_automation_event", {
          p_event_type: "lead.stale_48h",
          p_tenant_id: t.id,
          p_entity_type: "lead",
          p_entity_id: lead.id,
          p_payload: { last_activity_at: lead.last_activity_at },
        });
        summary.reminders_48h_sent++;
      }

      // 4. Auto-lost
      const { data: stale } = await supabase
        .from("leads")
        .select("id, tenant_id, full_name, stage, last_activity_at")
        .eq("tenant_id", t.id)
        .in("stage", ACTIVE_AUTO_LOST_STAGES)
        .lte("last_activity_at", autoLostCutoff);

      for (const lead of ((stale ?? []) as LeadForPoll[])) {
        await supabase.from("leads").update({ stage: "lost" }).eq("id", lead.id);
        await supabase.from("lead_activity").insert({
          tenant_id: t.id,
          lead_id: lead.id,
          actor_type: "system",
          event_type: "auto_lost",
          payload: { last_activity_at: lead.last_activity_at, threshold_hours: autoLostHours },
        });
        summary.auto_lost++;
      }

      // 5. Expire offers past expires_at
      const nowIso = new Date(now).toISOString();
      const { data: expired } = await supabase
        .from("lead_offers")
        .select("id, tenant_id, lead_id")
        .eq("tenant_id", t.id)
        .in("status", ["pending", "viewed"])
        .lte("expires_at", nowIso);

      for (const offer of ((expired ?? []) as OfferToExpire[])) {
        await supabase.from("lead_offers").update({ status: "expired" }).eq("id", offer.id);
        await supabase.rpc("notify_automation_event", {
          p_event_type: "lead.offer_expired",
          p_tenant_id: t.id,
          p_entity_type: "lead",
          p_entity_id: offer.lead_id,
          p_payload: { offer_id: offer.id },
        });
        await supabase.from("lead_activity").insert({
          tenant_id: t.id,
          lead_id: offer.lead_id,
          actor_type: "system",
          event_type: "offer_expired",
          payload: { offer_id: offer.id },
        });

        // Stage 5: transition lead to lost (Phase 2 will make this configurable to waitlist)
        await supabase
          .from("leads")
          .update({ stage: "lost" })
          .eq("id", offer.lead_id)
          .eq("stage", "vehicle_offered");

        summary.offers_expired++;
      }
    }

    return jsonResponse(summary);
  } catch (err) {
    console.error("lead-stale-poll error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});

interface SupabaseClient {
  from: (t: string) => {
    select: (cols: string, opts?: { count: "exact"; head: true }) => {
      eq: (col: string, v: unknown) => {
        eq: (col: string, v: unknown) => Promise<{ count: number | null }>;
      };
    };
  };
  functions: { invoke: (fn: string, opts: { body: unknown }) => Promise<unknown> };
}

async function wasEventEmitted(supabase: unknown, leadId: string, eventType: string): Promise<boolean> {
  const sb = supabase as SupabaseClient;
  const { count } = await sb
    .from("lead_activity")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
    .eq("event_type", eventType);
  return (count ?? 0) > 0;
}

async function sendReminder(supabase: unknown, tenantId: string, leadId: string, _category: string) {
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (c: string, v: unknown) => {
          eq: (c: string, v: unknown) => {
            eq: (c: string, v: unknown) => {
              eq: (c: string, v: unknown) => {
                maybeSingle: () => Promise<{ data: { id: string } | null }>;
              };
            };
          };
        };
      };
    };
    functions: { invoke: (fn: string, opts: { body: unknown }) => Promise<unknown> };
  };
  const { data: tpl } = await sb
    .from("lead_message_templates")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("category", "reminder")
    .eq("channel", "sms")
    .eq("is_default", true)
    .maybeSingle();
  const { data: conv } = await (sb.from("conversations") as unknown as {
    select: (s: string) => { eq: (c: string, v: unknown) => { maybeSingle: () => Promise<{ data: { id: string } | null }> } };
  })
    .select("id")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (!conv?.id || !tpl?.id) return;
  await sb.functions.invoke("send-lead-message", {
    body: {
      tenantId,
      leadId,
      conversationId: conv.id,
      channel: "sms",
      body: "",
      templateId: tpl.id,
      systemTriggered: true,
    },
  });
}
