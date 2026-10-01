import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useCustomerBalance } from "@/hooks/use-customer-balance";
import { usePortalDestinationContext } from "@/hooks/use-portal-destination-context";
import { formatCurrency } from "@/lib/format-utils";
import type { SearchResult } from "@/lib/search-service";
import { pageBriefFor, type PageFact } from "@/lib/search/page-briefs";

/**
 * The few sentences Trax says about the highlighted ⌘K result — v2 search only
 * (global-search-v2.tsx).
 *
 * Every fact here is read from the tenant's own rows and every query is filtered
 * by tenant_id (V2_PLAN §5). Nothing is generated: Trax's voice is the wording,
 * not the source, so the brief cannot state anything the data does not. The
 * full conversation — with Trax's own verified tools — starts from the
 * "Continue with Trax" handoff, using `question`.
 *
 * Money appears only for someone who can open Payments, the same rule the
 * navigation applies.
 */

export type BriefKind = "customer" | "rental" | "vehicle" | "other";

export interface SearchBrief {
  kind: BriefKind;
  /** What Trax says, one sentence per entry. First person, no emojis. */
  lines: string[];
  /** What the operator asks when the conversation moves to Trax. */
  question: string;
  /** Follow-ups offered under the brief; each one starts the conversation in Trax. */
  suggestions: string[];
  /** Live facts to list under the brief; when absent, the search result's own details are listed. */
  facts?: PageFact[];
}

/** Follow-ups by kind. Questions only — Trax answers, it does not change records. */
const SUGGESTIONS: Record<BriefKind, string[]> = {
  customer: ["What do they owe, and what for?", "Show me their rental history", "Is anything overdue or unsigned?"],
  rental: ["What is left to pay on it?", "Has the agreement been signed?", "How do I extend this rental?"],
  vehicle: ["When is it free next?", "What has it earned this month?", "What is booked on it this week?"],
  other: ["What can I do here?", "How do I set this up?", "Is there anything here I should look at?"],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which record a result is, from the route it opens. */
export function briefTarget(result: SearchResult | null): { kind: BriefKind; id: string | null } {
  const match = result?.url.match(/^\/(customers|rentals|vehicles)\/([^/?#]+)\/?$/);
  if (!match || !UUID.test(match[2])) return { kind: "other", id: null };
  const kind = ({ customers: "customer", rentals: "rental", vehicles: "vehicle" } as const)[match[1] as "customers" | "rentals" | "vehicles"];
  return { kind, id: match[2] };
}

const day = (d: string | null | undefined) => (d ? format(parseISO(d), "EEE d MMM") : null);
const todayIso = () => format(new Date(), "yyyy-MM-dd");

const VERIFICATION: Record<string, string> = {
  verified: "is verified",
  manually_verified: "was verified manually",
  pending: "has a verification in progress",
  rejected: "failed verification",
  unverified: "is not verified yet",
};

const AGREEMENT: Record<string, string> = {
  completed: "The agreement is signed.",
  signed: "The agreement is signed.",
  sent: "The agreement has been sent and is waiting for a signature.",
  delivered: "The agreement has been opened but not signed yet.",
  pending: "The agreement has not been sent yet.",
  voided: "The agreement was voided.",
};

const carName = (v: { reg?: string | null; make?: string | null; model?: string | null } | null | undefined) =>
  v ? [[v.make, v.model].filter(Boolean).join(" "), v.reg ? `(${v.reg})` : null].filter(Boolean).join(" ") : "a car";

/** Charges that are due now on one rental — the same rule as useCustomerBalance. */
async function rentalOutstanding(tenantId: string, rentalId: string): Promise<number> {
  const { data, error } = await supabase
    .from("ledger_entries")
    .select("remaining_amount, category, due_date")
    .eq("tenant_id", tenantId)
    .eq("rental_id", rentalId)
    .eq("type", "Charge");
  if (error) throw error;
  const today = todayIso();
  return (data || []).reduce((sum, e) => {
    if (e.category === "Rental" && e.due_date && e.due_date > today) return sum;
    return sum + (e.remaining_amount || 0);
  }, 0);
}

export const useSearchBrief = (result: SearchResult | null) => {
  const { tenant } = useTenant();
  const ctx = usePortalDestinationContext();
  const showMoney = ctx.canAccessRoute("/payments");
  const currency = tenant?.currency_code || "USD";
  const { kind, id } = briefTarget(result);
  const money = (n: number) => formatCurrency(n, currency);

  // The customer's balance comes from the one place that already computes it.
  const balance = useCustomerBalance(kind === "customer" && showMoney ? id ?? undefined : undefined);

  // A page with a live brief says what is happening on it right now.
  const livePage = kind === "other" ? pageBriefFor(result?.url) : null;
  const page = useQuery({
    queryKey: ["search-page-brief", tenant?.id, result?.url, showMoney, currency],
    enabled: !!tenant?.id && !!livePage,
    staleTime: 30_000,
    queryFn: async (): Promise<SearchBrief> => {
      const b = await livePage!({ tenantId: tenant!.id, showMoney, money });
      return { kind: "other", lines: b.lines, facts: b.facts, suggestions: b.suggestions, question: b.question };
    },
  });

  const facts = useQuery({
    queryKey: ["search-brief", tenant?.id, kind, id, showMoney],
    enabled: !!tenant?.id && !!id && kind !== "other",
    staleTime: 30_000,
    queryFn: async (): Promise<SearchBrief | null> => {
      const tenantId = tenant!.id;
      const today = todayIso();

      if (kind === "customer") {
        const { data: c, error } = await supabase
          .from("customers")
          .select("name, phone, email, identity_verification_status, is_blocked, blocked_reason")
          .eq("tenant_id", tenantId)
          .eq("id", id!)
          .maybeSingle();
        if (error) throw error;
        if (!c) return null;

        const { data: rentals, error: rErr } = await supabase
          .from("rentals")
          .select("status, start_date, end_date, vehicles!rentals_vehicle_id_fkey(reg, make, model)")
          .eq("tenant_id", tenantId)
          .eq("customer_id", id!)
          .order("start_date", { ascending: false })
          .limit(50);
        if (rErr) throw rErr;

        const all = rentals || [];
        const running = all.filter((r) => r.status === "Active");
        const upcoming = all.filter((r) => r.status === "Pending");
        const lines: string[] = [];

        lines.push(
          c.is_blocked
            ? `${c.name} is blocked${c.blocked_reason ? `: ${c.blocked_reason}` : "."}`
            : `${c.name} ${VERIFICATION[c.identity_verification_status ?? "unverified"] ?? "is not verified yet"}.`,
        );
        if (running.length === 1) {
          const r = running[0];
          lines.push(`I can see one rental running: the ${carName(r.vehicles as any)}, due back ${day(r.end_date)}.`);
        } else if (running.length > 1) {
          lines.push(`I can see ${running.length} rentals running right now.`);
        } else if (upcoming.length) {
          lines.push(`Nothing is out right now; the next booking starts ${day(upcoming[upcoming.length - 1].start_date)}.`);
        } else {
          lines.push(all.length ? `Nothing is out right now. They have rented ${all.length} ${all.length === 1 ? "time" : "times"} before.` : "They have not rented from you yet.");
        }
        const contact = [c.phone, c.email].filter(Boolean).join(" · ");
        if (contact) lines.push(`You can reach them on ${contact}.`);

        return { kind, lines, question: `Give me a rundown of ${c.name}: rentals, payments and anything that needs my attention.`, suggestions: SUGGESTIONS.customer };
      }

      if (kind === "rental") {
        const { data: r, error } = await supabase
          .from("rentals")
          .select("rental_number, status, approval_status, document_status, start_date, end_date, is_pay_as_you_go, customers!rentals_customer_id_fkey(name), vehicles!rentals_vehicle_id_fkey(reg, make, model)")
          .eq("tenant_id", tenantId)
          .eq("id", id!)
          .maybeSingle();
        if (error) throw error;
        if (!r) return null;

        const who = (r.customers as any)?.name ?? "The customer";
        const car = carName(r.vehicles as any);
        const ref = r.rental_number ? `Rental ${r.rental_number}` : "This rental";
        const lines: string[] = [];

        if (r.approval_status === "pending") lines.push(`${ref} is waiting for your approval: ${who} wants the ${car} from ${day(r.start_date)} to ${day(r.end_date)}.`);
        else if (r.status === "Active") lines.push(`${who} has the ${car} right now. It is ${r.end_date && r.end_date < today ? `overdue — it was due back ${day(r.end_date)}` : `due back ${day(r.end_date)}`}.`);
        else if (r.status === "Pending") lines.push(`${who} is booked on the ${car} from ${day(r.start_date)} to ${day(r.end_date)}.`);
        else if (r.status === "Closed") lines.push(`${ref} is closed. ${who} had the ${car} from ${day(r.start_date)} to ${day(r.end_date)}.`);
        else lines.push(`${ref} is ${String(r.status ?? "").toLowerCase() || "on file"}: ${who}, the ${car}.`);

        if (r.document_status && AGREEMENT[r.document_status] && r.status !== "Cancelled") lines.push(AGREEMENT[r.document_status]);

        if (showMoney) {
          if (r.is_pay_as_you_go) lines.push("It is pay-as-you-go, so the balance grows day by day.");
          else {
            const owed = await rentalOutstanding(tenantId, id!);
            lines.push(owed > 0.005 ? `${money(owed)} is due on it now.` : "Nothing is owed on it right now.");
          }
        }

        return { kind, lines, question: `Walk me through ${r.rental_number ? `rental ${r.rental_number}` : `${who}'s rental`}: payments, agreement and anything that needs my attention.`, suggestions: SUGGESTIONS.rental };
      }

      // vehicle
      const { data: v, error } = await supabase
        .from("vehicles")
        .select("reg, make, model, status, is_paused, paused_reason, daily_rent")
        .eq("tenant_id", tenantId)
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      if (!v) return null;

      const [{ data: current }, { data: next }, { data: blocks }] = await Promise.all([
        supabase.from("rentals").select("end_date, customers!rentals_customer_id_fkey(name)")
          .eq("tenant_id", tenantId).eq("vehicle_id", id!).eq("status", "Active")
          .order("end_date", { ascending: true }).limit(1),
        supabase.from("rentals").select("start_date, customers!rentals_customer_id_fkey(name)")
          .eq("tenant_id", tenantId).eq("vehicle_id", id!).eq("status", "Pending").gte("start_date", today)
          .order("start_date", { ascending: true }).limit(1),
        supabase.from("blocked_dates").select("start_date, end_date, reason")
          .eq("tenant_id", tenantId).eq("vehicle_id", id!).gte("end_date", today)
          .order("start_date", { ascending: true }).limit(1),
      ]);

      const car = carName(v);
      const lines: string[] = [];
      const now = current?.[0];
      if (v.is_paused) lines.push(`The ${car} is paused${v.paused_reason ? `: ${v.paused_reason}` : ""}, so it cannot be booked.`);
      else if (now) lines.push(`The ${car} is out with ${(now.customers as any)?.name ?? "a customer"} until ${day(now.end_date)}.`);
      else lines.push(`The ${car} is free right now.`);

      const upcoming = next?.[0];
      if (upcoming) lines.push(`Its next booking is ${(upcoming.customers as any)?.name ?? "a customer"} from ${day(upcoming.start_date)}.`);
      const block = blocks?.[0];
      if (block) lines.push(`It is blocked ${day(block.start_date)} to ${day(block.end_date)}${block.reason ? ` (${block.reason})` : ""}.`);
      if (showMoney && v.daily_rent != null) lines.push(`It rents at ${money(Number(v.daily_rent))} a day.`);

      return { kind, lines, question: `Tell me about the ${car}: who has it, what's booked next, and whether anything needs my attention.`, suggestions: SUGGESTIONS.vehicle };
    },
  });

  if (livePage) {
    // A failed read falls back to saying what the page is, rather than nothing.
    if (page.isError && result) return { brief: { kind, lines: otherLines(result), question: `Help me with ${result.title}.`, suggestions: SUGGESTIONS.other }, isLoading: false };
    return { brief: page.data ?? null, isLoading: page.isLoading };
  }

  // Settings and everything else: Trax says what it is, from the result itself.
  if (kind === "other" && result) {
    const brief: SearchBrief = {
      kind,
      lines: otherLines(result),
      question: `Help me with ${result.title}. What can I do there, and is there anything I should look at?`,
      suggestions: SUGGESTIONS.other,
    };
    return { brief, isLoading: false };
  }

  let brief = facts.data ?? null;
  if (brief && kind === "customer" && showMoney && balance.data != null) {
    const owed = Number(balance.data);
    brief = { ...brief, lines: [...brief.lines.slice(0, 2), owed > 0.005 ? `They owe ${money(owed)} right now.` : "Their account is settled.", ...brief.lines.slice(2)] };
  }
  const waitingOnBalance = kind === "customer" && showMoney && balance.isLoading;
  return { brief: waitingOnBalance ? null : brief, isLoading: facts.isLoading || waitingOnBalance };
};

/**
 * Pages, settings and every other record kind: what it is and where it sits, in
 * Trax's voice, from the result the search already built. The facts themselves
 * are listed under the brief, so they are not repeated here.
 */
function otherLines(result: SearchResult): string[] {
  const noun = (result.badges?.[0] ?? result.category ?? "").toLowerCase();
  const sentence = (t: string) => t.trim().replace(/[.\s]*$/, ".");
  const lines: string[] = [];
  if (noun === "page" || noun === "setting" || noun === "integration") {
    lines.push(`${result.title} is a${/^[aeiou]/.test(noun) ? "n" : ""} ${noun} in your portal.`);
    if (result.description || result.subtitle) lines.push(sentence(result.description || result.subtitle));
    lines.push("Open it from here, or ask me and I will walk you through it.");
  } else {
    lines.push(`I found ${result.title} under ${result.category || "your records"}.`);
    const status = result.badges?.[1];
    if (status) lines.push(`It is marked ${status.toLowerCase()}.`);
    lines.push("Here is what I can see on it. Ask me if you want the detail behind any of it.");
  }
  return lines;
}
