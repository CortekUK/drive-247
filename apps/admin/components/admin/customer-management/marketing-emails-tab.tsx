'use client';

/**
 * Marketing Instructions Emails — a drip "course" for new v2 operators: short
 * lessons on getting more bookings, one at a time over their first weeks.
 *
 * Same shape as Lifecycle check-ins, email only:
 *   - each lesson goes out on day N after signup, or on the first chosen
 *     weekday on/after day N (9:00 in the tenant's time zone)
 *   - v2 tenants only, and only those who sign up after the lesson is switched
 *     on (`active_since`, stamped by a DB trigger)
 *   - once per tenant per lesson; switching on is the whole action — the
 *     hourly `marketing-emails-run` does the sending
 */

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Eye, GraduationCap, Loader2, Pencil, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
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
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

interface Lesson {
  id: string;
  day_offset: number;
  send_weekday: number | null;
  label: string;
  subject: string;
  body: string;
  enabled: boolean;
  active_since: string | null;
}

interface RunRow {
  id: string;
  status: 'sent' | 'failed' | 'skipped';
  to_email: string | null;
  detail: string | null;
  created_at: string;
  tenants: { company_name: string | null; slug: string } | null;
  marketing_emails: { label: string } | null;
}

interface PreviewRow {
  tenant: string;
  lesson: string;
  to: string | null;
  due_at: string;
  would: string;
}

interface Draft {
  id: string | null;
  day: string;
  /** 'exact' or a weekday 0–6 as a string. */
  timing: string;
  label: string;
  subject: string;
  body: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const VARIABLES = ['tenant_name', 'booking_url', 'portal_url', 'sign_in_email', 'tenant_contact_email'];

const STATUS: Record<RunRow['status'], { label: string; className: string }> = {
  sent: { label: 'Sent', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  skipped: { label: 'Skipped', className: 'bg-muted text-muted-foreground' },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timingText(l: Pick<Lesson, 'day_offset' | 'send_weekday'>): string {
  const day = l.day_offset === 0 ? 'the day they sign up' : `day ${l.day_offset}`;
  return l.send_weekday == null ? `On ${day}` : `First ${WEEKDAYS[l.send_weekday]} on or after ${day}, 9:00 their time`;
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('marketing-emails-run', { body });
  if (error) {
    let message = error.message;
    try {
      const parsed = await (error as { context?: Response }).context?.json();
      if (parsed?.error) message = parsed.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
  return data;
}

export function MarketingEmailsTab({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ due: number; rows: PreviewRow[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [testFor, setTestFor] = useState<Lesson | null>(null);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Lesson | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, r] = await Promise.all([
        db.from('marketing_emails').select('*').order('day_offset', { ascending: true }).order('created_at', { ascending: true }),
        db
          .from('marketing_email_runs')
          .select('id, status, to_email, detail, created_at, tenants(company_name, slug), marketing_emails(label)')
          .order('created_at', { ascending: false })
          .limit(100),
      ]);
      if (l.error) throw l.error;
      if (r.error) throw r.error;
      setLessons((l.data as Lesson[]) ?? []);
      setRuns((r.data as RunRow[]) ?? []);
    } catch (e) {
      toast.error('Could not load marketing emails', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    const day = Number(draft.day);
    if (!Number.isInteger(day) || day < 0 || day > 365) {
      toast.error('Days after signup must be a whole number from 0 to 365');
      return;
    }
    if (!draft.label.trim() || !draft.subject.trim() || !draft.body.trim()) {
      toast.error('A lesson needs a name, a subject and a message');
      return;
    }
    setSaving(true);
    try {
      const row = {
        day_offset: day,
        send_weekday: draft.timing === 'exact' ? null : Number(draft.timing),
        label: draft.label.trim(),
        subject: draft.subject.trim(),
        body: draft.body,
      };
      const { error } = draft.id
        ? await db.from('marketing_emails').update(row).eq('id', draft.id)
        : await db.from('marketing_emails').insert({ ...row, enabled: false });
      if (error) throw error;
      toast.success(draft.id ? 'Lesson saved' : 'Lesson added — switch it on when it reads right');
      setDraft(null);
      await load();
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function toggle(l: Lesson, enabled: boolean) {
    const { error } = await db.from('marketing_emails').update({ enabled }).eq('id', l.id);
    if (error) {
      toast.error('Could not update', { description: error.message });
      return;
    }
    toast.success(enabled ? 'On — new v2 operators who sign up from now get this lesson' : 'Switched off');
    await load();
  }

  async function remove(l: Lesson) {
    const { error } = await db.from('marketing_emails').delete().eq('id', l.id);
    if (error) {
      toast.error('Could not delete', { description: error.message });
      return;
    }
    setConfirmDelete(null);
    toast.success('Lesson deleted');
    await load();
  }

  async function runPreview() {
    setPreviewing(true);
    try {
      const data = await invoke({ action: 'preview' });
      setPreview({ due: data?.due ?? 0, rows: (data?.results as PreviewRow[]) ?? [] });
    } catch (e) {
      toast.error('Preview failed', { description: (e as Error).message });
    } finally {
      setPreviewing(false);
    }
  }

  async function sendTest() {
    if (!testFor) return;
    setTesting(true);
    try {
      await invoke({ action: 'test', emailId: testFor.id, to: testTo.trim() });
      toast.success(`Test sent to ${testTo.trim()}`);
      setTestFor(null);
    } catch (e) {
      toast.error('Test send failed', { description: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  if (loading && lessons.length === 0) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── The course ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5 text-primary" />
                Marketing Instructions Emails
              </CardTitle>
              <CardDescription>
                A short course for new operators on getting more bookings, one lesson at a time. Sent to{' '}
                <span className="font-medium text-foreground">v2 tenants who sign up after a lesson is switched on</span>, once
                each. Switching a lesson on is all it takes — it runs automatically from then on.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void runPreview()} disabled={previewing}>
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                What&apos;s due now
              </Button>
              {canEdit && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    setDraft({
                      id: null,
                      day: String((lessons[lessons.length - 1]?.day_offset ?? 0) + 7),
                      timing: 'exact',
                      label: `Lesson ${lessons.length + 1} — `,
                      subject: '',
                      body: '',
                    })
                  }
                >
                  <Plus className="h-4 w-4" />
                  Add lesson
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {lessons.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No lessons yet. Add one to start the course.</p>
          ) : (
            <ol className="space-y-3">
              {lessons.map((l) => (
                <li key={l.id} className={cn('flex flex-wrap items-center gap-4 rounded-lg border p-4', !l.enabled && 'bg-muted/30')}>
                  <div className="flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-md bg-primary/10 text-primary">
                    <span className="text-[10px] font-medium uppercase leading-none">Day</span>
                    <span className="text-lg font-bold leading-tight tabular-nums">{l.day_offset}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{l.label}</p>
                      <Badge variant="secondary" className="gap-1">
                        <BookOpen className="h-3 w-3" />
                        {l.send_weekday == null ? 'Exact day' : `Every ${WEEKDAYS[l.send_weekday]}`}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">{l.subject}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {timingText(l)} ·{' '}
                      {l.enabled && l.active_since ? `Automatic — on since ${formatDate(l.active_since)}` : 'Off — nobody gets this'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        setTestTo(user?.email ?? '');
                        setTestFor(l);
                      }}
                    >
                      <Send className="h-3.5 w-3.5" />
                      Test
                    </Button>
                    {canEdit && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Edit"
                          onClick={() =>
                            setDraft({
                              id: l.id,
                              day: String(l.day_offset),
                              timing: l.send_weekday == null ? 'exact' : String(l.send_weekday),
                              label: l.label,
                              subject: l.subject,
                              body: l.body,
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => setConfirmDelete(l)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <Switch checked={l.enabled} onCheckedChange={(v) => void toggle(l, v)} aria-label="On" className="ml-2" />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {preview && (
            <div className="mt-5 rounded-lg border p-4">
              <p className="text-sm font-medium">
                {preview.due === 0
                  ? 'Nothing is due right now.'
                  : `${preview.due} lesson${preview.due === 1 ? '' : 's'} due now — the hourly run will send ${preview.due === 1 ? 'it' : 'them'}.`}
              </p>
              {preview.rows.length > 0 && (
                <Table className="mt-3">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Lesson</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Will</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{r.tenant}</TableCell>
                        <TableCell>{r.lesson}</TableCell>
                        <TableCell>{formatDate(r.due_at)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.would}
                          {r.to ? ` → ${r.to}` : ''}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Log ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>The last 100 lessons the system handled.</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Lesson</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.created_at)}</TableCell>
                    <TableCell className="font-medium">{r.tenants?.company_name || r.tenants?.slug}</TableCell>
                    <TableCell>{r.marketing_emails?.label}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS[r.status].className}>
                        {STATUS[r.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-muted-foreground">{r.detail || r.to_email || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Add / edit ──────────────────────────────────────────────────── */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit lesson' : 'Add lesson'}</DialogTitle>
            <DialogDescription>Sent once to each new v2 operator, on the day you choose after they sign up.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="grid grid-cols-[140px_1fr] gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="me-day">Days after signup</Label>
                  <Input id="me-day" type="number" min={0} max={365} value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Send</Label>
                  <Select value={draft.timing} onValueChange={(v) => setDraft({ ...draft, timing: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exact">Exactly on that day</SelectItem>
                      {WEEKDAYS.map((d, i) => (
                        <SelectItem key={d} value={String(i)}>
                          On the first {d} on or after that day
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">
                {timingText({ day_offset: Number(draft.day) || 0, send_weekday: draft.timing === 'exact' ? null : Number(draft.timing) })}.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="me-label">Name</Label>
                <Input id="me-label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="me-subject">Subject</Label>
                <Input id="me-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="me-body">Message</Label>
                <Textarea
                  id="me-body"
                  rows={14}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  placeholder={'Hi {{tenant_name}},\n\n…'}
                />
                <p className="text-xs text-muted-foreground">
                  Plain text: a blank line starts a new paragraph, a line starting with &ldquo;- &rdquo; is a bullet, links become
                  clickable. You can use{' '}
                  {VARIABLES.map((v, i) => (
                    <span key={v}>
                      <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{`{{${v}}}`}</code>
                      {i < VARIABLES.length - 1 ? ' ' : ''}
                    </span>
                  ))}
                  .
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Test send ───────────────────────────────────────────────────── */}
      <Dialog open={!!testFor} onOpenChange={(o) => !o && setTestFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send a test</DialogTitle>
            <DialogDescription>&ldquo;{testFor?.label}&rdquo;, filled in with a sample company, sent only to the address below.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="me-test">Send to</Label>
            <Input id="me-test" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTestFor(null)}>
              Cancel
            </Button>
            <Button onClick={() => void sendTest()} disabled={testing || !testTo.trim()} className="gap-1.5">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete ──────────────────────────────────────────────────────── */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{confirmDelete?.label}&rdquo;?</DialogTitle>
            <DialogDescription>
              No one else will get it, and its history in Recent activity is removed too. To pause it instead, switch it off.
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
