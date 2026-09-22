"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Star } from "lucide-react";
import { useFeedbackStore } from "@/stores/feedback-store";
import {
  useSubmitFeedback,
  useMarkFeedbackPrompted,
  useMyFeedback,
  FEEDBACK_MAX_MESSAGE,
} from "@/hooks/use-tenant-feedback";

/**
 * The v2 feedback box: a few words and five stars, and nothing else.
 *
 * A NEW FILE beside `feedback-dialog.tsx` rather than another branch inside it
 * (V2_PLAN §3). The v1 dialog keeps serving the other ~56 tenants byte for
 * byte; the dashboard layout picks between the two.
 *
 * ── WHAT WENT, AND WHY ────────────────────────────────────────────────────
 * "Remove the bug / improvement / feature-request categories and the
 * screenshot field — those belong to the support ticket system. Keep a
 * free-text box and a 5-star rating, and give it a bit of warmth: it shouldn't
 * be so bland." (team lead, Sep 20 2026.)
 *
 * So: no category chips, no screenshot (no drop zone, no paste handler, no
 * 5MB guard, no storage upload), no scrolling. Support is where a broken
 * screen goes — it has a thread, a status and someone who answers. This is
 * where an opinion goes.
 *
 * ── THE RATING HAS ITS OWN COLUMN ─────────────────────────────────────────
 * `tenant_feedback.rating` is `smallint NULL CHECK (rating IS NULL OR rating
 * BETWEEN 1 AND 5)`, applied as an additive migration (V2_PLAN §4): nullable
 * with no default, so every v1 INSERT that never mentions it still succeeds
 * and every pre-existing row keeps NULL.
 *
 * It briefly rode INSIDE `message` as a "4/5 stars" first line, because the
 * column did not exist yet. That is gone. It is worth recording why it was
 * only ever a stopgap: the last time a value was folded into a column that is
 * actually queried — `source` inside `page_path` — it made every prompted
 * submission invisible to any filter on that column. A rating is something you
 * average and group by, so prose was never the right home for it.
 *
 * `category` is sent as "note" for every submission from here — the existing
 * value whose own description was "anything else you'd like the Drive247 team
 * to know", which is exactly what an uncategorised comment is. No CHECK is
 * broken and no v1 reader has to learn a new value.
 */

/** 1–5, or null for "they didn't say". */
export type FeedbackRating = 1 | 2 | 3 | 4 | 5 | null;

/** What each star means, so the row says something rather than just counting. */
const RATING_WORDS: Record<number, string> = {
  1: "Rough going",
  2: "Could be better",
  3: "Doing the job",
  4: "Pretty good",
  5: "Love it",
};

/**
 * The v2 surface for the v1 Radix dialog this component is built on.
 *
 * Copied deliberately from `feedback-dialog.tsx` rather than shared: the point
 * of a separate file is that the v1 one can be deleted whole when this area is
 * widened, and an import would tie the two together again. The primitive is
 * `ui/dialog` and NOT `ui-v2/dialog` for the reason that file records — ui-v2
 * renders at `z-50`, which is UNDER the subscription gates at `z-[100]`, and a
 * feedback box that opens behind a modal is a feedback box nobody can use.
 */
const V2_DIALOG_SURFACE =
  "rounded-4xl sm:rounded-4xl border-0 bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/5 dark:ring-foreground/10";

export function FeedbackDialogV2() {
  const { isOpen, source, close } = useFeedbackStore();
  const pathname = usePathname();
  const submitFeedback = useSubmitFeedback();
  const markPrompted = useMarkFeedbackPrompted();
  const { data: myFeedback } = useMyFeedback();

  const [message, setMessage] = useState("");
  const [rating, setRating] = useState<FeedbackRating>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [view, setView] = useState<"submit" | "mine">("submit");
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Opening counts as "prompted" no matter how it ends. Stamping only on
  // submit would let a user who dismisses be re-prompted on every rental
  // close.
  const stampedRef = useRef(false);
  useEffect(() => {
    if (isOpen && !stampedRef.current) {
      stampedRef.current = true;
      void markPrompted();
    }
    if (!isOpen) stampedRef.current = false;
  }, [isOpen, markPrompted]);

  useEffect(() => {
    // Always reopen on the submit view — someone who left it on their history
    // last time would otherwise be prompted with a read-only list.
    if (isOpen) setView("submit");
  }, [isOpen]);

  const trimmed = message.trim();
  const remaining = FEEDBACK_MAX_MESSAGE - trimmed.length;
  const canSubmit = trimmed.length > 0 && remaining >= 0 && !submitFeedback.isPending;

  const handleSubmit = () => {
    submitFeedback.mutate(
      {
        // See the header: every submission from here is a plain note.
        category: "note",
        message: trimmed,
        // Every value in its own column: the rating is a number to average,
        // `page_path` stays a clean path, and `source` rides in `source`.
        rating,
        pagePath: pathname,
        source,
      },
      {
        onSuccess: () => {
          // Only cleared on success. If the insert fails the dialog stays open
          // with the text intact — losing a paragraph someone just typed is
          // the fastest way to make them never use this again.
          setMessage("");
          setRating(null);
          close();
        },
      }
    );
  };

  const shown = hovered ?? rating ?? 0;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next && !submitFeedback.isPending) close();
      }}
    >
      {/*
        560px and no `overflow-y-auto`. "Wide enough that nothing scrolls" was
        the request, and with the chips and the drop zone gone there is nothing
        left to scroll: a title, five stars, a box and two buttons. The history
        view scrolls INSIDE its own list rather than making the dialog scroll.
      */}
      <DialogContent
        className={"sm:max-w-[560px] " + V2_DIALOG_SURFACE}
        data-testid="feedback-dialog-v2"
        /* Radix focuses the first focusable child on open, which here is the
           one-star button — and the stars preview on focus, so the box opened
           showing "Rough going" before anyone had said a word. Land in the
           text box instead, which is where the typing goes anyway. */
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          messageRef.current?.focus();
        }}
      >
        {view === "submit" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-[17px] font-semibold">
                How&apos;s it going?
              </DialogTitle>
              <DialogDescription className="text-[13px]">
                Tell us what&apos;s working and what isn&apos;t. A real person reads
                every one of these — no ticket number, no hold music.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <div
                  className="flex items-center gap-1"
                  role="group"
                  aria-label="Rate your experience"
                  onMouseLeave={() => setHovered(null)}
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-label={`${value} out of 5`}
                      aria-pressed={rating === value}
                      onMouseEnter={() => setHovered(value)}
                      onFocus={() => setHovered(value)}
                      onBlur={() => setHovered(null)}
                      onClick={() => setRating(rating === value ? null : (value as FeedbackRating))}
                      className="rounded-full p-1 outline-none transition-transform cursor-pointer hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <Star
                        className={
                          "size-6 transition-colors " +
                          (value <= shown
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/40")
                        }
                      />
                    </button>
                  ))}
                  <span className="ml-2 text-[13px] text-muted-foreground" aria-live="polite">
                    {shown ? RATING_WORDS[shown] : "Stars optional — words matter more"}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Textarea
                  ref={messageRef}
                  id="feedback-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder="The good, the bad, and the &quot;why does it do that?&quot;"
                  className="resize-none rounded-xl text-[13px]"
                />
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => setView("mine")}
                    className="cursor-pointer text-primary underline-offset-2 hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]"
                  >
                    See what you&apos;ve sent
                  </button>
                  <span className={remaining < 0 ? "text-destructive" : undefined}>
                    {remaining.toLocaleString()} left
                  </span>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={submitFeedback.isPending}>
                Not now
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                {submitFeedback.isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Send feedback"
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-[17px] font-semibold">Your feedback</DialogTitle>
              <DialogDescription className="text-[13px]">
                Everything you&apos;ve sent us, and where it got to.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {(myFeedback ?? []).length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
                  Nothing yet. Be the first to tell us something.
                </p>
              ) : (
                (myFeedback ?? []).map((item: any) => (
                  <div key={item.id} className="rounded-xl border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                      <span
                        className={
                          "text-[11px] font-medium " +
                          (item.status === "resolved"
                            ? "text-green-600 dark:text-green-400"
                            : "text-muted-foreground")
                        }
                      >
                        {item.status === "resolved" ? "Answered" : "With the team"}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">
                      {item.message}
                    </p>
                  </div>
                ))
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setView("submit")}>
                Back
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
