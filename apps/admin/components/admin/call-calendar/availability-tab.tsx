'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';

import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { db, errorText, flushMailer, type Block, type Settings, type Window } from './shared';
import { addDays, dateLabel, dayKey, formatShort, hhmm, timeZones, zonedToUtc } from './time';

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

const PROBLEM: Record<string, string> = {
  day_off: 'Now a day off',
  outside_hours: 'Now outside your hours',
  blocked: 'Now in a blocked time',
};

interface BlockRow {
  key: string;
  date: string;
  from: string;
  /** "00:00" means the end of the day. */
  to: string;
  label: string;
}

interface Clash {
  id: string;
  company_name: string | null;
  name: string;
  starts_at: string;
  problem: string;
}

let rowSeq = 0;
const newKey = () => `b${++rowSeq}`;

/** Blocked periods as rows of one day each, in Bryan's zone. */
function rowsFromBlocks(blocks: Block[], tz: string): BlockRow[] {
  const rows: BlockRow[] = [];
  for (const b of blocks) {
    const start = new Date(b.starts_at).getTime();
    const end = new Date(b.ends_at).getTime();
    let day = dayKey(b.starts_at, tz);
    for (let guard = 0; guard < 400; guard++) {
      const from = zonedToUtc(day, '00:00', tz).getTime();
      const to = zonedToUtc(addDays(day, 1), '00:00', tz).getTime();
      if (from >= end) break;
      const s = Math.max(start, from);
      const e = Math.min(end, to);
      if (e > s) {
        rows.push({
          key: newKey(),
          date: day,
          from: hhmm(new Date(s), tz),
          to: e >= to ? '00:00' : hhmm(new Date(e), tz),
          label: b.label ?? '',
        });
      }
      day = addDays(day, 1);
    }
  }
  return rows.sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from));
}

const rowOk = (r: BlockRow) => !!r.date && !!r.from && !!r.to && (r.to === '00:00' || r.to > r.from);

function blocksFromRows(rows: BlockRow[], tz: string): Block[] {
  return rows.filter(rowOk).map((r) => ({
    starts_at: zonedToUtc(r.date, r.from, tz).toISOString(),
    ends_at: zonedToUtc(r.to === '00:00' ? addDays(r.date, 1) : r.date, r.to, tz).toISOString(),
    label: r.label || null,
  }));
}

const plainRows = (rows: BlockRow[]) => JSON.stringify(rows.map(({ date, from, to, label }) => [date, from, to, label.trim()]));

export function AvailabilityTab({
  settings,
  blocks,
  onSaved,
}: {
  settings: Settings;
  blocks: Block[];
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Settings>(settings);
  const initialRows = useMemo(() => rowsFromBlocks(blocks, settings.timezone), [blocks, settings.timezone]);
  const [rows, setRows] = useState<BlockRow[]>(initialRows);
  const [saving, setSaving] = useState(false);
  const [newDay, setNewDay] = useState('');
  const [clashes, setClashes] = useState<Clash[] | null>(null);
  const [choices, setChoices] = useState<Record<string, 'keep' | 'cancel'>>({});
  const zones = useMemo(() => {
    const list = timeZones();
    return list.includes(draft.timezone) ? list : [draft.timezone, ...list];
  }, [draft.timezone]);

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => setRows(initialRows), [initialRows]);

  const settingsDirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const blocksDirty = plainRows(rows) !== plainRows(initialRows);
  const dirty = settingsDirty || blocksDirty;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // Blocked periods are typed in Bryan's zone, so a new zone keeps the same moments.
  const setZone = (tz: string) => {
    const good = rows.filter(rowOk);
    const bad = rows.filter((r) => !rowOk(r));
    setRows([...rowsFromBlocks(blocksFromRows(good, draft.timezone), tz), ...bad]);
    set('timezone', tz);
  };

  const setDay = (day: string, windows: Window[]) => {
    const next = { ...draft.weekly_hours };
    if (windows.length) next[day] = windows;
    else delete next[day];
    set('weekly_hours', next);
  };

  const setRow = (key: string, patch: Partial<BlockRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const badWindow = Object.values(draft.weekly_hours).some((ws) => ws.some(([a, b]) => !a || !b || a >= b));
  const badBlock = rows.some((r) => !rowOk(r));

  const save = async (decisions: Record<string, 'keep' | 'cancel'> = {}) => {
    if (badWindow) {
      toast.error('Each block of hours must end after it starts');
      return;
    }
    if (badBlock) {
      toast.error('A blocked time must end after it starts');
      return;
    }
    const payload: Record<string, unknown> = {
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
    };
    if (draft.host_photo_url?.trim()) payload.host_photo_url = draft.host_photo_url.trim();
    const blockList = blocksDirty
      ? rows.map((r) => ({ date: r.date, from: r.from, to: r.to === '00:00' ? '24:00' : r.to, label: r.label.trim() }))
      : null;

    setSaving(true);
    const { data, error } = await db.rpc('admin_save_onboarding_call_settings', {
      p_settings: payload,
      p_blocks: blockList,
      p_decisions: decisions,
    });
    if (error) {
      setSaving(false);
      toast.error(errorText(error));
      // The booked calls changed since the list was shown: fetch the new list.
      if (Object.keys(decisions).length > 0) await save({});
      return;
    }
    const res = data as { saved: boolean; clashes: Clash[] };
    if (!res.saved) {
      setSaving(false);
      setChoices((c) => Object.fromEntries(Object.entries(c).filter(([id]) => res.clashes.some((x) => x.id === id))));
      setClashes(res.clashes);
      return;
    }
    if (Object.values(decisions).includes('cancel')) flushMailer();
    setClashes(null);
    setChoices({});
    await onSaved();
    setSaving(false);
    toast.success('Saved');
  };

  const allChosen = !!clashes && clashes.every((c) => choices[c.id]);

  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <p className="text-sm font-semibold">Taking calls</p>
            <p className="text-sm text-muted-foreground">
              {draft.is_accepting ? 'New companies can book a time with you.' : 'Off: no new bookings. Calls already booked stay booked.'}
            </p>
          </div>
          <Switch checked={draft.is_accepting} onCheckedChange={(v) => set('is_accepting', v)} aria-label="Taking calls" />
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Weekly hours</CardTitle>
          <CardDescription>When companies can book you, in your time zone. Add more than one block to leave a gap.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className="mb-4 grid gap-2 sm:max-w-sm">
            <Label>Your time zone</Label>
            <Select value={draft.timezone} onValueChange={setZone}>
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
            <p className="text-xs text-muted-foreground">Changing it moves no booked call. Each call keeps its moment.</p>
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

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Blocked times</CardTitle>
          <CardDescription>
            Part of a day you are not free, like the dentist from 2 to 4 PM. In your time zone. An end of 00:00 means midnight.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No blocked times.</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {rows.map((r) => (
                <li key={r.key} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <Input type="date" value={r.date} onChange={(e) => setRow(r.key, { date: e.target.value })} className="w-40" aria-label="Date" />
                  <Input type="time" value={r.from} onChange={(e) => setRow(r.key, { from: e.target.value })} className="w-28" aria-label="From" />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input
                    type="time"
                    value={r.to}
                    onChange={(e) => setRow(r.key, { to: e.target.value })}
                    className={cn('w-28', !rowOk(r) && r.from && r.to && 'border-destructive')}
                    aria-label="To"
                  />
                  <Input
                    value={r.label}
                    onChange={(e) => setRow(r.key, { label: e.target.value })}
                    placeholder="Label, like Dentist"
                    maxLength={80}
                    className="min-w-[140px] flex-1"
                    aria-label="Label"
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove this blocked time" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRows((rs) => [...rs, { key: newKey(), date: dayKey(new Date(), draft.timezone), from: '14:00', to: '16:00', label: '' }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add blocked time
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-none">
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
                  {(LENGTHS.includes(draft.duration_minutes) ? LENGTHS : [...LENGTHS, draft.duration_minutes].sort((a, b) => a - b)).map((m) => (
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
                  {(BUFFERS.includes(draft.buffer_minutes) ? BUFFERS : [...BUFFERS, draft.buffer_minutes].sort((a, b) => a - b)).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m === 0 ? 'No gap' : `${m} minutes`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Call link (Zoom or Google Meet)" hint="Sent to the company once they have booked.">
                <Input
                  id="call-link"
                  value={draft.meeting_url ?? ''}
                  onChange={(e) => set('meeting_url', e.target.value)}
                  placeholder="https://meet.google.com/..."
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Your email" hint="Where your booking emails go.">
                <Input type="email" value={draft.host_email ?? ''} onChange={(e) => set('host_email', e.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Your photo" hint="A link to the photo companies see beside your name.">
                <Input value={draft.host_photo_url ?? ''} onChange={(e) => set('host_photo_url', e.target.value)} placeholder="/team/bryan.jpg" />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none">
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
                    <li key={d} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs">
                      {dateLabel(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
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
        <div className="flex items-center gap-2 rounded-xl border bg-background p-2">
          {dirty && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(settings);
                setRows(initialRows);
              }}
              disabled={saving}
            >
              Discard
            </Button>
          )}
          <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </div>

      <Dialog open={!!clashes} onOpenChange={(open) => !open && !saving && setClashes(null)}>
        <DialogContent className="max-h-[calc(100svh-2rem)] max-w-xl overflow-y-auto shadow-none">
          <DialogHeader className="pr-6 text-left">
            <DialogTitle>Some booked calls no longer fit</DialogTitle>
            <DialogDescription>
              Choose what to do with each one. Keep leaves the call as it is. Cancel cancels it and emails the company. Nothing is saved until
              each has a choice.
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y rounded-xl border">
            {(clashes ?? []).map((c) => (
              <li key={c.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.company_name || 'Unknown company'}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.name} · {formatShort(c.starts_at, draft.timezone)}
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">{PROBLEM[c.problem] ?? 'No longer fits'}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant={choices[c.id] === 'keep' ? 'default' : 'outline'}
                    onClick={() => setChoices((x) => ({ ...x, [c.id]: 'keep' }))}
                  >
                    Keep
                  </Button>
                  <Button
                    size="sm"
                    variant={choices[c.id] === 'cancel' ? 'destructive' : 'outline'}
                    onClick={() => setChoices((x) => ({ ...x, [c.id]: 'cancel' }))}
                  >
                    Cancel
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setClashes(null)} disabled={saving}>
              Go back
            </Button>
            <Button size="sm" disabled={!allChosen || saving} onClick={() => void save(choices)}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
