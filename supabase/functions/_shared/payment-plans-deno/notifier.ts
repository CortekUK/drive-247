// Payment plans — the Deno Notifier (engine seam, providers.ts).
//
// Customers get EMAIL, sent the way every other Drive247 customer email is
// sent: _shared/resend-service.ts (sendResendEmail — from `{slug}@drive-247.com`
// with the tenant's company name, wrapped in the tenant's branded frame via
// getTenantBranding / wrapWithBrandedTemplate). Operators get the PORTAL BELL
// through _shared/notify-inapp.ts (a broadcast row every staff member of the
// tenant sees), deduplicated so a retried cron tick cannot ring it twice.
//
// It THROWS when a customer email could not be delivered, so the engine can
// record the failure on the event (`deliveryError`) instead of believing a
// green tick. The engine catches every notifier error: a notification problem
// never changes what happens to money.
//
// What it never puts in an email or a bell: a decline code (the engine hands
// over customerSafeReason text only), or anything but the link URL the
// customer is meant to click.

import { formatCurrency } from "../format-utils.ts";
import { notifyOperatorsInApp } from "../notify-inapp.ts";
import { getTenantBranding, sendResendEmail, wrapWithBrandedTemplate } from "../resend-service.ts";
import type { Notification, Notifier } from "../payment-plans/providers.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

interface PlanFacts {
  planId: string;
  tenantId: string;
  rentalId: string;
  currency: string;
  companyName: string;
  customerName: string | null;
  customerEmail: string | null;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** 'YYYY-MM-DD' → "Fri, Oct 2" without passing through a local-time Date. */
function prettyDate(date: string | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return date ?? "";
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export class DenoNotifier implements Notifier {
  private readonly facts = new Map<string, PlanFacts>();

  constructor(private readonly db: Db) {}

  private async load(planId: string): Promise<PlanFacts> {
    const cached = this.facts.get(planId);
    if (cached) return cached;
    const { data: plan, error: planError } = await this.db
      .from("payment_plans")
      .select("id, tenant_id, rental_id, customer_id, currency")
      .eq("id", planId)
      .maybeSingle();
    if (planError) throw new Error(`notifier: plan lookup failed: ${planError.message}`);
    if (!plan) throw new Error(`notifier: plan ${planId} not found`);
    const { data: customer, error: customerError } = await this.db
      .from("customers")
      .select("name, email")
      .eq("id", plan.customer_id)
      .maybeSingle();
    if (customerError) throw new Error(`notifier: customer lookup failed: ${customerError.message}`);
    const { data: tenant, error: tenantError } = await this.db
      .from("tenants")
      .select("company_name, app_name")
      .eq("id", plan.tenant_id)
      .maybeSingle();
    if (tenantError) throw new Error(`notifier: tenant lookup failed: ${tenantError.message}`);
    const facts: PlanFacts = {
      planId,
      tenantId: plan.tenant_id,
      rentalId: plan.rental_id,
      currency: String(plan.currency || "usd").toUpperCase(),
      companyName: tenant?.app_name || tenant?.company_name || "your rental company",
      customerName: customer?.name ?? null,
      customerEmail: customer?.email ?? null,
    };
    this.facts.set(planId, facts);
    return facts;
  }

  async send(n: Notification): Promise<void> {
    const f = await this.load(n.planId);
    if (n.to === "operator") return this.bell(f, n);
    return this.email(f, n);
  }

  private money(f: PlanFacts, cents: number | undefined): string {
    return formatCurrency((cents ?? 0) / 100, f.currency);
  }

  private async bell(f: PlanFacts, n: Notification): Promise<void> {
    const who = f.customerName ?? "a customer";
    const amount = this.money(f, n.amountCents);
    const ref = f.rentalId.slice(0, 8).toUpperCase();
    const d = n.detail ?? {};
    let title: string;
    let message: string;
    let type: string;
    let dedupeKey: string;
    switch (n.kind) {
      case "due_manual":
        type = "payment_plan_due";
        title = "Payment due — record it when received";
        message = `${amount} from ${who} is due ${prettyDate(n.dueDate)} (booking ${ref}). This payment is collected by hand.`;
        dedupeKey = `pp-due:${n.occurrenceId}`;
        break;
      case "failed": {
        type = "payment_plan_failed";
        title = "Payment plan charge failed";
        const retry = typeof d.nextAttemptAt === "string" ? ` It will be retried automatically.` : "";
        message = `${amount} from ${who} could not be charged (booking ${ref}): ${String(d.reason ?? "declined")}.${retry}`;
        dedupeKey = `pp-failed:${String(d.attemptId ?? n.occurrenceId)}`;
        break;
      }
      case "alert":
      default:
        type = "payment_plan_alert";
        title = "Payment plan needs attention";
        message = `${String(d.message ?? d.problem ?? "A payment plan needs review")} (booking ${ref}${d.planPaused ? "; the plan has been paused" : ""}).`;
        dedupeKey = `pp-alert:${n.planId}:${String(d.problem ?? "alert")}:${String(d.attemptId ?? n.occurrenceId ?? "")}`;
        break;
    }
    // notifyOperatorsInApp never throws and dedupes on (tenant, type, key).
    await notifyOperatorsInApp({
      tenantId: f.tenantId,
      type,
      title,
      message: message.slice(0, 1000),
      link: `/rentals/${f.rentalId}`,
      metadata: { plan_id: n.planId, occurrence_id: n.occurrenceId ?? null, rental_id: f.rentalId, kind: n.kind, problem: d.problem ?? null },
      dedupeKey,
    });
  }

  private async email(f: PlanFacts, n: Notification): Promise<void> {
    if (!f.customerEmail) throw new Error(`notifier: customer on plan ${n.planId} has no email address`);
    const amount = this.money(f, n.amountCents);
    const due = prettyDate(n.dueDate);
    const d = n.detail ?? {};
    const company = escapeHtml(f.companyName);
    const hello = f.customerName ? `Hi ${escapeHtml(f.customerName.split(" ")[0])},` : "Hello,";
    const button = (url: string, label: string) =>
      `<p style="margin: 24px 0;"><a href="${escapeHtml(url)}" style="background:#111827;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">${label}</a></p>`;

    let subject: string;
    let body: string;
    switch (n.kind) {
      case "reminder": {
        const offset = Number(d.offset ?? 0);
        const method = String(d.method ?? "");
        if (offset > 0) subject = `Payment overdue: ${amount}`;
        else if (offset === 0) subject = `Payment due today: ${amount}`;
        else subject = `Upcoming payment: ${amount} on ${due}`;
        const how =
          method === "auto_charge"
            ? `<p>We will charge the card we have on file on ${escapeHtml(due)}. There is nothing you need to do.</p>`
            : n.url
              ? `<p>You can pay securely online:</p>${button(n.url, "Pay now")}<p style="font-size:12px;color:#6b7280;">This replaces any earlier payment link we sent you.</p>`
              : `<p>Please arrange this payment with ${company}.</p>`;
        body = `<p>${hello}</p><p>${offset > 0 ? `Your payment of <strong>${amount}</strong> was due on ${escapeHtml(due)} and is still outstanding.` : `Your payment of <strong>${amount}</strong> is due on ${escapeHtml(due)}.`}</p>${how}`;
        break;
      }
      case "link": {
        subject = `Your payment of ${amount} is ready`;
        const why = d.reason ? `<p>We could not charge your card on file: ${escapeHtml(String(d.reason))}</p>` : "";
        body = `<p>${hello}</p>${why}<p>Your payment of <strong>${amount}</strong>${due ? ` (due ${escapeHtml(due)})` : ""} can be paid securely online.</p>${button(n.url ?? "", "Pay now")}<p style="font-size:12px;color:#6b7280;">This link always opens a fresh, secure checkout. If you receive a newer email from us, use the link in that one.</p>`;
        break;
      }
      case "failed": {
        subject = `We couldn't take your payment of ${amount}`;
        body = `<p>${hello}</p><p>We tried to take your payment of <strong>${amount}</strong>${due ? ` (due ${escapeHtml(due)})` : ""} but it did not go through: ${escapeHtml(String(d.reason ?? "your card was declined"))}</p><p>Please contact ${company} to arrange payment.</p>`;
        break;
      }
      default:
        // due_manual and alert are operator-only; reaching here is a caller bug.
        throw new Error(`notifier: '${n.kind}' is not a customer notification`);
    }

    const branding = await getTenantBranding(f.tenantId, this.db);
    const html = wrapWithBrandedTemplate(`<tr><td style="padding: 32px 30px; color: #374151; font-size: 15px; line-height: 1.6;">${body}</td></tr>`, branding);
    const result = await sendResendEmail(
      {
        to: f.customerEmail,
        subject,
        html,
        tenantId: f.tenantId,
        // One email per (kind, occurrence, attempt/offset) even if a tick is
        // retried. An operator's deliberate re-send carries no key: they asked
        // for a new email. The URL is never part of the key — it carries the
        // payment token.
        idempotencyKey: d.resent ? undefined : `pp:${n.kind}:${n.occurrenceId ?? n.planId}:${String(d.attemptId ?? d.offset ?? "")}`,
      },
      this.db,
    );
    if (!result.success) throw new Error(`email not delivered: ${result.error ?? "unknown error"}`);
  }
}
