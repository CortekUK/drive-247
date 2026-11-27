"use client";

/**
 * The free 30-minute onboarding call with Bryan, as a small card at the foot
 * of the v2 sidebar, above the profile row (23 Nov 2026). It went from a card
 * on the home, to a pill beside Help in the top bar, to here: Ghulam asked for
 * it "in card format", where the Developer link used to be.
 *
 *   on offer  Bryan's photo, "Free onboarding call", "With Bryan · 30
 *             minutes". Nothing else (Ghulam, 23 Nov): the whole card is the
 *             button, and its hover is the hint. Opens his live calendar.
 *   booked    "Onboarding call booked" and its time: opens the short pre-call
 *             checklist (add a vehicle, upload a logo, preview the website).
 *   waiting   the call's time has passed and Bryan has not marked it yet:
 *             "Waiting for Bryan to confirm" (feat-001 spec 09.4).
 *   collapsed rail: Bryan's photo alone, same click, the words in a tooltip.
 *
 * Bryan's photo is `public/team/bryan.jpg` (the landing page's own).
 *
 * Gone once Bryan marks the call done, once the operator hides it, or for any
 * tenant `onboarding_call_eligible()` does not cover. Owners only. The quick
 * tour's "Book onboarding call" opens the calendar here, through
 * `OPEN_ONBOARDING_CALL_EVENT`; the sidebar is on every page, so it always
 * has a listener.
 *
 * Booking is our own calendar (`onboarding-call-booking.tsx`, 23 Nov 2026),
 * not the GoHighLevel widget. Booked, the card opens the time, the pre-call
 * checklist (`ChecklistLink` from `dashboard-v2/onboarding-call-card.tsx`),
 * Move the call and Cancel it.
 */
import { useEffect, useState } from "react";
import { ArrowUpRight, Loader2, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { getBookingBaseUrl } from "@/lib/booking-url";
import { type OnboardingCallStep } from "@/hooks/use-onboarding-call";
import { OPEN_ONBOARDING_CALL_EVENT, useFirstSteps } from "@/hooks/use-first-steps";
import { useCallZone, useOnboardingCallCalendar } from "@/hooks/use-onboarding-call-calendar";
import { ChecklistLink } from "@/components/dashboard-v2/onboarding-call-card";
import { AddToCalendar, OnboardingCallBooking } from "@/components/onboarding/onboarding-call-booking";
import { Textarea } from "@/components/ui-v2/textarea";
import { formatCallFull } from "@/lib/onboarding-call-time";
import { HOME_PALETTE } from "@/components/dashboard-v2/home/ui";

export function OnboardingCallSidebarCard({ collapsed = false }: { collapsed?: boolean }) {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** "Cancel the call?" asked inline, never with a browser popup. */
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState("");
  const zone = useCallZone();
  /** `?call=open` from an email, waiting for the call state to load. */
  const [openFromEmail, setOpenFromEmail] = useState(false);
  // Our own calendar (no more GoHighLevel): a booking lands in the database
  // the moment it is made, so there is nothing to poll for.
  const first = useFirstSteps();
  const { callState: state, mark, fake } = first;
  const { cancel } = useOnboardingCallCalendar({ enabled: false });

  // The "Book Your Free Onboarding Call" emails link to `/?book-call=1`: open
  // the calendar on arrival, once, and drop the flag so a refresh does not.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("book-call")) return;
    url.searchParams.delete("book-call");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    setCalendarOpen(true);
  }, []);

  // The call emails' "Move or cancel" link is `/?call=open` (spec 09.19).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("call") !== "open") return;
    url.searchParams.delete("call");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    setOpenFromEmail(true);
  }, []);

  // The quick tour's last card asks for Bryan's calendar.
  useEffect(() => {
    const open = () => setCalendarOpen(true);
    window.addEventListener(OPEN_ONBOARDING_CALL_EVENT, open);
    return () => window.removeEventListener(OPEN_ONBOARDING_CALL_EVENT, open);
  }, []);

  const booked = first.call === "booked";
  const waiting = first.waiting;

  useEffect(() => {
    if (!openFromEmail || !first.ready) return;
    setOpenFromEmail(false);
    if (first.call === "booked") setDetailsOpen(true);
    else if (first.call === "offer") setCalendarOpen(true);
  }, [openFromEmail, first.ready, first.call]);

  // The owner's decision, not every staff login's.
  const isOwner = appUser?.role === "head_admin" || appUser?.role === "admin";
  if (!first.ready || first.call === "none" || (!isOwner && !fake)) return null;

  const run = (step: OnboardingCallStep, done?: string) => {
    // A fake run is a pretend company: nothing it does is saved.
    if (fake) {
      if (done) toast.success(done, { description: "On the fake run nothing is saved." });
      return;
    }
    mark.mutate(step, {
      onSuccess: () => done && toast.success(done),
      onError: (e) => toast.error("That did not save", { description: (e as Error).message }),
    });
  };

  const siteUrl = getBookingBaseUrl(tenant?.slug);
  const steps = [
    { id: "vehicle", label: "Add your first vehicle", done: (state?.vehicleCount ?? 0) > 0, href: "/vehicles" },
    { id: "logo", label: "Upload your business logo", done: !!state?.hasLogo, href: "/settings?tab=branding" },
    { id: "site", label: "Preview your rental website", done: !!state?.sitePreviewedAt, href: siteUrl, external: true },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const booking = state?.booking ?? null;
  const fullTime = state?.callScheduledFor ? formatCallFull(state.callScheduledFor, zone) : null;
  const open = () => (booked ? setDetailsOpen(true) : setCalendarOpen(true));

  return (
    <>
      {collapsed ? (
        // The collapsed rail: Bryan's face alone, the words in a tooltip.
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-tour="onboarding-call"
              onClick={open}
              aria-label={booked ? "Your onboarding call" : "Book a free onboarding call"}
              className="mx-auto mb-1.5 flex size-9 items-center justify-center rounded-full ring-2 ring-primary/25 transition hover:ring-primary/45"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a 200px avatar from /public */}
              <img src="/team/bryan.jpg" alt="" className="size-8 rounded-full object-cover" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {waiting
              ? "Waiting for Bryan to confirm"
              : booked
                ? first.callTime ?? "Onboarding call booked"
                : "Free onboarding call with Bryan"}
          </TooltipContent>
        </Tooltip>
      ) : (
        // The whole card is the button (Ghulam, 23 Nov): one click target,
        // no inner button.
        <button
          type="button"
          data-tour="onboarding-call"
          onClick={open}
          // A mid accent tint, a soft accent wash across it, and the subtitle
          // in the accent: stands out from the rail without going to the solid
          // dark accent (Ghulam, 23 Nov).
          className="group mb-2 block w-full cursor-pointer rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.22] to-primary/[0.10] p-3 text-left shadow-[0_4px_14px_-8px_hsl(var(--primary)/0.5)] transition-all duration-200 hover:-translate-y-px hover:border-primary/50 hover:from-primary/[0.28] hover:to-primary/[0.14] hover:shadow-[0_8px_20px_-8px_hsl(var(--primary)/0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:from-primary/[0.32] dark:to-primary/[0.16]"
        >
          <span className="flex items-center gap-2.5">
            <span className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- a 200px avatar from /public */}
              <img src="/team/bryan.jpg" alt="" className="size-9 rounded-full object-cover" />
              {/* A person who is there: a small green dot, as on a chat avatar. */}
              {/* Kept small and soft (Ghulam, 23 Nov): a hint, not a badge. */}
              <span className="absolute bottom-0 right-0 size-2 rounded-full bg-emerald-500/85 ring-[1.5px] ring-white/90 dark:ring-[hsl(var(--background))]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">
                {waiting ? "Waiting for Bryan to confirm" : booked ? "Onboarding call booked" : "Free onboarding call"}
              </span>
              <span className="mt-0.5 block truncate text-[11.5px] font-medium leading-tight text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                {booked ? first.callTime ?? "With Bryan" : "With Bryan · 30 minutes"}
              </span>
            </span>
            {/* Says the card opens something (Bryan's calendar, or the
                checklist). Steps up and right on hover. */}
            <ArrowUpRight
              className="size-4 shrink-0 text-primary transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 dark:text-[hsl(var(--v2-link,var(--primary)))]"
              aria-hidden="true"
            />
          </span>
        </button>
      )}

      {/* Booked: when it is, and what makes the 30 minutes count. */}
      <Dialog
        open={detailsOpen}
        onOpenChange={(o) => {
          setDetailsOpen(o);
          if (!o) setConfirmCancel(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle className="text-xl font-semibold tracking-tight">
              {waiting
                ? "Waiting for Bryan to confirm"
                : doneCount === steps.length
                  ? "You are ready for your call"
                  : "Before your call with Bryan"}
            </DialogTitle>
            <DialogDescription>
              {waiting
                ? fullTime
                  ? `Your call was for ${fullTime}. Bryan will mark it shortly.`
                  : "Bryan will mark your call shortly."
                : doneCount === steps.length
                  ? "Bryan can spend the 30 minutes showing you how everything works together."
                  : "A few quick steps make the 30 minutes count, so the call is about how it all works, not typing in basics."}
            </DialogDescription>
          </DialogHeader>
          {!waiting && fullTime && (
            <div className="flex flex-col gap-2 rounded-xl border px-3.5 py-3">
              <p className="text-[14px] font-semibold text-foreground">{fullTime}</p>
              {booking?.meetingUrl ? (
                <a
                  href={booking.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
                >
                  <Video className="size-3.5" aria-hidden="true" />
                  The call link
                </a>
              ) : (
                <p className="text-[13px] text-muted-foreground">Bryan will send you the call link by email before the call.</p>
              )}
              {booking && (
                <div className="[&>div]:justify-start">
                  <AddToCalendar
                    booking={{ starts_at: booking.startsAt, ends_at: booking.endsAt, meeting_url: booking.meetingUrl }}
                    title="Drive247 onboarding call with Bryan"
                    icsToken={booking.icsToken}
                  />
                </div>
              )}
            </div>
          )}
          {/* `ChecklistLink` draws with the home's `.pv` palette, and this
              dialog can open on any page, so it brings the palette along. */}
          <style>{HOME_PALETTE}</style>
          <ol
            className="pv flex flex-col gap-2"
            aria-label={`Pre-call checklist, ${doneCount} of ${steps.length} done`}
          >
            {steps.map((s, i) => (
              <li key={s.id}>
                <ChecklistLink
                  href={s.href}
                  external={s.external}
                  done={s.done}
                  onOpen={s.id === "site" && !s.done ? () => run("site_previewed") : undefined}
                >
                  <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 text-[13px] font-medium">{s.label}</span>
                </ChecklistLink>
              </li>
            ))}
          </ol>
          {waiting ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDetailsOpen(false);
                  setCalendarOpen(true);
                }}
              >
                Book a new time
              </Button>
            </div>
          ) : confirmCancel ? (
            <div className="flex flex-col gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5">
              <p className="text-[13px] text-foreground">Cancel your call with Bryan?</p>
              <Textarea
                rows={2}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)"
                aria-label="Reason (optional)"
                className="bg-background text-[13px]"
              />
              <div className="flex justify-end gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(false)}>
                  Keep it
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={cancel.isPending}
                  onClick={() =>
                    cancel.mutate(reason, {
                      onSuccess: () => {
                        setConfirmCancel(false);
                        setReason("");
                        setDetailsOpen(false);
                        toast.success("Your call is cancelled", {
                          description: fake ? "On the fake run nothing is saved." : "You can book a new time whenever suits you.",
                        });
                      },
                      onError: (e) => toast.error("That did not cancel", { description: (e as Error).message }),
                    })
                  }
                >
                  {cancel.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                  Cancel the call
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDetailsOpen(false);
                  setCalendarOpen(true);
                }}
              >
                Move the call
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmCancel(true)}>
                Cancel it
              </Button>
              <button
                type="button"
                onClick={() => {
                  setDetailsOpen(false);
                  run("dismissed");
                }}
                disabled={mark.isPending}
                className="ml-auto text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Hide this card
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bryan's calendar, our own: book, or move a booked call. */}
      <OnboardingCallBooking open={calendarOpen} onOpenChange={setCalendarOpen} />
    </>
  );
}
