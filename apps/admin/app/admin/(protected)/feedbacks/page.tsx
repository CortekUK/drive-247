'use client';

/**
 * Feedback (Ghulam, Oct 19 2026: "just a simple list, no AI and stats; I should
 * be able to run campaigns, each one separate with its feedback, and see which
 * tenants answered and which didn't").
 *
 * The page is a grid of cards: "All feedback" first, then one per campaign.
 * Each opens its own view, with a way back to the cards.
 *
 *   All feedback   every reply, newest first. Open one to read it, see the
 *                  screenshot, and mark it resolved.
 *   Campaigns      each round of "ask every operator on their next sign-in".
 *                  Open one for its feedback, by tenant, and the tenants that
 *                  have not answered (saw it and skipped, or not signed in yet).
 *
 * A campaign is the portal's existing prompt: starting one sets
 * tenant_feedback_settings.force_login_triggered_at, ending one clears it, and
 * a database trigger tags prompt replies (source = 'forced') with the live
 * campaign (supabase/migrations/20261019120000_feedback_campaigns.sql). One
 * campaign is live at a time; starting a new one ends the old one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, MoreVertical, Star, ImageIcon, Loader2, Plus, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { confirmDialog } from '@/components/ui/confirm';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HEADER_ACTIONS, HEADER_PRIMARY } from '@/components/admin/header-buttons';
import { EmptyState } from '@/components/admin/empty-state';
import { FeedbackEmptyArt } from '@/components/admin/illustrations/scenes/admin-scenes';
import { CATEGORY_META, type Category } from '@/components/admin/feedback-category';
import { SegmentedControl } from '@/components/announcements/segmented-control';
import { cn } from '@/lib/utils';

interface Feedback {
  id: string;
  tenant_id: string;
  submitter_name: string | null;
  submitter_email: string | null;
  submitter_role: string | null;
  category: Category;
  message: string;
  screenshot_path: string | null;
  page_path: string | null;
  status: 'open' | 'resolved';
  source: string | null;
  campaign_id: string | null;
  /** 1 to 5 stars, when the operator gave one. */
  rating: number | null;
  created_at: string;
  tenants?: { company_name: string | null; slug: string | null } | null;
}

interface Campaign {
  id: string;
  name: string;
  started_at: string;
  ended_at: string | null;
}

interface TenantLite {
  id: string;
  company_name: string | null;
  slug: string | null;
}

const FEEDBACK_COLUMNS =
  'id,tenant_id,submitter_name,submitter_email,submitter_role,category,message,screenshot_path,page_path,status,source,campaign_id,rating,created_at,tenants(company_name,slug)';


const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
/** Average of the replies that carry a rating, or null when none do. */
const avgRating = (list: Feedback[]): { avg: number; count: number } | null => {
  const rated = list.filter((f) => typeof f.rating === 'number');
  if (rated.length === 0) return null;
  return { avg: rated.reduce((n, f) => n + (f.rating as number), 0) / rated.length, count: rated.length };
};

/** Five stars, filled to the value (halves round to the nearest whole star). */
function Stars({ value, size = 'sm' }: { value: number; size?: 'sm' | 'md' }) {
  const filled = Math.round(value);
  const cls = size === 'md' ? 'size-4' : 'size-3.5';
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn(cls, i <= filled ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-foreground/20')} aria-hidden />
      ))}
    </span>
  );
}

/** "★★★★☆ 4.2 avg · 12 rated", or "No ratings yet". */
function AvgRating({ list }: { list: Feedback[] }) {
  const r = avgRating(list);
  if (!r) return <span className="text-xs text-muted-foreground">No ratings yet</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Stars value={r.avg} />
      <span className="font-semibold text-foreground">{r.avg.toFixed(1)}</span> avg · {r.count} rated
    </span>
  );
}

const tenantLabel = (t: { company_name: string | null; slug: string | null } | null | undefined) => t?.company_name || t?.slug || 'Unknown company';

export default function FeedbacksPage() {
  const { user } = useAuthStore();
  // The "All feedback" card is open (a campaign's card uses openCampaignId).
  const [openAll, setOpenAll] = useState(false);
  const [items, setItems] = useState<Feedback[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Feedback | null>(null);
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [settingsRowId, setSettingsRowId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [fb, cs, st] = await Promise.all([
      supabase.from('tenant_feedback').select(FEEDBACK_COLUMNS).order('created_at', { ascending: false }).limit(500),
      supabase.from('feedback_campaigns').select('id,name,started_at,ended_at').order('started_at', { ascending: false }),
      supabase.from('tenant_feedback_settings').select('id').limit(1).maybeSingle(),
    ]);
    if (fb.error) toast.error(`Could not load feedback: ${fb.error.message}`);
    if (cs.error) toast.error(`Could not load campaigns: ${cs.error.message}`);
    setItems((fb.data as unknown as Feedback[] | null) ?? []);
    setCampaigns((cs.data as Campaign[] | null) ?? []);
    setSettingsRowId((st.data as { id: string } | null)?.id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);


  const campaignById = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);
  const live = campaigns.find((c) => !c.ended_at) ?? null;
  const openCampaign = openCampaignId ? campaignById.get(openCampaignId) ?? null : null;

  const toggleStatus = async (item: Feedback) => {
    const next = item.status === 'open' ? 'resolved' : 'open';
    const { error } = await supabase
      .from('tenant_feedback')
      .update({
        status: next,
        resolved_at: next === 'resolved' ? new Date().toISOString() : null,
        resolved_by: next === 'resolved' ? user?.id ?? null : null,
      })
      .eq('id', item.id);
    if (error) {
      toast.error(`Could not update: ${error.message}`);
      return;
    }
    setItems((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: next } : f)));
    setDetail((d) => (d && d.id === item.id ? { ...d, status: next } : d));
    toast.success(next === 'resolved' ? 'Marked resolved' : 'Reopened');
  };

  const setPrompt = async (at: string | null) => {
    if (!settingsRowId) return { message: 'The feedback settings row is missing.' };
    const { error } = await supabase.from('tenant_feedback_settings').update({ force_login_triggered_at: at }).eq('id', settingsRowId);
    return error;
  };

  const startCampaign = async (name: string, excluded: string[]) => {
    const now = new Date().toISOString();
    if (live) {
      const { error } = await supabase.from('feedback_campaigns').update({ ended_at: now, updated_at: now }).eq('id', live.id);
      if (error) {
        toast.error(`Could not end "${live.name}": ${error.message}`);
        return false;
      }
    }
    const { data, error } = await supabase
      .from('feedback_campaigns')
      .insert({ name: name.trim(), started_at: now, created_by: user?.id ?? null })
      .select('id,name,started_at,ended_at')
      .single();
    if (error || !data) {
      toast.error(`Could not start the campaign: ${error?.message ?? 'no row came back'}`);
      void load();
      return false;
    }
    // Leave companies out BEFORE the prompt switches on, so nobody left out is asked in between.
    const results = await Promise.all(
      excluded.map((tenantId) =>
        supabase.rpc('feedback_campaign_set_excluded', { p_campaign: (data as Campaign).id, p_tenant: tenantId, p_excluded: true }),
      ),
    );
    const failed = results.filter((r) => r.error).length;
    if (failed) toast.error(`${failed} ${failed === 1 ? 'company' : 'companies'} could not be left out. Try again from the campaign.`);
    const promptError = await setPrompt(now);
    if (promptError) toast.error(`Campaign saved, but the portal prompt did not switch on: ${promptError.message}`);
    else toast.success('Campaign started. Operators are asked on their next sign-in.');
    await load();
    setOpenCampaignId((data as Campaign).id);
    return true;
  };

  const endCampaign = async (c: Campaign) => {
    const ok = await confirmDialog({
      title: `End "${c.name}"?`,
      description: 'Operators who have not been asked yet will not be asked.',
      confirmLabel: 'End campaign',
      destructive: true,
    });
    if (!ok) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from('feedback_campaigns').update({ ended_at: now, updated_at: now }).eq('id', c.id);
    if (error) {
      toast.error(`Could not end it: ${error.message}`);
      return;
    }
    const promptError = await setPrompt(null);
    if (promptError) toast.error(`Ended, but the portal prompt is still on: ${promptError.message}`);
    else toast.success('Campaign ended');
    void load();
  };

  // Its replies stay, under All feedback; only the campaign and its list go.
  const deleteCampaign = async (c: Campaign) => {
    const replies = items.filter((f) => f.campaign_id === c.id).length;
    const ok = await confirmDialog({
      title: `Delete "${c.name}"?`,
      description:
        (c.ended_at ? '' : 'It stops asking operators straight away. ') +
        (replies
          ? `Its ${replies} ${replies === 1 ? 'reply stays' : 'replies stay'} in All feedback.`
          : 'It has no replies yet.'),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('feedback_campaigns').delete().eq('id', c.id);
    if (error) {
      toast.error(`Could not delete: ${error.message}`);
      return;
    }
    if (!c.ended_at) {
      const promptError = await setPrompt(null);
      if (promptError) toast.error(`Deleted, but the portal prompt is still on: ${promptError.message}`);
    }
    if (openCampaignId === c.id) setOpenCampaignId(null);
    toast.success('Campaign deleted');
    void load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Feedback</h1>
          <p className="text-sm text-muted-foreground">What operators tell us, from the portal and from campaigns.</p>
        </div>
        <div className={HEADER_ACTIONS}>
          <Button className={HEADER_PRIMARY} onClick={() => setCreating(true)} disabled={loading}>
            <Plus className="h-4 w-4" />
            New campaign
          </Button>
        </div>
      </div>


      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-2xl border border-border bg-muted/40" />
          ))}
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {/* First: everything, across every campaign and the portal form. */}
          <li>
            <button
              type="button"
              onClick={() => setOpenAll(true)}
              className="flex h-full w-full flex-col gap-3 rounded-3xl border border-primary/25 bg-primary/[0.04] p-5 text-left transition-colors hover:border-primary/50"
            >
              <span className="space-y-1">
                <span className="flex items-center justify-between gap-3">
                  <span className="text-base font-semibold text-foreground">All feedback</span>
                  {items.some((f) => f.status === 'open') && (
                    <span className="shrink-0 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-medium text-warning">
                      {items.filter((f) => f.status === 'open').length} open
                    </span>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">Every campaign and the portal form</span>
              </span>
              <span className="text-sm text-foreground">
                {items.length} {items.length === 1 ? 'reply' : 'replies'} from {new Set(items.map((f) => f.tenant_id)).size}{' '}
                {new Set(items.map((f) => f.tenant_id)).size === 1 ? 'company' : 'companies'}
              </span>
              <AvgRating list={items} />
            </button>
          </li>
          {campaigns.map((c) => {
            const replies = items.filter((f) => f.campaign_id === c.id);
            const companies = new Set(replies.map((f) => f.tenant_id)).size;
            return (
              <li key={c.id} className="relative">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${c.name} actions`}
                      className="absolute right-3 top-[18px] z-10 inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted"
                    >
                      <MoreVertical className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[170px]">
                    {!c.ended_at && <DropdownMenuItem onSelect={() => void endCampaign(c)}>End campaign</DropdownMenuItem>}
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void deleteCampaign(c)}>
                      Delete campaign
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  type="button"
                  onClick={() => setOpenCampaignId(c.id)}
                  className="flex h-full w-full flex-col gap-3 rounded-3xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40"
                >
                  <span className="space-y-1">
                    <span className="flex items-center justify-between gap-3 pr-8">
                      <span className="min-w-0 truncate text-base font-semibold text-foreground">{c.name}</span>
                      <CampaignPill campaign={c} />
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {fmtDate(c.started_at)} – {c.ended_at ? fmtDate(c.ended_at) : 'now'}
                    </span>
                  </span>
                  <span className="text-sm text-foreground">
                    {replies.length} {replies.length === 1 ? 'reply' : 'replies'} from {companies} {companies === 1 ? 'company' : 'companies'}
                  </span>
                  <AvgRating list={replies} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* A campaign, in one big dialog: replies by company, then who has not answered. */}
      <Dialog open={openCampaign !== null} onOpenChange={(o) => !o && setOpenCampaignId(null)}>
        <DialogContent
          className="flex max-h-[88vh] w-[96vw] max-w-[1100px] flex-col gap-0 overflow-hidden rounded-3xl p-0"
          showCloseButton={false}
          // No focus ring landing on End campaign the moment it opens.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">{openCampaign?.name ?? 'Campaign'}</DialogTitle>
          <div className="min-h-0 overflow-y-auto p-6 [scrollbar-width:thin]">
            {openCampaign && (
              <CampaignView
                campaign={openCampaign}
                feedback={items.filter((f) => f.campaign_id === openCampaign.id)}
                onEnd={() => void endCampaign(openCampaign)}
                onOpenFeedback={setDetail}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Everything, across every campaign and the portal form. */}
      <Dialog open={openAll} onOpenChange={setOpenAll}>
        <DialogContent className="flex max-h-[88vh] w-[96vw] max-w-[900px] flex-col gap-0 overflow-hidden rounded-3xl p-0">
          <DialogHeader className="border-b border-border px-6 pb-4 pt-6 text-left">
            <DialogTitle>All feedback</DialogTitle>
            <DialogDescription>Every reply, from the portal and from every campaign, newest first.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto p-6 [scrollbar-width:thin]">
            {items.length === 0 ? (
              <EmptyState illustration={<FeedbackEmptyArt />} headline="No feedback yet" body="Replies from the portal's feedback form show up here." />
            ) : (
              <ul className="space-y-2">
                {items.map((f) => (
                  <FeedbackRow key={f.id} item={f} campaign={f.campaign_id ? campaignById.get(f.campaign_id) : undefined} onOpen={() => setDetail(f)} />
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <FeedbackDetail item={detail} campaign={detail?.campaign_id ? campaignById.get(detail.campaign_id) : undefined} onClose={() => setDetail(null)} onToggle={toggleStatus} />
      <NewCampaignDialog open={creating} live={live} onClose={() => setCreating(false)} onStart={startCampaign} />
    </div>
  );
}

function CampaignPill({ campaign }: { campaign: Campaign }) {
  return campaign.ended_at ? (
    <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">Ended</span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success">
      <span className="size-1.5 rounded-full bg-success" /> Live
    </span>
  );
}

function CategoryChip({ category }: { category: Category }) {
  const meta = CATEGORY_META[category] ?? CATEGORY_META.note;
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: meta.color, backgroundColor: meta.color + '14' }}>
      <Icon className="size-3" aria-hidden /> {meta.label}
    </span>
  );
}

function FeedbackRow({ item, campaign, onOpen, hideCompany = false }: { item: Feedback; campaign?: Campaign; onOpen: () => void; hideCompany?: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex w-full items-start gap-4 rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40',
          item.status === 'resolved' && 'opacity-60',
        )}
      >
        <span className="min-w-0 flex-1 space-y-1">
          <span className="line-clamp-2 text-sm text-foreground">{item.message}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <CategoryChip category={item.category} />
            {item.rating !== null && <Stars value={item.rating} />}
            {!hideCompany && <span className="font-medium text-foreground">{tenantLabel(item.tenants)}</span>}
            {item.submitter_name && <span>{item.submitter_name}</span>}
            <span>{fmtDateTime(item.created_at)}</span>
            {campaign && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{campaign.name}</span>}
            {item.screenshot_path && <ImageIcon className="size-3.5" aria-label="Has a screenshot" />}
          </span>
        </span>
        {item.status === 'resolved' && (
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success">
            <Check className="size-3.5" aria-hidden /> Resolved
          </span>
        )}
      </button>
    </li>
  );
}

/** One campaign: its replies grouped by company, then the companies that have not answered. */
function CampaignView({
  campaign,
  feedback,
  onEnd,
  onOpenFeedback,
}: {
  campaign: Campaign;
  feedback: Feedback[];
  onEnd: () => void;
  onOpenFeedback: (f: Feedback) => void;
}) {
  const [tenants, setTenants] = useState<TenantLite[] | null>(null);
  const [prompted, setPrompted] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busyTenant, setBusyTenant] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let promptedQuery = supabase
        .from('app_users')
        .select('tenant_id')
        .not('tenant_id', 'is', null)
        .gte('feedback_last_prompted_at', campaign.started_at);
      if (campaign.ended_at) promptedQuery = promptedQuery.lte('feedback_last_prompted_at', campaign.ended_at);
      const [ts, pu, ex] = await Promise.all([
        supabase.from('tenants').select('id,company_name,slug').eq('status', 'active').order('company_name'),
        promptedQuery,
        supabase.from('feedback_campaign_exclusions').select('tenant_id').eq('campaign_id', campaign.id),
      ]);
      if (cancelled) return;
      if (ts.error) toast.error(`Could not load companies: ${ts.error.message}`);
      setTenants((ts.data as TenantLite[] | null) ?? []);
      setPrompted(new Set(((pu.data as { tenant_id: string }[] | null) ?? []).map((r) => r.tenant_id)));
      setExcluded(new Set(((ex.data as { tenant_id: string }[] | null) ?? []).map((r) => r.tenant_id)));
    })();
    return () => {
      cancelled = true;
    };
  }, [campaign.id, campaign.started_at, campaign.ended_at]);

  const byTenant = useMemo(() => {
    const m = new Map<string, Feedback[]>();
    for (const f of feedback) m.set(f.tenant_id, [...(m.get(f.tenant_id) ?? []), f]);
    return m;
  }, [feedback]);
  const [filter, setFilter] = useState<'all' | 'answered' | 'skipped' | 'not_asked' | 'excluded'>('all');
  type Row = { id: string; name: string; state: 'answered' | 'skipped' | 'not_asked' | 'excluded'; feedback: Feedback[] };
  const rowsAll: Row[] = useMemo(() => {
    const answered: Row[] = [...byTenant.entries()].map(([id, list]) => ({ id, name: tenantLabel(list[0].tenants), state: 'answered', feedback: list }));
    const rest: Row[] = (tenants ?? [])
      .filter((t) => !byTenant.has(t.id))
      .map((t) => ({
        id: t.id,
        name: tenantLabel(t),
        state: excluded.has(t.id) ? 'excluded' : prompted.has(t.id) ? 'skipped' : 'not_asked',
        feedback: [],
      }));
    // Left-out companies sink to the bottom.
    return [...answered, ...rest.filter((r) => r.state !== 'excluded'), ...rest.filter((r) => r.state === 'excluded')];
  }, [byTenant, tenants, prompted, excluded]);
  const skippedCount = rowsAll.filter((r) => r.state === 'skipped').length;
  const notAskedCount = rowsAll.filter((r) => r.state === 'not_asked').length;
  const excludedCount = rowsAll.filter((r) => r.state === 'excluded').length;
  const isLive = !campaign.ended_at;

  const setTenantExcluded = async (tenantId: string, next: boolean) => {
    setBusyTenant(tenantId);
    const { error } = await supabase.rpc('feedback_campaign_set_excluded', { p_campaign: campaign.id, p_tenant: tenantId, p_excluded: next });
    setBusyTenant(null);
    if (error) {
      toast.error(`Could not save: ${error.message}`);
      return;
    }
    setExcluded((prev) => {
      const s = new Set(prev);
      if (next) s.add(tenantId);
      else s.delete(tenantId);
      return s;
    });
  };
  const shown = filter === 'all' ? rowsAll : rowsAll.filter((r) => r.state === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-xl font-semibold text-foreground">{campaign.name}</h2>
              <CampaignPill campaign={campaign} />
            </div>
            <p className="text-xs text-muted-foreground">
              {fmtDateTime(campaign.started_at)} – {campaign.ended_at ? fmtDateTime(campaign.ended_at) : 'now'}
            </p>
            <div className="mt-1.5">
              <AvgRating list={feedback} />
            </div>
          </div>
        </div>
        {!campaign.ended_at && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full bg-destructive/10 px-3.5 text-[13px] font-medium text-destructive hover:bg-destructive/15 hover:text-destructive"
            onClick={onEnd}
          >
            End campaign
          </Button>
        )}
      </div>

      {/* One list: a row per company, answered first, with a filter on top. */}
      <SegmentedControl
        size="sm"
        ariaLabel="Show companies"
        options={[
          { value: 'all', label: `All · ${rowsAll.length}` },
          { value: 'answered', label: `Answered · ${byTenant.size}` },
          { value: 'skipped', label: `Skipped · ${skippedCount}` },
          { value: 'not_asked', label: `Not asked · ${notAskedCount}` },
          ...(excludedCount ? [{ value: 'excluded' as const, label: `Left out · ${excludedCount}` }] : []),
        ]}
        value={filter}
        onChange={setFilter}
      />
      {tenants === null ? (
        <div className="h-60 animate-pulse rounded-3xl border border-border bg-muted/40" />
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Nobody here.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card">
          {shown.map((r) => (
            <li key={r.id} className="group flex items-start gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-sm font-medium', r.state === 'excluded' ? 'text-muted-foreground' : 'text-foreground')}>{r.name}</p>
                {r.feedback.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onOpenFeedback(f)}
                    className="mt-1 block w-full text-left text-[13px] leading-5 text-muted-foreground hover:text-foreground"
                  >
                    {f.rating !== null && (
                      <span className="mb-0.5 block">
                        <Stars value={f.rating} />
                      </span>
                    )}
                    <span className="line-clamp-2">&ldquo;{f.message}&rdquo;</span>
                    <span className="text-xs">
                      {[f.submitter_name, fmtDateTime(f.created_at)].filter(Boolean).join(' · ')}
                      {f.status === 'resolved' && ' · Resolved'}
                    </span>
                  </button>
                ))}
              </div>
              {isLive && (r.state === 'not_asked' || r.state === 'excluded') && (
                <button
                  type="button"
                  disabled={busyTenant === r.id}
                  onClick={() => void setTenantExcluded(r.id, r.state !== 'excluded')}
                  className="mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                >
                  {r.state === 'excluded' ? 'Ask them' : 'Leave out'}
                </button>
              )}
              <span
                className={cn(
                  'mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                  r.state === 'answered'
                    ? 'bg-success/10 text-success'
                    : r.state === 'skipped'
                      ? 'bg-warning/10 text-warning'
                      : r.state === 'excluded'
                        ? 'border border-dashed border-border text-muted-foreground'
                        : 'bg-secondary text-muted-foreground',
                )}
              >
                {r.state === 'answered' ? 'Answered' : r.state === 'skipped' ? 'Saw it, skipped' : r.state === 'excluded' ? 'Left out' : 'Not asked yet'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedbackDetail({
  item,
  campaign,
  onClose,
  onToggle,
}: {
  item: Feedback | null;
  campaign?: Campaign;
  onClose: () => void;
  onToggle: (f: Feedback) => void;
}) {
  const [shot, setShot] = useState<string | null>(null);
  useEffect(() => {
    setShot(null);
    if (!item?.screenshot_path) return;
    let cancelled = false;
    // Private bucket: a screenshot can hold customer details, so only a short-lived signed link.
    void supabase.storage
      .from('feedback-screenshots')
      .createSignedUrl(item.screenshot_path, 300)
      .then(({ data }) => {
        if (!cancelled) setShot(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [item?.id, item?.screenshot_path]);

  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[620px] gap-4 rounded-3xl p-6">
        {item && (
          <>
            <DialogHeader className="text-left">
              <DialogTitle>{tenantLabel(item.tenants)}</DialogTitle>
              <DialogDescription>
                {[item.submitter_name, item.submitter_role, item.submitter_email].filter(Boolean).join(' · ') || 'Unknown person'}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <CategoryChip category={item.category} />
            {item.rating !== null && <Stars value={item.rating} />}
              <span>{fmtDateTime(item.created_at)}</span>
              {campaign && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{campaign.name}</span>}
              {item.page_path && <span className="font-mono">{item.page_path}</span>}
            </div>
            <p className="whitespace-pre-wrap rounded-2xl bg-muted/50 p-4 text-sm leading-relaxed text-foreground">{item.message}</p>
            {item.screenshot_path &&
              (shot ? (
                <a href={shot} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-2xl border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={shot} alt="Screenshot sent with the feedback" className="max-h-[360px] w-full object-contain" />
                </a>
              ) : (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Loading screenshot…
                </p>
              ))}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" className="rounded-full" onClick={onClose}>
                Close
              </Button>
              <Button className="rounded-full" variant={item.status === 'resolved' ? 'outline' : 'default'} onClick={() => onToggle(item)}>
                {item.status === 'resolved' ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
                {item.status === 'resolved' ? 'Reopen' : 'Mark resolved'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewCampaignDialog({
  open,
  live,
  onClose,
  onStart,
}: {
  open: boolean;
  live: Campaign | null;
  onClose: () => void;
  onStart: (name: string, excluded: string[]) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [tenants, setTenants] = useState<TenantLite[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setExcluded(new Set());
    setSearch('');
    void supabase
      .from('tenants')
      .select('id,company_name,slug')
      .eq('status', 'active')
      .order('company_name')
      .then(({ data }) => setTenants((data as TenantLite[] | null) ?? []));
  }, [open]);

  const all = tenants ?? [];
  const q = search.trim().toLowerCase();
  const visible = q ? all.filter((t) => tenantLabel(t).toLowerCase().includes(q)) : all;
  const askedCount = all.length - excluded.size;
  const toggle = (id: string) =>
    setExcluded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[540px] gap-5 rounded-3xl p-6">
        <DialogHeader className="text-left">
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>Each company you keep ticked is shown the feedback form once, on their next sign-in.</DialogDescription>
        </DialogHeader>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">Name</span>
          <Input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. October check-in" className="rounded-full" />
        </label>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-foreground">Who is asked</span>
            <span className="text-xs text-muted-foreground">
              {tenants === null ? 'Loading…' : excluded.size === 0 ? `Everyone · ${all.length}` : `${askedCount} of ${all.length}`}
            </span>
          </div>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search companies" className="h-9 rounded-full" />
          <ul className="max-h-[240px] divide-y divide-border overflow-y-auto rounded-2xl border border-border [scrollbar-width:thin]">
            {tenants === null ? (
              <li className="h-40 animate-pulse bg-muted/40" />
            ) : visible.length === 0 ? (
              <li className="px-4 py-6 text-center text-xs text-muted-foreground">No company matches.</li>
            ) : (
              visible.map((t) => {
                const asked = !excluded.has(t.id);
                return (
                  <li key={t.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
                      <Checkbox checked={asked} onCheckedChange={() => toggle(t.id)} aria-label={tenantLabel(t)} />
                      <span className={cn('min-w-0 flex-1 truncate text-sm', asked ? 'text-foreground' : 'text-muted-foreground line-through')}>{tenantLabel(t)}</span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>
        </div>
        {live && (
          <p className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-snug text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <span className="font-semibold">Starting this ends &ldquo;{live.name}&rdquo;.</span> Only one campaign runs at a time.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="rounded-full" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="rounded-full"
            disabled={busy || !name.trim() || tenants === null || askedCount === 0}
            onClick={async () => {
              setBusy(true);
              const ok = await onStart(name, [...excluded]);
              setBusy(false);
              if (ok) onClose();
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Start campaign
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

