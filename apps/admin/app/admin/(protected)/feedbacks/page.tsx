'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/components/ui/sonner';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ForceLogoutAllControl } from '@/components/admin/ForceLogoutAllControl';
import {
  MessageSquareText,
  Bug,
  Wrench,
  Sparkles,
  StickyNote,
  Settings2,
  RefreshCw,
  Send,
  Check,
  RotateCcw,
  X,
  ImageIcon,
  Loader2,
  Megaphone,
} from 'lucide-react';

const PAGE_SIZE = 50;

type Category = 'bug' | 'improvement' | 'feature_request' | 'note';

const CATEGORY_META: Record<Category, { label: string; icon: React.ElementType; color: string }> = {
  bug: { label: 'Bug', icon: Bug, color: '#dc2626' },
  improvement: { label: 'Improvement', icon: Wrench, color: '#d97706' },
  feature_request: { label: 'Feature Request', icon: Sparkles, color: '#6366f1' },
  note: { label: 'Note', icon: StickyNote, color: '#737373' },
};

interface Feedback {
  id: string;
  tenant_id: string;
  app_user_id: string | null;
  submitter_name: string | null;
  submitter_email: string | null;
  submitter_role: string | null;
  category: Category;
  message: string;
  screenshot_path: string | null;
  page_path: string | null;
  user_agent: string | null;
  status: 'open' | 'resolved';
  resolved_at: string | null;
  created_at: string;
  // `company_name`, NOT `name` — the tenants table has no bare `name` column,
  // and asking PostgREST for one fails the entire query, not just the field.
  tenants?: { company_name: string | null; slug: string | null } | null;
}

interface Insight {
  id: string;
  summary: string;
  top_themes: { theme: string; count: number }[];
  feedback_count: number;
  generated_at: string;
}

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
}

export default function FeedbacksPage() {
  const { user } = useAuthStore();

  const [items, setItems] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [tenantFilter, setTenantFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');

  const [tenants, setTenants] = useState<{ id: string; company_name: string | null; slug: string | null }[]>([]);

  // Detail
  const [detail, setDetail] = useState<Feedback | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

  // Insights
  const [insight, setInsight] = useState<Insight | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Settings panel
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [formEnabled, setFormEnabled] = useState(true);
  const [settingsRowId, setSettingsRowId] = useState<string | null>(null);
  const [forceTriggeredAt, setForceTriggeredAt] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<{ id: string; email: string }[]>([]);
  const [newRecipient, setNewRecipient] = useState('');
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [forcing, setForcing] = useState(false);

  // ── Loading ───────────────────────────────────────────────────────────────
  const loadFeedback = useCallback(async () => {
    setLoading(true);
    try {
      let query = (supabase as any)
        .from('tenant_feedback')
        .select('*, tenants(company_name, slug)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (categoryFilter !== 'all') query = query.eq('category', categoryFilter);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (tenantFilter !== 'all') query = query.eq('tenant_id', tenantFilter);
      if (fromDate) query = query.gte('created_at', new Date(fromDate).toISOString());
      // Inclusive of the whole end day, not midnight at its start — otherwise a
      // single-day range silently returns nothing.
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        query = query.lte('created_at', end.toISOString());
      }
      if (search.trim()) query = query.ilike('message', `%${search.trim()}%`);

      const { data, error, count } = await query;
      if (error) throw error;
      setItems((data || []) as Feedback[]);
      setTotalCount(count ?? 0);
    } catch (err: any) {
      toast.error(`Failed to load feedback: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [page, categoryFilter, statusFilter, tenantFilter, fromDate, toDate, search]);

  useEffect(() => {
    loadFeedback();
  }, [loadFeedback]);

  // Any filter change starts a new result set — staying on page 4 of the old
  // one shows an empty table that reads as "no feedback".
  useEffect(() => {
    setPage(0);
  }, [categoryFilter, statusFilter, tenantFilter, fromDate, toDate, search]);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('tenants')
        .select('id, company_name, slug')
        .order('company_name');
      setTenants(data || []);

      const { data: insightRow } = await (supabase as any)
        .from('tenant_feedback_insights')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (insightRow) setInsight(insightRow as Insight);

      await loadSettings();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSettings = async () => {
    const { data: settings } = await (supabase as any)
      .from('tenant_feedback_settings')
      .select('id, form_enabled, force_login_triggered_at')
      .limit(1)
      .maybeSingle();
    if (settings) {
      setSettingsRowId(settings.id);
      setFormEnabled(settings.form_enabled);
      setForceTriggeredAt(settings.force_login_triggered_at);
    }

    const { data: recips } = await (supabase as any)
      .from('tenant_feedback_recipients')
      .select('id, email')
      .order('created_at');
    setRecipients(recips || []);
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  // Computed server-side rather than over the current page — a count taken from
  // 50 visible rows would be wrong the moment there are 51.
  const [stats, setStats] = useState({ open: 0, week: 0, topCategory: '—' });

  const loadStats = useCallback(async () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { count: openCount } = await (supabase as any)
      .from('tenant_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open');

    const { data: weekRows } = await (supabase as any)
      .from('tenant_feedback')
      .select('category')
      .gte('created_at', weekAgo);

    const tally: Record<string, number> = {};
    (weekRows || []).forEach((r: { category: Category }) => {
      tally[r.category] = (tally[r.category] || 0) + 1;
    });
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];

    setStats({
      open: openCount ?? 0,
      week: weekRows?.length ?? 0,
      topCategory: top ? `${CATEGORY_META[top[0] as Category]?.label ?? top[0]} (${top[1]})` : '—',
    });
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const toggleStatus = async (item: Feedback) => {
    const nextStatus = item.status === 'open' ? 'resolved' : 'open';
    try {
      const { error } = await (supabase as any)
        .from('tenant_feedback')
        .update({
          status: nextStatus,
          resolved_at: nextStatus === 'resolved' ? new Date().toISOString() : null,
          resolved_by: nextStatus === 'resolved' ? user?.id ?? null : null,
        })
        .eq('id', item.id);
      if (error) throw error;

      toast.success(nextStatus === 'resolved' ? 'Marked resolved' : 'Reopened');
      setDetail((d) => (d && d.id === item.id ? { ...d, status: nextStatus } : d));
      await Promise.all([loadFeedback(), loadStats()]);
    } catch (err: any) {
      toast.error(`Failed to update: ${err.message}`);
    }
  };

  const openDetail = async (item: Feedback) => {
    setDetail(item);
    setScreenshotUrl(null);
    if (item.screenshot_path) {
      // Private bucket — a screenshot routinely contains customer PII, so it is
      // reachable only through a short-lived signed URL, never a public link.
      const { data, error } = await supabase.storage
        .from('feedback-screenshots')
        .createSignedUrl(item.screenshot_path, 300);
      if (error) {
        console.error('Failed to sign screenshot URL:', error);
      } else {
        setScreenshotUrl(data?.signedUrl ?? null);
      }
    }
  };

  const regenerateInsights = async () => {
    setRegenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('feedback-insights', {
        body: { action: 'summarize' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.empty) {
        toast.info(data.message || 'No feedback to summarise yet');
        return;
      }
      setInsight(data.insight as Insight);
      toast.success('Insights regenerated');
    } catch (err: any) {
      toast.error(`Failed to regenerate: ${err.message}`);
    } finally {
      setRegenerating(false);
    }
  };

  const sendChat = async () => {
    const question = chatInput.trim();
    if (!question || chatSending) return;

    const nextChat: ChatEntry[] = [...chat, { role: 'user', content: question }];
    setChat(nextChat);
    setChatInput('');
    setChatSending(true);

    try {
      const { data, error } = await supabase.functions.invoke('feedback-insights', {
        body: { action: 'chat', messages: nextChat },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setChat([...nextChat, { role: 'assistant', content: data.reply || '' }]);
    } catch (err: any) {
      // Keep the question on screen and report the failure inline — silently
      // dropping it looks like the assistant ignored them.
      setChat([
        ...nextChat,
        { role: 'assistant', content: `Sorry — that failed: ${err.message}` },
      ]);
    } finally {
      setChatSending(false);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, chatSending]);

  const saveFormEnabled = async (next: boolean) => {
    if (!settingsRowId) return;
    setFormEnabled(next);
    const { error } = await (supabase as any)
      .from('tenant_feedback_settings')
      .update({ form_enabled: next })
      .eq('id', settingsRowId);
    if (error) {
      setFormEnabled(!next);
      toast.error(`Failed to save: ${error.message}`);
    } else {
      toast.success(next ? 'Feedback form enabled' : 'Feedback form hidden from portals');
    }
  };

  const addRecipient = async () => {
    const email = newRecipient.trim().toLowerCase();
    if (!email) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.error('Enter a valid email address');
      return;
    }
    if (recipients.some((r) => r.email.toLowerCase() === email)) {
      toast.error('That address is already on the list');
      return;
    }
    const { data, error } = await (supabase as any)
      .from('tenant_feedback_recipients')
      .insert({ email })
      .select()
      .single();
    if (error) {
      toast.error(`Failed to add: ${error.message}`);
      return;
    }
    setRecipients((r) => [...r, data]);
    setNewRecipient('');
  };

  const removeRecipient = async (id: string) => {
    const { error } = await (supabase as any)
      .from('tenant_feedback_recipients')
      .delete()
      .eq('id', id);
    if (error) {
      toast.error(`Failed to remove: ${error.message}`);
      return;
    }
    setRecipients((r) => r.filter((x) => x.id !== id));
  };

  const triggerForceShow = async () => {
    if (!settingsRowId) return;
    setForcing(true);
    try {
      const now = new Date().toISOString();
      const { error } = await (supabase as any)
        .from('tenant_feedback_settings')
        .update({ force_login_triggered_at: now })
        .eq('id', settingsRowId);
      if (error) throw error;
      setForceTriggeredAt(now);
      setShowForceConfirm(false);
      toast.success('Every operator will be asked for feedback on their next visit');
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setForcing(false);
    }
  };

  const clearForceShow = async () => {
    if (!settingsRowId) return;
    const { error } = await (supabase as any)
      .from('tenant_feedback_settings')
      .update({ force_login_triggered_at: null })
      .eq('id', settingsRowId);
    if (error) {
      toast.error(`Failed: ${error.message}`);
      return;
    }
    setForceTriggeredAt(null);
    toast.success('Campaign cleared — no one else will be prompted');
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const tenantName = (f: Feedback) => f.tenants?.company_name || f.tenants?.slug || '—';

  const themes = useMemo(
    () => (Array.isArray(insight?.top_themes) ? insight!.top_themes : []),
    [insight]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            <MessageSquareText className="h-6 w-6 text-primary" />
            Feedbacks
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            What rental operators are telling us about the software.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
          <Settings2 className="h-4 w-4 mr-2" />
          Settings
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Open', value: stats.open },
          { label: 'This week', value: stats.week },
          { label: 'Top category this week', value: stats.topCategory },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-dark-border bg-dark-card p-4">
            <p className="text-xs uppercase tracking-wide text-gray-400">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* AI Insights */}
      <div className="rounded-lg border border-dark-border bg-dark-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Insights
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {insight
                ? `Generated ${new Date(insight.generated_at).toLocaleString()} from ${insight.feedback_count} items`
                : 'Not generated yet'}
            </p>
          </div>
          <Button size="sm" onClick={regenerateInsights} disabled={regenerating}>
            {regenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {regenerating ? 'Analysing...' : 'Regenerate'}
          </Button>
        </div>

        {insight ? (
          <>
            <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
              {insight.summary}
            </p>
            {themes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {themes.map((t, i) => (
                  <span
                    key={`${t.theme}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dark-border bg-secondary px-2.5 py-1 text-xs text-gray-300"
                  >
                    {t.theme}
                    <span className="text-primary font-semibold">{t.count}</span>
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-400">
            Hit Regenerate to summarise the last 90 days of feedback.
          </p>
        )}

        {/* Ad-hoc chat over the corpus. Held in component state only — never
            written to a table. */}
        <div className="rounded-md border border-dark-border bg-secondary/40 p-3 space-y-3">
          <p className="text-xs font-medium text-gray-400">Ask about the feedback</p>

          {chat.length > 0 && (
            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {chat.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === 'user'
                      ? 'ml-auto max-w-[85%] rounded-lg bg-primary/15 px-3 py-2 text-sm text-white'
                      : 'mr-auto max-w-[85%] rounded-lg bg-dark-card px-3 py-2 text-sm text-gray-300 whitespace-pre-wrap'
                  }
                >
                  {m.content}
                </div>
              ))}
              {chatSending && (
                <div className="mr-auto rounded-lg bg-dark-card px-3 py-2 text-sm text-gray-400 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Thinking...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          <div className="flex gap-2">
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              placeholder="e.g. which tenants are complaining about invoicing?"
              disabled={chatSending}
            />
            <Button size="sm" onClick={sendChat} disabled={chatSending || !chatInput.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="w-44">
          <Label className="text-xs text-gray-400 mb-1 block">Category</Label>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {(Object.keys(CATEGORY_META) as Category[]).map((c) => (
                <SelectItem key={c} value={c}>{CATEGORY_META[c].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Label className="text-xs text-gray-400 mb-1 block">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-52">
          <Label className="text-xs text-gray-400 mb-1 block">Tenant</Label>
          <Select value={tenantFilter} onValueChange={setTenantFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tenants</SelectItem>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.company_name || t.slug}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label className="text-xs text-gray-400 mb-1 block">From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="w-40">
          <Label className="text-xs text-gray-400 mb-1 block">To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs text-gray-400 mb-1 block">Search</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search message text..."
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-dark-border bg-dark-card overflow-hidden">
        {loading ? (
          <TableSkeleton />
        ) : items.length === 0 ? (
          <div className="p-10 text-center">
            <MessageSquareText className="h-8 w-8 text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No feedback matches these filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3 font-medium">Tenant</th>
                  <th className="px-4 py-3 font-medium">Submitter</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((f) => {
                  const meta = CATEGORY_META[f.category] || CATEGORY_META.note;
                  const Icon = meta.icon;
                  return (
                    <tr
                      key={f.id}
                      onClick={() => openDetail(f)}
                      className="border-b border-dark-border last:border-0 cursor-pointer hover:bg-secondary/40 transition-colors"
                    >
                      <td className="px-4 py-3 text-white">{tenantName(f)}</td>
                      <td className="px-4 py-3 text-gray-300">
                        <div>{f.submitter_name || f.submitter_email || 'Unknown'}</div>
                        {f.submitter_role && (
                          <div className="text-xs text-gray-500">{f.submitter_role}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex items-center gap-1.5 text-xs font-medium"
                          style={{ color: meta.color }}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300 max-w-[320px]">
                        <div className="flex items-center gap-2">
                          {f.screenshot_path && (
                            <ImageIcon className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                          )}
                          <span className="truncate">{f.message}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            f.status === 'open'
                              ? 'text-xs font-medium text-amber-400'
                              : 'text-xs font-medium text-green-400'
                          }
                        >
                          {f.status === 'open' ? 'Open' : 'Resolved'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {new Date(f.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleStatus(f);
                          }}
                        >
                          {f.status === 'open' ? (
                            <><Check className="h-3.5 w-3.5 mr-1.5" />Resolve</>
                          ) : (
                            <><RotateCcw className="h-3.5 w-3.5 mr-1.5" />Reopen</>
                          )}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {(() => {
                    const meta = CATEGORY_META[detail.category] || CATEGORY_META.note;
                    const Icon = meta.icon;
                    return (
                      <>
                        <Icon className="h-4 w-4" style={{ color: meta.color }} />
                        <span style={{ color: meta.color }}>{meta.label}</span>
                      </>
                    );
                  })()}
                </DialogTitle>
                <DialogDescription>
                  {tenantName(detail)} · {detail.submitter_name || detail.submitter_email || 'Unknown'}
                  {detail.submitter_role ? ` (${detail.submitter_role})` : ''} ·{' '}
                  {new Date(detail.created_at).toLocaleString()}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="rounded-md border border-dark-border bg-secondary/40 p-3 text-sm text-gray-200 whitespace-pre-wrap">
                  {detail.message}
                </div>

                {detail.page_path && (
                  <div className="text-xs text-gray-400">
                    <span className="text-gray-500">Page: </span>
                    {detail.page_path}
                  </div>
                )}
                {detail.user_agent && (
                  <div className="text-xs text-gray-400 break-all">
                    <span className="text-gray-500">Browser: </span>
                    {detail.user_agent}
                  </div>
                )}

                {detail.screenshot_path && (
                  <div>
                    <p className="text-xs text-gray-500 mb-2">Screenshot</p>
                    {screenshotUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={screenshotUrl}
                        alt="Feedback screenshot"
                        className="max-h-80 rounded-md border border-dark-border"
                      />
                    ) : (
                      <p className="text-xs text-gray-500">Loading screenshot…</p>
                    )}
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDetail(null)}>
                  Close
                </Button>
                <Button onClick={() => toggleStatus(detail)}>
                  {detail.status === 'open' ? 'Mark Resolved' : 'Reopen'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Feedback settings</DialogTitle>
            <DialogDescription>
              Platform-wide — these apply to every tenant portal.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm">Feedback form enabled</Label>
                <p className="text-xs text-gray-400 mt-0.5">
                  Turning this off removes the entry point from every portal and stops
                  both automatic prompts.
                </p>
              </div>
              <Switch checked={formEnabled} onCheckedChange={saveFormEnabled} />
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Email alerts</Label>
              <p className="text-xs text-gray-400">
                Every submission is emailed to these addresses.
              </p>
              <div className="flex flex-wrap gap-2">
                {recipients.length === 0 && (
                  <span className="text-xs text-gray-500">
                    No recipients — submissions are stored but nobody is emailed.
                  </span>
                )}
                {recipients.map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dark-border bg-secondary px-2.5 py-1 text-xs text-gray-300"
                  >
                    {r.email}
                    <button
                      onClick={() => removeRecipient(r.id)}
                      aria-label={`Remove ${r.email}`}
                      className="text-gray-500 hover:text-red-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newRecipient}
                  onChange={(e) => setNewRecipient(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addRecipient();
                    }
                  }}
                  placeholder="name@drive-247.com"
                />
                <Button size="sm" onClick={addRecipient}>Add</Button>
              </div>
            </div>

            <div className="space-y-2 border-t border-dark-border pt-4">
              <Label className="text-sm">Ask everyone for feedback</Label>
              <p className="text-xs text-gray-400">
                Prompts every operator across every tenant once, the next time they open
                their portal. Anyone already prompted since the campaign started is
                skipped.
              </p>
              {forceTriggeredAt && (
                <p className="text-xs text-amber-400">
                  Campaign active since {new Date(forceTriggeredAt).toLocaleString()}.
                </p>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setShowForceConfirm(true)}>
                  <Megaphone className="h-4 w-4 mr-2" />
                  {forceTriggeredAt ? 'Restart campaign' : 'Force show on next login'}
                </Button>
                {forceTriggeredAt && (
                  <Button variant="outline" size="sm" onClick={clearForceShow}>
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2 border-t border-dark-border pt-4">
              <Label className="text-sm">Sessions</Label>
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-gray-400">
                  Sign out every portal operator and booking customer on the platform.
                </p>
                <ForceLogoutAllControl className="whitespace-nowrap" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force-show confirmation */}
      <Dialog open={showForceConfirm} onOpenChange={setShowForceConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask every operator for feedback?</DialogTitle>
            <DialogDescription>
              The next time each operator opens their portal, the feedback dialog opens
              once. It is dismissible and does not block them from working. You can clear
              the campaign at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForceConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={triggerForceShow} disabled={forcing}>
              {forcing ? 'Starting...' : 'Start campaign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
