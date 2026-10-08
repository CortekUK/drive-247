'use client';

/**
 * Milestone Celebrations — congratulate v2 operators when they hit a milestone
 * (first booking, 10 bookings, 5 cars, ...).
 *
 * Same shape as Marketing Instructions Emails:
 *   - a super admin creates milestones: a metric, a threshold and the email
 *   - `milestones-run` (pg_cron, every 15 minutes) counts each v2 tenant's
 *     bookings / fleet / customers and emails a tenant once when they cross a
 *     switched-on milestone
 *   - a tenant already past a milestone when it was switched on is logged as
 *     "already reached" and not emailed
 *
 * The page also shows each v2 tenant's progress and the full history.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Loader2, Pencil, Plus, RefreshCw, Send, Trash2, Trophy } from 'lucide-react';

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

type Metric = 'bookings' | 'completed_rentals' | 'fleet_size' | 'customers';

interface Milestone {
  id: string;
  metric: Metric;
  threshold: number;
  label: string;
  subject: string;
  body: string;
  enabled: boolean;
  active_since: string | null;
}

interface Achievement {
  id: string;
  metric_value: number;
  status: 'sent' | 'failed' | 'skipped';
  to_email: string | null;
  detail: string | null;
  achieved_at: string;
  email_sent_at: string | null;
  tenants: { company_name: string | null; slug: string } | null;
  milestones: { label: string; metric: Metric } | null;
}

interface Overview {
  due: number;
  tenants: {
    id: string;
    name: string;
    slug: string;
    counts: Record<Metric, number>;
    next: { metric: Metric; label: string; threshold: number; current: number }[];
  }[];
  dueRows: { tenant: string; milestone: string; value: number; to: string | null }[];
}

interface Draft {
  id: string | null;
  metric: Metric;
  threshold: string;
  label: string;
  subject: string;
  body: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const METRICS: { id: Metric; label: string; unit: string; hint: string }[] = [
  { id: 'bookings', label: 'Bookings', unit: 'bookings', hint: 'Every rental that was not cancelled or rejected' },
  { id: 'completed_rentals', label: 'Completed rentals', unit: 'completed rentals', hint: 'Rentals closed out' },
  { id: 'fleet_size', label: 'Fleet size', unit: 'cars', hint: 'Vehicles in the fleet, not counting disposed ones' },
  { id: 'customers', label: 'Customers', unit: 'customers', hint: 'Customer records' },
];
const METRIC = Object.fromEntries(METRICS.map((m) => [m.id, m])) as Record<Metric, (typeof METRICS)[number]>;

const VARIABLES = ['tenant_name', 'milestone_value', 'current_value', 'metric_label', 'booking_url', 'portal_url'];

const STATUS: Record<Achievement['status'], { label: string; className: string }> = {
  sent: { label: 'Email sent', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  skipped: { label: 'Not emailed', className: 'bg-muted text-muted-foreground' },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('milestones-run', { body });
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

export function MilestonesTab({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [history, setHistory] = useState<Achievement[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | Achievement['status']>('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [testFor, setTestFor] = useState<Milestone | null>(null);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Milestone | null>(null);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      setOverview((await invoke({ action: 'overview' })) as Overview);
    } catch (e) {
      toast.error('Could not load tenant progress', { description: (e as Error).message });
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, h] = await Promise.all([
        db.from('milestones').select('*').order('metric').order('threshold'),
        db
          .from('milestone_achievements')
          .select('id, metric_value, status, to_email, detail, achieved_at, email_sent_at, tenants(company_name, slug), milestones(label, metric)')
          .order('achieved_at', { ascending: false })
          .limit(300),
      ]);
      if (m.error) throw m.error;
      if (h.error) throw h.error;
      setMilestones((m.data as Milestone[]) ?? []);
      setHistory((h.data as Achievement[]) ?? []);
    } catch (e) {
      toast.error('Could not load milestones', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(
    () => METRICS.map((metric) => ({ metric, items: milestones.filter((m) => m.metric === metric.id) })).filter((g) => g.items.length > 0),
    [milestones],
  );

  const shownHistory = historyFilter === 'all' ? history : history.filter((h) => h.status === historyFilter);
  const sentCount = history.filter((h) => h.status === 'sent').length;

  async function save() {
    if (!draft) return;
    const threshold = Number(draft.threshold);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 1_000_000) {
      toast.error('The target must be a whole number of 1 or more');
      return;
    }
    if (!draft.label.trim() || !draft.subject.trim() || !draft.body.trim()) {
      toast.error('A milestone needs a name, a subject and a message');
      return;
    }
    setSaving(true);
    try {
      const row = {
        metric: draft.metric,
        threshold,
        label: draft.label.trim(),
        subject: draft.subject.trim(),
        body: draft.body,
      };
      const { error } = draft.id
        ? await db.from('milestones').update(row).eq('id', draft.id)
        : await db.from('milestones').insert({ ...row, enabled: false });
      if (error) {
        if (error.code === '23505') throw new Error(`There is already a milestone for ${threshold} ${METRIC[draft.metric].unit}`);
        throw error;
      }
      toast.success(draft.id ? 'Milestone saved' : 'Milestone added — switch it on when it reads right');
      setDraft(null);
      await load();
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function toggle(m: Milestone, enabled: boolean) {
    const { error } = await db.from('milestones').update({ enabled }).eq('id', m.id);
    if (error) {
      toast.error('Could not update', { description: error.message });
      return;
    }
    toast.success(enabled ? 'On — v2 operators who reach it from now get the email' : 'Switched off');
    await load();
  }

  async function remove(m: Milestone) {
    const { error } = await db.from('milestones').delete().eq('id', m.id);
    if (error) {
      toast.error('Could not delete', { description: error.message });
      return;
    }
    setConfirmDelete(null);
    toast.success('Milestone deleted');
    await load();
  }

  async function sendTest() {
    if (!testFor) return;
    setTesting(true);
    try {
      await invoke({ action: 'test', milestoneId: testFor.id, to: testTo.trim() });
      toast.success(`Test sent to ${testTo.trim()}`);
      setTestFor(null);
    } catch (e) {
      toast.error('Test send failed', { description: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  if (loading && milestones.length === 0) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Milestones ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-primary" />
                Milestone Celebrations
              </CardTitle>
              <CardDescription>
                A congratulations email when a <span className="font-medium text-foreground">v2 operator</span> reaches a
                milestone, sent once each. Progress is checked automatically every 15 minutes. Operators who were already past a
                milestone when you switch it on are logged, not emailed.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </Button>
              {canEdit && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setDraft({ id: null, metric: 'bookings', threshold: '', label: '', subject: '', body: '' })}
                >
                  <Plus className="h-4 w-4" />
                  Add milestone
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {grouped.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No milestones yet. Add one to start celebrating.</p>
          ) : (
            grouped.map(({ metric, items }) => (
              <div key={metric.id} className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{metric.label}</p>
                <ol className="space-y-2">
                  {items.map((m) => (
                    <li key={m.id} className={cn('flex flex-wrap items-center gap-4 rounded-lg border p-4', !m.enabled && 'bg-muted/30')}>
                      <div className="flex h-12 min-w-14 shrink-0 flex-col items-center justify-center rounded-md bg-primary/10 px-2 text-primary">
                        <span className="text-lg font-bold leading-tight tabular-nums">{m.threshold.toLocaleString()}</span>
                        <span className="text-[10px] font-medium uppercase leading-none">{metric.unit}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{m.label}</p>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">{m.subject}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {m.enabled && m.active_since
                            ? `Automatic — on since ${formatDateTime(m.active_since)}`
                            : 'Off — nobody gets this'}
                          {' · '}
                          {history.filter((h) => h.milestones?.label === m.label && h.status === 'sent').length} celebrated
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => {
                            setTestTo(user?.email ?? '');
                            setTestFor(m);
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
                                  id: m.id,
                                  metric: m.metric,
                                  threshold: String(m.threshold),
                                  label: m.label,
                                  subject: m.subject,
                                  body: m.body,
                                })
                              }
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => setConfirmDelete(m)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <Switch checked={m.enabled} onCheckedChange={(v) => void toggle(m, v)} aria-label="On" className="ml-2" />
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ── Tenant progress ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Tenant progress</CardTitle>
              <CardDescription>
                Every active v2 operator&apos;s current numbers and the next switched-on milestone they are heading for.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void loadOverview()} disabled={overviewLoading}>
              {overviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Recount
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!overview ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <>
              {overview.due > 0 && (
                <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="font-medium">
                    {overview.due} celebration{overview.due === 1 ? '' : 's'} due — the next automatic run (within 15 minutes) will
                    handle {overview.due === 1 ? 'it' : 'them'}:
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {overview.dueRows.slice(0, 10).map((r, i) => (
                      <li key={i}>
                        {r.tenant} — {r.milestone} ({r.value}){r.to ? ` → ${r.to}` : ' — no email address'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {overview.tenants.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No active v2 tenants.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tenant</TableHead>
                      <TableHead className="text-right">Bookings</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">Fleet</TableHead>
                      <TableHead className="text-right">Customers</TableHead>
                      <TableHead>Next milestone</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.tenants.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.counts.bookings}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.counts.completed_rentals}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.counts.fleet_size}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.counts.customers}</TableCell>
                        <TableCell>
                          {t.next.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="space-y-1.5">
                              {t.next.map((n) => (
                                <div key={n.metric} className="min-w-[180px]">
                                  <div className="flex justify-between gap-2 text-xs">
                                    <span>{n.label}</span>
                                    <span className="tabular-nums text-muted-foreground">
                                      {n.current}/{n.threshold}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className="h-full rounded-full bg-primary"
                                      style={{ width: `${Math.min(100, (n.current / n.threshold) * 100)}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── History ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Achievement history</CardTitle>
              <CardDescription>
                Which operators reached which milestones, and when their email went out. {sentCount} celebrated so far.
              </CardDescription>
            </div>
            <Select value={historyFilter} onValueChange={(v) => setHistoryFilter(v as typeof historyFilter)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="sent">Email sent</SelectItem>
                <SelectItem value="skipped">Not emailed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {shownHistory.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Milestone</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead>Achieved</TableHead>
                  <TableHead>Email sent</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownHistory.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium">{h.tenants?.company_name || h.tenants?.slug}</TableCell>
                    <TableCell>{h.milestones?.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{h.metric_value}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(h.achieved_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(h.email_sent_at)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS[h.status].className}>
                        {STATUS[h.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-muted-foreground">{h.detail || h.to_email || '—'}</TableCell>
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
            <DialogTitle>{draft?.id ? 'Edit milestone' : 'Add milestone'}</DialogTitle>
            <DialogDescription>Sent once to each v2 operator, the first time they reach it.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="grid grid-cols-[1fr_140px] gap-3">
                <div className="space-y-1.5">
                  <Label>When the tenant reaches</Label>
                  <Select value={draft.metric} onValueChange={(v) => setDraft({ ...draft, metric: v as Metric })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METRICS.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ms-threshold">Target</Label>
                  <Input
                    id="ms-threshold"
                    type="number"
                    min={1}
                    value={draft.threshold}
                    placeholder="10"
                    onChange={(e) => setDraft({ ...draft, threshold: e.target.value })}
                  />
                </div>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">
                {METRIC[draft.metric].hint}.{' '}
                {Number(draft.threshold) > 0 && `Triggers at ${Number(draft.threshold).toLocaleString()} ${METRIC[draft.metric].unit}.`}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="ms-label">Name</Label>
                <Input
                  id="ms-label"
                  value={draft.label}
                  placeholder="10 bookings"
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ms-subject">Email subject</Label>
                <Input id="ms-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ms-body">Email message</Label>
                <Textarea
                  id="ms-body"
                  rows={12}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  placeholder={'Hi {{tenant_name}},\n\nYou just reached {{milestone_value}} {{metric_label}}!\n\n…'}
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
            <Label htmlFor="ms-test">Send to</Label>
            <Input id="ms-test" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
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
              No one else will get it, and its rows in the achievement history are removed too. To pause it instead, switch it off.
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
