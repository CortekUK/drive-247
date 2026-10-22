'use client';

/**
 * /portal/messages: the operator's Messages workspace (apps/portal
 * (dashboard)/messages: conversation-rail, conversation-view, customer-context)
 * for a customer. It fills the window: the shell drops its rail and top bar on
 * this route, as the operator's does, and the conversation rail carries the
 * way back.
 *
 *   left    the conversation rail: Back, "Messages", the search pill and the
 *           customer's one conversation, with the rental company;
 *   centre  the thread on the operator's faint grid, the composer card at its
 *           foot (In-App, attach a rental, the round send);
 *   right   the company, as the operator's right column shows the customer:
 *           how to reach them, and the rental the conversation is most likely
 *           about.
 *
 * The data layer is `use-customer-messages` (scoped to this customer and
 * tenant); this file is the screen. NO CONNECTION INDICATOR, deliberately: a
 * "Live" badge would assert what the client cannot know; polling keeps the
 * promise that replies appear on their own.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  CalendarDays,
  CarFront,
  ExternalLink,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Sparkles,
} from 'lucide-react-nw';

import { LoadError } from '@nw/portal-v2/primitives';
import { CompanyAvatar, previewText } from '@nw/portal-v2/top-bar-sheets';
import { formatBookingDates } from '@nw/portal-v2/rentals/format';
import { customerRentalStatus } from '@nw/portal-v2/rentals/rentals-table';
import { useCustomerMessages } from '@nw/hooks/use-customer-messages';
import { useCustomerRentals, type CustomerRental } from '@nw/hooks/use-customer-rentals';
import { useTenant } from '@nw/contexts/TenantContext';
import { cn } from '@nw/lib/utils';
import { RENTAL_STATUS_TONE } from '@portal-v2-shared/rentals-table';
import { V2_LIST_TONES } from '@portal-v2-shared/list-styles';

import { MessageComposer } from './message-composer';
import { DaySeparator, MessageBubble, MessageThreadSkeleton, groupMessagesByDay, runPosition } from './message-thread';

const NO_SCROLLBAR = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/** The operator top bar's search pill, as a real input (conversation-rail.tsx). */
const SEARCH_PILL =
  'flex h-9 min-w-0 flex-1 cursor-text items-center gap-2 rounded-full border border-pv-primary/25 bg-pv-primary/[0.07] px-3 ' +
  'transition-colors duration-200 ease-out motion-reduce:transition-none hover:border-pv-primary/40 hover:bg-pv-primary/10 ' +
  'focus-within:border-pv-primary/50 focus-within:bg-pv-primary/10 focus-within:ring-3 focus-within:ring-pv-ring/30';

const ROUND_ICON =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-pv-muted-fg transition-colors duration-200 hover:bg-pv-hover hover:text-pv-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50 motion-reduce:transition-none';

/** The rental the conversation is most likely about: on rent, else the next, else the latest. */
function relevantRental(rentals: readonly CustomerRental[]): CustomerRental | null {
  const onRent = rentals.find((r) => r.lifecycle === 'on_rent');
  if (onRent) return onRent;
  const coming = rentals
    .filter((r) => r.lifecycle === 'upcoming' || r.lifecycle === 'pending')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return coming[0] ?? rentals[0] ?? null;
}

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

  const companyName = tenant?.company_name ?? tenant?.app_name ?? 'Your rental company';
  const [query, setQuery] = useState('');

  /* ── keep the newest message in view ───────────────────────────────────── */

  const viewportRef = useRef<HTMLDivElement>(null);
  const newestId = messages.length > 0 ? messages[messages.length - 1].id : null;
  const lastPinnedRef = useRef<number | null>(null);

  useEffect(() => {
    if (newestId === null) return;
    // Only when the TAIL grows: "Load earlier" prepends and must not yank the
    // reader back down from the history they asked for.
    if (lastPinnedRef.current !== null && newestId <= lastPinnedRef.current) return;
    lastPinnedRef.current = newestId;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const frame = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [newestId]);

  const groups = groupMessagesByDay(messages);
  const last = messages.length > 0 ? messages[messages.length - 1] : null;
  const preview = last ? previewText(last.content, last.booking !== null) : null;

  // The search matches the conversation by the company's name or anything said in it.
  const q = query.trim().toLowerCase();
  const matches =
    !q ||
    companyName.toLowerCase().includes(q) ||
    messages.some((m) => m.content.toLowerCase().includes(q));

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ── left: the conversation rail ─────────────────────────────────── */}
      <div className="hidden min-h-0 w-[320px] shrink-0 flex-col md:flex lg:w-[360px]">
        <div className="shrink-0 space-y-3 px-3 py-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link href="/portal/rentals" title="Back to the portal" aria-label="Back to the portal" className={cn(ROUND_ICON, '-ml-1')}>
              <ArrowLeft aria-hidden className="size-4" />
            </Link>
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-pv-fg">Messages</h1>
          </div>
          <label className={SEARCH_PILL}>
            <Search aria-hidden className="size-4 shrink-0 text-pv-primary" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-pv-fg outline-none placeholder:text-pv-muted-on-tint [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
        </div>

        <div className={cn('min-h-0 flex-1 overflow-y-auto px-2', NO_SCROLLBAR)}>
          {matches ? (
            // The one conversation, always the open one.
            <div
              aria-current="true"
              className="relative flex w-full items-center gap-3.5 rounded-xl bg-pv-primary/10 px-2 py-3 text-left"
            >
              <CompanyAvatar name={companyName} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-[13px] font-medium text-pv-fg">{companyName}</p>
                  <span className="shrink-0 text-[10.5px] text-pv-muted-fg">
                    {last?.createdAt ? formatDistanceToNow(new Date(last.createdAt)) : ''}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <MessageCircle aria-label="In-app" className="size-3 shrink-0 text-pv-muted-fg/70" />
                  <p className="truncate text-[12px] text-pv-muted-fg">
                    {preview ? (
                      <>
                        {last?.isOwn ? 'You: ' : null}
                        {preview}
                      </>
                    ) : (
                      <span className="italic text-pv-muted-fg/60">No messages yet</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="px-6 py-16 text-center">
              <p className="text-[13px] font-medium text-pv-fg">No conversations match “{query.trim()}”</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-pv-muted-fg">Try a different word.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── centre: the thread ──────────────────────────────────────────── */}
      <main className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col">
        {/* The operator's faint line grid behind the conversation. */}
        <div
          aria-hidden
          className={
            'pointer-events-none absolute inset-0 -z-10 bg-[size:32px_32px] ' +
            'bg-[linear-gradient(to_right,color-mix(in_srgb,var(--pv-primary)_7%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--pv-primary)_7%,transparent)_1px,transparent_1px)] ' +
            '[mask-image:radial-gradient(ellipse_80%_75%_at_50%_45%,black_40%,transparent_100%)]'
          }
        />

        {/* Below md there is no rail: the thread carries its own way back and
            names who it is with, as the operator's does on a narrow window. */}
        <header className="flex shrink-0 items-center gap-2 px-3 py-3 md:hidden">
          <Link href="/portal/rentals" aria-label="Back to the portal" className={ROUND_ICON}>
            <ArrowLeft aria-hidden className="size-4" />
          </Link>
          <CompanyAvatar name={companyName} className="size-8" />
          <p className="min-w-0 truncate text-[14px] font-semibold text-pv-fg">{companyName}</p>
        </header>

        {isError ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <LoadError
              title="We could not load your messages"
              error={error}
              onRetry={() => {
                void refetch();
              }}
            />
          </div>
        ) : (
          <>
            <div ref={viewportRef} className={cn('relative min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-6 lg:px-10', NO_SCROLLBAR)}>
              {!isLoading && isEmpty ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-pv-primary/10 text-pv-primary">
                    <MessageCircle aria-hidden className="size-6" />
                  </div>
                  <h3 className="text-base font-semibold tracking-tight text-pv-fg">No messages yet</h3>
                  <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-pv-muted-fg">
                    Say hello to {companyName}. Write below — attach a rental so they know which car you mean.
                  </p>
                </div>
              ) : (
                <div className="mx-auto w-full max-w-4xl">
                  {hasMore && !isLoading ? (
                    <div className="mb-2 flex justify-center">
                      <button
                        type="button"
                        onClick={loadEarlier}
                        disabled={isLoadingMore}
                        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-pv-muted-fg transition-colors duration-200 hover:bg-pv-hover hover:text-pv-fg disabled:opacity-60"
                      >
                        {isLoadingMore ? (
                          <>
                            <Loader2 aria-hidden className="size-3.5 animate-spin" />
                            Loading…
                          </>
                        ) : (
                          'Load earlier messages'
                        )}
                      </button>
                    </div>
                  ) : null}

                  {isLoading ? (
                    <MessageThreadSkeleton />
                  ) : (
                    <div className="flex flex-col">
                      {groups.map((group, groupIndex) => (
                        <div key={group.key} className={cn('flex flex-col', groupIndex === 0 && '[&>div:first-child]:mt-0')}>
                          <DaySeparator heading={group.heading} />
                          {group.messages.map((message, index) => (
                            <MessageBubble
                              key={message.id}
                              message={message}
                              senderName={companyName}
                              {...runPosition(group.messages, index)}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mx-auto w-full max-w-4xl lg:px-4">
              <MessageComposer onSend={send} isSending={isSending} sendError={sendError} disabled={isLoading} />
            </div>
          </>
        )}
      </main>

      {/* ── right: the company ──────────────────────────────────────────── */}
      <CompanyContext companyName={companyName} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex h-6 items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-pv-muted-fg/80">{title}</p>
      </div>
      {children}
    </div>
  );
}

function ContactRow({ label, icon: Icon, value, href }: { label: string; icon: typeof Mail; value: string | null; href?: string }) {
  const content = (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <Icon aria-hidden className="size-3 shrink-0 text-pv-muted-fg" />
      <span className={cn('truncate', value ? '' : 'text-pv-muted-fg')}>{value || 'None on file'}</span>
    </span>
  );
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-[12px] text-pv-muted-fg">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] text-pv-fg">
        {value && href ? (
          <a href={href} className="hover:underline">
            {content}
          </a>
        ) : (
          content
        )}
      </span>
    </div>
  );
}

/**
 * The operator's right column (customer-context.tsx), facing the other way: who
 * the customer is talking to and how else to reach them, and the rental the
 * conversation is most likely about. Goes first as the window narrows, as
 * there: everything on it also lives elsewhere in the portal.
 */
function CompanyContext({ companyName }: { companyName: string }) {
  const { tenant } = useTenant();
  const { rentals, isLoading } = useCustomerRentals('all');
  const rental = useMemo(() => relevantRental(rentals), [rentals]);
  const email = tenant?.contact_email ?? null;
  const phone = tenant?.contact_phone ?? tenant?.phone ?? null;
  const status = rental ? customerRentalStatus(rental) : null;

  return (
    <aside className="hidden min-h-0 w-[292px] shrink-0 flex-col xl:flex">
      <div className="flex shrink-0 items-center gap-3 px-5 pb-5 pt-6">
        <CompanyAvatar name={companyName} className="size-11 text-[13px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-tight text-pv-fg">{companyName}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-pv-muted-fg">
            {isLoading ? ' ' : rentals.length === 0 ? 'No rentals yet' : `${rentals.length} ${rentals.length === 1 ? 'rental' : 'rentals'} with them`}
          </p>
        </div>
        <Link href="/contact" title="Contact page" aria-label="Contact page" className={ROUND_ICON}>
          <ExternalLink aria-hidden className="size-3.5" />
        </Link>
      </div>

      <div className={cn('flex min-h-0 flex-1 flex-col justify-between gap-6 overflow-y-auto px-5 pb-10 pt-1', NO_SCROLLBAR)}>
        <Section title="Contact">
          <div>
            <ContactRow label="Email" icon={Mail} value={email} href={email ? `mailto:${email}` : undefined} />
            <ContactRow label="Phone" icon={Phone} value={phone} href={phone ? `tel:${phone}` : undefined} />
            <ContactRow label="Usual channel" icon={Sparkles} value="In-app" />
          </div>
        </Section>

        <Section title="Rental">
          {isLoading ? (
            <div className="h-14 animate-pulse rounded-xl bg-pv-muted/70" />
          ) : !rental || !status ? (
            <p className="text-[12px] text-pv-muted-fg">No rentals with {companyName} yet.</p>
          ) : (
            <Link
              href={`/portal/rentals/${rental.id}`}
              className="-mx-2 block rounded-xl px-2 py-1.5 transition-colors duration-200 hover:bg-pv-hover"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-pv-fg">
                  <CarFront aria-hidden className="size-3.5 shrink-0 text-pv-muted-fg" />
                  <span className="truncate">{rental.vehicle?.displayName ?? 'Vehicle'}</span>
                </span>
                <span className={cn('shrink-0 text-[11px] font-medium', V2_LIST_TONES[RENTAL_STATUS_TONE[status] ?? 'muted'])}>
                  {status}
                </span>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-pv-muted-fg">
                <CalendarDays aria-hidden className="size-3 shrink-0" />
                <span className="truncate">
                  {rental.reference} · {formatBookingDates(rental.startDate, rental.endDate)}
                </span>
              </p>
            </Link>
          )}
        </Section>
      </div>
    </aside>
  );
}
