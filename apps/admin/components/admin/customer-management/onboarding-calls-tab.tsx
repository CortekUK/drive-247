'use client';

/**
 * Onboarding calls — Brian's view of the free 30-minute call (Nov 2026).
 *
 * Every Portal V2 tenant still in its first 30 days (or on a trial), and
 * where it stands: not booked, booked, done. The portal's home card offers the
 * call and the pre-call checklist; this is the other half:
 *
 *   - who has not booked 24h after signing up — the people to reach out to;
 *   - who has booked, and whether they did the checklist before the call;
 *   - Mark call done, which takes the card off their home screen;
 *   - the 24h reminder email (onboarding-call-reminder): pg_cron sends it
 *     hourly; here you can see who is due, send now, or remind one tenant;
 *   - calendar bookings: LeadConnector reports each booking, cancellation and
 *     attendance to onboarding-call-booked, which updates the row by itself.
 *     A booking it could not match to a tenant is listed here to place by hand.
 *
 * V1 tenants never appear: onboarding_call_eligible() only covers V2.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarDays, Check, ExternalLink, Loader2, Mail, RefreshCw, StickyNote } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PAGE_DESCRIPTION } from '@/components/admin/header-buttons';
import { cn } from '@/lib/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const BOOKING_URL = 'https://api.leadconnectorhq.com/widget/booking/WhGxejLXDJt4pN10JYUg';
const DAY = 86_400_000;

interface Row {
  tenant_id: string;
  slug: string;
  company_name: string | null;
  contact_email: string | null;
  tenant_created_at: string;
  subscription_status: string | null;
  trial_end: string | null;
  call_booked_at: string | null;
  call_booked_via: string | null;
  call_scheduled_for: string | null;
  call_completed_at: string | null;
  site_previewed_at: string | null;
  dismissed_at: string | null;
  reminder_sent_at: string | null;
  admin_notes: string | null;
  vehicle_count: number;
  has_logo: boolean;
}

type Stage = 'done' | 'booked' | 'nudge' | 'new';

function stageOf(r: Row): Stage {
  if (r.call_completed_at) return 'done';
  if (r.call_booked_at) return 'booked';
  return Date.now() - new Date(r.tenant_created_at).getTime() >= DAY ? 'nudge' : 'new';
}

const STAGE: Record<Stage, { label: string; cls: string }> = {
  nudge: { label: 'Not booked · 24h+', cls: 'text-amber-700 dark:text-amber-400' },
  new: { label: 'Not booked yet', cls: 'text-muted-foreground' },
  booked: { label: 'Booked', cls: 'text-indigo-700 dark:text-indigo-400' },
  done: { label: 'Call done', cls: 'text-green-700 dark:text-green-400' },
};

interface CalendarEvent {
  id: string;
  received_at: string;
  email: string | null;
  name: string | null;
  status: string | null;
  starts_at: string | null;
  outcome: string;
}

const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
};

async function fnError(error: unknown, fallback: string): Promise<string> {
  try {
    const body = await (error as { context?: Response }).context?.json();
    if (body?.error) return String(body.error);
  } catch {
    /* fall through */
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export function OnboardingCallsTab({ canEdit }: { canEdit: boolean }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [notInstalled, setNotInstalled] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [due, setDue] = useState<{ due: { slug: string; email: string }[]; skipped: { slug: string; reason: string }[] } | null>(null);
  const [notesFor, setNotesFor] = useState<Row | null>(null);
  const [notes, setNotes] = useState('');
  const [unmatched, setUnmatched] = useState<CalendarEvent[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await db.rpc('admin_onboarding_calls');
      if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') {
          setNotInstalled(true);
          return;
        }
        throw error;
      }
      setRows((data as Row[]) ?? []);
      // Calendar bookings from the last 30 days that no tenant matched.
      const { data: events } = await db
        .from('onboarding_call_events')
        .select('id, received_at, email, name, status, starts_at, outcome')
        .is('tenant_id', null)
        // Only bookings whose email matched no tenant at all. A V1 customer's
        // ordinary support booking on the shared calendar is not Brian's to place.
        .eq('outcome', 'no tenant with that email')
        .gte('received_at', new Date(Date.now() - 30 * DAY).toISOString())
        .order('received_at', { ascending: false })
        .limit(20);
      setUnmatched((events as CalendarEvent[]) ?? []);
    } catch (e) {
      toast.error('Could not load onboarding calls', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<Stage, number> = { nudge: 0, new: 0, booked: 0, done: 0 };
    for (const r of rows ?? []) c[stageOf(r)] += 1;
    return c;
  }, [rows]);

  // Who needs Brian first: not booked after 24h, then booked, then new, then done.
  const sorted = useMemo(() => {
    const order: Record<Stage, number> = { nudge: 0, booked: 1, new: 2, done: 3 };
    return [...(rows ?? [])].sort(
      (a, b) => order[stageOf(a)] - order[stageOf(b)] || b.tenant_created_at.localeCompare(a.tenant_created_at),
    );
  }, [rows]);

  /** Upsert one tenant's row as super admin (RLS: super admin manages). */
  const patch = async (r: Row, values: Record<string, unknown>, done: string) => {
    setPending(`${r.tenant_id}:patch`);
    try {
      const { error } = await db
        .from('tenant_onboarding_calls')
        .upsert({ tenant_id: r.tenant_id, ...values }, { onConflict: 'tenant_id' });
      if (error) throw error;
      toast.success(done);
      await load();
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setPending(null);
    }
  };

  const remind = async (body: Record<string, unknown>, key: string) => {
    setPending(key);
    try {
      const { data, error } = await supabase.functions.invoke('onboarding-call-reminder', { body });
      if (error) throw new Error(await fnError(error, 'The reminder could not be sent.'));
      if (body.dry_run) {
        setDue({ due: data?.due ?? [], skipped: data?.skipped ?? [] });
        return;
      }
      const sent: string[] = data?.sent ?? [];
      const failed: { slug: string; error: string }[] = data?.failed ?? [];
      if (failed.length) toast.error(`Could not send to ${failed.map((f) => f.slug).join(', ')}`, { description: failed[0].error });
      if (sent.length) toast.success(`Reminder sent to ${sent.join(', ')}`);
      if (!sent.length && !failed.length) toast.info('Nobody is due a reminder right now.');
      setDue(null);
      await load();
    } catch (e) {
      toast.error('Reminder failed', { description: (e as Error).message });
    } finally {
      setPending(null);
    }
  };

  if (notInstalled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not installed</CardTitle>
          <CardDescription>
            Apply supabase/migrations/20261101130000_tenant_onboarding_calls.sql to use this tab.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const busy = pending !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Onboarding calls</h1>
          <p className={cn('max-w-2xl text-sm text-muted-foreground', PAGE_DESCRIPTION)}>
            The free 30-minute call every new Portal V2 operator is offered on their home screen. Reach out to anyone
            who has not booked after 24 hours, and mark the call done once you have had it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={BOOKING_URL} target="_blank" rel="noreferrer">
              <CalendarDays className="mr-2 h-4 w-4" />
              Booking calendar
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {(['nudge', 'new', 'booked', 'done'] as Stage[]).map((s) => (
          <Card key={s}>
            <CardContent className="p-4">
              <p className={cn('text-xs font-medium', STAGE[s].cls)}>{STAGE[s].label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{loading && !rows ? '—' : counts[s]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── the 24h reminder ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>24-hour reminder email</CardTitle>
          <CardDescription>
            Sent automatically every hour: one email, once, to a V2 operator on a trial or paid plan who signed up
            1–14 days ago and has not booked. You can check who is due and send now instead of waiting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void remind({ dry_run: true }, 'dry')}>
              {pending === 'dry' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Check who is due
            </Button>
            {due && due.due.length > 0 && canEdit && (
              <Button size="sm" disabled={busy} onClick={() => void remind({}, 'all')}>
                {pending === 'all' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                Send to {due.due.length} operator{due.due.length === 1 ? '' : 's'}
              </Button>
            )}
          </div>
          {due && (
            <div className="rounded-xl border p-3 text-sm">
              {due.due.length === 0 ? (
                <p className="text-muted-foreground">Nobody is due a reminder right now.</p>
              ) : (
                <ul className="space-y-1">
                  {due.due.map((d) => (
                    <li key={d.slug}>
                      <span className="font-medium">{d.slug}</span> <span className="text-muted-foreground">· {d.email}</span>
                    </li>
                  ))}
                </ul>
              )}
              {due.skipped.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Not due: {due.skipped.map((s) => `${s.slug} (${s.reason})`).join(', ')}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── every operator ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Operators</CardTitle>
          <CardDescription>Not booked after 24 hours first. The checklist is what they did before the call.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !rows ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No new Portal V2 operators right now.</p>
          ) : (
            <ul className="divide-y">
              {sorted.map((r) => {
                const st = STAGE[stageOf(r)];
                const rowBusy = pending?.startsWith(r.tenant_id) ?? false;
                return (
                  <li key={r.tenant_id} className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:gap-6">
                    <div className="min-w-0 lg:w-[30%]">
                      <p className="truncate text-sm font-medium">
                        {r.company_name || r.slug}
                        <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{r.slug}</span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.contact_email ?? 'no email'} · signed up {ago(r.tenant_created_at)}
                        {r.subscription_status && ` · ${r.subscription_status}`}
                        {r.trial_end && r.subscription_status === 'trialing' && ` until ${fmtWhen(r.trial_end).split(',')[0]}`}
                      </p>
                    </div>
                    <div className="lg:w-[16%]">
                      <p className={cn('text-xs font-medium', st.cls)}>{st.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {r.call_completed_at
                          ? fmtWhen(r.call_completed_at)
                          : r.call_booked_at
                            ? r.call_scheduled_for
                              ? `Call ${fmtWhen(r.call_scheduled_for)}`
                              : `${fmtWhen(r.call_booked_at)}${r.call_booked_via === 'admin' ? ' · by you' : ' · said they booked'}`
                            : r.reminder_sent_at
                              ? `Reminded ${fmtWhen(r.reminder_sent_at)}`
                              : r.dismissed_at
                                ? 'Hid the card'
                                : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 lg:flex-1">
                      <Tick ok={r.vehicle_count > 0} label={r.vehicle_count > 0 ? `${r.vehicle_count} vehicle${r.vehicle_count === 1 ? '' : 's'}` : 'No vehicle'} />
                      <Tick ok={r.has_logo} label="Logo" />
                      <Tick ok={!!r.site_previewed_at} label="Saw website" />
                      {r.admin_notes && (
                        <span className="inline-flex max-w-[16rem] items-center gap-1 truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          <StickyNote className="h-3 w-3 shrink-0" />
                          <span className="truncate">{r.admin_notes}</span>
                        </span>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                        {rowBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        {!r.call_completed_at && !r.call_booked_at && (
                          <>
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remind({ tenant_id: r.tenant_id }, `${r.tenant_id}:remind`)}>
                              <Mail className="mr-1.5 h-3.5 w-3.5" />
                              Send reminder
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                void patch(r, { call_booked_at: new Date().toISOString(), call_booked_via: 'admin' }, `${r.company_name || r.slug} marked as booked`)
                              }
                            >
                              <CalendarCheck className="mr-1.5 h-3.5 w-3.5" />
                              Mark booked
                            </Button>
                          </>
                        )}
                        {!r.call_completed_at ? (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void patch(r, { call_completed_at: new Date().toISOString() }, `Call with ${r.company_name || r.slug} marked done`)
                            }
                          >
                            <Check className="mr-1.5 h-3.5 w-3.5" />
                            Mark call done
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void patch(r, { call_completed_at: null }, 'Marked as not done')}>
                            Undo done
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setNotes(r.admin_notes ?? '');
                            setNotesFor(r);
                          }}
                        >
                          Notes
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                          <a href={`https://${r.slug}.drive-247.com`} target="_blank" rel="noreferrer" aria-label={`Open ${r.slug}'s website`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {unmatched.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Calendar bookings we could not match</CardTitle>
            <CardDescription>
              Booked on your calendar with an email that belongs to no operator. Find them above and use Mark booked.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {unmatched.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
                  <span>
                    <span className="font-medium">{e.name || e.email || 'Unknown'}</span>
                    {e.name && e.email && <span className="text-muted-foreground"> · {e.email}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.status ?? 'booked'}
                    {e.starts_at && ` · call ${fmtWhen(e.starts_at)}`} · received {fmtWhen(e.received_at)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={notesFor !== null} onOpenChange={(o) => !o && pending === null && setNotesFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Notes · {notesFor?.company_name || notesFor?.slug}</DialogTitle>
            <DialogDescription>Blockers, what you covered, what to follow up before the trial ends.</DialogDescription>
          </DialogHeader>
          <Textarea rows={5} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!notesFor) return;
                await patch(notesFor, { admin_notes: notes.trim() || null }, 'Notes saved');
                setNotesFor(null);
              }}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save notes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Tick({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
        ok ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground',
      )}
    >
      {ok && <Check className="h-3 w-3" />}
      {label}
    </span>
  );
}
