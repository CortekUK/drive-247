"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ArrowLeft, Edit, Plus, Wallet, Ban, Car, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useVehicleOwner } from "@/hooks/use-vehicle-owners";
import { useOwnerVehicles, useAssignVehicleOwner } from "@/hooks/use-owner-vehicles";
import { useOwnerRevenue } from "@/hooks/use-owner-revenue";
import { useOwnerPayouts, useCancelPayout } from "@/hooks/use-owner-payouts";
import { OwnerFormDialog } from "@/components/vehicle-owners/owner-form-dialog";
import { AssignVehicleDialog } from "@/components/vehicle-owners/assign-vehicle-dialog";
import { CreatePayoutDialog } from "@/components/vehicle-owners/create-payout-dialog";
import { RecordPaymentDialog } from "@/components/vehicle-owners/record-payment-dialog";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";
import { PAYOUT_STATUS_LABEL, type OwnerPayout } from "@/types/vehicle-owners";
import {
  Tile,
  KpiTile,
  Eyebrow,
  Money,
  StatusPill,
  statusTone,
  TableTile,
  bentoTable,
  EmptyState,
  ErrorState,
} from "@/components/bento";

export default function VehicleOwnerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const ownerId = params?.id;

  const { tenant } = useTenant();
  const currency = tenant?.currency_code || "USD";

  const { data: owner, isLoading } = useVehicleOwner(ownerId);
  const { data: vehicles = [] } = useOwnerVehicles(ownerId);
  const { data: payouts = [] } = useOwnerPayouts({ ownerId });

  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [createPayoutOpen, setCreatePayoutOpen] = useState(false);
  const [recordPaymentFor, setRecordPaymentFor] = useState<OwnerPayout | null>(null);

  const totalOwed = useMemo(
    () =>
      payouts
        .filter((p) => p.status === "pending" || p.status === "partially_paid")
        .reduce((s, p) => s + (Number(p.net_owed) - Number(p.amount_paid)), 0),
    [payouts],
  );
  const totalPaid = useMemo(
    () => payouts.reduce((s, p) => s + Number(p.amount_paid), 0),
    [payouts],
  );

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-tile" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-tile" />
      </div>
    );
  }
  if (!owner) {
    return (
      <div className="p-6">
        <ErrorState
          title="Owner not found"
          description="This vehicle owner does not exist or you no longer have access."
          onRetry={() => router.push("/vehicle-owners")}
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/vehicle-owners")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{owner.full_name}</h1>
              {owner.is_active
                ? <StatusPill tone="success" dot>Active</StatusPill>
                : <StatusPill tone="neutral" dot>Inactive</StatusPill>}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {owner.is_active ? "Active owner" : "Inactive — payout history preserved"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Edit className="h-4 w-4 mr-2" /> Edit
          </Button>
          <Button onClick={() => setCreatePayoutOpen(true)}>
            <Wallet className="h-4 w-4 mr-2" /> Create Payout
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Vehicles" value={vehicles.length} icon={<Car className="h-5 w-5" />} />
        <KpiTile label="Payouts" value={payouts.length} icon={<Users className="h-5 w-5" />} />
        <KpiTile
          label="Total Paid"
          value={totalPaid}
          format={(v) => <Money currency={currency} value={v} />}
        />
        <KpiTile
          label="Outstanding"
          value={totalOwed}
          format={(v) => <Money currency={currency} value={v} />}
          icon={<Wallet className="h-5 w-5" />}
          variant="feature"
        />
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Tile className="space-y-4">
              <Eyebrow>Contact</Eyebrow>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email" value={owner.email ?? "—"} />
                <Field label="Phone" value={owner.phone ?? "—"} mono />
                <Field label="Address" value={owner.address ?? "—"} className="col-span-2" />
                <Field label="Notes" value={owner.notes ?? "—"} className="col-span-2" />
              </div>
            </Tile>
            <Tile className="space-y-4">
              <Eyebrow>Commission &amp; Payout</Eyebrow>
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Commission"
                  value={
                    owner.commission_type === "percentage"
                      ? `${owner.commission_value}% of revenue`
                      : `${formatCurrency(owner.commission_value, currency)} per ${owner.flat_fee_period === "per_month" ? "month" : "rental"}`
                  }
                />
                <Field label="Payout Frequency" value={owner.payout_frequency.replace("_", " ")} />
                <Field label="Status" value={owner.is_active ? "Active" : "Inactive"} />
              </div>
            </Tile>
          </div>
        </TabsContent>

        <TabsContent value="vehicles" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setAssignOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Assign Vehicle
            </Button>
          </div>
          {vehicles.length === 0 ? (
            <EmptyState
              icon={<Car className="h-5 w-5" />}
              title="No vehicles assigned"
              description="Assign one of your own-fleet vehicles to this owner to start tracking revenue."
              action={
                <Button onClick={() => setAssignOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Assign Vehicle
                </Button>
              }
            />
          ) : (
            <TableTile>
              <Table>
                <TableHeader className={bentoTable.header}>
                  <TableRow>
                    <TableHead>Reg</TableHead>
                    <TableHead>Make / Model</TableHead>
                    <TableHead>Year</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>Commission Override</TableHead>
                    <TableHead className="w-[120px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicles.map((v) => (
                    <VehicleRow key={v.id} vehicle={v} ownerId={owner.id} currency={currency} />
                  ))}
                </TableBody>
              </Table>
            </TableTile>
          )}
        </TabsContent>

        <TabsContent value="revenue" className="space-y-4">
          <RevenueTab ownerId={owner.id} currency={currency} />
        </TabsContent>

        <TabsContent value="payouts" className="space-y-4">
          {payouts.length === 0 ? (
            <EmptyState
              icon={<Wallet className="h-5 w-5" />}
              title="No payouts yet"
              description="Create a payout to snapshot this owner's revenue and commission for a period."
              action={
                <Button onClick={() => setCreatePayoutOpen(true)}>
                  <Wallet className="h-4 w-4 mr-2" /> Create Payout
                </Button>
              }
            />
          ) : (
            <TableTile>
              <Table>
                <TableHeader className={bentoTable.header}>
                  <TableRow>
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
                  {payouts.map((p) => (
                    <PayoutRow key={p.id} payout={p} currency={currency} onRecord={() => setRecordPaymentFor(p)} />
                  ))}
                </TableBody>
              </Table>
            </TableTile>
          )}
        </TabsContent>
      </Tabs>

      <OwnerFormDialog open={editOpen} onOpenChange={setEditOpen} owner={owner} />
      <AssignVehicleDialog open={assignOpen} onOpenChange={setAssignOpen} ownerId={owner.id} />
      <CreatePayoutDialog open={createPayoutOpen} onOpenChange={setCreatePayoutOpen} defaultOwnerId={owner.id} />
      {recordPaymentFor && (
        <RecordPaymentDialog
          open={!!recordPaymentFor}
          onOpenChange={(o) => !o && setRecordPaymentFor(null)}
          payout={recordPaymentFor}
        />
      )}
    </div>
  );
}

function Field({ label, value, className, mono }: { label: string; value: string; className?: string; mono?: boolean }) {
  return (
    <div className={className}>
      <Eyebrow>{label}</Eyebrow>
      <div className={`text-sm text-foreground mt-1 whitespace-pre-wrap ${mono ? "font-mono tabular-nums" : ""}`}>{value}</div>
    </div>
  );
}

function VehicleRow({ vehicle, ownerId, currency }: { vehicle: any; ownerId: string; currency: string }) {
  const unassign = useAssignVehicleOwner();
  const override = vehicle.commission_type_override
    ? vehicle.commission_type_override === "percentage"
      ? `${vehicle.commission_value_override}%`
      : `${formatCurrency(Number(vehicle.commission_value_override ?? 0), currency)} / ${vehicle.flat_fee_period_override === "per_month" ? "mo" : "rental"}`
    : "—";
  return (
    <TableRow className={bentoTable.row}>
      <TableCell className="font-mono font-semibold tabular-nums">{vehicle.reg}</TableCell>
      <TableCell>{[vehicle.make, vehicle.model].filter(Boolean).join(" ")}</TableCell>
      <TableCell className="font-mono tabular-nums">{vehicle.year ?? "—"}</TableCell>
      <TableCell>
        {vehicle.status ? <StatusPill tone={statusTone(vehicle.status)}>{vehicle.status}</StatusPill> : "—"}
      </TableCell>
      <TableCell>
        <Money className="text-sm text-muted-foreground">{vehicle.ownership_assigned_at ? format(new Date(vehicle.ownership_assigned_at), "yyyy-MM-dd") : "—"}</Money>
      </TableCell>
      <TableCell className="font-mono tabular-nums">{override}</TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => unassign.mutate({ vehicle_id: vehicle.id, owner_id: null })}
          disabled={unassign.isPending}
        >
          <Ban className="h-4 w-4 mr-1" /> Unassign
        </Button>
      </TableCell>
    </TableRow>
  );
}

function PayoutRow({ payout, currency, onRecord }: { payout: any; currency: string; onRecord: () => void }) {
  const cancel = useCancelPayout();
  const remaining = Number(payout.net_owed) - Number(payout.amount_paid);
  return (
    <TableRow className={bentoTable.row}>
      <TableCell>
        <Money className="text-xs text-muted-foreground">{payout.period_start} → {payout.period_end}</Money>
      </TableCell>
      <TableCell className={bentoTable.figure}>{formatCurrency(Number(payout.gross_revenue), currency)}</TableCell>
      <TableCell className={bentoTable.figure}>{formatCurrency(Number(payout.commission_amount), currency)}</TableCell>
      <TableCell className={`${bentoTable.figure} font-semibold`}>{formatCurrency(Number(payout.net_owed), currency)}</TableCell>
      <TableCell className={bentoTable.figure}>{formatCurrency(Number(payout.amount_paid), currency)}</TableCell>
      <TableCell>
        <StatusPill tone={statusTone(payout.status)} dot>
          {PAYOUT_STATUS_LABEL[payout.status as keyof typeof PAYOUT_STATUS_LABEL]}
        </StatusPill>
      </TableCell>
      <TableCell>
        <Money className="text-xs text-muted-foreground">{payout.paid_at ? format(new Date(payout.paid_at), "yyyy-MM-dd") : "—"}</Money>
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          {payout.status !== "paid" && payout.status !== "cancelled" && remaining > 0 && (
            <Button size="sm" variant="outline" onClick={onRecord}>Record</Button>
          )}
          {payout.status !== "cancelled" && payout.amount_paid === 0 && (
            <Button size="sm" variant="ghost" onClick={() => cancel.mutate(payout.id)} disabled={cancel.isPending}>Cancel</Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function RevenueTab({ ownerId, currency }: { ownerId: string; currency: string }) {
  const today = new Date();
  const [from, setFrom] = useState(format(startOfMonth(subMonths(today, 1)), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfMonth(today), "yyyy-MM-dd"));
  const { data: rows = [], isLoading } = useOwnerRevenue({ ownerId, fromDate: from, toDate: to });

  const total = useMemo(() => rows.reduce((s, r) => s + Number(r.paid_amount || 0), 0), [rows]);

  return (
    <div className="space-y-4">
      <Tile pad="compact">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="rev-from">From</Label>
            <Input id="rev-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="rev-to">To</Label>
            <Input id="rev-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="ml-auto text-right">
            <Eyebrow>Total Paid Revenue</Eyebrow>
            <div className="text-xl font-extrabold tracking-tight">
              <Money currency={currency} value={total} />
            </div>
          </div>
        </div>
      </Tile>
      {isLoading ? (
        <Tile pad="none" className="overflow-hidden">
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-4"><Skeleton className="h-6 w-full" /></div>
            ))}
          </div>
        </Tile>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-5 w-5" />}
          title="No paid revenue in this range"
          description="Adjust the date range to see paid revenue for this owner's vehicles."
        />
      ) : (
        <TableTile>
          <Table>
            <TableHeader className={bentoTable.header}>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead className="text-right">Paid Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.payment_id} className={bentoTable.row}>
                  <TableCell><Money className="text-muted-foreground">{r.revenue_date}</Money></TableCell>
                  <TableCell className="font-mono tabular-nums">{r.vehicle_reg}</TableCell>
                  <TableCell className={bentoTable.figure}>{formatCurrency(Number(r.paid_amount), currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableTile>
      )}
    </div>
  );
}
