"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Plus, Wallet, CircleAlert, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTenant } from "@/contexts/TenantContext";
import { useOwnerPayouts, useCancelPayout } from "@/hooks/use-owner-payouts";
import { useVehicleOwners } from "@/hooks/use-vehicle-owners";
import { CreatePayoutDialog } from "@/components/vehicle-owners/create-payout-dialog";
import { RecordPaymentDialog } from "@/components/vehicle-owners/record-payment-dialog";
import { formatCurrency } from "@/lib/format-utils";
import { PAYOUT_STATUS_LABEL, type OwnerPayout, type PayoutStatus } from "@/types/vehicle-owners";
import {
  Tile,
  KpiTile,
  Money,
  StatusPill,
  statusTone,
  Segmented,
  TableTile,
  bentoTable,
  EmptyState,
  KpiTileSkeletonRow,
  TableSkeleton,
} from "@/components/bento";

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
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Owner Payouts</h1>
          <p className="text-sm text-muted-foreground mt-1">Record and track payments to third-party vehicle owners.</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" /> Create Payout
        </Button>
      </div>

      {/* KPI strip */}
      {isLoading ? (
        <KpiTileSkeletonRow count={4} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiTile label="Pending" value={stats.pending} icon={<Clock className="h-5 w-5" />} />
          <KpiTile label="Partially Paid" value={stats.partial} icon={<CircleAlert className="h-5 w-5" />} />
          <KpiTile label="Paid" value={stats.paid} icon={<CheckCircle2 className="h-5 w-5" />} />
          <KpiTile
            label="Outstanding"
            value={stats.outstanding}
            format={(v) => <Money currency={currency} value={v} />}
            icon={<Wallet className="h-5 w-5" />}
            variant="feature"
          />
        </div>
      )}

      {/* Filter tile */}
      <Tile pad="compact">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
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
        </div>
      </Tile>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={6} cols={9} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-5 w-5" />}
          title="No payouts found"
          description="No payouts match the current filters. Adjust the filters or create a new payout."
          action={
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" /> Create Payout
            </Button>
          }
        />
      ) : (
        <TableTile>
          <Table>
            <TableHeader className={bentoTable.header}>
              <TableRow>
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
              {filtered.map((p) => {
                const remaining = Number(p.net_owed) - Number(p.amount_paid);
                return (
                  <TableRow key={p.id} className={bentoTable.row}>
                    <TableCell>
                      <Link href={`/vehicle-owners/${p.owner_id}`} className="font-semibold text-primary hover:underline">
                        {p.owner_full_name ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Money className="text-xs text-muted-foreground">{p.period_start} → {p.period_end}</Money>
                    </TableCell>
                    <TableCell className={bentoTable.figure}>{formatCurrency(Number(p.gross_revenue), currency)}</TableCell>
                    <TableCell className={bentoTable.figure}>{formatCurrency(Number(p.commission_amount), currency)}</TableCell>
                    <TableCell className={`${bentoTable.figure} font-semibold`}>{formatCurrency(Number(p.net_owed), currency)}</TableCell>
                    <TableCell className={bentoTable.figure}>{formatCurrency(Number(p.amount_paid), currency)}</TableCell>
                    <TableCell>
                      <StatusPill tone={statusTone(p.status)} dot>
                        {PAYOUT_STATUS_LABEL[p.status]}
                      </StatusPill>
                    </TableCell>
                    <TableCell>
                      <Money className="text-xs text-muted-foreground">{p.paid_at ? format(new Date(p.paid_at), "yyyy-MM-dd") : "—"}</Money>
                    </TableCell>
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
              })}
            </TableBody>
          </Table>
        </TableTile>
      )}

      <CreatePayoutDialog open={showCreate} onOpenChange={setShowCreate} />
      {recordFor && (
        <RecordPaymentDialog open={!!recordFor} onOpenChange={(o) => !o && setRecordFor(null)} payout={recordFor} />
      )}
    </div>
  );
}
