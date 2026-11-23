'use client';

/**
 * Call Calendar — Bryan's own booking calendar for the free onboarding call
 * (23 Nov 2026). It replaces the GoHighLevel calendar the portal embedded.
 *
 *   Bookings      who has booked, grouped by day in Bryan's time zone; mark a
 *                 call done or missed, cancel it, add a note
 *   Availability  his weekly hours, call length, gap between calls, time zone,
 *                 how much notice and how far ahead, days off, the call link,
 *                 and a switch to stop taking calls
 *
 * Data: `onboarding_call_settings` (one row) and `onboarding_call_bookings`
 * (supabase/migrations/20261123180000_onboarding_call_calendar.sql). Super
 * admins read both and update the settings directly; a booking's status goes
 * through `admin_set_onboarding_call_booking`, which also updates the
 * company's row in the Onboarding calls tracker (Customer management).
 *
 * Companies book from the portal (`onboarding-call-booking.tsx`); the server
 * checks every booking against these settings.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, Check, Loader2, Plus, RefreshCw, StickyNote, Trash2, X } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { confirmDialog, promptDialog } from '@/components/ui/confirm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PAGE_DESCRIPTION } from '@/components/admin/header-buttons';
import { cn } from '@/lib/utils';

// The generated types do not know these tables yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Status = 'booked' | 'completed' | 'missed' | 'cancelled';
type Window = [string, string];

interface Booking {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  phone: string | null;
  notes: string | null;
  starts_at: string;
  ends_at: string;
  status: Status;
  admin_notes: string | null;
  cancelled_by: string | null;
  created_at: string;
  tenants: { company_name: string | null; slug: string } | null;
}

interface Settings {
  host_name: string;
  host_title: string;
  host_email: string | null;
  meeting_url: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  timezone: string;
  weekly_hours: Record<string, Window[]>;
  blocked_dates: string[];
  min_notice_hours: number;
  max_days_ahead: number;
  is_accepting: boolean;
  updated_at: string;
}

const DAY = 86_400_000;
/** Monday first, as Bryan reads a week. Keys are JS days ("0" = Sunday). */
const WEEK: { key: string; label: string }[] = [
  { key: '1', label: 'Monday' },
  { key: '2', label: 'Tuesday' },
  { key: '3', label: 'Wednesday' },
  { key: '4', label: 'Thursday' },
  { key: '5', label: 'Friday' },
  { key: '6', label: 'Saturday' },
  { key: '0', label: 'Sunday' },
];
const LENGTHS = [15, 20, 30, 45, 60, 90];
const BUFFERS = [0, 5, 10, 15, 30];
const FALLBACK_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/London',
  'Asia/Dubai',
  'Asia/Karachi',
  'UTC',
];

function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const all = intl.supportedValuesOf?.('timeZone');
    if (all && all.length) return all;
  } catch {
    /* older browser: the short list */
  }
  return FALLBACK_ZONES;
}

/** "yyyy-mm-dd" for an instant, in a time zone. */
const dayKey = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const timeOf = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const dayLabel = (key: string, tz: string) => {
  const today = dayKey(new Date().toISOString(), tz);
  const tomorrow = dayKey(new Date(Date.now() + DAY).toISOString(), tz);
  if (key === today) return 'Today';
  if (key === tomorrow) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${key}T12:00:00Z`),
  );
};

const STATUS_STYLE: Record<Status, { label: string; className: string }> = {
  booked: { label: 'Booked', className: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' },
  completed: { label: 'Done', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
  missed: { label: 'Missed', className: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
};

export function CallCalendarPage() {
  const [tab, setTab] = useState<'bookings' | 'availability'>('bookings');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, b] = await Promise.all([
      db.from('onboarding_call_settings').select('*').eq('id', true).maybeSingle(),
      db
        .from('onboarding_call_bookings')
        .select('id, tenant_id, name, email, phone, notes, starts_at, ends_at, status, admin_notes, cancelled_by, created_at, tenants(company_name, slug)')
        .gte('starts_at', new Date(Date.now() - 90 * DAY).toISOString())
        .order('starts_at', { ascending: true }),
    ]);
    setLoading(false);
    if (s.error || b.error) {
      const message: string = (s.error ?? b.error).message ?? '';
      if (/does not exist|schema cache/i.test(message)) {
        setMissing(true);
        return;
      }
      toast.error('The calendar could not be loaded', { description: message });
      return;
    }
    setMissing(false);
    setSettings(s.data as Settings);
    setBookings((b.data ?? []) as Booking[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Call Calendar</h1>
          <p className={cn('text-sm text-muted-foreground', PAGE_DESCRIPTION)}>
            The free onboarding calls: who has booked, and when you are free.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {missing ? (
        <Card>
          <CardHeader>
            <CardTitle>The calendar is not set up yet</CardTitle>
            <CardDescription>
              Apply <code className="text-xs">supabase/migrations/20261123180000_onboarding_call_calendar.sql</code> to this
              database, then refresh.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="inline-flex rounded-full bg-muted p-1" role="tablist" aria-label="Call calendar">
            {(['bookings', 'availability'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t === 'bookings' ? 'Bookings' : 'Availability'}
              </button>
            ))}
          </div>

          {tab === 'bookings' ? (
            <BookingsTab bookings={bookings} settings={settings} loading={loading} onChanged={load} />
          ) : settings ? (
            <AvailabilityTab settings={settings} onSaved={(next) => setSettings(next)} />
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </>
      )}
    </div>
  );
}

// ── Bookings ────────────────────────────────────────────────────────────────

function BookingsTab({
  bookings,
  settings,
  loading,
  onChanged,
}: {
  bookings: Booking[] | null;
  settings: Settings | null;
  loading: boolean;
  onChanged: () => Promise<void>;
}) {
  const tz = settings?.timezone ?? 'America/New_York';
  const [busyId, setBusyId] = useState<string | null>(null);
  const now = Date.now();

  const upcoming = useMemo(
    () => (bookings ?? []).filter((b) => b.status === 'booked' && new Date(b.ends_at).getTime() > now),
    [bookings, now],
  );
  const past = useMemo(
    () =>
      (bookings ?? [])
        .filter((b) => !(b.status === 'booked' && new Date(b.ends_at).getTime() > now))
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at)),
    [bookings, now],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of upcoming) {
      const key = dayKey(b.starts_at, tz);
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return map;
  }, [upcoming, tz]);

  const counts = useMemo(() => {
    const month = now - 30 * DAY;
    const recent = (bookings ?? []).filter((b) => new Date(b.starts_at).getTime() >= month);
    return {
      upcoming: upcoming.length,
      week: upcoming.filter((b) => new Date(b.starts_at).getTime() < now + 7 * DAY).length,
      done: recent.filter((b) => b.status === 'completed').length,
      missed: recent.filter((b) => b.status === 'missed').length,
    };
  }, [bookings, upcoming, now]);

  const setStatus = async (b: Booking, status: Status, note?: string | null) => {
    setBusyId(b.id);
    const { error } = await db.rpc('admin_set_onboarding_call_booking', {
      p_id: b.id,
      p_status: status,
      p_admin_notes: note ?? null,
    });
    setBusyId(null);
    if (error) {
      toast.error('That did not save', { description: error.message });
      return;
    }
    toast.success(status === 'booked' ? 'Note saved' : `Marked ${STATUS_STYLE[status].label.toLowerCase()}`);
    await onChanged();
  };

  const cancel = async (b: Booking) => {
    const ok = await confirmDialog({
      title: `Cancel the call with ${b.tenants?.company_name || b.name}?`,
      description: 'Their time frees up, and their portal offers the call again. They are not emailed.',
      confirmLabel: 'Cancel the call',
      cancelLabel: 'Keep it',
      destructive: true,
    });
    if (ok) await setStatus(b, 'cancelled');
  };

  const note = async (b: Booking) => {
    const text = await promptDialog({
      title: 'Note on this call',
      placeholder: 'What you talked about, what to follow up on.',
      defaultValue: b.admin_notes ?? '',
      confirmLabel: 'Save note',
    });
    if (text !== null) await setStatus(b, b.status, text);
  };

  const row = (b: Booking, showDay: boolean) => {
    const st = STATUS_STYLE[b.status];
    const rowBusy = busyId === b.id;
    return (
      <li key={b.id} className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:gap-6">
        <div className="lg:w-[150px]">
          <p className="text-sm font-semibold tabular-nums">
            {timeOf(b.starts_at, tz)} – {timeOf(b.ends_at, tz)}
          </p>
          {showDay && <p className="text-xs text-muted-foreground">{dayLabel(dayKey(b.starts_at, tz), tz)}</p>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <a href={`/admin/rentals/${b.tenant_id}`} className="truncate hover:underline">
              {b.tenants?.company_name || b.tenants?.slug || 'Unknown company'}
            </a>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', st.className)}>{st.label}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[b.name, b.email, b.phone].filter(Boolean).join(' · ')}
          </p>
          {b.notes && <p className="mt-1 line-clamp-2 text-xs text-foreground/80">“{b.notes}”</p>}
          {b.admin_notes && (
            <p className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              <StickyNote className="h-3 w-3 shrink-0" />
              <span className="truncate">{b.admin_notes}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
          {rowBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {b.status === 'booked' && (
            <>
              <Button size="sm" variant="outline" disabled={rowBusy} onClick={() => void setStatus(b, 'completed')}>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Done
              </Button>
              <Button size="sm" variant="outline" disabled={rowBusy} onClick={() => void setStatus(b, 'missed')}>
                Missed
              </Button>
              <Button size="sm" variant="ghost" disabled={rowBusy} onClick={() => void cancel(b)}>
                <X className="mr-1.5 h-3.5 w-3.5" />
                Cancel
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" disabled={rowBusy} onClick={() => void note(b)} aria-label="Add a note">
            <StickyNote className="h-3.5 w-3.5" />
          </Button>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ['Upcoming', counts.upcoming],
            ['Next 7 days', counts.week],
            ['Done, last 30 days', counts.done],
            ['Missed, last 30 days', counts.missed],
          ] as const
        ).map(([label, n]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{loading && !bookings ? '—' : n}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            Upcoming calls
          </CardTitle>
          <CardDescription>Times are in your time zone, {tz.replace(/_/g, ' ')}.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !bookings ? (
            <div className="space-y-2 px-6 pb-6">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : byDay.size === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No calls booked right now.</p>
          ) : (
            [...byDay.entries()].map(([key, list]) => (
              <div key={key} className="border-t">
                <p className="bg-muted/40 px-6 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {dayLabel(key, tz)}
                </p>
                <ul className="divide-y">{list.map((b) => row(b, false))}</ul>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {past.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Past calls</CardTitle>
            <CardDescription>The last 90 days, newest first.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y border-t">{past.map((b) => row(b, true))}</ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Availability ────────────────────────────────────────────────────────────

function AvailabilityTab({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [newDay, setNewDay] = useState('');
  const zones = useMemo(() => {
    const list = timeZones();
    return list.includes(draft.timezone) ? list : [draft.timezone, ...list];
  }, [draft.timezone]);

  useEffect(() => setDraft(settings), [settings]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const setDay = (day: string, windows: Window[]) => {
    const next = { ...draft.weekly_hours };
    if (windows.length) next[day] = windows;
    else delete next[day];
    set('weekly_hours', next);
  };

  const badWindow = Object.values(draft.weekly_hours).some((ws) => ws.some(([a, b]) => !a || !b || a >= b));

  const save = async () => {
    if (badWindow) {
      toast.error('Each block of hours must end after it starts');
      return;
    }
    setSaving(true);
    const { data, error } = await db
      .from('onboarding_call_settings')
      .update({
        host_name: draft.host_name.trim() || 'Bryan Diaz',
        host_title: draft.host_title.trim(),
        host_email: draft.host_email?.trim() || null,
        meeting_url: draft.meeting_url?.trim() || null,
        duration_minutes: draft.duration_minutes,
        buffer_minutes: draft.buffer_minutes,
        timezone: draft.timezone,
        weekly_hours: draft.weekly_hours,
        blocked_dates: [...draft.blocked_dates].sort(),
        min_notice_hours: draft.min_notice_hours,
        max_days_ahead: draft.max_days_ahead,
        is_accepting: draft.is_accepting,
      })
      .eq('id', true)
      .select('*')
      .single();
    setSaving(false);
    if (error) {
      toast.error('That did not save', { description: error.message });
      return;
    }
    toast.success('Your availability is saved');
    onSaved(data as Settings);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <p className="text-sm font-semibold">Taking calls</p>
            <p className="text-sm text-muted-foreground">
              {draft.is_accepting
                ? 'New companies can book a time with you.'
                : 'Off: no new bookings. Calls already booked stay booked.'}
            </p>
          </div>
          <Switch checked={draft.is_accepting} onCheckedChange={(v) => set('is_accepting', v)} aria-label="Taking calls" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly hours</CardTitle>
          <CardDescription>When companies can book you, in your time zone. Add more than one block to leave a gap.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className="mb-4 grid gap-2 sm:max-w-sm">
            <Label>Your time zone</Label>
            <Select value={draft.timezone} onValueChange={(v) => set('timezone', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {zones.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ul className="divide-y rounded-xl border">
            {WEEK.map(({ key, label }) => {
              const windows = draft.weekly_hours[key] ?? [];
              const on = windows.length > 0;
              return (
                <li key={key} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
                  <div className="flex w-40 shrink-0 items-center gap-3 pt-1.5">
                    <Switch
                      checked={on}
                      onCheckedChange={(v) => setDay(key, v ? [['09:00', '17:00'] as Window] : [])}
                      aria-label={`${label} on or off`}
                    />
                    <span className={cn('text-sm font-medium', !on && 'text-muted-foreground')}>{label}</span>
                  </div>
                  {on ? (
                    <div className="flex flex-1 flex-col gap-2">
                      {windows.map(([from, to], i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                          <Input
                            type="time"
                            value={from}
                            onChange={(e) => setDay(key, windows.map((w, j): Window => (j === i ? [e.target.value, w[1]] : w)))}
                            className="w-32"
                            aria-label={`${label} from`}
                          />
                          <span className="text-sm text-muted-foreground">to</span>
                          <Input
                            type="time"
                            value={to}
                            onChange={(e) => setDay(key, windows.map((w, j): Window => (j === i ? [w[0], e.target.value] : w)))}
                            className={cn('w-32', from && to && from >= to && 'border-destructive')}
                            aria-label={`${label} until`}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Remove these hours"
                            onClick={() => setDay(key, windows.filter((_, j) => j !== i))}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setDay(key, [...windows, ['13:00', '17:00'] as Window])}
                        className="flex w-fit items-center gap-1 text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-400"
                      >
                        <Plus className="h-3 w-3" />
                        Add hours
                      </button>
                    </div>
                  ) : (
                    <p className="pt-1.5 text-sm text-muted-foreground">Unavailable</p>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">The call</CardTitle>
            <CardDescription>What companies see when they book.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name">
              <Input value={draft.host_name} onChange={(e) => set('host_name', e.target.value)} />
            </Field>
            <Field label="Your title">
              <Input value={draft.host_title} onChange={(e) => set('host_title', e.target.value)} />
            </Field>
            <Field label="Call length">
              <Select value={String(draft.duration_minutes)} onValueChange={(v) => set('duration_minutes', Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LENGTHS.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Gap between calls">
              <Select value={String(draft.buffer_minutes)} onValueChange={(v) => set('buffer_minutes', Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUFFERS.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m === 0 ? 'No gap' : `${m} minutes`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Call link (Zoom or Google Meet)" hint="Shown to the company once they have booked.">
                <Input
                  value={draft.meeting_url ?? ''}
                  onChange={(e) => set('meeting_url', e.target.value)}
                  placeholder="https://meet.google.com/…"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Your email" hint="Kept for when booking emails are switched on.">
                <Input type="email" value={draft.host_email ?? ''} onChange={(e) => set('host_email', e.target.value)} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Booking window</CardTitle>
            <CardDescription>How soon, and how far ahead, a company can book.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Minimum notice (hours)">
                <Input
                  type="number"
                  min={0}
                  max={336}
                  value={draft.min_notice_hours}
                  onChange={(e) => set('min_notice_hours', Math.max(0, Math.min(336, Number(e.target.value) || 0)))}
                />
              </Field>
              <Field label="Up to (days ahead)">
                <Input
                  type="number"
                  min={1}
                  max={180}
                  value={draft.max_days_ahead}
                  onChange={(e) => set('max_days_ahead', Math.max(1, Math.min(180, Number(e.target.value) || 1)))}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <Label>Days off</Label>
              <p className="text-xs text-muted-foreground">Whole days nobody can book: holidays, leave.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Input type="date" value={newDay} onChange={(e) => setNewDay(e.target.value)} className="w-44" />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!newDay || draft.blocked_dates.includes(newDay)}
                  onClick={() => {
                    set('blocked_dates', [...draft.blocked_dates, newDay].sort());
                    setNewDay('');
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add day off
                </Button>
              </div>
              {draft.blocked_dates.length > 0 && (
                <ul className="flex flex-wrap gap-1.5 pt-1">
                  {draft.blocked_dates.map((d) => (
                    <li
                      key={d}
                      className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs"
                    >
                      {new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
                        new Date(`${d}T12:00:00Z`),
                      )}
                      <button
                        type="button"
                        aria-label="Remove this day off"
                        onClick={() => set('blocked_dates', draft.blocked_dates.filter((x) => x !== d))}
                        className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <div className="flex items-center gap-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur">
          {dirty && (
            <Button variant="ghost" size="sm" onClick={() => setDraft(settings)} disabled={saving}>
              Discard
            </Button>
          )}
          <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
