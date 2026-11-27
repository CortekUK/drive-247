import { supabase } from '@/lib/supabase';

// The generated types do not know these tables and functions yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as any;

export type Status = 'booked' | 'completed' | 'missed' | 'cancelled';
export type State = Status | 'waiting';
export type Window = [string, string];
export type View = 'upcoming' | 'today' | 'needs_marking' | 'done' | 'missed' | 'cancelled' | 'all';
export type Tab = 'bookings' | 'week' | 'availability';

export interface CallRow {
  id: string;
  tenant_id: string;
  company_name: string | null;
  slug: string | null;
  name: string;
  email: string;
  phone: string | null;
  starts_at: string;
  ends_at: string;
  host_timezone: string;
  customer_timezone: string | null;
  status: Status;
  state: State;
  cancelled_by: 'operator' | 'admin' | 'system' | null;
  cancel_reason: string | null;
  booked_via: 'portal' | 'admin';
  admin_notes: string | null;
  created_at?: string;
}

export interface HistoryRow {
  kind: 'booked' | 'moved' | 'cancelled' | 'completed' | 'missed' | 'reopened';
  actor: 'operator' | 'admin' | 'system';
  actor_name: string | null;
  from_starts_at: string | null;
  to_starts_at: string | null;
  reason: string | null;
  created_at: string;
}

export interface CallDetail extends CallRow {
  notes: string | null;
  meeting_url: string | null;
  history: HistoryRow[];
}

export interface Settings {
  host_name: string;
  host_title: string;
  host_email: string | null;
  host_photo_url: string | null;
  meeting_url: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  timezone: string;
  weekly_hours: Record<string, Window[]>;
  blocked_dates: string[];
  min_notice_hours: number;
  max_days_ahead: number;
  is_accepting: boolean;
}

export interface Block {
  starts_at: string;
  ends_at: string;
  label: string | null;
}

export const VIEWS: { id: View; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'today', label: 'Today' },
  { id: 'needs_marking', label: 'Needs marking' },
  { id: 'done', label: 'Done' },
  { id: 'missed', label: 'Missed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
];

export const STATE_STYLE: Record<State, { label: string; className: string }> = {
  booked: { label: 'Booked', className: 'text-indigo-600 dark:text-indigo-400' },
  waiting: { label: 'Waiting to be marked', className: 'text-amber-600 dark:text-amber-400' },
  completed: { label: 'Done', className: 'text-green-600 dark:text-green-400' },
  missed: { label: 'Missed', className: 'text-red-600 dark:text-red-400' },
  cancelled: { label: 'Cancelled', className: 'text-muted-foreground' },
};

export const WHO: Record<'operator' | 'admin' | 'system', string> = {
  operator: 'company',
  admin: 'Bryan',
  system: 'system',
};

/** Sends any emails the last action queued. Fire and forget: the mailer may not be deployed yet. */
export function flushMailer() {
  try {
    void Promise.resolve(supabase.functions.invoke('onboarding-call-mailer', { body: { flush: true } })).catch(() => undefined);
  } catch {
    // ignore
  }
}

/** The error text the database functions write for people. */
export function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return 'Something went wrong. Please try again.';
}
