'use client';

/**
 * The top bar's two sheets, as on the operator portal v2: the bell opens the
 * notification centre and the chat icon opens the messages sheet, both sliding
 * in from the right over the page (the operator's
 * components/notifications-v2/notification-sheet-v2.tsx and
 * components/messages-v2/messages-sheet-v2.tsx, on the `--pv-*` tokens).
 *
 * Same shell for both: a fixed header (title, a count pill, icon actions beside
 * the close), then ONE scroll region with no bar, grouped under sticky Today /
 * Yesterday / Earlier headings.
 *
 * Notifications replace the Notifications page in the rail: the sheet is where
 * a customer reads them now. Messages keep their page; the sheet is the quick
 * look, and its row (and the ↗) open the conversation.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CheckCheck,
  Inbox,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react-nw';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@nw/components/ui/sheet';
import { supabase } from '@nw/integrations/supabase/client';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import {
  useCustomerNotifications,
  type CustomerNotification,
  type NotificationKind,
} from '@nw/hooks/use-customer-notifications';
import { cn } from '@nw/lib/utils';

/* ─────────────────────────────── shared bits ───────────────────────────── */

/** The operator sheets' shell: full height, 420px wide, one scroll region. */
/** Full screen on a phone, so it starts under the status bar and ends above the home indicator. */
const SHEET_SHELL =
  'flex w-full flex-col gap-0 overflow-hidden border-l border-pv-border bg-pv-card p-0 sm:max-w-[420px] ' +
  'max-sm:border-l-0 max-sm:pt-[env(safe-area-inset-top,0px)] max-sm:pb-[env(safe-area-inset-bottom,0px)]';

/** No visible bar on the scroll region (the operator's NO_SCROLLBAR). */
const NO_SCROLLBAR = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

const HEADER_ICON =
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-pv-muted-fg transition-colors duration-200 ' +
  'hover:bg-pv-hover hover:text-pv-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50 ' +
  'disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none';

const COUNT_PILL = 'ml-2 inline-flex h-5 items-center rounded-full bg-pv-primary/10 px-2 text-[11px] font-semibold text-pv-primary';

const DAY_HEADING =
  'sticky top-0 z-10 bg-pv-card/95 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-pv-muted-fg backdrop-blur';

type Bucket = 'today' | 'yesterday' | 'earlier';
const BUCKETS: Bucket[] = ['today', 'yesterday', 'earlier'];
const BUCKET_LABEL: Record<Bucket, string> = { today: 'Today', yesterday: 'Yesterday', earlier: 'Earlier' };

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendar days, not 24-hour windows: "Yesterday" is the date before today. */
function bucketOf(iso: string | null | undefined): Bucket {
  const d = parseDate(iso);
  if (!d) return 'earlier';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startOfToday) return 'today';
  if (d.getTime() >= startOfToday - 86_400_000) return 'yesterday';
  return 'earlier';
}

/** `formatDistanceToNow` throws on an Invalid Date; a row must not. */
function relativeTime(iso: string | null | undefined, addSuffix = true): string | null {
  const d = parseDate(iso);
  if (!d) return null;
  try {
    return formatDistanceToNow(d, { addSuffix });
  } catch {
    return null;
  }
}

function SheetHeaderRow({
  title,
  count,
  aside,
  children,
}: {
  title: React.ReactNode;
  count?: number;
  /** Beside the title, as the operator's Critical chip (notification-sheet-v2.tsx). */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <SheetTitle className="shrink-0 text-[15px] font-semibold tracking-tight text-pv-fg">
          {title}
          {count ? <span className={COUNT_PILL}>{count}</span> : null}
        </SheetTitle>
        {aside}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">{children}</div>
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} aria-label="Close" className={HEADER_ICON}>
      <X aria-hidden className="size-4" />
    </button>
  );
}

function EmptyPanel({ icon: Icon, title, body }: { icon: typeof Bell; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-pv-muted text-pv-muted-fg">
        <Icon aria-hidden className="size-5" />
      </div>
      <p className="text-[13px] font-semibold tracking-tight text-pv-fg">{title}</p>
      <p className="mt-1.5 max-w-[260px] text-[12px] leading-relaxed text-pv-muted-fg">{body}</p>
    </div>
  );
}

function ListSkeleton({ avatar = false }: { avatar?: boolean }) {
  return (
    <div className="space-y-4 p-5" aria-busy>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3">
          {avatar ? <div className="size-9 shrink-0 animate-pulse rounded-full bg-pv-muted" /> : null}
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded-full bg-pv-muted" />
            <div className="h-3 w-full animate-pulse rounded-full bg-pv-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── notifications ───────────────────────────── */

/**
 * The filters, built the way the operator's are
 * (components/notifications/notification-filters.ts): ONE list of keys that is
 * both the pills and the only values the panel may filter by, and ONE predicate
 * (`matches`, the counterpart of the operator's `applyFilter`) used by the list
 * AND by every count, so the number on a pill is a promise about the rows under it.
 *
 * Critical is NOT a category but a severity (the operator's reasoning in
 * notification-sheet-v2.tsx): a failed payment is a Payment and Critical and
 * shows under both. So, as there, it is a chip beside the title, not a pill.
 * Unlike there it shows even at zero: a customer has no other way to learn the
 * filter exists, and "0 critical" is itself an answer.
 *
 * System is gone. On the operator's side it is the complement of the
 * categories; for a customer that is a welcome note and generic info/success
 * messages, nothing anyone filters FOR. Those rows stay in All, and the alerts
 * among them are one tap away on the Critical chip. Without it the row is All +
 * three categories, which fits 390px with no sideways scroll.
 */
type Category = 'payments' | 'rentals' | 'documents';
type Filter = 'all' | Category | 'critical';

/** `null`: in All only (what the operator calls System; not offered here). */
const CATEGORY_OF: Record<NotificationKind, Category | null> = {
  payment: 'payments',
  booking: 'rentals',
  agreement: 'documents',
  verification: 'documents',
  welcome: null,
  alert: null,
  success: null,
  info: null,
};

/** The pills, in order. Critical is the chip beside the title. */
const NOTIFICATION_FILTERS: { key: Exclude<Filter, 'critical'>; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'payments', label: 'Payments' },
  { key: 'rentals', label: 'Rentals' },
  { key: 'documents', label: 'Documents' },
];

const FILTER_KEYS: Filter[] = ['all', 'payments', 'rentals', 'documents', 'critical'];

const CATEGORY_LABEL: Record<Category, string> = {
  payments: 'Payment',
  rentals: 'Rental',
  documents: 'Document',
};

/** The operator's category tones (notifications/taxonomy.ts). */
const CATEGORY_TONE: Record<Category, string> = {
  payments: 'bg-emerald-500/10 text-emerald-700',
  rentals: 'bg-blue-500/10 text-blue-700',
  documents: 'bg-violet-500/10 text-violet-700',
};

/** The sentence an empty list should say, which depends on why it is empty. */
const EMPTY_COPY: Record<Filter, string> = {
  all: 'Nothing here yet. Updates about your rentals, payments and documents will appear as they happen.',
  payments: 'No payment notifications yet.',
  rentals: 'No rental notifications yet.',
  documents: 'No document notifications yet.',
  critical: 'Nothing needs your attention right now.',
};

const isCritical = (n: CustomerNotification) => n.kind === 'alert';

/** The filter as a predicate: the one used for the list and for every count. */
function matches(n: CustomerNotification, filter: Filter): boolean {
  switch (filter) {
    case 'critical':
      return isCritical(n);
    case 'payments':
    case 'rentals':
    case 'documents':
      return CATEGORY_OF[n.kind] === filter;
    case 'all':
    default:
      return true;
  }
}

function NotificationRow({
  notification: n,
  busy,
  onOpen,
  onMarkRead,
}: {
  notification: CustomerNotification;
  busy: boolean;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const category = CATEGORY_OF[n.kind];
  const critical = isCritical(n);
  const unread = !n.isRead;
  const when = relativeTime(n.createdAt);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group relative w-full cursor-pointer px-5 py-3.5 text-left transition-colors duration-200 hover:bg-pv-hover/60 focus-visible:outline-none focus-visible:bg-pv-hover/60 motion-reduce:transition-none',
        critical ? 'bg-pv-danger/[0.03]' : unread ? 'bg-pv-primary/[0.03]' : '',
      )}
    >
      {/* Severity is a left edge, not a filled card. */}
      {critical ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-pv-danger" /> : null}

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p
              className={cn(
                'line-clamp-2 text-[13px] leading-snug',
                unread || critical ? 'font-semibold text-pv-fg' : 'font-medium text-pv-fg/80',
              )}
            >
              {n.title || 'Notification'}
            </p>
            {unread ? <span aria-label="Unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-pv-primary" /> : null}
          </div>

          {n.message ? (
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-pv-muted-fg">{n.message}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {category ? (
              <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium', CATEGORY_TONE[category])}>
                {CATEGORY_LABEL[category]}
              </span>
            ) : null}
            {critical ? (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-pv-danger-light px-2 text-[10px] font-medium text-pv-danger">
                <AlertTriangle aria-hidden className="size-2.5" />
                Critical
              </span>
            ) : null}
            {when ? <span className="text-[11px] text-pv-muted-fg/80">{when}</span> : null}
          </div>
        </div>

        {/* One action per row, and only where it applies. */}
        {unread ? (
          <button
            type="button"
            title="Mark as read"
            aria-label="Mark as read"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onMarkRead();
            }}
            className={cn(HEADER_ICON, 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
          >
            {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <CheckCheck aria-hidden className="size-3.5" />}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const {
    notifications: all,
    hasMore,
    isLoading,
    isError,
    error,
    refetch,
    markAsRead,
    markAllAsRead,
    isMarkingAll,
    pendingId,
    mutationError,
  } = useCustomerNotifications();
  // Messages are not notifications: they have their own sheet and badge (the
  // operator's centre excludes `chat_message` outright too).
  const notifications = useMemo(() => all.filter((n) => n.typeRaw !== 'chat_message'), [all]);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  // Each count is the list's own predicate over the same rows, so a pill's
  // number and the rows under it cannot disagree (the operator's applyFilter).
  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>;
    for (const key of FILTER_KEYS) out[key] = notifications.filter((n) => matches(n, key)).length;
    return out;
  }, [notifications]);
  const criticalCount = counts.critical;
  const criticalActive = filter === 'critical';

  const shown = notifications.filter((n) => matches(n, filter));
  const grouped: Record<Bucket, CustomerNotification[]> = { today: [], yesterday: [], earlier: [] };
  for (const n of shown) grouped[bucketOf(n.createdAt)].push(n);

  const open = (n: CustomerNotification) => {
    if (!n.isRead) markAsRead(n.id);
    // `href` is already validated by the hook: same-app, known routes only.
    if (n.href) {
      onClose();
      router.push(n.href);
    }
  };

  return (
    <>
      <div className="shrink-0 border-b border-pv-border px-5 py-4">
        <SheetHeaderRow
          title={
            <span className="inline-flex items-center">
              Notifications
              {unreadCount > 0 ? <span className={COUNT_PILL}>{unreadCount}</span> : null}
            </span>
          }
          aside={
            /* Critical as a severity chip beside the title, as the operator's.
               Pressing it filters; pressing it again returns to All. Always
               present (the customer has no other route to it); red only when
               there is something critical. */
            <button
              type="button"
              aria-pressed={criticalActive}
              onClick={() => setFilter(criticalActive ? 'all' : 'critical')}
              className={cn(
                'inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold transition-colors duration-200 motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50',
                criticalActive
                  ? 'bg-pv-danger text-white'
                  : criticalCount > 0
                    ? 'bg-pv-danger-light text-pv-danger hover:bg-pv-danger/15'
                    : 'bg-pv-muted text-pv-muted-fg hover:bg-pv-hover hover:text-pv-fg',
              )}
            >
              <AlertTriangle aria-hidden className="size-2.5" />
              {isLoading ? 'Critical' : `${criticalCount} critical`}
            </button>
          }
        >
          <button
            type="button"
            title="Mark all as read"
            aria-label="Mark all as read"
            disabled={unreadCount === 0 || isMarkingAll}
            onClick={markAllAsRead}
            className={HEADER_ICON}
          >
            {isMarkingAll ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <CheckCheck aria-hidden className="size-4" />}
          </button>
          <CloseButton onClose={onClose} />
        </SheetHeaderRow>
        <SheetDescription className="sr-only">Updates about your rentals, payments and documents.</SheetDescription>

        {/* Filters: All + the three categories, one row that never scrolls.
            Each pill sized to its label and sharing the slack (`flex-auto`), so
            every pill is in view at 390px as at 420px, never cut or scrolled.
            All four always shown: a customer's list is short, and a pill that
            comes and goes hides the very filter it is. Counts shown even at
            zero, and only once loaded, as the operator's. */}
        <div role="group" aria-label="Filter notifications" className="mt-3 flex gap-1">
          {NOTIFICATION_FILTERS.map(({ key, label }) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={active}
                className={cn(
                  'inline-flex h-7 min-w-0 flex-auto cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] font-medium transition-colors duration-200 motion-reduce:transition-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50',
                  active ? 'bg-pv-primary/10 text-pv-primary' : 'text-pv-muted-fg hover:bg-pv-hover hover:text-pv-fg',
                )}
              >
                <span className="truncate">{label}</span>
                {!isLoading ? (
                  <span className={cn('tabular-nums', active ? 'text-pv-primary/70' : 'text-pv-muted-fg/70')}>
                    {counts[key]}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {mutationError ? (
        <p className="flex shrink-0 items-center gap-2 border-b border-pv-border bg-pv-danger-light px-5 py-2.5 text-[12px] text-pv-danger">
          <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
          Could not update that. Try again.
        </p>
      ) : null}

      <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', NO_SCROLLBAR)}>
        {isLoading ? (
          <ListSkeleton />
        ) : isError ? (
          // A failed fetch is NOT an empty list.
          <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-pv-danger-light text-pv-danger">
              <AlertTriangle aria-hidden className="size-5" />
            </div>
            <p className="text-[13px] font-semibold tracking-tight text-pv-fg">Notifications could not be loaded</p>
            <p className="mt-1.5 max-w-[260px] text-[12px] leading-relaxed text-pv-muted-fg">
              {error?.message || 'The request did not come back.'}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-5 inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border border-pv-border px-3 text-[13px] font-medium text-pv-fg transition-colors duration-200 hover:bg-pv-hover"
            >
              <RefreshCw aria-hidden className="size-3.5" />
              Try again
            </button>
          </div>
        ) : shown.length === 0 ? (
          <EmptyPanel
            icon={filter === 'all' ? Bell : filter === 'critical' ? ShieldCheck : Inbox}
            title={filter === 'all' ? 'No notifications' : filter === 'critical' ? 'Nothing critical' : 'Nothing in this category'}
            body={EMPTY_COPY[filter]}
          />
        ) : (
          <>
            {BUCKETS.map((bucket) =>
              grouped[bucket].length === 0 ? null : (
                <div key={bucket}>
                  <p className={DAY_HEADING}>{BUCKET_LABEL[bucket]}</p>
                  <div className="divide-y divide-pv-border/60">
                    {grouped[bucket].map((n) => (
                      <NotificationRow
                        key={n.id}
                        notification={n}
                        busy={pendingId === n.id}
                        onOpen={() => open(n)}
                        onMarkRead={() => markAsRead(n.id)}
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
            {/* The end of the list says which end it is. */}
            <p className="px-5 py-4 text-center text-[11px] text-pv-muted-fg/80">
              {hasMore ? `Showing your latest ${notifications.length}.` : `That's all ${shown.length}.`}
            </p>
          </>
        )}
      </div>
    </>
  );
}

export function NotificationsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className={SHEET_SHELL}>
        <NotificationsPanel onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

/* ──────────────────────────────── messages ─────────────────────────────── */

export interface ConversationSummary {
  /** The newest in-app message, null when the thread has none. */
  preview: string | null;
  /** Sent by the customer themselves ("You: …"). */
  fromCustomer: boolean;
  at: string | null;
}

/** The text a conversation row shows for a message. */
export function previewText(content: string, hasBooking: boolean): string {
  const text = content.trim();
  if (text) return text;
  return hasBooking ? 'Shared a rental' : 'Message';
}

/**
 * The newest message in the customer's conversation, for the sheet's row.
 * The same scoping as `use-customer-messages`: the customer + tenant pair
 * re-applied through the channel join, the in-app thread only.
 */
function useConversationSummary(enabled: boolean) {
  const { tenant } = useTenant();
  const { customerId } = useCustomer();
  const tenantId = tenant?.id ?? null;
  return useQuery({
    queryKey: ['customer-conversation-summary', tenantId, customerId],
    queryFn: async (): Promise<ConversationSummary> => {
      if (!tenantId || !customerId) return { preview: null, fromCustomer: false, at: null };
      const { data, error } = await supabase
        .from('chat_channel_messages')
        .select('content, sender_type, created_at, metadata, chat_channels!inner(tenant_id, customer_id)')
        .eq('chat_channels.tenant_id', tenantId)
        .eq('chat_channels.customer_id', customerId)
        .eq('channel', 'in_app')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message || 'Could not load your conversation');
      if (!data) return { preview: null, fromCustomer: false, at: null };
      const metadata = data.metadata as { type?: string } | null;
      return {
        preview: previewText(data.content ?? '', metadata?.type === 'booking_reference'),
        fromCustomer: (data.sender_type ?? '').toLowerCase() === 'customer',
        at: data.created_at,
      };
    },
    enabled: enabled && !!tenantId && !!customerId,
    staleTime: 0,
  });
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';

/**
 * The rental company's mark: the same square mark the portal's sidebar shows
 * at the top of the rail (the tenant's favicon, `useTenantBranding`), whole
 * the circle; its initials when it has none. Not `logo_url`: that is the wide
 * wordmark, which shrinks to an unreadable sliver in a circle.
 */
export function CompanyAvatar({ name, className }: { name: string; className?: string }) {
  const { faviconUrl } = useTenantBranding();
  return (
    <span
      className={cn(
        'grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-pv-primary/10 text-[11px] font-semibold text-pv-primary',
        className,
      )}
    >
      {faviconUrl ? <img src={faviconUrl} alt="" className="size-full object-contain" /> : initialsOf(name)}
    </span>
  );
}

function MessagesPanel({ unread, onClose }: { unread: number; onClose: () => void }) {
  const { tenant } = useTenant();
  const companyName = tenant?.company_name ?? tenant?.app_name ?? 'Your rental company';
  const summary = useConversationSummary(true);
  const when = relativeTime(summary.data?.at);
  const bucket = bucketOf(summary.data?.at);
  const hasUnread = unread > 0;

  return (
    <>
      <div className="shrink-0 border-b border-pv-border px-5 py-4">
        <SheetHeaderRow title="Messages" count={hasUnread ? 1 : 0}>
          <Link href="/portal/messages" onClick={onClose} title="Open messages" aria-label="Open messages" className={HEADER_ICON}>
            <ArrowUpRight aria-hidden className="size-4" />
          </Link>
          <CloseButton onClose={onClose} />
        </SheetHeaderRow>
        <SheetDescription className="sr-only">Your conversation with {companyName}.</SheetDescription>
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', NO_SCROLLBAR)}>
        {summary.isLoading ? (
          <ListSkeleton avatar />
        ) : summary.isError ? (
          <EmptyPanel icon={MessageCircle} title="Messages could not be loaded" body="Open Messages to try again." />
        ) : (
          <div>
            <p className={DAY_HEADING}>{BUCKET_LABEL[summary.data?.at ? bucket : 'today']}</p>
            {/* One conversation: the customer's with the rental company. */}
            <Link
              href="/portal/messages"
              onClick={onClose}
              className={cn(
                'flex items-start gap-3 px-5 py-3.5 transition-colors duration-200 hover:bg-pv-hover/60 focus-visible:outline-none focus-visible:bg-pv-hover/60 motion-reduce:transition-none',
                hasUnread && 'bg-pv-primary/[0.03]',
              )}
            >
              <CompanyAvatar name={companyName} className="size-9" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className={cn('truncate text-[13px] leading-snug', hasUnread ? 'font-semibold text-pv-fg' : 'font-medium text-pv-fg/80')}>
                    {companyName}
                  </p>
                  {when ? <span className="shrink-0 text-[11px] text-pv-muted-fg/80">{when}</span> : null}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-3">
                  <p className={cn('truncate text-[12px]', hasUnread ? 'text-pv-fg/80' : 'text-pv-muted-fg')}>
                    {summary.data?.preview ? (
                      <>
                        {summary.data.fromCustomer ? 'You: ' : null}
                        {summary.data.preview}
                      </>
                    ) : (
                      <span className="italic text-pv-muted-fg/70">No messages yet. Say hello.</span>
                    )}
                  </p>
                  {hasUnread ? (
                    <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-pv-primary px-1 text-[9px] font-bold leading-none text-white">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

export function MessagesSheet({
  open,
  onOpenChange,
  unread,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The operator's messages this customer has not read (the top bar's badge). */
  unread: number;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className={SHEET_SHELL}>
        <MessagesPanel unread={unread} onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
