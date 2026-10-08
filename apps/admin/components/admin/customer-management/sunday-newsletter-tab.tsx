'use client';

/**
 * Sunday Newsletter (v2 only) — write, schedule and track the weekly email
 * Drive 247 sends to v2 operators every Sunday.
 *
 *   Settings    dispatcher on/off, the hour it goes out (in each tenant's own
 *               time zone) and the audience: every v2 tenant minus
 *               exclusions, or only the selected ones. Unsubscribed tenants
 *               are shown and can be put back.
 *   Issues      one per Sunday: subject, intro and five sections — growth tip,
 *               Drive 247 tip, next webinar (filled automatically from
 *               Webinars, or written by hand, or left out), product update and
 *               an operator spotlight that only goes out once its permission
 *               box is ticked. Draft → scheduled → sent.
 *   Deliveries  per issue, every tenant it was sent (or not sent) to. Live.
 *
 * The `sunday-newsletter-run` edge function sends it (hourly cron, Sundays
 * only) and renders the previews and test sends, so what you preview is
 * exactly what goes out.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Copy,
  Eye,
  Loader2,
  Mail,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Trash2,
  TriangleAlert,
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
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type Audience = 'all' | 'selected';
type Status = 'draft' | 'scheduled' | 'sent' | 'cancelled';
type WebinarMode = 'auto' | 'custom' | 'off';

interface Section {
  title?: string;
  body?: string;
}
interface Sections {
  growth_tip?: Section;
  drive247_tip?: Section;
  webinar?: Section & { mode?: WebinarMode };
  product_update?: Section;
  spotlight?: Section & { permission?: boolean };
}

interface Issue {
  id: string;
  title: string;
  subject: string;
  preheader: string | null;
  intro: string | null;
  sections: Sections;
  send_date: string;
  status: Status;
  sent_at: string | null;
  updated_at: string;
}

interface Settings {
  enabled: boolean;
  send_hour: number;
  audience: Audience;
  target_tenant_ids: string[];
  excluded_tenant_ids: string[];
}

interface Delivery {
  id: string;
  issue_id: string;
  tenant_id: string;
  status: 'sent' | 'failed' | 'skipped';
  to_email: string | null;
  detail: string | null;
  created_at: string;
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
  subject: string;
  preheader: string;
  intro: string;
  send_date: string;
  sections: Required<{ [K in keyof Sections]: NonNullable<Sections[K]> }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const isV2 = (t: TenantLite) => t.portal_experience === 'v2' || t.slug === 'northwind';

const STATUS: Record<Status, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
  scheduled: { label: 'Scheduled', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  sent: { label: 'Sent', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
};

const SECTION_FIELDS: { key: 'growth_tip' | 'drive247_tip' | 'product_update'; label: string; titleHint: string; bodyHint: string }[] = [
  {
    key: 'growth_tip',
    label: '1 · Growth tip',
    titleHint: 'e.g. Ask every customer for a review',
    bodyHint: 'One practical idea for getting more bookings this week.',
  },
  {
    key: 'drive247_tip',
    label: '2 · Drive 247 tip',
    titleHint: 'e.g. Set weekend pricing in two clicks',
    bodyHint: 'One feature they may not be using yet, and where to find it. {{portal_url}} links to their portal.',
  },
  {
    key: 'product_update',
    label: '4 · Product update',
    titleHint: 'e.g. Faster check-in on the rental page',
    bodyHint: 'What changed this week and why it helps them.',
  },
];

/** YYYY-MM-DD of a local date. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today (if Sunday) and the following Sundays. */
function upcomingSundays(count: number): string[] {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return Array.from({ length: count }, (_, i) => {
    const s = new Date(d);
    s.setDate(d.getDate() + i * 7);
    return isoDate(s);
  });
}

function prettySunday(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function hourLabel(h: number): string {
  return new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function emptyDraft(sendDate: string): Draft {
  return {
    id: null,
    title: `Sunday ${prettySunday(sendDate)}`,
    subject: 'Your Sunday read from Drive 247',
    preheader: '',
    intro: 'Hi {{tenant_name}},\n\nHere is your five-minute Sunday read: one idea to grow, one Drive 247 tip, what is new and who is winning.',
    send_date: sendDate,
    sections: {
      growth_tip: { title: '', body: '' },
      drive247_tip: { title: '', body: '' },
      webinar: { mode: 'auto', title: '', body: '' },
      product_update: { title: '', body: '' },
      spotlight: { title: '', body: '', permission: false },
    },
  };
}

function draftFrom(issue: Issue, sendDate?: string): Draft {
  const base = emptyDraft(sendDate ?? issue.send_date);
  const s = issue.sections ?? {};
  return {
    id: sendDate ? null : issue.id,
    title: sendDate ? `${issue.title} (copy)` : issue.title,
    subject: issue.subject,
    preheader: issue.preheader ?? '',
    intro: issue.intro ?? '',
    send_date: sendDate ?? issue.send_date,
    sections: {
      growth_tip: { ...base.sections.growth_tip, ...s.growth_tip },
      drive247_tip: { ...base.sections.drive247_tip, ...s.drive247_tip },
      webinar: { ...base.sections.webinar, ...s.webinar },
      product_update: { ...base.sections.product_update, ...s.product_update },
      // A copy never inherits a permission given for one particular issue.
      spotlight: { ...base.sections.spotlight, ...s.spotlight, ...(sendDate ? { permission: false } : {}) },
    },
  };
}

const filled = (s?: Section) => !!(s?.title?.trim() || s?.body?.trim());

function sectionCount(s: Sections): number {
  return (
    (filled(s.growth_tip) ? 1 : 0) +
    (filled(s.drive247_tip) ? 1 : 0) +
    ((s.webinar?.mode ?? 'auto') === 'auto' || ((s.webinar?.mode ?? 'auto') === 'custom' && filled(s.webinar)) ? 1 : 0) +
    (filled(s.product_update) ? 1 : 0) +
    (filled(s.spotlight) && s.spotlight?.permission ? 1 : 0)
  );
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('sunday-newsletter-run', { body });
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
  return data as T;
}

export function SundayNewsletterTab({ canEdit }: { canEdit: boolean }) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [unsubscribed, setUnsubscribed] = useState<{ tenant_id: string; email: string | null; unsubscribed_at: string }[]>([]);
  const [live, setLive] = useState(false);
  const [tenantSearch, setTenantSearch] = useState('');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Issue | null>(null);
  const [preview, setPreview] = useState<{ issue: Issue; html: string | null; tenantId: string; loading: boolean } | null>(null);
  const [testTo, setTestTo] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [trackId, setTrackId] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [s, i, d, t, u] = await Promise.all([
        db.from('newsletter_settings').select('*').eq('id', 1).maybeSingle(),
        db.from('newsletter_issues').select('*').order('send_date', { ascending: false }),
        db.from('newsletter_deliveries').select('*').order('created_at', { ascending: false }).limit(5000),
        db.from('tenants').select('id, company_name, slug, portal_experience, status, tenant_type').order('company_name'),
        db.from('newsletter_unsubscribes').select('*'),
      ]);
      for (const res of [s, i, d, t, u]) if (res.error) throw res.error;
      if (!quiet) {
        const loaded: Settings = {
          enabled: !!s.data?.enabled,
          send_hour: s.data?.send_hour ?? 9,
          audience: s.data?.audience === 'selected' ? 'selected' : 'all',
          target_tenant_ids: s.data?.target_tenant_ids ?? [],
          excluded_tenant_ids: s.data?.excluded_tenant_ids ?? [],
        };
        setSettings(loaded);
        setSettingsDraft(loaded);
      }
      setIssues((i.data as Issue[]) ?? []);
      setDeliveries((d.data as Delivery[]) ?? []);
      setTenants((t.data as TenantLite[]) ?? []);
      setUnsubscribed(u.data ?? []);
    } catch (e) {
      if (!quiet) toast.error('Could not load the newsletter', { description: (e as Error).message });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('newsletter-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'newsletter_deliveries' }, () => void load(true))
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const v2Tenants = useMemo(
    () => tenants.filter((t) => t.status === 'active' && t.tenant_type !== 'test' && isV2(t)),
    [tenants],
  );
  const tenantName = useMemo(() => {
    const m = new Map(tenants.map((t) => [t.id, t.company_name || t.slug]));
    return (id: string) => m.get(id) ?? 'Unknown tenant';
  }, [tenants]);
  const unsubSet = useMemo(() => new Set(unsubscribed.map((u) => u.tenant_id)), [unsubscribed]);

  const recipients = useMemo(() => {
    if (!settings) return [];
    return v2Tenants.filter(
      (t) =>
        !unsubSet.has(t.id) &&
        (settings.audience === 'selected' ? settings.target_tenant_ids.includes(t.id) : !settings.excluded_tenant_ids.includes(t.id)),
    );
  }, [v2Tenants, settings, unsubSet]);

  const nextSunday = upcomingSundays(1)[0];
  const nextIssue = issues.find((i) => i.send_date === nextSunday && i.status === 'scheduled') ?? null;

  // Track the most recent issue that has deliveries, else the next scheduled one.
  useEffect(() => {
    if (trackId && issues.some((i) => i.id === trackId)) return;
    const withDeliveries = issues.find((i) => deliveries.some((d) => d.issue_id === i.id));
    setTrackId((withDeliveries ?? nextIssue ?? issues[0])?.id ?? '');
  }, [issues, deliveries, trackId, nextIssue]);

  /* ── settings ─────────────────────────────────────────────────────────── */

  const settingsDirty = JSON.stringify(settings) !== JSON.stringify(settingsDraft);
  const picked = settingsDraft
    ? settingsDraft.audience === 'selected'
      ? settingsDraft.target_tenant_ids
      : settingsDraft.excluded_tenant_ids
    : [];

  function togglePicked(id: string) {
    if (!settingsDraft) return;
    const list = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setSettingsDraft(
      settingsDraft.audience === 'selected'
        ? { ...settingsDraft, target_tenant_ids: list }
        : { ...settingsDraft, excluded_tenant_ids: list },
    );
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    if (settingsDraft.audience === 'selected' && settingsDraft.target_tenant_ids.length === 0) {
      return void toast.error('Pick at least one tenant, or choose All v2 tenants');
    }
    setSavingSettings(true);
    try {
      const { error } = await db.from('newsletter_settings').upsert({ id: 1, ...settingsDraft, updated_at: new Date().toISOString() });
      if (error) throw error;
      setSettings(settingsDraft);
      toast.success(settingsDraft.enabled ? 'Saved — the Sunday dispatcher is on' : 'Saved');
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setSavingSettings(false);
    }
  }

  async function resubscribe(tenantId: string) {
    const { error } = await db.from('newsletter_unsubscribes').delete().eq('tenant_id', tenantId);
    if (error) return void toast.error('Could not resubscribe', { description: error.message });
    toast.success(`${tenantName(tenantId)} will get the newsletter again`);
    void load(true);
  }

  /* ── issues ───────────────────────────────────────────────────────────── */

  const takenSundays = useMemo(
    () => new Set(issues.filter((i) => i.status === 'scheduled' && i.id !== draft?.id).map((i) => i.send_date)),
    [issues, draft?.id],
  );
  const freeSunday = () => upcomingSundays(52).find((d) => !issues.some((i) => i.status === 'scheduled' && i.send_date === d)) ?? nextSunday;

  async function saveIssue(status: 'draft' | 'scheduled') {
    if (!draft) return;
    const s = draft.sections;
    if (!draft.title.trim()) return void toast.error('Give the issue a name');
    if (!draft.subject.trim()) return void toast.error('Add a subject line');
    if (filled(s.spotlight) && !s.spotlight.permission && status === 'scheduled') {
      return void toast.error('Tick the permission box for the spotlight, or clear it', {
        description: 'An operator is only featured with their permission.',
      });
    }
    if (s.webinar.mode === 'custom' && !filled(s.webinar)) {
      return void toast.error('Write the webinar section, or set it to automatic or leave it out');
    }
    if (status === 'scheduled') {
      if (sectionCount(s) === 0) return void toast.error('Fill in at least one section before scheduling');
      if (draft.send_date < isoDate(new Date())) return void toast.error('Pick a Sunday that has not passed');
      if (takenSundays.has(draft.send_date)) {
        return void toast.error(`Another issue is already scheduled for ${prettySunday(draft.send_date)}`);
      }
    }
    setSaving(true);
    try {
      const row = {
        title: draft.title.trim(),
        subject: draft.subject.trim(),
        preheader: draft.preheader.trim() || null,
        intro: draft.intro.trim() || null,
        sections: draft.sections,
        send_date: draft.send_date,
        status,
      };
      const { error } = draft.id
        ? await db.from('newsletter_issues').update(row).eq('id', draft.id)
        : await db.from('newsletter_issues').insert(row);
      if (error) throw error;
      toast.success(status === 'scheduled' ? `Scheduled for ${prettySunday(draft.send_date)}` : 'Saved as a draft');
      setDraft(null);
      void load(true);
    } catch (e) {
      const msg = (e as { code?: string; message?: string }).code === '23505'
        ? 'Another issue is already scheduled for that Sunday'
        : (e as Error).message;
      toast.error('Could not save the issue', { description: msg });
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(issue: Issue, status: Status) {
    const { error } = await db.from('newsletter_issues').update({ status }).eq('id', issue.id);
    if (error) {
      return void toast.error('Could not update the issue', {
        description: error.code === '23505' ? 'Another issue is already scheduled for that Sunday' : error.message,
      });
    }
    void load(true);
  }

  async function deleteIssue(issue: Issue) {
    const { error } = await db.from('newsletter_issues').delete().eq('id', issue.id);
    if (error) return void toast.error('Could not delete', { description: error.message });
    toast.success('Issue deleted');
    setConfirmDelete(null);
    void load(true);
  }

  const openPreview = useCallback(async (issue: Issue, tenantId = '') => {
    setPreview({ issue, html: null, tenantId, loading: true });
    try {
      const res = await invoke<{ html: string }>({ action: 'preview', issueId: issue.id, tenantId: tenantId || undefined });
      setPreview({ issue, html: res.html, tenantId, loading: false });
    } catch (e) {
      toast.error('Could not build the preview', { description: (e as Error).message });
      setPreview(null);
    }
  }, []);

  async function sendTest() {
    if (!preview) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testTo.trim())) return void toast.error('Enter a valid email address');
    setSendingTest(true);
    try {
      await invoke({ action: 'test', issueId: preview.issue.id, to: testTo.trim() });
      toast.success(`Test sent to ${testTo.trim()}`);
    } catch (e) {
      toast.error('Could not send the test', { description: (e as Error).message });
    } finally {
      setSendingTest(false);
    }
  }

  const tracked = issues.find((i) => i.id === trackId) ?? null;
  const trackedDeliveries = deliveries.filter((d) => d.issue_id === trackId);
  const statsFor = (issueId: string) => {
    const ds = deliveries.filter((d) => d.issue_id === issueId);
    return { sent: ds.filter((d) => d.status === 'sent').length, failed: ds.filter((d) => d.status === 'failed').length, skipped: ds.filter((d) => d.status === 'skipped').length };
  };

  if (loading && !settingsDraft) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const tenantList = v2Tenants.filter((t) => (t.company_name || t.slug).toLowerCase().includes(tenantSearch.trim().toLowerCase()));

  return (
    <div className="space-y-6">
      {/* ── settings ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Newspaper className="h-5 w-5 text-primary" />
                Sunday Newsletter
              </CardTitle>
              <CardDescription>
                A weekly email from Drive 247 to v2 operators, sent every Sunday at the hour below in each tenant&apos;s own time
                zone: one growth tip, one Drive 247 tip, the next webinar, one product update and an operator spotlight.
                Schedule one issue per Sunday; a Sunday with nothing scheduled sends nothing.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        {settingsDraft && (
          <CardContent className="space-y-5">
            <div
              className={cn(
                'flex items-start gap-3 rounded-lg border p-4 text-sm',
                nextIssue && settings?.enabled ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30' : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
              )}
            >
              {nextIssue && settings?.enabled ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700 dark:text-green-400" />
              ) : (
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
              )}
              <div>
                <span className="font-medium">Next Sunday, {prettySunday(nextSunday)}: </span>
                {!settings?.enabled
                  ? 'the dispatcher is off, so nothing will be sent.'
                  : nextIssue
                  ? `“${nextIssue.title}” goes to ${recipients.length} tenant${recipients.length === 1 ? '' : 's'} at ${hourLabel(settings.send_hour)} their time.`
                  : 'no issue is scheduled, so nothing will be sent.'}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Send every Sunday</Label>
                  <p className="text-xs text-muted-foreground">Off: scheduled issues wait, nothing is sent.</p>
                </div>
                <Switch
                  checked={settingsDraft.enabled}
                  disabled={!canEdit}
                  onCheckedChange={(v) => setSettingsDraft({ ...settingsDraft, enabled: v })}
                />
              </div>
              <div className="space-y-1.5 rounded-lg border p-4">
                <Label htmlFor="nl-hour" className="text-sm font-medium">
                  Send at (each tenant&apos;s time)
                </Label>
                <Select
                  value={String(settingsDraft.send_hour)}
                  disabled={!canEdit}
                  onValueChange={(v) => setSettingsDraft({ ...settingsDraft, send_hour: Number(v) })}
                >
                  <SelectTrigger id="nl-hour">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, h) => (
                      <SelectItem key={h} value={String(h)}>
                        {hourLabel(h)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 rounded-lg border p-4 md:col-span-2">
                <Label className="text-sm font-medium">Who gets it</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(['all', 'selected'] as Audience[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setSettingsDraft({ ...settingsDraft, audience: a, target_tenant_ids: [], excluded_tenant_ids: [] })}
                      className={cn(
                        'rounded-lg border p-3 text-left text-sm transition-colors',
                        settingsDraft.audience === a ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50',
                      )}
                    >
                      <span className="block font-medium">{a === 'all' ? 'All v2 tenants' : 'Only selected tenants'}</span>
                      <span className="block text-xs text-muted-foreground">{a === 'all' ? 'Tick any to exclude' : 'Tick the ones to send to'}</span>
                    </button>
                  ))}
                </div>
                <div className="rounded-lg border">
                  <div className="flex items-center gap-2 border-b p-2">
                    <Search className="ml-1 h-4 w-4 text-muted-foreground" />
                    <input
                      value={tenantSearch}
                      onChange={(e) => setTenantSearch(e.target.value)}
                      placeholder={settingsDraft.audience === 'all' ? 'Search tenants to exclude' : 'Search tenants to send to'}
                      className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <span className="whitespace-nowrap pr-1 text-xs text-muted-foreground">
                      {picked.length} {settingsDraft.audience === 'all' ? 'excluded' : 'selected'}
                    </span>
                  </div>
                  <div className="max-h-56 overflow-y-auto p-1">
                    {tenantList.length === 0 ? (
                      <p className="p-3 text-center text-sm text-muted-foreground">No v2 tenants match.</p>
                    ) : (
                      tenantList.map((t) => {
                        const on = picked.includes(t.id);
                        const unsub = unsubSet.has(t.id);
                        return (
                          <div key={t.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                            <input type="checkbox" disabled={!canEdit} checked={on} onChange={() => togglePicked(t.id)} aria-label={t.company_name || t.slug} />
                            <span className={cn('flex-1 truncate', settingsDraft.audience === 'all' && on && 'text-muted-foreground line-through')}>
                              {t.company_name || t.slug}
                            </span>
                            {unsub && (
                              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                Unsubscribed
                                {canEdit && (
                                  <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => void resubscribe(t.id)}>
                                    Resubscribe
                                  </button>
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Only v2 tenants are listed. It goes to the tenant&apos;s notification address (else contact, else admin email).
                </p>
              </div>
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

      {/* ── issues ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Issues</CardTitle>
              <CardDescription>One per Sunday. Drafts are never sent; scheduled issues go out on their Sunday.</CardDescription>
            </div>
            {canEdit && (
              <Button className="gap-1.5" onClick={() => setDraft(emptyDraft(freeSunday()))}>
                <Plus className="h-4 w-4" />
                New issue
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {issues.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No issues yet. Create the first one.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sunday</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Sections</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.map((i) => {
                  const st = statsFor(i.id);
                  const locked = i.status === 'sent';
                  return (
                    <TableRow key={i.id} className={cn('cursor-pointer', i.id === trackId && 'bg-muted/40')} onClick={() => setTrackId(i.id)}>
                      <TableCell className="whitespace-nowrap">{prettySunday(i.send_date)}</TableCell>
                      <TableCell className="max-w-[280px]">
                        <div className="truncate font-medium">{i.title}</div>
                        <div className="truncate text-xs text-muted-foreground">{i.subject}</div>
                      </TableCell>
                      <TableCell className="tabular-nums">{sectionCount(i.sections ?? {})} of 5</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={STATUS[i.status].className}>
                          {STATUS[i.status].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {st.sent + st.failed + st.skipped === 0
                          ? '—'
                          : `${st.sent} sent${st.failed ? ` · ${st.failed} failed` : ''}${st.skipped ? ` · ${st.skipped} skipped` : ''}`}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="Preview and send a test" onClick={() => void openPreview(i)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {canEdit && !locked && (
                            <Button variant="ghost" size="icon" title="Edit" onClick={() => setDraft(draftFrom(i))}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {canEdit && (
                            <Button variant="ghost" size="icon" title="Duplicate to the next free Sunday" onClick={() => setDraft(draftFrom(i, freeSunday()))}>
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                          {canEdit && i.status === 'scheduled' && (
                            <Button variant="ghost" size="sm" onClick={() => void setStatus(i, 'draft')}>
                              Unschedule
                            </Button>
                          )}
                          {canEdit && (
                            <Button variant="ghost" size="icon" title="Delete" onClick={() => setConfirmDelete(i)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── deliveries ───────────────────────────────────────────────────── */}
      {tracked && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4" />
                  Deliveries — {tracked.title}
                </CardTitle>
                <CardDescription>
                  {prettySunday(tracked.send_date)} · click another issue above to switch.
                </CardDescription>
              </div>
              <span className={cn('text-xs', live ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>
                {live ? '● Live' : 'Updates on refresh'}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {trackedDeliveries.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {tracked.status === 'scheduled'
                  ? `Nothing sent yet — it goes out on ${prettySunday(tracked.send_date)} to ${recipients.length} tenant${recipients.length === 1 ? '' : 's'}.`
                  : 'Nothing was sent for this issue.'}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Sent to</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trackedDeliveries.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{tenantName(d.tenant_id)}</TableCell>
                      <TableCell className="text-muted-foreground">{d.to_email ?? '—'}</TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'text-sm',
                            d.status === 'sent' ? 'text-green-700 dark:text-green-400' : d.status === 'failed' ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground',
                          )}
                        >
                          {d.status === 'sent' ? 'Sent' : d.status === 'failed' ? 'Failed' : 'Skipped'}
                          {d.detail ? ` — ${d.detail}` : ''}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {new Date(d.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── editor ───────────────────────────────────────────────────────── */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && !saving && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit issue' : 'New issue'}</DialogTitle>
            <DialogDescription>
              Plain text. A blank line starts a new paragraph, &ldquo;- &rdquo; starts a bullet, web addresses become links.
              {' '}<code>{'{{tenant_name}}'}</code>, <code>{'{{portal_url}}'}</code> and <code>{'{{booking_url}}'}</code> are filled in per tenant.
              Empty sections are left out.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nl-title">Name (only you see this)</Label>
                  <Input id="nl-title" value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nl-date" className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Sunday
                  </Label>
                  <Select value={draft.send_date} onValueChange={(v) => setDraft({ ...draft, send_date: v })}>
                    <SelectTrigger id="nl-date">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[...new Set([draft.send_date, ...upcomingSundays(26)])].sort().map((d) => (
                        <SelectItem key={d} value={d}>
                          {prettySunday(d)}
                          {takenSundays.has(d) ? ' — another issue is scheduled' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nl-subject">Subject line</Label>
                  <Input id="nl-subject" value={draft.subject} maxLength={200} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nl-pre">Preview text (optional)</Label>
                  <Input
                    id="nl-pre"
                    value={draft.preheader}
                    maxLength={200}
                    placeholder="Shown after the subject in the inbox"
                    onChange={(e) => setDraft({ ...draft, preheader: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nl-intro">Intro (optional)</Label>
                <Textarea id="nl-intro" rows={3} value={draft.intro} maxLength={5000} onChange={(e) => setDraft({ ...draft, intro: e.target.value })} />
              </div>

              {SECTION_FIELDS.slice(0, 2).map((f) => (
                <SectionEditor
                  key={f.key}
                  label={f.label}
                  titleHint={f.titleHint}
                  bodyHint={f.bodyHint}
                  value={draft.sections[f.key]}
                  onChange={(v) => setDraft({ ...draft, sections: { ...draft.sections, [f.key]: v } })}
                />
              ))}

              <div className="space-y-2 rounded-lg border p-4">
                <Label className="text-sm font-semibold">3 · Next webinar</Label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['auto', 'Automatic', 'The next published webinar each tenant is invited to'],
                    ['custom', 'Write it', 'Your own text'],
                    ['off', 'Leave out', 'No webinar section'],
                  ] as [WebinarMode, string, string][]).map(([mode, label, hint]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setDraft({ ...draft, sections: { ...draft.sections, webinar: { ...draft.sections.webinar, mode } } })}
                      className={cn(
                        'rounded-lg border p-2.5 text-left text-sm transition-colors',
                        (draft.sections.webinar.mode ?? 'auto') === mode ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50',
                      )}
                    >
                      <span className="block font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{hint}</span>
                    </button>
                  ))}
                </div>
                {(draft.sections.webinar.mode ?? 'auto') === 'auto' && (
                  <p className="text-xs text-muted-foreground">
                    Taken from Customer management → Webinars when the email is sent, shown in each tenant&apos;s time zone with a link to
                    register from their portal. If no webinar is coming up, the section is left out.
                  </p>
                )}
                {draft.sections.webinar.mode === 'custom' && (
                  <SectionFields
                    titleHint="e.g. Live Q&A: pricing for the holidays"
                    bodyHint="When it is and how to join."
                    value={draft.sections.webinar}
                    onChange={(v) => setDraft({ ...draft, sections: { ...draft.sections, webinar: { ...draft.sections.webinar, ...v } } })}
                  />
                )}
              </div>

              <SectionEditor
                label={SECTION_FIELDS[2].label}
                titleHint={SECTION_FIELDS[2].titleHint}
                bodyHint={SECTION_FIELDS[2].bodyHint}
                value={draft.sections.product_update}
                onChange={(v) => setDraft({ ...draft, sections: { ...draft.sections, product_update: v } })}
              />

              <div className="space-y-2 rounded-lg border p-4">
                <Label className="text-sm font-semibold">5 · Operator spotlight</Label>
                <SectionFields
                  titleHint="e.g. Jangram Car Rental went from 3 to 12 Teslas"
                  bodyHint="Their story in a few lines: where they started, what they did, what changed."
                  value={draft.sections.spotlight}
                  onChange={(v) => setDraft({ ...draft, sections: { ...draft.sections, spotlight: { ...draft.sections.spotlight, ...v } } })}
                />
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!!draft.sections.spotlight.permission}
                    onChange={(e) =>
                      setDraft({ ...draft, sections: { ...draft.sections, spotlight: { ...draft.sections.spotlight, permission: e.target.checked } } })
                    }
                  />
                  <span>
                    We have this operator&apos;s permission to feature them.{' '}
                    <span className="text-muted-foreground">The spotlight is only sent once this is ticked.</span>
                  </span>
                </label>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => void saveIssue('draft')} disabled={saving}>
              Save as draft
            </Button>
            <Button className="gap-1.5" onClick={() => void saveIssue('scheduled')} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
              Schedule for {draft ? prettySunday(draft.send_date) : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── preview ──────────────────────────────────────────────────────── */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Preview — {preview?.issue.title}</DialogTitle>
            <DialogDescription>Exactly what the tenant receives, with their name, links and time zone filled in.</DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-sm">As</Label>
                <Select value={preview.tenantId || 'sample'} onValueChange={(v) => void openPreview(preview.issue, v === 'sample' ? '' : v)}>
                  <SelectTrigger className="h-9 w-[240px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sample">Northwind (sample)</SelectItem>
                    {v2Tenants.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.company_name || t.slug}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="overflow-hidden rounded-lg border bg-white">
                {preview.loading || !preview.html ? (
                  <div className="flex h-[480px] items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <iframe title="Newsletter preview" srcDoc={preview.html} sandbox="" className="h-[560px] w-full" />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="you@example.com"
                  className="h-9 max-w-xs"
                  aria-label="Send a test to"
                />
                <Button variant="outline" className="h-9 gap-1.5" onClick={() => void sendTest()} disabled={sendingTest}>
                  {sendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send test
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── delete ───────────────────────────────────────────────────────── */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.title}”?</DialogTitle>
            <DialogDescription>
              {confirmDelete?.status === 'sent'
                ? 'It has already been sent. Deleting it also removes its delivery log. Emails already delivered are not recalled.'
                : 'This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => confirmDelete && void deleteIssue(confirmDelete)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionFields({
  titleHint,
  bodyHint,
  value,
  onChange,
}: {
  titleHint: string;
  bodyHint: string;
  value: Section;
  onChange: (v: Section) => void;
}) {
  return (
    <div className="space-y-2">
      <Input value={value.title ?? ''} maxLength={200} placeholder={titleHint} onChange={(e) => onChange({ ...value, title: e.target.value })} />
      <Textarea rows={3} value={value.body ?? ''} maxLength={5000} placeholder={bodyHint} onChange={(e) => onChange({ ...value, body: e.target.value })} />
    </div>
  );
}

function SectionEditor({
  label,
  titleHint,
  bodyHint,
  value,
  onChange,
}: {
  label: string;
  titleHint: string;
  bodyHint: string;
  value: Section;
  onChange: (v: Section) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <Label className="text-sm font-semibold">{label}</Label>
      <SectionFields titleHint={titleHint} bodyHint={bodyHint} value={value} onChange={onChange} />
    </div>
  );
}
