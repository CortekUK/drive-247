'use client';

/**
 * Webinars (v2 only) — schedule a webinar, choose who sees it, and track who
 * registered, all in one view.
 *
 *   Webinars       title, description, date / time (in a chosen time zone),
 *                  length and meeting link (Google Meet, Zoom, …). Draft → published → cancelled.
 *                  Audience: every v2 tenant minus exclusions, or only the
 *                  selected ones.
 *   Registrations  per webinar: every tenant in its audience, registered or
 *                  not, who registered, when, and whether the confirmation
 *                  email went out. Live over realtime.
 *
 * Operators see published webinars as a popup on their v2 portal home and
 * register with one click (`webinar-register`, which sends the confirmation).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  Video,
  XCircle,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type Status = 'draft' | 'published' | 'cancelled';
type Audience = 'all' | 'selected';

interface Webinar {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  duration_minutes: number;
  timezone: string;
  meet_url: string;
  status: Status;
  audience: Audience;
  target_tenant_ids: string[];
  excluded_tenant_ids: string[];
}

interface Registration {
  id: string;
  webinar_id: string;
  tenant_id: string;
  email: string | null;
  email_status: 'pending' | 'sent' | 'failed';
  email_detail: string | null;
  registered_at: string;
  app_users: { name: string | null; email: string | null } | null;
}

interface TenantLite {
  id: string;
  company_name: string | null;
  slug: string;
  portal_experience: string | null;
  status: string | null;
  tenant_type: string | null;
}

interface Draft {
  id: string | null;
  title: string;
  description: string;
  date: string;
  time: string;
  timezone: string;
  duration: string;
  meetUrl: string;
  audience: Audience;
  picked: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const BROWSER_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

const TIMEZONES = Array.from(
  new Set([
    BROWSER_TZ,
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Berlin',
    'Asia/Dubai',
    'Asia/Karachi',
    'Asia/Kolkata',
    'Australia/Sydney',
    'UTC',
  ]),
);

const isV2 = (t: TenantLite) => t.portal_experience === 'v2' || t.slug === 'northwind';

/* ── Time zones ───────────────────────────────────────────────────────── */

function partsIn(instant: number, tz: string) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute'), s: get('second') };
}

/** "2026-10-20" + "15:00" on the wall clock in `tz` → UTC ISO string. */
function wallToIso(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(guess, tz);
    guess -= Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - target;
  }
  return new Date(guess).toISOString();
}

function isoToWall(iso: string, tz: string): { date: string; time: string } {
  const p = partsIn(new Date(iso).getTime(), tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.min)}` };
}

function formatStart(w: Pick<Webinar, 'starts_at' | 'timezone'>): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: w.timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(w.starts_at));
  } catch {
    return new Date(w.starts_at).toLocaleString();
  }
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const hasEnded = (w: Webinar) => new Date(w.starts_at).getTime() + w.duration_minutes * 60_000 < Date.now();

function stateOf(w: Webinar): { label: string; className: string } {
  if (w.status === 'cancelled') return { label: 'Cancelled', className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' };
  if (w.status === 'draft') return { label: 'Draft', className: 'bg-muted text-muted-foreground' };
  if (hasEnded(w)) return { label: 'Ended', className: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300' };
  return { label: 'Published', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' };
}

function emptyDraft(): Draft {
  const next = new Date(Date.now() + 7 * 86_400_000);
  const wall = isoToWall(next.toISOString(), BROWSER_TZ);
  return {
    id: null,
    title: '',
    description: '',
    date: wall.date,
    time: '15:00',
    timezone: BROWSER_TZ,
    duration: '60',
    meetUrl: '',
    audience: 'all',
    picked: [],
  };
}

export function WebinarsTab({ canEdit }: { canEdit: boolean }) {
  const [loading, setLoading] = useState(true);
  const [webinars, setWebinars] = useState<Webinar[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Webinar | null>(null);
  const [trackId, setTrackId] = useState('');
  const [filter, setFilter] = useState<'all' | 'registered' | 'not'>('all');
  const [live, setLive] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [w, r, t] = await Promise.all([
        db.from('webinars').select('*').order('starts_at', { ascending: false }),
        db
          .from('webinar_registrations')
          .select('id, webinar_id, tenant_id, email, email_status, email_detail, registered_at, app_users(name, email)')
          .order('registered_at', { ascending: false }),
        db.from('tenants').select('id, company_name, slug, portal_experience, status, tenant_type').order('company_name'),
      ]);
      for (const res of [w, r, t]) if (res.error) throw res.error;
      setWebinars((w.data as Webinar[]) ?? []);
      setRegistrations((r.data as Registration[]) ?? []);
      setTenants((t.data as TenantLite[]) ?? []);
    } catch (e) {
      if (!quiet) toast.error('Could not load webinars', { description: (e as Error).message });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('webinars-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'webinar_registrations' }, () => void load(true))
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  // Track the next upcoming published webinar by default.
  useEffect(() => {
    if (trackId && webinars.some((w) => w.id === trackId)) return;
    const upcoming = [...webinars]
      .filter((w) => w.status === 'published' && !hasEnded(w))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    setTrackId((upcoming ?? webinars[0])?.id ?? '');
  }, [webinars, trackId]);

  const v2Tenants = useMemo(
    () => tenants.filter((t) => t.status === 'active' && t.tenant_type !== 'test' && isV2(t)),
    [tenants],
  );
  const audienceOf = useCallback(
    (w: Webinar) =>
      v2Tenants.filter((t) => (w.audience === 'selected' ? w.target_tenant_ids.includes(t.id) : !w.excluded_tenant_ids.includes(t.id))),
    [v2Tenants],
  );
  const regsFor = useCallback((id: string) => registrations.filter((r) => r.webinar_id === id), [registrations]);

  /* ── Mutations ─────────────────────────────────────────────────────── */

  async function save(publish: boolean) {
    if (!draft) return;
    const duration = Number(draft.duration);
    if (!draft.title.trim()) return void toast.error('Give the webinar a title');
    if (!draft.date || !draft.time) return void toast.error('Choose a date and time');
    if (!/^https?:\/\/\S+$/i.test(draft.meetUrl.trim())) return void toast.error('Paste the full meeting link, starting with https://');
    if (!Number.isInteger(duration) || duration < 5 || duration > 600) return void toast.error('Length must be 5–600 minutes');
    if (draft.audience === 'selected' && draft.picked.length === 0) return void toast.error('Pick at least one tenant, or choose All tenants');
    let startsAt: string;
    try {
      startsAt = wallToIso(draft.date, draft.time, draft.timezone);
    } catch {
      return void toast.error('That date or time zone is not valid');
    }
    if (publish && new Date(startsAt).getTime() < Date.now()) return void toast.error('That time is in the past');

    setSaving(true);
    try {
      const row: Record<string, unknown> = {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        starts_at: startsAt,
        duration_minutes: duration,
        timezone: draft.timezone,
        meet_url: draft.meetUrl.trim(),
        audience: draft.audience,
        target_tenant_ids: draft.audience === 'selected' ? draft.picked : [],
        excluded_tenant_ids: draft.audience === 'all' ? draft.picked : [],
      };
      if (publish) row.status = 'published';
      const { error } = draft.id
        ? await db.from('webinars').update(row).eq('id', draft.id)
        : await db.from('webinars').insert({ ...row, status: publish ? 'published' : 'draft' });
      if (error) throw error;
      toast.success(publish ? 'Published — it pops up on v2 portals now' : 'Saved');
      setDraft(null);
      await load(true);
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(w: Webinar, status: Status) {
    const { error } = await db.from('webinars').update({ status }).eq('id', w.id);
    if (error) return void toast.error('Could not update', { description: error.message });
    toast.success(status === 'published' ? 'Published' : 'Cancelled — it no longer pops up');
    await load(true);
  }

  async function remove(w: Webinar) {
    const { error } = await db.from('webinars').delete().eq('id', w.id);
    if (error) return void toast.error('Could not delete', { description: error.message });
    setConfirmDelete(null);
    toast.success('Webinar deleted');
    await load(true);
  }

  function openEdit(w: Webinar) {
    const wall = isoToWall(w.starts_at, w.timezone);
    setDraft({
      id: w.id,
      title: w.title,
      description: w.description ?? '',
      date: wall.date,
      time: wall.time,
      timezone: w.timezone,
      duration: String(w.duration_minutes),
      meetUrl: w.meet_url,
      audience: w.audience,
      picked: w.audience === 'selected' ? w.target_tenant_ids : w.excluded_tenant_ids,
    });
  }

  /* ── Render ────────────────────────────────────────────────────────── */

  if (loading && webinars.length === 0) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const tracked = webinars.find((w) => w.id === trackId) ?? null;

  return (
    <div className="space-y-6">
      {/* ── Webinars ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Video className="h-5 w-5 text-primary" />
                Webinars
              </CardTitle>
              <CardDescription>
                Published webinars pop up on the <span className="font-medium text-foreground">v2</span> portal home. Operators
                register with one click and get a confirmation email with the date, time and meeting link.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </Button>
              {canEdit && (
                <Button size="sm" className="gap-1.5" onClick={() => setDraft(emptyDraft())}>
                  <Plus className="h-4 w-4" />
                  Schedule webinar
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {webinars.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No webinars yet. Schedule one to invite your operators.</p>
          ) : (
            <div className="space-y-3">
              {webinars.map((w) => {
                const state = stateOf(w);
                const reach = audienceOf(w).length;
                const registered = regsFor(w.id).length;
                const start = new Date(w.starts_at);
                return (
                  <div
                    key={w.id}
                    className={cn('flex flex-wrap items-center gap-4 rounded-lg border p-4', trackId === w.id && 'border-primary/50 ring-1 ring-primary/20')}
                  >
                    <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-md bg-primary/10 text-primary">
                      <span className="text-[10px] font-medium uppercase leading-none">
                        {start.toLocaleDateString('en-GB', { month: 'short', timeZone: w.timezone })}
                      </span>
                      <span className="text-xl font-bold leading-tight tabular-nums">
                        {start.toLocaleDateString('en-GB', { day: 'numeric', timeZone: w.timezone })}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{w.title}</p>
                        <Badge variant="secondary" className={state.className}>
                          {state.label}
                        </Badge>
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatStart(w)} · {w.duration_minutes} min
                        </span>
                        <a href={w.meet_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                          <ExternalLink className="h-3.5 w-3.5" />
                          Meeting link
                        </a>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {w.audience === 'selected'
                          ? `${w.target_tenant_ids.length} selected tenant${w.target_tenant_ids.length === 1 ? '' : 's'}`
                          : `All v2 tenants${w.excluded_tenant_ids.length ? `, ${w.excluded_tenant_ids.length} excluded` : ''}`}{' '}
                        · <span className="font-medium text-foreground">{registered}</span> of {reach} registered
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant={trackId === w.id ? 'secondary' : 'ghost'} size="sm" className="gap-1.5" onClick={() => setTrackId(w.id)}>
                        <Users className="h-3.5 w-3.5" />
                        Registrations
                      </Button>
                      {canEdit && (
                        <>
                          {w.status === 'draft' && (
                            <Button size="sm" className="gap-1.5" onClick={() => void setStatus(w, 'published')}>
                              <Megaphone className="h-4 w-4" />
                              Publish
                            </Button>
                          )}
                          {w.status === 'published' && !hasEnded(w) && (
                            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void setStatus(w, 'cancelled')}>
                              <XCircle className="h-4 w-4" />
                              Cancel
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => openEdit(w)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => setConfirmDelete(w)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Registrations (same view) ───────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                Registrations
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    live ? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' : 'bg-muted text-muted-foreground',
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'animate-pulse bg-green-600' : 'bg-muted-foreground')} />
                  {live ? 'Live' : 'Connecting…'}
                </span>
              </CardTitle>
              <CardDescription>Every tenant invited to a webinar — who has registered and who hasn&apos;t yet.</CardDescription>
            </div>
            {webinars.length > 0 && (
              <Select value={trackId} onValueChange={setTrackId}>
                <SelectTrigger className="h-9 w-[320px] max-w-full text-sm">
                  <SelectValue placeholder="Choose a webinar" />
                </SelectTrigger>
                <SelectContent>
                  {webinars.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {new Date(w.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {w.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!tracked ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Registrations appear here once a webinar exists.</p>
          ) : (
            <Tracker webinar={tracked} invited={audienceOf(tracked)} registrations={regsFor(tracked.id)} filter={filter} onFilter={setFilter} tenants={tenants} />
          )}
        </CardContent>
      </Card>

      {/* ── Schedule / edit ─────────────────────────────────────────────── */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit webinar' : 'Schedule webinar'}</DialogTitle>
            <DialogDescription>Pops up on the v2 portal home of every tenant in the audience once published.</DialogDescription>
          </DialogHeader>
          {draft && <WebinarEditor draft={draft} onChange={setDraft} tenants={v2Tenants} />}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => void save(false)} disabled={saving}>
              {draft?.id ? 'Save' : 'Save as draft'}
            </Button>
            {(!draft?.id || webinars.find((w) => w.id === draft.id)?.status !== 'published') && (
              <Button onClick={() => void save(true)} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                Publish
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete ──────────────────────────────────────────────────────── */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{confirmDelete?.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              The webinar and its {confirmDelete ? regsFor(confirmDelete.id).length : 0} registration(s) are removed for good. Registered
              operators are not told. To call it off and keep the record, cancel it instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={() => confirmDelete && void remove(confirmDelete)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function WebinarEditor({ draft, onChange, tenants }: { draft: Draft; onChange: (d: Draft) => void; tenants: TenantLite[] }) {
  const [search, setSearch] = useState('');
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tenants.filter((t) => !q || (t.company_name ?? '').toLowerCase().includes(q) || t.slug.includes(q));
  }, [tenants, search]);
  const toggle = (id: string) =>
    onChange({ ...draft, picked: draft.picked.includes(id) ? draft.picked.filter((x) => x !== id) : [...draft.picked, id] });

  let preview = '';
  try {
    if (draft.date && draft.time) {
      preview = formatStart({ starts_at: wallToIso(draft.date, draft.time, draft.timezone), timezone: draft.timezone });
    }
  } catch {
    preview = '';
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="wb-title">Title</Label>
        <Input id="wb-title" value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} placeholder="e.g. Getting more direct bookings" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wb-desc">Description</Label>
        <Textarea
          id="wb-desc"
          rows={4}
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          placeholder="What you'll cover, who it's for."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_120px_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="wb-date">Date</Label>
          <Input id="wb-date" type="date" value={draft.date} onChange={(e) => onChange({ ...draft, date: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wb-time">Time</Label>
          <Input id="wb-time" type="time" value={draft.time} onChange={(e) => onChange({ ...draft, time: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Time zone</Label>
          <Select value={draft.timezone} onValueChange={(v) => onChange({ ...draft, timezone: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                  {tz === BROWSER_TZ ? ' (yours)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="wb-len">Length (min)</Label>
          <Input id="wb-len" type="number" min={5} max={600} value={draft.duration} onChange={(e) => onChange({ ...draft, duration: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wb-meet">Meeting link</Label>
          <Input id="wb-meet" value={draft.meetUrl} onChange={(e) => onChange({ ...draft, meetUrl: e.target.value })} placeholder="Google Meet, Zoom, Teams… e.g. https://zoom.us/j/123456789" />
        </div>
      </div>
      {preview && (
        <p className="-mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          {preview}. Each operator&apos;s confirmation email shows it in their own time zone.
        </p>
      )}

      <div className="space-y-2">
        <Label>Who&apos;s invited</Label>
        <div className="grid grid-cols-2 gap-2">
          {(['all', 'selected'] as Audience[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onChange({ ...draft, audience: a, picked: [] })}
              className={cn(
                'rounded-lg border p-3 text-left text-sm transition-colors',
                draft.audience === a ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50',
              )}
            >
              <span className="block font-medium">{a === 'all' ? 'All v2 tenants' : 'Only selected tenants'}</span>
              <span className="block text-xs text-muted-foreground">{a === 'all' ? 'Tick any to exclude' : 'Tick the ones to invite'}</span>
            </button>
          ))}
        </div>
        <div className="rounded-lg border">
          <div className="flex items-center gap-2 border-b p-2">
            <Search className="ml-1 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={draft.audience === 'all' ? 'Search tenants to exclude' : 'Search tenants to invite'}
              className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <span className="whitespace-nowrap pr-1 text-xs text-muted-foreground">
              {draft.picked.length} {draft.audience === 'all' ? 'excluded' : 'invited'}
            </span>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {list.length === 0 ? (
              <p className="p-3 text-center text-sm text-muted-foreground">No v2 tenants match.</p>
            ) : (
              list.map((t) => {
                const on = draft.picked.includes(t.id);
                return (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                    <input type="checkbox" checked={on} onChange={() => toggle(t.id)} />
                    <span className={cn('flex-1 truncate', draft.audience === 'all' && on && 'text-muted-foreground line-through')}>
                      {t.company_name || t.slug}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Only v2 tenants are listed — webinars appear on v2 portals only.</p>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function Tracker({
  webinar,
  invited,
  registrations,
  filter,
  onFilter,
  tenants,
}: {
  webinar: Webinar;
  invited: TenantLite[];
  registrations: Registration[];
  filter: 'all' | 'registered' | 'not';
  onFilter: (f: 'all' | 'registered' | 'not') => void;
  tenants: TenantLite[];
}) {
  const regByTenant = new Map(registrations.map((r) => [r.tenant_id, r]));
  // Invited tenants, plus anyone who registered and was later excluded.
  const rows = [
    ...invited,
    ...registrations.filter((r) => !invited.some((t) => t.id === r.tenant_id)).map((r) => tenants.find((t) => t.id === r.tenant_id)).filter((t): t is TenantLite => !!t),
  ]
    .map((t) => ({ tenant: t, reg: regByTenant.get(t.id) ?? null }))
    .sort((a, b) => Number(!!b.reg) - Number(!!a.reg) || (a.tenant.company_name ?? a.tenant.slug).localeCompare(b.tenant.company_name ?? b.tenant.slug));
  const registered = rows.filter((r) => r.reg).length;
  const shown = rows.filter((r) => (filter === 'registered' ? r.reg : filter === 'not' ? !r.reg : true));
  const pct = rows.length ? Math.round((registered / rows.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">{webinar.title}</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{registered}</span> registered ·{' '}
            <span className="tabular-nums">{rows.length - registered}</span> not yet · {pct}%
          </p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex gap-1">
        {(
          [
            ['all', `All (${rows.length})`],
            ['registered', `Registered (${registered})`],
            ['not', `Not registered (${rows.length - registered})`],
          ] as const
        ).map(([key, label]) => (
          <Button key={key} variant={filter === key ? 'secondary' : 'ghost'} size="sm" onClick={() => onFilter(key)}>
            {label}
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">Nobody here.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Registered by</TableHead>
              <TableHead className="whitespace-nowrap">When</TableHead>
              <TableHead>Confirmation email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map(({ tenant, reg }) => (
              <TableRow key={tenant.id}>
                <TableCell className="font-medium">{tenant.company_name || tenant.slug}</TableCell>
                <TableCell>
                  {reg ? (
                    <span className="inline-flex items-center gap-1.5 text-green-700 dark:text-green-400">
                      <CheckCircle2 className="h-4 w-4" />
                      Registered
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Circle className="h-4 w-4" />
                      Not registered
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{reg ? reg.app_users?.name || reg.app_users?.email || reg.email || '—' : '—'}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{reg ? formatWhen(reg.registered_at) : '—'}</TableCell>
                <TableCell>
                  {!reg ? (
                    <span className="text-muted-foreground">—</span>
                  ) : reg.email_status === 'sent' ? (
                    <span className="text-sm text-green-700 dark:text-green-400">Sent to {reg.email}</span>
                  ) : reg.email_status === 'failed' ? (
                    <span className="text-sm text-red-700 dark:text-red-400" title={reg.email_detail ?? undefined}>
                      Failed{reg.email_detail ? ` — ${reg.email_detail}` : ''}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Sending…</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
