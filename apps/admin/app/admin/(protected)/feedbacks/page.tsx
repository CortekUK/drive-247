'use client';

/**
 * Feedback (Ghulam, Oct 19 2026: "just a simple list, no AI and stats; I should
 * be able to run campaigns, each one separate with its feedback, and see which
 * tenants answered and which didn't").
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
import { ArrowLeft, Check, ImageIcon, Loader2, Megaphone, Plus, RotateCcw, Settings2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HEADER_ACTIONS, HEADER_PRIMARY, HeaderIconButton } from '@/components/admin/header-buttons';
import { EmptyState } from '@/components/admin/empty-state';
import { FeedbackEmptyArt } from '@/components/admin/illustrations/scenes/admin-scenes';
import { CATEGORY_META, type Category } from '@/components/admin/feedback-category';
import { ForceLogoutAllControl } from '@/components/admin/ForceLogoutAllControl';
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
  'id,tenant_id,submitter_name,submitter_email,submitter_role,category,message,screenshot_path,page_path,status,source,campaign_id,created_at,tenants(company_name,slug)';

const VIEW_OPTIONS = [
  { value: 'feedback', label: 'All feedback' },
  { value: 'campaigns', label: 'Campaigns' },
] as const;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const tenantLabel = (t: { company_name: string | null; slug: string | null } | null | undefined) => t?.company_name || t?.slug || 'Unknown company';

export default function FeedbacksPage() {
  const { user } = useAuthStore();
  const [view, setView] = useState<'feedback' | 'campaigns'>('feedback');
  const [items, setItems] = useState<Feedback[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Feedback | null>(null);
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const startCampaign = async (name: string) => {
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
    const promptError = await setPrompt(now);
    if (promptError) toast.error(`Campaign saved, but the portal prompt did not switch on: ${promptError.message}`);
    else toast.success('Campaign started. Every operator is asked on their next sign-in.');
    await load();
    setView('campaigns');
    setOpenCampaignId((data as Campaign).id);
    return true;
  };

  const endCampaign = async (c: Campaign) => {
    if (!window.confirm(`End "${c.name}"?\n\nOperators who have not been asked yet will not be asked.`)) return;
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Feedback</h1>
          <p className="text-sm text-muted-foreground">What operators tell us, from the portal and from campaigns.</p>
        </div>
        <div className={HEADER_ACTIONS}>
          <HeaderIconButton label="Feedback settings" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-4 w-4" />
          </HeaderIconButton>
          <Button className={HEADER_PRIMARY} onClick={() => setCreating(true)} disabled={loading}>
            <Plus className="h-4 w-4" />
            New campaign
          </Button>
        </div>
      </div>

      {!openCampaign && (
        <SegmentedControl
          ariaLabel="Feedback view"
          options={VIEW_OPTIONS}
          value={view}
          onChange={(v) => setView(v)}
        />
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-2xl border border-border bg-muted/40" />
          ))}
        </div>
      ) : openCampaign ? (
        <CampaignView
          campaign={openCampaign}
          feedback={items.filter((f) => f.campaign_id === openCampaign.id)}
          onBack={() => setOpenCampaignId(null)}
          onEnd={() => void endCampaign(openCampaign)}
          onOpenFeedback={setDetail}
        />
      ) : view === 'feedback' ? (
        items.length === 0 ? (
          <EmptyState illustration={<FeedbackEmptyArt />} headline="No feedback yet" body="Replies from the portal's feedback form show up here." />
        ) : (
          <ul className="space-y-2">
            {items.map((f) => (
              <FeedbackRow key={f.id} item={f} campaign={f.campaign_id ? campaignById.get(f.campaign_id) : undefined} onOpen={() => setDetail(f)} />
            ))}
          </ul>
        )
      ) : campaigns.length === 0 ? (
        <EmptyState
          illustration={<FeedbackEmptyArt />}
          headline="No campaigns yet"
          body="A campaign asks every operator for feedback once, on their next sign-in."
          action={{ label: 'New campaign', icon: Plus, onClick: () => setCreating(true) }}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => {
            const replies = items.filter((f) => f.campaign_id === c.id);
            const companies = new Set(replies.map((f) => f.tenant_id)).size;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setOpenCampaignId(c.id)}
                  className="flex w-full flex-col gap-3 rounded-3xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Megaphone className="size-5" aria-hidden />
                    </span>
                    <CampaignPill campaign={c} />
                  </span>
                  <span className="space-y-1">
                    <span className="block text-base font-semibold text-foreground">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {fmtDate(c.started_at)} – {c.ended_at ? fmtDate(c.ended_at) : 'now'}
                    </span>
                  </span>
                  <span className="text-sm text-foreground">
                    {replies.length} {replies.length === 1 ? 'reply' : 'replies'} from {companies} {companies === 1 ? 'company' : 'companies'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <FeedbackDetail item={detail} campaign={detail?.campaign_id ? campaignById.get(detail.campaign_id) : undefined} onClose={() => setDetail(null)} onToggle={toggleStatus} />
      <NewCampaignDialog open={creating} live={live} onClose={() => setCreating(false)} onStart={startCampaign} />
      <SettingsDialog open={settingsOpen} rowId={settingsRowId} onClose={() => setSettingsOpen(false)} />
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
  onBack,
  onEnd,
  onOpenFeedback,
}: {
  campaign: Campaign;
  feedback: Feedback[];
  onBack: () => void;
  onEnd: () => void;
  onOpenFeedback: (f: Feedback) => void;
}) {
  const [tenants, setTenants] = useState<TenantLite[] | null>(null);
  const [prompted, setPrompted] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let promptedQuery = supabase
        .from('app_users')
        .select('tenant_id')
        .not('tenant_id', 'is', null)
        .gte('feedback_last_prompted_at', campaign.started_at);
      if (campaign.ended_at) promptedQuery = promptedQuery.lte('feedback_last_prompted_at', campaign.ended_at);
      const [ts, pu] = await Promise.all([
        supabase.from('tenants').select('id,company_name,slug').eq('status', 'active').order('company_name'),
        promptedQuery,
      ]);
      if (cancelled) return;
      if (ts.error) toast.error(`Could not load companies: ${ts.error.message}`);
      setTenants((ts.data as TenantLite[] | null) ?? []);
      setPrompted(new Set(((pu.data as { tenant_id: string }[] | null) ?? []).map((r) => r.tenant_id)));
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
  const notYet = (tenants ?? []).filter((t) => !byTenant.has(t.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to campaigns"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-xl font-semibold text-foreground">{campaign.name}</h2>
              <CampaignPill campaign={campaign} />
            </div>
            <p className="text-xs text-muted-foreground">
              {fmtDateTime(campaign.started_at)} – {campaign.ended_at ? fmtDateTime(campaign.ended_at) : 'now'}
            </p>
          </div>
        </div>
        {!campaign.ended_at && (
          <Button variant="outline" className="rounded-full" onClick={onEnd}>
            End campaign
          </Button>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Answered <span className="font-normal text-muted-foreground">· {byTenant.size} {byTenant.size === 1 ? 'company' : 'companies'}</span>
          </h3>
          {byTenant.size === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No replies yet.</p>
          ) : (
            [...byTenant.entries()].map(([tenantId, list]) => (
              <div key={tenantId} className="space-y-2 rounded-3xl border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">{tenantLabel(list[0].tenants)}</p>
                <ul className="space-y-2">
                  {list.map((f) => (
                    <FeedbackRow key={f.id} item={f} hideCompany onOpen={() => onOpenFeedback(f)} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Not answered <span className="font-normal text-muted-foreground">· {tenants ? notYet.length : '…'}</span>
          </h3>
          {tenants === null ? (
            <div className="h-40 animate-pulse rounded-3xl border border-border bg-muted/40" />
          ) : notYet.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Every company has answered.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card">
              {notYet.map((t) => {
                const saw = prompted.has(t.id);
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 truncate text-sm text-foreground">{tenantLabel(t)}</span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                        saw ? 'bg-warning/10 text-warning' : 'bg-secondary text-muted-foreground',
                      )}
                    >
                      {saw ? 'Saw it, skipped' : 'Not asked yet'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
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
  onStart: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setName('');
        else onClose();
      }}
    >
      <DialogContent className="max-w-[500px] gap-5 rounded-3xl p-6">
        <DialogHeader className="text-left">
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>Every operator is shown the feedback form once, on their next sign-in.</DialogDescription>
        </DialogHeader>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">Name</span>
          <Input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. October check-in" className="rounded-full" />
        </label>
        {live && (
          <p className="rounded-2xl bg-warning/10 px-3 py-2 text-xs text-warning">
            Starting this ends &ldquo;{live.name}&rdquo;. Only one campaign runs at a time.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="rounded-full" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="rounded-full"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              const ok = await onStart(name);
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

/** The form switch, who gets emailed about new feedback, and the platform sign-out. */
function SettingsDialog({ open, rowId, onClose }: { open: boolean; rowId: string | null; onClose: () => void }) {
  const [formEnabled, setFormEnabled] = useState(true);
  const [recipients, setRecipients] = useState<{ id: string; email: string }[]>([]);
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [st, rc] = await Promise.all([
        supabase.from('tenant_feedback_settings').select('form_enabled').limit(1).maybeSingle(),
        supabase.from('tenant_feedback_recipients').select('id,email').order('created_at'),
      ]);
      setFormEnabled((st.data as { form_enabled: boolean } | null)?.form_enabled ?? true);
      setRecipients((rc.data as { id: string; email: string }[] | null) ?? []);
    })();
  }, [open]);

  const saveForm = async (next: boolean) => {
    if (!rowId) return;
    setFormEnabled(next);
    const { error } = await supabase.from('tenant_feedback_settings').update({ form_enabled: next }).eq('id', rowId);
    if (error) {
      setFormEnabled(!next);
      toast.error(`Could not save: ${error.message}`);
    }
  };

  const add = async () => {
    const value = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      toast.error('Enter a valid email address');
      return;
    }
    if (recipients.some((r) => r.email.toLowerCase() === value)) {
      toast.error('That address is already on the list');
      return;
    }
    const { data, error } = await supabase.from('tenant_feedback_recipients').insert({ email: value }).select('id,email').single();
    if (error || !data) {
      toast.error(`Could not add: ${error?.message ?? 'no row came back'}`);
      return;
    }
    setRecipients((r) => [...r, data as { id: string; email: string }]);
    setEmail('');
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('tenant_feedback_recipients').delete().eq('id', id);
    if (error) {
      toast.error(`Could not remove: ${error.message}`);
      return;
    }
    setRecipients((r) => r.filter((x) => x.id !== id));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[520px] gap-5 rounded-3xl p-6">
        <DialogHeader className="text-left">
          <DialogTitle>Feedback settings</DialogTitle>
          <DialogDescription>The portal&apos;s feedback form and who hears about new feedback.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Feedback form in the portal</p>
            <p className="text-xs text-muted-foreground">Off hides the button from every operator.</p>
          </div>
          <Switch checked={formEnabled} onCheckedChange={(v) => void saveForm(v)} aria-label="Feedback form in the portal" />
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-sm font-medium text-foreground">Email new feedback to</p>
          <ul className="flex flex-wrap gap-1.5">
            {recipients.map((r) => (
              <li key={r.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">
                {r.email}
                <button type="button" onClick={() => void remove(r.id)} aria-label={`Remove ${r.email}`} className="text-muted-foreground hover:text-destructive">
                  <X className="size-3" />
                </button>
              </li>
            ))}
            {recipients.length === 0 && <li className="text-xs text-muted-foreground">Nobody yet.</li>}
          </ul>
          <div className="flex gap-2">
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
              placeholder="name@company.com"
              className="rounded-full"
            />
            <Button variant="outline" className="rounded-full" onClick={() => void add()}>
              Add
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <div>
            <p className="text-sm font-medium text-foreground">Sessions</p>
            <p className="text-xs text-muted-foreground">Sign out every portal operator and booking customer.</p>
          </div>
          <ForceLogoutAllControl className="whitespace-nowrap" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
