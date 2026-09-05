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
import { MessageSquare } from 'lucide-react';

import {
  LoadError,
  PageHeader,
  Panel,
} from '@/components/portal/primitives';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCustomerMessages } from '@/hooks/use-customer-messages';
import { useTenant } from '@/contexts/TenantContext';

import { MessageComposer } from './message-composer';
import {
  DaySeparator,
  MessageBubble,
  MessageThreadSkeleton,
  groupMessagesByDay,
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
        <Panel className="flex h-[calc(100dvh-15rem)] min-h-[26rem] flex-col overflow-hidden sm:h-[calc(100dvh-16rem)] sm:max-h-[46rem]">
          <div className="flex items-center gap-2.5 border-b border-brand-border-soft px-4 py-3 sm:px-5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-stone">
              <MessageSquare
                aria-hidden
                strokeWidth={1.75}
                className="size-4 text-brand-text-subtle"
              />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium text-brand-text">
                {operatorName}
              </h2>
              <p className="truncate text-xs text-brand-text-subtle">
                Usually replies during opening hours
              </p>
            </div>
          </div>

          {/* `min-h-0` is load-bearing, not tidying. A flex item defaults to
              `min-height: auto`, so without it the scroll region refuses to
              shrink below the height of the whole thread: the panel's fixed
              height then clips from the BOTTOM and the composer is pushed out
              of the box entirely. Verified — the send button was unreachable at
              both 360px and 1280px before this. */}
          <ScrollArea viewportRef={viewportRef} className="min-h-0 flex-1">
            <div className="flex min-h-full flex-col px-4 py-4 sm:px-5">
              {hasMore ? (
                <div className="flex justify-center pb-2">
                  <Button
                    type="button"
                    variant="brand-ghost"
                    size="sm"
                    className="h-11"
                    onClick={loadEarlier}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? 'Loading…' : 'Load earlier messages'}
                  </Button>
                </div>
              ) : null}

              {isLoading ? (
                <MessageThreadSkeleton />
              ) : isEmpty ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
                  <span className="grid size-11 place-items-center rounded-full bg-brand-stone">
                    <MessageSquare
                      aria-hidden
                      strokeWidth={1.75}
                      className="size-5 text-brand-text-subtle"
                    />
                  </span>
                  <div className="max-w-sm">
                    <p className="text-base font-medium text-brand-text">
                      No messages yet
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-brand-text-soft">
                      Send the first one below. You can attach one of your bookings so
                      the team knows which car you mean.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col">
                  {groups.map((group) => (
                    <div key={group.key} className="flex flex-col">
                      <DaySeparator heading={group.heading} />
                      <div className="flex flex-col gap-2">
                        {group.messages.map((message) => (
                          <MessageBubble
                            key={message.id}
                            message={message}
                            senderName={operatorName}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>

          <MessageComposer
            onSend={send}
            isSending={isSending}
            sendError={sendError}
            disabled={isLoading}
          />
        </Panel>
      )}
    </div>
  );
}
