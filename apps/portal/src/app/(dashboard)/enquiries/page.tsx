"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
        <h1 className="text-2xl md:text-3xl font-medium tracking-tight">Enquiries</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customer enquiries from the booking site, including requests for currently booked vehicles.
        </p>
      </div>

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
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, phone, or message…"
              className="pl-9"
            />
          </div>
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
          <CardTitle className="text-base font-medium">All enquiries</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : enquiries.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center text-muted-foreground">
              <Inbox className="w-10 h-10 mb-3" />
              <p className="text-sm">No enquiries match your filters yet.</p>
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
