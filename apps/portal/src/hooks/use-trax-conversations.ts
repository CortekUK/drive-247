"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";
import type { ChatMessage } from "@/types/chat";

/**
 * Past Trax conversations — the read half of a write that already existed.
 *
 * The `chat` edge function has always persisted every exchange
 * (chat/index.ts:587-612) as one row per message:
 *
 *     { tenant_id, user_id, conversation_id, role, content, sources }
 *
 * but nothing in the portal ever read it back, so a refresh emptied the thread
 * on screen while the rows stayed in the database. That is what made a
 * ChatGPT-style conversation list impossible before; it is a read, not a
 * feature that has to be built server-side.
 *
 * ---------------------------------------------------------------------------
 * TWO FILTERS, BOTH LOAD-BEARING
 *
 * `tenant_id` — RLS is OFF on the core tables, so tenant isolation is entirely
 * this query's job. Omitting it would list every tenant's conversations.
 *
 * `user_id` — and it is the **auth.users** id, NOT `app_users.id`. The edge
 * function calls `saveChatMessages(..., user.id, ...)` where `user` comes from
 * `auth.getUser()` (chat/index.ts:237, :529). The same function uses
 * `appUser?.id || user.id` a few lines earlier for the AI's own context
 * (:292), so the two ids sit side by side and picking the wrong one here
 * yields either an empty list or one operator reading a colleague's chats.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GROUPING IS DONE IN JS
 *
 * "One row per conversation, with its first question as a title and its latest
 * timestamp" is a GROUP BY that PostgREST cannot express. The alternatives were
 * a database view or an RPC — both new database objects, which is not something
 * to add to a production schema for a list that is at most a few hundred rows
 * per operator. So a bounded page of recent messages is fetched and folded
 * here. `MESSAGE_SCAN_LIMIT` is the honest cost of that: conversations older
 * than the most recent N messages are not listed. It is stated rather than
 * hidden, and a view is the upgrade path if an operator ever outgrows it.
 */
const MESSAGE_SCAN_LIMIT = 400;

export interface TraxConversationSummary {
  conversationId: string;
  /** The operator's first question, which is what a sidebar row should read. */
  title: string;
  lastActivityAt: string;
  messageCount: number;
}

interface StoredRow {
  conversation_id: string | null;
  role: string | null;
  content: string | null;
  created_at: string | null;
  sources: unknown;
}

export function useTraxConversations() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  /* Both ids are required, so the query stays disabled until both resolve.
     Without `enabled` this would fire with `undefined` and PostgREST would
     match every row — the cross-tenant read this filter exists to prevent. */
  const enabled = Boolean(tenant?.id && user?.id);

  const query = useQuery({
    queryKey: ["trax-conversations", tenant?.id, user?.id],
    enabled,
    queryFn: async (): Promise<TraxConversationSummary[]> => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("conversation_id, role, content, created_at")
        .eq("tenant_id", tenant!.id)
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_SCAN_LIMIT);

      /* supabase-js resolves with {error} rather than throwing, so this has to
         be raised by hand or the caller sees an empty list and reads it as
         "no conversations yet". */
      if (error) throw new Error(error.message);

      const byId = new Map<string, TraxConversationSummary>();
      /* Rows arrive newest-first. The FIRST row seen for a conversation is
         therefore its latest activity; the LAST user row seen is its earliest
         question, which is the title — so the title is overwritten as older
         rows stream past rather than set once. */
      for (const row of (data ?? []) as StoredRow[]) {
        const id = row.conversation_id;
        if (!id) continue;
        const existing = byId.get(id);
        if (!existing) {
          byId.set(id, {
            conversationId: id,
            title: row.role === "user" && row.content ? row.content : "Conversation",
            lastActivityAt: row.created_at ?? "",
            messageCount: 1,
          });
          continue;
        }
        existing.messageCount += 1;
        if (row.role === "user" && row.content) existing.title = row.content;
      }

      return [...byId.values()].sort((a, b) =>
        b.lastActivityAt.localeCompare(a.lastActivityAt),
      );
    },
  });

  /**
   * Read one conversation back in full, oldest-first, shaped as the UI's
   * `ChatMessage`.
   *
   * Deliberately NOT bounded by MESSAGE_SCAN_LIMIT: that limit exists to keep
   * the LIST query cheap, and applying it here would silently truncate the
   * middle of a long thread — worse than not offering it at all.
   */
  const loadMessages = useCallback(
    async (conversationId: string): Promise<ChatMessage[]> => {
      if (!tenant?.id || !user?.id) return [];
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, role, content, created_at, sources")
        .eq("tenant_id", tenant.id)
        .eq("user_id", user.id)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (error) throw new Error(error.message);

      return (data ?? []).map((row: any) => ({
        id: String(row.id ?? crypto.randomUUID()),
        role: row.role === "user" ? "user" : "assistant",
        content: String(row.content ?? ""),
        sources: Array.isArray(row.sources) ? row.sources : undefined,
        timestamp: row.created_at ? new Date(row.created_at) : new Date(),
      })) as ChatMessage[];
    },
    [tenant?.id, user?.id],
  );

  /** Call after a reply lands so a new conversation appears in the list. */
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["trax-conversations", tenant?.id, user?.id] });
  }, [queryClient, tenant?.id, user?.id]);

  return {
    conversations: query.data ?? [],
    isLoading: query.isPending && enabled,
    error: query.error instanceof Error ? query.error.message : null,
    loadMessages,
    refresh,
    scanLimit: MESSAGE_SCAN_LIMIT,
  };
}
