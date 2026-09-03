"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CalendarClock,
  Gauge,
  RefreshCw,
  Search,
  ShieldAlert,
  Wrench,
  HelpCircle,
} from "lucide-react";

import { useFleetHealth, useFleetHealthStats, useRecomputeFleetHealth } from "@/hooks/use-fleet-health";
import { useTenant } from "@/contexts/TenantContext";
// The column below renders vehicles.current_mileage, which Fleet Health stores
// in miles for every tenant. It was printed raw under a unit-less "Mileage"
// header, so a km tenant read a mile count with nothing saying so.
import { fromStoredMiles } from "@/lib/fleet-health-units";
import { getDistanceUnitLong, type DistanceUnit } from "@/lib/format-utils";
import { useMaintenanceJobs } from "@/hooks/use-maintenance-jobs";
import { HealthStatusChip } from "@/components/fleet-health/health-status-chip";
import { HealthReasonsList } from "@/components/fleet-health/health-reasons-list";
import { FleetHealthSetup } from "@/components/fleet-health/fleet-health-setup";
import { RecordOdometerDialog } from "@/components/fleet-health/record-odometer-dialog";
import { ScheduleMaintenanceDialog } from "@/components/fleet-health/schedule-maintenance-dialog";
import { CompleteJobDialog } from "@/components/fleet-health/complete-job-dialog";
import { MaintenanceRulesEditor } from "@/components/fleet-health/maintenance-rules-editor";
import {
  HEALTH_STATUS_LABEL,
  JOB_PRIORITY_LABEL,
  JOB_STATUS_LABEL,
  type MaintenanceJob,
  type VehicleHealthRow,
  type VehicleHealthStatus,
} from "@/types/fleet-health";

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-medium text-foreground">{value}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#eef2ff] dark:bg-muted">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type StatusFilter = "all" | "needs_attention" | VehicleHealthStatus;

export default function FleetHealthPage() {
  const { data: rows = [], isLoading } = useFleetHealth();
  const stats = useFleetHealthStats();
  const recompute = useRecomputeFleetHealth();
  const { data: openJobs = [] } = useMaintenanceJobs({ status: "open" });

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  // Lets an operator look past the setup screen without abandoning setup entirely.
  const [setupDismissed, setSetupDismissed] = useState(false);

  const [odometerFor, setOdometerFor] = useState<VehicleHealthRow | null>(null);
  const { tenant } = useTenant();
  const distanceUnit = (tenant?.distance_unit || 'miles') as DistanceUnit;
  const [scheduleFor, setScheduleFor] = useState<VehicleHealthRow | null>(null);
  const [completing, setCompleting] = useState<MaintenanceJob | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesStatus =
        statusFilter === "all"
          ? true
          : statusFilter === "needs_attention"
            ? ["not_road_legal", "overdue", "attention"].includes(r.status)
            : r.status === statusFilter;

      const matchesSearch =
        !q ||
        r.reg.toLowerCase().includes(q) ||
        `${r.make ?? ""} ${r.model ?? ""}`.toLowerCase().includes(q);

      return matchesStatus && matchesSearch;
    });
  }, [rows, statusFilter, search]);

  /**
   * Below 25% odometer coverage the list is almost entirely "Unknown", which reads
   * as broken software rather than as missing input — and the operator has no other
   * way to fix it, because this is the only odometer-entry path in the product.
   * Show the setup screen instead of the table.
   */
  const showSetup = stats.shouldShowSetup && !setupDismissed;

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium text-foreground">Fleet Health</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What is due, what is overdue, and which vehicles need attention before they
            affect a rental.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => recompute.mutate(undefined)}
          disabled={recompute.isPending}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${recompute.isPending ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
          label="Needs attention"
          value={String(stats.needsAttention)}
        />
        <StatCard
          icon={<ShieldAlert className="h-5 w-5 text-red-600" />}
          label="Not road legal"
          value={String(stats.counts.not_road_legal ?? 0)}
        />
        <StatCard
          icon={<CalendarClock className="h-5 w-5 text-red-600" />}
          label="Overdue"
          value={String(stats.counts.overdue ?? 0)}
        />
        <StatCard
          icon={<Wrench className="h-5 w-5 text-slate-600" />}
          label="Off road"
          value={String(stats.counts.off_road ?? 0)}
        />
        <StatCard
          icon={<HelpCircle className="h-5 w-5 text-slate-500" />}
          label="Unknown"
          value={String(stats.counts.unknown ?? 0)}
        />
        <StatCard
          icon={<Gauge className="h-5 w-5 text-[#6366f1]" />}
          label="Vehicles"
          value={String(stats.total)}
        />
      </div>

      {showSetup ? (
        <FleetHealthSetup onSkip={() => setSetupDismissed(true)} />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by registration or model"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger className="w-[210px]">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="needs_attention">Needs attention</SelectItem>
                  <SelectItem value="not_road_legal">
                    {HEALTH_STATUS_LABEL.not_road_legal}
                  </SelectItem>
                  <SelectItem value="overdue">{HEALTH_STATUS_LABEL.overdue}</SelectItem>
                  <SelectItem value="attention">{HEALTH_STATUS_LABEL.attention}</SelectItem>
                  <SelectItem value="off_road">{HEALTH_STATUS_LABEL.off_road}</SelectItem>
                  <SelectItem value="unknown">{HEALTH_STATUS_LABEL.unknown}</SelectItem>
                  <SelectItem value="ok">{HEALTH_STATUS_LABEL.ok}</SelectItem>
                </SelectContent>
              </Select>
              {stats.unseeded > 0 && (
                <span className="text-xs text-muted-foreground">
                  {stats.unseeded} vehicle{stats.unseeded === 1 ? "" : "s"} still need an
                  odometer reading
                </span>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#eef2ff] hover:bg-[#eef2ff]">
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>What needs attention</TableHead>
                    <TableHead>Next due</TableHead>
                    <TableHead>Mileage ({getDistanceUnitLong(distanceUnit)})</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 6 }).map((__, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        {rows.length === 0
                          ? "No vehicles yet."
                          : "No vehicles match these filters."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r) => (
                      <TableRow key={r.vehicle_id}>
                        <TableCell>
                          <Link
                            href={`/vehicles/${r.vehicle_id}`}
                            className="font-medium text-foreground hover:text-[#6366f1]"
                          >
                            {r.reg}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {[r.make, r.model].filter(Boolean).join(" ") || "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <HealthStatusChip status={r.status} compact />
                        </TableCell>
                        <TableCell className="max-w-[360px]">
                          <HealthReasonsList
                            reasons={r.reasons}
                            compact
                            onRecordReading={() => setOdometerFor(r)}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {r.next_due_date ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {r.current_mileage != null
                            ? fromStoredMiles(r.current_mileage, distanceUnit)!.toLocaleString()
                            : <span className="text-muted-foreground">Not recorded</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setOdometerFor(r)}
                            >
                              Reading
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setScheduleFor(r)}
                            >
                              Schedule
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">
                Open maintenance
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({openJobs.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#eef2ff] hover:bg-[#eef2ff]">
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openJobs.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        No open maintenance jobs.
                      </TableCell>
                    </TableRow>
                  ) : (
                    openJobs.map((j) => (
                      <TableRow key={j.id}>
                        <TableCell className="font-medium">
                          {j.vehicles?.reg ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div>{j.title}</div>
                          {j.vendor_name && (
                            <div className="text-xs text-muted-foreground">
                              {j.vendor_name}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {JOB_PRIORITY_LABEL[j.priority] ?? j.priority}
                        </TableCell>
                        <TableCell className="text-sm">
                          {JOB_STATUS_LABEL[j.status] ?? j.status}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {j.scheduled_start
                            ? `${j.scheduled_start}${j.scheduled_end ? ` → ${j.scheduled_end}` : ""}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCompleting(j)}
                          >
                            Complete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Tenant-wide defaults. Secondary on purpose — schedules are opt-in, and
              the feature is useful with none configured. */}
          <MaintenanceRulesEditor />
        </>
      )}

      {odometerFor && (
        <RecordOdometerDialog
          vehicleId={odometerFor.vehicle_id}
          vehicleLabel={odometerFor.reg}
          currentMileage={odometerFor.current_mileage}
          open={!!odometerFor}
          onOpenChange={(open) => {
            if (!open) setOdometerFor(null);
          }}
        />
      )}

      {scheduleFor && (
        <ScheduleMaintenanceDialog
          vehicleId={scheduleFor.vehicle_id}
          vehicleReg={scheduleFor.reg}
          open={!!scheduleFor}
          onOpenChange={(open) => {
            if (!open) setScheduleFor(null);
          }}
        />
      )}

      <CompleteJobDialog
        job={completing}
        open={!!completing}
        onOpenChange={(open) => {
          if (!open) setCompleting(null);
        }}
      />
    </div>
  );
}
