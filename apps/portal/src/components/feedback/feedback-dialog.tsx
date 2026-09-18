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
import { Label } from "@/components/ui/label";
import { Bug, Wrench, Sparkles, StickyNote, ImagePlus, X, Loader2 } from "lucide-react";
import { useFeedbackStore, type FeedbackCategory } from "@/stores/feedback-store";
import {
  useSubmitFeedback,
  useMarkFeedbackPrompted,
  useMyFeedback,
  FEEDBACK_MAX_MESSAGE,
  FEEDBACK_MAX_SCREENSHOT_BYTES,
  FEEDBACK_ACCEPTED_MIME,
} from "@/hooks/use-tenant-feedback";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useV2 } from "@/lib/v2-context";

/**
 * The four kinds of feedback, unchanged on both designs.
 *
 * "Bug" is still here on purpose. The plan is for bug reports to leave this
 * dialog eventually and be raised somewhere of their own, but that is a
 * separate decision — removing the option now would leave an operator with a
 * broken screen and nowhere in the product to say so.
 */
const CATEGORIES: {
  value: FeedbackCategory;
  label: string;
  icon: typeof Bug;
  /** Inline styles, not Tailwind classes — these hexes come from the design
   *  system and would otherwise need safelisting for arbitrary values. */
  color: string;
  placeholder: string;
}[] = [
  {
    value: "bug",
    label: "Bug",
    icon: Bug,
    color: "#dc2626",
    placeholder:
      "What went wrong? Tell us what you were doing and what you expected to happen instead.",
  },
  {
    value: "improvement",
    label: "Improvement",
    icon: Wrench,
    color: "#d97706",
    placeholder: "What's slowing you down? Tell us which part of the workflow feels clunky.",
  },
  {
    value: "feature_request",
    label: "Feature Request",
    icon: Sparkles,
    color: "#6366f1",
    placeholder: "What would you like to be able to do that you can't today?",
  },
  {
    value: "note",
    label: "Note",
    icon: StickyNote,
    color: "#737373",
    placeholder: "Anything else you'd like the Drive247 team to know.",
  },
];

/**
 * The v2 surface for the v1 Radix dialog this component is built on.
 *
 * Same tokens, and the same reasoning, as `subscription-gate-dialog.tsx`: the
 * primitive stays (swapping to `ui-v2/dialog` would move this from `z-[100]` to
 * `z-50`, i.e. under the gates), and only the surface changes — v1's hard
 * border and flat shadow for the popover background, ring and 26px corner every
 * other v2 dialog on the same screen already wears.
 *
 * `sm:rounded-4xl` is not redundant: `sm:rounded-lg` lives in the primitive's
 * base class and lands inside a media query, so it beats a base-layer
 * `rounded-4xl` from 640px up. `border-0`, `bg-popover` and `shadow-xl` collide
 * with base classes and are resolved by the primitive's own `cn`, last writer
 * winning, which is this string.
 */
const V2_DIALOG_SURFACE =
  "rounded-4xl sm:rounded-4xl border-0 bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/5 dark:ring-foreground/10";

/** The v2 hover pair, spelled once so the four surfaces that use it cannot drift. */
const V2_HOVER = "hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]";

/**
 * The single feedback dialog. Mounted once in the dashboard layout; every entry
 * point (sidebar button, rental-completion follow-up, forced-login prompt)
 * drives it through `useFeedbackStore`.
 *
 * ── v2 ──────────────────────────────────────────────────────────────────────
 *
 * v2 gets the same dialog, smaller and quieter: the v2 dialog surface, tokens
 * instead of the design-system hexes, the type chips as pills, `rounded-xl`
 * fields and tighter spacing. Behaviour is shared — same four categories, same
 * 5MB/JPG-PNG-WebP screenshot guard, same submit and error paths — and v1's
 * class strings are left byte-for-byte as they are, because the other ~56
 * tenants must see no change at all.
 *
 * The launcher and the prompting cadence are NOT decided here. This dialog is
 * always reachable from the bottom-left launcher; the "ask them again" nudge is
 * being moved to a system-announcement template that is switched on and off by
 * hand (no cron), which another session owns.
 */
export function FeedbackDialog() {
  const { isOpen, prefillCategory, source, close } = useFeedbackStore();
  const v2 = useV2("chrome");
  const pathname = usePathname();
  const { toast } = useToast();
  const submitFeedback = useSubmitFeedback();
  const markPrompted = useMarkFeedbackPrompted();
  const { data: myFeedback } = useMyFeedback();

  // "submit" is always the landing view — the list is opt-in, so a prompted
  // user still lands on the thing we asked them to do.
  const [view, setView] = useState<"submit" | "mine">("submit");
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Opening counts as "prompted" no matter how it ends. Stamping only on submit
  // would let a user who dismisses get re-prompted on every rental close.
  const stampedRef = useRef(false);
  useEffect(() => {
    if (isOpen && !stampedRef.current) {
      stampedRef.current = true;
      void markPrompted();
    }
    if (!isOpen) stampedRef.current = false;
  }, [isOpen, markPrompted]);

  useEffect(() => {
    if (isOpen) {
      setCategory(prefillCategory ?? "bug");
      // Always reopen on the submit view — a user who left it on their history
      // last time would otherwise be prompted with a read-only list.
      setView("submit");
    }
  }, [isOpen, prefillCategory]);

  // Only clear the form after a SUCCESSFUL send. If the insert fails, the
  // dialog stays open with the text intact — losing a paragraph someone just
  // typed is the fastest way to make them never use this again.
  const resetForm = () => {
    setMessage("");
    setScreenshot(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const attachFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!FEEDBACK_ACCEPTED_MIME.includes(file.type)) {
      toast({
        title: "Unsupported image",
        description: "Please attach a JPG, PNG or WebP.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > FEEDBACK_MAX_SCREENSHOT_BYTES) {
      toast({
        title: "Image too large",
        description: "Screenshots must be under 5MB.",
        variant: "destructive",
      });
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setScreenshot(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const clearScreenshot = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setScreenshot(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Paste-to-attach: the single most common way anyone actually produces a
  // screenshot (PrtSc / Cmd-Shift-4 both land on the clipboard, not on disk).
  const handlePaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData?.items || []).find((i) =>
      i.type.startsWith("image/")
    );
    if (item) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        attachFile(file);
      }
    }
  };

  const handleSubmit = () => {
    submitFeedback.mutate(
      {
        category,
        message,
        screenshot,
        // page_path stays a clean path. `source` rides in its own column —
        // appending it here made every prompted submission invisible to any
        // filter or GROUP BY on the page.
        pagePath: pathname,
        source,
      },
      {
        onSuccess: () => {
          resetForm();
          close();
        },
      }
    );
  };

  const active = CATEGORIES.find((c) => c.value === category)!;
  const remaining = FEEDBACK_MAX_MESSAGE - message.length;
  const canSubmit = message.trim().length > 0 && !submitFeedback.isPending;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next && !submitFeedback.isPending) close();
      }}
    >
      <DialogContent
        className={
          v2
            ? `sm:max-w-[480px] max-h-[85vh] overflow-y-auto ${V2_DIALOG_SURFACE}`
            : "sm:max-w-[560px] max-h-[90vh] overflow-y-auto"
        }
      >
        <DialogHeader>
          <DialogTitle
            className={
              v2 ? "text-base font-medium" : "text-[#080812] dark:text-white"
            }
          >
            {view === "submit" ? "Send feedback to Drive247" : "Your feedback"}
          </DialogTitle>
          <DialogDescription
            className={v2 ? "text-[13px] leading-relaxed" : "text-[#737373]"}
          >
            {view === "submit"
              ? "Tell us what's broken, what's clunky, or what you wish this did. It goes straight to the team that builds the software."
              : "Everything you've sent us, and where it got to."}
          </DialogDescription>
        </DialogHeader>

        {/* Closing the loop. Without a way to see that something was actually
            looked at, people submit twice and then stop submitting at all. */}
        {(myFeedback?.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setView(view === "submit" ? "mine" : "submit")}
            className={
              v2
                ? "self-start text-[13px] font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] hover:underline"
                : "self-start text-[13px] font-medium text-[#6366f1] hover:underline"
            }
          >
            {view === "submit"
              ? `Your feedback (${myFeedback!.length})`
              : "← Send new feedback"}
          </button>
        )}

        {view === "mine" ? (
          <div className={v2 ? "space-y-2 py-1" : "space-y-2 py-2"}>
            {myFeedback!.map((f: any) => {
              const meta =
                CATEGORIES.find((c) => c.value === f.category) ?? CATEGORIES[3];
              const Icon = meta.icon;
              return (
                <div
                  key={f.id}
                  className={
                    v2
                      ? "rounded-xl border border-border p-3"
                      : "rounded-md border border-[#f1f5f9] dark:border-border p-3"
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-[12px] font-medium",
                        // v2 reads the row by its label, not by four brand
                        // colours competing with the tenant's own.
                        v2 && "text-muted-foreground"
                      )}
                      style={v2 ? undefined : { color: meta.color }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {meta.label}
                    </span>
                    <span
                      className={cn(
                        "text-[12px] font-medium",
                        f.status === "resolved"
                          ? "text-green-600"
                          : v2
                            ? "text-muted-foreground"
                            : "text-[#d97706]"
                      )}
                    >
                      {f.status === "resolved" ? "Resolved" : "Open"}
                    </span>
                  </div>
                  <p
                    className={
                      v2
                        ? "mt-1.5 text-[13px] text-foreground whitespace-pre-wrap"
                        : "mt-1.5 text-[13px] text-[#404040] dark:text-gray-300 whitespace-pre-wrap"
                    }
                  >
                    {f.message}
                  </p>
                  <p
                    className={
                      v2
                        ? "mt-1.5 text-[12px] text-muted-foreground"
                        : "mt-1.5 text-[12px] text-[#737373]"
                    }
                  >
                    Sent {new Date(f.created_at).toLocaleDateString()}
                    {f.resolved_at
                      ? ` · resolved ${new Date(f.resolved_at).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
        <div className={v2 ? "space-y-3.5 py-1" : "space-y-4 py-2"}>
          <div className={v2 ? "space-y-1.5" : "space-y-2"}>
            <Label
              className={
                v2
                  ? "text-[13px] font-normal text-muted-foreground"
                  : "text-[13px] text-[#404040] dark:text-gray-300"
              }
            >
              What kind of feedback is this?
            </Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const Icon = c.icon;
                const selected = category === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    aria-pressed={selected}
                    className={cn(
                      v2
                        ? "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors"
                        : "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors",
                      selected
                        ? v2
                          ? "border-transparent bg-primary text-primary-foreground"
                          : "border-transparent text-white"
                        : v2
                          ? `border-border bg-card text-muted-foreground ${V2_HOVER}`
                          : "border-[#f1f5f9] dark:border-border bg-[#f8fafc] dark:bg-muted text-[#404040] dark:text-gray-300 hover:border-[#e2e8f0]"
                    )}
                    // v2 takes its selected colour from the tenant's brand
                    // token, so the four category hexes stay a v1 detail.
                    style={selected && !v2 ? { backgroundColor: c.color } : undefined}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={v2 ? "space-y-1.5" : "space-y-2"}>
            <Label
              htmlFor="feedback-message"
              className={
                v2
                  ? "text-[13px] font-normal text-muted-foreground"
                  : "text-[13px] text-[#404040] dark:text-gray-300"
              }
            >
              Your feedback
            </Label>
            <Textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_MAX_MESSAGE))}
              onPaste={handlePaste}
              placeholder={active.placeholder}
              // Shorter on v2 — five rows is still a paragraph, and the dialog
              // is meant to sit inside a phone viewport without scrolling.
              rows={v2 ? 5 : 6}
              autoFocus
              className={v2 ? "resize-none text-[13px]" : "resize-none text-[14px]"}
            />
            <p
              className={
                v2
                  ? "text-[12px] text-muted-foreground text-right"
                  : "text-[12px] text-[#737373] text-right"
              }
            >
              {remaining < 500 ? `${remaining} characters left` : " "}
            </p>
          </div>

          <div className={v2 ? "space-y-1.5" : "space-y-2"}>
            <Label
              className={
                v2
                  ? "text-[13px] font-normal text-muted-foreground"
                  : "text-[13px] text-[#404040] dark:text-gray-300"
              }
            >
              Screenshot <span className={v2 ? "font-normal opacity-70" : "text-[#737373] font-normal"}>(optional)</span>
            </Label>

            {previewUrl ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Screenshot preview"
                  className={
                    v2
                      ? "max-h-32 rounded-xl border border-border"
                      : "max-h-40 rounded-md border border-[#f1f5f9] dark:border-border"
                  }
                />
                <button
                  type="button"
                  onClick={clearScreenshot}
                  aria-label="Remove screenshot"
                  className={
                    v2
                      ? "absolute -right-2 -top-2 rounded-full bg-foreground p-1 text-background hover:bg-foreground/80"
                      : "absolute -right-2 -top-2 rounded-full bg-[#080812] p-1 text-white hover:bg-[#404040]"
                  }
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  attachFile(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  v2
                    ? "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-4 text-center transition-colors"
                    : "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-center transition-colors",
                  isDragging
                    ? v2
                      ? "border-primary bg-primary/10"
                      : "border-[#6366f1] bg-[#eef2ff] dark:bg-indigo-950/30"
                    : v2
                      ? `border-border bg-muted/30 hover:border-primary/50 ${V2_HOVER}`
                      : "border-[#e2e8f0] dark:border-border bg-[#f8fafc] dark:bg-muted/40 hover:border-[#6366f1]"
                )}
              >
                <ImagePlus
                  className={
                    v2 ? "h-4 w-4 text-muted-foreground" : "h-5 w-5 text-[#737373]"
                  }
                />
                <p
                  className={
                    v2
                      ? "text-[13px] text-foreground"
                      : "text-[13px] text-[#404040] dark:text-gray-300"
                  }
                >
                  Drop an image, paste, or click to browse
                </p>
                <p
                  className={
                    v2 ? "text-[12px] text-muted-foreground" : "text-[12px] text-[#737373]"
                  }
                >
                  JPG, PNG or WebP · up to 5MB
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept={FEEDBACK_ACCEPTED_MIME.join(",")}
              className="hidden"
              onChange={(e) => attachFile(e.target.files?.[0])}
            />
            <p
              className={
                v2 ? "text-[12px] text-muted-foreground" : "text-[12px] text-[#737373]"
              }
            >
              Screenshots are visible to the Drive247 team — please avoid capturing
              customer personal details you don't need to show us.
            </p>
          </div>
        </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={close}
            disabled={submitFeedback.isPending}
            className="text-[13px]"
          >
            {view === "mine" ? "Close" : "Cancel"}
          </Button>
          {view === "submit" && (
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              // v2 keeps the Button's own primary token, which is the tenant's
              // brand colour; v1 keeps its hardcoded indigo pair.
              className={
                v2
                  ? "text-[13px]"
                  : "bg-[#6366f1] text-[13px] text-white hover:bg-[#4f46e5]"
              }
            >
              {submitFeedback.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send feedback"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
