"use client";

/**
 * The few pieces every full-screen signup screen is built from, so the five
 * screens read as one product: a picture, a headline, one Trax line, then the
 * fields. Everything is flat — 1px borders, no shadows — and every entrance is
 * the TRAX motion (200ms, opacity plus the 12px rise).
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Inputs on these screens: taller, rounder and larger type than the site default. */
export const SIGNUP_INPUT =
  "h-11 rounded-xl border-zinc-200 bg-white px-4 text-[15px] shadow-none md:text-[15px] dark:border-white/10 dark:bg-white/[0.03] focus-visible:border-indigo-500 focus-visible:ring-indigo-500/20 dark:focus-visible:border-indigo-400";

/** The one primary action per screen. */
export const SIGNUP_PRIMARY =
  "h-11 w-full rounded-xl bg-indigo-600 text-[15px] font-semibold text-white shadow-none transition-colors duration-200 ease-out hover:bg-indigo-700 disabled:bg-indigo-600/40 disabled:opacity-100 motion-reduce:transition-none dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:disabled:bg-indigo-500/30";

/** Quiet text actions (Back, Resend, Use a different email…). */
export const SIGNUP_QUIET =
  "text-sm font-medium text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none";

/** Field labels. */
export const SIGNUP_LABEL = "text-[13px] font-medium text-foreground/80";

/** The enter half of the TRAX motion, for anything that mounts. */
export const SIGNUP_ENTER =
  "animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none";

/** The signup card itself: solid, with a clear edge and a soft brand lift. */
export const SIGNUP_CARD =
  "rounded-[28px] border border-[#d4d3e6] bg-white shadow-[0_2px_4px_rgba(30,27,75,0.08),0_12px_28px_-8px_rgba(30,27,75,0.18),0_40px_90px_-30px_rgba(68,45,215,0.50)] dark:border-white/15 dark:bg-[#17171f] dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_40px_90px_-30px_rgba(0,0,0,0.85)]";

/**
 * The stage: a tinted band across the top of the card that the picture stands
 * in. Full-bleed — it cancels the card's padding with the negative margins the
 * caller passes — and it gives way on short screens (shorter below 820px of
 * height, gone below 700px) so the form always fits without scrolling.
 */
export function ArtStage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative h-[196px] overflow-hidden rounded-t-[27px] border-b border-indigo-200/70 bg-[linear-gradient(180deg,#f3f2ff_0%,#e5e3fd_100%)] dark:border-white/10 dark:bg-[linear-gradient(180deg,#24224d_0%,#1b1a3a_100%)] [@media(max-height:820px)]:h-[150px] [@media(max-height:700px)]:hidden",
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle,rgba(79,70,229,0.16)_1px,transparent_1.3px)] [mask-image:linear-gradient(to_bottom,black_20%,transparent_85%)] bg-[size:18px_18px] dark:bg-[radial-gradient(circle,rgba(165,180,252,0.14)_1px,transparent_1.3px)]"
      />
      {children}
    </div>
  );
}

/**
 * Picture, headline, one line. The picture stands in the card's stage at the
 * very top; the headline says the one thing the screen is for, and the line is
 * Trax speaking.
 */
export function ScreenHead({
  art,
  title,
  lead,
  titleId,
}: {
  art?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  titleId?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      {art ? <ArtStage className="-mx-6 -mt-7 mb-6 self-stretch sm:-mx-10 sm:-mt-8">{art}</ArtStage> : null}
      <h2 id={titleId} className="text-[24px] leading-[1.2] font-semibold tracking-[-0.02em] text-balance sm:text-[26px]">
        {title}
      </h2>
      {lead ? (
        <p className="mt-2 max-w-[380px] text-[14px] leading-relaxed text-pretty text-muted-foreground">
          {lead}
        </p>
      ) : null}
    </div>
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
 * The page wash — the same one the portal's onboarding questions sit on.
 *
 * Copied from the portal's `.bg-app-gradient::before` (styles/v2-theme.css)
 * plus the first-run wizard's two blurred blobs (`LiquidWash`), at the stock
 * Drive247 brand: `hsl(249 69% 51%)` is the portal's `--v2-wash` and
 * `hsl(247 92% 60%)` its `--chart-3`. apps do not share CSS, so the layers are
 * written out here; keep them in step with the portal if that wash changes.
 * Static on purpose — nothing behind the form competes with it.
 */
export function SignupWash() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(70rem_50rem_at_105%_-10%,hsl(249_69%_51%/0.20),transparent_55%),radial-gradient(60rem_48rem_at_-8%_-6%,hsl(247_92%_60%/0.16),transparent_52%),radial-gradient(55rem_45rem_at_50%_115%,hsl(249_69%_51%/0.12),transparent_55%),linear-gradient(180deg,hsl(249_69%_51%/0.07)_0%,transparent_45%)] dark:bg-[radial-gradient(70rem_50rem_at_105%_-10%,hsl(249_69%_60%/0.24),transparent_55%),radial-gradient(60rem_48rem_at_-8%_-6%,hsl(247_92%_66%/0.18),transparent_52%),radial-gradient(55rem_45rem_at_50%_115%,hsl(249_69%_60%/0.14),transparent_55%),linear-gradient(180deg,hsl(249_69%_60%/0.08)_0%,transparent_45%)]" />
      <div className="absolute -top-48 -right-48 size-[44rem] rounded-full bg-[hsl(249_69%_51%/0.08)] blur-[130px] motion-reduce:hidden dark:bg-[hsl(249_69%_60%/0.12)]" />
      <div className="absolute -bottom-48 -left-48 size-[44rem] rounded-full bg-[hsl(247_92%_60%/0.07)] blur-[130px] motion-reduce:hidden dark:bg-[hsl(247_92%_66%/0.10)]" />
    </div>
  );
}
