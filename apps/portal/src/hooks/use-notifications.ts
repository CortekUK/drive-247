import { useCallback, useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";
import {
  applyFilter,
  applyScope,
  applyUnread,
  NOTIFICATION_FILTERS,
  type NotificationFilter,
} from "@/components/notifications/notification-filters";
import { CHAT_TYPE, parseDate } from "@/components/notifications/taxonomy";
import { collapse, type CollapsedRow } from "@/components/notifications/collapse";

export interface Notification {
  id: string;
  user_id: string | null;
  title: string;
  message: string;
  type: string | null;
  is_read: boolean | null;
  link: string | null;
  metadata: Record<string, any> | null;
  created_at: string | null;
}

/** A row, plus how many identical rows it stands for. See `collapse.ts`. */
export type NotificationRow = CollapsedRow<Notification>;
export { collapse } from "@/components/notifications/collapse";

export type NotificationCounts = Record<NotificationFilter, number> & { unread: number };

/**
 * 30, not 50.
 *
 * The old query took 50 and stopped there — no second page — so a tenant with
 * 65 notifications could not reach 15 of them at all, and the biggest tenant on
 * the platform (607) could not reach 557. The page is smaller now BECAUSE there
 * is a next one: the first screenful arrives sooner and the rest is one button
 * away.
 */
export const NOTIFICATION_PAGE_SIZE = 30;

const listKey = (tenantId?: string, userId?: string, filter: NotificationFilter = "all") =>
  ["notifications", tenantId, userId, filter] as const;
const countsKey = (tenantId?: string, userId?: string) =>
  ["notification-counts", tenantId, userId] as const;

/* ────────────────────────────────────────────────────────────────────────────
   Realtime, subscribed ONCE per tenant+user for the whole app.

   The previous version put `queryKey` — an array literal rebuilt on every
   render — in its effect's dependency array. Referential equality fails every
   time, so the channel was torn down and rejoined on EVERY RENDER of every
   component using the hook, and an INSERT arriving inside one of those gaps was
   simply missed. The 30s poll hid it.

   Three components (bell, dock, panel) want the same stream, so the channel is
   a module-level singleton with a listener set and a reference count rather
   than one socket per mount.
   ──────────────────────────────────────────────────────────────────────────── */

type Entry = { channel: RealtimeChannel; listeners: Set<() => void> };
const registry = new Map<string, Entry>();

function useNotificationsRealtime(tenantId?: string, userId?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!tenantId || !userId) return;
    const key = `${tenantId}:${userId}`;

    let entry = registry.get(key);
    if (!entry) {
      const listeners = new Set<() => void>();
      const channel = supabase
        .channel(`notifications:${key}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications" },
          (payload) => {
            /* A DELETE payload carries only the primary key unless the table is
               REPLICA IDENTITY FULL, so `tenant_id` is often absent. Refresh
               when it is absent — a missed refresh is a stale panel, an extra
               one costs a cached query. */
            const row = (payload.new ?? payload.old) as { tenant_id?: string } | undefined;
            if (row?.tenant_id && row.tenant_id !== tenantId) return;
            listeners.forEach((fn) => fn());
          },
        )
        .subscribe();
      entry = { channel, listeners };
      registry.set(key, entry);
    }

    /* Both keys, always: a new row changes the list AND every count above it. */
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", tenantId, userId] });
      queryClient.invalidateQueries({ queryKey: countsKey(tenantId, userId) });
    };
    const current = entry;
    current.listeners.add(invalidate);

    return () => {
      current.listeners.delete(invalidate);
      if (current.listeners.size === 0) {
        supabase.removeChannel(current.channel);
        registry.delete(key);
      }
    };
    /* Every dependency is a primitive or stable. This effect runs once. */
  }, [tenantId, userId, queryClient]);
}

/* ────────────────────────────────────────────────────────────────────────────
   Counts — exact, from the database, never from the loaded page
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * One `count: "exact"` HEAD request per pill, plus unread. Seven small requests
 * that transfer no rows, against filters built by the same two functions the
 * list uses.
 *
 * Why not count what is loaded? Because PostgREST caps a response at 1000 rows
 * and the panel pages 30 at a time, so "what is loaded" answers a different
 * question than "how many are there" — which is the question a pill is asking.
 */
export function useNotificationCounts() {
  const { appUser } = useAuth();
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const userId = appUser?.id;

  useNotificationsRealtime(tenantId, userId);

  return useQuery({
    queryKey: countsKey(tenantId, userId),
    queryFn: async (): Promise<NotificationCounts> => {
      if (!tenantId || !userId) {
        return { all: 0, payments: 0, rentals: 0, customers: 0, system: 0, critical: 0, unread: 0 };
      }

      const countOf = async (filter: NotificationFilter, unreadOnly = false) => {
        let q = supabase.from("notifications").select("id", { count: "exact", head: true });
        q = applyScope(q, tenantId, userId);
        q = applyFilter(q, filter);
        if (unreadOnly) q = applyUnread(q);
        const { count, error } = await q;
        if (error) throw new Error(error.message || "Could not count notifications");
        return count ?? 0;
      };

      const [counts, unread] = await Promise.all([
        Promise.all(NOTIFICATION_FILTERS.map(({ key }) => countOf(key))),
        countOf("all", true),
      ]);

      const out = { unread } as NotificationCounts;
      NOTIFICATION_FILTERS.forEach(({ key }, i) => {
        out[key] = counts[i];
      });
      return out;
    },
    enabled: !!tenantId && !!userId,
    refetchInterval: 30000,
    staleTime: 10000,
    retry: 1,
  });
}

/* ────────────────────────────────────────────────────────────────────────────
   The list
   ──────────────────────────────────────────────────────────────────────────── */

export function useNotifications({
  filter = "all",
  enabled = true,
}: { filter?: NotificationFilter; enabled?: boolean } = {}) {
  const { appUser } = useAuth();
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const tenantId = tenant?.id;
  const userId = appUser?.id;

  useNotificationsRealtime(tenantId, userId);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["notifications", tenantId, userId] });
    queryClient.invalidateQueries({ queryKey: countsKey(tenantId, userId) });
  }, [queryClient, tenantId, userId]);

  const query = useInfiniteQuery({
    queryKey: listKey(tenantId, userId, filter),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!tenantId || !userId) return [] as Notification[];
      let q = supabase.from("notifications").select("*");
      q = applyScope(q, tenantId, userId);
      q = applyFilter(q, filter);
      const { data, error } = await q
        .order("created_at", { ascending: false })
        /* `id` breaks the tie. Without it, rows sharing a timestamp — which
           this table demonstrably has — can come back in a different order on
           each page request, which is how offset pagination duplicates one row
           and skips another. */
        .order("id", { ascending: false })
        .range(pageParam as number, (pageParam as number) + NOTIFICATION_PAGE_SIZE - 1);

      if (error) throw new Error(error.message || "Failed to fetch notifications");
      return (data ?? []) as Notification[];
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < NOTIFICATION_PAGE_SIZE
        ? undefined
        : allPages.reduce((n, p) => n + p.length, 0),
    enabled: enabled && !!tenantId && !!userId,
    refetchInterval: 30000,
    staleTime: 10000,
    retry: 1,
  });

  /* Flatten, collapse duplicates, and keep the descending order explicit rather
     than trusting it — an undated row (the column is nullable) has no place in
     a sort and is pushed to the end instead of landing wherever it happens to
     compare. */
  const rows = useMemo(() => {
    const flat = (query.data?.pages ?? []).flat();
    const sorted = [...flat].sort((a, b) => {
      const at = parseDate(a.created_at)?.getTime();
      const bt = parseDate(b.created_at)?.getTime();
      if (at === undefined && bt === undefined) return 0;
      if (at === undefined) return 1;
      if (bt === undefined) return -1;
      return bt - at;
    });
    return collapse(sorted);
  }, [query.data]);

  const notifications = useMemo(() => rows.map((r) => r.notification), [rows]);

  const markAsRead = useMutation({
    mutationFn: async (notificationId: string) => {
      if (!tenantId) throw new Error("No tenant");
      /* Scoped by tenant as well as id. RLS is currently DISABLED on this table
         (policies exist but are not enforced), so the client-side filter is the
         only thing standing between a stray id and another tenant's row. */
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId)
        .eq("tenant_id", tenantId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const markAllAsRead = useMutation({
    mutationFn: async () => {
      if (!tenantId || !userId) return;
      let q = supabase.from("notifications").update({ is_read: true });
      q = applyScope(q, tenantId, userId);
      /* Only the unread ones, and `applyUnread` catches NULL as well as false —
         `.eq("is_read", false)` used to leave NULL-read rows unread forever,
         i.e. a badge the "mark all as read" button could not clear.

         Deliberately NOT limited to the active filter: the button says all. */
      q = applyUnread(q);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteNotification = useMutation({
    mutationFn: async (notificationId: string) => {
      if (!tenantId) throw new Error("No tenant");
      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("id", notificationId)
        .eq("tenant_id", tenantId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      if (!tenantId || !userId) return;
      let q = supabase.from("notifications").delete();
      q = applyScope(q, tenantId, userId);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    /** Collapsed rows, each carrying its duplicate count. */
    rows,
    /** The same rows without the duplicate counts, for callers that just read. */
    notifications,
    isLoading: query.isLoading,
    /* Exposed so a failed fetch can be SHOWN. The query already threw on error;
       nothing downstream could see it, so the panel rendered "no notifications"
       for a request that never came back — the one message that makes somebody
       stop checking. */
    error: query.error,
    refetch: query.refetch,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
  };
}

/** Exported for the tests, which assert the chat exclusion in one place. */
export const NOTIFICATION_CHAT_TYPE = CHAT_TYPE;
