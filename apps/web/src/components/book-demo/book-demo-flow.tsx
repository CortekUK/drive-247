"use client";

import { useActionState, useEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GHL_BOOKING_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  getAllowedGhlOrigins,
  getGhlSessionQueryParam,
  isTrustedGhlCompletionMessage,
} from "@/lib/strategy-call/ghl-message";
import type { StrategyCallState } from "@/actions/strategy-call";
import { DemoBookingsArt, DemoFleetArt, DemoLaunchArt, DemoWhoArt } from "./demo-art";

/*
 * Booking a demo: a short form about the fleet, then the calendar. This is the flow that
 * used to be the /strategy-call page; the same eight questions reach the same save, the calendar is the same embed, and a finished booking still lands on
 * /strategy-call/confirmation.
 *
 * LAID OUT LIKE THE OPERATOR PORTAL'S "ADD A CUSTOMER" DIALOG (Ghulam, 2026-11-10: "exactly
 * that"; apps/portal/src/components/customers-v2/customer-form-dialog-v2.tsx and
 * shared/form-grid-v2.tsx): one small idea per screen, stacked and centred,
 *
 *   picture  →  the question, in one line  →  two fields
 *
 * with every screen the same height, so the fields always start in the same place and
 * nothing jumps or scrolls. The only chrome is the foot: Cancel or Back on the left, the
 * dots in the middle, Next or the finish on the right. Rendered inside <BookDemoDialog>.
 */

/* ─── Options ─── */

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

/* ─── GHL Booking Embed ─── */

function CalendarEmbed({
  prefillName,
  prefillEmail,
  sessionId,
}: {
  prefillName: string;
  prefillEmail: string;
  sessionId?: string;
}) {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [calendarSlow, setCalendarSlow] = useState(false);
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hasRedirectedRef = useRef(false);

  // The browser event is only a fast handoff. The verified webhook and the
  // persisted booking remain the source of truth for confirmation details.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const allowedOrigins = getAllowedGhlOrigins(
        process.env.NEXT_PUBLIC_GHL_ALLOWED_ORIGINS,
        GHL_BOOKING_URL,
      );
      if (
        hasRedirectedRef.current ||
        !isTrustedGhlCompletionMessage(
          event,
          iframeRef.current?.contentWindow,
          allowedOrigins,
        )
      ) return;

      hasRedirectedRef.current = true;
      router.replace("/strategy-call/confirmation");
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [router]);

  useEffect(() => {
    if (iframeLoaded) return;
    const timeout = window.setTimeout(() => setCalendarSlow(true), 12_000);
    return () => window.clearTimeout(timeout);
  }, [iframeLoaded]);

  const src = (() => {
    const url = new URL(GHL_BOOKING_URL);
    if (prefillName) url.searchParams.set("name", prefillName);
    if (prefillEmail) url.searchParams.set("email", prefillEmail);

    // GHL custom tracking/query support must be confirmed by its admin. We
    // only attach the non-secret session UUID when the parameter is explicitly
    // configured; the opaque raw session token never leaves its HttpOnly cookie.
    const sessionParam = getGhlSessionQueryParam(
      process.env.NEXT_PUBLIC_GHL_SESSION_QUERY_PARAM,
    );
    if (sessionId && sessionParam) url.searchParams.set(sessionParam, sessionId);
    return url.toString();
  })();

  return (
    <div className="relative">
      {!iframeLoaded && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl border bg-card p-6 text-center">
          <div className="text-sm text-muted-foreground">
            <p>{calendarSlow ? "The calendar is taking longer than expected." : "Loading calendar..."}</p>
            {calendarSlow && (
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-11 items-center font-medium text-indigo-600 underline underline-offset-4 dark:text-indigo-400"
              >
                Open the secure calendar in a new tab
              </a>
            )}
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={src}
        title="Book a strategy call"
        className="w-full rounded-xl border-0"
        style={{ height: 760 }}
        onLoad={() => {
          setIframeLoaded(true);
          setCalendarSlow(false);
        }}
        referrerPolicy="strict-origin-when-cross-origin"
        allow="payment; fullscreen"
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

/* ─── The portal's form kit, carried over: one 44px control shape, and a cell with a reserved line ─── */

const CONTROL =
  "h-11 w-full rounded-xl border border-foreground/15 bg-background px-3.5 text-sm text-foreground " +
  "shadow-[0_1px_2px_rgb(0_0_0/0.04)] outline-none transition-[border-color,box-shadow] duration-200 " +
  "placeholder:text-muted-foreground/70 hover:border-primary/40 focus-visible:border-primary/60 " +
  "focus-visible:ring-[3px] focus-visible:ring-primary/15 aria-invalid:border-destructive/60 " +
  "disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

const PILL =
  "inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium outline-none " +
  "transition-colors duration-200 focus-visible:ring-[3px] focus-visible:ring-primary/25 " +
  "disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none [&_svg]:size-4";
const PILL_OUTLINE = "border border-foreground/15 bg-background text-foreground hover:bg-muted";
const PILL_SOLID = "bg-primary text-primary-foreground hover:bg-primary/85";

function Cell({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <label className="col-span-2 flex min-w-0 flex-col gap-1.5">
      <span className="truncate px-0.5 text-[13px] font-medium text-foreground/80">
        {label}
        {required && <span className="ml-0.5 text-primary dark:text-[hsl(var(--v2-link))]">*</span>}
      </span>
      {children}
      {/* Reserved: an error never moves the row. */}
      <span className="min-h-[18px] truncate px-0.5 text-[11px] leading-[18px] text-destructive">{error}</span>
    </label>
  );
}

function Pick({ value, onChange, placeholder, options, invalid, disabled }: { value: string; onChange(v: string): void; placeholder: string; options: readonly string[]; invalid?: boolean; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-invalid={invalid || undefined} className={cn(CONTROL, "data-[placeholder]:text-muted-foreground/70 dark:bg-background")}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ─── The screens ─── */

type Field = "name" | "email" | "phone" | "fleet_size" | "current_platform" | "main_booking_source" | "budget" | "readiness";
type Values = Record<Field, string>;

const EMPTY: Values = { name: "", email: "", phone: "", fleet_size: "", current_platform: "", main_booking_source: "", budget: "", readiness: "" };

const STEPS: { name: string; art: ComponentType<{ className?: string }>; title: string; line: string; fields: Field[] }[] = [
  {
    name: "You",
    art: DemoWhoArt,
    title: "Book your free launch plan call",
    line: "Takes 60 seconds, so we can tailor the call to your fleet, booking setup and launch goals.",
    fields: ["name", "email"],
  },
  {
    name: "Your fleet",
    art: DemoFleetArt,
    title: "Tell us about your fleet",
    line: "How many cars you run, and the best number to reach you on.",
    fields: ["phone", "fleet_size"],
  },
  {
    name: "Bookings today",
    art: DemoBookingsArt,
    title: "How do you take bookings today?",
    line: "So we know what you are moving from, and where your renters come from.",
    fields: ["current_platform", "main_booking_source"],
  },
  {
    name: "Your launch",
    art: DemoLaunchArt,
    title: "And your launch",
    line: "No commitment required. We'll prepare a tailored 7-day launch plan before your call.",
    fields: ["budget", "readiness"],
  },
];

/** What a field must hold before its screen lets go. Empty string = fine. */
function problem(field: Field, v: Values): string {
  const value = v[field].trim();
  if (field === "name") return value ? "" : "Add your name";
  if (field === "email") return !value ? "Add your email" : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? "" : "That email doesn't look right";
  if (field === "fleet_size") return value ? "" : "Pick a fleet size";
  if (field === "current_platform") return value ? "" : "Pick a platform";
  if (field === "budget") return value ? "" : "Pick a launch budget";
  if (field === "readiness") return value ? "" : "Pick one";
  return "";
}

/*
 * Sends the answers to /api/strategy-call/submit, which runs the same save the old page's
 * server action ran. A plain post, not a server action: a server action that sets a cookie
 * makes Next re-send the whole page underneath, and over the landing page the dialog did
 * not survive that (see the route's own note).
 *
 * Nothing here throws. A dropped connection or an error page from the server becomes one
 * line under the fields and the same button to try again, with the answers still there.
 */
async function sendAnswers(_prev: StrategyCallState, formData: FormData): Promise<StrategyCallState> {
  try {
    const response = await fetch("/api/strategy-call/submit", { method: "POST", body: formData, credentials: "same-origin" });
    const result: unknown = await response.json();
    if (typeof result === "object" && result !== null && "success" in result && "message" in result) {
      return result as StrategyCallState;
    }
    throw new Error(`Unexpected answer (HTTP ${response.status})`);
  } catch (error) {
    console.error("Book a demo: the form could not be sent", error);
    return { success: false, message: "That didn't go through. Please try again." };
  }
}

export function BookDemoFlow({ onClose }: { onClose?(): void }) {
  const [state, formAction, isPending] = useActionState<StrategyCallState, FormData>(sendAnswers, null);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values>(EMPTY);
  // Errors show only for a screen the visitor has tried to leave.
  const [tried, setTried] = useState(-1);
  const screenRef = useRef<HTMLDivElement>(null);

  const set = (field: Field) => (value: string) => setValues((v) => ({ ...v, [field]: value }));
  const err = (field: Field) => (tried >= step ? problem(field, values) || undefined : undefined);
  const screen = STEPS[step];
  const last = step === STEPS.length - 1;

  // Each new screen opens on its first field to type in.
  useEffect(() => {
    screenRef.current?.querySelector<HTMLElement>("input:not([type=hidden]), button[role=combobox]")?.focus();
  }, [step]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    const ok = screen.fields.every((f) => !problem(f, values));
    if (!ok) {
      event.preventDefault();
      setTried(step);
      return;
    }
    // Every screen but the last only moves on; the last one lets the form post.
    if (!last) {
      event.preventDefault();
      setStep(step + 1);
    }
  };

  if (state?.success) {
    return (
      <div className="flex flex-col">
        <div className="h-[min(580px,calc(100svh-9rem))] overflow-y-auto px-6 pt-6 duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none sm:px-8">
          <h3 className="text-center text-xl font-medium leading-snug text-foreground">Pick a time that suits you</h3>
          <p className="mx-auto mb-4 mt-1.5 text-center text-sm leading-relaxed text-muted-foreground">A 20-minute call with our founding team.</p>
          <CalendarEmbed
            prefillName={values.name.trim()}
            prefillEmail={values.email.trim().toLowerCase()}
            sessionId={"sessionId" in state && typeof state.sessionId === "string" ? state.sessionId : undefined}
          />
        </div>
        <div className="flex items-center justify-center px-8 py-4">
          <button type="button" onClick={onClose} className={cn(PILL, PILL_OUTLINE)}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={submit} noValidate className="flex flex-col">
      {/* Not for people: a field only a bot fills in. */}
      <div aria-hidden="true" className="pointer-events-none absolute -left-[10000px] top-auto size-px overflow-hidden">
        <label htmlFor="sc-website">Website</label>
        <input id="sc-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      {/* Every answer travels with the form, whichever screen is showing. */}
      {(Object.keys(EMPTY) as Field[]).map((field) => (
        <input key={field} type="hidden" name={field} value={field === "email" ? values.email.trim().toLowerCase() : values[field].trim()} />
      ))}

      {/* One screen: picture, the question, two fields. The same height on every step. */}
      <div
        key={step}
        ref={screenRef}
        className="flex h-[500px] flex-col items-center overflow-hidden px-6 pt-8 duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none sm:px-10"
      >
        <screen.art className="max-w-[280px]" />
        <h3 className="mt-4 text-center text-xl font-medium leading-snug text-foreground [text-wrap:balance]">{screen.title}</h3>
        <p className="mx-auto mt-1.5 min-h-[2lh] max-w-[24rem] text-center text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
          {screen.line}
        </p>

        <div className="mx-auto mt-5 grid w-full max-w-[420px] grid-cols-2 gap-x-5 gap-y-1">
          {step === 0 && (
            <>
              <Cell label="Name" required error={err("name")}>
                <input value={values.name} onChange={(e) => set("name")(e.target.value)} placeholder="John Smith" autoComplete="name" aria-invalid={!!err("name") || undefined} disabled={isPending} className={CONTROL} />
              </Cell>
              <Cell label="Email" required error={err("email")}>
                <input value={values.email} onChange={(e) => set("email")(e.target.value)} type="email" placeholder="john@example.com" autoComplete="email" aria-invalid={!!err("email") || undefined} disabled={isPending} className={CONTROL} />
              </Cell>
            </>
          )}
          {step === 1 && (
            <>
              <Cell label="Phone number">
                <input value={values.phone} onChange={(e) => set("phone")(e.target.value)} type="tel" placeholder="(555) 123-4567" autoComplete="tel" disabled={isPending} className={CONTROL} />
              </Cell>
              <Cell label="Fleet size" required error={err("fleet_size")}>
                <Pick value={values.fleet_size} onChange={set("fleet_size")} placeholder="Select fleet size" options={FLEET_SIZE_OPTIONS} invalid={!!err("fleet_size")} disabled={isPending} />
              </Cell>
            </>
          )}
          {step === 2 && (
            <>
              <Cell label="Current platform" required error={err("current_platform")}>
                <Pick value={values.current_platform} onChange={set("current_platform")} placeholder="Select platform" options={PLATFORM_OPTIONS} invalid={!!err("current_platform")} disabled={isPending} />
              </Cell>
              <Cell label="Main booking source">
                <Pick value={values.main_booking_source} onChange={set("main_booking_source")} placeholder="Select source" options={BOOKING_SOURCE_OPTIONS} disabled={isPending} />
              </Cell>
            </>
          )}
          {step === 3 && (
            <>
              <Cell label="Launch budget" required error={err("budget")}>
                <Pick value={values.budget} onChange={set("budget")} placeholder="Select launch budget" options={BUDGET_OPTIONS} invalid={!!err("budget")} disabled={isPending} />
              </Cell>
              <Cell label="Launch readiness" required error={err("readiness")}>
                <Pick value={values.readiness} onChange={set("readiness")} placeholder="Select launch readiness" options={READINESS_OPTIONS} invalid={!!err("readiness")} disabled={isPending} />
              </Cell>
            </>
          )}
        </div>

        <p aria-live="polite" role={state && !state.success ? "alert" : undefined} className="mt-1 min-h-5 text-center text-sm text-destructive">
          {state && !state.success ? state.message : ""}
        </p>
      </div>

      {/* The foot: Cancel or Back, where you are, Next or the finish. Nothing else. */}
      <div className="flex items-center justify-between gap-4 px-6 py-4 sm:px-8">
        <button type="button" className={cn(PILL, PILL_OUTLINE)} onClick={() => (step === 0 ? onClose?.() : setStep(step - 1))} disabled={isPending}>
          {step === 0 ? (
            "Cancel"
          ) : (
            <>
              <ArrowLeft /> Back
            </>
          )}
        </button>

        <ol className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}: ${screen.name}`}>
          {STEPS.map((s, i) => (
            <li
              key={s.name}
              title={s.name}
              className={cn(
                "size-1.5 rounded-full transition-colors duration-200 motion-reduce:transition-none",
                i === step ? "bg-primary dark:bg-[hsl(var(--v2-link))]" : i < step ? "bg-primary/40" : "bg-foreground/15",
              )}
            />
          ))}
        </ol>

        <button type="submit" className={cn(PILL, last ? PILL_SOLID : PILL_OUTLINE)} disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="animate-spin" /> Sending…
            </>
          ) : last ? (
            <>
              See available times <ArrowRight />
            </>
          ) : (
            <>
              Next <ArrowRight />
            </>
          )}
        </button>
      </div>
    </form>
  );
}
