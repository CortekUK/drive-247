'use client';

/**
 * Abandoned Recovery — renters who start a booking on a tenant's site (V1 or
 * V2) and leave halfway get one AI-written follow-up email; if they reply with
 * a question, the AI answers strictly from that tenant's approved FAQs.
 *
 *   tracking   apps/booking/src/lib/abandoned-booking-tracker.ts → the public
 *              `abandoned-booking-track` function → abandoned_bookings
 *   sending    `abandoned-recovery-run` (pg_cron, every 10 minutes)
 *   replies    `abandoned-recovery-inbound` (Reply-To: reply+<token>@…)
 *
 * This tab is the switchboard (on/off, delay, which tenants, AI style), the
 * analytics, the full log of every attempt with its email and conversation,
 * and a box to try the FAQ guardrail against any tenant.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Eye,
  Loader2,
  Mail,
  MessageSquareReply,
  RefreshCw,
  Save,
  Search,
  Send,
  ShoppingCart,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type Status = 'in_progress' | 'abandoned' | 'emailed' | 'converted' | 'expired';

interface Settings {
  enabled: boolean;
  delay_minutes: number;
  auto_reply_enabled: boolean;
  tenant_scope: 'all' | 'selected';
  tenant_ids: string[];
  ai_instructions: string;
  /** Emails per abandoned booking: the first, then one a day until they act (1–7). */
  max_emails: number;
}

interface Session {
  id: string;
  tenant_id: string;
  site: 'v1' | 'v2';
  stage: string;
  vehicle_name: string | null;
  pickup_date: string | null;
  pickup_time: string | null;
  dropoff_date: string | null;
  dropoff_time: string | null;
  pickup_location: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  estimated_total: number | null;
  status: Status;
  started_at: string;
  last_activity_at: string;
  abandoned_at: string | null;
  email_status: 'sent' | 'failed' | 'skipped' | null;
  email_detail: string | null;
  email_subject: string | null;
  email_body: string | null;
  email_sent_at: string | null;
  email_count: number;
  last_email_at: string | null;
  next_email_at: string | null;
  follow_up_stopped: string | null;
  unsubscribed_at: string | null;
  converted_at: string | null;
  converted_after_email: boolean;
  reply_count: number;
  tenants: { company_name: string | null; slug: string } | null;
}

interface Message {
  id: string;
  direction: 'outbound' | 'inbound';
  kind: 'recovery' | 'question' | 'answer';
  subject: string | null;
  body: string;
  answered_from_faqs: boolean | null;
  status: string;
  detail: string | null;
  created_at: string;
}

interface TenantOption {
  id: string;
  name: string;
  experience: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const STAGES: { id: string; label: string }[] = [
  { id: 'dates', label: 'Dates' },
  { id: 'vehicle', label: 'Car' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'details', label: 'Details' },
  { id: 'checkout', label: 'Review' },
  { id: 'payment', label: 'Payment' },
];
const STAGE_LABEL: Record<string, string> = { ...Object.fromEntries(STAGES.map((s) => [s.id, s.label])), completed: 'Completed' };

const STATUS: Record<Status, { label: string; className: string }> = {
  in_progress: { label: 'Browsing', className: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300' },
  abandoned: { label: 'Abandoned', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  emailed: { label: 'Emailed', className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300' },
  converted: { label: 'Booked', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  expired: { label: 'Lost', className: 'bg-muted text-muted-foreground' },
};

const RANGES = [
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatTrip(s: Pick<Session, 'pickup_date' | 'dropoff_date'>): string | null {
  const fmt = (d: string) => {
    const parsed = new Date(`${d.slice(0, 10)}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  if (s.pickup_date && s.dropoff_date) return `${fmt(s.pickup_date)} → ${fmt(s.dropoff_date)}`;
  if (s.pickup_date) return `from ${fmt(s.pickup_date)}`;
  return null;
}

const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('abandoned-recovery-run', { body });
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

export function AbandonedRecoveryTab({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [range, setRange] = useState('30');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [scopeOpen, setScopeOpen] = useState(false);
  const [detail, setDetail] = useState<Session | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - Number(range) * 24 * 60 * 60 * 1000).toISOString();
      const [s, rows, t] = await Promise.all([
        db.from('abandoned_recovery_settings').select('*').eq('id', 1).maybeSingle(),
        db
          .from('abandoned_bookings')
          .select('*, tenants(company_name, slug)')
          .gte('started_at', since)
          .order('started_at', { ascending: false })
          .limit(2000),
        db.from('tenants').select('id, company_name, slug, portal_experience').order('company_name'),
      ]);
      if (s.error) throw s.error;
      if (rows.error) throw rows.error;
      const loaded: Settings = s.data ?? {
        enabled: false,
        delay_minutes: 60,
        auto_reply_enabled: true,
        tenant_scope: 'selected',
        tenant_ids: [],
        ai_instructions: '',
        max_emails: 1,
      };
      setSettings(loaded);
      setDraft(loaded);
      setSessions((rows.data as Session[]) ?? []);
      setTenants(
        ((t.data as { id: string; company_name: string | null; slug: string; portal_experience: string | null }[]) ?? []).map((x) => ({
          id: x.id,
          name: x.company_name || x.slug,
          experience: x.portal_experience,
        })),
      );
    } catch (e) {
      toast.error('Could not load abandoned bookings', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter(
      (s) =>
        (tenantFilter === 'all' || s.tenant_id === tenantFilter) &&
        (siteFilter === 'all' || s.site === siteFilter) &&
        (statusFilter === 'all' ||
          (statusFilter === 'recovered' ? s.status === 'converted' && s.converted_after_email : s.status === statusFilter)) &&
        (!q ||
          s.customer_email?.toLowerCase().includes(q) ||
          s.customer_name?.toLowerCase().includes(q) ||
          s.vehicle_name?.toLowerCase().includes(q)),
    );
  }, [sessions, tenantFilter, siteFilter, statusFilter, search]);

  const stats = useMemo(() => {
    const scoped = sessions.filter((s) => (tenantFilter === 'all' || s.tenant_id === tenantFilter) && (siteFilter === 'all' || s.site === siteFilter));
    const abandoned = scoped.filter((s) => s.abandoned_at !== null || s.status === 'abandoned' || s.status === 'emailed' || s.status === 'expired');
    const emailed = scoped.filter((s) => s.email_status === 'sent');
    const recovered = scoped.filter((s) => s.status === 'converted' && s.converted_after_email);
    const completed = scoped.filter((s) => s.status === 'converted');
    const recoveredValue = recovered.reduce((sum, s) => sum + (Number(s.estimated_total) || 0), 0);
    const lostAt = STAGES.map((st) => ({
      ...st,
      count: abandoned.filter((s) => s.status !== 'converted' && s.stage === st.id).length,
    }));
    const maxLost = Math.max(1, ...lostAt.map((l) => l.count));
    return {
      started: scoped.length,
      abandoned: abandoned.length,
      emailed: emailed.length,
      recovered: recovered.length,
      completed: completed.length,
      recoveryRate: emailed.length ? Math.round((recovered.length / emailed.length) * 100) : 0,
      recoveredValue,
      replies: scoped.reduce((n, s) => n + (s.reply_count || 0), 0),
      lostAt,
      maxLost,
    };
  }, [sessions, tenantFilter, siteFilter]);

  const settingsDirty = JSON.stringify(settings) !== JSON.stringify(draft);

  async function saveSettings() {
    if (!draft) return;
    if (!Number.isInteger(draft.delay_minutes) || draft.delay_minutes < 15 || draft.delay_minutes > 10080) {
      toast.error('Wait time must be between 15 minutes and 7 days');
      return;
    }
    if (!Number.isInteger(draft.max_emails) || draft.max_emails < 1 || draft.max_emails > 7) {
      toast.error('Emails per booking must be between 1 and 7');
      return;
    }
    setSavingSettings(true);
    try {
      const row = { ...draft, updated_at: new Date().toISOString() };
      const { error } = await db.from('abandoned_recovery_settings').upsert({ id: 1, ...row });
      if (error) throw error;
      setSettings(draft);
      toast.success(draft.enabled ? 'Saved — recovery emails are on' : 'Saved');
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setSavingSettings(false);
    }
  }

  if (loading && !settings) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const scopeText =
    draft?.tenant_scope === 'all'
      ? 'All tenants (V1 and V2)'
      : `${draft?.tenant_ids.length ?? 0} selected tenant${draft?.tenant_ids.length === 1 ? '' : 's'}`;

  return (
    <div className="space-y-6">
      {/* ── Settings ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-primary" />
                Abandoned Recovery
              </CardTitle>
              <CardDescription>
                When a renter starts a booking on a tenant&apos;s site (V1 or V2) and leaves halfway, they get an AI-written email
                picking up exactly where they left off — and, if you choose, one follow-up a day until they come back. If they reply with a question, the AI answers{' '}
                <span className="font-medium text-foreground">only from that tenant&apos;s approved FAQs</span>, and passes
                anything else to the tenant.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        {draft && (
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Send recovery emails</Label>
                  <p className="text-xs text-muted-foreground">Off: bookings are still tracked, nobody is emailed.</p>
                </div>
                <Switch checked={draft.enabled} disabled={!canEdit} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
              </div>
              <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">AI answers replies from FAQs</Label>
                  <p className="text-xs text-muted-foreground">Off: questions go straight to the tenant.</p>
                </div>
                <Switch
                  checked={draft.auto_reply_enabled}
                  disabled={!canEdit}
                  onCheckedChange={(v) => setDraft({ ...draft, auto_reply_enabled: v })}
                />
              </div>
              <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ar-delay" className="text-sm font-medium">
                  Email after they&apos;ve been gone for
                </Label>
                <Select
                  value={String(draft.delay_minutes)}
                  disabled={!canEdit}
                  onValueChange={(v) => setDraft({ ...draft, delay_minutes: Number(v) })}
                >
                  <SelectTrigger id="ar-delay">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[30, 60, 120, 180, 360, 720, 1440].map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : m < 1440 ? `${m / 60} hours` : '24 hours'}
                      </SelectItem>
                    ))}
                    {![30, 60, 120, 180, 360, 720, 1440].includes(draft.delay_minutes) && (
                      <SelectItem value={String(draft.delay_minutes)}>{draft.delay_minutes} minutes</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ar-max-emails" className="text-sm font-medium">
                  Emails per booking
                </Label>
                <Select
                  value={String(draft.max_emails ?? 1)}
                  disabled={!canEdit}
                  onValueChange={(v) => setDraft({ ...draft, max_emails: Number(v) })}
                >
                  <SelectTrigger id="ar-max-emails">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n === 1 ? '1 email only' : `Up to ${n} — one a day`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Stops as soon as they book, come back, reply or unsubscribe.</p>
              </div>
              </div>
              <div className="space-y-1.5 rounded-lg border p-4">
                <Label className="text-sm font-medium">Tenants</Label>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">{scopeText}</span>
                  <Button variant="outline" size="sm" onClick={() => setScopeOpen(true)} disabled={!canEdit}>
                    Choose
                  </Button>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ar-style">AI house style (optional)</Label>
              <Textarea
                id="ar-style"
                rows={3}
                disabled={!canEdit}
                maxLength={2000}
                value={draft.ai_instructions}
                placeholder="e.g. Keep it friendly and brief. Never use exclamation marks in the subject."
                onChange={(e) => setDraft({ ...draft, ai_instructions: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                The AI always uses only the real booking details (car, dates, where they stopped) and never invents prices,
                discounts or policies. Each abandoned booking gets the first email, then (if set above) one follow-up a day until
                the renter books, comes back, replies or unsubscribes. A renter starts a new sequence at most once per tenant each
                week, and every email has an unsubscribe link.
              </p>
            </div>
            {canEdit && (
              <div className="flex justify-end">
                <Button className="gap-1.5" onClick={() => void saveSettings()} disabled={!settingsDirty || savingSettings}>
                  {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save settings
                </Button>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ── Analytics ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tenantFilter} onValueChange={setTenantFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All tenants" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tenants</SelectItem>
            {tenants
              .filter((t) => sessions.some((s) => s.tenant_id === t.id))
              .map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={siteFilter} onValueChange={setSiteFilter}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">V1 and V2</SelectItem>
            <SelectItem value="v1">V1 sites</SelectItem>
            <SelectItem value="v2">V2 sites</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat icon={ShoppingCart} label="Bookings started" value={stats.started} />
        <Stat icon={Eye} label="Abandoned" value={stats.abandoned} sub={stats.started ? `${Math.round((stats.abandoned / stats.started) * 100)}% of started` : undefined} />
        <Stat icon={Mail} label="Recovery emails sent" value={stats.emailed} sub={`${stats.replies} repl${stats.replies === 1 ? 'y' : 'ies'}`} />
        <Stat
          icon={CheckCircle2}
          label="Recovered"
          value={stats.recovered}
          sub={`${stats.recoveryRate}% of emailed`}
          tone="green"
        />
        <Stat icon={TrendingUp} label="Recovered value (est.)" value={money(stats.recoveredValue)} sub={`${stats.completed} completed overall`} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Where renters drop off</CardTitle>
          <CardDescription>The furthest step reached by bookings that were abandoned and not completed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {stats.lostAt.map((l) => (
            <div key={l.id} className="grid grid-cols-[90px_1fr_40px] items-center gap-3 text-sm">
              <span className="text-muted-foreground">{l.label}</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(l.count / stats.maxLost) * 100}%` }} />
              </div>
              <span className="text-right tabular-nums">{l.count}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Log ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Every booking attempt</CardTitle>
              <CardDescription>Click a row for the recovery email and the renter&apos;s conversation.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="w-[220px] pl-8" placeholder="Renter or car" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any outcome</SelectItem>
                  <SelectItem value="in_progress">Browsing</SelectItem>
                  <SelectItem value="abandoned">Abandoned</SelectItem>
                  <SelectItem value="emailed">Emailed</SelectItem>
                  <SelectItem value="recovered">Recovered</SelectItem>
                  <SelectItem value="converted">Booked (any)</SelectItem>
                  <SelectItem value="expired">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {sessions.length === 0 ? 'No booking attempts tracked in this period yet.' : 'Nothing matches these filters.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Renter</TableHead>
                  <TableHead>Car &amp; dates</TableHead>
                  <TableHead>Left at</TableHead>
                  <TableHead>Recovery email</TableHead>
                  <TableHead>Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 500).map((s) => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => setDetail(s)}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(s.started_at)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{s.tenants?.company_name || s.tenants?.slug}</div>
                      <div className="text-xs uppercase text-muted-foreground">{s.site}</div>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="truncate">{s.customer_name || <span className="text-muted-foreground">Unknown</span>}</div>
                      <div className="truncate text-xs text-muted-foreground">{s.customer_email || 'no email yet'}</div>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="truncate">{s.vehicle_name || '—'}</div>
                      <div className="text-xs text-muted-foreground">{formatTrip(s) ?? ''}</div>
                    </TableCell>
                    <TableCell>{s.status === 'converted' ? '—' : STAGE_LABEL[s.stage] ?? s.stage}</TableCell>
                    <TableCell className="max-w-[220px]">
                      {s.email_status === 'sent' ? (
                        <div>
                          <div className="truncate">{s.email_subject}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDateTime(s.email_sent_at)}
                            {s.reply_count > 0 && ` · ${s.reply_count} repl${s.reply_count === 1 ? 'y' : 'ies'}`}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {`${s.email_count || 1} email${(s.email_count || 1) === 1 ? '' : 's'} sent`}
                            {s.next_email_at
                              ? ` · next ${formatDateTime(s.next_email_at)}`
                              : s.follow_up_stopped
                              ? ` · ${s.follow_up_stopped}`
                              : ''}
                          </div>
                        </div>
                      ) : s.email_status ? (
                        <span className={cn('text-xs', s.email_status === 'failed' ? 'text-red-600' : 'text-muted-foreground')}>
                          {s.email_status === 'failed' ? 'Failed: ' : 'Not sent: '}
                          {s.email_detail}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS[s.status].className}>
                        {s.status === 'converted' && s.converted_after_email ? 'Recovered' : STATUS[s.status].label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {filtered.length > 500 && (
            <p className="pt-3 text-center text-xs text-muted-foreground">Showing the latest 500 of {filtered.length}. Narrow the filters to see more.</p>
          )}
        </CardContent>
      </Card>

      <FaqGuardrailCard tenants={tenants} />

      <ScopeDialog
        open={scopeOpen}
        onOpenChange={setScopeOpen}
        tenants={tenants}
        value={draft}
        onChange={(next) => draft && setDraft({ ...draft, ...next })}
      />

      <SessionDialog session={detail} onClose={() => setDetail(null)} defaultTestTo={user?.email ?? ''} />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Mail;
  label: string;
  value: number | string;
  sub?: string;
  tone?: 'green';
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className={cn('text-2xl font-semibold tabular-nums', tone === 'green' && 'text-green-600')}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/* ── Which tenants ──────────────────────────────────────────────────────── */

function ScopeDialog({
  open,
  onOpenChange,
  tenants,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tenants: TenantOption[];
  value: Settings | null;
  onChange: (next: Pick<Settings, 'tenant_scope' | 'tenant_ids'>) => void;
}) {
  const [filter, setFilter] = useState('');
  if (!value) return null;
  const selected = new Set(value.tenant_ids);
  const shown = tenants.filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Which tenants&apos; renters get recovery emails?</DialogTitle>
          <DialogDescription>Tracking runs on every booking site either way; this only decides who is emailed.</DialogDescription>
        </DialogHeader>
        <Select
          value={value.tenant_scope}
          onValueChange={(v) => onChange({ tenant_scope: v as Settings['tenant_scope'], tenant_ids: value.tenant_ids })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tenants, V1 and V2</SelectItem>
            <SelectItem value="selected">Only the tenants I choose</SelectItem>
          </SelectContent>
        </Select>
        {value.tenant_scope === 'selected' && (
          <div className="space-y-2">
            <Input placeholder="Search tenants" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="max-h-[320px] space-y-1 overflow-y-auto rounded-md border p-2">
              {shown.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox
                    checked={selected.has(t.id)}
                    onCheckedChange={(c) => {
                      const next = new Set(selected);
                      if (c) next.add(t.id);
                      else next.delete(t.id);
                      onChange({ tenant_scope: 'selected', tenant_ids: [...next] });
                    }}
                  />
                  <span className="flex-1">{t.name}</span>
                  <span className="text-xs uppercase text-muted-foreground">{t.experience ?? 'v1'}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done — remember to save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── One booking attempt ────────────────────────────────────────────────── */

function SessionDialog({ session, onClose, defaultTestTo }: { session: Session | null; onClose: () => void; defaultTestTo: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; body: string; ai: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [testTo, setTestTo] = useState(defaultTestTo);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setPreview(null);
    setMessages([]);
    setTestTo(defaultTestTo);
    if (!session) return;
    setLoadingMessages(true);
    db.from('abandoned_recovery_messages')
      .select('*')
      .eq('abandoned_booking_id', session.id)
      .order('created_at', { ascending: true })
      .then(({ data }: { data: Message[] | null }) => setMessages(data ?? []))
      .finally(() => setLoadingMessages(false));
  }, [session, defaultTestTo]);

  if (!session) return null;

  async function runPreview() {
    if (!session) return;
    setPreviewing(true);
    try {
      setPreview(await invoke({ action: 'preview', id: session.id }));
    } catch (e) {
      toast.error('Could not write the email', { description: (e as Error).message });
    } finally {
      setPreviewing(false);
    }
  }

  async function sendTest() {
    if (!session) return;
    setTesting(true);
    try {
      await invoke({ action: 'test', id: session.id, to: testTo.trim() });
      toast.success(`Test sent to ${testTo.trim()}`);
    } catch (e) {
      toast.error('Test send failed', { description: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  const facts: [string, string | null][] = [
    ['Tenant', `${session.tenants?.company_name || session.tenants?.slug} (${session.site.toUpperCase()} site)`],
    ['Renter', [session.customer_name, session.customer_email, session.customer_phone].filter(Boolean).join(' · ') || null],
    ['Car', session.vehicle_name],
    ['Pickup', [session.pickup_date, session.pickup_time].filter(Boolean).join(' ') || null],
    ['Return', [session.dropoff_date, session.dropoff_time].filter(Boolean).join(' ') || null],
    ['Location', session.pickup_location],
    ['Estimated total', session.estimated_total != null ? money(Number(session.estimated_total)) : null],
    ['Furthest step', STAGE_LABEL[session.stage] ?? session.stage],
    ['Started', formatDateTime(session.started_at)],
    ['Last active', formatDateTime(session.last_activity_at)],
    ['Booked', session.converted_at ? `${formatDateTime(session.converted_at)}${session.converted_after_email ? ' — after our email' : ''}` : null],
    ['Unsubscribed', session.unsubscribed_at ? formatDateTime(session.unsubscribed_at) : null],
  ];

  return (
    <Dialog open={!!session} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {session.customer_name || session.customer_email || 'Anonymous renter'}
            <Badge variant="secondary" className={STATUS[session.status].className}>
              {session.status === 'converted' && session.converted_after_email ? 'Recovered' : STATUS[session.status].label}
            </Badge>
          </DialogTitle>
          <DialogDescription>{session.vehicle_name ? `${session.vehicle_name}${formatTrip(session) ? `, ${formatTrip(session)}` : ''}` : 'No car chosen yet'}</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-1.5 text-sm">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
        </dl>

        <div className="space-y-3">
          <p className="text-sm font-medium">Conversation</p>
          {loadingMessages ? (
            <Skeleton className="h-20 w-full" />
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {session.email_status && session.email_status !== 'sent'
                ? `No email sent — ${session.email_detail ?? session.email_status}.`
                : 'Nothing sent yet.'}
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={cn('rounded-lg border p-3 text-sm', m.direction === 'inbound' ? 'mr-10 bg-muted/40' : 'ml-10 bg-primary/5')}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {m.direction === 'inbound' ? <MessageSquareReply className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                  <span className="font-medium text-foreground">
                    {m.kind === 'recovery' ? 'Recovery email' : m.kind === 'question' ? 'Renter replied' : 'AI answer'}
                  </span>
                  <span>{formatDateTime(m.created_at)}</span>
                  {m.kind === 'answer' && (
                    <Badge variant="secondary" className={m.answered_from_faqs ? STATUS.converted.className : STATUS.abandoned.className}>
                      {m.answered_from_faqs ? 'Answered from FAQs' : 'Not in FAQs — handed to tenant'}
                    </Badge>
                  )}
                  {(m.status === 'failed' || m.status === 'skipped') && (
                    <span className="text-red-600">
                      {m.status}
                      {m.detail ? `: ${m.detail}` : ''}
                    </span>
                  )}
                </div>
                {m.subject && <p className="font-medium">{m.subject}</p>}
                <p className="whitespace-pre-wrap text-muted-foreground">{m.body}</p>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Try the recovery email</p>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void runPreview()} disabled={previewing}>
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Write it now
            </Button>
          </div>
          {preview && (
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <p className="font-medium">{preview.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{preview.body}</p>
              {!preview.ai && <p className="mt-2 text-xs text-amber-600">AI unavailable — this is the standard message.</p>}
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="ar-test-to" className="text-xs">
                Send a test of it to
              </Label>
              <Input id="ar-test-to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            </div>
            <Button className="gap-1.5" onClick={() => void sendTest()} disabled={testing || !testTo.trim()}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send test
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Tests go only to the address above — never to the renter.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── The FAQ guardrail, tried by hand ───────────────────────────────────── */

function FaqGuardrailCard({ tenants }: { tenants: TenantOption[] }) {
  const [tenantId, setTenantId] = useState('');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<{
    covered: boolean;
    answer: string;
    faqCount: number;
    faqsUsed: { id: string; question: string }[];
  } | null>(null);

  async function ask() {
    setAsking(true);
    setResult(null);
    try {
      setResult(await invoke({ action: 'ask', tenantId, question }));
    } catch (e) {
      toast.error('Could not answer', { description: (e as Error).message });
    } finally {
      setAsking(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          Test the FAQ guardrail
        </CardTitle>
        <CardDescription>
          Ask a question as a renter would, and see exactly how the AI would reply for that tenant. It answers only from the
          tenant&apos;s active FAQs; anything they don&apos;t cover gets a hand-off to the tenant instead of a guess.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[240px_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label>Tenant</Label>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a tenant" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ar-question">Renter&apos;s question</Label>
            <Input
              id="ar-question"
              value={question}
              placeholder="Do I need a credit card, or is debit OK?"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && tenantId && question.trim() && void ask()}
            />
          </div>
          <Button className="gap-1.5" onClick={() => void ask()} disabled={asking || !tenantId || !question.trim()}>
            {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Ask
          </Button>
        </div>
        {result && (
          <div className="rounded-lg border p-4 text-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className={result.covered ? STATUS.converted.className : STATUS.abandoned.className}>
                {result.covered ? 'Answered from FAQs' : 'Not covered — handed to tenant'}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {result.faqCount} active FAQ{result.faqCount === 1 ? '' : 's'} for this tenant
              </span>
            </div>
            <p className="whitespace-pre-wrap">{result.answer}</p>
            {result.faqsUsed.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Based on: {result.faqsUsed.map((f) => `“${f.question}”`).join(', ')}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
