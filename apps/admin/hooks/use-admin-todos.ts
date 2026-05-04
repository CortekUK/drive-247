"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/authStore";

export type TodoStatus = "not_started" | "in_progress" | "done";
export type TodoPriority = "low" | "medium" | "high";

export interface AdminTodo {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  image_path: string | null;
  priority: TodoPriority;
  status: TodoStatus;
  position: number;
  due_date: string | null;
  assignee_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  assignee?: { id: string; name: string | null; email: string; avatar_url: string | null } | null;
  creator?: { id: string; name: string | null; email: string } | null;
  comment_count?: number;
}

export interface CreateTodoInput {
  title: string;
  description?: string | null;
  image_url?: string | null;
  image_path?: string | null;
  priority: TodoPriority;
  status?: TodoStatus;
  due_date?: string | null;
  assignee_id?: string | null;
}

export interface UpdateTodoInput {
  title?: string;
  description?: string | null;
  image_url?: string | null;
  image_path?: string | null;
  priority?: TodoPriority;
  status?: TodoStatus;
  position?: number;
  due_date?: string | null;
  assignee_id?: string | null;
}

const SELECT = `
  id, title, description, image_url, image_path, priority, status, position,
  due_date, assignee_id, created_by, created_at, updated_at,
  assignee:app_users!admin_todos_assignee_id_fkey ( id, name, email, avatar_url ),
  creator:app_users!admin_todos_created_by_fkey ( id, name, email )
`;

/**
 * Per-tenant todo board for super-admin staff.
 * Pass the tenant id from the surrounding tenant detail page; all queries,
 * inserts, and the realtime channel are scoped to that tenant only.
 *
 * Subscribes to realtime postgres_changes and refetches on any change,
 * except while a drag is in flight (caller sets `isDraggingRef`).
 */
export function useAdminTodos(tenantId: string | null) {
  const { user } = useAuthStore();
  const [todos, setTodos] = useState<AdminTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isDraggingRef = useRef(false);

  const fetchAll = useCallback(async () => {
    if (!tenantId) {
      setTodos([]);
      setLoading(false);
      return;
    }
    setError(null);
    const [{ data: rows, error: e1 }, { data: counts }] = await Promise.all([
      supabase
        .from("admin_todos")
        .select(SELECT)
        .eq("tenant_id", tenantId)
        .order("status", { ascending: true })
        .order("position", { ascending: true })
        .limit(500),
      // Comments are joined to a tenant via the parent todo; restrict via inner-join.
      supabase
        .from("admin_todo_comments")
        .select("todo_id, admin_todos!inner(tenant_id)")
        .eq("admin_todos.tenant_id", tenantId),
    ]);
    if (e1) {
      setError(e1.message);
      setLoading(false);
      return;
    }
    const countMap = new Map<string, number>();
    for (const r of (counts ?? []) as { todo_id: string }[]) {
      countMap.set(r.todo_id, (countMap.get(r.todo_id) ?? 0) + 1);
    }
    const list = (rows ?? []).map((r) => ({
      ...(r as unknown as AdminTodo),
      comment_count: countMap.get((r as { id: string }).id) ?? 0,
    }));
    setTodos(list);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    setLoading(true);
    fetchAll();
  }, [fetchAll]);

  // Realtime — filter by tenant so other tenants' boards don't trigger refetches.
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`admin-todos:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "admin_todos",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          if (!isDraggingRef.current) fetchAll();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_todo_comments" },
        () => {
          // Comment events don't carry tenant_id; refetch is cheap and scoped.
          if (!isDraggingRef.current) fetchAll();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, fetchAll]);

  const createTodo = useCallback(
    async (input: CreateTodoInput): Promise<AdminTodo | null> => {
      if (!user?.id) {
        setError("Not authenticated");
        return null;
      }
      if (!tenantId) {
        setError("Tenant context missing");
        return null;
      }
      const status: TodoStatus = input.status ?? "not_started";
      const lastPos = todos
        .filter((t) => t.status === status)
        .reduce((max, t) => Math.max(max, t.position), 0);
      const { data, error: e } = await supabase
        .from("admin_todos")
        .insert({
          tenant_id: tenantId,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          image_url: input.image_url ?? null,
          image_path: input.image_path ?? null,
          priority: input.priority,
          status,
          position: lastPos + 1024,
          due_date: input.due_date ?? null,
          assignee_id: input.assignee_id ?? null,
          created_by: user.id,
        })
        .select(SELECT)
        .single();
      if (e || !data) {
        setError(e?.message ?? "Insert failed");
        return null;
      }
      await fetchAll();
      return data as unknown as AdminTodo;
    },
    [user?.id, tenantId, todos, fetchAll],
  );

  const updateTodo = useCallback(
    async (id: string, patch: UpdateTodoInput): Promise<boolean> => {
      const { error: e } = await supabase
        .from("admin_todos")
        .update(patch)
        .eq("id", id);
      if (e) {
        setError(e.message);
        return false;
      }
      return true;
    },
    [],
  );

  // Permanently remove a card; also strips its image from storage. Comments cascade.
  const deleteTodo = useCallback(
    async (id: string): Promise<boolean> => {
      const target = todos.find((t) => t.id === id);
      const { error: e } = await supabase.from("admin_todos").delete().eq("id", id);
      if (e) {
        setError(e.message);
        return false;
      }
      if (target?.image_path) {
        const { error: storageErr } = await supabase.storage
          .from("todo-images")
          .remove([target.image_path]);
        if (storageErr) {
          // Non-fatal — row is gone, orphan storage object can be cleaned up later.
          console.warn("Failed to remove todo image:", storageErr.message);
        }
      }
      await fetchAll();
      return true;
    },
    [todos, fetchAll],
  );

  // Optimistically reorder/move cards in local state. The caller must persist
  // the new positions via `updateTodo` and then call `refetch` (or rely on
  // realtime). Returns the previous todos so a failure can roll back.
  const applyOptimistic = useCallback(
    (updater: (prev: AdminTodo[]) => AdminTodo[]) => {
      setTodos((prev) => {
        const next = updater(prev);
        return next;
      });
    },
    [],
  );

  return {
    todos,
    loading,
    error,
    refetch: fetchAll,
    createTodo,
    updateTodo,
    deleteTodo,
    applyOptimistic,
    isDraggingRef,
    setTodos,
  };
}
