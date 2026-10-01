/**
 * Mock data for the dashboard preview. Nothing here touches the database — the
 * point is to see every item on the content plan standing up, in every state it
 * can be in, before any of it gets wired to a real query.
 *
 * Grouped to match the three bands on screen: Important (what you must know),
 * Today (what happens between now and closing), Stats (how it is going).
 *
 * "Now" is frozen at 09:14 so the board is deterministic: a live clock would
 * make the NOW divider drift between the server render and the client, and the
 * page would look different every time it is opened.
 */

import type { DayEvent } from '@/hooks/use-day-timeline';
import type { CustomerRequest } from '@/hooks/use-customer-requests';
import type { TenantNote } from '@/hooks/use-tenant-notes';
import { busyWindowStart, type BusyDays, type BookingSources } from '@/hooks/use-dashboard-insights';

export const NOW_MINUTES = 9 * 60 + 14;
export const NOW_LABEL = '09:14';

/** How a row is doing. Reserved — these never get reused as chart colours. */
export type State = 'late' | 'waiting' | 'ready' | 'clear' | 'idle';

export interface WorkItem {
  id: string;
  label: string;
  /** The secondary line — who, or which one, or why. */
  meta?: string;
  /**
   * Right-hand clock column: a time today, or how long it has been waiting.
   * Optional — some items genuinely have no age to report, and an invented one
   * would be worse than none.
   */
  clock?: string;
  state: State;
  /** Money, where the row is about money. */
  amount?: string;
}

// ─── Band 1 · Important ──────────────────────────────────────────────────────

export const ATTENTION: WorkItem[] = [
  {
    id: 'a1',
    label: 'Agreement unsigned',
    meta: 'Michael Rattray picks up at 09:30',
    clock: '16m',
    state: 'late',
  },
  {
    id: 'a2',
    label: '2 vehicles not returned',
    meta: 'Worst is 22 days out, no contact',
    clock: '22d',
    state: 'late',
  },
  {
    id: 'a3',
    label: '2 cards declined',
    meta: 'Giovante Marsh, Sara Whitlock',
    clock: '6h',
    state: 'late',
    amount: '$480',
  },
  {
    id: 'a4',
    label: 'Bonzah balance low',
    meta: 'Covers about 6 more rentals',
    clock: '$84',
    state: 'late',
  },
  {
    id: 'a5',
    label: '1 verification stuck',
    meta: 'Veriff — document unreadable',
    clock: '2d',
    state: 'waiting',
  },
];

export interface Todo {
  id: string;
  text: string;
  /** Who it is about, where that is the useful context. */
  meta?: string;
  done: boolean;
  /** Set when the note is pinned to a date. */
  due?: string;
}

export const TODOS: Todo[] = [
  { id: 't1', text: 'Call Kris about extending the S60', meta: 'He asked on Friday', done: false, due: 'Today' },
  { id: 't2', text: 'Order two front tyres — LR21 KXZ', done: false, due: 'Today' },
  { id: 't3', text: 'Chase Avery Coleman’s refund', meta: '$150 collected, no policy', done: false, due: 'Tue' },
  { id: 't4', text: 'Send Bonzah the updated fleet list', done: true },
  { id: 't5', text: 'Reprice the Fiesta for August', done: true },
];

// ─── Band 2 · Today ──────────────────────────────────────────────────────────

export interface Movement {
  id: string;
  /** Minutes past midnight — drives where the NOW divider falls. */
  at: number;
  time: string;
  direction: 'out' | 'back';
  customer: string;
  vehicle: string;
  /** The one thing standing in the way, if anything. */
  flag?: string;
  state: State;
  mode?: 'desk' | 'delivery' | 'lockbox';
}

/** One list, both directions — the day runs in time order, not in two queues. */
export const FLOW: Movement[] = [
  {
    id: 'f1',
    at: 9 * 60 + 30,
    time: '09:30',
    direction: 'out',
    customer: 'Michael Rattray',
    vehicle: 'VW Golf R',
    flag: 'Unsigned',
    state: 'late',
    mode: 'desk',
  },
  {
    id: 'f2',
    at: 10 * 60,
    time: '10:00',
    direction: 'back',
    customer: 'Giovante Marsh',
    vehicle: 'Tesla Model Y',
    state: 'ready',
  },
  {
    id: 'f3',
    at: 11 * 60 + 15,
    time: '11:15',
    direction: 'out',
    customer: 'Iniko Dubone',
    vehicle: 'Tesla Model 3',
    flag: 'Deliver',
    state: 'ready',
    mode: 'delivery',
  },
  {
    id: 'f4',
    at: 13 * 60 + 45,
    time: '13:45',
    direction: 'back',
    customer: 'Sara Whitlock',
    vehicle: 'BMW 1 Series',
    state: 'ready',
  },
  {
    id: 'f5',
    at: 14 * 60,
    time: '14:00',
    direction: 'out',
    customer: 'Kris Bell',
    vehicle: 'Volvo S60',
    flag: 'Code sent',
    state: 'clear',
    mode: 'lockbox',
  },
  {
    id: 'f6',
    at: 16 * 60 + 30,
    time: '16:30',
    direction: 'out',
    customer: 'Avery Coleman',
    vehicle: 'Ford Fiesta',
    flag: 'ID pending',
    state: 'waiting',
    mode: 'desk',
  },
  {
    id: 'f7',
    at: 17 * 60,
    time: '17:00',
    direction: 'back',
    customer: 'Dan Reyes',
    vehicle: 'Audi A3',
    flag: 'May extend',
    state: 'waiting',
  },
];

export const MONEY_TODAY: WorkItem[] = [
  { id: 'd1', label: 'Due today', meta: '3 customers', clock: 'Today', state: 'waiting', amount: '$1,240' },
  { id: 'd2', label: 'Holds expiring today', meta: '3 of 14 deposits', clock: '41h', state: 'late', amount: '$900' },
  { id: 'd3', label: 'Deposits to take', meta: '2 pickups need a hold', clock: '09:30', state: 'waiting', amount: '$1,500' },
  { id: 'd4', label: 'Collected so far', meta: '4 payments cleared', clock: '08:40', state: 'clear', amount: '$860' },
  { id: 'd5', label: 'Refund to issue', meta: 'Avery Coleman', clock: '1d', state: 'waiting', amount: '$150' },
];

export const ELSE_TODAY: WorkItem[] = [
  { id: 'e1', label: '1 delivery', meta: '44 Bourbon St — 20 min drive', clock: '11:15', state: 'waiting' },
  { id: 'e2', label: '1 lockbox handover', meta: 'Code already sent to Kris', clock: '14:00', state: 'clear' },
  { id: 'e3', label: 'MOT booked', meta: 'VW Golf R at Kwik Fit', clock: '15:00', state: 'waiting' },
  { id: 'e4', label: '4 unread messages', meta: 'Kris Bell, +3 others', clock: '2h', state: 'waiting' },
  { id: 'e5', label: '3 booking requests', meta: 'Oldest from Priya Raman', clock: '4h', state: 'waiting' },
  { id: 'e6', label: 'Open until 17:00', meta: '2 staff on shift', clock: '7h', state: 'clear' },
];

// ─── Band 3 · Stats ──────────────────────────────────────────────────────────

/** Fourteen days, most recent last. */
export const BOOKINGS_SERIES = [6, 4, 7, 9, 5, 8, 11, 9, 12, 10, 14, 13, 16, 15];
export const REVENUE_SERIES = [1820, 1400, 2100, 2650, 1900, 2300, 3050, 2700, 3400, 2900, 3900, 3600, 4300, 4150];

export const TOP_CUSTOMERS = [
  { name: 'Giovante Marsh', rentals: 14, value: '$8,240' },
  { name: 'Kris Bell', rentals: 11, value: '$6,910' },
  { name: 'Iniko Dubone', rentals: 9, value: '$5,480' },
];

export const TOP_VEHICLES = [
  { name: 'Tesla Model 3', days: 26 },
  { name: 'VW Golf R', days: 23 },
  { name: 'Volvo S60', days: 19 },
];

/**
 * Categorical — validated with the dataviz palette script (all six checks pass,
 * worst adjacent CVD ΔE 14.2). These three carry identity only and are never
 * used for state.
 */
export const SOURCE_MIX = [
  { label: 'Website', share: 62, color: '#5b5bd6' },
  { label: 'Phone', share: 27, color: '#12a594' },
  { label: 'Walk-in', share: 11, color: '#e8590c' },
];

export const RATIOS = [
  { label: 'Inquiry → booking', value: '38%', delta: 4 },
  { label: 'Cancellations', value: '6.2%', delta: -1.1 },
  { label: 'Repeat customers', value: '41%', delta: 3 },
  { label: 'Fleet on rent', value: '64%', delta: 5 },
];

// ── Demo day, for previewing the day timeline (`?demo-day=1`) ───────────────
// Client-side only: nothing is read from or written to the database. Times are
// laid out around NOW so the past (done / missed) and the future (upcoming)
// both show, plus clusters that force chips into extra lanes and a few events
// with no time set.

export function buildDemoDay(now: number): DayEvent[] {
  const at = (offset: number) => Math.min(23 * 60 + 45, Math.max(0, now + offset));
  const e = (
    id: string,
    kind: DayEvent['kind'],
    offset: number | null,
    title: string,
    subject: string,
    state: DayEvent['state'],
    note?: string,
  ): DayEvent => ({
    id: `demo-${id}`,
    kind,
    at: offset === null ? null : at(offset),
    title,
    subject,
    state,
    note,
    rentalId: null,
  });

  return [
    // Morning — mostly done, two missed.
    e('1', 'extension_charge', -305, 'Extension charge', 'Kris Bell · Tesla Model Y', 'done', 'Charged'),
    e('2', 'payment_reminder', -290, 'Payment reminder', 'Iniko Dubone · VW Golf R', 'done', 'Sent by SMS'),
    e('3', 'payment_reminder', -284, 'Payment reminder', 'Camille Duval · Volvo S60', 'missed', 'Failed to send'),
    e('4', 'return_reminder', -265, 'Return reminder', 'Giovante Marsh · Tesla Model 3', 'done', 'Sent'),
    e('5', 'pickup', -240, 'Car out', 'Sam Lee · Toyota Camry', 'done', 'Handed over'),
    e('6', 'lockbox', -236, 'Lockbox code', 'Sam Lee · Toyota Camry', 'done', 'Sent'),
    e('7', 'return', -195, 'Car back', 'Priya Nair · Honda Civic', 'done', 'Returned'),
    e('8', 'pickup', -150, 'Car out', 'Marco Rossi · BMW 3 Series', 'missed', 'Not handed over'),
    e('9', 'installment', -120, 'Installment', 'Ava Chen · Kia Sportage', 'done', 'Collected'),
    e('10', 'extension_charge', -70, 'Extension charge', 'Liam Walsh · Ford Mustang', 'missed', 'Not taken'),
    e('11', 'return', -35, 'Car back', 'Noah Kim · Tesla Model 3', 'missed', 'Not back yet'),
    // Around now — a tight cluster, to stack lanes.
    e('12', 'pickup', 15, 'Car out', 'Emma Stone · Audi Q5', 'upcoming'),
    e('13', 'return', 20, 'Car back', 'Olivia Brown · Mazda CX-5', 'upcoming'),
    e('14', 'lockbox', 25, 'Lockbox code', 'Emma Stone · Audi Q5', 'upcoming'),
    e('15', 'payment_reminder', 30, 'Payment reminder', 'Ethan Park · Nissan Rogue', 'upcoming'),
    // Afternoon and evening.
    e('16', 'extension_charge', 120, 'Extension charge', 'Mia Lopez · Jeep Wrangler', 'upcoming'),
    e('17', 'pickup', 180, 'Car out', 'James Hill · Tesla Model S', 'upcoming'),
    e('18', 'return', 240, 'Car back', 'Sofia Reyes · Hyundai Tucson', 'upcoming'),
    e('19', 'return_reminder', 270, 'Return reminder', 'Lucas Grey · Subaru Outback', 'upcoming'),
    e('20', 'return', 330, 'Car back', 'Lucas Grey · Subaru Outback', 'upcoming'),
    // No time set.
    e('21', 'installment', null, 'Installment', 'Chloe Adams · Toyota RAV4', 'upcoming', 'Due today'),
    e('22', 'pickup', null, 'Car out', 'Daniel Ortiz · Chevy Malibu', 'upcoming'),
    e('23', 'return', null, 'Car back', 'Grace Liu · Honda CR-V', 'upcoming'),
  ].sort((a, b) => (a.at ?? -1) - (b.at ?? -1));
}

// ── Sample requests, for previewing the Requests card (default; `?demo-requests=0` = real) ──
// Client-side only: nothing is read from or written to the database. Made-up
// people, so stock portraits are fine here — never on a real tenant's customers.

export function buildDemoRequests(now: Date = new Date()): CustomerRequest[] {
  const ago = (mins: number) => new Date(now.getTime() - mins * 60_000).toISOString();
  const inDays = (d: number) => {
    const x = new Date(now);
    x.setDate(x.getDate() + d);
    return x.toISOString().slice(0, 10);
  };
  const face = (set: 'men' | 'women', n: number) => `https://randomuser.me/api/portraits/${set}/${n}.jpg`;
  const r = (
    id: string,
    kind: CustomerRequest['kind'],
    customerName: string,
    photoUrl: string | null,
    vehicleName: string,
    minsAgo: number,
    extra: Partial<CustomerRequest> = {},
  ): CustomerRequest => ({
    id: `demo-${id}`,
    kind,
    customerId: `demo-customer-${id}`,
    customerName,
    photoUrl,
    vehicleName,
    at: ago(minsAgo),
    href: kind === 'booking' ? '/pending-bookings' : '/rentals',
    ...extra,
  });

  return [
    r('1', 'booking', 'Sophia Martinez', face('women', 44), 'Tesla Model Y', 12, { from: inDays(2), to: inDays(6) }),
    r('2', 'extension', 'James Carter', face('men', 32), 'BMW 3 Series', 38, { from: inDays(0), to: inDays(4) }),
    r('3', 'cancellation', 'Aisha Rahman', face('women', 68), 'Audi Q5', 95, { reason: 'Flight got cancelled' }),
    r('4', 'booking', 'Daniel Okafor', face('men', 75), 'Jeep Wrangler', 140, { from: inDays(5), to: inDays(12) }),
    r('5', 'extension', 'Priya Nair', null, 'Honda Civic', 210, { from: inDays(1), to: inDays(3) }),
    r('6', 'booking', 'Lucas Grey', face('men', 12), 'Ford Mustang', 320, { from: inDays(9), to: inDays(11) }),
    r('7', 'cancellation', 'Emma Stone', face('women', 21), 'Mazda CX-5', 460, { reason: 'Found a closer pickup' }),
    r('8', 'extension', 'Noah Kim', null, 'Tesla Model 3', 600, { from: inDays(0), to: inDays(7) }),
    r('9', 'booking', 'Olivia Brown', face('women', 90), 'Hyundai Tucson', 900, { from: inDays(3), to: inDays(5) }),
    r('10', 'extension', 'Marco Rossi', face('men', 51), 'Kia Sportage', 1440, { from: inDays(1), to: inDays(8) }),
    r('11', 'cancellation', 'Chloe Adams', null, 'Toyota RAV4', 2100, {}),
    r('12', 'extension', 'Ethan Park', face('men', 7), 'Nissan Rogue', 3000, { from: inDays(2), to: inDays(5) }),
  ];
}

// ── Sample to-dos, for previewing the To do card (default; `?demo-todos=0` = real) ──
// Client-side only: ticks, deletes and adds change this list in memory and
// never reach `tenant_notes`.

export function buildDemoTodos(now: Date = new Date()): TenantNote[] {
  const at = (mins: number) => new Date(now.getTime() + mins * 60_000).toISOString();
  const dayAt = (days: number, h: number, m = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const n = (id: string, body: string, remind_at: string | null, is_done = false): TenantNote => ({
    id: `demo-todo-${id}`,
    body,
    remind_at,
    is_done,
    completed_at: is_done ? at(-30) : null,
    created_at: at(-600 + Number(id)),
  });
  return [
    n('1', 'Call Camille about the Volvo, 18 days late', at(-150)),
    n('2', 'Chase the $1,240 payment from Marco Rossi', at(-40)),
    n('3', 'Check the Tesla Model 3 in for Olivia at 2:30', at(75)),
    n('4', 'Get the Jeep washed before the weekend booking', at(210)),
    n('5', 'Renew insurance on the Ford Mustang', dayAt(1, 9, 30)),
    n('6', 'Send new-season prices to repeat customers', dayAt(6, 10)),
    n('7', 'Order a spare key for the Honda Civic', null),
    n('8', 'Reply to the Google review from last week', null),
    n('9', 'Book the Kia Sportage in for a service', null),
    n('10', 'Approve Sophia Martinez’s Tesla booking', null, true),
    n('11', 'Top up the lockbox codes for Friday', null, true),
  ];
}

// ── Sample busy days and booking sources (default; `?demo-insights=0` = real) ──
// Client-side only. A believable season: weekends busier than midweek, a
// build-up through the three months, a couple of standout peaks.

export function buildDemoBusyDays(now: Date = new Date()): BusyDays {
  const fleet = 18;
  const today = now.toISOString().slice(0, 10);
  const from = busyWindowStart(now);
  const days: BusyDays['days'] = [];
  let i = 0;
  for (const d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())); ; d.setUTCDate(d.getUTCDate() + 1), i++) {
    const key = d.toISOString().slice(0, 10);
    if (key > today) break;
    const dow = d.getUTCDay();
    const weekend = dow === 5 || dow === 6 || dow === 0 ? 0.22 : 0;
    const season = 0.3 + (i / 92) * 0.25;
    const wobble = (((i * 7919) % 13) / 13 - 0.5) * 0.28;
    const peak = i % 31 === 12 || i % 29 === 20 ? 0.25 : 0;
    const share = Math.min(1, Math.max(0.05, season + weekend + wobble + peak));
    days.push({ date: key, rented: Math.round(share * fleet) });
  }
  return { days, fleet, today };
}

export function buildDemoBookingSources(): BookingSources {
  return { counts: { website: 46, team: 31, turo: 18 }, days: 90 };
}
