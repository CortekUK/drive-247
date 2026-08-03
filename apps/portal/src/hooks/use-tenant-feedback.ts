import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { useToast } from "@/hooks/use-toast";
import type { FeedbackCategory } from "@/stores/feedback-store";

export const FEEDBACK_SCREENSHOT_BUCKET = "feedback-screenshots";
export const FEEDBACK_MAX_MESSAGE = 5000;
export const FEEDBACK_MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const FEEDBACK_ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"];

export interface SubmitFeedbackPayload {
  category: FeedbackCategory;
  message: string;
  screenshot?: File | null;
  pagePath?: string | null;
  source?: string | null;
}

/**
 * Stamp `feedback_last_prompted_at`. Shared by the submit flow and by both
 * automatic triggers, which stamp at DISPLAY time — a dismissed prompt has to
 * reset the cooldown too, otherwise the dialog reappears on every single
 * rental close until the user gives in.
 *
 * Best-effort by design: this is throttle bookkeeping, and a failure here must
 * never surface as an error over a feedback dialog the user already dealt with.
 */
export const useMarkFeedbackPrompted = () => {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  return useCallback(async () => {
    if (!appUser?.id) return;
    const now = new Date().toISOString();
    try {
      await (supabase as any)
        .from("app_users")
        .update({ feedback_last_prompted_at: now })
        .eq("id", appUser.id);
      // The trigger conditions read this value; without an invalidation the
      // cached row stays stale and the dialog re-fires on the next navigation.
      queryClient.invalidateQueries({ queryKey: ["feedback-prompt-state"] });
    } catch (err) {
      console.error("Failed to stamp feedback_last_prompted_at:", err);
    }
  }, [appUser?.id, queryClient]);
};

/**
 * `feedback_last_prompted_at` for the logged-in user.
 *
 * Read through React Query rather than off `useAuth().appUser`, because the
 * auth store snapshots the row at sign-in and never refreshes it — the value
 * would stay stale for the whole session and both throttles would misfire.
 */
export const useFeedbackPromptState = () => {
  const { appUser } = useAuth();

  return useQuery({
    queryKey: ["feedback-prompt-state", appUser?.id],
    queryFn: async (): Promise<{ lastPromptedAt: string | null }> => {
      const { data, error } = await (supabase as any)
        .from("app_users")
        .select("feedback_last_prompted_at")
        .eq("id", appUser!.id)
        .maybeSingle();

      if (error) throw error;
      return { lastPromptedAt: data?.feedback_last_prompted_at ?? null };
    },
    enabled: !!appUser?.id,
    staleTime: 60 * 1000,
    retry: 1,
  });
};

export const useSubmitFeedback = () => {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const markPrompted = useMarkFeedbackPrompted();

  return useMutation({
    mutationFn: async (payload: SubmitFeedbackPayload) => {
      if (!tenant?.id) throw new Error("No tenant context — please reload the page.");
      if (!appUser?.id) throw new Error("You are not signed in.");

      const message = payload.message.trim();
      if (!message) throw new Error("Please describe your feedback.");
      if (message.length > FEEDBACK_MAX_MESSAGE) {
        throw new Error(`Please keep it under ${FEEDBACK_MAX_MESSAGE} characters.`);
      }

      // Screenshot first, so the row is only ever written once we know the
      // upload succeeded. A failed upload must NOT lose the typed message, so
      // it degrades to a plain text submission rather than throwing.
      let screenshotPath: string | null = null;
      if (payload.screenshot) {
        const file = payload.screenshot;
        if (file.size > FEEDBACK_MAX_SCREENSHOT_BYTES) {
          throw new Error("Screenshot must be under 5MB.");
        }
        if (!FEEDBACK_ACCEPTED_MIME.includes(file.type)) {
          throw new Error("Screenshot must be a JPG, PNG or WebP image.");
        }

        const ext = file.name.split(".").pop()?.toLowerCase() || "png";
        const path = `${tenant.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(FEEDBACK_SCREENSHOT_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });

        if (uploadError) {
          console.error("Feedback screenshot upload failed:", uploadError);
          toast({
            title: "Screenshot could not be attached",
            description: "Sending your feedback without it.",
          });
        } else {
          screenshotPath = path;
        }
      }

      const { data, error } = await (supabase as any)
        .from("tenant_feedback")
        .insert({
          tenant_id: tenant.id,
          app_user_id: appUser.id,
          submitter_name: appUser.name ?? null,
          submitter_email: appUser.email ?? null,
          submitter_role: appUser.role ?? null,
          category: payload.category,
          message,
          screenshot_path: screenshotPath,
          page_path: payload.pagePath ?? null,
          user_agent:
            typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
        })
        .select("id")
        .single();

      if (error) throw error;

      // Fire-and-forget: the user must never wait on an email round-trip, and
      // an alerting failure must never read to them as a failed submission.
      //
      // `functions.invoke` RESOLVES on a non-2xx rather than rejecting, so a
      // bare `.catch()` — the pattern used next to the rental review — silently
      // swallows every 403/500. Inspect the returned `error` as well.
      supabase.functions
        .invoke("notify-feedback-submission", { body: { feedbackId: data.id } })
        .then(({ error: fnError }) => {
          if (fnError) console.error("Feedback notification failed:", fnError);
        })
        .catch((err) => console.error("Failed to send feedback notification:", err));

      // Submitting counts as "seen" for both throttles.
      await markPrompted();

      return data;
    },
    onSuccess: () => {
      toast({
        title: "Thanks — we've got it",
        description: "Your feedback is with the Drive247 team.",
      });
      queryClient.invalidateQueries({ queryKey: ["my-feedback"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't send your feedback",
        description: error.message,
        variant: "destructive",
      });
    },
  });
};

/** The signed-in user's own submissions — powers the "your feedback" list. */
export const useMyFeedback = () => {
  const { appUser } = useAuth();

  return useQuery({
    queryKey: ["my-feedback", appUser?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_feedback")
        .select("id, category, message, status, created_at, resolved_at")
        .eq("app_user_id", appUser!.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return data || [];
    },
    enabled: !!appUser?.id,
    staleTime: 60 * 1000,
  });
};
