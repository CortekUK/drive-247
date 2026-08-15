import Link from "next/link";
import {
  CalendarCheck2,
  CalendarX2,
  Clock3,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BookingSummaryDTO } from "@/lib/strategy-call/booking";

type BookingSummaryProps = {
  booking: BookingSummaryDTO;
  processingTimedOut: boolean;
  onRescheduleClick: () => void;
};

function getDisplayDate(booking: BookingSummaryDTO) {
  if (!booking.startsAt) return null;

  const startsAt = new Date(booking.startsAt);
  const endsAt = booking.endsAt ? new Date(booking.endsAt) : null;
  if (Number.isNaN(startsAt.getTime())) return null;

  let timezone = booking.timezone || "UTC";
  let usedUtcFallback = !booking.timezone;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(startsAt);
  } catch {
    timezone = "UTC";
    usedUtcFallback = true;
  }

  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timezone,
  }).format(startsAt);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(startsAt);

  const durationMinutes =
    endsAt && !Number.isNaN(endsAt.getTime()) && endsAt > startsAt
      ? Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)
      : null;

  return { date, time, durationMinutes, usedUtcFallback };
}

function isSafeHttpsUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function BookingSummary({
  booking,
  processingTimedOut,
  onRescheduleClick,
}: BookingSummaryProps) {
  if (booking.status === "processing" && !processingTimedOut) {
    return (
      <section
        aria-labelledby="booking-summary-heading"
        aria-live="polite"
        className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5 dark:border-indigo-400/20 dark:bg-indigo-400/[0.07] sm:p-6"
      >
        <div className="flex items-start gap-3">
          <LoaderCircle
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 animate-spin text-indigo-600 motion-reduce:animate-none dark:text-indigo-400"
          />
          <div>
            <h2 id="booking-summary-heading" className="font-bold">
              Booking details are being confirmed
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Your GHL calendar invite is still valid. We&apos;ll show the date
              and time here as soon as the secure booking record arrives.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (booking.status === "cancelled") {
    return (
      <section
        aria-labelledby="booking-summary-heading"
        className="rounded-2xl border border-red-200 bg-red-50/60 p-5 dark:border-red-400/20 dark:bg-red-400/[0.07] sm:p-6"
      >
        <div className="flex items-start gap-3">
          <CalendarX2
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-red-700 dark:text-red-300"
          />
          <div>
            <h2 id="booking-summary-heading" className="font-bold">
              This strategy call was cancelled
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              The videos are still available below. When you&apos;re ready,
              choose a new time on the booking page.
            </p>
            <Button asChild className="mt-4 min-h-11 bg-indigo-600 text-white hover:bg-indigo-700">
              <Link href="/strategy-call">Book another time</Link>
            </Button>
          </div>
        </div>
      </section>
    );
  }

  // Nothing to show, so show nothing. This used to render a "Looking for your
  // booking details?" card, which only ever appeared for someone who had NOT
  // booked — it pushed the first video down the page to tell a visitor
  // something they already knew. Funnel owner asked for it gone.
  //
  // Note this is deliberately only the empty state: a prospect who HAS booked
  // still gets their date, time and timezone below.
  if (
    booking.status === "missing" ||
    processingTimedOut ||
    !booking.canShowDetails
  ) {
    return null;
  }

  const display = getDisplayDate(booking);
  const canReschedule = isSafeHttpsUrl(booking.rescheduleUrl);

  return (
    <section
      aria-labelledby="booking-summary-heading"
      className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-400/20 dark:bg-emerald-400/[0.07] sm:p-6"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <CalendarCheck2
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300"
          />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="booking-summary-heading" className="font-bold">
                {booking.status === "rescheduled"
                  ? "Your updated call time"
                  : "Your strategy call"}
              </h2>
              <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white dark:bg-emerald-300 dark:text-emerald-950">
                {booking.status === "rescheduled" ? "Rescheduled" : "Booked"}
              </span>
            </div>

            {display ? (
              <div className="mt-3 text-sm">
                <p className="font-semibold">{display.date}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {display.time}
                  {display.durationMinutes
                    ? ` · ${display.durationMinutes} minutes`
                    : ""}
                </p>
                {display.usedUtcFallback ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Timezone information was unavailable, so this time is shown
                    in UTC. Check your calendar invite before the call.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Check your GHL calendar invite for the confirmed date and time.
              </p>
            )}
          </div>
        </div>

        {canReschedule ? (
          <Button asChild variant="outline" className="min-h-11 shrink-0">
            <a
              href={booking.rescheduleUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onRescheduleClick}
            >
              Reschedule
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-emerald-200/70 pt-4 text-xs text-muted-foreground dark:border-emerald-400/15">
        <Clock3 aria-hidden="true" className="size-4 shrink-0" />
        Your meeting link remains private in your calendar invite.
      </div>
    </section>
  );
}
