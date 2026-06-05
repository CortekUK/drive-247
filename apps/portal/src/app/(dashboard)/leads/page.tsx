"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Filter, Plus, Flame, ThermometerSun, Snowflake, AlertTriangle, ExternalLink } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useTenant } from "@/contexts/TenantContext";
import { useLeads, type LeadFilters } from "@/hooks/use-leads";
import { useLeadBoard } from "@/hooks/use-lead-board";
import { LeadBoard } from "@/components/leads/lead-board";
import { LeadList } from "@/components/leads/lead-list";
import { NewLeadDialog } from "@/components/leads/new-lead-dialog";
import { getApplyUrl } from "@/lib/booking-url";
import { toast } from "sonner";

type TabValue = "active" | "waitlist" | "lost" | "blacklisted";

const BAND_OPTIONS: { value: LeadFilters["scoreBand"] | "all"; label: string; Icon: typeof Flame }[] = [
  { value: "all", label: "All scores", Icon: Filter },
  { value: "hot", label: "Hot", Icon: Flame },
  { value: "warm", label: "Warm", Icon: ThermometerSun },
  { value: "cold", label: "Cold", Icon: Snowflake },
  { value: "risk", label: "Risk", Icon: AlertTriangle },
];

const SOURCE_OPTIONS = [
  { value: "all", label: "All sources" },
  { value: "application", label: "Application" },
  { value: "quick_enquiry", label: "Quick enquiry" },
  { value: "phone_in", label: "Phone-in" },
  { value: "walk_in", label: "Walk-in" },
  { value: "admin_manual", label: "Admin-created" },
  { value: "inbound_sms", label: "Inbound SMS" },
  { value: "inbound_email", label: "Inbound email" },
  { value: "inbound_whatsapp", label: "Inbound WhatsApp" },
  { value: "legacy_enquiry", label: "Legacy enquiry" },
];

export default function LeadsPage() {
  const { tenant, tenantSlug } = useTenant();
  const [tab, setTab] = useState<TabValue>("active");
  const [search, setSearch] = useState("");
  const [scoreBand, setScoreBand] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const applyUrl = getApplyUrl(tenantSlug);

  const copyApplyLink = () => {
    if (!applyUrl) return;
    navigator.clipboard?.writeText(applyUrl);
    toast.success("Apply link copied");
  };

  const sharedFilters: LeadFilters = useMemo(() => {
    const f: LeadFilters = {};
    if (search.trim()) f.search = search.trim();
    if (scoreBand !== "all") f.scoreBand = scoreBand as LeadFilters["scoreBand"];
    if (source !== "all") f.source = source;
    return f;
  }, [search, scoreBand, source]);

  const board = useLeadBoard(sharedFilters);
  const waitlist = useLeads({ ...sharedFilters, stages: ["waitlist"] });
  const lost = useLeads({ ...sharedFilters, stages: ["lost"] });
  const blacklisted = useLeads({ ...sharedFilters, stages: ["blacklisted"] });

  // Lead-management gate (spec §6.3 Empty state)
  if (tenant && (tenant as { lead_management_enabled?: boolean }).lead_management_enabled === false) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="mb-2 text-2xl font-medium text-[#080812]">Lead Management is off</h1>
        <p className="mb-6 text-sm text-[#737373]">
          Turn it on in settings to start capturing applications and managing your pipeline.
        </p>
        <Button asChild>
          <Link href="/settings/lead-management">Enable Lead Management</Link>
        </Button>
      </main>
    );
  }

  const totalActive = board.columns.reduce((acc, c) => acc + c.leads.length, 0);
  const isEmpty =
    !board.isLoading && totalActive === 0 && (waitlist.data?.length ?? 0) === 0;

  return (
    <main className="container mx-auto px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-medium text-[#080812]">Leads</h1>
          <p className="mt-1 text-sm text-[#737373]">
            Manage your full lead-to-rental pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={copyApplyLink} disabled={!applyUrl}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Share apply link
          </Button>
          <Button size="sm" onClick={() => setNewLeadOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Lead
          </Button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#737373]" />
          <Input
            placeholder="Search name, phone, email…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={scoreBand} onValueChange={setScoreBand}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {BAND_OPTIONS.map((b) => (
              <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="active">Active ({totalActive})</TabsTrigger>
          <TabsTrigger value="waitlist">Waitlist ({waitlist.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="lost">Lost ({lost.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="blacklisted">Blacklisted ({blacklisted.data?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          {board.isLoading ? (
            <div className="text-sm text-[#737373]">Loading…</div>
          ) : isEmpty ? (
            <div className="rounded-lg border border-dashed border-[#f1f5f9] bg-white p-12 text-center">
              <h3 className="text-base font-medium text-[#080812]">No leads yet</h3>
              <p className="mt-1 text-sm text-[#737373]">
                Share your apply link to start collecting applications:{" "}
                <code className="rounded bg-[#f1f5f9] px-1.5 py-0.5 text-xs">
                  {applyUrl || "your-tenant/apply"}
                </code>
              </p>
            </div>
          ) : (
            <LeadBoard
              columns={board.columns}
              staleThresholdHours={(tenant as { lead_stale_threshold_hours?: number })?.lead_stale_threshold_hours ?? 48}
            />
          )}
        </TabsContent>

        <TabsContent value="waitlist" className="mt-4">
          <LeadList leads={waitlist.data ?? []} emptyLabel="No leads on the waitlist." />
        </TabsContent>
        <TabsContent value="lost" className="mt-4">
          <LeadList leads={lost.data ?? []} emptyLabel="No lost leads yet." />
        </TabsContent>
        <TabsContent value="blacklisted" className="mt-4">
          <LeadList leads={blacklisted.data ?? []} emptyLabel="No leads have been blacklisted." />
        </TabsContent>
      </Tabs>

      <NewLeadDialog open={newLeadOpen} onOpenChange={setNewLeadOpen} />
    </main>
  );
}
