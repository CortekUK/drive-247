"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ClipboardCheck,
  Globe,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GHL_BOOKING_URL } from "@/lib/constants";
import {
  submitStrategyCallAction,
  type StrategyCallState,
} from "@/actions/strategy-call";

/* ─── Constants ─── */

const CALL_BENEFITS = [
  {
    icon: ClipboardCheck,
    title: "Setup audit",
    description:
      "We review how you currently take bookings, payments and agreements, then highlight where margin, time or bookings may be leaking.",
  },
  {
    icon: Globe,
    title: "Live site preview",
    description:
      "See how your own direct booking site could look with your branding, fleet and booking flow.",
  },
  {
    icon: Rocket,
    title: "7-day launch plan",
    description:
      "You leave with the exact steps, timeline and pricing to launch your private rental booking system.",
  },
];

const FLEET_SIZE_OPTIONS = [
  "1–4 vehicles",
  "5–10 vehicles",
  "11–25 vehicles",
  "25+ vehicles",
];

const PLATFORM_OPTIONS = [
  "Turo",
  "Website",
  "Instagram / Facebook",
  "Google",
  "Manual / WhatsApp",
  "Other",
];

const BOOKING_SOURCE_OPTIONS = [
  "Turo",
  "Instagram / Facebook",
  "Website",
  "Referrals",
  "Google",
  "Other",
];

const BUDGET_OPTIONS = [
  "Under $500",
  "$500\u2013$1,500",
  "$1,500\u2013$3,000",
  "$3,000+",
  "Not sure yet",
];

const READINESS_OPTIONS = [
  "Ready to launch this week",
  "Ready if the system is a good fit",
  "Comparing options",
  "Just researching",
];

const CALL_TESTIMONIALS = [
  {
    name: "Marcus Thompson",
    initials: "MT",
    role: "Owner",
    detail: "12-vehicle fleet · Atlanta",
    quote:
      "The call made it clear where we were losing margin and how much more we could control by taking direct bookings.",
    color: "bg-indigo-600",
  },
  {
    name: "Sarah Alvarez",
    initials: "SA",
    role: "Operations Manager",
    detail: "28-vehicle fleet · Miami",
    quote:
      "They mapped out our direct booking site, payments and agreements in one place. It finally felt like a proper rental operation.",
    color: "bg-emerald-600",
  },
  {
    name: "James Reilly",
    initials: "JR",
    role: "Founder",
    detail: "8-vehicle fleet · Phoenix",
    quote:
      "Booked the call on a Tuesday and had our private rental site ready the same week.",
    color: "bg-amber-600",
  },
];

const MINI_FAQ = [
  {
    q: "How long is the call?",
    a: "20 minutes. We\u2019re respectful of your time.",
  },
  {
    q: "Is there any obligation?",
    a: "No. If Drive247 is a fit, we\u2019ll explain the next steps. If not, you\u2019ll still leave with a clear launch plan.",
  },
  {
    q: "Who\u2019s on the call?",
    a: "A member of our founding team. No SDRs, no scripts.",
  },
];


/* ─── GHL Booking Embed ─── */

function CalendarEmbed({
  prefillName,
  prefillEmail,
}: {
  prefillName: string;
  prefillEmail: string;
}) {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const router = useRouter();

  // Listen for GHL booking completion and redirect to confirmation page
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (Array.isArray(event.data) && event.data[0] === "msgsndr-booking-complete") {
        router.push("/strategy-call/confirmation");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [router]);

  const src = (() => {
    const params = new URLSearchParams();
    if (prefillName) params.set("name", prefillName);
    if (prefillEmail) params.set("email", prefillEmail);
    const qs = params.toString();
    return qs ? `${GHL_BOOKING_URL}?${qs}` : GHL_BOOKING_URL;
  })();

  return (
    <div className="relative">
      {!iframeLoaded && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl border bg-card">
          <div className="text-sm text-muted-foreground">Loading calendar...</div>
        </div>
      )}
      <iframe
        src={src}
        title="Book a strategy call"
        className="w-full rounded-xl border-0"
        style={{ height: 800 }}
        onLoad={() => setIframeLoaded(true)}
      />
      <div className="mt-3 text-center">
        <a
          href={GHL_BOOKING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Calendar not loading? Open in new tab
        </a>
      </div>
    </div>
  );
}

/* ─── Qualifier Form + Calendar Flow ─── */

function QualifierSection({
  onPhaseChange,
}: {
  onPhaseChange: (phase: "form" | "calendar") => void;
}) {
  const [state, formAction, isPending] = useActionState<
    StrategyCallState,
    FormData
  >(submitStrategyCallAction, null);

  const [prefillName, setPrefillName] = useState("");
  const [prefillEmail, setPrefillEmail] = useState("");
  const [fleetSize, setFleetSize] = useState("");
  const [currentPlatform, setCurrentPlatform] = useState("");
  const [bookingSource, setBookingSource] = useState("");
  const [budget, setBudget] = useState("");
  const [readiness, setReadiness] = useState("");
  const calendarRef = useRef<HTMLDivElement>(null);

  // Notify parent and scroll to calendar when form succeeds
  useEffect(() => {
    if (state?.success) {
      onPhaseChange("calendar");
      setTimeout(() => {
        calendarRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    }
  }, [state?.success, onPhaseChange]);

  return (
    <div className="mx-auto max-w-[600px] space-y-6">
      {/* Qualifier form — hidden once submitted */}
      {!state?.success && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-bold tracking-tight">
              Book your free launch plan call
            </h2>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">
              Takes 60 seconds — so we can tailor the call to your fleet,
              booking setup and launch goals.
            </p>
            <form
              action={(formData) => {
                const name = (formData.get("name") as string)?.trim() || "";
                const email =
                  (formData.get("email") as string)?.trim().toLowerCase() || "";
                setPrefillName(name);
                setPrefillEmail(email);
                formAction(formData);
              }}
              className="space-y-3"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="sc-name"
                    className="mb-1 block text-sm font-medium"
                  >
                    Name
                    <span className="text-indigo-600 dark:text-indigo-400">
                      {" "}
                      *
                    </span>
                  </label>
                  <Input
                    id="sc-name"
                    name="name"
                    type="text"
                    placeholder="John Smith"
                    required
                    disabled={isPending}
                    className="h-10"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sc-email"
                    className="mb-1 block text-sm font-medium"
                  >
                    Email
                    <span className="text-indigo-600 dark:text-indigo-400">
                      {" "}
                      *
                    </span>
                  </label>
                  <Input
                    id="sc-email"
                    name="email"
                    type="email"
                    placeholder="john@example.com"
                    required
                    disabled={isPending}
                    className="h-10"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="sc-phone"
                    className="mb-1 block text-sm font-medium"
                  >
                    Phone number
                  </label>
                  <Input
                    id="sc-phone"
                    name="phone"
                    type="tel"
                    placeholder="(555) 123-4567"
                    disabled={isPending}
                    className="h-10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Fleet size
                    <span className="text-indigo-600 dark:text-indigo-400">
                      {" "}
                      *
                    </span>
                  </label>
                  <input type="hidden" name="fleet_size" value={fleetSize} />
                  <Select
                    value={fleetSize}
                    onValueChange={setFleetSize}
                    disabled={isPending}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select fleet size" />
                    </SelectTrigger>
                    <SelectContent>
                      {FLEET_SIZE_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Current platform
                    <span className="text-indigo-600 dark:text-indigo-400">
                      {" "}
                      *
                    </span>
                  </label>
                  <input
                    type="hidden"
                    name="current_platform"
                    value={currentPlatform}
                  />
                  <Select
                    value={currentPlatform}
                    onValueChange={setCurrentPlatform}
                    disabled={isPending}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select platform" />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORM_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Main booking source
                  </label>
                  <input
                    type="hidden"
                    name="challenge"
                    value={bookingSource}
                  />
                  <Select
                    value={bookingSource}
                    onValueChange={setBookingSource}
                    disabled={isPending}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select source" />
                    </SelectTrigger>
                    <SelectContent>
                      {BOOKING_SOURCE_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Launch budget
                    <span className="text-indigo-600 dark:text-indigo-400">
                      {" "}
                      *
                    </span>
                  </label>
                  <input type="hidden" name="budget" value={budget} />
                  <Select
                    value={budget}
                    onValueChange={setBudget}
                    disabled={isPending}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select launch budget" />
                    </SelectTrigger>
                    <SelectContent>
                      {BUDGET_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Launch readiness
                    <span className="text-indigo-600 dark:text-indigo-400">
                      {" "}
                      *
                    </span>
                  </label>
                  <input type="hidden" name="readiness" value={readiness} />
                  <Select
                    value={readiness}
                    onValueChange={setReadiness}
                    disabled={isPending}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select launch readiness" />
                    </SelectTrigger>
                    <SelectContent>
                      {READINESS_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div aria-live="polite">
                {state && !state.success && (
                  <p className="text-sm text-red-600" role="alert">
                    {state.message}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                disabled={isPending}
                className="h-11 w-full bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
              >
                {isPending ? "Submitting..." : "See available times"}
                {!isPending && <ArrowRight className="h-3.5 w-3.5" />}
              </Button>

              <p className="text-center text-xs leading-relaxed text-muted-foreground/70">
                No commitment required. After booking, we&apos;ll review your
                answers and prepare a tailored 7-day launch plan before your
                call.
              </p>
            </form>
        </div>
      )}

      {/* Calendar embed — revealed after form submit */}
      {state?.success && (
        <div ref={calendarRef} className="scroll-mt-8">
          <CalendarEmbed
            prefillName={prefillName}
            prefillEmail={prefillEmail}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Testimonials ─── */

function Testimonials() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {CALL_TESTIMONIALS.map((t) => (
        <div key={t.name} className="flex flex-col rounded-xl border bg-card p-6">
          <blockquote className="mb-2 text-sm leading-relaxed text-muted-foreground">
            &ldquo;{t.quote}&rdquo;
          </blockquote>
          <div className="mt-auto flex items-center gap-2.5 border-t pt-5">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white ${t.color}`}
            >
              {t.initials}
            </div>
            <div>
              <p className="text-[13px] font-semibold">{t.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {t.role} &middot; {t.detail}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Page ─── */

export default function StrategyCallPage() {
  const [phase, setPhase] = useState<"form" | "calendar">("form");

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6">
      {/* Section 1: Hero — form phase only */}
      {phase === "form" && (
        <section className="pb-5 pt-10 sm:pt-12">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200/60 bg-indigo-50/50 px-3 py-1 text-xs font-semibold text-indigo-600 dark:border-indigo-800/30 dark:bg-indigo-950/30 dark:text-indigo-400">
              Step 1 of 2 — tell us about your fleet
            </span>

            <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tighter sm:text-4xl lg:text-[42px]">
              Your 7-day direct booking launch plan starts with a{" "}
              <span className="text-indigo-600 dark:text-indigo-400">
                20-minute call
              </span>
            </h1>

            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
              We&apos;ll review your current setup, show you what your own
              direct booking site could look like, and map out a launch plan
              tailored to your fleet.
            </p>
          </div>
        </section>
      )}

      {/* Section 2: What you get — form phase only */}
      {phase === "form" && (
        <section className="pb-6">
          <div className="grid gap-3 sm:grid-cols-3">
            {CALL_BENEFITS.map((item) => (
              <div key={item.title} className="rounded-xl border bg-card p-4">
                <div className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600/[0.08] dark:bg-indigo-400/[0.1]">
                  <item.icon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                </div>
                <h3 className="text-sm font-bold tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 3: Form → Calendar flow */}
      <section className={phase === "form" ? "pb-8" : "pb-8 pt-8"}>
        {phase === "form" && (
          <p className="mb-3 text-center text-sm text-muted-foreground">
            Built for independent rental operators across the
            US&ensp;&middot;&ensp;Direct booking infrastructure for private
            rental brands
          </p>
        )}
        <QualifierSection onPhaseChange={setPhase} />
      </section>

      {/* Section 4: Testimonials */}
      <section className="pb-8">
        <Testimonials />
      </section>

      {/* Section 6: Mini FAQ — form phase only */}
      {phase === "form" && (
        <section className="pb-10">
          <h2 className="mb-4 text-center text-base font-bold tracking-tight">
            Before you book
          </h2>
          <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
            {MINI_FAQ.map((item) => (
              <div key={item.q} className="bg-card p-4">
                <h3 className="text-sm font-bold tracking-tight">{item.q}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
