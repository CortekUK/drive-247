"use client";

import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { Button } from "@/components/ui-v2/button";
import type { RentalDetailV2 } from "@/components/rentals-v2/rental-detail/use-rental-detail-v2";
import { EMPTY_TIMELINE, rentalSegments, shiftDay, tenantToday, type TimelineBooking, type TimelineData } from "./model";
import { RentalPeriodCalendar } from "./rental-period-calendar";
import { periodMonth } from "./rental-period-days";
import "./timeline.css";
import { ManualExtensionDialog } from "./timeline-dialogs";
import { useTimelineData } from "./use-timeline-data";

/** A manual date preview only. It does not invoke the billing extension workflow. */
export function RentalPlanView({ data, today, currency, timezone, canPreview = true, loading, error, onRetry, unsupported }: {
  data: TimelineData; today: string; currency: string; timezone?: string | null; canPreview?: boolean;
  loading?: boolean; error?: string | null; onRetry?: () => void; unsupported?: boolean;
}) {
  const booking = data.bookings[0];
  const [previews, setPreviews] = useState<TimelineBooking[]>([]);
  const [month, setMonth] = useState(() => periodMonth(booking?.start || today));
  const [dialog, setDialog] = useState(false);
  const stored = useMemo(() => booking ? rentalSegments(booking, data.extensions) : [], [booking, data.extensions]);
  const segments = [...stored, ...previews];
  const currentEnd = previews.at(-1)?.end || booking?.end;
  const nextSequence = Math.max(0, ...data.extensions.map(e => e.sequence_number)) + previews.length + 1;
  const canExtend = canPreview && !loading && !error && !unsupported && !!currentEnd && !!booking;
  if (loading) return <RentalPeriodLoading />;
  if (error) return <div className="rp-plan-state" role="alert"><strong>Rental periods unavailable</strong><p>{error}</p>{onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}</div>;
  if (unsupported) return <div className="rp-plan-state"><CalendarDays size={22} /><strong>Manual preview unavailable</strong><p>This rental is open-ended or uses automatic billing. Its existing workflow is unchanged. Manual date previews support fixed rentals with a known start and end date.</p></div>;
  if (!booking || !booking.end) return <div className="rp-plan-state"><CalendarDays size={22} /><strong>No rental periods available</strong><p>The calendar needs a recorded start and end date.</p></div>;
  return <div className="rp-plan">
    <RentalPeriodCalendar periods={segments} month={month} onMonth={setMonth} today={today} currency={currency} timezone={timezone} currentEnd={currentEnd} onExtend={canExtend ? () => setDialog(true) : undefined} onDiscard={previews.length ? () => { setPreviews([]); setMonth(periodMonth(booking.start)); } : undefined} />
    {dialog && currentEnd && <ManualExtensionDialog booking={booking} currentEnd={currentEnd} sequence={nextSequence} onClose={() => setDialog(false)} onPreview={(end, note) => {
      const next: TimelineBooking = { ...booking, id: `preview:${booking.id}:${nextSequence}`, start: shiftDay(currentEnd, 1), end, pickupTime: null, returnTime: null, preview: true, segment: `Extension #${nextSequence}`, note: note || "Unsaved date preview · no charges created", amount: null };
      setPreviews(p => [...p, next]); setDialog(false);
      // Follow the latest endpoint without compressing dates or requiring an expanded dialog.
      setMonth(periodMonth(end));
    }} />}
  </div>;
}

function RentalPeriodLoading() {
  return <div className="rp-plan-state rp-plan-loading" aria-busy="true" aria-label="Loading rental periods"><strong>Rental periods</strong><div className="rp-loading-boxes">{Array.from({ length: 8 }, (_, i) => <span key={i} />)}</div></div>;
}

export function RentalPaymentPlan({ detail, rentalId }: { detail?: RentalDetailV2; rentalId?: string }) {
  const { tenant, loading: tenantLoading } = useTenant();
  const { canEdit, canView, isLoading: permissionsLoading } = useManagerPermissions();
  const today = tenantToday(tenant?.timezone);
  const id = detail?.rental.id ?? rentalId ?? "";
  const query = useTimelineData({ kind: "rental", id }, detail?.rental.start_date ?? today, detail?.rental.end_date || today, !permissionsLoading && canView("rentals"));
  const booking = query.data?.bookings[0];
  const unsupported = detail ? !detail.rental.end_date || detail.rental.is_pay_as_you_go === true || detail.rental.auto_extend_enabled === true : !!booking && (!booking.end || booking.isPayAsYouGo === true || booking.autoExtendEnabled === true);
  // Mount the plan only after its source is known, so the initial window is the real start date.
  if (query.isLoading || permissionsLoading || tenantLoading) return <RentalPeriodLoading />;
  return <RentalPlanView key={id} data={canView("rentals") ? query.data ?? EMPTY_TIMELINE : EMPTY_TIMELINE} today={today} currency={tenant?.currency_code || "USD"} timezone={tenant?.timezone} canPreview={canEdit("rentals") && canView("rentals")} unsupported={unsupported} error={query.error ? "The rental periods could not be loaded." : !canView("rentals") ? "Your role does not have access to rental timelines." : null} onRetry={canView("rentals") ? () => { void query.refetch(); } : undefined} />;
}
