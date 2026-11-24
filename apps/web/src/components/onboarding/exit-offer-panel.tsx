"use client";

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  ColumnActions,
  ColumnButton,
  ColumnLinks,
  ScreenHead,
  SIGNUP_ENTER,
  SIGNUP_HIT,
  SIGNUP_QUIET,
} from "./signup-ui";

export type FinishLaterState = "idle" | "sending" | "sent" | "failed";

/**
 * "Not ready just yet?" — drawn inside the signup card, in place of the card
 * step (which stays mounted behind it, so a half-typed card survives). The
 * owner's copy, word for word; no capitals, exclamation marks or timers.
 *
 * During Black Friday (`blackFriday`) every signup already has BF30, which is
 * more than WELCOME20, so the popup offers no code: it says the price is kept
 * and offers the "email me a link" (on every device). Neema's copy.
 */
export const ExitOfferPanel = forwardRef<
  HTMLButtonElement,
  {
    applying: boolean;
    /** Black Friday copy: no code to apply, the link is the main button. */
    blackFriday?: boolean;
    /** Phones only (every device during Black Friday): "Email me a link to finish later". */
    showFinishLater: boolean;
    finishLater: FinishLaterState;
    onAccept(): void;
    onFinishLater(): void;
    onDismiss(): void;
  }
>(function ExitOfferPanel({ applying, blackFriday = false, showFinishLater, finishLater, onAccept, onFinishLater, onDismiss }, ref) {
  const sent = finishLater === "sent";
  if (blackFriday) {
    return (
      <section aria-labelledby="signup-exit-offer-title" aria-describedby="signup-exit-offer-lead">
        <ScreenHead
          titleId="signup-exit-offer-title"
          title="Your Black Friday price is saved until Monday"
          lead={
            <span id="signup-exit-offer-lead">
              30% off your first 3 months, plus 14 days free. Want us to email you a link to finish later?
            </span>
          }
        />
        <ColumnActions className="mt-10">
          {sent ? (
            <p role="status" className={cn("py-2 text-center text-[14px] text-muted-foreground", SIGNUP_ENTER)}>
              Sent. Your Black Friday price is in the link.
            </p>
          ) : (
            <>
              <ColumnButton ref={ref} type="button" busy={finishLater === "sending"} onClick={onFinishLater}>
                Email me a link to finish later
              </ColumnButton>
              {finishLater === "failed" && (
                <p role="status" className="text-center text-[13px] text-muted-foreground">
                  We couldn&apos;t send that just now. Please try again.
                </p>
              )}
            </>
          )}
          <ColumnLinks>
            <button type="button" onClick={onDismiss} className={cn(SIGNUP_QUIET, SIGNUP_HIT)}>
              {sent ? "Close" : "Continue now"}
            </button>
          </ColumnLinks>
        </ColumnActions>
      </section>
    );
  }
  return (
    <section aria-labelledby="signup-exit-offer-title" aria-describedby="signup-exit-offer-lead">
      <ScreenHead
        titleId="signup-exit-offer-title"
        title="Not ready just yet?"
        lead={
          <span id="signup-exit-offer-lead">
            Start your free trial today and get 20% off your first 3 months. Nothing to pay for 14 days, and you can
            cancel anytime before then.
          </span>
        }
      />
      {/* One column like every signup screen (Ghulam, 2026-11-23). */}
      <ColumnActions className="mt-10">
        <ColumnButton ref={ref} type="button" busy={applying} onClick={onAccept}>
          {applying ? "Applying…" : "Apply 20% off and continue"}
        </ColumnButton>

        {showFinishLater ? (
          sent ? (
            <p role="status" className={cn("py-2 text-center text-[14px] text-muted-foreground", SIGNUP_ENTER)}>
              Sent. Check your inbox when you&apos;re at your computer.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={onFinishLater}
                disabled={applying || finishLater === "sending"}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-full px-6 text-[15px] font-medium text-foreground ring-1 ring-foreground/15 transition-colors duration-200 ease-out hover:bg-foreground/[0.03] disabled:opacity-50 motion-reduce:transition-none dark:ring-white/15"
              >
                {finishLater === "sending" && <Loader2 className="h-4 w-4 animate-spin" />}
                Email me a link to finish later
              </button>
              {finishLater === "failed" && (
                <p role="status" className="text-center text-[13px] text-muted-foreground">
                  We couldn&apos;t send that just now. Please try again.
                </p>
              )}
            </>
          )
        ) : null}

        <ColumnLinks>
          <button
            type="button"
            onClick={onDismiss}
            disabled={applying}
            className={cn(SIGNUP_QUIET, SIGNUP_HIT)}
          >
            {sent ? "Close" : "No thanks"}
          </button>
        </ColumnLinks>
      </ColumnActions>
    </section>
  );
});
