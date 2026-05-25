/**
 * revenue-optimiser-send-offers — Phase 4, Spec §16.
 *
 * Operator clicks "Apply price + send offers" on a combined recommendation.
 * Server-side flow:
 *
 *   1. Auth: resolve caller (JWT) → app_user; only tenant admin / head_admin
 *      (or super_admin) can dispatch offers.
 *   2. Load rec + verify tenant + status='pending' or 'pending_approval'.
 *   3. For each lead_id in `leadIds`:
 *      a. Ensure or create the lead's conversation (one per lead).
 *      b. Pick channel: caller-passed override, else sms if phone else email.
 *      c. Call existing send-lead-message edge fn with the message body
 *         (or templateId) to dispatch.
 *      d. Insert revenue_optimiser_offer_dispatches row (sent/failed).
 *   4. Mark rec status='applied_with_offers' (caller is expected to call
 *      revenue-optimiser-apply separately for the price change — this fn is
 *      strictly about offers).
 *
 * Idempotency: the UNIQUE constraint on (recommendation_id, lead_id) means
 * re-running this with the same leadIds is safe — duplicate rows just bail.
 */
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  recommendationId?: string;
  /** Subset of rec.matched_lead_ids that the operator approved. */
  leadIds?: string[];
  /** Custom message body (overrides templateId if both provided). */
  messageBody?: string;
  /** Optional template id from `lead_message_templates`. */
  templateId?: string;
  /** Channel override; otherwise per-lead resolution applies. */
  channel?: "sms" | "email" | "whatsapp";
}

interface RecRow {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  status: string;
  matched_lead_ids: string[] | null;
}

interface LeadRow {
  id: string;
  tenant_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  stage: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.recommendationId) return errorResponse("recommendationId is required");
    if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
      return errorResponse("leadIds[] is required (at least one)");
    }
    if (!body.messageBody && !body.templateId) {
      return errorResponse("messageBody or templateId is required");
    }

    // Resolve caller
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: userResp } = await userClient.auth.getUser();
    if (!userResp?.user) return errorResponse("Unauthorised", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: appUser } = await supabase
      .from("app_users")
      .select("id, tenant_id, role, is_super_admin")
      .eq("auth_user_id", userResp.user.id)
      .maybeSingle();
    if (!appUser) return errorResponse("App user not found", 403);
    const isSuper = appUser.is_super_admin === true;
    const isAdmin = ["admin", "head_admin"].includes(appUser.role ?? "");
    if (!isSuper && !isAdmin) {
      return errorResponse("Only admin or head_admin can send offers", 403);
    }

    // Load + validate rec
    const { data: rec } = await supabase
      .from("pricing_recommendations")
      .select("id, tenant_id, vehicle_id, status, matched_lead_ids")
      .eq("id", body.recommendationId)
      .maybeSingle();
    if (!rec) return errorResponse("Recommendation not found", 404);
    const r = rec as RecRow;
    if (!isSuper && r.tenant_id !== appUser.tenant_id) {
      return errorResponse("Not your tenant's recommendation", 403);
    }
    if (!["pending", "pending_approval", "applied", "applied_with_offers"].includes(r.status)) {
      return errorResponse(`Cannot send offers — recommendation is ${r.status}`, 409);
    }

    // Filter requested leadIds to those that were actually matched (defence in depth)
    const allowedSet = new Set(r.matched_lead_ids ?? []);
    const requestedIds = body.leadIds.filter((id) => allowedSet.has(id));
    if (requestedIds.length === 0) {
      return errorResponse("No leadIds in the request are part of this recommendation's matched_lead_ids", 400);
    }

    // Bulk-load lead rows
    const { data: leadsRaw } = await supabase
      .from("leads")
      .select("id, tenant_id, full_name, email, phone, stage")
      .in("id", requestedIds);
    const leads = (leadsRaw ?? []) as LeadRow[];
    const leadById = new Map(leads.map((l) => [l.id, l]));

    const summary = {
      recommendation_id: r.id,
      requested: requestedIds.length,
      dispatched: 0,
      failed: 0,
      skipped_no_channel: 0,
      already_dispatched: 0,
      results: [] as Array<{ lead_id: string; status: "sent" | "failed" | "skipped"; channel?: string; error?: string }>,
    };

    for (const leadId of requestedIds) {
      const lead = leadById.get(leadId);
      if (!lead) {
        summary.failed++;
        summary.results.push({ lead_id: leadId, status: "failed", error: "lead not found" });
        continue;
      }
      // Idempotency: skip if already dispatched
      const { data: existing } = await supabase
        .from("revenue_optimiser_offer_dispatches")
        .select("id, dispatch_status")
        .eq("recommendation_id", r.id)
        .eq("lead_id", leadId)
        .maybeSingle();
      if (existing) {
        summary.already_dispatched++;
        summary.results.push({ lead_id: leadId, status: "sent" });
        continue;
      }

      // Resolve channel
      const channel = body.channel
        ?? (lead.phone ? "sms" : lead.email ? "email" : null);
      if (!channel) {
        summary.skipped_no_channel++;
        summary.results.push({ lead_id: leadId, status: "skipped", error: "no contact channel" });
        continue;
      }

      // Ensure conversation
      const conversationId = await ensureConversation(supabase, r.tenant_id, leadId);

      // Queue dispatch row first so we can attribute conversions even if the
      // sender fails to update us later. dispatch_status will be 'queued'.
      const { data: queuedRow } = await supabase
        .from("revenue_optimiser_offer_dispatches")
        .insert({
          recommendation_id: r.id,
          tenant_id: r.tenant_id,
          lead_id: leadId,
          conversation_id: conversationId,
          channel,
          message_body: body.messageBody ?? null,
          template_id: body.templateId ?? null,
          dispatch_status: "queued",
        })
        .select("id")
        .single();

      try {
        const { error: sendErr } = await supabase.functions.invoke("send-lead-message", {
          body: {
            tenantId: r.tenant_id,
            leadId,
            conversationId,
            channel,
            body: body.messageBody,
            templateId: body.templateId,
          },
          headers: { Authorization: `Bearer ${jwt}` },
        });
        if (sendErr) throw sendErr;

        if (queuedRow) {
          await supabase
            .from("revenue_optimiser_offer_dispatches")
            .update({
              dispatch_status: "sent",
              dispatched_at: new Date().toISOString(),
            })
            .eq("id", queuedRow.id);
        }
        summary.dispatched++;
        summary.results.push({ lead_id: leadId, status: "sent", channel });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (queuedRow) {
          await supabase
            .from("revenue_optimiser_offer_dispatches")
            .update({ dispatch_status: "failed", dispatch_error: msg.slice(0, 500) })
            .eq("id", queuedRow.id);
        }
        summary.failed++;
        summary.results.push({ lead_id: leadId, status: "failed", channel, error: msg });
      }
    }

    // If we dispatched at least one offer AND the rec is currently pending
    // (or pending_approval), flip status to applied_with_offers. The price
    // apply itself is a separate call (revenue-optimiser-apply) — the operator
    // chooses to combine them, or send offers alone.
    if (summary.dispatched > 0 && ["pending", "pending_approval"].includes(r.status)) {
      await supabase
        .from("pricing_recommendations")
        .update({ status: "applied_with_offers" })
        .eq("id", r.id);
    }

    return jsonResponse({ ok: true, ...summary });
  } catch (err) {
    console.error("revenue-optimiser-send-offers error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});

/** Get-or-create the conversation row for a lead. */
async function ensureConversation(
  supabase: SupabaseClient,
  tenantId: string,
  leadId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (existing) return existing.id as string;
  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ tenant_id: tenantId, lead_id: leadId })
    .select("id")
    .single();
  if (error || !created) throw new Error(`conversation create failed: ${error?.message ?? "unknown"}`);
  return created.id as string;
}
