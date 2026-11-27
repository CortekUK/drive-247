'use client';

/**
 * Customer Management → Signups: everyone who signed up on drive-247.com and
 * their details, whether or not they finished.
 *
 * Bryan (2026-11-25): a lead who stopped at the card step had a phone number
 * on record and nowhere in admin showed it. The rows come from
 * `admin_signups()` (migration 20261125150000), a super-admin-only read of
 * the signup answers (signup_attribution), the signup's own state and, once
 * the portal is built, the company and its subscription.
 *
 * Haris (2026-11-27): each row has a Delete button. A row with a company opens
 * the same Delete company dialog as the Rental Companies page, because only
 * admin-delete-tenant cancels the Stripe subscription first. Any other row is
 * removed by `admin_delete_signup()` (migration 20261127170000): the lead, or
 * the signup login and its answers.
 *
 * Bryan's team (2026-11-27): a follow-up tag (Contacted – Interested /
 * Undecided / Not interested, Not reachable; later Completed sign up and
 * Onboarding – Scheduled / Completed / Not reachable) and dated notes on each row, and a
 * filter by tag, so qualified leads are easy to pick out. Stored per person
 * (lower-cased email) by migration 20261127180000, so they carry over when a
 * lead later creates an account.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, Loader2, Mail, NotebookPen, Phone, RefreshCw, Search, Trash2, X } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { confirmDialog } from '@/components/ui/confirm';
import { DeleteTenantDialog } from '@/components/admin/delete-tenant-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { PAGE_DESCRIPTION } from '@/components/admin/header-buttons';
import { cn } from '@/lib/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface SignupRow {
  /** Null for a lead: they stopped before the business page, so no account exists. */
  auth_user_id: string | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  city_state: string | null;
  fleet_size: string | null;
  heard_about: string | null;
  heard_about_other: string | null;
  plan_id: string | null;
  signup_status: string | null;
  company_name: string | null;
  tenant_id: string | null;
  tenant_slug: string | null;
  subscription_status: string | null;
  trial_end: string | null;
  signed_up_at: string;
  email_verified_at: string | null;
  paid_at: string | null;
  last_sign_in_at: string | null;
  exit_offer_seen_at: string | null;
  /** The furthest screen the signup reached (signup_leads.last_step). */
  lead_step: string | null;
  lead_id: string | null;
}

type Group = 'lead' | 'no_card' | 'signed_up' | 'failed';

/** The follow-up tag the sales team sets after calling someone. */
type FollowStatus =
  | 'interested'
  | 'undecided'
  | 'not_interested'
  | 'not_reachable'
  | 'completed_signup'
  | 'onboarding_scheduled'
  | 'onboarding_completed'
  | 'onboarding_not_reachable';
type FollowFilter = FollowStatus | 'none' | 'all';

const FOLLOW: Array<{ id: FollowStatus; label: string; cls: string }> = [
  { id: 'interested', label: 'Contacted – Interested', cls: 'text-green-700 dark:text-green-400' },
  { id: 'undecided', label: 'Contacted – Undecided', cls: 'text-amber-700 dark:text-amber-400' },
  { id: 'not_interested', label: 'Contacted – Not interested', cls: 'text-red-700 dark:text-red-400' },
  { id: 'not_reachable', label: 'Not reachable', cls: 'text-slate-600 dark:text-slate-400' },
  { id: 'completed_signup', label: 'Completed sign up', cls: 'text-blue-700 dark:text-blue-400' },
  { id: 'onboarding_scheduled', label: 'Onboarding – Scheduled', cls: 'text-indigo-700 dark:text-indigo-400' },
  { id: 'onboarding_completed', label: 'Onboarding – Completed', cls: 'text-emerald-700 dark:text-emerald-400' },
  { id: 'onboarding_not_reachable', label: 'Onboarding – Not reachable', cls: 'text-zinc-600 dark:text-zinc-400' },
];
const FOLLOW_BY_ID = Object.fromEntries(FOLLOW.map((f) => [f.id, f])) as Record<FollowStatus, (typeof FOLLOW)[number]>;

const FOLLOW_FILTERS: Array<{ id: FollowFilter; label: string; cls: string }> = [
  { id: 'all', label: 'All', cls: 'text-foreground' },
  { id: 'none', label: 'Not contacted', cls: 'text-muted-foreground' },
  ...FOLLOW,
];

interface FollowTag {
  status: FollowStatus;
  by: string | null;
  at: string;
}

interface SignupNote {
  id: string;
  key: string;
  body: string;
  by: string | null;
  at: string;
}

/** Where a signup got to, in words Bryan uses, and which filter it falls under. */
/** Where a lead stopped, as the person saw it. */
const LEAD_STEP_LABEL: Record<string, string> = {
  details: 'after their details',
  business: 'on the business page',
  email_code: 'at the email code',
  password: 'at the password',
  card: 'at the card step',
};

function stageOf(r: SignupRow): { label: string; cls: string; group: Group } {
  switch (r.signup_status) {
    case 'lead':
      return {
        label: `Started signup, not finished${r.lead_step && LEAD_STEP_LABEL[r.lead_step] ? `: stopped ${LEAD_STEP_LABEL[r.lead_step]}` : ''}`,
        cls: 'text-orange-700 dark:text-orange-400',
        group: 'lead',
      };
    case 'provisioned':
      return { label: 'Portal live', cls: 'text-green-700 dark:text-green-400', group: 'signed_up' };
    case 'paid':
    case 'provisioning':
      return { label: 'Card added, building portal', cls: 'text-blue-700 dark:text-blue-400', group: 'signed_up' };
    case 'failed':
      return { label: 'Setup failed', cls: 'text-red-700 dark:text-red-400', group: 'failed' };
    case 'payment_pending':
      return { label: 'At the card step, no card yet', cls: 'text-amber-700 dark:text-amber-400', group: 'no_card' };
    default:
      return { label: 'Account created, no card yet', cls: 'text-amber-700 dark:text-amber-400', group: 'no_card' };
  }
}

const FILTERS: Array<{ id: Group | 'all'; label: string; cls: string }> = [
  { id: 'all', label: 'All signups', cls: 'text-foreground' },
  { id: 'lead', label: 'Started, not finished', cls: 'text-orange-700 dark:text-orange-400' },
  { id: 'no_card', label: 'No card yet', cls: 'text-amber-700 dark:text-amber-400' },
  { id: 'signed_up', label: 'Signed up', cls: 'text-green-700 dark:text-green-400' },
  { id: 'failed', label: 'Setup failed', cls: 'text-red-700 dark:text-red-400' },
];

const PLAN_LABEL: Record<string, string> = {
  starter_2: 'Starter',
  growth_2: 'Growth',
  scale_2: 'Scale',
};

const HEARD_LABEL: Record<string, string> = {
  google: 'Google',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  referral: 'A referral',
  turo: 'Turo',
  other: 'Other',
};

function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "+14044541524" → "+1 404-454-1524"; anything else as typed. */
function fmtPhone(raw: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw);
  return m ? `+1 ${m[1]}-${m[2]}-${m[3]}` : raw;
}

/** Who a tag or note belongs to: the email (lower-cased), or the lead id when there is none. */
function signupKey(r: SignupRow): string | null {
  if (r.email && r.email.trim()) return r.email.trim().toLowerCase();
  return r.lead_id ? `lead:${r.lead_id}` : null;
}

/** The same key the list uses for the row. */
function rowKey(r: SignupRow): string {
  return r.auth_user_id ?? `lead-${r.lead_id ?? r.email}`;
}

function heardText(r: SignupRow): string | null {
  if (!r.heard_about) return null;
  if (r.heard_about === 'other' && r.heard_about_other) return `Other: ${r.heard_about_other}`;
  return HEARD_LABEL[r.heard_about] ?? r.heard_about;
}

export function SignupsTab() {
  const [rows, setRows] = useState<SignupRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notInstalled, setNotInstalled] = useState(false);
  const [filter, setFilter] = useState<Group | 'all'>('all');
  const [query, setQuery] = useState('');
  /** The company whose Delete company dialog is open (a signup that has one). */
  const [companyToDelete, setCompanyToDelete] = useState<{ id: string; company_name: string } | null>(null);
  /** The row being deleted, so its button shows a spinner and cannot be pressed twice. */
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  /** Follow-up tags by signup key, and every note (newest first). */
  const [tags, setTags] = useState<Record<string, FollowTag>>({});
  const [notes, setNotes] = useState<SignupNote[]>([]);
  /** False until migration 20261127180000 is on this database: tags and notes stay hidden. */
  const [followReady, setFollowReady] = useState(false);
  const [followFilter, setFollowFilter] = useState<FollowFilter>('all');
  /** The row whose notes dialog is open. */
  const [notesFor, setNotesFor] = useState<SignupRow | null>(null);
  const [draft, setDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await db.rpc('admin_signups');
      if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') {
          setNotInstalled(true);
          return;
        }
        throw error;
      }
      setNotInstalled(false);
      setRows((data ?? []) as SignupRow[]);

      const fu = await db.rpc('admin_signup_followups');
      if (fu.error) {
        setFollowReady(false);
        if (fu.error.code !== 'PGRST202' && fu.error.code !== '42883') {
          toast.error(`Could not load tags and notes: ${fu.error.message}`);
        }
      } else {
        setFollowReady(true);
        setTags((fu.data?.tags ?? {}) as Record<string, FollowTag>);
        setNotes((fu.data?.notes ?? []) as SignupNote[]);
      }
    } catch (e) {
      toast.error(`Could not load signups: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const notesByKey = useMemo(() => {
    const m: Record<string, SignupNote[]> = {};
    for (const n of notes) (m[n.key] ??= []).push(n);
    return m;
  }, [notes]);

  const tagOf = useCallback(
    (r: SignupRow): FollowStatus | null => {
      const k = signupKey(r);
      return k ? tags[k]?.status ?? null : null;
    },
    [tags],
  );

  /** Tag counts within the stage card that is picked, so the two filters read together. */
  const followCounts = useMemo(() => {
    const c: Record<FollowFilter, number> = {
      all: 0,
      none: 0,
      interested: 0,
      undecided: 0,
      not_interested: 0,
      not_reachable: 0,
      completed_signup: 0,
      onboarding_scheduled: 0,
      onboarding_completed: 0,
      onboarding_not_reachable: 0,
    };
    for (const r of rows ?? []) {
      if (filter !== 'all' && stageOf(r).group !== filter) continue;
      c.all += 1;
      c[tagOf(r) ?? 'none'] += 1;
    }
    return c;
  }, [rows, filter, tagOf]);

  const counts = useMemo(() => {
    const c = { all: 0, lead: 0, no_card: 0, signed_up: 0, failed: 0 };
    for (const r of rows ?? []) {
      c.all += 1;
      c[stageOf(r).group] += 1;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return (rows ?? []).filter((r) => {
      if (filter !== 'all' && stageOf(r).group !== filter) return false;
      if (followFilter !== 'all' && (tagOf(r) ?? 'none') !== followFilter) return false;
      if (!q) return true;
      const k = signupKey(r);
      const noteText = k ? (notesByKey[k] ?? []).map((n) => n.body).join(' ') : '';
      const hay = [r.full_name, r.email, r.company_name, r.city_state, r.tenant_slug, noteText].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q) || (digits.length >= 3 && (r.phone ?? '').replace(/\D/g, '').includes(digits));
    });
  }, [rows, filter, followFilter, query, tagOf, notesByKey]);

  const setTag = useCallback(
    async (r: SignupRow, value: string) => {
      const k = signupKey(r);
      if (!k) return;
      const status = value === 'none' ? null : (value as FollowStatus);
      const before = tags[k];
      // Show the change at once; put it back if the save fails.
      setTags((prev) => {
        const next = { ...prev };
        if (status) next[k] = { status, by: null, at: new Date().toISOString() };
        else delete next[k];
        return next;
      });
      const { error } = await db.rpc('admin_signup_set_status', { p_key: k, p_status: status });
      if (error) {
        toast.error(`Could not save the tag: ${error.message}`);
        setTags((prev) => {
          const next = { ...prev };
          if (before) next[k] = before;
          else delete next[k];
          return next;
        });
      }
    },
    [tags],
  );

  const addNote = useCallback(async () => {
    if (!notesFor) return;
    const k = signupKey(notesFor);
    const body = draft.trim();
    if (!k || !body) return;
    setSavingNote(true);
    try {
      const { data, error } = await db.rpc('admin_signup_add_note', { p_key: k, p_body: body });
      if (error) throw error;
      setNotes((prev) => [data as SignupNote, ...prev]);
      setDraft('');
    } catch (e) {
      toast.error(`Could not save the note: ${(e as Error).message}`);
    } finally {
      setSavingNote(false);
    }
  }, [notesFor, draft]);

  const deleteNote = useCallback(async (n: SignupNote) => {
    const ok = await confirmDialog({ title: 'Delete this note?', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    const { error } = await db.rpc('admin_signup_delete_note', { p_id: n.id });
    if (error) {
      toast.error(`Could not delete the note: ${error.message}`);
      return;
    }
    setNotes((prev) => prev.filter((x) => x.id !== n.id));
  }, []);

  const copy = useCallback(async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error(`Could not copy the ${what.toLowerCase()}`);
    }
  }, []);

  const remove = useCallback(
    async (r: SignupRow) => {
      if (r.tenant_id) {
        setCompanyToDelete({ id: r.tenant_id, company_name: r.company_name || r.tenant_slug || 'this company' });
        return;
      }
      if (!r.auth_user_id && !r.lead_id) {
        toast.error('This signup cannot be deleted from here');
        return;
      }
      const who = r.full_name || r.email || 'this signup';
      const ok = await confirmDialog({
        title: `Delete ${who}?`,
        description: r.auth_user_id
          ? `This removes their signup details and their login${r.email ? ` (${r.email})` : ''}. It cannot be undone. They can sign up again with the same email.`
          : 'This removes the details they typed on the signup form. It cannot be undone.',
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return;

      const key = rowKey(r);
      setDeletingKey(key);
      try {
        const { error } = await db.rpc(
          'admin_delete_signup',
          r.auth_user_id ? { p_auth_user_id: r.auth_user_id } : { p_lead_id: r.lead_id },
        );
        if (error) {
          if (error.code === 'PGRST202' || error.code === '42883') {
            throw new Error('needs the database function from migration 20261127170000_admin_delete_signup.sql');
          }
          throw error;
        }
        setRows((prev) => (prev ?? []).filter((x) => rowKey(x) !== key));
        toast.success(`${who} deleted`);
      } catch (e) {
        toast.error(`Could not delete: ${(e as Error).message}`);
      } finally {
        setDeletingKey(null);
      }
    },
    [],
  );

  const dialogKey = notesFor ? signupKey(notesFor) : null;
  const dialogNotes = dialogKey ? notesByKey[dialogKey] ?? [] : [];

  if (notInstalled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not installed</CardTitle>
          <CardDescription>
            This list needs the database function from migration 20261125150000_admin_signups.sql.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Signups</h1>
          <p className={cn('max-w-2xl text-sm text-muted-foreground', PAGE_DESCRIPTION)}>
            Everyone who signed up on drive-247.com, newest first, with the details they gave: phone, location, fleet
            size and how they heard about us. People who stopped part-way are here too, from the moment they finish the
            first page, so you can call them.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className="rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className={cn('h-full transition-colors hover:bg-muted/40', filter === f.id && 'border-primary')}>
              <CardContent className="p-4">
                <p className={cn('text-xs font-medium', f.cls)}>{f.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{loading && !rows ? '—' : counts[f.id]}</p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      {followReady && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by follow-up">
          <span className="text-xs font-medium text-muted-foreground">Follow-up:</span>
          {FOLLOW_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={followFilter === f.id}
              onClick={() => setFollowFilter(f.id)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                f.cls,
                followFilter === f.id && 'border-primary bg-primary/5',
              )}
            >
              {f.label} <span className="tabular-nums text-muted-foreground">{followCounts[f.id]}</span>
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>People</CardTitle>
            <CardDescription>Tap a phone number to call, or copy it.</CardDescription>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, phone, city, notes"
              className="pl-8"
              aria-label="Search signups"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !rows ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : shown.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              {query || filter !== 'all' ? 'Nobody matches.' : 'No signups yet.'}
            </p>
          ) : (
            <ul className="divide-y">
              {shown.map((r) => {
                const st = stageOf(r);
                const heard = heardText(r);
                const plan = r.plan_id ? PLAN_LABEL[r.plan_id] ?? r.plan_id : null;
                const key = signupKey(r);
                const rowNotes = key ? notesByKey[key] ?? [] : [];
                const latest = rowNotes[0];
                const tag = tagOf(r);
                return (
                  <li key={rowKey(r)} className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:gap-6">
                    <div className="min-w-0 lg:w-[32%]">
                      <p className="truncate text-sm font-medium max-sm:whitespace-normal">
                        {r.full_name || r.email || 'No name'}
                        {r.company_name && <span className="font-normal text-muted-foreground"> · {r.company_name}</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere]">
                        {[r.city_state, r.fleet_size && `${r.fleet_size} cars`, plan && `${plan} plan`, heard && `heard via ${heard}`]
                          .filter(Boolean)
                          .join(' · ') || 'No answers yet'}
                      </p>
                      {followReady && latest && (
                        <p className="mt-1 truncate text-xs text-foreground/80 max-sm:whitespace-normal" title={latest.body}>
                          <NotebookPen className="mr-1 inline h-3 w-3 text-muted-foreground" aria-hidden />
                          {latest.body}
                        </p>
                      )}
                    </div>

                    <div className="min-w-0 space-y-1 text-sm lg:w-[34%]">
                      {r.phone ? (
                        <p className="flex items-center gap-2">
                          <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 font-medium text-indigo-700 hover:underline dark:text-indigo-400">
                            <Phone className="h-3.5 w-3.5" aria-hidden />
                            {fmtPhone(r.phone)}
                          </a>
                          <button
                            type="button"
                            onClick={() => void copy(r.phone!, 'Phone number')}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Copy ${r.phone}`}
                            title="Copy"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">No phone given</p>
                      )}
                      {r.email && (
                        <p className="flex min-w-0 items-center gap-2">
                          <a href={`mailto:${r.email}`} className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline">
                            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="truncate">{r.email}</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => void copy(r.email!, 'Email')}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Copy ${r.email}`}
                            title="Copy"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </p>
                      )}
                    </div>

                    <div className="lg:flex-1">
                      <p className={cn('text-xs font-medium', st.cls)}>
                        {st.label}
                        {r.subscription_status && r.signup_status === 'provisioned' && ` · ${r.subscription_status}`}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Signed up {fmtWhen(r.signed_up_at)}
                        {r.trial_end && r.subscription_status === 'trialing' && ` · trial until ${fmtWhen(r.trial_end).split(',')[0]}`}
                      </p>
                      {followReady && key && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Select value={tag ?? 'none'} onValueChange={(v) => void setTag(r, v)}>
                            <SelectTrigger
                              className={cn('h-7 w-[220px] text-xs', tag ? FOLLOW_BY_ID[tag].cls : 'text-muted-foreground')}
                              aria-label={`Follow-up for ${r.full_name || r.email || 'this signup'}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none" className="text-xs text-muted-foreground">
                                Not contacted
                              </SelectItem>
                              {FOLLOW.map((f) => (
                                <SelectItem key={f.id} value={f.id} className={cn('text-xs', f.cls)}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setDraft('');
                              setNotesFor(r);
                            }}
                          >
                            <NotebookPen className="mr-1 h-3.5 w-3.5" />
                            Notes{rowNotes.length ? ` (${rowNotes.length})` : ''}
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2 self-start lg:self-center">
                      {r.tenant_id && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={`/admin/rentals/${r.tenant_id}`}>
                            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                            Company
                          </a>
                        </Button>
                      )}
                      {(r.tenant_id || r.auth_user_id || r.lead_id) && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void remove(r)}
                          disabled={deletingKey === rowKey(r)}
                          aria-label={`Delete ${r.full_name || r.email || 'signup'}`}
                          title={r.tenant_id ? 'Delete company' : 'Delete signup'}
                        >
                          {deletingKey === rowKey(r) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {loading && rows && (
            <div className="flex justify-center pb-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!notesFor} onOpenChange={(open) => !open && !savingNote && setNotesFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Notes · {notesFor?.full_name || notesFor?.email || 'Signup'}</DialogTitle>
            <DialogDescription>
              {[notesFor?.email, notesFor?.phone ? fmtPhone(notesFor.phone) : null].filter(Boolean).join(' · ') ||
                'Only super admins see these.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What happened on the call? Next step?"
              rows={3}
              maxLength={4000}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void addNote();
              }}
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={() => void addNote()} disabled={savingNote || !draft.trim()}>
                {savingNote && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Add note
              </Button>
            </div>
          </div>
          <ul className="max-h-[50vh] space-y-3 overflow-y-auto">
            {dialogNotes.map((n) => (
              <li key={n.id} className="rounded-lg border px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{n.body}</p>
                  <button
                    type="button"
                    onClick={() => void deleteNote(n)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Delete note"
                    title="Delete note"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {fmtWhen(n.at)}
                  {n.by && ` · ${n.by}`}
                </p>
              </li>
            ))}
            {notesFor && dialogNotes.length === 0 && <li className="text-sm text-muted-foreground">No notes yet.</li>}
          </ul>
        </DialogContent>
      </Dialog>

      <DeleteTenantDialog
        tenant={companyToDelete}
        onOpenChange={(open) => !open && setCompanyToDelete(null)}
        onDeleted={() => void load()}
      />
    </div>
  );
}
