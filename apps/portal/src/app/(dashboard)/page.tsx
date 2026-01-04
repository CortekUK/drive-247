"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarIcon, Plus } from "lucide-react";
import { DashboardKPICards } from "@/components/dashboard/dashboard-kpi-cards";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { FleetOverview } from "@/components/dashboard/fleet-overview";
import { ComplianceOverviewCard } from "@/components/dashboard/compliance-overview-card";
import { ActionItems } from "@/components/dashboard/action-items";
import { useDashboardKPIs } from "@/hooks/use-dashboard-kpis";
import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subMonths,
} from "date-fns";

interface DateRange {
  from: string;
  to: string;
  label: string;
}

const getDateRanges = (): DateRange[] => {
  const now = new Date();
  return [
    {
      from: format(startOfMonth(now), "yyyy-MM-dd"),
      to: format(endOfMonth(now), "yyyy-MM-dd"),
      label: "This Month",
    },
    {
      from: format(startOfMonth(subMonths(now, 1)), "yyyy-MM-dd"),
      to: format(endOfMonth(subMonths(now, 1)), "yyyy-MM-dd"),
      label: "Last Month",
    },
    {
      from: format(startOfYear(now), "yyyy-MM-dd"),
      to: format(endOfYear(now), "yyyy-MM-dd"),
      label: "This Year",
    },
  ];
};

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appUser } = useAuth();
  const { tenant } = useTenant();

  // Get date range from URL or default to "This Month"
  const dateRanges = getDateRanges();
  const defaultRange = dateRanges[0]; // This Month
  const selectedRangeLabel = searchParams.get("range") || "This Month";
  const selectedRange =
    dateRanges.find((r) => r.label === selectedRangeLabel) || defaultRange;

  // Use custom from/to if provided in URL, otherwise use selected range
  const from = searchParams.get("from") || selectedRange.from;
  const to = searchParams.get("to") || selectedRange.to;

  // Fetch dashboard KPIs
  const {
    data: kpis,
    isLoading,
    error,
  } = useDashboardKPIs({
    from,
    to,
    timezone: "America/New_York",
  });

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  // Extract first name from tenant admin name or user name
  const getFirstName = () => {
    const name = tenant?.admin_name || appUser?.name;
    if (!name) return "";
    const names = name.trim().split(" ");
    return names[0];
  };

  const handleDateRangeChange = (value: string) => {
    const range = dateRanges.find((r) => r.label === value);
    if (range) {
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set("range", range.label);
      newParams.set("from", range.from);
      newParams.set("to", range.to);
      router.push(`?${newParams.toString()}`);
    }
  };

  return (
    <div className="container mx-auto py-4 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {getGreeting()}{getFirstName() ? `, ${getFirstName()}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here's what's happening with your business today
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => router.push("/rentals/new")}>
            <Plus className="h-4 w-4 mr-2" />
            New Rental
          </Button>
        </div>
      </div>

      {/* Action Items */}
      <ActionItems />

      {/* Fleet Overview */}
      <FleetOverview />

      {/* Recent Activity */}
      <div className="grid gap-6">
        <RecentActivity />
      </div>
    </div>
  );
}
