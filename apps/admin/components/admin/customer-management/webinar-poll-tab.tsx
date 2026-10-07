'use client';

/**
 * Webinar Poll — ask operators a question on the v2 portal home and read the
 * answers live.
 *
 *   Polls      single choice, multiple choice, or a typed answer. Draft →
 *              published (active) → closed. Several can be active at once.
 *              Published to every tenant except the ones excluded here.
 *   Results    per-option counts and who answered what, updated in real time
 *              (webinar_poll_responses is in the realtime publication; RLS
 *              limits it to super admins).
 *
 * Polls appear only on v2 portals (bottom of the home). One answer per tenant
 * per poll — enforced by the database, not just the portal.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  CircleDot,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Square,
  StopCircle,
  Trash2,
  Type,
  Vote,
  X,
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

type Kind = 'single' | 'multi' | 'text';
type Status = 'draft' | 'active' | 'closed';

interface PollOption {
  id: string;
  label: string;
}

interface Poll {
  id: string;
  question: string;
  kind: Kind;
  options: PollOption[];
  status: Status;
  excluded_tenant_ids: string[];
  published_at: string | null;
  closed_at: string | null;
  created_at: string;
}

interface Response {
  id: string;
  poll_id: string;
  tenant_id: string;
  option_ids: string[];
  text_answer: string | null;
  created_at: string;
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
  question: string;
  kind: Kind;
  options: PollOption[];
  excluded: string[];
  /** Options cannot change once anyone has answered — their ids are the votes. */
  optionsLocked: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const KIND: Record<Kind, { label: string; hint: string; icon: typeof CircleDot }> = {
  single: { label: 'Single choice', hint: 'Pick one option', icon: CircleDot },
  multi: { label: 'Multiple choice', hint: 'Pick one or more', icon: CheckSquare },
  text: { label: 'Text answer', hint: 'They type their own', icon: Type },
};

const STATUS: Record<Status, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
  active: { label: 'Live', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  closed: { label: 'Closed', className: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300' },
};

const newOption = (): PollOption => ({ id: Math.random().toString(36).slice(2, 10), label: '' });

/** The same rule the portal uses to show v2: the canary slug, or the per-tenant switch. */
const isV2 = (t: TenantLite) => t.portal_experience === 'v2' || t.slug === 'northwind';

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function WebinarPollTab({ canEdit }: { canEdit: boolean }) {
  const [loading, setLoading] = useState(true);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [responses, setResponses] = useState<Response[]>([]);
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Poll | null>(null);
  const [resultsPollId, setResultsPollId] = useState<string>('');
  const [live, setLive] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [p, r, t] = await Promise.all([
        db.from('webinar_polls').select('*').order('created_at', { ascending: false }),
        db
          .from('webinar_poll_responses')
          .select('id, poll_id, tenant_id, option_ids, text_answer, created_at, app_users(name, email)')
          .order('created_at', { ascending: false }),
        db.from('tenants').select('id, company_name, slug, portal_experience, status, tenant_type').order('company_name'),
      ]);
      for (const res of [p, r, t]) if (res.error) throw res.error;
      setPolls((p.data as Poll[]) ?? []);
      setResponses((r.data as Response[]) ?? []);
      setTenants((t.data as TenantLite[]) ?? []);
    } catch (e) {
      if (!quiet) toast.error('Could not load polls', { description: (e as Error).message });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: any new answer or poll change re-reads (quietly), so results update as tenants vote.
  useEffect(() => {
    const channel = supabase
      .channel('webinar-polls-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'webinar_poll_responses' }, () => void load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'webinar_polls' }, () => void load(true))
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  // Results default to the newest live poll, else the newest poll.
  useEffect(() => {
    if (resultsPollId && polls.some((p) => p.id === resultsPollId)) return;
    const pick = polls.find((p) => p.status === 'active') ?? polls[0];
    setResultsPollId(pick?.id ?? '');
  }, [polls, resultsPollId]);

  const tenantById = useMemo(() => new Map(tenants.map((t) => [t.id, t])), [tenants]);
  const audience = useMemo(
    () => tenants.filter((t) => t.status === 'active' && t.tenant_type !== 'test' && isV2(t)),
    [tenants],
  );
  const countFor = useCallback((pollId: string) => responses.filter((r) => r.poll_id === pollId).length, [responses]);
  const reachFor = useCallback(
    (p: Poll) => audience.filter((t) => !p.excluded_tenant_ids.includes(t.id)).length,
    [audience],
  );

  /* ── Mutations ─────────────────────────────────────────────────────── */

  async function save(publish: boolean) {
    if (!draft) return;
    const question = draft.question.trim();
    const options = draft.options.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label);
    if (!question) {
      toast.error('Write the question');
      return;
    }
    if (draft.kind !== 'text' && options.length < 2) {
      toast.error('Add at least two options');
      return;
    }
    if (draft.kind !== 'text' && new Set(options.map((o) => o.label.toLowerCase())).size !== options.length) {
      toast.error('Two options have the same text');
      return;
    }
    setSaving(true);
    try {
      const row: Record<string, unknown> = {
        question,
        kind: draft.kind,
        options: draft.kind === 'text' ? [] : options,
        excluded_tenant_ids: draft.excluded,
      };
      if (publish) row.status = 'active';
      const { error } = draft.id
        ? await db.from('webinar_polls').update(row).eq('id', draft.id)
        : await db.from('webinar_polls').insert({ ...row, status: publish ? 'active' : 'draft' });
      if (error) throw error;
      toast.success(publish ? 'Poll is live on v2 portals' : 'Saved');
      setDraft(null);
      await load(true);
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(p: Poll, status: Status) {
    const { error } = await db.from('webinar_polls').update({ status }).eq('id', p.id);
    if (error) {
      toast.error('Could not update', { description: error.message });
      return;
    }
    toast.success(status === 'active' ? 'Poll is live' : 'Poll closed — tenants no longer see it');
    await load(true);
  }

  async function remove(p: Poll) {
    const { error } = await db.from('webinar_polls').delete().eq('id', p.id);
    if (error) {
      toast.error('Could not delete', { description: error.message });
      return;
    }
    setConfirmDelete(null);
    toast.success('Poll deleted');
    await load(true);
  }

  function openEdit(p: Poll) {
    setDraft({
      id: p.id,
      question: p.question,
      kind: p.kind,
      options: p.options.length ? p.options : [newOption(), newOption()],
      excluded: p.excluded_tenant_ids,
      optionsLocked: countFor(p.id) > 0,
    });
  }

  /* ── Render ────────────────────────────────────────────────────────── */

  if (loading && polls.length === 0) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const resultsPoll = polls.find((p) => p.id === resultsPollId) ?? null;

  return (
    <div className="space-y-6">
      {/* ── Polls ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Vote className="h-5 w-5 text-primary" />
                Webinar Poll
              </CardTitle>
              <CardDescription>
                Ask operators a question. Live polls appear at the bottom of the <span className="font-medium text-foreground">v2</span>{' '}
                portal home for every tenant you haven&apos;t excluded. Each company answers once.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </Button>
              {canEdit && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    setDraft({ id: null, question: '', kind: 'single', options: [newOption(), newOption()], excluded: [], optionsLocked: false })
                  }
                >
                  <Plus className="h-4 w-4" />
                  Create poll
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {polls.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No polls yet. Create one to ask your operators something.</p>
          ) : (
            <div className="space-y-3">
              {polls.map((p) => {
                const KindIcon = KIND[p.kind].icon;
                const answered = countFor(p.id);
                const reach = reachFor(p);
                return (
                  <div key={p.id} className="flex flex-wrap items-center gap-4 rounded-lg border p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className={STATUS[p.status].className}>
                          {p.status === 'active' && <Radio className="mr-1 h-3 w-3" />}
                          {STATUS[p.status].label}
                        </Badge>
                        <Badge variant="secondary" className="gap-1">
                          <KindIcon className="h-3 w-3" />
                          {KIND[p.kind].label}
                        </Badge>
                        {p.excluded_tenant_ids.length > 0 && (
                          <span className="text-xs text-muted-foreground">{p.excluded_tenant_ids.length} excluded</span>
                        )}
                      </div>
                      <p className="mt-1.5 font-medium">{p.question}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {answered} of {reach} v2 tenant{reach === 1 ? '' : 's'} answered
                        {p.published_at ? ` · live since ${formatWhen(p.published_at)}` : ''}
                        {p.status === 'closed' && p.closed_at ? ` · closed ${formatWhen(p.closed_at)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setResultsPollId(p.id)}>
                        Results
                      </Button>
                      {canEdit && (
                        <>
                          {p.status === 'active' ? (
                            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void setStatus(p, 'closed')}>
                              <StopCircle className="h-4 w-4" />
                              Close
                            </Button>
                          ) : (
                            <Button size="sm" className="gap-1.5" onClick={() => void setStatus(p, 'active')}>
                              <Megaphone className="h-4 w-4" />
                              {p.status === 'draft' ? 'Publish' : 'Reopen'}
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => openEdit(p)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => setConfirmDelete(p)}>
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

      {/* ── Results ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                Results
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
              <CardDescription>Which tenant chose which answer. Updates as they vote.</CardDescription>
            </div>
            {polls.length > 0 && (
              <Select value={resultsPollId} onValueChange={setResultsPollId}>
                <SelectTrigger className="h-9 w-[320px] max-w-full text-sm">
                  <SelectValue placeholder="Choose a poll" />
                </SelectTrigger>
                <SelectContent>
                  {polls.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {STATUS[p.status].label} · {p.question.length > 60 ? `${p.question.slice(0, 60)}…` : p.question}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!resultsPoll ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Results appear here once a poll exists.</p>
          ) : (
            <PollResults poll={resultsPoll} responses={responses.filter((r) => r.poll_id === resultsPoll.id)} reach={reachFor(resultsPoll)} tenantById={tenantById} />
          )}
        </CardContent>
      </Card>

      {/* ── Create / edit ───────────────────────────────────────────────── */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit poll' : 'Create poll'}</DialogTitle>
            <DialogDescription>Shown at the bottom of the v2 portal home while it is live.</DialogDescription>
          </DialogHeader>
          {draft && <PollEditor draft={draft} onChange={setDraft} tenants={tenants} />}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => void save(false)} disabled={saving}>
              {draft?.id ? 'Save' : 'Save as draft'}
            </Button>
            {(!draft?.id || polls.find((p) => p.id === draft.id)?.status !== 'active') && (
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
            <DialogTitle>Delete this poll?</DialogTitle>
            <DialogDescription>
              &ldquo;{confirmDelete?.question}&rdquo; and its {confirmDelete ? countFor(confirmDelete.id) : 0} answer(s) are removed for good. To
              stop showing it but keep the answers, close it instead.
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

function PollEditor({ draft, onChange, tenants }: { draft: Draft; onChange: (d: Draft) => void; tenants: TenantLite[] }) {
  const [search, setSearch] = useState('');
  const [showV1, setShowV1] = useState(false);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tenants
      .filter((t) => t.status === 'active' && t.tenant_type !== 'test')
      .filter((t) => showV1 || isV2(t) || draft.excluded.includes(t.id))
      .filter((t) => !q || (t.company_name ?? '').toLowerCase().includes(q) || t.slug.includes(q))
      .sort((a, b) => Number(isV2(b)) - Number(isV2(a)) || (a.company_name ?? a.slug).localeCompare(b.company_name ?? b.slug));
  }, [tenants, search, showV1, draft.excluded]);

  const toggleExcluded = (id: string) =>
    onChange({ ...draft, excluded: draft.excluded.includes(id) ? draft.excluded.filter((x) => x !== id) : [...draft.excluded, id] });

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="wp-question">Question</Label>
        <Textarea
          id="wp-question"
          rows={2}
          value={draft.question}
          onChange={(e) => onChange({ ...draft, question: e.target.value })}
          placeholder="e.g. Which topic should we cover in the next webinar?"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Answer type</Label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(KIND) as Kind[]).map((k) => {
            const Icon = KIND[k].icon;
            const disabled = draft.optionsLocked && k !== draft.kind;
            return (
              <button
                key={k}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...draft, kind: k })}
                className={cn(
                  'rounded-lg border p-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  draft.kind === k ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50',
                )}
              >
                <Icon className="h-4 w-4 text-primary" />
                <span className="mt-1.5 block font-medium">{KIND[k].label}</span>
                <span className="block text-xs text-muted-foreground">{KIND[k].hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {draft.kind !== 'text' && (
        <div className="space-y-2">
          <Label>Options</Label>
          {draft.optionsLocked && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Tenants have already answered, so options and the answer type can&apos;t change. Close this poll and create a new one
              instead.
            </p>
          )}
          {draft.options.map((o, i) => (
            <div key={o.id} className="flex items-center gap-2">
              {draft.kind === 'single' ? (
                <CircleDot className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <Square className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <Input
                value={o.label}
                disabled={draft.optionsLocked}
                placeholder={`Option ${i + 1}`}
                onChange={(e) =>
                  onChange({ ...draft, options: draft.options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })
                }
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove option"
                disabled={draft.optionsLocked || draft.options.length <= 2}
                onClick={() => onChange({ ...draft, options: draft.options.filter((x) => x.id !== o.id) })}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {!draft.optionsLocked && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onChange({ ...draft, options: [...draft.options, newOption()] })}>
              <Plus className="h-4 w-4" />
              Add option
            </Button>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Who sees it</Label>
          <span className="text-xs text-muted-foreground">
            All tenants{draft.excluded.length ? `, except ${draft.excluded.length} excluded` : ''}
          </span>
        </div>
        <div className="rounded-lg border">
          <div className="flex items-center gap-2 border-b p-2">
            <Search className="ml-1 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tenants to exclude"
              className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
              <input type="checkbox" checked={showV1} onChange={(e) => setShowV1(e.target.checked)} />
              Show v1 tenants
            </label>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {list.length === 0 ? (
              <p className="p-3 text-center text-sm text-muted-foreground">No tenants match.</p>
            ) : (
              list.map((t) => {
                const excluded = draft.excluded.includes(t.id);
                return (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                    <input type="checkbox" checked={excluded} onChange={() => toggleExcluded(t.id)} />
                    <span className={cn('flex-1 truncate', excluded && 'text-muted-foreground line-through')}>{t.company_name || t.slug}</span>
                    {isV2(t) ? (
                      <Badge variant="secondary" className="text-[10px]">
                        v2
                      </Badge>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">v1 — doesn&apos;t see polls</span>
                    )}
                  </label>
                );
              })
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Tick a tenant to exclude it. Polls only appear on v2 portals.</p>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function PollResults({
  poll,
  responses,
  reach,
  tenantById,
}: {
  poll: Poll;
  responses: Response[];
  reach: number;
  tenantById: Map<string, TenantLite>;
}) {
  const labelOf = useMemo(() => new Map(poll.options.map((o) => [o.id, o.label])), [poll.options]);
  const total = responses.length;
  const tally = poll.options.map((o) => {
    const voters = responses.filter((r) => r.option_ids.includes(o.id));
    return { ...o, count: voters.length, voters };
  });
  const top = Math.max(0, ...tally.map((t) => t.count));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="text-lg font-semibold">{poll.question}</p>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{total}</span> of {reach} answered
          {reach > 0 ? ` (${Math.round((total / reach) * 100)}%)` : ''}
          {poll.kind === 'multi' ? ' · multiple choice, so options can add up to more than 100%' : ''}
        </p>
      </div>

      {poll.kind !== 'text' && (
        <div className="space-y-3">
          {tally.map((o) => {
            const pct = total ? Math.round((o.count / total) * 100) : 0;
            return (
              <div key={o.id}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className={cn('font-medium', o.count === top && top > 0 && 'text-primary')}>{o.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {o.count} · {pct}%
                  </span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full rounded-full transition-all duration-500', o.count === top && top > 0 ? 'bg-primary' : 'bg-primary/40')} style={{ width: `${pct}%` }} />
                </div>
                {o.voters.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {o.voters.map((v) => tenantById.get(v.tenant_id)?.company_name || tenantById.get(v.tenant_id)?.slug || 'Unknown').join(', ')}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {total === 0 ? (
        <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">No answers yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Answer</TableHead>
              <TableHead>Answered by</TableHead>
              <TableHead className="whitespace-nowrap">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {responses.map((r) => {
              const t = tenantById.get(r.tenant_id);
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{t?.company_name || t?.slug || 'Unknown tenant'}</TableCell>
                  <TableCell className="max-w-[360px]">
                    {poll.kind === 'text' ? (
                      <span className="whitespace-pre-wrap">{r.text_answer}</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {r.option_ids.map((id) => (
                          <Badge key={id} variant="secondary">
                            {labelOf.get(id) ?? 'Removed option'}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.app_users?.name || r.app_users?.email || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatWhen(r.created_at)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
