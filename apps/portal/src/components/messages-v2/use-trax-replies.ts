"use client";

/**
 * Trax's reply suggestions for one conversation, from `trax-reply-suggest`.
 *
 * Asked once per (conversation, latest message, channel) and then cached for
 * good — a new message from either side is a new question, anything else is
 * the same one. While the model is thinking, or if it cannot be reached, the
 * instant keyword suggestions stand in, so the composer is never left blank
 * waiting on a network call.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { suggestReplies, type SuggestInput } from "@/components/messages-v2/trax-reply-suggestions";

export type ReplyStyle = "friendly" | "detailed" | "next_step";

export interface TraxReply {
  /** Absent for the keyword stand-ins. */
  style?: ReplyStyle;
  text: string;
}

export const STYLE_LABEL: Record<ReplyStyle, string> = {
  friendly: "Friendly",
  detailed: "In depth",
  next_step: "Next step",
};

export function useTraxReplies({
  channelId,
  lastMessageId,
  mode,
  enabled,
  fallback,
}: {
  channelId: string;
  lastMessageId: string | number | null;
  mode: "in_app" | "sms";
  enabled: boolean;
  fallback: SuggestInput;
}): { replies: TraxReply[]; fromTrax: boolean } {
  const { tenant } = useTenant();

  const { data } = useQuery({
    queryKey: ["trax-reply-suggest", tenant?.id, channelId, lastMessageId, mode],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("trax-reply-suggest", {
        body: { channelId, mode },
      });
      if (error) throw error;
      return (data?.replies ?? []) as TraxReply[];
    },
    enabled: enabled && !!tenant && !!channelId,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (data && data.length > 0) return { replies: data, fromTrax: true };
  return {
    replies: enabled ? suggestReplies(fallback).map((text) => ({ text })) : [],
    fromTrax: false,
  };
}
