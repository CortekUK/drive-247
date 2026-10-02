"use client";

/**
 * Notifications — a tab of the right rail: the notification centre, for THIS
 * rental only.
 *
 * Same rows the top bar's centre reads (`notifications`, through the same
 * `applyScope`: this tenant, this operator or a broadcast, never a chat
 * message), narrowed to the ones that belong to the rental. A rental
 * notification names its rental in one of two places, and the data was
 * measured before trusting either (prod, last 60 days): `metadata.rental_id`
 * on booking, payment, signing, start/complete, refund, deposit-hold and fine
 * rows, and the `link` (`/rentals/<id>`) on those plus the legacy `booking`
 * rows that carry no metadata. Both are matched. Types that carry neither
 * (reminder_critical, rental_extended, identity_verified) cannot be tied to a
 * rental and are honestly absent rather than guessed at.
 *
 * Presentation follows `notification-sheet-v2.tsx` — category chip, a red left
 * edge for critical, the unread dot, duplicates collapsed and counted — at the
 * rail's width. That file is not edited; its row is private to it.
 *
 * The query key sits under the centre's `["notifications", tenant, user]`
 * prefix, so marking a row read here (or there) refreshes both.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, Bell, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { Button } from "@/components/ui-v2/button";
import { collapse, type Notification, type NotificationRow } from "@/hooks/use-notifications";
import { applyScope } from "@/components/notifications/notification-filters";
import {
  BUCKET_LABEL, CATEGORY_LABEL, CATEGORY_TONE, SEVERITY_LABEL, SEVERITY_TONE,
  categoryOf, dayBucket, parseDate, severityOf,
} from "@/components/notifications/taxonomy";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonRows } from "@/lib/skeleton-data";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";
import type { RentalDetailV2 } from "./use-rental-detail-v2";
import { useV2 } from "@/lib/v2-context";
import { previewNotifications } from "./rail-preview";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function relativeTime(iso: string | null | undefined): string | null {
  const d = parseDate(iso);
  if (!d) return null;
  try {
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return null;
  }
}

const SKELETON: Notification[] = skeletonRows(4, (f, i) => ({
  id: `skeleton-${i}`,
  user_id: null,
  title: f.text(3, 6),
  message: f.text(6, 14),
  type: "payment_received",
  is_read: true,
  link: null,
  metadata: null,
  created_at: f.date(i),
}));

function Row({ row, onOpen, onMarkRead }: { row: NotificationRow; onOpen: () => void; onMarkRead: () => void }) {
  const n = row.notification;
  const category = categoryOf(n.type);
  const critical = severityOf(n.type) === "critical";
  const unread = !n.is_read;
  const when = relativeTime(n.created_at);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group relative w-full cursor-pointer overflow-hidden rounded-2xl px-3.5 py-3 text-left transition-colors duration-200 hover:bg-card/70",
        critical ? "bg-destructive/[0.04]" : unread ? "bg-card/60" : ""
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={cn("line-clamp-2 text-[12.5px] leading-snug", unread || critical ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
              {n.title || "Notification"}
            </p>
            {unread && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
          </div>
          {n.message && (
            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">{n.message}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex h-[18px] items-center rounded-full px-2 text-[10px] font-medium ${CATEGORY_TONE[category]}`}>
              {CATEGORY_LABEL[category]}
            </span>
            {critical && (
              <span className={`inline-flex h-[18px] items-center gap-1 rounded-full px-2 text-[10px] font-medium ${SEVERITY_TONE.critical}`}>
                <AlertTriangle className="h-2.5 w-2.5" />
                {SEVERITY_LABEL.critical}
              </span>
            )}
            {row.duplicates > 1 && (
              <span title={`Sent ${row.duplicates} times`} className="inline-flex h-[18px] items-center rounded-full bg-muted px-2 text-[10px] font-medium text-muted-foreground">
                ×{row.duplicates}
              </span>
            )}
            {when && <span className="text-[10.5px] text-muted-foreground/70">{when}</span>}
          </div>
        </div>
        {unread && (
          <Button
            variant="ghost"
            size="icon"
            title="Mark as read"
            aria-label="Mark as read"
            className="h-7 w-7 shrink-0 rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={(e) => { e.stopPropagation(); onMarkRead(); }}
          >
            <CheckCheck className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function RailNotifications({ detail }: { detail: RentalDetailV2 }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const tenantId = tenant?.id;
  const userId = appUser?.id;
  const rentalId = detail.rental.id;
  const valid = UUID.test(rentalId ?? "");

  const key = ["notifications", tenantId, userId, "rental", rentalId] as const;
  const query = useQuery({
    queryKey: key,
    enabled: !!tenantId && !!userId && valid,
    refetchInterval: 30_000,
    staleTime: 10_000,
    queryFn: async () => {
      let q = supabase.from("notifications").select("*");
      q = applyScope(q, tenantId!, userId!);
      const { data, error } = await q
        .or(`metadata->>rental_id.eq.${rentalId},link.like.*${rentalId}*`)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message || "Failed to fetch notifications");
      return (data ?? []) as Notification[];
    },
  });

  const loading = useSkeletonLoading(query.isLoading);
  const [onlyCritical, setOnlyCritical] = useState(false);

  /* northwind preview — see rail-preview.ts. Shown only while the rental has
     no real notification; "read" on a preview row is local to this tab. */
  const preview = useV2("chrome");
  const [previewRead, setPreviewRead] = useState<Set<string>>(new Set());
  const source = useMemo<Notification[]>(() => {
    if (loading) return SKELETON;
    const real = query.data ?? [];
    if (!preview || real.length || query.error) return real;
    return previewNotifications(detail).map((n) => (previewRead.has(n.id) ? { ...n, is_read: true } : n));
  }, [loading, query.data, query.error, preview, detail, previewRead]);
  const rows = useMemo(() => collapse(source), [source]);
  const unread = rows.filter((r) => !r.notification.is_read).map((r) => r.notification.id);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications", tenantId, userId] });
    queryClient.invalidateQueries({ queryKey: ["notification-counts", tenantId, userId] });
  };
  const markRead = useMutation({
    mutationFn: async (all: string[]) => {
      const local = all.filter((id) => id.startsWith("preview:"));
      if (local.length) setPreviewRead((s) => new Set([...s, ...local]));
      const ids = all.filter((id) => !id.startsWith("preview:"));
      if (!tenantId || !ids.length) return;
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("tenant_id", tenantId)
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  function open(n: Notification) {
    if (!n.is_read) markRead.mutate([n.id]);
    // Only same-app paths, and not this rental itself — the operator is on it.
    if (n.link && n.link.startsWith("/") && !n.link.startsWith(`/rentals/${rentalId}`)) router.push(n.link);
  }

  /* One filter: everything, or only what is critical. Counted on the rows the
     tab already holds — a rental's notifications are a page, not a table. */
  const criticalCount = rows.filter((r) => severityOf(r.notification.type) === "critical").length;
  const shown = onlyCritical ? rows.filter((r) => severityOf(r.notification.type) === "critical") : rows;
  const grouped: Record<"today" | "yesterday" | "earlier", NotificationRow[]> = { today: [], yesterday: [], earlier: [] };
  for (const r of shown) grouped[dayBucket(r.notification.created_at)].push(r);

  if (!loading && rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
          <Bell className="h-5 w-5" />
        </div>
        <p className="text-[14px] font-semibold tracking-tight">
          {query.error ? "Notifications would not load" : "Nothing for this rental yet"}
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          {query.error
            ? "Something went wrong reading them. Try again in a moment."
            : "Payments, signatures, pickups and returns on this rental will show here as they happen."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between pb-2">
        <div className="flex gap-1">
          {([
            [false, "All", rows.length],
            [true, "Critical", criticalCount],
          ] as const).map(([critical, label, count]) => (
            <button
              key={label}
              type="button"
              onClick={() => setOnlyCritical(critical)}
              className={cn(
                "flex cursor-pointer items-center gap-1 rounded-3xl px-2.5 py-0.5 text-[12px] transition-colors duration-200",
                onlyCritical === critical
                  ? "bg-primary/10 font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
                  : "text-muted-foreground hover:text-primary dark:hover:text-[hsl(var(--v2-link,var(--primary)))]"
              )}
            >
              {label}
              {!loading && <span className="tabular-nums opacity-60">{count}</span>}
            </button>
          ))}
        </div>
        {unread.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 rounded-full px-2.5 text-[12px]"
            disabled={markRead.isPending}
            onClick={() => markRead.mutate(unread)}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar pb-2">
        <AutoSkeleton loading={loading}>
          {!loading && shown.length === 0 && (
            <p className="px-1 pt-2 text-[12px] leading-relaxed text-muted-foreground">
              Nothing critical on this rental.
            </p>
          )}
          {(["today", "yesterday", "earlier"] as const).map((bucket) =>
            grouped[bucket].length ? (
              <section key={bucket} className="mb-3">
                <p className="mb-1 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {BUCKET_LABEL[bucket]}
                </p>
                <div className="space-y-1">
                  {grouped[bucket].map((row) => (
                    <Row
                      key={row.notification.id}
                      row={row}
                      onOpen={() => open(row.notification)}
                      onMarkRead={() => markRead.mutate([row.notification.id])}
                    />
                  ))}
                </div>
              </section>
            ) : null
          )}
        </AutoSkeleton>
      </div>
    </div>
  );
}

export default RailNotifications;
