"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useCalendarBlocks } from "@/hooks/use-calendar-blocks";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { CalendarView } from "@/components/rentals/calendar/calendar-view";
import type { RentalFilters } from "@/hooks/use-enhanced-rentals";
import { VehicleTimelinePricing } from "./vehicle-pricing";
import { EMPTY_TIMELINE, shiftDay, tenantToday, type TimelineScope } from "./model";
import { TimelineBoard, initialTimelineView, type TimelineRange } from "./timeline-board";
import { BlockDatesDialog } from "./timeline-dialogs";
import { useTimelineData } from "./use-timeline-data";

/** The live adapter. The board itself never imports Supabase or manufactures records. */
export function ConnectedTimeline({ scope, compact = false, heading, initialFilters }: { scope: TimelineScope; compact?: boolean; heading?: string; initialFilters?: RentalFilters }) {
  const { tenant, loading: tenantLoading, error: tenantError } = useTenant();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { canView, canEdit, isLoading: permissionsLoading } = useManagerPermissions();
  const allowed = !permissionsLoading && canView(scope.kind === "customer" ? "customers" : scope.kind === "vehicle" ? "vehicles" : "rentals");
  const today = tenantToday(tenant?.timezone);
  const [range, setRange] = useState<TimelineRange>(() => ({ start: shiftDay(today, -2), days: compact ? 7 : 14, period: compact ? "week" : "fortnight" }));
  const query = useTimelineData(scope, range.start, shiftDay(range.start, range.days - 1), allowed);
  const { createBlock } = useCalendarBlocks();
  const viewState = useState(() => ({ ...initialTimelineView(scope.kind === "customer" || scope.kind === "vehicle" ? scope.kind : "rental"), search: initialFilters?.search ?? "", statuses: initialFilters?.status && initialFilters.status !== "all" ? [initialFilters.status[0].toUpperCase() + initialFilters.status.slice(1).toLowerCase()] : [] }));
  const [paymentMode, setPaymentMode] = useState(initialFilters?.paymentMode ?? "all");
  const [blockStart, setBlockStart] = useState(today);
  const [blockOpen, setBlockOpen] = useState(false);
  const expandOpener = useRef<HTMLElement | null>(null);
  const expand = () => { expandOpener.current = document.activeElement as HTMLElement; setExpanded(true); };
  const [expanded, setExpanded] = useState(false);
  const [legacyTools, setLegacyTools] = useState(false);
  const source = allowed ? query.data ?? EMPTY_TIMELINE : EMPTY_TIMELINE;
  const data = paymentMode === "all" ? source : { ...source, bookings: source.bookings.filter(b => b.paymentMode === paymentMode) };
  const currency = tenant?.currency_code || "USD";
  const writableAvailability = !permissionsLoading && canEdit("availability") && (scope.kind === "all" || scope.kind === "vehicle");
  const boardProps = {
    data, range, onRange: setRange, viewState, today, currency, timezone: tenant?.timezone,
    perspective: scope.kind === "customer" || scope.kind === "vehicle" ? scope.kind : "rental" as const,
    fixedPerspective: scope.kind !== "all", loading: query.isLoading || permissionsLoading || tenantLoading,
    error: tenantError ? "The account could not be loaded. Try refreshing the page." : query.error ? "We couldn't load this timeline. Your records have not changed." : !allowed && !permissionsLoading ? "Your role does not have access to rental timelines." : null,
    onRetry: allowed ? () => { void query.refetch(); } : undefined,
    onOpenRental: canView("rentals") ? (id: string) => router.push(`/rentals/${id}`) : undefined,
    onBlock: writableAvailability && !query.isLoading && !query.error && allowed ? (date: string) => { setBlockStart(date); setBlockOpen(true); } : undefined,
    heading,
  };
  const rates = scope.kind === "vehicle" ? data.vehicles[0] : null;
  return <div className="min-w-0">
    {scope.kind === "all" && allowed && <div className="mb-3 flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{legacyTools ? "Existing calendar tools" : "Rental calendar"}</span><Button variant="ghost" size="sm" onClick={() => setLegacyTools(v => !v)}>{legacyTools ? "Back to timeline" : "Pricing & existing tools"}</Button></div>}
    {rates && <VehicleTimelinePricing vehicle={rates} currency={currency} />}
    {paymentMode !== "all" && <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">Payment mode: {paymentMode}<Button size="sm" variant="ghost" onClick={() => setPaymentMode("all")}>Clear payment filter</Button></div>}
    {legacyTools && allowed ? <CalendarView filters={{}} /> : <TimelineBoard {...boardProps} compact={compact} onExpand={compact ? expand : undefined} />}
    <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent onCloseAutoFocus={e => { e.preventDefault(); expandOpener.current?.focus(); }} className="tl-dialog w-[calc(100vw-2rem)] max-h-[90svh] overflow-auto sm:max-w-[1180px] rounded-2xl"><DialogHeader><DialogTitle>{heading || "Booking timeline"}</DialogTitle><DialogDescription>The same bookings, with more room to explore.</DialogDescription></DialogHeader><TimelineBoard {...boardProps} /></DialogContent></Dialog>
    {blockOpen && <BlockDatesDialog vehicles={data.vehicles} vehicleId={scope.kind === "vehicle" ? scope.id : undefined} start={blockStart} onClose={() => setBlockOpen(false)} onConfirm={async input => {
      if (!allowed || !writableAvailability) throw new Error("Your access has changed. You can no longer block dates from this view.");
      await createBlock.mutateAsync(input);
      await queryClient.invalidateQueries({ queryKey: ["timeline-v2", tenant?.id] });
      await queryClient.invalidateQueries({ queryKey: ["blocked-dates"] });
    }} />}
  </div>;
}
