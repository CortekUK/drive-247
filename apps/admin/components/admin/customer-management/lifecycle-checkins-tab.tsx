'use client';

/**
 * Lifecycle check-ins — planned touch-points over a new operator's first months
 * (14 / 30 / 60 / 90 days). Each one is either an email sent to the operator or
 * a task for our team.
 *
 * The runner (`lifecycle-checkins-run`, hourly) does the work:
 *   - new tenants only: a check-in applies to tenants who signed up after it was
 *     switched on (`active_since`, stamped by a DB trigger)
 *   - once per tenant per check-in (lifecycle_checkin_runs is unique on both)
 *   - test tenants and suspended tenants are left out
 * Team tasks are created in admin_todos for the tenant and listed here.
 *
 * Reads and writes go through the super admin's own session (RLS is
 * is_super_admin()); preview / run now / test send call the edge function.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, ClipboardList, Eye, Loader2, Mail, Pencil, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';

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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type Kind = 'email' | 'task';

interface Checkin {
  id: string;
  day_offset: number;
  kind: Kind;
  label: string;
  subject: string | null;
  body: string | null;
  task_note: string | null;
  enabled: boolean;
  active_since: string | null;
}

interface RunRow {
  id: string;
  status: 'sent' | 'failed' | 'task_created' | 'skipped';
  to_email: string | null;
  subject: string | null;
  detail: string | null;
  created_at: string;
  todo_id: string | null;
  tenants: { company_name: string | null; slug: string } | null;
  lifecycle_checkins: { day_offset: number; label: string; kind: Kind } | null;
  admin_todos: { status: string } | null;
}

interface PreviewRow {
  tenant: string;
  checkin: string;
  kind: Kind;
  to: string | null;
  due_at: string;
  would: string;
}

interface Draft {
  id: string | null;
  kind: Kind;
  day: string;
  label: string;
  subject: string;
  body: string;
  taskNote: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const VARIABLES = ['tenant_name', 'portal_url', 'booking_url', 'sign_in_email', 'tenant_contact_email', 'days_since_signup'];

const STATUS: Record<RunRow['status'], { label: string; className: string }> = {
  sent: { label: 'Email sent', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  task_created: { label: 'Task created', className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  skipped: { label: 'Skipped', className: 'bg-muted text-muted-foreground' },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function emptyDraft(kind: Kind = 'email'): Draft {
  return { id: null, kind, day: '14', label: '', subject: '', body: '', taskNote: '' };
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('lifecycle-checkins-run', { body });
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

export function LifecycleCheckinsTab({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ due: number; rows: PreviewRow[] } | null>(null);
  const [busy, setBusy] = useState<'preview' | null>(null);
  const [testFor, setTestFor] = useState<Checkin | null>(null);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Checkin | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r] = await Promise.all([
        db.from('lifecycle_checkins').select('*').order('day_offset', { ascending: true }),
        db
          .from('lifecycle_checkin_runs')
          .select(
            'id, status, to_email, subject, detail, created_at, todo_id, tenants(company_name, slug), lifecycle_checkins(day_offset, label, kind), admin_todos(status)',
          )
          .order('created_at', { ascending: false })
          .limit(100),
      ]);
      if (c.error) throw c.error;
      if (r.error) throw r.error;
      setCheckins((c.data as Checkin[]) ?? []);
      setRuns((r.data as RunRow[]) ?? []);
    } catch (e) {
      toast.error('Could not load check-ins', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openTasks = useMemo(
    () => runs.filter((r) => r.status === 'task_created' && r.todo_id && r.admin_todos?.status !== 'done'),
    [runs],
  );

  async function save() {
    if (!draft) return;
    const day = Number(draft.day);
    if (!Number.isInteger(day) || day < 1 || day > 365) {
      toast.error('Days after signup must be a whole number from 1 to 365');
      return;
    }
    if (!draft.label.trim()) {
      toast.error('Give the check-in a name');
      return;
    }
    if (draft.kind === 'email' && (!draft.subject.trim() || !draft.body.trim())) {
      toast.error('An email needs a subject and a message');
      return;
    }
    setSaving(true);
    try {
      const row = {
        day_offset: day,
        kind: draft.kind,
        label: draft.label.trim(),
        subject: draft.kind === 'email' ? draft.subject.trim() : null,
        body: draft.kind === 'email' ? draft.body : null,
        task_note: draft.kind === 'task' ? draft.taskNote.trim() || null : null,
      };
      const { error } = draft.id
        ? await db.from('lifecycle_checkins').update(row).eq('id', draft.id)
        : await db.from('lifecycle_checkins').insert({ ...row, enabled: false });
      if (error) throw error;
      toast.success(draft.id ? 'Check-in saved' : 'Check-in added — switch it on when it reads right');
      setDraft(null);
      await load();
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function toggle(c: Checkin, enabled: boolean) {
    const { error } = await db.from('lifecycle_checkins').update({ enabled }).eq('id', c.id);
    if (error) {
      toast.error('Could not update', { description: error.message });
      return;
    }
    toast.success(enabled ? `On — tenants who sign up from now get it on day ${c.day_offset}` : 'Switched off');
    await load();
  }

  async function remove(c: Checkin) {
    const { error } = await db.from('lifecycle_checkins').delete().eq('id', c.id);
    if (error) {
      toast.error('Could not delete', { description: error.message });
      return;
    }
    setConfirmDelete(null);
    toast.success('Check-in deleted');
    await load();
  }

  async function runPreview() {
    setBusy('preview');
    try {
      const data = await invoke({ action: 'preview' });
      setPreview({ due: data?.due ?? 0, rows: (data?.results as PreviewRow[]) ?? [] });
    } catch (e) {
      toast.error('Preview failed', { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    if (!testFor) return;
    setTesting(true);
    try {
      await invoke({ action: 'test', checkinId: testFor.id, to: testTo.trim() });
      toast.success(`Test sent to ${testTo.trim()}`);
      setTestFor(null);
    } catch (e) {
      toast.error('Test send failed', { description: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function markDone(todoId: string) {
    const { error } = await db.from('admin_todos').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', todoId);
    if (error) {
      toast.error('Could not update the task', { description: error.message });
      return;
    }
    toast.success('Task done');
    await load();
  }

  if (loading && checkins.length === 0) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── The plan ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-primary" />
                Lifecycle check-ins
              </CardTitle>
              <CardDescription>
                Planned touch-points over a new operator&apos;s first months. Each check-in goes out once, on its day after
                signup, to <span className="font-medium text-foreground">tenants who sign up after it is switched on</span>. Switching
                one on is all it takes — it runs automatically from then on.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void runPreview()} disabled={!!busy}>
                {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                What&apos;s due now
              </Button>
              {canEdit && (
                <Button size="sm" className="gap-1.5" onClick={() => setDraft(emptyDraft())}>
                  <Plus className="h-4 w-4" />
                  Add check-in
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {checkins.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No check-ins yet. Add one to start.</p>
          ) : (
            <ol className="relative space-y-3">
              {checkins.map((c) => (
                <li key={c.id} className={cn('flex flex-wrap items-center gap-4 rounded-lg border p-4', !c.enabled && 'bg-muted/30')}>
                  <div className="flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-md bg-primary/10 text-primary">
                    <span className="text-[10px] font-medium uppercase leading-none">Day</span>
                    <span className="text-lg font-bold leading-tight tabular-nums">{c.day_offset}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{c.label}</p>
                      <Badge variant="secondary" className="gap-1">
                        {c.kind === 'email' ? <Mail className="h-3 w-3" /> : <ClipboardList className="h-3 w-3" />}
                        {c.kind === 'email' ? 'Email to operator' : 'Task for our team'}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {c.kind === 'email' ? c.subject : c.task_note || 'No note'}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {c.enabled && c.active_since
                        ? `Automatic — on since ${formatDate(c.active_since)}, for operators who sign up from then`
                        : 'Off — nobody gets this'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {c.kind === 'email' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => {
                          setTestTo(user?.email ?? '');
                          setTestFor(c);
                        }}
                      >
                        <Send className="h-3.5 w-3.5" />
                        Test
                      </Button>
                    )}
                    {canEdit && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Edit"
                          onClick={() =>
                            setDraft({
                              id: c.id,
                              kind: c.kind,
                              day: String(c.day_offset),
                              label: c.label,
                              subject: c.subject ?? '',
                              body: c.body ?? '',
                              taskNote: c.task_note ?? '',
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => setConfirmDelete(c)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <Switch checked={c.enabled} onCheckedChange={(v) => void toggle(c, v)} aria-label="On" className="ml-2" />
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
                {preview.due === 0 ? 'Nothing is due right now.' : `${preview.due} check-in${preview.due === 1 ? '' : 's'} due now — nothing has been sent.`}
              </p>
              {preview.rows.length > 0 && (
                <Table className="mt-3">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Check-in</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Would</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{r.tenant}</TableCell>
                        <TableCell>{r.checkin}</TableCell>
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

      {/* ── Team tasks ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Open team tasks
          </CardTitle>
          <CardDescription>Created by &ldquo;task for our team&rdquo; check-ins. Mark them done once handled.</CardDescription>
        </CardHeader>
        <CardContent>
          {openTasks.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No open tasks.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[1%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {openTasks.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.tenants?.company_name || r.tenants?.slug}</TableCell>
                    <TableCell>
                      Day {r.lifecycle_checkins?.day_offset}: {r.lifecycle_checkins?.label}
                    </TableCell>
                    <TableCell>{formatDate(r.created_at)}</TableCell>
                    <TableCell>
                      {canEdit && (
                        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void markDone(r.todo_id!)}>
                          <CheckCircle2 className="h-4 w-4" />
                          Done
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Log ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>The last 100 check-ins the system handled.</CardDescription>
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
                  <TableHead>Check-in</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.created_at)}</TableCell>
                    <TableCell className="font-medium">{r.tenants?.company_name || r.tenants?.slug}</TableCell>
                    <TableCell>
                      Day {r.lifecycle_checkins?.day_offset}: {r.lifecycle_checkins?.label}
                    </TableCell>
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
            <DialogTitle>{draft?.id ? 'Edit check-in' : 'Add check-in'}</DialogTitle>
            <DialogDescription>Sent once to each new operator, on the day you choose after they sign up.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {(['email', 'task'] as Kind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setDraft({ ...draft, kind: k })}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors',
                      draft.kind === k ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50',
                    )}
                  >
                    {k === 'email' ? <Mail className="h-4 w-4 text-primary" /> : <ClipboardList className="h-4 w-4 text-primary" />}
                    <span>
                      <span className="block font-medium">{k === 'email' ? 'Email to the operator' : 'Task for our team'}</span>
                      <span className="block text-xs text-muted-foreground">
                        {k === 'email' ? 'Sent automatically' : 'Shows up under Open team tasks'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="lc-day">Days after signup</Label>
                  <Input id="lc-day" type="number" min={1} max={365} value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lc-label">Name</Label>
                  <Input
                    id="lc-label"
                    placeholder={draft.kind === 'email' ? "e.g. How's it going? survey" : 'e.g. Call with our team'}
                    value={draft.label}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  />
                </div>
              </div>
              {draft.kind === 'email' ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="lc-subject">Subject</Label>
                    <Input id="lc-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lc-body">Message</Label>
                    <Textarea
                      id="lc-body"
                      rows={12}
                      value={draft.body}
                      onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                      placeholder={'Hi {{tenant_name}},\n\n…'}
                    />
                    <p className="text-xs text-muted-foreground">
                      Plain text: a blank line starts a new paragraph, a line starting with &ldquo;- &rdquo; is a bullet, links
                      become clickable. You can use{' '}
                      {VARIABLES.map((v, i) => (
                        <span key={v}>
                          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{`{{${v}}}`}</code>
                          {i < VARIABLES.length - 1 ? ' ' : ''}
                        </span>
                      ))}
                      .
                    </p>
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="lc-note">What should the team do?</Label>
                  <Textarea
                    id="lc-note"
                    rows={5}
                    value={draft.taskNote}
                    onChange={(e) => setDraft({ ...draft, taskNote: e.target.value })}
                    placeholder="e.g. Book a 20-minute call: how the first 3 months went, what's missing."
                  />
                </div>
              )}
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
            <DialogDescription>
              &ldquo;{testFor?.label}&rdquo;, filled in with a sample company, sent only to the address below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="lc-test">Send to</Label>
            <Input id="lc-test" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
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
