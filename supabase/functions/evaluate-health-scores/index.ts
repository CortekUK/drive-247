// evaluate-health-scores
//
// Runs the atomic database evaluator and delivers pending tenant-retention
// alerts. Scheduled callers authenticate with x-platform-secret; the Super
// Admin "Run now" action authenticates with its user JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { sendResendEmail } from "../_shared/resend-service.ts";

const ADMIN_APP_URL = (Deno.env.get("ADMIN_APP_URL") ?? "https://admin.drive-247.com").replace(/\/$/, "");

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>\"]/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]!));

interface OutboxRow {
  id: string;
  run_id: string;
  incident_id: string;
  snapshot_id: string;
  kind: "transition" | "reminder" | "recovery";
  recipient_emails: string[];
}

interface AlertItem {
  outbox: OutboxRow;
  tenant: { id: string; company_name: string; slug: string };
  snapshot: {
    health_score: number | null;
    status: string;
    current_count: number;
    baseline_count: number;
    activity_change_percent: number | null;
    last_activity_at: string | null;
    subscription_status: string | null;
    subscription_cancel_at: string | null;
  };
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

function alertLabel(item: AlertItem): string {
  if (item.outbox.kind === "recovery") return "Recovering";
  if (item.snapshot.status === "dormant") return "Dormant";
  return item.outbox.kind === "reminder" ? "Still at risk" : "At risk";
}

function buildEmail(items: AlertItem[]): { subject: string; html: string } {
  const recoveries = items.filter((item) => item.outbox.kind === "recovery").length;
  const risks = items.length - recoveries;
  const subject = risks > 0
    ? `Health Alert — ${risks} tenant${risks === 1 ? "" : "s"} need attention`
    : `Health Update — ${recoveries} tenant${recoveries === 1 ? " is" : "s are"} recovering`;

  const rows = items.map((item) => {
    const score = item.snapshot.health_score == null ? "—" : `${item.snapshot.health_score}%`;
    const change = item.snapshot.activity_change_percent == null
      ? "No comparable baseline"
      : `${item.snapshot.activity_change_percent > 0 ? "+" : ""}${item.snapshot.activity_change_percent}%`;
    const cancellation = item.snapshot.subscription_cancel_at
      ? `<br/><strong style="color:#b45309;">Cancellation scheduled ${esc(formatDate(item.snapshot.subscription_cancel_at))}</strong>`
      : "";
    return `<tr>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;">
        <strong>${esc(item.tenant.company_name)}</strong><br/>
        <span style="color:#6b7280;font-size:12px;">${esc(item.tenant.slug)}</span>
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;">${esc(alertLabel(item))}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;">${esc(score)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.snapshot.current_count} / ${item.snapshot.baseline_count}<br/><span style="color:#6b7280;font-size:12px;">${esc(change)}</span></td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;">${esc(formatDate(item.snapshot.last_activity_at))}<br/><span style="color:#6b7280;font-size:12px;">${esc(item.snapshot.subscription_status ?? "No subscription row")}</span>${cancellation}</td>
    </tr>`;
  }).join("");

  return {
    subject,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#111827;">
      <div style="background:#111827;border-radius:10px;padding:20px 24px;color:#fff;">
        <h1 style="font-size:20px;margin:0;">Drive247 Tenant Health</h1>
        <p style="color:#d1d5db;margin:6px 0 0;">${risks} need attention · ${recoveries} recovering</p>
      </div>
      <p style="font-size:14px;line-height:1.5;">Activity is compared with each tenant's own preceding period. Review these tenants before engagement falls further.</p>
      <div style="overflow-x:auto;">
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="background:#f3f4f6;text-align:left;">
            <th style="padding:9px 8px;">Tenant</th><th style="padding:9px 8px;">Status</th>
            <th style="padding:9px 8px;text-align:center;">Score</th><th style="padding:9px 8px;text-align:center;">Current / Previous</th>
            <th style="padding:9px 8px;">Last activity</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p style="margin-top:22px;"><a href="${ADMIN_APP_URL}/admin/health-score" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Open Health Score</a></p>
      <p style="font-size:11px;color:#6b7280;">Manage the threshold, period and recipient list from the Health Score settings panel.</p>
    </div>`,
  };
}

async function authorize(req: Request, service: any): Promise<"scheduled" | "manual" | null> {
  // Some older pg_cron jobs authenticate with the service-role bearer rather
  // than x-platform-secret. Accept only an exact match with the server-side
  // secret; it is never exposed to the browser.
  const authHeader = req.headers.get("Authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) return "scheduled";

  const secret = req.headers.get("x-platform-secret");
  if (secret) {
    const { data, error } = await service.rpc("platform_verify_secret", { p_secret: secret });
    if (!error && data === true) return "scheduled";
  }

  if (!authHeader?.startsWith("Bearer ")) return null;

  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: { user }, error } = await authClient.auth.getUser(authHeader.slice(7));
  if (error || !user) return null;

  const { data: appUser } = await service
    .from("app_users")
    .select("is_super_admin")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return appUser?.is_super_admin === true ? "manual" : null;
}

async function loadPendingItems(service: any): Promise<AlertItem[]> {
  const { data: outboxRows, error } = await service
    .from("health_alert_outbox")
    .select("id, run_id, incident_id, snapshot_id, kind, recipient_emails")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  if (!outboxRows?.length) return [];

  const snapshotIds = [...new Set(outboxRows.map((row: OutboxRow) => row.snapshot_id))];
  const { data: snapshots, error: snapshotError } = await service
    .from("tenant_health_snapshots")
    .select("id, tenant_id, health_score, status, current_count, baseline_count, activity_change_percent, last_activity_at, subscription_status, subscription_cancel_at")
    .in("id", snapshotIds);
  if (snapshotError) throw snapshotError;

  const tenantIds = [...new Set((snapshots ?? []).map((row: any) => row.tenant_id))];
  const { data: tenants, error: tenantError } = await service
    .from("tenants")
    .select("id, company_name, slug")
    .in("id", tenantIds);
  if (tenantError) throw tenantError;

  const snapshotMap = new Map((snapshots ?? []).map((row: any) => [row.id, row]));
  const tenantMap = new Map((tenants ?? []).map((row: any) => [row.id, row]));

  return outboxRows.flatMap((outbox: OutboxRow) => {
    const snapshot: any = snapshotMap.get(outbox.snapshot_id);
    const tenant: any = snapshot ? tenantMap.get(snapshot.tenant_id) : null;
    return snapshot && tenant ? [{ outbox, snapshot, tenant } as AlertItem] : [];
  });
}

/**
 * Queue the current risk for recipients added after an incident opened. An
 * explicit manual "evaluate & notify" can also include previously notified
 * recipients; automatic runs retain the configured reminder cooldown.
 */
async function queueCurrentRiskRecipients(
  service: any,
  runId: string,
  includePreviouslyNotified = false,
): Promise<number> {
  const { data: recipientRows, error: recipientError } = await service
    .from("health_score_recipients")
    .select("email")
    .eq("enabled", true)
    .order("created_at", { ascending: true });
  if (recipientError) throw recipientError;

  const recipients = [...new Set((recipientRows ?? [])
    .map((row: any) => String(row.email ?? "").trim().toLowerCase())
    .filter(Boolean))];
  if (recipients.length === 0) return 0;

  const { data: snapshots, error: snapshotError } = await service
    .from("tenant_health_snapshots")
    .select("id, incident_id, status")
    .eq("run_id", runId)
    .in("status", ["at_risk", "dormant"])
    .not("incident_id", "is", null);
  if (snapshotError) throw snapshotError;
  if (!snapshots?.length) return 0;

  const incidentIds = [...new Set(snapshots.map((row: any) => row.incident_id))];
  const { data: incidents, error: incidentError } = await service
    .from("tenant_health_incidents")
    .select("id, state, snoozed_until")
    .in("id", incidentIds);
  if (incidentError) throw incidentError;

  const now = Date.now();
  const alertableIncidentIds = new Set((incidents ?? [])
    .filter((incident: any) =>
      incident.state !== "resolved" &&
      !(incident.state === "snoozed" && incident.snoozed_until && new Date(incident.snoozed_until).getTime() > now)
    )
    .map((incident: any) => incident.id));
  if (alertableIncidentIds.size === 0) return 0;

  const { data: outboxes, error: outboxError } = await service
    .from("health_alert_outbox")
    .select("id, incident_id, snapshot_id, kind, recipient_emails, status")
    .in("incident_id", [...alertableIncidentIds])
    .range(0, 9999);
  if (outboxError) throw outboxError;

  const outboxIncident = new Map((outboxes ?? []).map((row: any) => [row.id, row.incident_id]));
  const outboxIds = [...outboxIncident.keys()];
  let sentDeliveries: any[] = [];
  if (outboxIds.length > 0) {
    const { data, error } = await service
      .from("health_alert_deliveries")
      .select("outbox_id, recipient_email")
      .eq("status", "sent")
      .in("outbox_id", outboxIds)
      .range(0, 9999);
    if (error) throw error;
    sentDeliveries = data ?? [];
  }

  const notifiedByIncident = new Map<string, Set<string>>();
  for (const delivery of sentDeliveries) {
    const incidentId = outboxIncident.get(delivery.outbox_id);
    if (!incidentId) continue;
    const delivered = notifiedByIncident.get(incidentId) ?? new Set<string>();
    delivered.add(String(delivery.recipient_email ?? "").trim().toLowerCase());
    notifiedByIncident.set(incidentId, delivered);
  }

  let queued = 0;
  const queuedRows: any[] = [];
  for (const snapshot of snapshots) {
    if (!alertableIncidentIds.has(snapshot.incident_id)) continue;

    const currentOutboxes = (outboxes ?? []).filter((row: any) => row.snapshot_id === snapshot.id);
    const pendingRecipients = new Set(currentOutboxes
      .filter((row: any) => row.status === "pending")
      .flatMap((row: any) => row.recipient_emails ?? [])
      .map((email: string) => email.trim().toLowerCase())
      .filter(Boolean));
    const notified = notifiedByIncident.get(snapshot.incident_id) ?? new Set<string>();
    const missing = recipients.filter((email) =>
      !pendingRecipients.has(email) && (includePreviouslyNotified || !notified.has(email))
    );
    if (missing.length === 0) continue;

    const existingReminder = currentOutboxes.find((row: any) => row.kind === "reminder");
    const mergedRecipients = [...new Set([
      ...(existingReminder?.recipient_emails ?? []).map((email: string) => email.trim().toLowerCase()),
      ...missing,
    ].filter(Boolean))];
    queuedRows.push({
      id: existingReminder?.id ?? crypto.randomUUID(),
      run_id: runId,
      incident_id: snapshot.incident_id,
      snapshot_id: snapshot.id,
      kind: "reminder",
      recipient_emails: mergedRecipients,
      status: "pending",
      sent_at: null,
    });
    queued += missing.length;
  }

  if (queuedRows.length > 0) {
    const { error } = await service
      .from("health_alert_outbox")
      .upsert(queuedRows, { onConflict: "incident_id,snapshot_id,kind" });
    if (error) throw error;
  }

  return queued;
}

async function deliverPending(service: any): Promise<{ sent: number; failed: number; pending: number }> {
  const items = await loadPendingItems(service);
  if (items.length === 0) return { sent: 0, failed: 0, pending: 0 };

  const outboxIds = items.map((item) => item.outbox.id);
  const { data: existingDeliveryRows, error: existingDeliveryError } = await service
    .from("health_alert_deliveries")
    .select("id, outbox_id, recipient_email, status, attempt_count")
    .in("outbox_id", outboxIds)
    .range(0, 9999);
  if (existingDeliveryError) throw existingDeliveryError;

  const deliveryKey = (outboxId: string, recipient: string) => `${outboxId}:${recipient.trim().toLowerCase()}`;
  const deliveries = new Map((existingDeliveryRows ?? []).map((row: any) => [
    deliveryKey(row.outbox_id, row.recipient_email),
    row,
  ]));

  const recipientItems = new Map<string, AlertItem[]>();
  for (const item of items) {
    for (const rawEmail of item.outbox.recipient_emails ?? []) {
      const email = rawEmail.trim().toLowerCase();
      if (!email) continue;
      const list = recipientItems.get(email) ?? [];
      list.push(item);
      recipientItems.set(email, list);
    }
  }

  let sent = 0;
  let failed = 0;
  const notifiedIncidentIds = new Set<string>();
  for (const [recipient, recipientAlertItems] of recipientItems) {
    const unsentItems = recipientAlertItems.filter((item) =>
      deliveries.get(deliveryKey(item.outbox.id, recipient))?.status !== "sent"
    );
    if (unsentItems.length === 0) continue;

    const email = buildEmail(unsentItems);
    const result = await sendResendEmail({
      to: recipient,
      subject: email.subject,
      html: email.html,
      fromName: "Drive247 Tenant Health",
    });

    const attemptedAt = new Date().toISOString();
    const deliveryRows = unsentItems.map((item) => {
      const key = deliveryKey(item.outbox.id, recipient);
      const existing: any = deliveries.get(key);
      const row = {
        id: existing?.id ?? crypto.randomUUID(),
        outbox_id: item.outbox.id,
        recipient_email: recipient,
        status: result.success ? "sent" : "failed",
        provider_message_id: result.messageId ?? null,
        last_error: result.success ? null : (result.error ?? "Unknown email error").slice(0, 2000),
        sent_at: result.success ? attemptedAt : null,
        attempt_count: (existing?.attempt_count ?? 0) + 1,
      };
      deliveries.set(key, row);
      if (result.success) notifiedIncidentIds.add(item.outbox.incident_id);
      return row;
    });
    const { error: deliveryError } = await service
      .from("health_alert_deliveries")
      .upsert(deliveryRows, { onConflict: "outbox_id,recipient_email" });
    if (deliveryError) throw deliveryError;

    if (result.success) {
      sent += unsentItems.length;
    } else {
      failed += unsentItems.length;
    }
  }

  if (notifiedIncidentIds.size > 0) {
    const { error } = await service
      .from("tenant_health_incidents")
      .update({ last_notified_at: new Date().toISOString() })
      .in("id", [...notifiedIncidentIds]);
    if (error) throw error;
  }

  // An outbox row remains pending until every configured recipient succeeds.
  // This preserves partial delivery failures for retry without re-mailing the
  // recipients who already succeeded.
  const sentOutboxIds: string[] = [];
  const noRecipientOutboxIds: string[] = [];
  let pending = 0;
  for (const item of items) {
    const recipients = [...new Set((item.outbox.recipient_emails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean))];
    if (recipients.length === 0) {
      noRecipientOutboxIds.push(item.outbox.id);
      continue;
    }
    const allSuccessful = recipients.every((recipient) =>
      deliveries.get(deliveryKey(item.outbox.id, recipient))?.status === "sent"
    );
    if (allSuccessful) sentOutboxIds.push(item.outbox.id);
    else pending += 1;
  }

  if (noRecipientOutboxIds.length > 0) {
    const { error } = await service
      .from("health_alert_outbox")
      .update({ status: "no_recipients" })
      .in("id", noRecipientOutboxIds);
    if (error) throw error;
  }
  if (sentOutboxIds.length > 0) {
    const { error } = await service
      .from("health_alert_outbox")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .in("id", sentOutboxIds);
    if (error) throw error;
  }

  return { sent, failed, pending };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const caller = await authorize(req, service);
  if (!caller) return errorResponse("Unauthorized", 401);

  try {
    let body: {
      force?: boolean;
      notify?: boolean;
      notify_unnotified_recipients?: boolean;
      force_notify_current_risks?: boolean;
    } = {};
    try { body = await req.json(); } catch { /* empty scheduled body */ }

    const { data: evaluation, error: evaluationError } = await service.rpc("evaluate_tenant_health", {
      p_trigger: caller,
      // Both authorized caller types are trusted. Cron sends an empty body and
      // therefore remains deduplicated; explicit manual/service diagnostics can
      // request an immediate evaluation and notification verification.
      p_force: body.force === true,
      p_evaluated_at: new Date().toISOString(),
    });
    if (evaluationError) throw evaluationError;

    const shouldQueueCurrentRecipients = body.notify !== false && (
      body.notify_unnotified_recipients === true || body.force_notify_current_risks === true
    );
    const queuedCurrentRecipients = shouldQueueCurrentRecipients &&
        evaluation?.status === "succeeded" &&
        typeof evaluation?.run_id === "string"
      ? await queueCurrentRiskRecipients(
          service,
          evaluation.run_id,
          body.force_notify_current_risks === true,
        )
      : 0;

    const delivery = body.notify === false
      ? { sent: 0, failed: 0, pending: 0 }
      : await deliverPending(service);

    return jsonResponse({
      success: true,
      evaluation,
      delivery,
      queued_current_recipients: queuedCurrentRecipients,
      queued_unnotified_recipients: queuedCurrentRecipients,
    });
  } catch (error) {
    console.error("evaluate-health-scores failed", error);
    const message = error instanceof Error ? error.message : "Unexpected health evaluation error";
    // The atomic evaluator rolls its transaction back on failure. Persist a
    // separate failure heartbeat so the dashboard shows stale/broken data
    // instead of quietly keeping yesterday's green result.
    try {
      const { data: currentSettings } = await service
        .from("health_score_settings")
        .select("config_version")
        .eq("singleton", true)
        .maybeSingle();
      await service.from("health_score_runs").insert({
        run_key: `failed:${crypto.randomUUID()}`,
        trigger_type: caller,
        status: "failed",
        evaluated_at: new Date().toISOString(),
        settings_version: currentSettings?.config_version ?? 1,
        error_message: message.slice(0, 2000),
        completed_at: new Date().toISOString(),
      });
    } catch (recordError) {
      console.error("Could not persist Health Score failure heartbeat", recordError);
    }
    return errorResponse(message, 500);
  }
});
