'use client';

/**
 * Rewards — the Creator Rewards Programme (v2 tenants only).
 *
 * Operators paste a link to a social video they made about Drive247 on the
 * portal's Rewards page; it lands here as `pending`. A reviewer opens the link,
 * then either:
 *   approve  → a one-time Stripe coupon on the operator's next Drive247 invoice
 *              (a free month = 100% off, or N% off), via `creator-reward-review`
 *   reject   → a message the operator sees on their Rewards page and in their
 *              notification bell (e.g. "this link is fake / not your video")
 *
 * ONE REWARD PER OPERATOR, EVER: once a tenant has an approved submission,
 * its other submissions can only be rejected (the edge function and a unique
 * index both refuse a second approval, with no override).
 *
 * Rules and limits live in `creator_reward_settings` (one row) and are enforced
 * server-side: submission limits by `submit_creator_reward()`, reward limits by
 * the edge function at approval time (a reviewer can override one deliberately).
 */

import { FilterSearch } from '@/components/admin/filter-primitives';
import { EmptyState, NoMatchState } from '@/components/admin/empty-state';
import { MilestonesEmptyArt } from '@/components/admin/illustrations/scenes/admin-scenes';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Gift,
  Loader2,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
  Video,
  XCircle,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { readEdgeFunctionError } from '@/lib/push';
import { useAuthStore } from '@/store/authStore';
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

type Status = 'pending' | 'approved' | 'rejected';
type RewardType = 'free_month' | 'percent';

interface Settings {
  enabled: boolean;
  monthly_submission_limit: number;
  max_pending_per_tenant: number;
  monthly_reward_limit_per_tenant: number;
  monthly_reward_limit_global: number;
  allowed_platforms: string[];
  default_reward_type: RewardType;
  default_reward_percent: number;
  rules: string;
  updated_at: string;
}

interface Submission {
  id: string;
  tenant_id: string;
  url: string;
  platform: string;
  note: string | null;
  status: Status;
  admin_message: string | null;
  reviewed_at: string | null;
  reward_type: RewardType | null;
  reward_percent: number | null;
  reward_status: 'applied' | 'pending' | 'failed' | null;
  reward_error: string | null;
  created_at: string;
}

interface TenantLite {
  id: string;
  company_name: string | null;
  slug: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const PLATFORMS: { id: string; label: string }[] = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'x', label: 'X / Twitter' },
  { id: 'linkedin', label: 'LinkedIn' },
];
const platformLabel = (id: string) => PLATFORMS.find((p) => p.id === id)?.label ?? id;

const REJECT_TEMPLATES = [
  {
    label: 'Fake / broken link',
    text: 'We couldn’t verify this link — it doesn’t open a real post, or the post has been removed. Please submit the direct link to your published video.',
  },
  {
    label: 'Not about Drive247',
    text: 'We opened your link, but the video isn’t about Drive247. Rewards are for content featuring your experience with Drive247.',
  },
  {
    label: 'Private post',
    text: 'This post is private or restricted, so we couldn’t view it. Please make it public and submit the link again.',
  },
  {
    label: 'Already rewarded',
    text: 'Thank you for sharing another video! You’ve already received your creator reward — it’s one per account — so this one isn’t eligible for another.',
  },
  {
    label: 'Not your content',
    text: 'This video doesn’t appear to be posted by your business. Rewards are for original content from your own account.',
  },
];

function monthStartUtc(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function rewardText(s: Pick<Submission, 'reward_type' | 'reward_percent'>): string {
  if (s.reward_type === 'free_month') return 'Free month';
  if (s.reward_type === 'percent') return `${s.reward_percent}% off`;
  return '—';
}

class LimitError extends Error {}

async function review(body: Record<string, unknown>): Promise<Submission> {
  const { data, error } = await supabase.functions.invoke('creator-reward-review', { body });
  if (error) {
    let limit = false;
    try {
      const parsed = await (error as { context?: Response }).context?.clone().json();
      // Monthly limits can be overridden; "once" (already rewarded) cannot.
      limit = parsed?.limit === 'tenant' || parsed?.limit === 'global';
    } catch {
      /* not JSON */
    }
    const message = await readEdgeFunctionError(error, 'Review failed');
    throw limit ? new LimitError(message) : new Error(message);
  }
  return (data as { submission: Submission }).submission;
}

function StatusBadge({ s }: { s: Submission }) {
  if (s.status === 'pending')
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
        <Clock className="h-3 w-3" /> Pending
      </Badge>
    );
  if (s.status === 'rejected')
    return (
      <Badge variant="outline" className="gap-1 border-red-500/40 text-red-700 dark:text-red-400">
        <XCircle className="h-3 w-3" /> Rejected
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 border-green-500/40 text-green-700 dark:text-green-400">
      <CheckCircle2 className="h-3 w-3" /> Approved
    </Badge>
  );
}

function RewardCell({ s }: { s: Submission }) {
  if (s.status !== 'approved') return <span className="text-muted-foreground">—</span>;
  return (
    <div>
      <div className="font-medium">{rewardText(s)}</div>
      <div
        className={cn(
          'text-xs',
          s.reward_status === 'applied' && 'text-green-700 dark:text-green-400',
          s.reward_status === 'pending' && 'text-amber-700 dark:text-amber-400',
          s.reward_status === 'failed' && 'text-red-700 dark:text-red-400',
        )}
        title={s.reward_error ?? undefined}
      >
        {s.reward_status === 'applied'
          ? 'On next invoice'
          : s.reward_status === 'pending'
            ? 'Waiting for subscription'
            : s.reward_status === 'failed'
              ? 'Stripe failed'
              : '—'}
      </div>
    </div>
  );
}

export function CreatorRewardsTab({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rows, setRows] = useState<Submission[]>([]);
  const [tenants, setTenants] = useState<Map<string, TenantLite>>(new Map());

  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('pending');
  const [search, setSearch] = useState('');

  const [reviewing, setReviewing] = useState<Submission | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [deleting, setDeleting] = useState<Submission | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, subs] = await Promise.all([
        db.from('creator_reward_settings').select('*').eq('id', 1).single(),
        db
          .from('creator_reward_submissions')
          .select(
            'id, tenant_id, url, platform, note, status, admin_message, reviewed_at, reward_type, reward_percent, reward_status, reward_error, created_at',
          )
          .order('created_at', { ascending: false })
          .limit(1000),
      ]);
      for (const res of [s, subs]) if (res.error) throw res.error;
      const list = (subs.data as Submission[]) ?? [];
      setSettings(s.data as Settings);
      setRows(list);
      const ids = [...new Set(list.map((r) => r.tenant_id))];
      if (ids.length) {
        const t = await db.from('tenants').select('id, company_name, slug').in('id', ids);
        if (t.error) throw t.error;
        setTenants(new Map(((t.data as TenantLite[]) ?? []).map((x) => [x.id, x])));
      }
    } catch (e) {
      toast.error('Could not load creator rewards', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // New submissions appear without a refresh.
  useEffect(() => {
    const channel = supabase
      .channel('admin-creator-rewards')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'creator_reward_submissions' }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const nameOf = useCallback(
    (tenantId: string) => {
      const t = tenants.get(tenantId);
      return t ? t.company_name || t.slug : tenantId.slice(0, 8);
    },
    [tenants],
  );

  const rewardedTenants = useMemo(
    () => new Set(rows.filter((r) => r.status === 'approved').map((r) => r.tenant_id)),
    [rows],
  );

  const since = monthStartUtc();
  const stats = useMemo(() => {
    const approvedThisMonth = rows.filter((r) => r.status === 'approved' && r.reviewed_at && r.reviewed_at >= since);
    return {
      pending: rows.filter((r) => r.status === 'pending').length,
      approvedThisMonth: approvedThisMonth.length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
      needsAttention: rows.filter((r) => r.status === 'approved' && r.reward_status !== 'applied').length,
    };
  }, [rows, since]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      const t = tenants.get(r.tenant_id);
      return (
        r.url.toLowerCase().includes(q) ||
        (t?.company_name ?? '').toLowerCase().includes(q) ||
        (t?.slug ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, statusFilter, search, tenants]);

  const replaceRow = (s: Submission) => setRows((list) => list.map((r) => (r.id === s.id ? { ...r, ...s } : r)));

  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const { error } = await db.from('creator_reward_submissions').delete().eq('id', deleting.id);
      if (error) throw error;
      setRows((list) => list.filter((r) => r.id !== deleting.id));
      toast.success('Submission deleted');
      setDeleting(null);
    } catch (e) {
      toast.error('Could not delete the submission', { description: (e as Error).message });
    } finally {
      setDeleteBusy(false);
    }
  };

  if (loading && !settings) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── header ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Gift className="h-5 w-5 text-primary" />
                Creator Rewards
              </CardTitle>
              <CardDescription>
                V2 operators submit links to social videos they made about Drive247. Open each link, then approve it
                with a reward on their next invoice, or reject it with a message they’ll see in their portal.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRulesOpen(true)}>
                <Settings2 className="h-4 w-4" />
                Rules & limits
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings && !settings.enabled && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              The programme is paused — operators can see their past submissions but can’t submit new links.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Waiting for review" value={stats.pending} />
            <Stat
              label="Rewards this month"
              value={stats.approvedThisMonth}
              suffix={settings ? `of ${settings.monthly_reward_limit_global}` : undefined}
            />
            <Stat label="Rejected (all time)" value={stats.rejected} />
            <Stat label="Rewards not applied" value={stats.needsAttention} warn={stats.needsAttention > 0} />
          </div>
          {!canEdit && (
            <p className="text-sm text-muted-foreground">Read-only: reviewing needs a super admin account.</p>
          )}
        </CardContent>
      </Card>

      {/* ── submissions ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Submissions</CardTitle>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <FilterSearch scopeLabel="Creator rewards" value={search} onChange={setSearch} placeholder="Search operator or link" />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as Status | 'all')}>
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending ({stats.pending})</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {shown.length === 0 ? (
            rows.length === 0 ? (
              <EmptyState
                size="section"
                illustration={<MilestonesEmptyArt />}
                headline="No submissions yet"
                body="Operators who post about Drive247 send their link from the portal. Each one waits here for review."
              />
            ) : (
              <NoMatchState size="section" noun="submissions" />
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operator</TableHead>
                    <TableHead className="min-w-[260px]">Link</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reward</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5 font-medium">
                          {nameOf(s.tenant_id)}
                          {rewardedTenants.has(s.tenant_id) && (
                            <Badge variant="secondary" className="gap-1 text-[10px]" title="This operator has had their one reward">
                              <Gift className="h-3 w-3" /> Rewarded
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{tenants.get(s.tenant_id)?.slug}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="shrink-0">
                            {platformLabel(s.platform)}
                          </Badge>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="inline-flex max-w-[320px] items-center gap-1 truncate text-sm text-primary hover:underline"
                            title={s.url}
                          >
                            <span className="truncate">{s.url.replace(/^https:\/\/(www\.)?/, '')}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        </div>
                        {s.note && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">“{s.note}”</p>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(s.created_at)}</TableCell>
                      <TableCell>
                        <StatusBadge s={s} />
                      </TableCell>
                      <TableCell>
                        <RewardCell s={s} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant={s.status === 'pending' ? 'default' : 'outline'}
                            onClick={() => setReviewing(s)}
                          >
                            {s.status === 'pending' ? 'Review' : 'View'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            aria-label="Delete submission"
                            disabled={!canEdit}
                            onClick={() => setDeleting(s)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {reviewing && settings && (
        <ReviewDialog
          submission={reviewing}
          operator={nameOf(reviewing.tenant_id)}
          history={rows.filter((r) => r.tenant_id === reviewing.tenant_id && r.id !== reviewing.id)}
          settings={settings}
          canEdit={canEdit}
          onClose={() => setReviewing(null)}
          onUpdated={(s) => {
            replaceRow(s);
            setReviewing(null);
          }}
        />
      )}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && !deleteBusy && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete submission?</DialogTitle>
            <DialogDescription>
              {deleting && nameOf(deleting.tenant_id)}’s submission will be removed from this list and from their
              Rewards page. This can’t be undone, and the same link can then be submitted again.
            </DialogDescription>
          </DialogHeader>
          {deleting?.status === 'approved' && deleting.reward_status === 'applied' && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              Its reward is already on the operator’s subscription. Deleting the submission does not remove that
              discount from Stripe.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={deleteBusy} className="gap-1.5">
              {deleteBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {rulesOpen && settings && (
        <RulesDialog
          settings={settings}
          canEdit={canEdit}
          userId={user?.id ?? null}
          onClose={() => setRulesOpen(false)}
          onSaved={(s) => {
            setSettings(s);
            setRulesOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, suffix, warn }: { label: string; value: number; suffix?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={cn('text-2xl font-semibold tabular-nums', warn && 'text-amber-700 dark:text-amber-400')}>
          {value}
        </span>
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

// ── review ──────────────────────────────────────────────────────────────────

function ReviewDialog({
  submission: s,
  operator,
  history,
  settings,
  canEdit,
  onClose,
  onUpdated,
}: {
  submission: Submission;
  operator: string;
  history: Submission[];
  settings: Settings;
  canEdit: boolean;
  onClose: () => void;
  onUpdated: (s: Submission) => void;
}) {
  // One reward per operator: if another of their videos was approved, this one
  // can only be rejected.
  const alreadyRewarded = history.some((r) => r.status === 'approved');
  const [decision, setDecision] = useState<'approve' | 'reject'>(alreadyRewarded ? 'reject' : 'approve');
  const [rewardType, setRewardType] = useState<RewardType>(settings.default_reward_type);
  const [percent, setPercent] = useState(String(settings.default_reward_percent));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [limitHit, setLimitHit] = useState<string | null>(null);

  const since = monthStartUtc();
  const rewardsThisMonth = history.filter((r) => r.status === 'approved' && r.reviewed_at && r.reviewed_at >= since).length;
  const rejectedBefore = history.filter((r) => r.status === 'rejected').length;

  const pct = Number(percent);
  const percentInvalid = rewardType === 'percent' && (!Number.isInteger(pct) || pct < 1 || pct > 100);

  const run = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    try {
      const updated = await review({ submissionId: s.id, ...body });
      if (updated.status === 'approved' && updated.reward_status !== 'applied' && body.action !== 'reject') {
        toast.warning(success, {
          description:
            updated.reward_status === 'pending'
              ? 'The operator has no active subscription yet — use “Apply reward” once they subscribe.'
              : `Stripe refused the coupon: ${updated.reward_error ?? 'unknown error'}`,
        });
      } else {
        toast.success(success);
      }
      onUpdated(updated);
    } catch (e) {
      if (e instanceof LimitError) setLimitHit(e.message);
      else toast.error('Could not save the review', { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const approve = (override = false) =>
    void run(
      {
        action: 'approve',
        rewardType,
        percent: rewardType === 'percent' ? pct : undefined,
        message: message.trim() || undefined,
        override,
      },
      'Approved — the operator has been notified',
    );

  const reject = () =>
    void run({ action: 'reject', message: message.trim() }, 'Rejected — the operator has been notified');

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="h-5 w-5" />
            {operator}
          </DialogTitle>
          <DialogDescription>
            Submitted {formatDate(s.created_at)} · {platformLabel(s.platform)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border p-4">
            <div className="text-xs text-muted-foreground">Link</div>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-1 block break-all text-sm text-primary hover:underline"
            >
              {s.url}
            </a>
            <Button asChild size="sm" variant="outline" className="mt-3 gap-1.5">
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                <ExternalLink className="h-4 w-4" />
                Open video to verify
              </a>
            </Button>
            {s.note && (
              <>
                <div className="mt-4 text-xs text-muted-foreground">Operator’s note</div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{s.note}</p>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span>
              Rewards this month: <strong className="text-foreground">{rewardsThisMonth}</strong> /{' '}
              {settings.monthly_reward_limit_per_tenant}
            </span>
            <span>
              Other submissions: <strong className="text-foreground">{history.length}</strong>
            </span>
            {rejectedBefore > 0 && (
              <span className="text-amber-700 dark:text-amber-400">Rejected before: {rejectedBefore}</span>
            )}
          </div>

          {alreadyRewarded && s.status === 'pending' && (
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <Gift className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {operator} has already been rewarded for another video. Creator rewards are one per operator, so this
                submission can only be rejected.
              </p>
            </div>
          )}

          {s.status !== 'pending' ? (
            <ReviewedSummary s={s} canEdit={canEdit} busy={busy} run={run} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={decision === 'approve' ? 'default' : 'outline'}
                  className="gap-1.5"
                  disabled={alreadyRewarded}
                  onClick={() => setDecision('approve')}
                >
                  <CheckCircle2 className="h-4 w-4" /> Approve & reward
                </Button>
                <Button
                  type="button"
                  variant={decision === 'reject' ? 'destructive' : 'outline'}
                  className="gap-1.5"
                  onClick={() => setDecision('reject')}
                >
                  <XCircle className="h-4 w-4" /> Reject
                </Button>
              </div>

              {decision === 'approve' ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Reward</Label>
                      <Select value={rewardType} onValueChange={(v) => setRewardType(v as RewardType)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="free_month">Free month (100% off next invoice)</SelectItem>
                          <SelectItem value="percent">Percentage off next invoice</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {rewardType === 'percent' && (
                      <div className="space-y-1.5">
                        <Label htmlFor="cr-pct">Percent off</Label>
                        <Input
                          id="cr-pct"
                          type="number"
                          min={1}
                          max={100}
                          value={percent}
                          onChange={(e) => setPercent(e.target.value)}
                        />
                        {percentInvalid && <p className="text-xs text-destructive">1–100</p>}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-msg">Message to the operator (optional)</Label>
                    <Textarea
                      id="cr-msg"
                      rows={3}
                      maxLength={1000}
                      value={message}
                      placeholder="Loved the video — thanks for spreading the word!"
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Applied to their Drive247 subscription as a one-time discount. Their other discounts (referral,
                    promo) are kept.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {REJECT_TEMPLATES.map((t) => (
                      <Button key={t.label} type="button" size="sm" variant="outline" onClick={() => setMessage(t.text)}>
                        {t.label}
                      </Button>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cr-reject">Message to the operator *</Label>
                    <Textarea
                      id="cr-reject"
                      rows={4}
                      maxLength={1000}
                      value={message}
                      placeholder="Explain why — e.g. the link is fake or the video isn’t theirs."
                      onChange={(e) => setMessage(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Shown on their Rewards page and in their notifications straight away.
                    </p>
                  </div>
                </div>
              )}

              {limitHit && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                  <p>{limitHit}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={busy || !canEdit}
                    onClick={() => approve(true)}
                  >
                    Approve anyway (override limit)
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
          {s.status === 'pending' &&
            (decision === 'approve' ? (
              <Button onClick={() => approve()} disabled={!canEdit || busy || percentInvalid || alreadyRewarded} className="gap-1.5">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Approve & send reward
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={reject}
                disabled={!canEdit || busy || !message.trim()}
                className="gap-1.5"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Reject & notify
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewedSummary({
  s,
  canEdit,
  busy,
  run,
}: {
  s: Submission;
  canEdit: boolean;
  busy: boolean;
  run: (body: Record<string, unknown>, success: string) => Promise<void>;
}) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <StatusBadge s={s} />
        {s.reviewed_at && <span className="text-xs text-muted-foreground">Reviewed {formatDate(s.reviewed_at)}</span>}
      </div>
      {s.status === 'approved' && (
        <div className="text-sm">
          Reward: <strong>{rewardText(s)}</strong>
          {s.reward_status === 'applied' && <span className="text-green-700 dark:text-green-400"> · on their next invoice</span>}
          {s.reward_status !== 'applied' && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {s.reward_status === 'pending' ? 'Not applied yet — ' : 'Stripe failed — '}
              {s.reward_error}
            </p>
          )}
        </div>
      )}
      {s.admin_message && (
        <div>
          <div className="text-xs text-muted-foreground">Message sent</div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{s.admin_message}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {s.status === 'approved' && s.reward_status !== 'applied' && (
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!canEdit || busy}
            onClick={() => void run({ action: 'apply' }, 'Reward applied')}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
            Apply reward now
          </Button>
        )}
        {s.status === 'rejected' && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={!canEdit || busy}
            onClick={() => void run({ action: 'reopen' }, 'Moved back to pending')}
          >
            <RotateCcw className="h-4 w-4" />
            Reopen for review
          </Button>
        )}
      </div>
    </div>
  );
}

// ── rules & limits ──────────────────────────────────────────────────────────

function RulesDialog({
  settings,
  canEdit,
  userId,
  onClose,
  onSaved,
}: {
  settings: Settings;
  canEdit: boolean;
  userId: string | null;
  onClose: () => void;
  onSaved: (s: Settings) => void;
}) {
  const [draft, setDraft] = useState({
    ...settings,
    monthly_submission_limit: String(settings.monthly_submission_limit),
    max_pending_per_tenant: String(settings.max_pending_per_tenant),
    monthly_reward_limit_per_tenant: String(settings.monthly_reward_limit_per_tenant),
    monthly_reward_limit_global: String(settings.monthly_reward_limit_global),
    default_reward_percent: String(settings.default_reward_percent),
  });
  const [saving, setSaving] = useState(false);

  const num = (v: string, min: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const values = {
    monthly_submission_limit: num(draft.monthly_submission_limit, 1, 100),
    max_pending_per_tenant: num(draft.max_pending_per_tenant, 1, 100),
    monthly_reward_limit_per_tenant: num(draft.monthly_reward_limit_per_tenant, 0, 100),
    monthly_reward_limit_global: num(draft.monthly_reward_limit_global, 0, 10000),
    default_reward_percent: num(draft.default_reward_percent, 1, 100),
  };
  const invalid = Object.values(values).some((v) => v === null) || draft.allowed_platforms.length === 0;

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    try {
      const { data, error } = await db
        .from('creator_reward_settings')
        .update({
          enabled: draft.enabled,
          ...values,
          allowed_platforms: draft.allowed_platforms,
          default_reward_type: draft.default_reward_type,
          rules: draft.rules.trim(),
          updated_at: new Date().toISOString(),
          updated_by: userId,
        })
        .eq('id', 1)
        .select('*')
        .single();
      if (error) throw error;
      toast.success('Rules saved');
      onSaved(data as Settings);
    } catch (e) {
      toast.error('Could not save the rules', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof values, label: string, hint: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`cr-${key}`}>{label}</Label>
      <Input
        id={`cr-${key}`}
        type="number"
        value={draft[key]}
        disabled={!canEdit}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
      <p className={cn('text-xs', values[key] === null ? 'text-destructive' : 'text-muted-foreground')}>{hint}</p>
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Rules & limits</DialogTitle>
          <DialogDescription>Enforced on the server — operators can’t get around them from the portal.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Programme open</div>
              <div className="text-xs text-muted-foreground">When off, operators can’t submit new links.</div>
            </div>
            <Switch
              checked={draft.enabled}
              disabled={!canEdit}
              onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            {field('monthly_submission_limit', 'Submissions per operator / month', '1–100, counted per calendar month')}
            {field('max_pending_per_tenant', 'Pending at once per operator', '1–100 waiting for review')}
            {field('monthly_reward_limit_per_tenant', 'Rewards per operator / month', '0–100 approvals')}
            {field('monthly_reward_limit_global', 'Rewards across all operators / month', '0–10000 approvals')}
          </div>

          <div className="space-y-1.5">
            <Label>Allowed platforms</Label>
            <div className="flex flex-wrap gap-3">
              {PLATFORMS.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={draft.allowed_platforms.includes(p.id)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        allowed_platforms: e.target.checked
                          ? [...draft.allowed_platforms, p.id]
                          : draft.allowed_platforms.filter((x) => x !== p.id),
                      })
                    }
                  />
                  {p.label}
                </label>
              ))}
            </div>
            {draft.allowed_platforms.length === 0 && <p className="text-xs text-destructive">Pick at least one.</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Default reward</Label>
              <Select
                value={draft.default_reward_type}
                disabled={!canEdit}
                onValueChange={(v) => setDraft({ ...draft, default_reward_type: v as RewardType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free_month">Free month</SelectItem>
                  <SelectItem value="percent">Percentage off</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.default_reward_type === 'percent' &&
              field('default_reward_percent', 'Default percent off', '1–100, pre-filled when approving')}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cr-rules">Rules shown to operators</Label>
            <Textarea
              id="cr-rules"
              rows={5}
              disabled={!canEdit}
              value={draft.rules}
              onChange={(e) => setDraft({ ...draft, rules: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">One rule per line.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!canEdit || saving || invalid} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save rules
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
