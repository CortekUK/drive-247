"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Users, Car, Wallet, Search, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useTenant } from "@/contexts/TenantContext";
import { useVehicleOwners } from "@/hooks/use-vehicle-owners";
import { useOwnerPayouts } from "@/hooks/use-owner-payouts";
import { OwnerFormDialog } from "@/components/vehicle-owners/owner-form-dialog";
import { formatCurrency } from "@/lib/format-utils";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

export default function VehicleOwnersPage() {
  const { tenant } = useTenant();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { data: owners = [], isLoading } = useVehicleOwners({ includeInactive });
  const { data: payouts = [] } = useOwnerPayouts();

  // Per-owner counts: vehicles assigned + outstanding owed
  const { data: vehicleCounts = {} } = useQuery({
    queryKey: ["owner-vehicle-counts", tenant?.id],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await (supabase as any)
        .from("vehicles")
        .select("owner_id")
        .eq("tenant_id", tenant!.id)
        .not("owner_id", "is", null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data || []) {
        counts[row.owner_id] = (counts[row.owner_id] ?? 0) + 1;
      }
      return counts;
    },
    enabled: !!tenant?.id,
  });

  const outstandingPerOwner = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of payouts) {
      if (p.status === "pending" || p.status === "partially_paid") {
        const remaining = Number(p.net_owed) - Number(p.amount_paid);
        map[p.owner_id] = (map[p.owner_id] ?? 0) + remaining;
      }
    }
    return map;
  }, [payouts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return owners;
    return owners.filter(
      (o) =>
        o.full_name.toLowerCase().includes(q) ||
        (o.email ?? "").toLowerCase().includes(q) ||
        (o.phone ?? "").toLowerCase().includes(q)
    );
  }, [owners, search]);

  const totalActive = owners.filter((o) => o.is_active).length;
  const totalManagedVehicles = Object.values(vehicleCounts).reduce((a, b) => a + b, 0);
  const totalOutstanding = Object.values(outstandingPerOwner).reduce((a, b) => a + b, 0);

  const currency = tenant?.currency_code || "USD";

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-medium text-foreground">Vehicle Owners</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Third-party owners whose vehicles you manage on consignment.
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add Owner
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={<Users className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />} label="Active Owners" value={String(totalActive)} />
        <StatCard icon={<Car className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />} label="Managed Vehicles" value={String(totalManagedVehicles)} />
        <StatCard
          icon={<Wallet className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
          label="Outstanding Owed"
          value={formatCurrency(totalOutstanding, currency)}
        />
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="include-inactive" checked={includeInactive} onCheckedChange={setIncludeInactive} />
          <Label htmlFor="include-inactive" className="text-sm">Include inactive</Label>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Vehicles</TableHead>
                <TableHead>Commission</TableHead>
                <TableHead>Payout Frequency</TableHead>
                <TableHead className="text-right">Outstanding Owed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    {owners.length === 0
                      ? "No vehicle owners yet. Click “Add Owner” to get started."
                      : "No owners match your search."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.full_name}</TableCell>
                    <TableCell className="text-sm text-foreground/80">
                      {o.email && <div>{o.email}</div>}
                      {o.phone && <div className="text-muted-foreground">{o.phone}</div>}
                      {!o.email && !o.phone && <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>{vehicleCounts[o.id] ?? 0}</TableCell>
                    <TableCell>
                      {o.commission_type === "percentage"
                        ? `${o.commission_value}%`
                        : `${formatCurrency(o.commission_value, currency)} / ${o.flat_fee_period === "per_month" ? "month" : "rental"}`}
                    </TableCell>
                    <TableCell className="capitalize">{o.payout_frequency.replace("_", " ")}</TableCell>
                    <TableCell className="text-right">
                      {(outstandingPerOwner[o.id] ?? 0) > 0
                        ? <span className="text-orange-700 dark:text-orange-400">{formatCurrency(outstandingPerOwner[o.id], currency)}</span>
                        : <span className="text-muted-foreground">{formatCurrency(0, currency)}</span>}
                    </TableCell>
                    <TableCell>
                      {o.is_active
                        ? <Badge variant="outline" className="border-green-300 text-green-700 dark:border-green-800 dark:text-green-400">Active</Badge>
                        : <Badge variant="outline" className="border-gray-300 text-muted-foreground dark:border-gray-700">Inactive</Badge>}
                    </TableCell>
                    <TableCell>
                      <Link href={`/vehicle-owners/${o.id}`}>
                        <Button variant="ghost" size="icon"><Eye className="h-4 w-4" /></Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <OwnerFormDialog open={showAdd} onOpenChange={setShowAdd} />
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
