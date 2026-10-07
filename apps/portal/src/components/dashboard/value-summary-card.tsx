"use client";

import { CalendarCheck, DollarSign, MessageSquare, Repeat, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { changeLabel, useValueSummary } from "@/hooks/use-value-summary";
import { formatCurrency } from "@/lib/format-utils";

/**
 * "What Drive247 did for you" — the last card on the v1 home. Real numbers for
 * the calendar month so far (see `useValueSummary`), so the operator can see
 * at a glance what the platform is worth next to what it costs.
 */
export function ValueSummaryCard() {
  const { tenant } = useTenant();
  const { data, isLoading, isError } = useValueSummary();
  const { subscription } = useTenantSubscription();
  const currency = tenant?.currency_code || "USD";
  const money = (n: number) => formatCurrency(n, currency, { maximumFractionDigits: 0 });

  if (isError) return null;

  const cur = data?.thisMonth;
  const prev = data?.lastMonthToDate;
  const stats = cur
    ? [
        { icon: CalendarCheck, label: "Bookings", value: String(cur.bookings), change: changeLabel(cur.bookings, prev?.bookings ?? 0) },
        { icon: DollarSign, label: "In rentals", value: money(cur.rentalRevenue), change: changeLabel(cur.rentalRevenue, prev?.rentalRevenue ?? 0, money) },
        { icon: Repeat, label: "Repeat customers", value: String(cur.repeatCustomers), change: changeLabel(cur.repeatCustomers, prev?.repeatCustomers ?? 0) },
        { icon: MessageSquare, label: "Messages sent for you", value: String(cur.messagesSent), change: changeLabel(cur.messagesSent, prev?.messagesSent ?? 0) },
      ]
    : [];

  const planCents = subscription?.amount ?? 0;
  const planInterval = subscription?.interval === "year" ? "year" : "month";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <Sparkles className="h-4 w-4 text-primary" />
          What Drive247 did for you {data ? `in ${data.monthLabel}` : "this month"}
        </CardTitle>
        <CardDescription>So far this month, compared with the same days last month.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {isLoading || !cur
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[84px] rounded-lg" />)
            : stats.map(({ icon: Icon, label, value, change }) => (
                <div key={label} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </div>
                  <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
                  {change && <p className="mt-0.5 text-[11px] text-muted-foreground">{change}</p>}
                </div>
              ))}
        </div>
        {cur && planCents > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Your plan is{" "}
            <span className="font-medium text-foreground">
              {formatCurrency(planCents / 100, (subscription?.currency || currency).toUpperCase())}/{planInterval}
            </span>
            {cur.rentalRevenue > 0 && (
              <>
                {" "}— this month you&apos;ve taken <span className="font-medium text-foreground">{money(cur.rentalRevenue)}</span> through it.
              </>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
