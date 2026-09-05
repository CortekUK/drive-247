'use client';

/**
 * The customer's support conversation with the operator.
 *
 * ── WHAT THIS IS A PORT OF ──────────────────────────────────────────────────
 * v1 spreads this across three files: a 495-line `CustomerRealtimeChatContext`
 * mounted app-wide, a `use-customer-chat` hook that mirrors every realtime
 * event back into a React Query cache by hand, and a chat window that re-derives
 * the same state a fourth time. This is that whole stack, collapsed, because the
 * portal has exactly ONE conversation and exactly one screen that shows it.
 *
 * ── THE ISOLATION BOUNDARY ──────────────────────────────────────────────────
 * `chat_channels` and `chat_channel_messages` have RLS OFF on staging and a
 * SELECT grant to `anon` — verified live against ksmreaadhbirzakkxqrq: an
 * unauthenticated request carrying only the public anon key reads every
 * tenant's conversations in full. So the filters below are the ONLY thing
 * keeping one customer out of another's messages.
 *
 * `chat_channel_messages` carries no `tenant_id` and no `customer_id` — only
 * `channel_id`. The pair is therefore enforced TWICE, deliberately:
 *
 *   1. the channel is resolved by `.eq('tenant_id', …).eq('customer_id', …)`,
 *      and
 *   2. the message read joins back through `chat_channels!inner` and re-applies
 *      BOTH filters, so the predicate travels with the query rather than living
 *      in a variable a later edit could reassign.
 *
 * Both ids come from the auth read model (`useCustomer`) and the tenant
 * context. Neither is ever a prop, a route param or a query string: there is no
 * `channelId` argument on this hook, because an id that can be passed in is an
 * id that can be swapped.
 *
 * ── WHY POLLING SITS ALONGSIDE REALTIME ─────────────────────────────────────
 * `postgres_changes` only delivers for tables in the `supabase_realtime`
 * publication, and `.subscribe()` reports SUBSCRIBED whether or not the table is
 * in it — a socket that will never fire looks identical to a healthy one from
 * the client. A support chat that silently stops updating is worse than one that
 * updates a few seconds late, so the query also polls, faster while the socket
 * is not confirmed. `refetchOnWindowFocus` is set explicitly because the app's
 * global default is `false`, and coming back to the tab is exactly when a
 * customer expects to see the reply.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useCustomer } from '@/hooks/use-customer';
import { useTenant } from '@/contexts/TenantContext';
import type { Database, Json } from '@/integrations/supabase/types';

/* ────────────────────────────── row shapes ─────────────────────────────── */

type MessageRow = Database['public']['Tables']['chat_channel_messages']['Row'];

/**
 * The message columns the portal reads.
 *
 * `external_id`, `external_status` and `from_number` are deliberately absent:
 * they are the operator's Twilio/SES plumbing, and `from_number` in particular
 * is a staff member's phone number.
 */
type CustomerMessageRow = Pick<
  MessageRow,
  | 'id'
  | 'channel_id'
  | 'sender_type'
  | 'sender_id'
  | 'content'
  | 'is_read'
  | 'read_at'
  | 'metadata'
  | 'created_at'
>;

const MESSAGE_COLUMNS = [
  'id',
  'channel_id',
  'sender_type',
  'sender_id',
  'content',
  'is_read',
  'read_at',
  'metadata',
  'created_at',
].join(', ');

/**
 * `chat_channels!inner(id)` is a FILTER, not data.
 *
 * PostgREST will only apply `.eq('chat_channels.…')` when the embed is named in
 * the select, and `!inner` makes it a join rather than a left join — without the
 * `!inner` a message whose channel does not match would still come back, with a
 * null embed. The embedded object is discarded on the way out.
 */
const MESSAGE_SELECT = `${MESSAGE_COLUMNS}, chat_channels!inner(id)`;

type MessageQueryRow = CustomerMessageRow & { chat_channels: { id: string } };

/* ─────────────────────────── booking attachments ───────────────────────── */

/**
 * A booking pinned to a message, as it is written into `metadata`.
 *
 * The shape is v1's and cannot be changed unilaterally: the operator's portal
 * writes it too, and both ends have to agree. It is denormalised on purpose —
 * the card shows what the booking looked like when it was shared, and re-reading
 * the rental today would silently rewrite the history of the conversation.
 */
export interface MessageBookingReference {
  id: string;
  rentalNumber: string | null;
  status: string;
  startDate: string;
  endDate: string;
  vehicle: {
    make: string | null;
    model: string | null;
    reg: string;
  };
}

/**
 * The attachment, widened into `Json` for the `metadata` column.
 *
 * A fresh object literal, field by field, rather than a cast: `Json`'s object
 * arm is an index signature and an interface does not satisfy one, so
 * `metadata: { type, booking }` does not compile. Rebuilding it here means the
 * day a field is added to `MessageBookingReference` and NOT added here, the
 * write silently drops it — which is why the literal mirrors the interface
 * exactly and nothing is spread in.
 */
function bookingReferenceToJson(booking: MessageBookingReference): Json {
  return {
    type: 'booking_reference',
    booking: {
      id: booking.id,
      rentalNumber: booking.rentalNumber,
      status: booking.status,
      startDate: booking.startDate,
      endDate: booking.endDate,
      vehicle: {
        make: booking.vehicle.make,
        model: booking.vehicle.model,
        reg: booking.vehicle.reg,
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Read a booking attachment out of `metadata`, or `null`.
 *
 * `metadata` is a `jsonb` column written by two different apps across two eras,
 * so every field is checked rather than cast. A malformed attachment degrades to
 * "no card" — the message text still renders — instead of throwing inside a
 * render and taking the whole conversation down.
 */
export function parseBookingReference(metadata: Json | null): MessageBookingReference | null {
  if (!isRecord(metadata)) return null;
  if (metadata.type !== 'booking_reference') return null;

  const booking = metadata.booking;
  if (!isRecord(booking)) return null;

  const id = optionalString(booking.id);
  const startDate = optionalString(booking.startDate);
  if (id === null || startDate === null) return null;

  const vehicle = isRecord(booking.vehicle) ? booking.vehicle : {};

  return {
    id,
    rentalNumber: optionalString(booking.rentalNumber),
    status: optionalString(booking.status) ?? 'Unknown',
    startDate,
    endDate: optionalString(booking.endDate) ?? startDate,
    vehicle: {
      make: optionalString(vehicle.make),
      model: optionalString(vehicle.model),
      reg: optionalString(vehicle.reg) ?? '',
    },
  };
}

/* ─────────────────────────────── view model ────────────────────────────── */

export interface CustomerMessage {
  id: number;
  channelId: string;
  /** Raw DB value. 'customer' is the signed-in person; everything else is staff. */
  senderType: string;
  senderId: string;
  content: string;
  /** True once the OTHER side has seen it. */
  isRead: boolean;
  readAt: string | null;
  /** `timestamptz` — a real instant, so `new Date()` is correct on this one. */
  createdAt: string;
  booking: MessageBookingReference | null;
  /** Written by the signed-in customer. Drives which side of the thread it sits on. */
  isOwn: boolean;
}

/**
 * `sender_type` is free text in the schema. Anything that is not the customer is
 * the operator as far as this screen is concerned — a future 'system' or 'bot'
 * value reads as coming FROM the company, which is true, rather than being
 * mistaken for something the customer wrote.
 */
function isCustomerSender(senderType: string): boolean {
  return senderType.trim().toLowerCase() === 'customer';
}

function normalizeMessage(row: CustomerMessageRow): CustomerMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    content: row.content,
    isRead: row.is_read,
    readAt: row.read_at,
    // `created_at` is nullable in the generated types (it has a DB default, so
    // it is never actually null); falling back to the epoch would sort a real
    // message to the top of the thread, so an empty string is used and the
    // renderer skips the timestamp rather than printing 1970.
    createdAt: row.created_at ?? '',
    booking: parseBookingReference(row.metadata),
    isOwn: isCustomerSender(row.sender_type),
  };
}

/* ──────────────────────────────── tuning ───────────────────────────────── */

/** How many messages the thread holds before "Load earlier" is offered. */
const PAGE_SIZE = 50;

/**
 * Poll intervals, ms.
 *
 * The cadence is keyed on whether the socket has ever actually DELIVERED a row
 * change — not on whether it said SUBSCRIBED. Verified against staging: the
 * subscription is acknowledged with `phx_reply: ok` and then a real INSERT on
 * the watched channel produces no frame at all, because
 * `chat_channel_messages` is not in that project's `supabase_realtime`
 * publication. Backing off on SUBSCRIBED alone would therefore have picked the
 * SLOW interval in exactly the deployment that needs the fast one.
 *
 * React Query pauses `refetchInterval` while the tab is in the background
 * (`refetchIntervalInBackground` defaults to false), so the fast pass costs
 * nothing when nobody is looking at the thread.
 */
const POLL_UNPROVEN = 6_000;
const POLL_PROVEN = 25_000;

/* ──────────────────────────────── channel ──────────────────────────────── */

export interface CustomerMessageChannel {
  id: string;
  status: string;
  lastMessageAt: string | null;
}

/**
 * The one conversation this customer has with this operator.
 *
 * `chat_channels` carries a unique constraint on `(tenant_id, customer_id)` —
 * verified live — so at most one row can ever match and `maybeSingle()` is safe.
 * Missing is a normal state, not an error: it just means nobody has written yet.
 *
 * Unlike v1 this does NOT create the row on mount. v1's context inserts a
 * channel for every customer who so much as loads the portal, which fills the
 * operator's inbox with empty conversations; here the row is created by the
 * first message actually sent.
 */
function useMessageChannel(tenantId: string | null, customerId: string | null) {
  return useQuery({
    queryKey: ['customer-message-channel', tenantId, customerId],
    queryFn: async (): Promise<CustomerMessageChannel | null> => {
      if (!tenantId || !customerId) return null;

      const { data, error } = await supabase
        .from('chat_channels')
        .select('id, status, last_message_at')
        // Read the file header before touching either of these.
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .maybeSingle();

      if (error) {
        console.error('[useCustomerMessages] Failed to load chat channel', {
          tenantId,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to open your conversation');
      }

      if (!data) return null;
      return { id: data.id, status: data.status, lastMessageAt: data.last_message_at };
    },
    enabled: !!tenantId && !!customerId,
  });
}

/* ───────────────────────────────── hook ────────────────────────────────── */

export interface UseCustomerMessagesResult {
  messages: CustomerMessage[];
  /** No channel row yet, or a channel with nothing in it. */
  isEmpty: boolean;

  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;

  /** More history exists behind the current window. */
  hasMore: boolean;
  loadEarlier: () => void;
  isLoadingMore: boolean;

  send: (content: string, booking?: MessageBookingReference | null) => Promise<void>;
  isSending: boolean;
  sendError: Error | null;
}

export function useCustomerMessages(): UseCustomerMessagesResult {
  const { tenant, isLoading: tenantLoading } = useTenant();
  const { customerId, isLoading: authLoading } = useCustomer();
  const queryClient = useQueryClient();

  const tenantId = tenant?.id ?? null;

  const [limit, setLimit] = useState(PAGE_SIZE);
  /**
   * A row change has arrived over the socket at least once, so this deployment
   * has the table published and the poll can slow down. Never reset: one
   * delivered event is proof for the life of the page.
   */
  const [realtimeProven, setRealtimeProven] = useState(false);

  const channelQuery = useMessageChannel(tenantId, customerId);
  const channelId = channelQuery.data?.id ?? null;

  /**
   * The most recent `limit` messages, oldest-first for rendering.
   *
   * A window rather than a cursor-paginated infinite query, and that is the
   * deliberate difference from v1. Every refetch — poll, focus, realtime nudge —
   * re-reads the SAME window, so the list on screen is always exactly what the
   * table holds. v1's cursor pages drift the moment a message arrives between
   * two fetches: page 0 is re-read as "the newest 25" while page 1 keeps a
   * cursor taken before the arrival, and the rows in between are served twice.
   * A support thread is tens of messages, not tens of thousands; buying
   * correctness with one slightly larger read is the right trade here.
   */
  const messagesQuery = useQuery({
    queryKey: ['customer-messages', tenantId, customerId, channelId, limit],
    queryFn: async (): Promise<CustomerMessage[]> => {
      if (!channelId || !tenantId || !customerId) return [];

      const { data, error } = await supabase
        .from('chat_channel_messages')
        .select(MESSAGE_SELECT)
        .eq('channel_id', channelId)
        // The pair, re-applied through the join. See the file header.
        .eq('chat_channels.tenant_id', tenantId)
        .eq('chat_channels.customer_id', customerId)
        // The portal shows the in-app thread only. The same table also holds
        // the SMS, WhatsApp and email copies the operator sent, and replaying
        // those here would show the customer their own text messages back.
        .eq('channel', 'in_app')
        // `id` and not `created_at`: `created_at` is backfillable and two
        // messages a second apart can share a timestamp, which makes the
        // ordering unstable between refetches. `id` is a bigint sequence.
        .order('id', { ascending: false })
        .limit(limit)
        .overrideTypes<MessageQueryRow[], { merge: false }>();

      if (error) {
        console.error('[useCustomerMessages] Failed to load messages', {
          channelId,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load your messages');
      }

      // Newest-first off the wire (so `limit` takes the TAIL of the thread),
      // reversed here so the renderer reads top-to-bottom in time order.
      return (data ?? []).map(normalizeMessage).reverse();
    },
    enabled: !!channelId && !!tenantId && !!customerId,
    // See POLL_UNPROVEN: a confirmed subscription is not proof of delivery.
    refetchInterval: realtimeProven ? POLL_PROVEN : POLL_UNPROVEN,
    refetchOnWindowFocus: true,
    // Keeping the previous window on screen while a wider one loads is what
    // makes "Load earlier" not blank the conversation.
    placeholderData: (previous) => previous,
  });

  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);
  const hasMore = messages.length >= limit;

  /* ───────────────────────────── realtime ──────────────────────────────── */

  /**
   * Any change on this channel triggers a refetch — the event payload is not
   * merged into the cache.
   *
   * v1 hand-merges INSERT payloads into its query cache and needs deduplication,
   * page-tail bookkeeping and a second handler for UPDATE-means-read. All of
   * that is state that can disagree with the database. Re-reading costs one
   * round-trip per message on a screen that is already waiting for a human to
   * type, and it cannot drift.
   */
  useEffect(() => {
    if (!channelId) return;

    let cancelled = false;
    const onChange = () => {
      if (cancelled) return;
      // The socket demonstrably works here; the poll can stand down.
      setRealtimeProven(true);
      void queryClient.invalidateQueries({
        queryKey: ['customer-messages', tenantId, customerId, channelId],
      });
    };

    const realtime = supabase
      .channel(`portal:messages:${tenantId}:${customerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_channel_messages',
          filter: `channel_id=eq.${channelId}`,
        },
        onChange,
      )
      .subscribe((status) => {
        // Logged, not surfaced: the poll already covers every failure mode this
        // can report, so telling the customer their socket is unhappy would be
        // noise about a problem they are not having.
        if (!cancelled && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
          console.warn('[useCustomerMessages] Realtime subscription failed', {
            channelId,
            status,
          });
        }
      });

    return () => {
      cancelled = true;
      // `removeChannel` unsubscribes AND drops it from the client's registry.
      // `unsubscribe()` alone leaves the topic behind, and remounting the page
      // then rejoins a topic the client thinks it already has.
      void supabase.removeChannel(realtime);
    };
  }, [channelId, tenantId, customerId, queryClient]);

  /* ──────────────────────────── mark as read ───────────────────────────── */

  /**
   * The customer is looking at the thread, so the operator's messages in it are
   * read.
   *
   * Guarded by the highest id already acknowledged, so the effect cannot loop:
   * the UPDATE fires a realtime event, which refetches, which re-runs this
   * effect. Without the ref that is an endless write loop against the database.
   */
  const markedThroughRef = useRef<{ channelId: string; messageId: number } | null>(null);

  useEffect(() => {
    if (!channelId) return;

    const unread = messages.filter((message) => !message.isOwn && !message.isRead);
    if (unread.length === 0) return;

    const highest = unread.reduce((max, message) => Math.max(max, message.id), 0);
    const marked = markedThroughRef.current;
    if (marked && marked.channelId === channelId && marked.messageId >= highest) return;

    markedThroughRef.current = { channelId, messageId: highest };

    void (async () => {
      const { error } = await supabase
        .from('chat_channel_messages')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('channel_id', channelId)
        // `neq` rather than `eq('sender_type','tenant')`: 'tenant' is today's
        // only staff value, but a future 'system' message the customer has
        // plainly seen would otherwise stay unread forever. This cannot touch
        // the operator's own unread badge, which counts sender_type='customer'.
        .neq('sender_type', 'customer')
        .eq('channel', 'in_app')
        .eq('is_read', false);

      if (error) {
        // Non-fatal: the thread is readable, the read receipt just did not
        // land. Reset the guard so the next pass retries.
        markedThroughRef.current = null;
        console.error('[useCustomerMessages] Failed to mark messages read', {
          channelId,
          message: error.message,
          code: error.code,
        });
      }
    })();
  }, [channelId, messages]);

  /* ─────────────────────────────── sending ─────────────────────────────── */

  /**
   * Resolve the channel, creating it if this is the first thing ever sent.
   *
   * The 23505 branch is not defensive padding: `chat_channels` has a unique
   * `(tenant_id, customer_id)` index AND a trigger that creates the row when a
   * customer is created, so an insert losing that race is the expected path, not
   * a corner case. Losing it means the row exists — re-read it and carry on.
   */
  const ensureChannelId = useCallback(async (): Promise<string> => {
    if (!tenantId || !customerId) {
      throw new Error('You need to be signed in to send a message.');
    }
    if (channelId) return channelId;

    const { data, error } = await supabase
      .from('chat_channels')
      .insert({ tenant_id: tenantId, customer_id: customerId })
      .select('id')
      .single();

    if (!error && data) return data.id;

    if (error && error.code !== '23505') {
      throw new Error(error.message || 'Could not start the conversation');
    }

    const { data: existing, error: reselectError } = await supabase
      .from('chat_channels')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .maybeSingle();

    if (reselectError || !existing) {
      throw new Error(
        reselectError?.message || 'Could not start the conversation. Please try again.',
      );
    }
    return existing.id;
  }, [tenantId, customerId, channelId]);

  const sendMutation = useMutation({
    mutationFn: async ({
      content,
      booking,
    }: {
      content: string;
      booking: MessageBookingReference | null;
    }): Promise<void> => {
      if (!customerId) throw new Error('You need to be signed in to send a message.');

      const trimmed = content.trim();
      if (trimmed === '' && !booking) return;

      const resolvedChannelId = await ensureChannelId();

      // `Shared a booking` is v1's placeholder for an attachment-only message and
      // the operator's portal keys off it, so it has to be written verbatim. The
      // renderer hides it again when a card is present.
      const body = trimmed === '' ? 'Shared a booking' : trimmed;

      const { error } = await supabase.from('chat_channel_messages').insert({
        channel_id: resolvedChannelId,
        sender_type: 'customer',
        // `customers.id`, matching what the operator's portal expects to read
        // back. Not the auth user id, which means nothing on this table.
        sender_id: customerId,
        content: body,
        channel: 'in_app',
        metadata: booking ? bookingReferenceToJson(booking) : {},
      });

      if (error) {
        throw new Error(error.message || 'Your message could not be sent');
      }

      // The operator's inbox sorts on `last_message_at`; without this the
      // conversation never rises to the top and the reply never comes.
      // A failure here is logged, not thrown — the message IS sent, and telling
      // the customer otherwise would have them send it twice.
      const { error: touchError } = await supabase
        .from('chat_channels')
        .update({
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', resolvedChannelId);

      if (touchError) {
        console.error('[useCustomerMessages] Failed to touch channel', {
          channelId: resolvedChannelId,
          message: touchError.message,
        });
      }
    },
    onSuccess: async () => {
      // The channel query too: the first message is what creates the row, and
      // without this the thread would keep reading a null channel until the
      // next mount.
      await queryClient.invalidateQueries({
        queryKey: ['customer-message-channel', tenantId, customerId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['customer-messages', tenantId, customerId],
      });
    },
  });

  const send = useCallback(
    async (content: string, booking?: MessageBookingReference | null) => {
      await sendMutation.mutateAsync({ content, booking: booking ?? null });
    },
    [sendMutation],
  );

  const loadEarlier = useCallback(() => {
    setLimit((current) => current + PAGE_SIZE);
  }, []);

  const refetch = useCallback(async () => {
    await channelQuery.refetch();
    await messagesQuery.refetch();
  }, [channelQuery, messagesQuery]);

  const error =
    (channelQuery.error as Error | null) ?? (messagesQuery.error as Error | null);

  // The tenant and auth round-trips are part of this hook's load from the
  // caller's point of view: until both land the queries are disabled and React
  // Query reports idle, so reading `isPending` alone flashes an empty thread at
  // a customer who has messages waiting.
  const isLoading =
    tenantLoading ||
    authLoading ||
    channelQuery.isLoading ||
    (!!channelId && messagesQuery.isLoading);

  return {
    messages,
    isEmpty: !isLoading && messages.length === 0,

    isLoading,
    isError: channelQuery.isError || messagesQuery.isError,
    error,
    refetch,

    hasMore,
    loadEarlier,
    // `isFetching` while a WIDER window loads. `isLoading` stays false because
    // `placeholderData` keeps the previous rows on screen.
    isLoadingMore: messagesQuery.isFetching && messagesQuery.isPlaceholderData,

    send,
    isSending: sendMutation.isPending,
    sendError: (sendMutation.error as Error | null) ?? null,
  };
}
