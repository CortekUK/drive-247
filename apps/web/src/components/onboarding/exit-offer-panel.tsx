"use client";

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ScreenHead, SIGNUP_ENTER, SIGNUP_HIT, SIGNUP_PRIMARY, SIGNUP_QUIET } from "./signup-ui";

export type FinishLaterState = "idle" | "sending" | "sent" | "failed";

/**
 * "Not ready just yet?" — drawn inside the signup card, in place of the card
 * step (which stays mounted behind it, so a half-typed card survives). The
 * owner's copy, word for word; no capitals, exclamation marks or timers.
 */
export const ExitOfferPanel = forwardRef<
  HTMLButtonElement,
  {
    applying: boolean;
    /** Phones only: "Email me a link to finish later". */
    showFinishLater: boolean;
    finishLater: FinishLaterState;
    onAccept(): void;
    onFinishLater(): void;
    onDismiss(): void;
  }
>(function ExitOfferPanel({ applying, showFinishLater, finishLater, onAccept, onFinishLater, onDismiss }, ref) {
  const sent = finishLater === "sent";
  return (
    <section className={SIGNUP_ENTER} aria-labelledby="signup-exit-offer-title" aria-describedby="signup-exit-offer-lead">
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
      <div className="mt-6 space-y-3">
        <Button ref={ref} type="button" onClick={onAccept} disabled={applying} className={SIGNUP_PRIMARY}>
          {applying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Applying…
            </>
          ) : (
            "Apply 20% off and continue"
          )}
        </Button>

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
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white text-[15px] font-semibold text-foreground transition-colors duration-200 ease-out hover:bg-zinc-50 disabled:opacity-50 motion-reduce:transition-none dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
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

        <button
          type="button"
          onClick={onDismiss}
          disabled={applying}
          className={cn(SIGNUP_QUIET, SIGNUP_HIT, "block w-full text-center")}
        >
          {sent ? "Close" : "No thanks"}
        </button>
      </div>
    </section>
  );
});
