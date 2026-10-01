'use client';

/**
 * Requests — the second card under the revenue chart (Sep 27 2026).
 *
 * Who is waiting on the operator, from the customer's side: a booking that
 * needs approving, an extension asked for, a cancellation asked for. Messages
 * are deliberately not here; they have their own tab. The lean set, as agreed
 * with Ghulam — see `useCustomerRequests` for exactly where each comes from.
 *
 * The shape of it (Ghulam, Sep 27 2026):
 *  - every request, newest first, scrolling inside the card; the expand icon
 *    at the top right opens them all, grouped, in a larger dialog
 *  - each row: the customer's own photo, or their first initial on a colour
 *    the way Google does it; their name; what they want in plain words; the
 *    kind as a quiet tinted tag; and how long they have been waiting
 *  - rows hover in the app's accent highlight, as a gradient
 *  - the card sits on the app's own page wash, a soft glow from the top-left
 *    corner, rather than flat white or solid accent
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { differenceInCalendarDays, format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { ArrowRight, Check, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCustomerRequests, type CustomerRequest, type RequestKind } from '@/hooks/use-customer-requests';
import { Eyebrow } from './ui';
import { useAuth } from '@/stores/auth-store';
import { buildDemoRequests } from './mock';
import { ExpandButton } from './expand-button';
import { PHONE_SHEET, SheetGrabber } from './phone-sheet';
import { CardGrip } from './sortable-cards';
import { AutoSkeleton } from '@/components/skeleton-v2/auto-skeleton';
import { useSkeletonLoading } from '@/hooks/use-skeleton-loading';
import { skeletonRows } from '@/lib/skeleton-data';

/** Placeholder requests for the skeleton: only their lengths are ever seen. */
const SKELETON_REQUESTS: CustomerRequest[] = skeletonRows(6, (f) => ({
  id: f.id,
  kind: f.pick(['booking', 'extension', 'cancellation'] as const),
  customerId: null,
  customerName: f.text(2, 2),
  photoUrl: null,
  vehicleName: f.text(2, 3),
  at: f.date(f.int(0, 3)),
  from: f.date(-2),
  to: f.date(-6),
  href: '',
}));

/** The kind tag: a quiet tint with its own ink. */
const KIND: Record<RequestKind, { label: string; ink: string; tint: string }> = {
  booking: { label: 'Booking', ink: 'var(--pv-accent-ink)', tint: 'var(--pv-accent-bg)' },
  extension: { label: 'Extension', ink: 'var(--pv-wait)', tint: 'var(--pv-wait-bg)' },
  cancellation: { label: 'Cancellation', ink: 'var(--pv-late)', tint: 'var(--pv-late-bg)' },
};

/**
 * The app's page wash (`.bg-app-gradient` in styles/v2-theme.css), anchored on
 * the card's top-left corner and toned down to card size.
 */
const CARD_WASH =
  'radial-gradient(120% 90% at -8% -10%, hsl(var(--chart-3) / 0.14), transparent 60%), ' +
  'radial-gradient(90% 70% at 110% -10%, hsl(var(--v2-wash) / 0.10), transparent 60%)';

/** Google-style initial colours: distinct, mid-tone, a white letter on each. */
const INITIAL_COLOURS = ['#5b5bd6', '#12a594', '#e5484d', '#f76b15', '#0090ff', '#8e4ec6', '#30a46c', '#d6409f'];

const day = (d: string | null | undefined) => (d ? format(parseISO(d), 'EEE d MMM') : null);

function colourFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return INITIAL_COLOURS[h % INITIAL_COLOURS.length];
}

/** Their own photo, or their first initial on a colour. */
function Avatar({ r, size = 36 }: { r: CustomerRequest; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (r.photoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={r.photoUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      // One round bone under a loading AutoSkeleton, not a coloured disc with a bar on it.
      data-skeleton-block=""
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: colourFor(r.customerId ?? r.customerName) }}
    >
      {(r.customerName.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

/** What they want, in plain words. */
function ask(r: CustomerRequest): string {
  if (r.kind === 'booking') {
    const dates = r.from && r.to ? ` · ${day(r.from)} – ${day(r.to)}` : '';
    return `Wants the ${r.vehicleName}${dates}`;
  }
  if (r.kind === 'extension') {
    return r.to ? `Keep the ${r.vehicleName} until ${day(r.to)}` : `Keep the ${r.vehicleName} for longer`;
  }
  return r.reason ? `Cancel the ${r.vehicleName} · “${r.reason}”` : `Cancel the ${r.vehicleName}`;
}

function waited(at: string | null): string | null {
  if (!at) return null;
  try {
    return formatDistanceToNowStrict(parseISO(at), { roundingMethod: 'floor' })
      .replace(/ seconds?/, 's')
      .replace(/ minutes?/, 'm')
      .replace(/ hours?/, 'h')
      .replace(/ days?/, 'd')
      .replace(/ months?/, 'mo')
      .replace(/ years?/, 'y');
  } catch {
    return null;
  }
}

function RequestRow({ r, onOpen }: { r: CustomerRequest; onOpen: () => void }) {
  const k = KIND[r.kind];
  return (
    <li className="flex h-[58px]">
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-gradient-to-r hover:from-[var(--pv-accent-bg)] hover:to-transparent"
      >
        <Avatar r={r} size={38} />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold leading-tight text-[var(--pv-ink)] transition-colors group-hover:text-[var(--pv-accent-ink)]">
              {r.customerName}
            </span>
            <span
              className="shrink-0 rounded-full px-1.5 text-[9.5px] font-medium leading-[15px]"
              style={{ background: k.tint, color: k.ink }}
            >
              {k.label}
            </span>
          </span>
          <span className="mt-1 block truncate text-[12px] leading-tight text-[var(--pv-ink-3)]">{ask(r)}</span>
        </span>

        <span className="relative flex w-10 shrink-0 justify-end">
          <span className="text-[11px] tabular-nums text-[var(--pv-ink-3)] transition-opacity group-hover:opacity-0">
            {waited(r.at)}
          </span>
          <ArrowRight
            className="absolute right-0 top-1/2 size-3.5 -translate-y-1/2 text-[var(--pv-accent-ink)] opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
            aria-hidden
          />
        </span>
      </button>
    </li>
  );
}

/** The detail line for the dialog, where there is room to say more. */
function detail(r: CustomerRequest): string {
  if (r.kind === 'booking' && r.from && r.to) {
    const nights = Math.max(1, differenceInCalendarDays(parseISO(r.to), parseISO(r.from)));
    return `${r.vehicleName} · ${day(r.from)} – ${day(r.to)} · ${nights} ${nights === 1 ? 'day' : 'days'}`;
  }
  if (r.kind === 'extension' && r.to) {
    const extra = r.from ? differenceInCalendarDays(parseISO(r.to), parseISO(r.from)) : 0;
    return `${r.vehicleName} · ${r.from ? `due back ${day(r.from)}, ` : ''}wants until ${day(r.to)}${extra > 0 ? ` (+${extra} ${extra === 1 ? 'day' : 'days'})` : ''}`;
  }
  if (r.kind === 'cancellation') {
    return `${r.vehicleName} · ${r.reason ? `“${r.reason}”` : 'No reason given'}`;
  }
  return ask(r);
}

/**
 * A row in the "See all" dialog: more room, so more detail and a clear action.
 * The row opens the request; the ✕ beside it takes it off this list (a
 * sibling, not nested — a button inside a button is invalid).
 */
function DialogRow({
  r,
  index = 0,
  onOpen,
  onRemove,
}: {
  r: CustomerRequest;
  /** Position in its list, for the staggered entrance. */
  index?: number;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const k = KIND[r.kind];
  return (
    <li
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
      className="group flex animate-in items-center gap-2 rounded-xl pr-2 transition-colors fade-in-0 slide-in-from-bottom-3 duration-200 ease-out fill-mode-both hover:bg-gradient-to-r hover:from-[var(--pv-accent-bg)] hover:to-transparent motion-reduce:animate-none"
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-4 px-3 py-2.5 text-left">
        <Avatar r={r} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-[var(--pv-ink)] transition-colors group-hover:text-[var(--pv-accent-ink)]">
              {r.customerName}
            </span>
            <span className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium" style={{ background: k.tint, color: k.ink }}>
              {k.label}
            </span>
          </span>
          <span className="block truncate text-[12.5px] text-[var(--pv-ink-3)]">{detail(r)}</span>
        </span>
        <span className="w-12 shrink-0 text-right text-[11.5px] tabular-nums text-[var(--pv-ink-3)]">{waited(r.at)}</span>
        <span className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--pv-line)] bg-[var(--pv-paper)] px-2.5 py-1 text-[12px] font-medium text-[var(--pv-ink-2)] transition-colors group-hover:border-[var(--pv-accent-30)] group-hover:text-[var(--pv-accent-ink)]">
          Review
          <ArrowRight className="size-3.5" aria-hidden />
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${r.customerName}'s ${k.label.toLowerCase()} request from this list`}
        title="Remove from list"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--pv-ink-3)] transition-colors hover:bg-[var(--pv-late-bg)] hover:text-[var(--pv-late)]"
      >
        <X className="size-4" strokeWidth={2.25} />
      </button>
    </li>
  );
}

/** Newest first, whatever the kind — the order the card always shows. */
const newestFirst = (list: CustomerRequest[]) => [...list].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));

export function RequestsCard() {
  const router = useRouter();
  const live = useCustomerRequests();
  // PREVIEW (Sep 27 2026): a sample set — a dozen made-up requests of every
  // kind, most with a portrait — is ON BY DEFAULT while the design is
  // reviewed; `?demo-requests=0` shows the tenant's real requests. Client-side
  // only. Flip the default back (`=== '1'`) before this widens past the canary.
  const demo = useSearchParams()?.get('demo-requests') !== '0';
  const sample = useMemo(() => buildDemoRequests(), []);
  const isLoading = useSkeletonLoading(!demo && live.isLoading);
  const all = isLoading ? SKELETON_REQUESTS : demo ? sample : live.requests;

  // Requests the operator has taken off their list. Remembered per user in
  // this browser (a convenience: it hides a row, it does not decline or
  // cancel anything — the request itself is untouched and still on the
  // Pending bookings / rental pages).
  const { appUser } = useAuth();
  const hiddenKey = `dashboard-v2:hidden-requests:${appUser?.id ?? 'anon'}`;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setHidden(new Set(JSON.parse(localStorage.getItem(hiddenKey) || '[]') as string[]));
    } catch {
      /* storage unavailable — nothing hidden */
    }
  }, [hiddenKey]);
  const saveHidden = (next: Set<string>) => {
    setHidden(next);
    try {
      localStorage.setItem(hiddenKey, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };
  // Undo lives INSIDE the dialog: a modal dialog blocks clicks everywhere
  // else, so a toast's Undo button would be out of reach.
  const [lastRemoved, setLastRemoved] = useState<CustomerRequest | null>(null);
  useEffect(() => {
    if (!lastRemoved) return;
    const t = window.setTimeout(() => setLastRemoved(null), 6000);
    return () => window.clearTimeout(t);
  }, [lastRemoved]);
  const remove = (r: CustomerRequest) => {
    saveHidden(new Set([...hidden, r.id]));
    setLastRemoved(r);
  };
  const undo = () => {
    if (!lastRemoved) return;
    const next = new Set(hidden);
    next.delete(lastRemoved.id);
    saveHidden(next);
    setLastRemoved(null);
  };

  // The card: newest first, whatever the kind, without the removed ones.
  const requests = isLoading ? all : newestFirst(all.filter((r) => !hidden.has(r.id)));
  const [kindFilter, setKindFilter] = useState<RequestKind | 'all'>('all');
  const isError = !demo && live.isError;
  const [allOpen, setAllOpenRaw] = useState(false);
  const setAllOpen = (o: boolean) => {
    setAllOpenRaw(o);
    if (o) setKindFilter('all');
  };
  const open = (r: CustomerRequest) => {
    setAllOpen(false);
    // Sample rows are not real rentals; opening one would land on nothing.
    if (!r.id.startsWith('demo-')) router.push(r.href);
  };

  return (
    <div
      className="flex min-h-[387px] flex-col overflow-hidden rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] lg:min-h-0"
      style={{ backgroundImage: CARD_WASH }}
    >
      <header className="flex items-center justify-between gap-3 px-6 pt-4">
        <Eyebrow>Requests</Eyebrow>
        <span className="flex items-center gap-0.5">
          <CardGrip />
          {!isLoading && requests.length > 0 && <ExpandButton label="See all requests" onClick={() => setAllOpen(true)} />}
        </span>
      </header>

      {/* Every request, newest first; the list scrolls inside the card,
          with no fade at the edge. The expand icon opens them grouped. */}
      {/* A grid of one stretched cell, so the AutoSkeleton wrapper still gives
          the empty state its full height to centre in; a long list overflows
          the cell and scrolls here as before. */}
      <div
        className="relative mt-2 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-y-auto px-4 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <AutoSkeleton loading={isLoading} className="h-full">
        {isError ? (
          <p className="px-2 pt-1 text-[12px] text-[var(--pv-ink-3)]">Requests could not be loaded. They will try again in a moment.</p>
        ) : requests.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-[var(--pv-clear-bg)] text-[var(--pv-clear)]">
              <Check className="size-5" strokeWidth={2.5} />
            </span>
            <p className="text-[13px] font-medium text-[var(--pv-ink)]">All caught up</p>
            <p className="max-w-[230px] text-[11.5px] text-[var(--pv-ink-3)]">
              New bookings, extensions and cancellations will land here the moment a customer asks.
            </p>
          </div>
        ) : (
          // Every request on a desktop (the list scrolls); five on a phone, where
          // the card is not height-bound — the expand icon opens the rest.
          <ul className="max-md:[&>li:nth-child(n+6)]:hidden">
            {requests.map((r) => (
              <RequestRow key={r.id} r={r} onOpen={() => open(r)} />
            ))}
          </ul>
        )}
        </AutoSkeleton>
      </div>

      {/* Every request, grouped by kind. Portalled out of the card, so it
          carries `.pv` itself. */}
      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent className={`pv max-w-3xl gap-0 overflow-hidden p-0 ${PHONE_SHEET}`}>
          <SheetGrabber onClose={() => setAllOpen(false)} />
          <DialogHeader
            className="space-y-2 border-b border-[var(--pv-line)] px-7 pb-5 pt-6 text-left"
            style={{ backgroundImage: CARD_WASH }}
          >
            <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em] text-[var(--pv-ink)]">
              Requests
            </DialogTitle>
            <p className="text-[13px] text-[var(--pv-ink-3)]">
              {requests.length} {requests.length === 1 ? 'customer is' : 'customers are'} waiting on you.
            </p>
            {/* Filters, each with its count as a badge. */}
            {/* One soft segmented track (Sep 29 2026): the selected filter is a
                white chip with a hairline edge; each count is a small tinted
                badge in its kind's colour, solid only when selected. */}
            <div
              role="tablist"
              aria-label="Filter requests"
              className="mt-1 inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-full bg-[var(--pv-wash)] p-1"
            >
              {([['all', 'All', requests.length, 'var(--pv-ink)', 'var(--pv-line)'] as const, ...(Object.keys(KIND) as RequestKind[]).map(
                (kind) => [kind, `${KIND[kind].label}s`, requests.filter((r) => r.kind === kind).length, KIND[kind].ink, KIND[kind].tint] as const
              )]).map(([key, label, n, ink, tint]) => {
                const active = kindFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setKindFilter(key)}
                    className={
                      'flex items-center gap-2 rounded-full py-1.5 pl-3.5 pr-1.5 text-[12.5px] font-medium outline-none transition-all duration-200 ease-out focus-visible:ring-2 focus-visible:ring-[var(--pv-accent-30)] ' +
                      (active
                        ? 'bg-[var(--pv-paper)] text-[var(--pv-ink)] shadow-[0_0_0_1px_var(--pv-line)]'
                        : 'text-[var(--pv-ink-3)] hover:text-[var(--pv-ink)]')
                    }
                  >
                    {label}
                    {/* Layered, so selecting is a fade rather than a colour swap: the
                        soft tint is always underneath, the solid colour fades in
                        over it, and the number cross-fades to white. */}
                    <span
                      className="relative flex h-[18px] min-w-[18px] items-center justify-center overflow-hidden rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums"
                      style={{ background: tint }}
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full transition-[opacity,transform] duration-300 ease-out"
                        style={{ background: ink, opacity: active ? 1 : 0, transform: active ? 'scale(1)' : 'scale(0.6)' }}
                      />
                      <span className="relative transition-colors duration-300 ease-out" style={{ color: active ? '#fff' : ink }}>
                        {n}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto px-5 py-5">
          {/* Re-keyed on the filter, so switching pills replays the Trax
              panel's entrance (trax-panel.tsx): rise 12px and fade in over
              200ms ease-out — here with each row a beat after the last. */}
          <div key={kindFilter} className="space-y-6">
            {requests.length === 0 && (
              <p className="py-10 text-center text-[13px] text-[var(--pv-ink-3)]">Nothing on your list.</p>
            )}
            {(Object.keys(KIND) as RequestKind[])
              .filter((kind) => kindFilter === 'all' || kindFilter === kind)
              .map((kind) => {
                const group = requests.filter((r) => r.kind === kind);
                if (!group.length) {
                  return kindFilter === kind ? (
                    <p key={kind} className="py-10 text-center text-[13px] text-[var(--pv-ink-3)]">
                      No {KIND[kind].label.toLowerCase()} requests.
                    </p>
                  ) : null;
                }
                return (
                  <section key={kind}>
                    {kindFilter === 'all' && (
                      <h3 className="mb-1.5 flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--pv-ink-3)]">
                        {KIND[kind].label} requests
                        <span className="tabular-nums">{group.length}</span>
                      </h3>
                    )}
                    <ul className="space-y-0.5">
                      {group.map((r, i) => (
                        <DialogRow key={r.id} r={r} index={i} onOpen={() => open(r)} onRemove={() => remove(r)} />
                      ))}
                    </ul>
                  </section>
                );
              })}
          </div>
          </div>

          {/* Undo, for the last request taken off the list. */}
          {lastRemoved && (
            <div className="flex animate-in items-center justify-between gap-3 border-t border-[var(--pv-line)] bg-[var(--pv-wash)] px-6 py-3 text-[12.5px] fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none">
              <span className="min-w-0 truncate text-[var(--pv-ink-2)]">
                Removed {lastRemoved.customerName}&rsquo;s {KIND[lastRemoved.kind].label.toLowerCase()} request from your list.
              </span>
              <button
                type="button"
                onClick={undo}
                className="shrink-0 rounded-lg px-2.5 py-1 font-semibold text-[var(--pv-accent-ink)] transition-colors hover:bg-[var(--pv-accent-bg)]"
              >
                Undo
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
