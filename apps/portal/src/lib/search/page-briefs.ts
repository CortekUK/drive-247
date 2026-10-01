import { format, subDays } from "date-fns";
import { supabaseUntyped as db } from "@/integrations/supabase/client";

/**
 * What Trax says about a PAGE in the v2 ⌘K search: what is happening on it right
 * now, not what the page is. Read by hooks/use-search-brief.ts.
 *
 * Every query is filtered by tenant_id (V2_PLAN §5) and every number is a
 * head-only count or a small bounded read, so none of them can be cut short by
 * the 1,000-row response cap. Amounts appear only when `showMoney`.
 */

export interface PageFact {
  label: string;
  value: string;
}

export interface PageBrief {
  lines: string[];
  facts: PageFact[];
  suggestions: string[];
  question: string;
}

interface Ctx {
  tenantId: string;
  showMoney: boolean;
  money: (n: number) => string;
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isAre = (n: number) => (n === 1 ? "is" : "are");

/** A head-only count: no rows come back, so no cap applies. */
async function count(query: any): Promise<number> {
  const { count: n, error } = await query;
  if (error) throw error;
  return n ?? 0;
}
const rows = (table: string, t: string) => db.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", t);

/** A small bounded read, summed. The limit is far above one tenant's week. */
async function sum(query: any, field: string): Promise<{ n: number; total: number }> {
  const { data, error } = await query.limit(1000);
  if (error) throw error;
  const list = (data ?? []) as Record<string, number | null>[];
  return { n: list.length, total: list.reduce((s, r) => s + Number(r[field] ?? 0), 0) };
}

/** The first non-empty headline wins; the rest become the description. */
function speak(candidates: (string | false | null | undefined)[], fallback: string): string[] {
  const said = candidates.filter(Boolean) as string[];
  return said.length ? said : [fallback];
}

async function rentalsBrief({ tenantId: t }: Ctx): Promise<PageBrief> {
  const today = iso(new Date());
  const [out, overdue, backToday, outToday, awaiting, unsigned] = await Promise.all([
    count(rows("rentals", t).eq("status", "Active")),
    count(rows("rentals", t).eq("status", "Active").lt("end_date", today)),
    count(rows("rentals", t).eq("status", "Active").eq("end_date", today)),
    count(rows("rentals", t).eq("status", "Pending").eq("start_date", today)),
    count(rows("rentals", t).eq("approval_status", "pending").not("status", "in", "(Cancelled,Rejected)")),
    count(rows("rentals", t).in("status", ["Active", "Pending"]).in("document_status", ["pending", "sent", "delivered"])),
  ]);
  return {
    lines: speak(
      [
        overdue > 0 && `${plural(overdue, "rental")} ${isAre(overdue)} overdue.`,
        awaiting > 0 && `${plural(awaiting, "booking")} ${isAre(awaiting)} waiting for your approval.`,
        outToday + backToday > 0 && `Today ${plural(outToday, "car")} ${outToday === 1 ? "goes" : "go"} out and ${backToday} ${backToday === 1 ? "comes" : "come"} back.`,
        `${plural(out, "rental")} ${isAre(out)} out right now.`,
        unsigned > 0 && `${plural(unsigned, "current booking")} still ${unsigned === 1 ? "has" : "have"} an agreement that is not signed.`,
      ],
      "Nothing is out right now.",
    ),
    facts: [
      { label: "Out now", value: String(out) },
      { label: "Overdue", value: String(overdue) },
      { label: "Waiting for approval", value: String(awaiting) },
      { label: "Going out today", value: String(outToday) },
      { label: "Due back today", value: String(backToday) },
      { label: "Agreements not signed", value: String(unsigned) },
    ],
    suggestions: ["Which rentals are overdue, and by how long?", "What is going out and coming back today?", "Which bookings are waiting for my approval?"],
    question: "Give me a rundown of my rentals today: what is overdue, what needs approval, and what is going out or coming back.",
  };
}

async function customersBrief({ tenantId: t }: Ctx): Promise<PageBrief> {
  const since = iso(subDays(new Date(), 30));
  const [total, fresh, verifying, unverifiedBookings, blocked] = await Promise.all([
    count(rows("customers", t)),
    count(rows("customers", t).gte("created_at", since)),
    count(rows("customers", t).eq("identity_verification_status", "pending")),
    count(
      db.from("rentals")
        .select("id, customers!rentals_customer_id_fkey!inner(identity_verification_status)", { count: "exact", head: true })
        .eq("tenant_id", t)
        .in("status", ["Active", "Pending"])
        .in("customers.identity_verification_status", ["unverified", "pending", "rejected"]),
    ),
    count(rows("customers", t).eq("is_blocked", true)),
  ]);
  return {
    lines: speak(
      [
        unverifiedBookings > 0 && `${plural(unverifiedBookings, "current booking")} ${isAre(unverifiedBookings)} with a customer who is not verified yet.`,
        verifying > 0 && `${plural(verifying, "verification")} ${isAre(verifying)} in progress.`,
        `You have ${plural(total, "customer")}, ${fresh} of them new in the last 30 days.`,
        blocked > 0 && `${plural(blocked, "customer")} ${isAre(blocked)} blocked from booking.`,
      ],
      "You do not have any customers yet.",
    ),
    facts: [
      { label: "Customers", value: String(total) },
      { label: "New in 30 days", value: String(fresh) },
      { label: "Verification in progress", value: String(verifying) },
      { label: "Bookings with unverified customers", value: String(unverifiedBookings) },
      { label: "Blocked", value: String(blocked) },
    ],
    suggestions: ["Who owes me money right now?", "Which customers are not verified but have a booking?", "Who are my best customers?"],
    question: "Give me a rundown of my customers: who owes money, who is not verified, and anything that needs my attention.",
  };
}

async function vehiclesBrief({ tenantId: t }: Ctx): Promise<PageBrief> {
  const [fleet, rented, paused] = await Promise.all([
    count(rows("vehicles", t).neq("status", "Disposed")),
    count(rows("vehicles", t).eq("status", "Rented")),
    count(rows("vehicles", t).eq("is_paused", true)),
  ]);
  const free = Math.max(0, fleet - rented - paused);
  const share = fleet ? Math.round((rented / fleet) * 100) : 0;
  return {
    lines: speak(
      [
        fleet > 0 && `${rented} of your ${plural(fleet, "car")} ${rented === 1 ? "is" : "are"} out right now — ${share}% of the fleet.`,
        free > 0 && `${plural(free, "car")} ${isAre(free)} free to book.`,
        paused > 0 && `${plural(paused, "car")} ${isAre(paused)} paused, so customers cannot book ${paused === 1 ? "it" : "them"}.`,
      ],
      "You have not added any cars yet.",
    ),
    facts: [
      { label: "Fleet", value: String(fleet) },
      { label: "Out now", value: String(rented) },
      { label: "Free to book", value: String(free) },
      { label: "Paused", value: String(paused) },
      { label: "Utilisation", value: `${share}%` },
    ],
    suggestions: ["Which cars have been sitting idle?", "Which car earns me the most?", "Which cars are free this weekend?"],
    question: "Give me a rundown of my fleet: what is out, what is idle, and which cars earn the most.",
  };
}

async function paymentsBrief({ tenantId: t, showMoney, money }: Ctx): Promise<PageBrief> {
  const today = iso(new Date());
  const weekAgo = iso(subDays(new Date(), 6));
  const received = (from: string) =>
    db.from("payments").select("amount").eq("tenant_id", t).gte("payment_date", from).not("status", "in", "(Reversed,Refunded)");
  const [week, day, refunds] = await Promise.all([
    sum(received(weekAgo), "amount"),
    sum(received(today), "amount"),
    count(rows("payments", t).eq("refund_status", "scheduled")),
  ]);
  const amt = (v: { n: number; total: number }) => (showMoney ? money(v.total) : plural(v.n, "payment"));
  return {
    lines: speak(
      [
        `You have taken ${amt(week)} in the last 7 days${showMoney ? `, across ${plural(week.n, "payment")}` : ""}.`,
        day.n > 0 ? `${amt(day)} of that came in today.` : "Nothing has come in yet today.",
        refunds > 0 && `${plural(refunds, "refund")} ${isAre(refunds)} scheduled to go out.`,
      ],
      "No payments yet.",
    ),
    facts: [
      { label: "Last 7 days", value: amt(week) },
      { label: "Payments in 7 days", value: String(week.n) },
      { label: "Today", value: amt(day) },
      { label: "Refunds scheduled", value: String(refunds) },
    ],
    suggestions: ["Who still owes me money?", "Did any payment fail this week?", "How does this week compare to last week?"],
    question: "Give me a rundown of payments: what came in this week, what failed, and who still owes me.",
  };
}

async function invoicesBrief({ tenantId: t, showMoney, money }: Ctx): Promise<PageBrief> {
  const today = iso(new Date());
  const [unpaid, overdue] = await Promise.all([
    count(rows("invoices", t).eq("status", "pending")),
    sum(db.from("invoices").select("total_amount").eq("tenant_id", t).eq("status", "pending").lt("due_date", today), "total_amount"),
  ]);
  return {
    lines: speak(
      [
        overdue.n > 0 && `${plural(overdue.n, "invoice")} ${isAre(overdue.n)} past due${showMoney ? `, worth ${money(overdue.total)}` : ""}.`,
        `${plural(unpaid, "invoice")} ${isAre(unpaid)} still unpaid in total.`,
      ],
      "Every invoice is paid.",
    ),
    facts: [
      { label: "Unpaid", value: String(unpaid) },
      { label: "Past due", value: String(overdue.n) },
      ...(showMoney ? [{ label: "Past due, total", value: money(overdue.total) }] : []),
    ],
    suggestions: ["Which invoices are past due?", "Who should I chase first?", "What have I invoiced this month?"],
    question: "Give me a rundown of my invoices: what is unpaid, what is past due, and who to chase first.",
  };
}

async function finesBrief({ tenantId: t }: Ctx): Promise<PageBrief> {
  const today = iso(new Date());
  const inWeek = iso(subDays(new Date(), -7));
  const [open, overdue, dueSoon] = await Promise.all([
    count(rows("fines", t).eq("status", "Open")),
    count(rows("fines", t).eq("status", "Open").lt("due_date", today)),
    count(rows("fines", t).eq("status", "Open").gte("due_date", today).lte("due_date", inWeek)),
  ]);
  return {
    lines: speak(
      [
        overdue > 0 && `${plural(overdue, "fine")} ${isAre(overdue)} past the due date.`,
        dueSoon > 0 && `${plural(dueSoon, "fine")} ${dueSoon === 1 ? "falls" : "fall"} due in the next 7 days.`,
        `${plural(open, "fine")} ${isAre(open)} open.`,
      ],
      "There are no open fines.",
    ),
    facts: [
      { label: "Open", value: String(open) },
      { label: "Past due", value: String(overdue) },
      { label: "Due in 7 days", value: String(dueSoon) },
    ],
    suggestions: ["Which fines are past due?", "Which fines can I charge to a customer?", "How do I appeal a fine?"],
    question: "Give me a rundown of my fines: what is past due, what is due soon, and who they should be charged to.",
  };
}

async function availabilityBrief({ tenantId: t }: Ctx): Promise<PageBrief> {
  const today = iso(new Date());
  const inWeek = iso(subDays(new Date(), -7));
  const [blockedNow, upcoming] = await Promise.all([
    count(rows("blocked_dates", t).lte("start_date", today).gte("end_date", today)),
    count(rows("blocked_dates", t).gt("start_date", today).lte("start_date", inWeek)),
  ]);
  return {
    lines: speak(
      [
        blockedNow > 0 ? `${plural(blockedNow, "block")} ${isAre(blockedNow)} in place today.` : "Nothing is blocked today.",
        upcoming > 0 && `${plural(upcoming, "more block")} ${upcoming === 1 ? "starts" : "start"} in the next 7 days.`,
      ],
      "Nothing is blocked.",
    ),
    facts: [
      { label: "Blocked today", value: String(blockedNow) },
      { label: "Starting in 7 days", value: String(upcoming) },
    ],
    suggestions: ["Which cars are free this weekend?", "Why can't a customer book a car?", "How do I block dates for a car?"],
    question: "Give me a rundown of availability: what is blocked, what is free this week, and anything stopping bookings.",
  };
}

async function agreementsBrief({ tenantId: t }: Ctx): Promise<PageBrief> {
  const weekAgo = subDays(new Date(), 7).toISOString();
  const current = () => rows("rentals", t).in("status", ["Active", "Pending"]);
  const [waiting, notSent, signedWeek] = await Promise.all([
    count(current().in("document_status", ["sent", "delivered"])),
    count(current().eq("document_status", "pending")),
    count(rows("rentals", t).gte("envelope_completed_at", weekAgo)),
  ]);
  return {
    lines: speak(
      [
        waiting > 0 && `${plural(waiting, "agreement")} ${isAre(waiting)} waiting for a signature.`,
        notSent > 0 && `${plural(notSent, "current booking")} ${notSent === 1 ? "has" : "have"} not had an agreement sent yet.`,
        `${plural(signedWeek, "agreement")} ${signedWeek === 1 ? "was" : "were"} signed in the last 7 days.`,
      ],
      "Every current booking has a signed agreement.",
    ),
    facts: [
      { label: "Waiting for signature", value: String(waiting) },
      { label: "Not sent yet", value: String(notSent) },
      { label: "Signed in 7 days", value: String(signedWeek) },
    ],
    suggestions: ["Which agreements are still unsigned?", "Can I resend an agreement?", "How do I change my agreement template?"],
    question: "Give me a rundown of my agreements: what is unsigned, what has not been sent, and what to chase.",
  };
}

async function dashboardBrief(ctx: Ctx): Promise<PageBrief> {
  const brief = await rentalsBrief(ctx);
  return {
    ...brief,
    suggestions: ["What needs my attention today?", "How is this month going compared to last?", "Who owes me money right now?"],
    question: "What needs my attention today?",
  };
}

const PAGE_BRIEFS: Record<string, (ctx: Ctx) => Promise<PageBrief>> = {
  "/": dashboardBrief,
  "/rentals": rentalsBrief,
  "/customers": customersBrief,
  "/vehicles": vehiclesBrief,
  "/payments": paymentsBrief,
  "/invoices": invoicesBrief,
  "/fines": finesBrief,
  "/blocked-dates": availabilityBrief,
  "/agreements": agreementsBrief,
};

/** The live brief for a page result, if that page has one. */
export function pageBriefFor(url: string | null | undefined): ((ctx: Ctx) => Promise<PageBrief>) | null {
  if (!url) return null;
  return PAGE_BRIEFS[url.split(/[?#]/)[0]] ?? null;
}
