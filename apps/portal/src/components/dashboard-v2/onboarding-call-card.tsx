"use client";

/**
 * The free 30-minute onboarding call, on the v2 home (Nov 2026).
 *
 * Two states, one card, above the bands:
 *   not booked  "Let's get your rental business set up." + Book Your Free
 *               Onboarding Call, which opens Brian's live calendar embedded
 *               in the portal. Optional — nothing is gated on it.
 *   booked      the pre-call checklist: add your first vehicle, upload your
 *               logo, preview your website. The first two tick themselves from
 *               the tenant's own data; the third ticks when the link is opened.
 *
 * Gone once Brian marks the call done (admin → Customer management →
 * Onboarding calls), once the operator hides it, or for any tenant
 * `onboarding_call_eligible()` does not cover (older than 30 days and not on a
 * trial). Only `DashboardV2` mounts it, so V1 tenants never see it.
 *
 * Compact on purpose: at lg+ the bands below share one screen, so every pixel
 * this card takes comes out of them — the same trade the banners above make.
 */

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CalendarCheck, CalendarDays, Check, ExternalLink, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { getBookingBaseUrl } from "@/lib/booking-url";
import { cn } from "@/lib/utils";
import {
  ONBOARDING_CALL_BOOKING_URL,
  useOnboardingCall,
  type OnboardingCallStep,
} from "@/hooks/use-onboarding-call";
import { Eyebrow } from "./home/ui";

export function OnboardingCallCard() {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const { state, mark } = useOnboardingCall();
  const [calendarOpen, setCalendarOpen] = useState(false);

  // The owner's decision, not every staff login's.
  const isOwner = appUser?.role === "head_admin" || appUser?.role === "admin";
  if (!isOwner || !state || !state.eligible || state.dismissedAt || state.callCompletedAt) return null;

  const run = (step: OnboardingCallStep, done?: string) =>
    mark.mutate(step, {
      onSuccess: () => done && toast.success(done),
      onError: (e) => toast.error("That didn't save", { description: (e as Error).message }),
    });

  const booked = !!state.callBookedAt;
  const siteUrl = getBookingBaseUrl(tenant?.slug);
  const steps = [
    { id: "vehicle", label: "Add your first vehicle", done: state.vehicleCount > 0, href: "/vehicles" },
    { id: "logo", label: "Upload your business logo", done: state.hasLogo, href: "/settings?tab=branding" },
    { id: "site", label: "Preview your rental website", done: !!state.sitePreviewedAt, href: siteUrl, external: true },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section
      aria-label="Onboarding call"
      className="relative mb-10 shrink-0 overflow-hidden rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] px-6 py-5"
    >
      <button
        type="button"
        onClick={() => run("dismissed")}
        disabled={mark.isPending}
        aria-label="Hide this card"
        title="Hide"
        className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full text-[var(--pv-ink-3)] transition-colors hover:bg-[var(--pv-wash)] hover:text-[var(--pv-ink)]"
      >
        <X className="size-4" aria-hidden="true" />
      </button>

      {!booked ? (
        <div className="flex flex-col gap-4 pr-6 lg:flex-row lg:items-center lg:gap-8">
          <div className="min-w-0 flex-1">
            <Eyebrow className="flex items-center gap-1.5 text-[var(--pv-accent-ink)]">
              <CalendarDays className="size-3.5" aria-hidden="true" /> Free onboarding call
            </Eyebrow>
            <h2 className="mt-2 text-[18px] font-semibold leading-tight tracking-[-0.015em] text-[var(--pv-ink)]">
              Let&rsquo;s get your rental business set up.
            </h2>
            <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-[var(--pv-ink-2)]">
              Book your complimentary 30-minute onboarding session with Brian. We&rsquo;ll walk you through
              Drive247, configure the essentials and help get your business ready to take bookings.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-1.5 lg:w-[300px]">
            <Button className="h-10 rounded-xl px-5" onClick={() => setCalendarOpen(true)}>
              Book Your Free Onboarding Call
            </Button>
            <p className="text-center text-[11px] text-[var(--pv-ink-3)]">
              Optional &mdash; you can start using Drive247 immediately.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 pr-6 lg:flex-row lg:items-center lg:gap-8">
          <div className="min-w-0 lg:w-[38%]">
            <Eyebrow className="flex items-center gap-1.5 text-[var(--pv-accent-ink)]">
              <CalendarCheck className="size-3.5" aria-hidden="true" /> Onboarding call booked
            </Eyebrow>
            <h2 className="mt-2 text-[18px] font-semibold leading-tight tracking-[-0.015em] text-[var(--pv-ink)]">
              {doneCount === steps.length ? "You're ready for your call" : "Before your call with Brian"}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--pv-ink-2)]">
              {doneCount === steps.length
                ? "Brian can spend the 30 minutes showing you how everything works together."
                : "Three quick steps make the 30 minutes count — so the call is about how it all works, not typing in basics."}
            </p>
            <p className="mt-2 text-[11px] text-[var(--pv-ink-3)]">
              <button
                type="button"
                onClick={() => setCalendarOpen(true)}
                className="underline-offset-4 hover:text-[var(--pv-ink)] hover:underline"
              >
                Open the calendar
              </button>
              {" · "}
              <button
                type="button"
                onClick={() => run("unbooked")}
                disabled={mark.isPending}
                className="underline-offset-4 hover:text-[var(--pv-ink)] hover:underline"
              >
                I haven&rsquo;t booked yet
              </button>
            </p>
          </div>
          <ol className="grid flex-1 gap-2 sm:grid-cols-3" aria-label={`Pre-call checklist, ${doneCount} of ${steps.length} done`}>
            {steps.map((s, i) => (
              <li key={s.id}>
                <ChecklistLink
                  href={s.href}
                  external={s.external}
                  done={s.done}
                  onOpen={s.id === "site" && !s.done ? () => run("site_previewed") : undefined}
                >
                  <span className="text-[11px] font-medium tabular-nums text-[var(--pv-ink-3)]">{i + 1}</span>
                  <span className="min-w-0 flex-1 text-[13px] font-medium">{s.label}</span>
                </ChecklistLink>
              </li>
            ))}
          </ol>
        </div>
      )}

      <BookingDialog
        open={calendarOpen}
        onOpenChange={setCalendarOpen}
        booked={booked}
        saving={mark.isPending}
        onBooked={() =>
          mark.mutate("booked", {
            onSuccess: () => {
              setCalendarOpen(false);
              toast.success("Your onboarding call is booked", {
                description: "Three quick steps will make the 30 minutes count — they're on your home screen.",
              });
            },
            onError: (e) => toast.error("That didn't save", { description: (e as Error).message }),
          })
        }
      />
    </section>
  );
}

function ChecklistLink({
  href,
  external,
  done,
  onOpen,
  children,
}: {
  href: string;
  external?: boolean;
  done: boolean;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const className = cn(
    "group flex h-full items-center gap-2.5 rounded-xl border px-3.5 py-3 transition-colors",
    done
      ? "border-transparent bg-[var(--pv-clear-bg)] text-[var(--pv-ink-2)]"
      : "border-[var(--pv-line)] text-[var(--pv-ink)] hover:border-[var(--pv-accent-30)] hover:bg-[var(--pv-wash)]",
  );
  const mark = done ? (
    <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--pv-clear)] text-white">
      <Check className="size-3" strokeWidth={3} aria-hidden="true" />
      <span className="sr-only">Done:</span>
    </span>
  ) : (
    <span className="size-[18px] shrink-0 rounded-full border border-dashed border-[var(--pv-line-2)]" aria-hidden="true" />
  );
  const arrow = external ? (
    <ExternalLink className="size-3.5 shrink-0 text-[var(--pv-ink-3)] group-hover:text-[var(--pv-accent-ink)]" aria-hidden="true" />
  ) : (
    <ArrowUpRight className="size-3.5 shrink-0 text-[var(--pv-ink-3)] group-hover:text-[var(--pv-accent-ink)]" aria-hidden="true" />
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={onOpen} className={className}>
        {mark}
        {children}
        {arrow}
      </a>
    );
  }
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        router.push(href);
      }}
      className={className}
    >
      {mark}
      {children}
      {arrow}
    </a>
  );
}

/**
 * Brian's live calendar, embedded. The widget sends both sides the invitation
 * and reminders itself; it does not tell the portal a slot was taken, so the
 * operator confirms with one click (and Brian can also record it from admin).
 */
function BookingDialog({
  open,
  onOpenChange,
  booked,
  saving,
  onBooked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booked: boolean;
  saving: boolean;
  onBooked: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="px-6 pb-4 pt-6 text-left">
          <DialogTitle className="text-xl font-semibold tracking-tight">Book your free onboarding call</DialogTitle>
          <DialogDescription>
            Pick a 30-minute slot with Brian. You&rsquo;ll both get a calendar invitation and reminders.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden border-y bg-muted/30">
          {open && (
            <iframe
              src={ONBOARDING_CALL_BOOKING_URL}
              title="Brian's booking calendar"
              className="block h-[min(640px,65vh)] w-full border-0"
              loading="eager"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <a
            href={ONBOARDING_CALL_BOOKING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            Open in a new tab
          </a>
          <div className="flex items-center gap-3">
            <Button variant="ghost" className="h-9 rounded-xl px-4" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {!booked && (
              <Button className="h-9 gap-1.5 rounded-xl px-5" onClick={onBooked} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
                I&rsquo;ve booked my call
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
