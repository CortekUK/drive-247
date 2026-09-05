'use client';

/**
 * The signed-in customer's in-app notifications.
 *
 * ── THE ISOLATION BOUNDARY IS THIS FILE ─────────────────────────────────────
 * Same posture as `use-customer-rentals.ts`: `customer_notifications` is
 * reachable with nothing but the public anon key on staging (verified against
 * ksmreaadhbirzakkxqrq — the table answers 200 to an unauthenticated request),
 * so the row filters below are the access control, not a convenience.
 *
 * Two ids, always, on EVERY statement in this file — reads and writes alike:
 *
 *   • `customer_user_id` — the FK this table actually carries. It comes from
 *     `useCustomer()`, i.e. from the auth store, and there is deliberately no
 *     parameter to pass one in. An id that can be passed in is an id that can
 *     be swapped.
 *   • the tenant predicate — see `tenantPredicate` below.
 *
 * ── v1 BUG THIS PORT FIXES ──────────────────────────────────────────────────
 * v1's mutations are keyed on the notification id ALONE:
 *
 *     .from('customer_notifications').update({ is_read: true }).eq('id', id)
 *     .from('customer_notifications').delete().eq('id', id)
 *
 * With RLS off that is a straight IDOR — any signed-in customer who can guess
 * or observe a uuid can mark read or DELETE another customer's notification,
 * across tenants. Every mutation here re-states the ownership filters, so the
 * `WHERE` clause can never match a row the caller does not own.
 *
 * The writes also `.select('id')` and assert a row came back. A filtered-out
 * write is not an error in PostgREST — it reports success having changed
 * nothing — so without that check a blocked delete would fade the row from the
 * screen and quietly leave it in the database.
 *
 * ── ONE QUERY ───────────────────────────────────────────────────────────────
 * The unread count is derived from the loaded page rather than counted in a
 * second round trip, so the badge and the rows under it can never disagree.
 * `PAGE_SIZE + 1` rows are requested: the extra one is never rendered, it only
 * tells the page that there is more history than it is showing, which is the
 * one fact a hard `LIMIT` otherwise hides.
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCustomer } from '@/hooks/use-customer';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

/* ────────────────────────────── row shape ──────────────────────────────── */

type NotificationRow = Database['public']['Tables']['customer_notifications']['Row'];

/**
 * The columns a customer may read.
 *
 * A `Pick` rather than a hand-written interface so a column that does not exist
 * fails to compile here instead of 400-ing at runtime — PostgREST rejects the
 * ENTIRE request for one unknown name, so a typo does not blank one field, it
 * empties the whole page.
 */
type CustomerNotificationRow = Pick<
  NotificationRow,
  | 'id'
  | 'title'
  | 'message'
  | 'type'
  | 'link'
  | 'is_read'
  | 'created_at'
  | 'metadata'
  | 'tenant_id'
>;

const NOTIFICATION_COLUMNS = [
  'id',
  'title',
  'message',
  'type',
  'link',
  'is_read',
  'created_at',
  'metadata',
  'tenant_id',
].join(', ');

/** How many rows the page shows. One more than this is fetched — see header. */
export const NOTIFICATIONS_PAGE_SIZE = 50;

/* ──────────────────────── tenant scoping predicate ─────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `tenant_id = <this tenant> OR tenant_id IS NULL`.
 *
 * Not a plain `.eq()`, and the difference is load-bearing: `customer-signup`
 * inserts the welcome notification with `tenant_id: tenant_id || null`, so the
 * very first notification a customer ever receives is frequently UNSTAMPED. A
 * strict equality filter hides it, and a brand-new customer's notifications
 * page renders empty at exactly the moment it has something to say.
 *
 * Admitting the null rows costs nothing, because `customer_user_id` is already
 * a single-tenant key: a `customer_users` row belongs to exactly one tenant, so
 * a row matching this customer's link id cannot belong to another operator no
 * matter what its own `tenant_id` column says. The tenant filter is defence in
 * depth on top of that, which is why it can afford to be the tolerant half.
 *
 * The id is UUID-checked before interpolation. PostgREST's `or=` takes a raw
 * expression string with no bind parameters, so an id carrying a comma or a
 * paren would rewrite the predicate rather than fail it.
 */
function tenantPredicate(tenantId: string): string {
  if (!UUID_RE.test(tenantId)) {
    throw new Error('Refusing to query notifications with a malformed tenant id');
  }
  return `tenant_id.eq.${tenantId},tenant_id.is.null`;
}

/* ─────────────────────────────── view model ────────────────────────────── */

/**
 * The eight things a notification can be about, from ~15 spellings of `type`
 * accumulated across two eras of writers ('agreement', 'success', 'alert',
 * 'welcome', 'insurance_reupload', 'booking_confirmed', 'rental_started', …).
 * The customer should not have to learn the operator's vocabulary.
 */
export type NotificationKind =
  | 'booking'
  | 'agreement'
  | 'payment'
  | 'verification'
  | 'welcome'
  | 'alert'
  | 'success'
  | 'info';

const KIND_BY_TYPE: Record<string, NotificationKind> = {
  booking_confirmed: 'booking',
  booking_cancelled: 'booking',
  booking: 'booking',
  rental_started: 'booking',
  rental_ended: 'booking',
  extension: 'booking',

  agreement: 'agreement',
  document: 'agreement',

  payment: 'payment',
  payment_due: 'payment',
  refund: 'payment',
  invoice: 'payment',

  verification: 'verification',
  insurance_reupload: 'verification',
  identity: 'verification',

  welcome: 'welcome',

  alert: 'alert',
  error: 'alert',
  warning: 'alert',

  success: 'success',
};

function notificationKind(type: string | null): NotificationKind {
  const key = (type ?? '').trim().toLowerCase();
  return KIND_BY_TYPE[key] ?? 'info';
}

export interface CustomerNotification {
  id: string;
  title: string;
  message: string;
  /** Raw DB value, kept for debugging. Never rendered. */
  typeRaw: string | null;
  kind: NotificationKind;
  isRead: boolean;
  /** `timestamptz` — a real instant, so `new Date()` is correct on this one. */
  createdAt: string | null;
  /** A destination inside this app, already validated. Null when there is none. */
  href: string | null;
}

/* ──────────────────────────── link resolution ──────────────────────────── */

/**
 * Where a notification points, if anywhere.
 *
 * v1 stores a `link` on most rows and then never renders it — its notifications
 * page has no link affordance at all — so the column has never been exercised.
 * That is the risk here, not a feature: an unrendered column is an unvalidated
 * one, and it is operator-influenced text.
 *
 * Two rules, in order:
 *
 *   1. `metadata.rental_id` wins. It is an id rather than a route, so it cannot
 *      go stale when routes move, and it lands the customer on the specific
 *      booking the notification is about instead of on a list.
 *   2. `link` is accepted only if it is same-origin AND names a route that
 *      actually exists here. Anything else resolves to null and the row renders
 *      without an action — a dead link is worse than no link.
 *
 * The same-origin test is `starts with exactly one /`, which rejects
 * `//evil.example` (protocol-relative), `https://…` and `javascript:` outright.
 * v1 is accidentally safe from this only because it never renders the value; a
 * port that started rendering it without the check would be shipping a stored
 * open redirect. Verified live: a seeded row carrying
 * `https://evil.example.com/phish` renders no link at all.
 *
 * NOTE: there is deliberately no v1→v2 rename table. v2's portal route set is
 * identical to v1's, and the only two values any writer has ever stored are
 * `/portal/agreements` and `/portal/bookings` — both of which exist here. An
 * earlier draft of this file mapped `/portal/agreements` to `/portal/documents`
 * on the assumption that the agreements page had not been ported; it since has,
 * and the "helpful" rewrite would have quietly sent every agreement
 * notification to the wrong page. Route names are checked, not rewritten.
 */

/** Routes that exist in v2. A link outside this set is dropped. */
const KNOWN_ROUTES = new Set([
  '/portal',
  '/portal/agreements',
  '/portal/bookings',
  '/portal/bookings/history',
  '/portal/documents',
  '/portal/gig-driver',
  '/portal/messages',
  '/portal/notifications',
  '/portal/payments',
  '/portal/settings',
  '/portal/verification',
  '/booking',
  '/fleet',
  '/contact',
]);

/** `/portal/bookings/<uuid>` — the one dynamic route a link may legitimately name. */
const BOOKING_DETAIL_RE =
  /^\/portal\/bookings\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rentalIdFromMetadata(metadata: NotificationRow['metadata']): string | null {
  if (!isRecord(metadata)) return null;
  const candidate = metadata.rental_id;
  return typeof candidate === 'string' && UUID_RE.test(candidate) ? candidate : null;
}

function resolveHref(row: CustomerNotificationRow): string | null {
  const rentalId = rentalIdFromMetadata(row.metadata);
  if (rentalId) return `/portal/bookings/${rentalId}`;

  const raw = row.link?.trim();
  // Single leading slash only. `//host` is protocol-relative and leaves the app.
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;

  // Compare on the path alone, so a stored `?tab=x` or `#anchor` cannot smuggle
  // an unknown route past the allowlist. The query and hash are then DROPPED
  // rather than carried through — nothing writes them, and passing unchecked
  // text into the URL is the whole class of bug this function exists to close.
  const path = raw.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (KNOWN_ROUTES.has(path)) return path;
  return BOOKING_DETAIL_RE.test(path) ? path : null;
}

function normalizeNotification(row: CustomerNotificationRow): CustomerNotification {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    typeRaw: row.type,
    kind: notificationKind(row.type),
    // `is_read` is nullable and legacy rows carry null. Null is UNREAD: showing
    // an unread item as read loses it, the reverse is merely noisy.
    isRead: row.is_read === true,
    createdAt: row.created_at,
    href: resolveHref(row),
  };
}

/* ─────────────────────────────── the hook ──────────────────────────────── */

export interface UseCustomerNotificationsResult {
  notifications: CustomerNotification[];
  unreadCount: number;
  /** True when the customer has more history than the page is showing. */
  hasMore: boolean;

  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;

  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;

  isMarkingAll: boolean;
  isClearingAll: boolean;
  /** The id currently being marked read or removed, so one row can show it. */
  pendingId: string | null;
  /** A failed mutation, for the page to surface. Cleared by the next success. */
  mutationError: Error | null;
}

export function useCustomerNotifications(): UseCustomerNotificationsResult {
  const queryClient = useQueryClient();
  const { tenant, isLoading: tenantLoading } = useTenant();
  const { customerUserId, isLoading: authLoading } = useCustomer();

  const tenantId = tenant?.id ?? null;
  const enabled = !!customerUserId && !!tenantId;

  // Both ids are in the key. The customer's in particular: without it, one
  // customer signing out and another signing in on the same browser would be
  // served the first one's cached notifications until the stale time elapsed.
  const queryKey = useMemo(
    () => ['customer-notifications', tenantId, customerUserId] as const,
    [tenantId, customerUserId],
  );

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<CustomerNotification[]> => {
      if (!customerUserId || !tenantId) return [];

      const { data, error } = await supabase
        .from('customer_notifications')
        .select(NOTIFICATION_COLUMNS)
        // Read the file header before touching either filter.
        .eq('customer_user_id', customerUserId)
        .or(tenantPredicate(tenantId))
        // Nulls last so a legacy row with no timestamp cannot squat the top slot.
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(NOTIFICATIONS_PAGE_SIZE + 1)
        .overrideTypes<CustomerNotificationRow[], { merge: false }>();

      if (error) {
        console.error('[useCustomerNotifications] Failed to load notifications', {
          tenantId,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load your notifications');
      }

      return (data ?? []).map(normalizeNotification);
    },
    enabled,
    // Notifications are the one surface whose whole job is to be current, so
    // this overrides the app-wide `staleTime: 60_000` / `refetchOnWindowFocus:
    // false`. A customer who pays in a Stripe tab and comes back must not be
    // looking at the notification list from before they left.
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const fetched = useMemo(() => query.data ?? [], [query.data]);
  const hasMore = fetched.length > NOTIFICATIONS_PAGE_SIZE;
  const notifications = useMemo(
    () => (hasMore ? fetched.slice(0, NOTIFICATIONS_PAGE_SIZE) : fetched),
    [fetched, hasMore],
  );
  const unreadCount = useMemo(
    () => notifications.reduce((total, item) => (item.isRead ? total : total + 1), 0),
    [notifications],
  );

  /* ───────────────────────────── mutations ─────────────────────────────── */

  /**
   * Every mutation optimistically rewrites the cache and rolls back on failure.
   * `cancelQueries` first, or the 30s poll can land mid-flight and reinstate the
   * row the customer just dismissed.
   */
  const optimistic = useCallback(
    async (update: (rows: CustomerNotification[]) => CustomerNotification[]) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CustomerNotification[]>(queryKey);
      queryClient.setQueryData<CustomerNotification[]>(queryKey, (rows) =>
        update(rows ?? []),
      );
      return previous;
    },
    [queryClient, queryKey],
  );

  const rollback = useCallback(
    (previous: CustomerNotification[] | undefined) => {
      if (previous !== undefined) queryClient.setQueryData(queryKey, previous);
    },
    [queryClient, queryKey],
  );

  const settle = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  /** Ownership filters, restated on every write. See the file header. */
  function requireIds(): { customerUserId: string; tenantId: string } {
    if (!customerUserId || !tenantId) {
      throw new Error('You are not signed in.');
    }
    return { customerUserId, tenantId };
  }

  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const ids = requireIds();
      const { data, error } = await supabase
        .from('customer_notifications')
        .update({ is_read: true })
        .eq('id', id)
        .eq('customer_user_id', ids.customerUserId)
        .or(tenantPredicate(ids.tenantId))
        .select('id');

      if (error) throw new Error(error.message || 'Could not mark that as read');
      // PostgREST reports success for a write that matched nothing. Without
      // this the row would fade to "read" on screen and stay unread in the DB.
      if (!data || data.length === 0) {
        throw new Error('That notification could not be updated.');
      }
    },
    onMutate: (id: string) =>
      optimistic((rows) =>
        rows.map((row) => (row.id === id ? { ...row, isRead: true } : row)),
      ),
    onError: (_error, _id, previous) => rollback(previous),
    onSettled: settle,
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const ids = requireIds();
      const { error } = await supabase
        .from('customer_notifications')
        .update({ is_read: true })
        .eq('customer_user_id', ids.customerUserId)
        .or(tenantPredicate(ids.tenantId))
        // `not is true`, NOT `eq false`: `is_read` is nullable and legacy rows
        // carry null, which `.eq('is_read', false)` silently skips — leaving
        // exactly the rows the button just claimed to clear.
        .not('is_read', 'is', true)
        .select('id');

      // No row assertion here: "mark all as read" over an already-read list is
      // a legitimate no-op, and failing it would be wrong.
      if (error) throw new Error(error.message || 'Could not mark those as read');
    },
    onMutate: () => optimistic((rows) => rows.map((row) => ({ ...row, isRead: true }))),
    onError: (_error, _vars, previous) => rollback(previous),
    onSettled: settle,
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const ids = requireIds();
      const { data, error } = await supabase
        .from('customer_notifications')
        .delete()
        .eq('id', id)
        .eq('customer_user_id', ids.customerUserId)
        .or(tenantPredicate(ids.tenantId))
        .select('id');

      if (error) throw new Error(error.message || 'Could not remove that notification');
      if (!data || data.length === 0) {
        throw new Error('That notification could not be removed.');
      }
    },
    onMutate: (id: string) => optimistic((rows) => rows.filter((row) => row.id !== id)),
    onError: (_error, _id, previous) => rollback(previous),
    onSettled: settle,
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      const ids = requireIds();
      const { error } = await supabase
        .from('customer_notifications')
        .delete()
        .eq('customer_user_id', ids.customerUserId)
        .or(tenantPredicate(ids.tenantId))
        .select('id');

      if (error) throw new Error(error.message || 'Could not clear your notifications');
    },
    onMutate: () => optimistic(() => []),
    onError: (_error, _vars, previous) => rollback(previous),
    onSettled: settle,
  });

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const pendingId =
    (markAsReadMutation.isPending ? (markAsReadMutation.variables ?? null) : null) ??
    (dismissMutation.isPending ? (dismissMutation.variables ?? null) : null);

  const mutationError =
    markAsReadMutation.error ??
    markAllAsReadMutation.error ??
    dismissMutation.error ??
    clearAllMutation.error ??
    null;

  return {
    notifications,
    unreadCount,
    hasMore,

    // The tenant and auth round-trips are part of this hook's load from the
    // caller's point of view: until both land `enabled` is false and React
    // Query reports idle, so reading `isPending` alone flashes an empty state
    // at a customer who has notifications waiting.
    isLoading:
      tenantLoading ||
      authLoading ||
      (enabled && query.isPending && query.fetchStatus !== 'idle'),
    isError: query.isError,
    error: query.error,
    refetch,

    markAsRead: markAsReadMutation.mutate,
    markAllAsRead: markAllAsReadMutation.mutate,
    dismiss: dismissMutation.mutate,
    clearAll: clearAllMutation.mutate,

    isMarkingAll: markAllAsReadMutation.isPending,
    isClearingAll: clearAllMutation.isPending,
    pendingId,
    mutationError,
  };
}
