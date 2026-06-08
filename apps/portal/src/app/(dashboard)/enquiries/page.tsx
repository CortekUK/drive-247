"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Inbox, Search, MessageSquare } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  KpiTile,
  TableTile,
  bentoTable,
  Segmented,
  StatusPill,
  type StatusTone,
  EmptyState,
  TableSkeleton,
  KpiTileSkeletonRow,
} from "@/components/bento";
import {
  useEnquiries,
  type EnquiryStatus,
} from "@/hooks/use-enquiries";
import { useEnquiryStats } from "@/hooks/use-enquiry-stats";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { EnquiryDetailDrawer } from "@/components/enquiries/enquiry-detail-drawer";

const STATUS_FILTERS: { value: EnquiryStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "resolved", label: "Resolved" },
];

const STATUS_TONE: Record<EnquiryStatus, StatusTone> = {
  new: "info",
  contacted: "warn",
  resolved: "success",
};

const STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: "New",
  contacted: "Contacted",
  resolved: "Resolved",
};

function safeDate(s: string) {
  try {
    return format(parseISO(s), "PP");
  } catch {
    return s;
  }
}

function EnquiriesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialId = searchParams?.get("id") ?? null;

  const [statusFilter, setStatusFilter] = useState<EnquiryStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [drawerOpen, setDrawerOpen] = useState(!!initialId);

  const { canView } = useManagerPermissions();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Open drawer if URL had an ?id=… on load.
  useEffect(() => {
    if (initialId) {
      setSelectedId(initialId);
      setDrawerOpen(true);
    }
  }, [initialId]);

  const filter = useMemo(
    () => ({
      status: statusFilter === "all" ? undefined : ([statusFilter] as EnquiryStatus[]),
      search: debouncedSearch || undefined,
    }),
    [statusFilter, debouncedSearch],
  );

  const { data: enquiries = [], isLoading } = useEnquiries(filter);
  const { data: stats } = useEnquiryStats();

  if (!canView("enquiries")) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        You don't have access to enquiries.
      </div>
    );
  }

  const handleRowClick = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };

  const handleDrawerOpenChange = (open: boolean) => {
    setDrawerOpen(open);
    if (!open) {
      // Strip ?id=… from the URL when closing so refresh / back doesn't reopen it.
      const next = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
      next.delete("id");
      const qs = next.toString();
      router.replace(qs ? `/enquiries?${qs}` : "/enquiries");
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong className="font-semibold">Enquiries are moving to Leads.</strong>{" "}
        New submissions now appear in the full lead pipeline. This page is read-only and will be
        removed after the next release.{" "}
        <a href="/leads" className="font-medium underline underline-offset-2">Open Leads →</a>
      </div>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Enquiries</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customer enquiries from the booking site, including requests for currently booked vehicles.
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          variant="feature"
          label="New"
          value={stats?.pending ?? 0}
          icon={<Inbox className="h-4 w-4" />}
        />
        <KpiTile label="Contacted" value={stats?.contacted ?? 0} />
        <KpiTile label="Resolved" value={stats?.resolved ?? 0} />
        <KpiTile label="This month" value={stats?.totalThisMonth ?? 0} />
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : enquiries.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" />}
          title="No enquiries yet"
          description="No enquiries match your filters. New customer enquiries from the booking site will appear here."
        />
      ) : (
        <TableTile
          toolbar={
            <>
              <Segmented
                options={STATUS_FILTERS}
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v)}
              />
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, email, phone, or message…"
                  className="pl-9"
                />
              </div>
            </>
          }
        >
          <Table>
            <TableHeader className={bentoTable.header}>
              <TableRow>
                <TableHead>Submitted</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enquiries.map((e) => {
                const vehicleLabel = e.vehicle
                  ? [e.vehicle.make, e.vehicle.model].filter(Boolean).join(" ") || e.vehicle.reg
                  : e.vehicle_id
                    ? "Vehicle removed"
                    : "Any";
                return (
                  <TableRow
                    key={e.id}
                    className={`${bentoTable.row} ${!e.is_read ? "font-semibold" : ""}`}
                    onClick={() => handleRowClick(e.id)}
                  >
                    <TableCell className="font-mono tabular-nums text-[color:var(--bento-text-2)]">
                      {safeDate(e.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-foreground">{e.customer_name}</span>
                        <span className="text-xs text-muted-foreground">{e.customer_email}</span>
                      </div>
                    </TableCell>
                    <TableCell>{vehicleLabel}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono tabular-nums text-[color:var(--bento-text-2)]">
                      {safeDate(e.start_date)} → {safeDate(e.end_date)}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={STATUS_TONE[e.status]} dot>
                        {STATUS_LABEL[e.status]}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleRowClick(e.id);
                        }}
                      >
                        <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableTile>
      )}

      <EnquiryDetailDrawer
        enquiryId={selectedId}
        open={drawerOpen}
        onOpenChange={handleDrawerOpenChange}
      />
    </div>
  );
}

export default function EnquiriesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 space-y-6">
          <KpiTileSkeletonRow count={4} />
          <TableSkeleton rows={6} cols={6} />
        </div>
      }
    >
      <EnquiriesPageContent />
    </Suspense>
  );
}
