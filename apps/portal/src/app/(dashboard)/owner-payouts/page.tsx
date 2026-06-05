"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Plus, Wallet, CircleAlert, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenant } from "@/contexts/TenantContext";
import { useOwnerPayouts, useCancelPayout } from "@/hooks/use-owner-payouts";
import { useVehicleOwners } from "@/hooks/use-vehicle-owners";
import { CreatePayoutDialog } from "@/components/vehicle-owners/create-payout-dialog";
import { RecordPaymentDialog } from "@/components/vehicle-owners/record-payment-dialog";
import { formatCurrency } from "@/lib/format-utils";
import { PAYOUT_STATUS_LABEL, type OwnerPayout, type PayoutStatus } from "@/types/vehicle-owners";

export default function OwnerPayoutsPage() {
  const { tenant } = useTenant();
  const currency = tenant?.currency_code || "USD";
  const today = new Date();

  const [statusFilter, setStatusFilter] = useState<PayoutStatus | "all">("all");
  const [ownerFilter, setOwnerFilter] = useState<string | "all">("all");
  const [from, setFrom] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfMonth(today), "yyyy-MM-dd"));
  const [showCreate, setShowCreate] = useState(false);
  const [recordFor, setRecordFor] = useState<OwnerPayout | null>(null);

  const { data: payouts = [], isLoading } = useOwnerPayouts({
    ownerId: ownerFilter === "all" ? undefined : ownerFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const { data: owners = [] } = useVehicleOwners({ includeInactive: true });
  const cancel = useCancelPayout();

  const filtered = useMemo(() => {
    return payouts.filter((p) => p.period_end >= from && p.period_start <= to);
  }, [payouts, from, to]);

  const stats = useMemo(() => {
    const pending = filtered.filter((p) => p.status === "pending").length;
    const partial = filtered.filter((p) => p.status === "partially_paid").length;
    const paid = filtered.filter((p) => p.status === "paid").length;
    const outstanding = filtered
      .filter((p) => p.status === "pending" || p.status === "partially_paid")
      .reduce((s, p) => s + (Number(p.net_owed) - Number(p.amount_paid)), 0);
    return { pending, partial, paid, outstanding };
  }, [filtered]);

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-medium text-foreground">Owner Payouts</h1>
          <p className="text-sm text-muted-foreground mt-1">Record and track payments to third-party vehicle owners.</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" /> Create Payout
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />} label="Pending" value={String(stats.pending)} />
        <StatCard icon={<CircleAlert className="h-5 w-5 text-orange-600 dark:text-orange-400" />} label="Partially Paid" value={String(stats.partial)} />
        <StatCard icon={<CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />} label="Paid" value={String(stats.paid)} />
        <StatCard icon={<Wallet className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />} label="Outstanding" value={formatCurrency(stats.outstanding, currency)} />
      </div>

      <Card>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="partially_paid">Partially paid</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Owner</Label>
            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All owners</SelectItem>
                {owners.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="po-from">From (period)</Label>
            <Input id="po-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="po-to">To (period)</Label>
            <Input id="po-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
                <TableHead>Owner</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Net Owed</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Paid At</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={9}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">No payouts match the current filters.</TableCell></TableRow>
              ) : (
                filtered.map((p) => {
                  const remaining = Number(p.net_owed) - Number(p.amount_paid);
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link href={`/vehicle-owners/${p.owner_id}`} className="font-medium text-[#6366f1] dark:text-indigo-400 hover:underline">
                          {p.owner_full_name ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{p.period_start} → {p.period_end}</TableCell>
                      <TableCell className="text-right">{formatCurrency(Number(p.gross_revenue), currency)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(Number(p.commission_amount), currency)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(Number(p.net_owed), currency)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(Number(p.amount_paid), currency)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColor(p.status)}>
                          {PAYOUT_STATUS_LABEL[p.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{p.paid_at ? format(new Date(p.paid_at), "yyyy-MM-dd") : "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {p.status !== "paid" && p.status !== "cancelled" && remaining > 0 && (
                            <Button size="sm" variant="outline" onClick={() => setRecordFor(p)}>Record</Button>
                          )}
                          {p.status !== "cancelled" && Number(p.amount_paid) === 0 && (
                            <Button size="sm" variant="ghost" onClick={() => cancel.mutate(p.id)} disabled={cancel.isPending}>Cancel</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreatePayoutDialog open={showCreate} onOpenChange={setShowCreate} />
      {recordFor && (
        <RecordPaymentDialog open={!!recordFor} onOpenChange={(o) => !o && setRecordFor(null)} payout={recordFor} />
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-medium text-foreground mt-1">{value}</p>
          </div>
          <div className="h-10 w-10 rounded-md bg-[#eef2ff] dark:bg-muted flex items-center justify-center">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function statusColor(status: string) {
  switch (status) {
    case "paid": return "border-green-300 text-green-700 dark:border-green-800 dark:text-green-400";
    case "partially_paid": return "border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-400";
    case "cancelled": return "border-gray-300 text-muted-foreground dark:border-gray-700";
    default: return "border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-400";
  }
}
