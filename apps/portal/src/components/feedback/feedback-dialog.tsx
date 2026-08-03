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
  FEEDBACK_MAX_MESSAGE,
  FEEDBACK_MAX_SCREENSHOT_BYTES,
  FEEDBACK_ACCEPTED_MIME,
} from "@/hooks/use-tenant-feedback";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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
 * The single feedback dialog. Mounted once in the dashboard layout; every entry
 * point (sidebar button, rental-completion follow-up, forced-login prompt)
 * drives it through `useFeedbackStore`.
 */
export function FeedbackDialog() {
  const { isOpen, prefillCategory, source, close } = useFeedbackStore();
  const pathname = usePathname();
  const { toast } = useToast();
  const submitFeedback = useSubmitFeedback();
  const markPrompted = useMarkFeedbackPrompted();

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
    if (isOpen) setCategory(prefillCategory ?? "bug");
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
        pagePath: source ? `${pathname} (${source})` : pathname,
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
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#080812] dark:text-white">
            Send feedback to Drive247
          </DialogTitle>
          <DialogDescription className="text-[#737373]">
            Tell us what's broken, what's clunky, or what you wish this did. It goes
            straight to the team that builds the software.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-[13px] text-[#404040] dark:text-gray-300">
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
                      "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors",
                      selected
                        ? "border-transparent text-white"
                        : "border-[#f1f5f9] dark:border-border bg-[#f8fafc] dark:bg-muted text-[#404040] dark:text-gray-300 hover:border-[#e2e8f0]"
                    )}
                    style={selected ? { backgroundColor: c.color } : undefined}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-message" className="text-[13px] text-[#404040] dark:text-gray-300">
              Your feedback
            </Label>
            <Textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_MAX_MESSAGE))}
              onPaste={handlePaste}
              placeholder={active.placeholder}
              rows={6}
              autoFocus
              className="resize-none text-[14px]"
            />
            <p className="text-[12px] text-[#737373] text-right">
              {remaining < 500 ? `${remaining} characters left` : " "}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-[13px] text-[#404040] dark:text-gray-300">
              Screenshot <span className="text-[#737373] font-normal">(optional)</span>
            </Label>

            {previewUrl ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Screenshot preview"
                  className="max-h-40 rounded-md border border-[#f1f5f9] dark:border-border"
                />
                <button
                  type="button"
                  onClick={clearScreenshot}
                  aria-label="Remove screenshot"
                  className="absolute -right-2 -top-2 rounded-full bg-[#080812] p-1 text-white hover:bg-[#404040]"
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
                  "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-center transition-colors",
                  isDragging
                    ? "border-[#6366f1] bg-[#eef2ff] dark:bg-indigo-950/30"
                    : "border-[#e2e8f0] dark:border-border bg-[#f8fafc] dark:bg-muted/40 hover:border-[#6366f1]"
                )}
              >
                <ImagePlus className="h-5 w-5 text-[#737373]" />
                <p className="text-[13px] text-[#404040] dark:text-gray-300">
                  Drop an image, paste, or click to browse
                </p>
                <p className="text-[12px] text-[#737373]">JPG, PNG or WebP · up to 5MB</p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept={FEEDBACK_ACCEPTED_MIME.join(",")}
              className="hidden"
              onChange={(e) => attachFile(e.target.files?.[0])}
            />
            <p className="text-[12px] text-[#737373]">
              Screenshots are visible to the Drive247 team — please avoid capturing
              customer personal details you don't need to show us.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={close}
            disabled={submitFeedback.isPending}
            className="text-[13px]"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-[#6366f1] text-[13px] text-white hover:bg-[#4f46e5]"
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
