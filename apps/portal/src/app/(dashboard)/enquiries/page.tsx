"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Inbox, Loader2, Search, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  useEnquiries,
  type Enquiry,
  type EnquiryStatus,
} from "@/hooks/use-enquiries";
import { useEnquiryStats } from "@/hooks/use-enquiry-stats";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { EnquiryDetailDrawer } from "@/components/enquiries/enquiry-detail-drawer";
import { useTenant } from "@/contexts/TenantContext";
import { useIsAreaHidden, useIsLean } from "@/lib/lean-context";
import { useForcedEmptyState } from "@/hooks/use-forced-empty-state";
import { bookingOriginFor } from "@/lib/booking-origin";
import { EnquiriesTeachingEmptyState } from "@/components/empty-states/enquiries-empty-state";
import { useV2 } from "@/lib/v2-context";
import { usePageSearch } from "@/components/shared/layout/page-search-slot";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonRows } from "@/lib/skeleton-data";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";

/** Placeholder inquiries for the v2 skeleton: only their shapes are ever seen. */
const SKELETON_ENQUIRIES: Enquiry[] = skeletonRows(6, (f) => ({
  id: f.id,
  tenant_id: "",
  customer_id: null,
  customer_name: f.text(2, 3),
  customer_email: `${f.word(6, 10)}@${f.word(5, 8)}.com`,
  customer_phone: "",
  vehicle_id: f.id,
  start_date: f.date(-f.int(1, 20)),
  end_date: f.date(-f.int(21, 40)),
  description: "",
  status: f.pick(["new", "contacted", "resolved"] as const),
  is_read: true,
  read_at: null,
  read_by: null,
  source: "",
  created_at: f.date(),
  updated_at: f.date(),
  vehicle: { id: f.id, reg: f.word(6, 8), make: f.word(4, 8), model: f.word(3, 7) },
}));
const SKELETON_STATS = { pending: 12, contacted: 34, resolved: 56, totalThisMonth: 78 };

/** v1's stand-in for <AutoSkeleton>: renders the region as it always was. */
function PlainRegion({ children }: { loading: boolean; className?: string; children: ReactNode }) {
  return <>{children}</>;
}

const STATUS_FILTERS: { value: EnquiryStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "resolved", label: "Resolved" },
];

const STATUS_TEXT: Record<EnquiryStatus, string> = {
  new: "text-blue-600 dark:text-blue-400",
  contacted: "text-amber-600 dark:text-amber-400",
  resolved: "text-green-600 dark:text-green-400",
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

  const v2Chrome = useV2("chrome");
  const { data: loadedEnquiries = [], isLoading: enquiriesLoading } = useEnquiries(filter);
  const { data: loadedStats, isLoading: statsLoading } = useEnquiryStats();
  // v2: while the list loads, the page renders placeholder inquiries through
  // its real stats and table, and <AutoSkeleton> turns that into the skeleton.
  // v1 keeps its spinner in the table, on the real loading flag.
  const skeletonLoading = useSkeletonLoading(enquiriesLoading || statsLoading);
  const isLoading = v2Chrome ? skeletonLoading : enquiriesLoading;
  const enquiries = v2Chrome && isLoading ? SKELETON_ENQUIRIES : loadedEnquiries;
  const stats = v2Chrome && isLoading ? SKELETON_STATS : loadedStats;

  // Teaching empty state (illustration-guide §4a): lean tenants only, when the
  // tenant has no inquiries at all. Decided from the per-status counts, which
  // ignore the search and status filter — a filtered miss keeps the normal
  // page. The /dev force switch sits inside the lean gate.
  const { tenantSlug } = useTenant();
  const leanTenant = useIsLean();
  const devForceEmpty = useForcedEmptyState("enquiries");
  const noEnquiriesAtAll =
    !!stats && stats.pending + stats.contacted + stats.resolved === 0;
  const teachEmptyEnquiries = !(v2Chrome && isLoading) && leanTenant && (noEnquiriesAtAll || devForceEmpty);

  /* v2: the search lives in the top bar (page-search-slot.tsx). The count is
     withheld until the debounce has caught up, so it always describes the term. */
  usePageSearch(
    v2Chrome && !teachEmptyEnquiries
      ? {
          placeholder: "Search by name, email, phone, or message…",
          value: search,
          onChange: setSearch,
          scopeLabel: "Inquiries",
          resultCount: isLoading || debouncedSearch !== search.trim() ? undefined : enquiries.length,
        }
      : null,
  );

  if (!canView("enquiries")) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        You don't have access to inquiries.
      </div>
    );
  }

  // v2 wraps the data half in the auto skeleton; v1's markup stays exactly as it was.
  const SkeletonRegion = v2Chrome ? AutoSkeleton : PlainRegion;

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
      {!teachEmptyEnquiries && (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong className="font-semibold">Inquiries are moving to Leads.</strong>{" "}
        New submissions now appear in the full lead pipeline. This page is read-only and will be
        removed after the next release.{" "}
        <a href="/leads" className="font-medium underline underline-offset-2">Open Leads →</a>
      </div>
      )}
      <div>
        <h1 className="text-2xl md:text-3xl font-medium tracking-tight">Inquiries</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customer inquiries from the booking site, including requests for currently booked vehicles.
        </p>
      </div>

      {teachEmptyEnquiries ? (
        <EnquiriesTeachingEmptyState
          onOpenBookingSite={
            tenantSlug
              ? () => window.open(bookingOriginFor(tenantSlug), "_blank", "noopener,noreferrer")
              : undefined
          }
        />
      ) : (
      <SkeletonRegion loading={isLoading} className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="New" value={stats?.pending ?? 0} highlight />
        <StatCard label="Contacted" value={stats?.contacted ?? 0} />
        <StatCard label="Resolved" value={stats?.resolved ?? 0} />
        <StatCard label="This month" value={stats?.totalThisMonth ?? 0} />
      </div>

      {/* Filter bar */}
      <Card className="border-border/60">
        <CardContent className="p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          {!v2Chrome && (
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, phone, or message…"
              className="pl-9"
            />
          </div>
          )}
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as EnquiryStatus | "all")}>
            <SelectTrigger className="md:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">All inquiries</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && !v2Chrome ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : enquiries.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center text-muted-foreground">
              <Inbox className="w-10 h-10 mb-3" />
              <p className="text-sm">No inquiries match your filters yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-indigo-50 dark:bg-indigo-950/30">
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
                      className={`cursor-pointer ${!e.is_read ? "font-medium" : ""}`}
                      onClick={() => handleRowClick(e.id)}
                    >
                      <TableCell>{safeDate(e.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{e.customer_name}</span>
                          <span className="text-xs text-muted-foreground">{e.customer_email}</span>
                        </div>
                      </TableCell>
                      <TableCell>{vehicleLabel}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {safeDate(e.start_date)} → {safeDate(e.end_date)}
                      </TableCell>
                      <TableCell>
                        <span className={STATUS_TEXT[e.status]}>{STATUS_LABEL[e.status]}</span>
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
          )}
        </CardContent>
      </Card>
      </SkeletonRegion>
      )}

      <EnquiryDetailDrawer
        enquiryId={selectedId}
        open={drawerOpen}
        onOpenChange={handleDrawerOpenChange}
      />
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`text-2xl font-medium mt-1 ${
            highlight ? "text-indigo-600 dark:text-indigo-400" : ""
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export default function EnquiriesPage() {
  const { tenantSlug } = useTenant();
  const enquiriesHidden = useIsAreaHidden("enquiries");
  if (enquiriesHidden) notFound();

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <EnquiriesPageContent />
    </Suspense>
  );
}
