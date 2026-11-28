"use client";

/**
 * The few pieces every full-screen signup screen is built from.
 *
 * THE LOOK IS THE PORTAL'S ONBOARDING QUESTIONS (Ghulam, 2026-11-23). Every
 * signup screen now wears the design of the portal's first-run questions
 * (apps/portal/src/components/onboarding/first-run-wizard.tsx): no card, no
 * picture, the screen's one heading at display size in Manrope, left-aligned on
 * the page wash, fields as bare underlines, and the chrome reduced to thin
 * progress lines and a Back / Continue pair in the bottom corner.
 *
 * Apps do not share components, so the numbers are copied here. Keep them in
 * step with the portal if the questions change.
 */

import { createContext, forwardRef, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import "./signup-motion.css";

/**
 * The heading face. Manrope, loaded once in the root layout as
 * `--font-signup-display` (the portal sets its headings in it too).
 */
export const SIGNUP_DISPLAY = "font-[family-name:var(--font-signup-display),var(--font-sans)]";

/** The screen's heading: the questions' prompt, same size, weight and tracking. */
export const SIGNUP_TITLE = cn(
  SIGNUP_DISPLAY,
  "text-[clamp(2rem,5.2vw,3.5rem)] leading-[1.04] font-medium tracking-[-0.032em] text-balance text-foreground",
  // A short window (a laptop with its browser bars) gets a smaller heading,
  // so the screen fits without scrolling.
  "sm:[@media(max-height:760px)]:text-[clamp(1.75rem,4vw,2.75rem)]",
  // Phones: small enough that "Let's get you on the road" is one line that
  // clears the close button, down to a 320px-wide screen (Ghulam,
  // 2026-11-23: every screen must fit a phone without scrolling).
  "max-sm:text-[clamp(22px,7vw,28px)]",
);

/** The one muted line under the heading (the questions' help line). */
export const SIGNUP_LEAD = "max-w-[52ch] text-[15px] leading-relaxed text-pretty text-muted-foreground";

/**
 * Short windows (Ghulam, 2026-11-23: every screen fits one screen, on a
 * phone or a laptop, without scrolling). Sized by the window's HEIGHT, so a
 * laptop window is treated like a phone of the same height: 760px or less
 * 880px or less makes fields 40px tall with less space between them, 700px
 * or less also drops the gap under each label. The two heights are separate
 * ranges where they set the same thing (a 760px rule otherwise beat a 700px
 * one in the stylesheet). Checked at phone sizes from 320x568 and
 * laptop windows from 1280x600.
 *
 * Inputs: a bare rule, no box. The rule turns indigo and thickens on focus,
 * the way the questions' free-text answer does. 18px type (16px minimum on
 * phones, or iOS zooms the page into the field).
 */
export const SIGNUP_INPUT =
  "h-12 [@media(max-height:880px)]:h-10 [@media(max-height:700px)]:mt-0 rounded-none border-0 border-b border-foreground/15 bg-transparent px-0 text-[18px] shadow-none md:text-[18px] max-sm:text-[17px] caret-indigo-600 placeholder:text-foreground/25 focus-visible:border-indigo-600 focus-visible:ring-0 focus-visible:shadow-[inset_0_-1px_0_0_var(--color-indigo-600)] aria-invalid:border-red-500 aria-invalid:ring-0 dark:bg-transparent dark:border-white/15 dark:caret-indigo-400 dark:placeholder:text-white/25 dark:focus-visible:border-indigo-400 dark:focus-visible:shadow-[inset_0_-1px_0_0_var(--color-indigo-400)] dark:aria-invalid:ring-0";

/** The one forward action per screen: the questions' accent pill. */
export const SIGNUP_PRIMARY =
  "h-11 rounded-full bg-indigo-600 px-7 text-[15px] font-medium text-white shadow-none transition-[background-color,transform] duration-200 ease-out hover:bg-indigo-700 active:translate-y-px focus-visible:ring-[3px] focus-visible:ring-indigo-500/30 disabled:pointer-events-none disabled:bg-indigo-600/25 disabled:text-white/80 disabled:opacity-100 motion-reduce:transition-none dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:disabled:bg-indigo-500/25";

/**
 * The footer's two angle brackets (Ghulam, 2026-11-23: "just the angle
 * brackets"). Forward is the accent pill drawn round; back is its outline.
 * What each one does is still said, in the tooltip and to a screen reader.
 */
export const SIGNUP_ARROW = cn(SIGNUP_PRIMARY, "inline-flex size-11 shrink-0 items-center justify-center px-0");
export const SIGNUP_BACK_ARROW =
  "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground ring-1 ring-foreground/15 transition-colors duration-200 ease-out hover:bg-foreground/[0.04] focus-visible:ring-[3px] focus-visible:ring-indigo-500/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none dark:ring-white/15";

/** Quiet text actions (Back, Resend, Use a different email…). */
export const SIGNUP_QUIET =
  "rounded-full text-sm text-muted-foreground underline-offset-4 transition-colors duration-200 ease-out hover:text-foreground disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none";

/**
 * Phones: widens a small text action's tap area to about 44px without moving
 * anything (an invisible box around it), so "Back", "Resend code" and friends
 * are easy to hit with a thumb. Desktop is untouched.
 */
export const SIGNUP_HIT =
  "relative max-sm:after:absolute max-sm:after:-inset-x-2 max-sm:after:-inset-y-3 max-sm:after:content-['']";

/** Field labels: small and muted, so the heading stays the only loud thing. */
export const SIGNUP_LABEL = "text-[13px] font-medium text-muted-foreground";

/** The enter half of the TRAX motion, for small things that mount (errors, notes). */
export const SIGNUP_ENTER =
  "animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none";

/** A whole screen arriving: the questions' blur-and-rise (signup-motion.css). */
export const SIGNUP_RISE = "signup-rise";

/**
 * The fields under a heading: one column on phones, two on anything wider,
 * kept to a readable width on a big screen. A field that needs the whole row
 * takes `sm:col-span-2`.
 */
export const SIGNUP_FIELDS =
  "signup-rise signup-rise-3 mx-auto grid w-full max-w-[46rem] grid-cols-1 gap-x-10 gap-y-6 text-left sm:grid-cols-2 [@media(min-height:701px)_and_(max-height:880px)]:gap-y-4 [@media(max-height:700px)]:gap-y-3";

/**
 * A row of quiet actions under a screen's fields (Google, "Already started?",
 * Resend, Forgot password?), centred like everything else on the screen.
 */
export const SIGNUP_ACTIONS = "flex flex-wrap items-center justify-center gap-x-6 gap-y-3";

/**
 * ONE COLUMN (Ghulam, 2026-11-23: "same layout on this screen and on other as
 * well"). Every signup screen with fields is one centred column: the fields,
 * then the screen's own full-width button, then any quiet links. The footer's
 * arrows are hidden on these screens, so the footer is only the progress.
 */
export const ONE_COLUMN_WIDTH = "mx-auto w-full max-w-[28rem]";
/** Add to `SIGNUP_FIELDS` for the one-column grid. */
export const ONE_COLUMN = cn(ONE_COLUMN_WIDTH, "sm:grid-cols-1");
/** The gap between a heading and the fields under it, by window height. */
export const UNDER_HEAD = "mt-10 [@media(min-height:701px)_and_(max-height:880px)]:mt-8 [@media(min-height:620px)_and_(max-height:700px)]:mt-6 [@media(max-height:619px)]:mt-4";

/** The buttons under a one-column screen's fields. */
export function ColumnActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "signup-rise signup-rise-4 mt-8 flex flex-col items-stretch gap-3 [@media(max-height:880px)]:gap-2 [@media(min-height:701px)_and_(max-height:880px)]:mt-5 [@media(min-height:620px)_and_(max-height:700px)]:mt-4 [@media(max-height:619px)]:mt-3",
        ONE_COLUMN_WIDTH,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A row of quiet links under the button ("Forgot password?", "Back"…). */
export function ColumnLinks({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 [@media(max-height:880px)]:mt-0.5">{children}</div>;
}

/** The screen's one full-width button: submits its form unless told otherwise. */
export const ColumnButton = forwardRef<
  HTMLButtonElement,
  {
    busy?: boolean;
    disabled?: boolean;
    type?: "submit" | "button";
    /** Submits this form by id from outside it (the card step's Stripe form). */
    form?: string;
    onClick?(): void;
    children: ReactNode;
  }
>(function ColumnButton({ busy = false, disabled = false, type = "submit", form, onClick, children }, ref) {
  return (
    <Button
      ref={ref}
      type={type}
      form={form}
      disabled={busy || disabled}
      onClick={onClick}
      className={cn(SIGNUP_PRIMARY, "w-full [@media(max-height:700px)]:h-10")}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </Button>
  );
});

/**
 * Heading and one line, left-aligned, as the questions' prompt and help line.
 * `art` is accepted and ignored: the questions have no pictures, so neither
 * does the signup.
 */
export function ScreenHead({
  title,
  lead,
  titleId,
  leadClassName,
}: {
  art?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  titleId?: string;
  /** For example, hiding the line in a very short window so the screen fits. */
  leadClassName?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h2 id={titleId} className={cn(SIGNUP_TITLE, SIGNUP_RISE, "max-w-[22ch]")}>
        {title}
      </h2>
      {lead ? <p className={cn(SIGNUP_LEAD, SIGNUP_RISE, "signup-rise-2 mx-auto", leadClassName)}>{lead}</p> : null}
    </div>
  );
}

/**
 * The star on a required field's label (Ghulam, 2026-11-23). Optional fields
 * carry nothing, not even "(optional)". A screen reader hears "required".
 */
export function RequiredMark() {
  return (
    <>
      {/* Pulled in against the Label's own 8px gap, so it sits by the word. */}
      <span aria-hidden className="-ml-1.5 text-red-500 dark:text-red-400">
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

/** A field's error line, in one place so every screen says it the same way. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className={cn("mt-1.5 text-[13px] text-red-600 dark:text-red-400", SIGNUP_ENTER)}>
      {children}
    </p>
  );
}

/**
 * The footer's action slot.
 *
 * The questions keep their one forward button in the bottom-right corner, and
 * so does the signup. Most screens are submitted by the shell's own button
 * there; the few that own their action (the email code, the sign-in panel)
 * hand it to the same corner with <FooterAction>, which portals it into the
 * slot the shell provides. Rendered without a shell (a test, a preview), it
 * simply draws in place.
 */
const FooterSlotContext = createContext<HTMLElement | null>(null);

export const FooterSlotProvider = FooterSlotContext.Provider;

export function FooterAction({ children }: { children: ReactNode }) {
  const slot = useContext(FooterSlotContext);
  if (slot) return createPortal(children, slot);
  return <div className="mt-8 flex flex-wrap items-center justify-center gap-6">{children}</div>;
}

/**
 * The questions' progress: one short line per step, the current one longer
 * and in the accent, the finished ones a lighter accent.
 */
export function StepLines({
  total,
  current,
  label,
}: {
  total: number;
  /** Zero-based; everything before it counts as done. */
  current: number;
  label: string;
}) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={Math.min(current + 1, total)}
      aria-label={label}
      className="flex items-center gap-1.5"
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            "h-[3px] rounded-full transition-all duration-500 ease-out motion-reduce:transition-none",
            i === current
              ? "w-9 bg-indigo-600 dark:bg-indigo-400"
              : i < current
                ? "w-5 bg-indigo-600/40 dark:bg-indigo-400/40"
                : "w-5 bg-foreground/[0.12]",
          )}
        />
      ))}
    </div>
  );
}

/**
 * The page wash, the same one the portal's onboarding questions sit on.
 *
 * Copied from the portal's `.bg-app-gradient::before` (styles/v2-theme.css)
 * plus the first-run wizard's two blurred blobs (`LiquidWash`), at the stock
 * Drive247 brand: `hsl(249 69% 51%)` is the portal's `--v2-wash` and
 * `hsl(247 92% 60%)` its `--chart-3`. apps do not share CSS, so the layers are
 * written out here; keep them in step with the portal if that wash changes.
 * Fixed to the viewport, like the questions' wash, so it stays put while a
 * long screen scrolls over it. Static on purpose: nothing behind the form
 * competes with it.
 */
export function SignupWash() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(70rem_50rem_at_105%_-10%,hsl(249_69%_51%/0.20),transparent_55%),radial-gradient(60rem_48rem_at_-8%_-6%,hsl(247_92%_60%/0.16),transparent_52%),radial-gradient(55rem_45rem_at_50%_115%,hsl(249_69%_51%/0.12),transparent_55%),linear-gradient(180deg,hsl(249_69%_51%/0.07)_0%,transparent_45%)] dark:bg-[radial-gradient(70rem_50rem_at_105%_-10%,hsl(249_69%_60%/0.24),transparent_55%),radial-gradient(60rem_48rem_at_-8%_-6%,hsl(247_92%_66%/0.18),transparent_52%),radial-gradient(55rem_45rem_at_50%_115%,hsl(249_69%_60%/0.14),transparent_55%),linear-gradient(180deg,hsl(249_69%_60%/0.08)_0%,transparent_45%)]" />
      <div className="absolute -top-48 -right-48 size-[44rem] rounded-full bg-[hsl(249_69%_51%/0.08)] blur-[130px] motion-reduce:hidden dark:bg-[hsl(249_69%_60%/0.12)]" />
      <div className="absolute -bottom-48 -left-48 size-[44rem] rounded-full bg-[hsl(247_92%_60%/0.07)] blur-[130px] motion-reduce:hidden dark:bg-[hsl(247_92%_66%/0.10)]" />
    </div>
  );
}
