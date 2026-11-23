"use client";

/**
 * Bryan and the onboarding call, the end of the signup (Ghulam, 2026-11-23):
 *
 *   build    the portal is built (provisioning-screen.tsx). A few seconds in,
 *            Bryan slides in from the right and offers the free onboarding
 *            call: "Yes, let's book a time" or "Not now".
 *   call     once the portal is ready, his calendar, unless they said "Not
 *            now". Optional: "Skip for now", or book from the portal later.
 *   portal   straight in, signed in when the build minted a sign-in link.
 *
 * THE CALENDAR IS BRYAN'S REAL ONE: the LeadConnector booking widget the
 * portal's home card already embeds (apps/portal/src/hooks/use-onboarding-call.ts,
 * ONBOARDING_CALL_BOOKING_URL). The times on it are his real free times, and a
 * booking goes through the same LeadConnector webhook (`onboarding-call-booked`)
 * as one made from the portal: it is matched to the new tenant by the email it
 * is pre-filled with, shows in admin → Onboarding calls, and turns the portal's
 * card into the pre-call checklist. This screen watches for that booking with
 * the same `get_my_onboarding_call()` read the card uses, and says so when it
 * lands. Nothing about the booking is decided here.
 */

import * as React from "react";
import Image from "next/image";
import { CalendarCheck, ExternalLink, Loader2, Video, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { getBrowserSupabase } from "@/lib/supabase/browser";

import { isMockSignup } from "./mock-signup";
import { ScreenHead, SIGNUP_PRIMARY, SIGNUP_QUIET } from "./signup-ui";

/**
 * Bryan's live booking calendar (LeadConnector). The same URL as the portal's
 * home card (apps/portal/src/hooks/use-onboarding-call.ts); apps do not share
 * code, so keep the two in step if the calendar moves.
 */
export const ONBOARDING_CALL_BOOKING_URL = "https://api.leadconnectorhq.com/widget/bookings/drive247-onboarding-call";

/** The call's length on Bryan's calendar and in the onboarding emails. */
const CALL_MINUTES = 30;

/**
 * Bryan's photo: the one the landing page's "Book a demo" card shows
 * (components/sections/book-demo-section.tsx). That file notes it is still a
 * stand-in face until his real photo goes in apps/web/public/team; swapping the
 * file there updates both. Decorative here: his name is always beside it.
 */
const BRYAN_PHOTO = "/team/bryan.jpg";

export type BryanAnswer = "yes" | "no" | null;

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

/** The calendar, pre-filled with who is booking: the email is what the webhook matches on. */
function bookingUrl(person: { email: string; fullName: string }): string {
  const url = new URL(ONBOARDING_CALL_BOOKING_URL);
  const [first, ...rest] = person.fullName.trim().split(/\s+/).filter(Boolean);
  if (person.email) url.searchParams.set("email", person.email);
  if (first) url.searchParams.set("first_name", first);
  if (rest.length) url.searchParams.set("last_name", rest.join(" "));
  return url.toString();
}

export function BryanAvatar({ size = "size-11" }: { size?: string }) {
  return (
    <Image
      src={BRYAN_PHOTO}
      alt=""
      width={96}
      height={96}
      className={cn(size, "shrink-0 rounded-full object-cover ring-1 ring-foreground/10")}
    />
  );
}

// ---------------------------------------------------------------------------
// The nudge, during the build
// ---------------------------------------------------------------------------

/**
 * Bryan's card: slides in from the right edge (up from the bottom on a phone)
 * while the build runs. "Yes" means the calendar opens once the portal is
 * ready; "Not now" skips it; closing it leaves the calendar on (it can be
 * skipped there).
 */
export function BryanNudge({
  fullName,
  answer,
  onAnswer,
  onClose,
}: {
  fullName: string;
  answer: BryanAnswer;
  onAnswer(answer: "yes" | "no"): void;
  onClose(): void;
}) {
  const first = firstNameOf(fullName);
  return (
    <aside
      aria-label="A message from Bryan"
      className="signup-slide-in fixed inset-x-3 bottom-3 z-30 rounded-[28px] bg-white p-5 shadow-[0_24px_60px_-24px_rgba(30,27,75,0.35)] ring-1 ring-foreground/10 sm:inset-x-auto sm:right-8 sm:bottom-8 sm:w-[23rem] dark:bg-[#17171f] dark:ring-white/10"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
      >
        <X className="size-4" />
      </button>

      <div className="flex items-center gap-3">
        <BryanAvatar />
        <div>
          <p className="text-[15px] font-medium text-foreground">Bryan</p>
          <p className="text-xs text-muted-foreground">Onboarding, Drive247</p>
        </div>
      </div>

      {answer === "yes" ? (
        <p className="mt-4 text-[14px] leading-relaxed text-foreground animate-in fade-in-0 duration-200">
          Great. My calendar opens as soon as your portal is ready, so you can pick a time that suits you.
        </p>
      ) : answer === "no" ? (
        <p className="mt-4 text-[14px] leading-relaxed text-foreground animate-in fade-in-0 duration-200">
          No problem. You can book a call with me any time from your portal.
        </p>
      ) : (
        <>
          <p className="mt-4 text-[14px] leading-relaxed text-foreground">
            Hi{first ? ` ${first}` : ""}, I&apos;m Bryan. While your portal is being built: want a free {CALL_MINUTES}-minute
            call? I&apos;ll help you add your first car and connect payments, so you&apos;re ready to take bookings.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <button type="button" className={cn(SIGNUP_PRIMARY, "h-10 px-5 text-[14px]")} onClick={() => onAnswer("yes")}>
              Yes, let&apos;s book a time
            </button>
            <button type="button" className={SIGNUP_QUIET} onClick={() => onAnswer("no")}>
              Not now
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// The calendar, after the build
// ---------------------------------------------------------------------------

/**
 * Whether the booking has landed: the portal card's own read, polled while the
 * calendar is up. LeadConnector tells `onboarding-call-booked` a few seconds
 * after a slot is picked. Any failure reads as "not yet": the screen still
 * moves on with the forward arrow either way.
 */
function useBookedCall(active: boolean): { booked: boolean; at: string | null } {
  const [state, setState] = React.useState<{ booked: boolean; at: string | null }>({ booked: false, at: null });
  React.useEffect(() => {
    if (!active || state.booked || isMockSignup()) return;
    let stopped = false;
    const tick = async () => {
      try {
        const { data, error } = await getBrowserSupabase().rpc("get_my_onboarding_call");
        if (stopped || error || !data || typeof data !== "object" || Array.isArray(data)) return;
        const row = data as Record<string, unknown>;
        if (typeof row.call_booked_at === "string" && row.call_booked_at) {
          setState({
            booked: true,
            at: typeof row.call_scheduled_for === "string" && row.call_scheduled_for ? row.call_scheduled_for : null,
          });
        }
      } catch {
        /* not yet */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 4000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [active, state.booked]);
  return state;
}

/** "Tuesday, November 25 at 10:30 am", in their own time zone. */
function callTimeLabel(isoTime: string): string | null {
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
  return `${day} at ${time}`;
}

export function CallScreen({
  fullName,
  email,
  onBookedChange,
}: {
  fullName: string;
  email: string;
  /** Lets the footer drop "Skip for now" once a call is booked. */
  onBookedChange?(booked: boolean): void;
}) {
  const first = firstNameOf(fullName);
  const src = React.useMemo(() => bookingUrl({ email, fullName }), [email, fullName]);
  const [loaded, setLoaded] = React.useState(false);
  const [slow, setSlow] = React.useState(false);
  const { booked, at } = useBookedCall(true);
  const when = at ? callTimeLabel(at) : null;

  React.useEffect(() => {
    onBookedChange?.(booked);
  }, [booked, onBookedChange]);

  React.useEffect(() => {
    if (loaded) return;
    const t = window.setTimeout(() => setSlow(true), 12_000);
    return () => window.clearTimeout(t);
  }, [loaded]);

  return (
    <div>
      <ScreenHead
        title={booked ? "You're booked" : "Book your onboarding call"}
        lead={
          booked
            ? "Bryan will email you a video link. Your portal is ready, so take a look around before the call."
            : `${CALL_MINUTES} minutes with Bryan, on video. Optional: you can book from your portal any time.`
        }
      />

      <div className="signup-rise signup-rise-3 mx-auto mt-8 grid w-full max-w-[64rem] overflow-hidden rounded-[28px] bg-white/80 ring-1 ring-foreground/10 backdrop-blur-xl md:grid-cols-[17rem_minmax(0,1fr)] dark:bg-white/[0.04] dark:ring-white/10">
        {/* Bryan's side: who they will be talking to, and what the call is for. */}
        <div className="flex flex-col gap-5 border-b border-foreground/10 p-6 md:border-r md:border-b-0 dark:border-white/10">
          <div className="flex items-center gap-3">
            <span className="relative">
              <BryanAvatar size="size-14" />
              <span
                aria-hidden
                className="absolute right-0 bottom-0 size-3.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#17171f]"
              />
            </span>
            <div>
              <p className="text-[15px] font-medium text-foreground">Bryan Diaz</p>
              <p className="text-xs text-muted-foreground">Onboarding, Drive247</p>
            </div>
          </div>

          <p className="relative rounded-2xl rounded-tl-md bg-indigo-600/[0.06] px-4 py-3 text-[14px] leading-relaxed text-foreground ring-1 ring-indigo-600/10 dark:bg-indigo-400/[0.08] dark:ring-indigo-400/15">
            {first ? `${first}, bring` : "Bring"} one car&apos;s details. We&apos;ll add it, connect your payments and put your booking
            site live before we hang up.
          </p>

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full px-2.5 py-1 ring-1 ring-foreground/10 dark:ring-white/10">{CALL_MINUTES} min</span>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ring-foreground/10 dark:ring-white/10">
              <Video className="size-3.5" aria-hidden />
              Video call
            </span>
            <span className="rounded-full px-2.5 py-1 ring-1 ring-foreground/10 dark:ring-white/10">Free</span>
          </div>
        </div>

        {/* His calendar, or the booking once it lands. */}
        <div className="relative min-h-[360px]">
          {booked ? (
            <div className="flex h-full min-h-[360px] flex-col items-start justify-center gap-4 p-8 animate-in fade-in-0 slide-in-from-bottom-3 duration-200">
              <span className="flex size-12 items-center justify-center rounded-full bg-indigo-600 text-white dark:bg-indigo-500">
                <CalendarCheck className="size-6" aria-hidden />
              </span>
              <p className="text-[22px] leading-tight font-medium tracking-[-0.02em] text-foreground">
                {when ? `Onboarding call, ${when}` : "Your onboarding call is booked"}
              </p>
              <p className="max-w-[44ch] text-[14px] leading-relaxed text-muted-foreground">
                The invite is on its way to <span className="font-medium text-foreground">{email}</span>. You can move it from that email
                if the time stops suiting you.
              </p>
            </div>
          ) : (
            <>
              {!loaded ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
                  <Loader2 className="size-5 animate-spin text-indigo-600 dark:text-indigo-400" aria-hidden />
                  <p>{slow ? "Bryan's calendar is taking longer than it should." : "Opening Bryan's calendar…"}</p>
                  {slow ? (
                    <a
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-medium text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
                    >
                      Open it in a new tab
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  ) : null}
                </div>
              ) : null}
              <iframe
                src={src}
                title="Book your onboarding call with Bryan"
                onLoad={() => {
                  setLoaded(true);
                  setSlow(false);
                }}
                referrerPolicy="strict-origin-when-cross-origin"
                className={cn(
                  // As tall as the window allows under the heading and above
                  // the footer; the calendar scrolls inside itself below that.
                  "block h-[clamp(360px,calc(100dvh-19rem),720px)] w-full border-0 transition-opacity duration-200",
                  loaded ? "opacity-100" : "opacity-0",
                )}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
