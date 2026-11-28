"use client";

/**
 * Billing tab · "This month's checks" (spec 10.15). Every finished check of the month: the customer, the
 * check, the day and the amount. Standard checks are marked Free; a premium charge that has not reached
 * Stripe yet says so, and is never shown as billed (spec 10.8).
 */

import { useQuery } from "@tanstack/react-query";
import { useTenant } from "@/contexts/TenantContext";
import { callVerification, LINE_LABEL } from "@/lib/verification-v2/api";
import { formatCents } from "@/lib/verification-v2/pricing";

interface Usage {
  standardCount: number;
  checks: Array<{ service: string; result: string; at: string; customer: string | null }>;
  charges: Array<{ service: string; customer: string; at: string; cents: number; billed: boolean; held: boolean }>;
}

const NAME: Record<string, string> = { ...LINE_LABEL, standard: "Standard check" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });

export function VerificationUsageCard() {
  const { tenant } = useTenant();
  const q = useQuery({
    queryKey: ["verification-v2-usage", tenant?.id],
    enabled: !!tenant,
    queryFn: () => callVerification<Usage>("usage", {}, tenant?.slug),
  });
  const u = q.data;
  if (!u) return null;

  const rows = [
    ...u.checks.filter((c) => c.service === "standard").map((c) => ({ at: c.at, customer: c.customer ?? "Customer", name: NAME.standard, amount: "Free", note: "" })),
    ...u.charges.map((c) => ({
      at: c.at, customer: c.customer, name: NAME[c.service] ?? c.service, amount: formatCents(c.cents),
      note: c.held ? "Waiting for the state fee" : c.billed ? "" : "Not on a bill yet",
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const premiumTotal = u.charges.reduce((s, c) => s + c.cents, 0);

  return (
    <section className="rounded-3xl border p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-base font-medium">This month's checks</h3>
        <span className="text-sm text-muted-foreground">
          {u.standardCount} standard (free) · premium {formatCents(premiumTotal)}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No checks finished this month yet.</p>
      ) : (
        <ul className="mt-3 divide-y text-sm">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center gap-3 py-2">
              <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{day(r.at)}</span>
              <span className="min-w-0 flex-1 truncate">{r.customer}</span>
              <span className="shrink-0">{r.name}</span>
              <span className="w-20 shrink-0 text-right tabular-nums">{r.amount}</span>
              {r.note && <span className="w-40 shrink-0 text-right text-xs text-[#d97706]">{r.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
