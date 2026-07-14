"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Link2 } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/format-utils";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantPaymentRequests } from "@/hooks/use-payment-links";
import { StatusBadge, describeLink } from "@/components/payments/payment-links-panel";

// Tenant-wide list of every payment link / charge the operator has SENT (a `payments`
// row with a Stripe checkout session). This is Jeuan's "invoices I sent" — they write
// to `payments`, never to the `invoices` table, so they never appeared on the Invoices
// page. Status uses the SAME derivePaymentLinks logic + StatusBadge as the per-rental
// panel, so labels are guaranteed identical across every surface (no new divergence).
export function PaymentRequestsTab() {
  const { tenant } = useTenant();
  const { data: requests, isLoading } = useTenantPaymentRequests();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const rows = requests ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.customerName ?? "").toLowerCase().includes(q) ||
        describeLink(r).toLowerCase().includes(q),
    );
  }, [requests, search]);

  return (
    <div className="space-y-4">
      <div className="relative w-full sm:max-w-[360px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          placeholder="Search by customer or type..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading payment requests…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="No payment requests found"
          description={
            search.trim()
              ? "Try a different search."
              : "Payment links and charges you send to customers appear here."
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[calc(100vh-340px)] min-h-[300px] overflow-auto relative">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>Sent</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>For</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(new Date(r.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>{r.customerName || "—"}</TableCell>
                      <TableCell className="text-sm">{describeLink(r)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatCurrency(r.amount, tenant?.currency_code || "USD")}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
