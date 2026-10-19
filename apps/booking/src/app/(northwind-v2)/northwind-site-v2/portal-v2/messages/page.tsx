'use client';

/**
 * /portal/messages — the customer's support conversation.
 *
 * v1's page is 24 lines over a 495-line app-wide realtime context. The data
 * layer here is `use-customer-messages`; this file is the screen.
 *
 * NO CONNECTION INDICATOR, deliberately. `postgres_changes` reports SUBSCRIBED
 * whether or not the table is in the `supabase_realtime` publication, so a
 * "Live" badge would be asserting something the client cannot actually know.
 * The socket only picks the poll cadence; the promise made on screen —
 * "replies appear here automatically" — is one polling keeps on its own.
 */

import { useEffect, useRef } from 'react';
import { Loader2, MessageCircle } from 'lucide-react-nw';

import {
  LoadError,
  PageHeader,
  Panel,
} from '@nw/portal-v2/primitives';
import { Button } from '@nw/components/ui/button';
import { ScrollArea } from '@nw/components/ui/scroll-area';
import { useCustomerMessages } from '@nw/hooks/use-customer-messages';
import { useTenant } from '@nw/contexts/TenantContext';
import { cn } from '@nw/lib/utils';

import { PV_BUTTON_GHOST_SM } from '../settings/_components/pv-kit';

import { MessageComposer } from './message-composer';
import {
  DaySeparator,
  MessageBubble,
  MessageThreadSkeleton,
  OperatorAvatar,
  groupMessagesByDay,
  runPosition,
} from './message-thread';

export default function PortalMessagesPage() {
  const { tenant } = useTenant();
  const {
    messages,
    isEmpty,
    isLoading,
    isError,
    error,
    refetch,
    hasMore,
    loadEarlier,
    isLoadingMore,
    send,
    isSending,
    sendError,
  } = useCustomerMessages();

  const operatorName = tenant?.company_name ?? tenant?.app_name ?? 'our team';

  /* ── keep the newest message in view ───────────────────────────────────── */

  const viewportRef = useRef<HTMLDivElement>(null);
  const newestId = messages.length > 0 ? messages[messages.length - 1].id : null;
  const lastPinnedRef = useRef<number | null>(null);

  useEffect(() => {
    if (newestId === null) return;

    // Only when the TAIL grows. Pressing "Load earlier" prepends history and
    // leaves `newestId` untouched, so this does not yank the reader back down
    // from the older messages they just asked for.
    if (lastPinnedRef.current !== null && newestId <= lastPinnedRef.current) return;
    lastPinnedRef.current = newestId;

    const viewport = viewportRef.current;
    if (!viewport) return;

    // After paint: the bubbles have to be laid out before `scrollHeight` means
    // anything, and the first pass runs while the list is still the skeleton.
    const frame = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [newestId]);

  const groups = groupMessagesByDay(messages);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Messages"
        description={`Ask ${operatorName} anything about your booking. Replies appear here automatically.`}
      />

      {isError ? (
        <LoadError
          title="We could not load your messages"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : (
        /* The operator's thread column, held in the portal's card. The page
           header and the shell's top bar are a known height, so the card takes
           what is left of the window and the history is the ONLY scroll region
           — the header above it and the composer below are siblings. */
        <Panel className="relative isolate flex h-[calc(100dvh-14rem)] min-h-[28rem] flex-col overflow-hidden sm:h-[calc(100dvh-12.5rem)]">
          {/* The operator's faint line grid behind the conversation, so the
              thread has a surface rather than reading as an empty box. Its own
              layer under everything, faded to nothing at the edges by a radial
              mask so it never meets the card's rim as a hard line. */}
          <div
            aria-hidden
            className={
              'pointer-events-none absolute inset-0 -z-10 bg-[size:32px_32px] ' +
              'bg-[linear-gradient(to_right,color-mix(in_srgb,var(--pv-primary)_7%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--pv-primary)_7%,transparent)_1px,transparent_1px)] ' +
              '[mask-image:radial-gradient(ellipse_75%_70%_at_50%_45%,black_35%,transparent_100%)]'
            }
          />

          <header className="flex shrink-0 items-center gap-3.5 px-4 py-4 sm:px-6">
            <OperatorAvatar name={operatorName} className="size-11 text-[13px]" />
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold leading-tight text-pv-fg">
                {operatorName}
              </h2>
              <p className="mt-0.5 truncate text-[12px] text-pv-muted-fg">
                Usually replies during opening hours
              </p>
            </div>
          </header>

          {/* `min-h-0` is load-bearing, not tidying. A flex item defaults to
              `min-height: auto`, so without it the scroll region refuses to
              shrink below the height of the whole thread: the panel's fixed
              height then clips from the BOTTOM and the composer is pushed out
              of the box entirely. Verified — the send button was unreachable at
              both 360px and 1280px before this. */}
          <ScrollArea viewportRef={viewportRef} className="min-h-0 flex-1">
            <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 pb-6 pt-2 sm:px-6">
              {hasMore ? (
                <div className="mb-2 flex justify-center">
                  <Button
                    type="button"
                    variant="ghost"
                    className={PV_BUTTON_GHOST_SM}
                    onClick={loadEarlier}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? (
                      <>
                        <Loader2 aria-hidden className="size-3.5 animate-spin" />
                        Loading…
                      </>
                    ) : (
                      'Load earlier messages'
                    )}
                  </Button>
                </div>
              ) : null}

              {isLoading ? (
                <MessageThreadSkeleton />
              ) : isEmpty ? (
                <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
                  <span className="mb-5 grid size-14 place-items-center rounded-2xl bg-pv-primary/10 text-pv-primary">
                    <MessageCircle aria-hidden className="size-6" />
                  </span>
                  <p className="text-base font-semibold tracking-tight text-pv-fg">
                    No messages yet
                  </p>
                  <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-pv-muted-fg">
                    Write the first one below. Attach one of your bookings with the clip
                    so the team knows which car you mean.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col">
                  {groups.map((group, groupIndex) => (
                    /* The first day label drops its top margin: the history
                       starts at the top, as in the operator's thread. */
                    <div
                      key={group.key}
                      className={cn(
                        'flex flex-col',
                        groupIndex === 0 && '[&>div:first-child]:mt-0',
                      )}
                    >
                      <DaySeparator heading={group.heading} />
                      {group.messages.map((message, index) => (
                        <MessageBubble
                          key={message.id}
                          message={message}
                          senderName={operatorName}
                          {...runPosition(group.messages, index)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="mx-auto w-full max-w-4xl">
            <MessageComposer
              onSend={send}
              isSending={isSending}
              sendError={sendError}
              disabled={isLoading}
            />
          </div>
        </Panel>
      )}
    </div>
  );
}
