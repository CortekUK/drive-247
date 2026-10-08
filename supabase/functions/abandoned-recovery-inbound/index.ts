// abandoned-recovery-inbound — PUBLIC (verify_jwt = false), authenticated by
// signature. A renter replied to their recovery email with a question.
//
// The recovery email's Reply-To is reply+<recovery_token>@<ABANDONED_RECOVERY_REPLY_DOMAIN>.
// Mail to that domain reaches this function in one of two shapes:
//   - Resend inbound webhook ("email.received"), signed with Svix —
//     RESEND_INBOUND_WEBHOOK_SECRET (whsec_…); the body is fetched from Resend
//   - a normalised envelope { from, to, subject, text, messageId? } from any
//     other mail router, with header x-inbound-secret = ABANDONED_RECOVERY_INBOUND_SECRET
// With neither secret configured, everything is refused: an unauthenticated
// endpoint that makes us send AI email would be a spam relay.
//
// Then: the sender must be the renter on file for that token. The question is
// answered by answerFromFaqs — ONLY from the tenant's approved FAQs. Anything
// the FAQs do not cover gets a hand-off reply, and the question is forwarded to
// the tenant so a person really does pick it up. Max 5 AI answers per session.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  answerFromFaqs,
  renderRecoveryHtml,
  replyToFor,
  sendTenantEmail,
  stripQuotedReply,
  tenantName,
  unsubscribeUrl,
  type RecoveryTenant,
} from "../_shared/abandoned-recovery.ts";

const MAX_ANSWERS_PER_SESSION = 5;
const TENANT_COLS =
  "id, slug, company_name, app_name, logo_url, primary_color, accent_color, contact_email, contact_phone, custom_booking_domain";
const TOKEN_RE = /reply\+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/i;

function extractEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Svix signature check (what Resend webhooks use). */
async function verifySvix(req: Request, raw: string, secret: string): Promise<boolean> {
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sigs = req.headers.get("svix-signature");
  if (!id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${raw}`)));
  const expected = btoa(String.fromCharCode(...mac));
  return sigs.split(" ").some((s) => {
    const [, sig] = s.split(",");
    return !!sig && timingSafeEqual(sig, expected);
  });
}

interface Inbound {
  from: string;
  to: string[];
  subject: string;
  text: string;
  messageId: string | null;
}

async function readResendEmail(data: Record<string, any>): Promise<Inbound | null> {
  let text: string = typeof data.text === "string" ? data.text : "";
  let html: string = typeof data.html === "string" ? data.html : "";
  let messageId: string | null = data.message_id ?? null;
  if (!text && !html && data.email_id) {
    const res = await fetch(`https://api.resend.com/emails/receiving/${data.email_id}`, {
      headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}` },
    });
    if (res.ok) {
      const full = await res.json();
      text = full.text ?? "";
      html = full.html ?? "";
      messageId = messageId ?? full.message_id ?? full.headers?.["message-id"] ?? null;
    }
  }
  if (!text && html) text = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
  if (!data.from || !text) return null;
  const to = Array.isArray(data.to) ? data.to.map(String) : [String(data.to ?? "")];
  return { from: String(data.from), to, subject: String(data.subject ?? ""), text, messageId };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const raw = await req.text();
    const svixSecret = Deno.env.get("RESEND_INBOUND_WEBHOOK_SECRET");
    const sharedSecret = Deno.env.get("ABANDONED_RECOVERY_INBOUND_SECRET");

    let inbound: Inbound | null = null;
    if (req.headers.get("svix-signature")) {
      if (!svixSecret || !(await verifySvix(req, raw, svixSecret))) return errorResponse("Bad signature", 401);
      const event = JSON.parse(raw);
      if (event?.type !== "email.received") return jsonResponse({ ok: true, ignored: event?.type ?? "unknown" });
      inbound = await readResendEmail(event.data ?? {});
    } else {
      const given = req.headers.get("x-inbound-secret") ?? "";
      if (!sharedSecret || !timingSafeEqual(given, sharedSecret)) return errorResponse("Unauthorized", 401);
      const b = JSON.parse(raw);
      inbound = b?.from && (b.text || b.body)
        ? {
          from: String(b.from),
          to: Array.isArray(b.to) ? b.to.map(String) : [String(b.to ?? "")],
          subject: String(b.subject ?? ""),
          text: String(b.text ?? b.body),
          messageId: b.messageId ?? null,
        }
        : null;
    }
    if (!inbound) return jsonResponse({ ok: false, reason: "Unreadable email" });

    const token = inbound.to.map((t) => t.match(TOKEN_RE)?.[1]).find(Boolean);
    if (!token) return jsonResponse({ ok: false, reason: "Not a recovery reply" });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row } = await supabase.from("abandoned_bookings").select("*").eq("recovery_token", token).maybeSingle();
    if (!row) return jsonResponse({ ok: false, reason: "Unknown token" });

    const question = stripQuotedReply(inbound.text);
    const fromEmail = extractEmail(inbound.from);
    const log = (fields: Record<string, unknown>) =>
      supabase.from("abandoned_recovery_messages").insert({ abandoned_booking_id: row.id, tenant_id: row.tenant_id, ...fields });

    // Only the renter we wrote to gets an answer.
    if (!row.customer_email || fromEmail !== String(row.customer_email).toLowerCase()) {
      await log({ direction: "inbound", kind: "question", subject: inbound.subject, body: question || "(empty)", status: "skipped", detail: `Sender ${fromEmail} is not the renter on file` });
      return jsonResponse({ ok: false, reason: "Sender mismatch" });
    }

    await log({ direction: "inbound", kind: "question", subject: inbound.subject, body: question || "(empty)", status: "received" });
    await supabase
      .from("abandoned_bookings")
      .update({ reply_count: (row.reply_count ?? 0) + 1, last_reply_at: new Date().toISOString() })
      .eq("id", row.id);
    if (!question) return jsonResponse({ ok: true, answered: false });

    const { data: tenantRow } = await supabase.from("tenants").select(TENANT_COLS).eq("id", row.tenant_id).maybeSingle();
    if (!tenantRow) return jsonResponse({ ok: false, reason: "Tenant gone" });
    const tenant = tenantRow as RecoveryTenant;

    const { data: settings } = await supabase.from("abandoned_recovery_settings").select("auto_reply_enabled").eq("id", 1).maybeSingle();
    const { count: answered } = await supabase
      .from("abandoned_recovery_messages")
      .select("id", { count: "exact", head: true })
      .eq("abandoned_booking_id", row.id)
      .eq("kind", "answer")
      .eq("status", "sent");

    const autoReply = settings?.auto_reply_enabled !== false && (answered ?? 0) < MAX_ANSWERS_PER_SESSION;

    let covered = false;
    if (autoReply) {
      const { data: faqRows } = await supabase
        .from("faqs")
        .select("id, question, answer, is_active")
        .eq("tenant_id", tenant.id)
        .order("display_order", { ascending: true })
        .limit(200);
      const faqs = (faqRows ?? [])
        .filter((f: any) => f.is_active !== false && f.question && f.answer)
        .map((f: any) => ({ id: f.id, question: String(f.question), answer: String(f.answer) }));

      const result = await answerFromFaqs(tenant, row, question, faqs);
      covered = result.covered;
      const subject = /^re:/i.test(inbound.subject) ? inbound.subject : `Re: ${inbound.subject || row.email_subject || "your booking"}`;
      const { html, text } = renderRecoveryHtml(tenant, subject, result.answer, unsubscribeUrl(row.recovery_token));
      const outcome = await sendTenantEmail({
        tenant,
        to: row.customer_email,
        subject,
        html,
        text,
        replyTo: replyToFor(tenant, row.recovery_token),
        headers: inbound.messageId ? { "In-Reply-To": inbound.messageId, References: inbound.messageId } : undefined,
      });
      await log({
        direction: "outbound",
        kind: "answer",
        subject,
        body: result.answer,
        answered_from_faqs: result.covered,
        faq_ids: result.faqIds,
        status: outcome.ok ? "sent" : "failed",
        detail: outcome.ok ? (result.covered ? null : "Not covered by the FAQs — handed to the tenant") : outcome.detail ?? null,
      });
    }

    // Not answered from the FAQs → a person at the tenant has to see it.
    if (!covered && tenant.contact_email) {
      const forwardBody =
        `A renter replied to their booking reminder with a question that your FAQs don't answer.\n\n` +
        `From: ${row.customer_name || "Renter"} <${row.customer_email}>\n` +
        (row.vehicle_name ? `Car: ${row.vehicle_name}\n` : "") +
        (row.pickup_date ? `Dates: ${row.pickup_date}${row.dropoff_date ? ` to ${row.dropoff_date}` : ""}\n` : "") +
        `\nTheir question:\n${question}\n\n` +
        `Reply to this email to answer them directly. If it's a common question, add it to your FAQs so it's answered automatically next time.`;
      const { html, text } = renderRecoveryHtml(tenant, "A renter has a question", forwardBody, null);
      await sendTenantEmail({
        tenant,
        to: tenant.contact_email,
        subject: `Question from ${row.customer_name || row.customer_email} about their booking`,
        html,
        text,
        replyTo: row.customer_email,
      });
    }

    console.log(`[ABANDONED-INBOUND] ${tenantName(tenant)} session=${row.id} covered=${covered} autoReply=${autoReply}`);
    return jsonResponse({ ok: true, answered: autoReply, covered });
  } catch (error) {
    console.error("abandoned-recovery-inbound error:", (error as { message?: string })?.message ?? error);
    return errorResponse("Internal server error", 500);
  }
});
