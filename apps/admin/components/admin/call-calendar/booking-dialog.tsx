'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarClock, Check, ExternalLink, Loader2, RotateCcw, UserX, X } from 'lucide-react';

import { toast } from '@/components/ui/sonner';
import { confirmDialog, promptDialog } from '@/components/ui/confirm';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { db, errorText, flushMailer, STATE_STYLE, WHO, type CallDetail, type HistoryRow, type Status } from './shared';
import { formatFull, formatStamp } from './time';
import { SlotPicker } from './slot-picker';

/** One booking's details and Bryan's actions on it (spec 10.9 to 10.11). */
export function BookingDialog({
  id,
  hostTz,
  version,
  onClose,
  onChanged,
}: {
  id: string | null;
  hostTz: string;
  version: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [moving, setMoving] = useState(false);
  const [newTime, setNewTime] = useState<string | null>(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const shownId = useRef(id);
  shownId.current = id;

  const load = useCallback(async (bookingId: string) => {
    const { data, error } = await db.rpc('admin_onboarding_call_detail', { p_id: bookingId });
    if (shownId.current !== bookingId) return;
    if (error) {
      toast.error(errorText(error));
      closeRef.current();
      return;
    }
    setDetail(data as CallDetail);
  }, []);

  useEffect(() => {
    setDetail(null);
    setMoving(false);
    setNewTime(null);
    if (id) void load(id);
  }, [id, load]);

  // Someone else changed bookings: keep the open one fresh.
  useEffect(() => {
    if (id && version > 0) void load(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  useEffect(() => {
    setNote(detail?.admin_notes ?? '');
  }, [detail?.id, detail?.admin_notes]);

  const run = async (key: string, fn: () => Promise<{ error: unknown }>, done: string, emails: boolean) => {
    if (!detail) return false;
    setBusy(key);
    const { error } = await fn();
    setBusy(null);
    if (error) {
      toast.error(errorText(error));
      return false;
    }
    toast.success(done);
    if (emails) flushMailer();
    onChanged();
    await load(detail.id);
    return true;
  };

  if (!id) return null;
  const d = detail;
  const company = d?.company_name || d?.slug || 'this company';
  const started = d ? new Date(d.starts_at).getTime() <= Date.now() : false;
  const canMark = d && started && (d.status === 'booked' || d.status === 'completed' || d.status === 'missed');

  const mark = async (status: Exclude<Status, 'cancelled'>) => {
    if (!d) return;
    if (status === 'missed') {
      const ok = await confirmDialog({
        title: `Mark the call with ${company} missed?`,
        description: 'The company is emailed "Sorry we missed you" and offered the call again.',
        confirmLabel: 'Mark missed',
        cancelLabel: 'Go back',
      });
      if (!ok) return;
    }
    const label = status === 'completed' ? 'Marked done' : status === 'missed' ? 'Marked missed' : 'Put back';
    await run(
      status,
      () => db.rpc('admin_set_onboarding_call_booking', { p_id: d.id, p_status: status, p_admin_notes: null }),
      label,
      status === 'missed',
    );
  };

  const cancel = async () => {
    if (!d) return;
    const reason = await promptDialog({
      title: `Cancel the call with ${company}?`,
      description: 'The company is emailed with your reason, and the time is free again.',
      placeholder: 'Why the call is cancelled. The company reads this.',
      confirmLabel: 'Cancel the call',
      cancelLabel: 'Keep it',
      destructive: true,
      minLength: 1,
    });
    if (reason === null) return;
    await run('cancel', () => db.rpc('admin_cancel_onboarding_call', { p_id: d.id, p_reason: reason.trim() }), 'Call cancelled', true);
  };

  const move = async () => {
    if (!d || !newTime) return;
    const ok = await confirmDialog({
      title: `Move the call to ${formatFull(newTime, hostTz)}?`,
      description: d.customer_timezone
        ? `The company is emailed the new time: ${formatFull(newTime, d.customer_timezone)}.`
        : 'The company is emailed the new time.',
      confirmLabel: 'Move the call',
      cancelLabel: 'Go back',
    });
    if (!ok) return;
    const moved = await run('move', () => db.rpc('admin_move_onboarding_call', { p_id: d.id, p_starts_at: newTime }), 'Call moved', true);
    if (moved) {
      setMoving(false);
      setNewTime(null);
    }
  };

  const saveNote = () =>
    run('note', () => db.rpc('admin_note_onboarding_call', { p_id: d!.id, p_admin_notes: note }), 'Note saved', false);

  const state = d ? STATE_STYLE[d.state] : null;

  return (
    <Dialog open={!!id} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] max-w-2xl overflow-y-auto shadow-none">
        <DialogHeader className="min-w-0 pr-6 text-left">
          <DialogTitle className="leading-snug [overflow-wrap:anywhere]">
            {d ? (
              <Link href={`/admin/rentals/${d.tenant_id}`} className="hover:underline">
                {company}
              </Link>
            ) : (
              'Loading the call'
            )}
          </DialogTitle>
          <DialogDescription>
            {d && state ? (
              <>
                <span className={cn('font-medium', state.className)}>{state.label}</span>
                {d.status === 'cancelled' && d.cancelled_by && <> · Cancelled by {WHO[d.cancelled_by]}</>}
                {d.booked_via === 'admin' && <> · Booked by Bryan</>}
              </>
            ) : (
              'One moment'
            )}
          </DialogDescription>
        </DialogHeader>

        {!d ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : moving ? (
          <div className="min-w-0 space-y-4">
            <p className="text-sm text-muted-foreground">
              Now {formatFull(d.starts_at, hostTz)}. Pick a new time. Notice does not apply to you.
            </p>
            <SlotPicker hostTz={hostTz} companyTz={d.customer_timezone} exclude={d.id} value={newTime} onChange={setNewTime} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setMoving(false)} disabled={busy === 'move'}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Back
              </Button>
              <Button size="sm" onClick={() => void move()} disabled={!newTime || busy === 'move'}>
                {busy === 'move' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Move the call
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-w-0 space-y-5">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="Bryan's time">{formatFull(d.starts_at, hostTz)}</Item>
              <Item label="The company's time">
                {d.customer_timezone ? formatFull(d.starts_at, d.customer_timezone) : 'Zone unknown'}
              </Item>
              <Item label="Person">{d.name}</Item>
              <Item label="Email">
                <a href={`mailto:${d.email}`} className="hover:underline [overflow-wrap:anywhere]">
                  {d.email}
                </a>
              </Item>
              <Item label="Phone">
                {d.phone ? (
                  <a href={`tel:${d.phone}`} className="hover:underline">
                    {d.phone}
                  </a>
                ) : (
                  <span className="text-muted-foreground">None given</span>
                )}
              </Item>
              <Item label="Call link">
                {d.meeting_url ? (
                  <a href={d.meeting_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline [overflow-wrap:anywhere]">
                    {d.meeting_url}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )}
              </Item>
              <div className="sm:col-span-2">
                <Item label="Their note">
                  {d.notes ? <span className="whitespace-pre-line">{d.notes}</span> : <span className="text-muted-foreground">None</span>}
                </Item>
              </div>
              {d.status === 'cancelled' && d.cancel_reason && (
                <div className="sm:col-span-2">
                  <Item label="Why it was cancelled">{d.cancel_reason}</Item>
                </div>
              )}
            </dl>

            <div className="flex flex-wrap gap-2">
              {canMark && d.status !== 'completed' && (
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void mark('completed')}>
                  {busy === 'completed' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                  Done
                </Button>
              )}
              {canMark && d.status !== 'missed' && (
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void mark('missed')}>
                  {busy === 'missed' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <UserX className="mr-1.5 h-3.5 w-3.5" />}
                  Missed
                </Button>
              )}
              {d.status === 'booked' && (
                <>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setMoving(true)}>
                    <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
                    Move
                  </Button>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void cancel()} className="text-destructive">
                    {busy === 'cancel' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <X className="mr-1.5 h-3.5 w-3.5" />}
                    Cancel
                  </Button>
                </>
              )}
              {d.status !== 'booked' && (
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void mark('booked')}>
                  {busy === 'booked' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                  Put back
                </Button>
              )}
            </div>
            {d.status === 'booked' && !started && (
              <p className="-mt-3 text-xs text-muted-foreground">Done and Missed show once the call&apos;s time has passed.</p>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Your note (only you see it)</p>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you talked about, what to follow up on." className="min-h-[72px]" />
              <div className="flex justify-end">
                <Button size="sm" variant="outline" disabled={!!busy || note.trim() === (d.admin_notes ?? '').trim()} onClick={() => void saveNote()}>
                  {busy === 'note' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save note
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">History</p>
              {d.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ol className="space-y-2 border-l pl-4">
                  {d.history.map((h, i) => (
                    <li key={i} className="text-sm">
                      <p>{historyText(h, hostTz)}</p>
                      {h.reason && <p className="text-xs text-muted-foreground">Reason: {h.reason}</p>}
                      <p className="text-xs text-muted-foreground">{formatStamp(h.created_at, hostTz)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

function who(h: HistoryRow): string {
  if (h.actor === 'system') return 'the system';
  if (h.actor === 'admin') return h.actor_name || 'Bryan';
  return h.actor_name ? `${h.actor_name} (company)` : 'the company';
}

function historyText(h: HistoryRow, tz: string): string {
  const at = (t: string | null) => (t ? formatFull(t, tz) : 'a time');
  switch (h.kind) {
    case 'booked':
      return `Booked by ${who(h)} for ${at(h.to_starts_at)}`;
    case 'moved':
      return `Moved by ${who(h)} from ${at(h.from_starts_at)} to ${at(h.to_starts_at)}`;
    case 'cancelled':
      return `Cancelled by ${who(h)}`;
    case 'completed':
      return `Marked done by ${who(h)}`;
    case 'missed':
      return h.actor === 'system' ? 'Closed as missed by the system' : `Marked missed by ${who(h)}`;
    case 'reopened':
      return `Put back by ${who(h)}`;
    default:
      return String(h.kind);
  }
}
