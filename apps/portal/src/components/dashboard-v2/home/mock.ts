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
