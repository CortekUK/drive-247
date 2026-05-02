"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/authStore";

export interface AdminTodoComment {
  id: string;
  todo_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author?: { id: string; name: string | null; email: string; avatar_url: string | null } | null;
}

const SELECT = `
  id, todo_id, author_id, body, created_at,
  author:app_users!admin_todo_comments_author_id_fkey ( id, name, email, avatar_url )
`;

export function useAdminTodoComments(todoId: string | null) {
  const { user } = useAuthStore();
  const [comments, setComments] = useState<AdminTodoComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!todoId) {
      setComments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("admin_todo_comments")
      .select(SELECT)
      .eq("todo_id", todoId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("useAdminTodoComments:", error);
      setComments([]);
    } else {
      setComments((data ?? []) as unknown as AdminTodoComment[]);
    }
    setLoading(false);
  }, [todoId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Realtime — refresh when comments for this todo change.
  useEffect(() => {
    if (!todoId) return;
    const ch = supabase
      .channel(`admin-todo-comments:${todoId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "admin_todo_comments",
          filter: `todo_id=eq.${todoId}`,
        },
        () => fetchAll(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [todoId, fetchAll]);

  const postComment = useCallback(
    async (body: string): Promise<boolean> => {
      const trimmed = body.trim();
      if (!todoId || !user?.id || !trimmed) return false;
      setPosting(true);
      const { error } = await supabase.from("admin_todo_comments").insert({
        todo_id: todoId,
        author_id: user.id,
        body: trimmed,
      });
      setPosting(false);
      if (error) {
        console.error("postComment:", error);
        return false;
      }
      await fetchAll();
      return true;
    },
    [todoId, user?.id, fetchAll],
  );

  const deleteComment = useCallback(
    async (id: string): Promise<boolean> => {
      const { error } = await supabase.from("admin_todo_comments").delete().eq("id", id);
      if (error) {
        console.error("deleteComment:", error);
        return false;
      }
      await fetchAll();
      return true;
    },
    [fetchAll],
  );

  return { comments, loading, posting, postComment, deleteComment, refetch: fetchAll };
}
