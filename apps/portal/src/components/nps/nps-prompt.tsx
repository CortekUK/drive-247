"use client";

/**
 * The NPS question — "How likely are you to recommend Drive247?" (0–10).
 *
 * Super admins run the program from admin → Customer management → NPS Program:
 * the schedule (days after the tenant started), which staff roles are asked and
 * which tenants. `get_my_nps_prompt()` applies all of that for the signed-in
 * user and returns the schedule day to ask about, or null. One ask per user per
 * scheduled day; "Not now" counts as that day's answer, so it does not come
 * back until the next scheduled day (at least a week later).
 *
 * Mounted once in the dashboard layout, so v1 and v2 both get it, each in its
 * own components. It is the lowest-priority surface there: it waits for the
 * paywall, onboarding, announcements and any open modal (the same check the
 * feature-announcement dialogs use), then a few seconds more so it never lands
 * on top of a page that is still drawing.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import * as DialogV1 from "@/components/ui/dialog";
import * as DialogV2 from "@/components/ui-v2/dialog";
import { Button as ButtonV1 } from "@/components/ui/button";
import { Button as ButtonV2 } from "@/components/ui-v2/button";
import { Textarea as TextareaV1 } from "@/components/ui/textarea";
import { Textarea as TextareaV2 } from "@/components/ui-v2/textarea";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAnnouncementBlocked } from "@/hooks/use-announcement-blocked";
import { cn } from "@/lib/utils";

const SETTLE_MS = 4000;
const SCORES = Array.from({ length: 11 }, (_, i) => i);

export function NpsPrompt({ v2, suppressed }: { v2: boolean; suppressed: boolean }) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [thanked, setThanked] = useState(false);
  const blocked = useAnnouncementBlocked({ showGate: suppressed, ownDialogOpen: open });

  const { data: prompt } = useQuery({
    queryKey: ["my-nps-prompt", tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<{ schedule_day: number } | null> => {
      const { data, error } = await supabaseUntyped.rpc("get_my_nps_prompt");
      if (error) throw error;
      return data && typeof data.schedule_day === "number" ? data : null;
    },
  });

  // Open once something is due and nothing else owns the screen — after a pause,
  // re-checked at the end of it.
  useEffect(() => {
    if (!prompt || open || thanked || blocked.feature) return;
    const timer = window.setTimeout(() => setOpen(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [prompt, open, thanked, blocked.feature]);

  const submit = useMutation({
    mutationFn: async (dismissed: boolean) => {
      const { data, error } = await supabaseUntyped.rpc("submit_nps_response", {
        p_schedule_day: prompt!.schedule_day,
        p_score: dismissed ? null : score,
        p_comment: dismissed ? null : comment,
        p_dismissed: dismissed,
        p_portal: v2 ? "v2" : "v1",
      });
      if (error) throw error;
      return { dismissed, ok: data?.ok !== false };
    },
    onSuccess: ({ dismissed }) => {
      if (dismissed) setOpen(false);
      else setThanked(true);
      queryClient.setQueryData(["my-nps-prompt", tenant?.id], null);
    },
    onError: (e: Error) => toast.error("We couldn't save that", { description: e.message }),
  });

  if (!prompt && !thanked) return null;

  const D = v2 ? DialogV2 : DialogV1;
  const Button = v2 ? ButtonV2 : ButtonV1;
  const Textarea = v2 ? TextareaV2 : TextareaV1;

  const onOpenChange = (next: boolean) => {
    if (next) return;
    // Closing without an answer is "Not now"; after the thank-you it just closes.
    if (thanked) setOpen(false);
    else if (!submit.isPending) submit.mutate(true);
  };

  return (
    <D.Dialog open={open} onOpenChange={onOpenChange}>
      <D.DialogContent className="sm:max-w-xl">
        {thanked ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
            <D.DialogTitle className="text-xl">Thank you!</D.DialogTitle>
            <D.DialogDescription>Your feedback helps us make Drive247 better for you.</D.DialogDescription>
            <Button className="mt-2" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <D.DialogHeader className="text-left">
              <D.DialogTitle className="text-xl">How likely are you to recommend Drive247?</D.DialogTitle>
              <D.DialogDescription>To a friend or another rental business. 0 is not at all likely, 10 is extremely likely.</D.DialogDescription>
            </D.DialogHeader>

            <div className="space-y-2">
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11" role="radiogroup" aria-label="Score from 0 to 10">
                {SCORES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={score === n}
                    onClick={() => setScore(n)}
                    className={cn(
                      "h-10 rounded-md border text-sm font-medium tabular-nums transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      score === n
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-muted",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Not at all likely</span>
                <span>Extremely likely</span>
              </div>
            </div>

            {score !== null && (
              <div className="space-y-1.5">
                <label htmlFor="nps-comment" className="text-sm font-medium">
                  {score >= 9 ? "What do you like most?" : score >= 7 ? "What would make it a 10?" : "What should we do better?"}{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Textarea
                  id="nps-comment"
                  rows={3}
                  maxLength={2000}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => submit.mutate(true)}
                disabled={submit.isPending}
                className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Not now
              </button>
              <Button onClick={() => submit.mutate(false)} disabled={score === null || submit.isPending}>
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit"}
              </Button>
            </div>
          </>
        )}
      </D.DialogContent>
    </D.Dialog>
  );
}
