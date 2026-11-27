"use client";

/**
 * Bryan's booking calendar, our own (23 Nov 2026; feat-001 spec 09).
 *
 * One dialog, Bryan on the left the whole time, three steps on the right:
 *
 *   pick     the month (days with a free time in the accent), then the day's
 *            times, in the person's zone ("change" picks another)
 *   details  name, email, phone, anything Bryan should know
 *   done     the booked picture, the time, the call link, add to calendar
 *
 * Opened while a call is booked, it moves the call (same booking, new time).
 *
 * The free times come from the server, the one place they are worked out
 * (spec 02). Times are written by `lib/onboarding-call-time.ts`. The server
 * checks every booking again, so a time taken a second earlier is refused and
 * the page asks for another one.
 */
import { useEffect, useMemo, useState } from "react";
import { addMonths, format, getDay, getDaysInMonth, parseISO } from "date-fns";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Search,
  Video,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Label } from "@/components/ui-v2/label";
import { Textarea } from "@/components/ui-v2/textarea";
import { useAuth } from "@/stores/auth-store";
import { cn } from "@/lib/utils";
import { useCallZone, useOnboardingCallCalendar, type BookedCall } from "@/hooks/use-onboarding-call-calendar";
import { googleCalendarUrl, icsUrl, outlookCalendarUrl, type CallCalendar } from "@/lib/onboarding-call-slots";
import {
  allZones,
  dayKey,
  formatCallFull,
  formatCallShort,
  formatDayHeading,
  formatSlotTime,
  setChosenZone,
  zoneLabel,
} from "@/lib/onboarding-call-time";
import { CallBookedArt } from "@/components/illustrations-v2/scenes/onboarding-call";

type Step = "pick" | "details" | "done";

/** Free times grouped by the person's own day ("yyyy-MM-dd"). */
function slotsByDay(slots: Date[], tz: string): Map<string, Date[]> {
  const map = new Map<string, Date[]>();
  for (const s of slots) {
    const key = dayKey(s, tz);
    const list = map.get(key);
    if (list) list.push(s);
    else map.set(key, [s]);
  }
  return map;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * DRIVE247's own colours, not the company's theme (`--primary` is the
 * tenant's brand): this calendar is Drive247 talking to the company. The
 * indigo and violet of the "247" in the logo.
 */
const BRAND_BUTTON =
  "bg-[#4f46e5] text-white shadow-[0_8px_20px_-8px_rgba(79,70,229,0.7)] hover:bg-[#4338ca] disabled:bg-[#4f46e5]/50 disabled:shadow-none";

export function OnboardingCallBooking({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { appUser } = useAuth();
  const { calendar, book, fake } = useOnboardingCallCalendar({ enabled: open });
  const cal = calendar.data;
  const tz = useCallZone();
  const [zonePicker, setZonePicker] = useState(false);

  const [step, setStep] = useState<Step>("pick");
  const [month, setMonth] = useState<string | null>(null); // "yyyy-MM"
  const [day, setDay] = useState<string | null>(null); // "yyyy-MM-dd"
  const [slot, setSlot] = useState<Date | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<BookedCall | null>(null);

  const slots = useMemo(() => (cal?.slots ?? []).map((s) => new Date(s)), [cal]);
  const byDay = useMemo(() => slotsByDay(slots, tz), [slots, tz]);
  const moving = !!cal?.mine;
  // The first free day, and the month and day actually shown. Worked out
  // here rather than only in the effect below: the effect runs AFTER the
  // first render with data, and a null month there was an "Invalid time
  // value" crash in the month heading.
  const firstDay = slots[0] ? dayKey(slots[0], tz) : null;
  const shownMonth = month ?? (firstDay ? firstDay.slice(0, 7) : dayKey(new Date(), tz).slice(0, 7));
  const shownDay = day && byDay.has(day) ? day : firstDay;

  // Fresh each time it opens: first free day selected, details pre-filled.
  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setSlot(null);
    setError(null);
    setBooked(null);
    setZonePicker(false);
  }, [open]);

  // A new zone can move the first free day: pick it again.
  useEffect(() => {
    setDay(null);
    setMonth(null);
  }, [tz]);

  useEffect(() => {
    if (!open || !cal) return;
    const first = slots[0];
    const firstDay = first ? dayKey(first, tz) : null;
    setDay((d) => (d && byDay.has(d) ? d : firstDay));
    setMonth((m) => m ?? (firstDay ? firstDay.slice(0, 7) : dayKey(new Date(), tz).slice(0, 7)));
    setName((v) => v || cal.mine?.name || appUser?.name || "");
    setEmail((v) => v || cal.mine?.email || appUser?.email || "");
    setPhone((v) => v || cal.mine?.phone || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cal]);

  const submit = () => {
    if (!slot) return;
    setError(null);
    book.mutate(
      { startsAt: slot, name: name.trim(), email: email.trim(), phone: phone.trim(), notes: notes.trim(), timezone: tz },
      {
        onSuccess: (b) => {
          setBooked(b);
          setStep("done");
        },
        onError: (e) => {
          setError((e as Error).message);
          // The time may have gone: read the calendar again for the next pick.
          calendar.refetch();
        },
      },
    );
  };

  const canSubmit = !!slot && name.trim().length > 0 && /.+@.+\..+/.test(email.trim()) && !book.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94vh] flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-[1080px] md:min-h-[640px]">
        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[340px_minmax(0,1fr)] md:overflow-hidden">
          <HostPanel cal={cal} tz={tz} slot={step === "pick" ? null : slot} moving={moving} />

          <div className="min-h-0 p-6 md:overflow-y-auto md:p-10">
            {step === "pick" && (
              <>
                <DialogTitle className="text-[24px] font-semibold tracking-tight">
                  {moving ? "Pick a new time" : "Pick a day and time"}
                </DialogTitle>
                <DialogDescription className="mt-1.5 text-[14px]">
                  {moving && cal?.mine
                    ? `Your call is on ${formatCallFull(cal.mine.starts_at, tz)}. Pick a new time to move it.`
                    : "Days with a free time are marked."}
                </DialogDescription>
                <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
                  <Globe className="size-3.5" aria-hidden="true" />
                  Times are in <span className="font-medium text-foreground">{zoneLabel(tz)}</span>
                  <button
                    type="button"
                    onClick={() => setZonePicker((v) => !v)}
                    className="font-medium text-[#4f46e5] underline-offset-4 hover:underline dark:text-[#a5b4fc]"
                  >
                    {zonePicker ? "done" : "change"}
                  </button>
                </p>

                {zonePicker ? (
                  <ZonePicker
                    current={tz}
                    onPick={(z) => {
                      setChosenZone(z);
                      setZonePicker(false);
                    }}
                  />
                ) : calendar.isLoading ? (
                  <PickSkeleton />
                ) : calendar.isError || !cal ? (
                  <div className="mt-10 flex flex-col items-start gap-3">
                    <p className="text-[14px] text-muted-foreground">The calendar could not be loaded.</p>
                    <Button variant="outline" size="sm" onClick={() => calendar.refetch()}>
                      Try again
                    </Button>
                  </div>
                ) : !cal.is_accepting ? (
                  <p className="mt-10 text-[14px] text-muted-foreground">
                    Bryan is not taking new calls right now. Please check back soon.
                  </p>
                ) : slots.length === 0 ? (
                  <p className="mt-10 text-[14px] text-muted-foreground">
                    Bryan has no free times in the next {cal.max_days_ahead} days. Please check back soon.
                  </p>
                ) : (
                  <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,1fr)_210px]">
                    <MonthGrid
                      month={shownMonth}
                      onMonth={setMonth}
                      day={shownDay}
                      onDay={(d) => {
                        setDay(d);
                        setSlot(null);
                      }}
                      byDay={byDay}
                      tz={tz}
                      firstSlot={slots[0]}
                      lastSlot={slots[slots.length - 1]}
                    />
                    <SlotList
                      day={shownDay}
                      slots={shownDay ? byDay.get(shownDay) ?? [] : []}
                      tz={tz}
                      onPick={(s) => {
                        setSlot(s);
                        setError(null);
                        setStep("details");
                      }}
                    />
                  </div>
                )}
              </>
            )}

            {step === "details" && slot && (
              <div className="flex flex-col gap-5">
                <button
                  type="button"
                  onClick={() => setStep("pick")}
                  className="-ml-1 flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="size-3.5" aria-hidden="true" />
                  Change the time
                </button>
                <div>
                  <DialogTitle className="text-[24px] font-semibold tracking-tight">Your details</DialogTitle>
                  <DialogDescription className="mt-1 text-[13px]">So Bryan knows who he is talking to.</DialogDescription>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Your name" id="call-name">
                    <Input id="call-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                  </Field>
                  <Field label="Email" id="call-email">
                    <Input
                      id="call-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </Field>
                  <Field label="Phone" id="call-phone" optional>
                    <Input id="call-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Anything Bryan should know?" id="call-notes" optional>
                      <Textarea
                        id="call-notes"
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="How many cars you have, where you rent them today, what you want help with."
                      />
                    </Field>
                  </div>
                </div>

                {error && (
                  <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                    {error}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {error && (
                    <Button variant="ghost" onClick={() => setStep("pick")}>
                      Pick another time
                    </Button>
                  )}
                  <Button onClick={submit} disabled={!canSubmit} className={cn("h-11 min-w-[170px] rounded-xl text-[14px]", BRAND_BUTTON)}>
                    {book.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                    {moving ? "Move my call" : "Book the call"}
                  </Button>
                </div>
              </div>
            )}

            {step === "done" && booked && (
              <div className="flex flex-col items-center gap-4 py-2 text-center">
                <CallBookedArt className="max-w-[320px]" />
                <div>
                  <DialogTitle className="text-[26px] font-semibold tracking-tight">
                    {moving ? "Your call has moved" : "You are booked with Bryan"}
                  </DialogTitle>
                  <DialogDescription className="mt-1.5 text-[14px] text-foreground">
                    {formatCallFull(booked.starts_at, tz)}
                  </DialogDescription>
                  {fake && <p className="mt-1 text-[12px] text-muted-foreground">On the fake run nothing is saved.</p>}
                </div>

                {!booked.meeting_url && (
                  <p className="text-[13px] text-muted-foreground">Bryan will send you the call link by email before the call.</p>
                )}
                {booked.meeting_url && (
                  <a
                    href={booked.meeting_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[14px] font-medium text-[#4f46e5] underline-offset-4 hover:underline dark:text-[#a5b4fc]"
                  >
                    <Video className="size-4" aria-hidden="true" />
                    The call link
                  </a>
                )}

                <p className="text-[13px] text-muted-foreground">Add it to your calendar so it does not slip.</p>
                <AddToCalendar
                  booking={booked}
                  title={`Drive247 onboarding call with ${cal?.host_name ?? "Bryan"}`}
                  icsToken={booked.ics_token}
                />
                <Button className={cn("mt-2 h-11 min-w-[140px] rounded-xl", BRAND_BUTTON)} onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function calendarDetails(meetingUrl: string | null | undefined): string {
  return [
    "Your free onboarding call with Bryan from Drive247.",
    meetingUrl ? `Join: ${meetingUrl}` : "The call link will follow by email.",
  ].join("\n");
}

/** Google, Outlook, and Apple or other (the call's own .ics address). Spec 07.24. */
export function AddToCalendar({
  booking,
  title,
  icsToken,
}: {
  booking: { starts_at: string; ends_at: string; meeting_url: string | null };
  title: string;
  icsToken: string | null | undefined;
}) {
  const details = calendarDetails(booking.meeting_url);
  const apple = icsUrl(icsToken);
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Button variant="outline" size="sm" asChild>
        <a href={googleCalendarUrl(booking, title, details, booking.meeting_url)} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Google
        </a>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <a href={outlookCalendarUrl(booking, title, details, booking.meeting_url)} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Outlook
        </a>
      </Button>
      {apple && (
        <Button variant="outline" size="sm" asChild>
          <a href={apple}>
            <Download className="size-3.5" aria-hidden="true" />
            Apple or other
          </a>
        </Button>
      )}
    </div>
  );
}

/** "change": every zone the browser knows, searchable. */
function ZonePicker({ current, onPick }: { current: string; onPick: (tz: string) => void }) {
  const [q, setQ] = useState("");
  const zones = useMemo(() => allZones(), []);
  const now = useMemo(() => new Date(), []);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().replace(/\s+/g, "_");
    return zones.filter((z) => !words || z.toLowerCase().includes(words)).slice(0, 60);
  }, [q, zones]);
  return (
    <div className="mt-5 flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a city, for example London"
          className="pl-9"
          aria-label="Search time zones"
        />
      </div>
      <ul className="max-h-[320px] overflow-y-auto rounded-xl border [scrollbar-width:thin]">
        {shown.map((z) => (
          <li key={z}>
            <button
              type="button"
              onClick={() => onPick(z)}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[14px] hover:bg-muted",
                z === current && "font-semibold text-[#4f46e5] dark:text-[#a5b4fc]",
              )}
            >
              <span className="min-w-0 truncate">{zoneLabel(z)}</span>
              <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{formatSlotTime(now, z)}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-3 text-[13px] text-muted-foreground">No zone matches that.</li>}
      </ul>
    </div>
  );
}

/**
 * The Drive247 side of the dialog: the logo in its own colours, Bryan, the
 * call, and (after the first step) the time picked.
 *
 * A LIGHT panel (review, 23 Nov): on the deep indigo one the "247" of the
 * logo, itself indigo and violet, did not show. Here the black "Drive" and the
 * coloured "247" both read, and the brand colours live in the soft wash and
 * the glows. In dark mode the panel is near-black, which the "247" still
 * stands out on.
 */
function HostPanel({
  cal,
  tz,
  slot,
  moving,
}: {
  cal: CallCalendar | undefined;
  tz: string;
  slot: Date | null;
  moving: boolean;
}) {
  return (
    <aside className="relative isolate flex flex-col gap-7 overflow-hidden border-b border-[#4f46e5]/10 bg-[linear-gradient(165deg,#eef2ff_0%,#f5f3ff_55%,#ede9fe_100%)] p-7 text-[#1e1b4b] md:border-b-0 md:border-r md:p-9 dark:border-white/10 dark:bg-[linear-gradient(165deg,#16142c_0%,#110f22_100%)] dark:text-white">
      {/* The 247 glow: indigo and violet light in the wash. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 -z-10 size-72 rounded-full bg-[#6366f1] opacity-20 blur-3xl dark:opacity-25"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-28 -right-20 -z-10 size-72 rounded-full bg-[#8b5cf6] opacity-20 blur-3xl dark:opacity-25"
      />
      {/* Lines, very faint (Ghulam, 23 Nov): a fine grid that fades out from
          the top right. Decoration only. (Diagonal speed lines in the bottom
          corner were tried and taken out: they did not look good.) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 [--grid:rgba(79,70,229,0.08)] dark:[--grid:rgba(255,255,255,0.05)]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--grid) 1px, transparent 1px), linear-gradient(to bottom, var(--grid) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage: "radial-gradient(130% 75% at 100% 0%, #000 0%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(130% 75% at 100% 0%, #000 0%, transparent 70%)",
        }}
      />

      {/* The logo in its own colours: black "Drive" on the light panel, white
          on the dark one; the "247" is the same in both. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- the Drive247 wordmark from /public */}
      <img src="/drive247-logo-light.png" alt="Drive247" className="h-8 w-auto self-start dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element -- the Drive247 wordmark from /public */}
      <img src="/drive247-logo-dark.png" alt="Drive247" className="hidden h-8 w-auto self-start dark:block" />

      <div className="flex items-center gap-4 md:flex-col md:items-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- a 200px avatar from /public */}
        <img
          src={cal?.host_photo_url || "/team/bryan.jpg"}
          alt=""
          className="size-16 shrink-0 rounded-full object-cover shadow-[0_8px_20px_-10px_rgba(30,27,75,0.5)] ring-4 ring-white md:size-20 dark:ring-white/10"
        />
        <div className="min-w-0">
          <p className="text-[18px] font-semibold leading-tight">{cal?.host_name ?? "Bryan Diaz"}</p>
          <p className="mt-1 text-[13.5px] text-[#1e1b4b]/60 dark:text-white/65">
            {cal?.host_title ?? "Onboarding specialist"} at Drive247
          </p>
        </div>
      </div>

      <div>
        <p className="text-[24px] font-semibold leading-tight tracking-tight">Free onboarding call</p>
        <ul className="mt-4 space-y-2.5 text-[14px] text-[#1e1b4b]/75 dark:text-white/80">
          <li className="flex items-center gap-2.5">
            <Clock className="size-4 shrink-0 text-[#4f46e5]/70 dark:text-white/55" aria-hidden="true" />
            {cal?.duration_minutes ?? 30} minutes
          </li>
          <li className="flex items-center gap-2.5">
            <Video className="size-4 shrink-0 text-[#4f46e5]/70 dark:text-white/55" aria-hidden="true" />
            Video call
          </li>
          <li className="flex items-center gap-2.5">
            <Globe className="size-4 shrink-0 text-[#4f46e5]/70 dark:text-white/55" aria-hidden="true" />
            <span className="truncate">{zoneLabel(tz)}</span>
          </li>
          {/* The time picked: one more line of the list, no box, lined up
              with the rest (Ghulam, 23 Nov), only stronger. */}
          {slot && (
            <li
              className="flex items-center gap-2.5 font-semibold text-[#1e1b4b] dark:text-white"
              title={formatCallFull(slot, tz)}
            >
              <CalendarDays className="size-4 shrink-0 text-[#4f46e5] dark:text-[#a5b4fc]" aria-hidden="true" />
              <span className="truncate">{formatCallShort(slot, tz)}</span>
            </li>
          )}
        </ul>
      </div>

      <p className="hidden text-[14px] leading-relaxed text-[#1e1b4b]/65 md:block dark:text-white/70">
        {moving
          ? "Moving the call frees your old time for someone else."
          : "Bryan sets up your account with you: your cars, your prices, your booking site and Stripe, so you are ready to take bookings."}
      </p>

      <p className="mt-auto hidden items-center gap-2 text-[12.5px] text-[#1e1b4b]/55 md:flex dark:text-white/55">
        <span className="size-1.5 rounded-full bg-[#4f46e5] dark:bg-[#a5b4fc]" aria-hidden="true" />
        Included free with your Drive247 trial
      </p>
    </aside>
  );
}

/** The month: days with a free time in the accent, the rest quiet. */
function MonthGrid({
  month,
  onMonth,
  day,
  onDay,
  byDay,
  tz,
  firstSlot,
  lastSlot,
}: {
  month: string;
  onMonth: (m: string) => void;
  day: string | null;
  onDay: (d: string) => void;
  byDay: Map<string, Date[]>;
  tz: string;
  firstSlot: Date;
  lastSlot: Date;
}) {
  const first = parseISO(`${month}-01`);
  const lead = getDay(first);
  const days = getDaysInMonth(first);
  const today = dayKey(new Date(), tz);
  const minMonth = dayKey(firstSlot, tz).slice(0, 7);
  const maxMonth = dayKey(lastSlot, tz).slice(0, 7);
  const monthHasFree = Array.from(byDay.keys()).some((k) => k.startsWith(month));
  const shift = (n: number) => format(addMonths(first, n), "yyyy-MM");

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[17px] font-semibold text-foreground">{format(first, "MMMM yyyy")}</p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Previous month"
            disabled={month <= minMonth}
            onClick={() => onMonth(shift(-1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Next month"
            disabled={month >= maxMonth}
            onClick={() => onMonth(shift(1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1.5 text-center">
        {WEEKDAYS.map((w) => (
          <span key={w} className="pb-2 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const key = `${month}-${String(i + 1).padStart(2, "0")}`;
          const free = byDay.has(key);
          const selected = key === day;
          return (
            <span key={key} className="flex justify-center">
              <button
                type="button"
                disabled={!free}
                onClick={() => onDay(key)}
                aria-pressed={selected}
                aria-label={`${format(parseISO(key), "EEEE d MMMM")}${free ? "" : ", no free times"}`}
                className={cn(
                  "relative flex size-12 items-center justify-center rounded-full text-[15px] tabular-nums transition-all",
                  selected
                    ? "bg-[#4f46e5] font-semibold text-white shadow-[0_8px_18px_-6px_rgba(79,70,229,0.7)]"
                    : free
                      ? "cursor-pointer bg-[#4f46e5]/10 font-semibold text-[#4338ca] hover:bg-[#4f46e5]/20 dark:bg-[#6366f1]/20 dark:text-[#c7d2fe]"
                      : "cursor-default text-muted-foreground/45",
                )}
              >
                {i + 1}
                {key === today && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute bottom-1 size-1 rounded-full",
                      selected ? "bg-white" : "bg-foreground/50",
                    )}
                  />
                )}
              </button>
            </span>
          );
        })}
      </div>
      {!monthHasFree && (
        <p className="mt-3 text-[13px] text-muted-foreground">
          No free times in {format(first, "MMMM")}. {month < maxMonth ? "Try the next month." : "Try the month before."}
        </p>
      )}
    </div>
  );
}

/** The picked day's free times. */
function SlotList({
  day,
  slots,
  tz,
  onPick,
}: {
  day: string | null;
  slots: Date[];
  tz: string;
  onPick: (s: Date) => void;
}) {
  if (!day) {
    return <p className="pt-10 text-[13px] text-muted-foreground">Pick a day to see the times.</p>;
  }
  return (
    <div className="flex min-h-0 flex-col">
      <p className="mb-4 text-[17px] font-semibold text-foreground">
        {slots[0] ? formatDayHeading(slots[0], tz) : format(parseISO(day), "EEE d MMM")}
        <span className="font-normal text-muted-foreground"> · {zoneLabel(tz)}</span>
      </p>
      <ul className="flex max-h-[400px] flex-col gap-2.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {slots.map((s) => (
          <li key={s.toISOString()}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="h-12 w-full rounded-xl border border-[#4f46e5]/30 text-[15px] font-semibold text-[#4338ca] transition-all hover:border-[#4f46e5] hover:bg-[#4f46e5] hover:text-white hover:shadow-[0_8px_18px_-8px_rgba(79,70,229,0.7)] dark:text-[#c7d2fe]"
            >
              {formatSlotTime(s, tz)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({
  label,
  id,
  optional,
  children,
}: {
  label: string;
  id: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[13px]">
        {label}
        {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
    </div>
  );
}

function PickSkeleton() {
  return (
    <div className="mt-8 grid animate-pulse gap-8 md:grid-cols-[minmax(0,1fr)_210px]">
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 35 }, (_, i) => (
          <span key={i} className="mx-auto size-12 rounded-full bg-muted" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="h-12 rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
