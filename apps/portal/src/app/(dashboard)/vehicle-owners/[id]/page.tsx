"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ArrowLeft, Edit, Plus, Wallet, Eye, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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

  if (isLoading) {
    return <div className="p-6 space-y-4"><Skeleton className="h-12 w-64" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!owner) {
    return (
      <div className="p-6">
        <p>Owner not found.</p>
        <Link href="/vehicle-owners"><Button variant="outline" className="mt-4"><ArrowLeft className="h-4 w-4 mr-2" /> Back</Button></Link>
      </div>
    );
  }

  const totalOwed = payouts
    .filter((p) => p.status === "pending" || p.status === "partially_paid")
    .reduce((s, p) => s + (Number(p.net_owed) - Number(p.amount_paid)), 0);

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/vehicle-owners")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-medium text-foreground">{owner.full_name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {owner.is_active ? "Active owner" : "Inactive — payout history preserved"}
              {" · "}{vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"}
              {" · "}Outstanding {formatCurrency(totalOwed, currency)}
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

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <Field label="Email" value={owner.email ?? "—"} />
              <Field label="Phone" value={owner.phone ?? "—"} />
              <Field label="Address" value={owner.address ?? "—"} className="col-span-2" />
              <Field label="Notes" value={owner.notes ?? "—"} className="col-span-2" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Commission & Payout</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-3 gap-4 text-sm">
              <Field
                label="Commission"
                value={
                  owner.commission_type === "percentage"
                    ? `${owner.commission_value}% of revenue`
                    : `${formatCurrency(owner.commission_value, currency)} per ${owner.flat_fee_period === "per_month" ? "month" : owner.flat_fee_period === "per_day" ? "rented day" : "rental"}`
                }
              />
              <Field label="Payout Frequency" value={owner.payout_frequency.replace("_", " ")} />
              <Field label="Status" value={owner.is_active ? "Active" : "Inactive"} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vehicles" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setAssignOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Assign Vehicle
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
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
                  {vehicles.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No vehicles assigned.</TableCell></TableRow>
                  ) : (
                    vehicles.map((v) => (
                      <VehicleRow key={v.id} vehicle={v} ownerId={owner.id} currency={currency} />
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="revenue" className="space-y-4">
          <RevenueTab ownerId={owner.id} currency={currency} />
        </TabsContent>

        <TabsContent value="payouts" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
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
                  {payouts.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No payouts yet.</TableCell></TableRow>
                  ) : (
                    payouts.map((p) => (
                      <PayoutRow key={p.id} payout={p} currency={currency} onRecord={() => setRecordPaymentFor(p)} />
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
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

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">{value}</div>
    </div>
  );
}

function VehicleRow({ vehicle, ownerId, currency }: { vehicle: any; ownerId: string; currency: string }) {
  const unassign = useAssignVehicleOwner();
  const override = vehicle.commission_type_override
    ? vehicle.commission_type_override === "percentage"
      ? `${vehicle.commission_value_override}%`
      : `${formatCurrency(Number(vehicle.commission_value_override ?? 0), currency)} / ${vehicle.flat_fee_period_override === "per_month" ? "mo" : vehicle.flat_fee_period_override === "per_day" ? "day" : "rental"}`
    : "—";
  return (
    <TableRow>
      <TableCell className="font-medium">{vehicle.reg}</TableCell>
      <TableCell>{[vehicle.make, vehicle.model].filter(Boolean).join(" ")}</TableCell>
      <TableCell>{vehicle.year ?? "—"}</TableCell>
      <TableCell className="capitalize">{vehicle.status ?? "—"}</TableCell>
      <TableCell className="text-sm">{vehicle.ownership_assigned_at ? format(new Date(vehicle.ownership_assigned_at), "yyyy-MM-dd") : "—"}</TableCell>
      <TableCell>{override}</TableCell>
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
    <TableRow>
      <TableCell className="text-sm">{payout.period_start} → {payout.period_end}</TableCell>
      <TableCell className="text-right">{formatCurrency(Number(payout.gross_revenue), currency)}</TableCell>
      <TableCell className="text-right">{formatCurrency(Number(payout.commission_amount), currency)}</TableCell>
      <TableCell className="text-right font-medium">{formatCurrency(Number(payout.net_owed), currency)}</TableCell>
      <TableCell className="text-right">{formatCurrency(Number(payout.amount_paid), currency)}</TableCell>
      <TableCell>
        <Badge variant="outline" className={statusColor(payout.status)}>
          {PAYOUT_STATUS_LABEL[payout.status as keyof typeof PAYOUT_STATUS_LABEL]}
        </Badge>
      </TableCell>
      <TableCell className="text-sm">{payout.paid_at ? format(new Date(payout.paid_at), "yyyy-MM-dd") : "—"}</TableCell>
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

function statusColor(status: string) {
  switch (status) {
    case "paid": return "border-green-300 text-green-700 dark:border-green-800 dark:text-green-400";
    case "partially_paid": return "border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-400";
    case "cancelled": return "border-gray-300 text-muted-foreground dark:border-gray-700";
    default: return "border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-400";
  }
}

function RevenueTab({ ownerId, currency }: { ownerId: string; currency: string }) {
  const today = new Date();
  const [from, setFrom] = useState(format(startOfMonth(subMonths(today, 1)), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfMonth(today), "yyyy-MM-dd"));
  const { data: rows = [], isLoading } = useOwnerRevenue({ ownerId, fromDate: from, toDate: to });

  const total = useMemo(() => rows.reduce((s, r) => s + Number(r.paid_amount || 0), 0), [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div>
          <Label htmlFor="rev-from">From</Label>
          <Input id="rev-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="rev-to">To</Label>
          <Input id="rev-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs text-muted-foreground">Total Paid Revenue</div>
          <div className="text-xl font-medium text-foreground">{formatCurrency(total, currency)}</div>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
                <TableHead>Date</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead className="text-right">Paid Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No paid revenue in this range.</TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.payment_id}>
                    <TableCell>{r.revenue_date}</TableCell>
                    <TableCell>{r.vehicle_reg}</TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(r.paid_amount), currency)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
