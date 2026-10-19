'use client';

/**
 * ⌘K for Super Admin — Northwind's search window
 * (apps/portal/src/components/shared/layout/global-search-v2.tsx), the same
 * frame: 900px wide, two columns on one accent wash, results on a lighter veil
 * on the left, a typed placeholder that says what can be found, rows that
 * light up in the sidebar's own highlight with a ↵ on the chosen one, and the
 * page behind blurred hard.
 *
 * Northwind's right-hand column is Trax. Super Admin has no Trax, so that
 * column is a BRIEF of whatever row is picked instead: for a rental company,
 * its plan, status and size, read live; for a page or a setting, what is
 * behind it. Before anything is picked it holds the search picture.
 *
 * It finds rental companies (by name, slug or email), every page of this app,
 * and every Settings page.
 *
 * Keys (not shown on screen): ↑ ↓ move · ↵ open · ⌘↵ new tab · ⌘L copy link · Esc close.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Building2, CornerDownLeft, ExternalLink, Loader2, Search, Settings } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { SIDEBAR_HIGHLIGHT_ACTIVE } from '@/components/ui/sidebar';
import { useAdminNav } from '@/components/admin/admin-nav';
import { useAuthStore } from '@/store/authStore';
import { ADMIN_SETTINGS_SECTIONS } from '@/components/admin/settings/settings-index';
import { SearchEmptyArt } from '@/components/admin/illustrations/scenes/admin-scenes';

type Kind = 'company' | 'page' | 'setting';

type Result = {
  key: string;
  kind: Kind;
  title: string;
  subtitle: string;
  href: string;
  icon?: ComponentType<{ className?: string }>;
  /** A page or setting: what is behind it. */
  description?: string;
  newTab?: boolean;
};

type Group = { key: string; title: string; items: Result[] };

type TenantHit = {
  id: string;
  company_name: string | null;
  slug: string | null;
  contact_email: string | null;
};

/** What each page of this app is for, for the brief. */
const PAGE_BRIEFS: Record<string, string> = {
  '/admin/dashboard': 'Subscription revenue, recurring revenue and the companies that need you today.',
  '/admin/rentals': 'Every rental company on Drive247: plan, status, owner, and each one’s record.',
  '/admin/announcements': 'Feature cards and system messages shown in operators’ portals.',
  '/admin/feedbacks': 'What operators tell us about the software, with AI insights across it.',
  '/admin/sales': 'Companies provisioned for signed clients, followed until they go live.',
  '/admin/promo-codes': 'Campaign codes, operator referral links, claims and the referral leaderboard.',
  '/admin/signup-plans': 'The plans a new operator chooses from at signup, and who gets a free trial.',
  '/admin/blacklist': 'Customers refused by every operator on the platform.',
  '/admin/contacts': 'Messages sent from the contact form on drive-247.com.',
  '/admin/integrations': 'Which integrations are premium, what they cost, and who subscribes.',
  '/admin/requests': 'Operators asking to move from test to live, waiting for approval.',
  '/admin/welcome-pack': 'The welcome pack every new operator sees in their portal.',
  '/admin/customer-management': 'Retention: the operator emails, health score, offers, NPS and rewards.',
  '/admin/openai-usage': 'What the platform spends on OpenAI, by feature and by tenant.',
  '/admin/notifications': 'Every email, SMS, push and in-app message the platform sends.',
  '/admin/audit-logs': 'Every meaningful action across every tenant: who, when and what.',
  '/admin/legal': 'The Terms of Service and Privacy Policy drive-247.com serves.',
  '/admin/onboarding-questions': 'The questions a new operator answers the first time they open the portal.',
  '/admin/setup-checklist': 'The features an operator sits down with once, on their dashboard.',
  '/admin/admins': 'Who can sign in to this dashboard, and their roles.',
  '/admin/settings': 'Platform settings: subscription access, website, signup, notifications, security.',
  '/admin/support': 'The platform support inbox, in its own workspace.',
};

/** What the placeholder types, one at a time, while the field is empty. */
const CAPABILITIES = [
  'a rental company by name',
  'a company by its slug',
  'an operator by their email',
  'a page, like Promo Codes',
  'a setting, like the payment grace period',
];

/** PostgREST `or` filters are comma-separated; a comma or bracket in the term would break the list. */
function sanitize(term: string) {
  return term.replace(/[,()*%]/g, ' ').trim();
}

export function AdminGlobalSearch({
  open,
  onOpenChange,
  initialQuery = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Search everywhere" from a page's field opens with its term. */
  initialQuery?: string;
}) {
  const router = useRouter();
  const nav = useAdminNav();
  const isPrimary = !!useAuthStore((s) => s.user?.is_primary_super_admin);
  const [query, setQuery] = useState('');
  const [tenants, setTenants] = useState<TenantHit[]>([]);
  const [loading, setLoading] = useState(false);
  /** Nothing is picked until the user moves to a row, as in Northwind. */
  const [selected, setSelected] = useState(-1);
  const requestId = useRef(0);

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setTenants([]);
      setSelected(-1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Rental companies, debounced. Sales agents do not search tenants.
  useEffect(() => {
    const term = sanitize(query);
    if (!open || nav.salesOnly || term.length < 2) {
      setTenants([]);
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const like = `%${term}%`;
      const { data } = await supabase
        .from('tenants')
        .select('id, company_name, slug, contact_email')
        .or(`company_name.ilike.${like},slug.ilike.${like},contact_email.ilike.${like}`)
        .order('company_name', { ascending: true })
        .limit(8);
      if (id !== requestId.current) return;
      setTenants((data as TenantHit[] | null) ?? []);
      setLoading(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open, nav.salesOnly]);

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (...text: (string | undefined)[]) => !q || text.join(' ').toLowerCase().includes(q);

    const companies = tenants.map<Result>((t) => ({
      key: t.id,
      kind: 'company',
      title: t.company_name || t.slug || 'Unnamed company',
      subtitle: [t.slug, t.contact_email].filter(Boolean).join(' · '),
      href: `/admin/rentals/${t.id}`,
      icon: Building2,
    }));

    const pages = nav.all
      .filter((item) => matches(item.name))
      .map<Result>((item) => ({
        key: item.href,
        kind: 'page',
        title: item.name,
        subtitle: item.href.replace('/admin/', '/'),
        href: item.href,
        icon: item.icon,
        description: PAGE_BRIEFS[item.href.split('?')[0]],
        newTab: item.newTab,
      }));

    // Settings pages are only listed once something is typed; "Go to" stays short.
    const settings = nav.salesOnly || !q
      ? []
      : ADMIN_SETTINGS_SECTIONS.flatMap((section) =>
          section.items
            .filter((item) => !item.primaryOnly || isPrimary)
            .filter((item) => matches(item.title, item.description, section.title, item.keywords))
            .map<Result>((item) => ({
              key: `setting-${item.title}`,
              kind: 'setting',
              title: item.title,
              subtitle: `Settings · ${section.title}`,
              href: item.href ?? `/admin/settings?tab=${item.tab}`,
              icon: Settings,
              description: item.description,
            })),
        );

    return [
      ...(companies.length ? [{ key: 'companies', title: 'Rental companies', items: companies }] : []),
      ...(pages.length ? [{ key: 'pages', title: q ? 'Pages' : 'Go to', items: pages }] : []),
      ...(settings.length ? [{ key: 'settings', title: 'Settings', items: settings }] : []),
    ];
  }, [query, tenants, nav.all, nav.salesOnly, isPrimary]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const picked = selected >= 0 && selected < flat.length ? flat[selected] : null;

  const go = useCallback(
    (result: Result, newTab = false) => {
      if (newTab || result.newTab) {
        window.open(result.href, '_blank', 'noopener,noreferrer');
        if (!newTab) onOpenChange(false);
        return;
      }
      onOpenChange(false);
      router.push(result.href);
    },
    [onOpenChange, router],
  );

  const copyLink = useCallback(async (result: Result) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${result.href}`);
      toast.success('Link copied', { description: result.title });
    } catch {
      toast.error('Could not copy the link', { description: 'Your browser did not allow it.' });
    }
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = picked ?? flat[0];
      if (pick) go(pick, meta);
    } else if (meta && (e.key === 'l' || e.key === 'L')) {
      const pick = picked ?? flat[0];
      if (pick) {
        e.preventDefault(); // otherwise the browser jumps to its address bar
        void copyLink(pick);
      }
    }
  };

  const placeholder = useTypedPlaceholder(open && !query, nav.salesOnly);
  const hasQuery = query.trim().length > 0;
  let rowIndex = -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[900px] gap-0 overflow-hidden border-border/70 p-0 shadow-lg"
        overlayClassName="bg-black/50 backdrop-blur-md"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search rental companies, pages and settings. Use the up and down arrows to move, Enter to open.
        </DialogDescription>

        {/* Two columns on one accent wash, each the full height of the window:
            searching on the left (a lighter veil over the wash), the brief on
            the right. The dialog's close button sits in the top-right corner. */}
        <div className="flex h-[540px] bg-gradient-to-br from-primary/20 via-primary/10 to-primary/25" onKeyDown={onKeyDown}>
          <div className="flex w-full min-w-0 flex-col bg-background/60 pb-1.5 md:w-[42%] md:border-r">
            <div className="flex items-center gap-2 border-b px-4 py-3 pr-12 md:pr-4">
              <Search className="h-4 w-4 shrink-0 text-primary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(-1);
                }}
                placeholder={placeholder}
                aria-label="Search"
                className="h-8 w-full min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:font-semibold placeholder:text-foreground/80"
              />
              {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
            </div>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-2 pb-1">
              {!loading && hasQuery && flat.length === 0 && (
                <div className="space-y-2 p-10 text-center">
                  <p className="text-sm font-semibold">No results</p>
                  <p className="text-xs text-muted-foreground">
                    Nothing matches <span className="font-medium text-foreground">&quot;{query}&quot;</span>. Try a company
                    name, its slug, an email or a page.
                  </p>
                </div>
              )}

              {groups.map((group) => (
                <div key={group.key} className="mb-2 last:mb-0">
                  <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                    {group.title}
                  </div>
                  {group.items.map((item) => {
                    rowIndex += 1;
                    const index = rowIndex;
                    const isSelected = index === selected;
                    return (
                      <button
                        key={`${group.key}-${item.key}`}
                        type="button"
                        onMouseEnter={() => setSelected(index)}
                        onClick={() => go(item)}
                        className={cn(
                          'group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                          isSelected && SIDEBAR_HIGHLIGHT_ACTIVE,
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate text-[13px] font-medium', !isSelected && 'text-foreground')}>
                            {item.title}
                          </span>
                          {item.subtitle && (
                            <span className="block truncate text-[11px] text-muted-foreground">{item.subtitle}</span>
                          )}
                        </span>
                        {isSelected && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* The brief */}
          <aside className="hidden w-[58%] flex-col overflow-hidden md:flex">
            {picked ? (
              picked.kind === 'company' ? (
                <CompanyBrief key={picked.key} result={picked} onOpen={(newTab) => go(picked, newTab)} />
              ) : (
                <PageBrief key={picked.key} result={picked} onOpen={(newTab) => go(picked, newTab)} />
              )
            ) : (
              <SearchIdle />
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── The right-hand column ──────────────────────────────────────────────── */

function SearchIdle() {
  return (
    <div className="flex h-full min-h-0 flex-col p-5">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
        <SearchEmptyArt className="max-w-[400px]" />
        <p className="mt-4 text-[15px] font-semibold tracking-tight text-foreground">Find anything on the platform</p>
        <p className="mt-1 max-w-[320px] text-[13px] leading-relaxed text-muted-foreground">
          A rental company by its name, slug or an email, or any page and setting in this dashboard.
        </p>
      </div>
    </div>
  );
}

function BriefFrame({
  eyebrow,
  title,
  subtitle,
  children,
  onOpen,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  onOpen: (newTab: boolean) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col p-6 pt-12">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">{eyebrow}</p>
      <h3 className="mt-1.5 truncate text-2xl font-bold tracking-tight text-foreground">{title}</h3>
      {subtitle && <p className="mt-1 truncate text-[13px] text-muted-foreground">{subtitle}</p>}
      <div className="mt-5 min-h-0 flex-1">{children}</div>
      <div className="flex items-center justify-end gap-3 pt-3">
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => onOpen(true)} aria-label="Open in a new tab">
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => onOpen(false)}>
            Open
            <ArrowUpRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One live number on a brief: the figure, and what it counts. */
type Stat = { label: string; value: string };

const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
};
const n = (value: number | null | undefined) => (value == null ? '—' : value.toLocaleString('en-US'));

/** `count(*)` of a table, optionally narrowed. Platform-wide on purpose: these are super-admin totals. */
async function count(table: string, narrow?: (q: any) => any): Promise<number | null> {
  let q = (supabase as any).from(table).select('*', { count: 'exact', head: true });
  if (narrow) q = narrow(q);
  const { count: c, error } = await q;
  return error ? null : c ?? 0;
}

/** The current admin_settings values a setting's brief reports. */
async function adminSettings(): Promise<Record<string, any>[]> {
  const { data } = await (supabase as any).from('admin_settings').select('*');
  return (data as Record<string, any>[] | null) ?? [];
}
const anyRow = (rows: Record<string, any>[], key: string, value: unknown) => rows.some((r) => r[key] === value);

/** The live numbers behind each page, read when the row is picked. */
const PAGE_STATS: Partial<Record<string, () => Promise<Stat[]>>> = {
  '/admin/dashboard': async () => {
    const [paying, rentals] = await Promise.all([
      count('tenant_subscriptions', (q) => q.eq('status', 'active')),
      count('rentals', (q) => q.gte('created_at', since(30))),
    ]);
    return [
      { label: 'Paying companies', value: n(paying) },
      { label: 'Rentals, last 30 days', value: n(rentals) },
    ];
  },
  '/admin/rentals': async () => {
    const [all, active, fresh] = await Promise.all([
      count('tenants'),
      count('tenants', (q) => q.eq('status', 'active')),
      count('tenants', (q) => q.gte('created_at', monthStart())),
    ]);
    return [
      { label: 'Companies', value: n(all) },
      { label: 'Active', value: n(active) },
      { label: 'New this month', value: n(fresh) },
    ];
  },
  '/admin/announcements': async () => {
    const [live, all] = await Promise.all([
      count('portal_announcements', (q) => q.eq('is_active', true)),
      count('portal_announcements'),
    ]);
    return [
      { label: 'Live now', value: n(live) },
      { label: 'Written', value: n(all) },
    ];
  },
  '/admin/feedbacks': async () => {
    const [open, week] = await Promise.all([
      count('tenant_feedback', (q) => q.eq('status', 'open')),
      count('tenant_feedback', (q) => q.gte('created_at', since(7))),
    ]);
    return [
      { label: 'Open', value: n(open) },
      { label: 'This week', value: n(week) },
    ];
  },
  '/admin/sales': async () => {
    const [all, month] = await Promise.all([
      count('sales_onboarding_submissions'),
      count('sales_onboarding_submissions', (q) => q.gte('created_at', monthStart())),
    ]);
    return [
      { label: 'Onboardings', value: n(all) },
      { label: 'This month', value: n(month) },
    ];
  },
  '/admin/promo-codes': async () => {
    const [active, used] = await Promise.all([
      count('platform_promo_codes', (q) => q.eq('status', 'active')),
      count('promo_code_redemptions'),
    ]);
    return [
      { label: 'Active codes', value: n(active) },
      { label: 'Times used', value: n(used) },
    ];
  },
  '/admin/signup-plans': async () => [{ label: 'Plans', value: n(await count('signup_plans')) }],
  '/admin/blacklist': async () => [{ label: 'Blocked identities', value: n(await count('global_blacklist')) }],
  '/admin/contacts': async () => {
    const [waiting, week] = await Promise.all([
      count('contact_requests', (q) => q.eq('status', 'pending')),
      count('contact_requests', (q) => q.gte('created_at', since(7))),
    ]);
    return [
      { label: 'Waiting', value: n(waiting) },
      { label: 'This week', value: n(week) },
    ];
  },
  '/admin/integrations': async () => [
    { label: 'Subscriptions', value: n(await count('tenant_integration_subscriptions_v2')) },
  ],
  '/admin/requests': async () => {
    const [pending, approved] = await Promise.all([
      count('go_live_requests', (q) => q.eq('status', 'pending')),
      count('go_live_requests', (q) => q.eq('status', 'approved')),
    ]);
    return [
      { label: 'Waiting for you', value: n(pending) },
      { label: 'Approved', value: n(approved) },
    ];
  },
  '/admin/support': async () => {
    const [open, working] = await Promise.all([
      count('trax_support_tickets', (q) => q.eq('status', 'open')),
      count('trax_support_tickets', (q) => q.eq('status', 'in_progress')),
    ]);
    return [
      { label: 'Open tickets', value: n(open) },
      { label: 'In progress', value: n(working) },
    ];
  },
  '/admin/openai-usage': async () => {
    const { data } = await (supabase as any)
      .from('openai_usage_logs')
      .select('cost_usd')
      .gte('created_at', monthStart())
      .limit(10000);
    const rows = (data as { cost_usd: number | null }[] | null) ?? [];
    const cost = rows.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0);
    return [
      { label: 'Calls this month', value: n(rows.length) },
      { label: 'Spend this month', value: `$${cost.toFixed(2)}` },
    ];
  },
  '/admin/audit-logs': async () => {
    const [day, week] = await Promise.all([
      count('audit_logs', (q) => q.gte('created_at', since(1))),
      count('audit_logs', (q) => q.gte('created_at', since(7))),
    ]);
    return [
      { label: 'Last 24 hours', value: n(day) },
      { label: 'Last 7 days', value: n(week) },
    ];
  },
  '/admin/legal': async () => [
    { label: 'Published', value: n(await count('platform_legal_documents', (q) => q.eq('is_published', true))) },
  ],
  '/admin/onboarding-questions': async () => [
    { label: 'Questions asked', value: n(await count('first_run_questions', (q) => q.eq('is_published', true))) },
  ],
  '/admin/setup-checklist': async () => [
    { label: 'On the checklist', value: n(await count('setup_checklist_items', (q) => q.eq('is_published', true))) },
  ],
  '/admin/welcome-pack': async () => [{ label: 'Sections', value: n(await count('welcome_pack_sections')) }],
  '/admin/admins': async () => [
    { label: 'Super admins', value: n(await count('app_users', (q) => q.eq('is_super_admin', true).eq('is_active', true))) },
  ],
};

/** The current value of each Settings page, read when the row is picked. */
const SETTING_STATS: Partial<Record<string, () => Promise<Stat[]>>> = {
  '/admin/settings?tab=subscription': async () => {
    const rows = await adminSettings();
    const days = rows[0]?.subscription_grace_days;
    return [
      { label: 'Grace period', value: days == null ? '—' : `${days} days` },
      { label: 'Blocking dialog', value: anyRow(rows, 'subscription_gate_disabled', true) ? 'Hidden' : 'Shown' },
    ];
  },
  '/admin/settings?tab=contact-form': async () => {
    const rows = await adminSettings();
    return [
      { label: 'Contact form', value: rows[0]?.contact_form_enabled === false ? 'Off' : 'On' },
      { label: 'Emailed to', value: n((rows[0]?.notification_emails as string[] | undefined)?.length ?? 0) },
    ];
  },
  '/admin/settings?tab=landing': async () => {
    const rows = await adminSettings();
    return [
      { label: 'Live landing page', value: anyRow(rows, 'landing_version', 'v2') ? 'v2' : 'v1' },
    ];
  },
  '/admin/settings?tab=booking-site': async () => {
    const rows = await adminSettings();
    return [{ label: 'Northwind site', value: anyRow(rows, 'northwind_site_version', 'v2') ? 'v2' : 'v1' }];
  },
  '/admin/settings?tab=signup': async () => {
    const rows = await adminSettings();
    return [{ label: 'Email code at signup', value: anyRow(rows, 'signup_otp_enabled', true) ? 'On' : 'Off' }];
  },
};

function PageBrief({ result, onOpen }: { result: Result; onOpen: (newTab: boolean) => void }) {
  const base = result.href.split('?')[0];
  const read: (() => Promise<Stat[]>) | undefined =
    result.kind === 'setting' ? SETTING_STATS[result.href] ?? PAGE_STATS[result.href] : PAGE_STATS[base];
  const [stats, setStats] = useState<Stat[] | null>(read ? null : []);

  useEffect(() => {
    if (!read) return;
    let cancelled = false;
    read()
      .then((s) => !cancelled && setStats(s))
      .catch(() => !cancelled && setStats([]));
    return () => {
      cancelled = true;
    };
  }, [read]);

  return (
    <BriefFrame
      eyebrow={result.kind === 'setting' ? 'Setting' : 'Page'}
      title={result.title}
      subtitle={result.subtitle}
      onOpen={onOpen}
    >
      {result.description && (
        <p className="max-w-[460px] text-[14px] leading-relaxed text-foreground/80">{result.description}</p>
      )}
      {stats === null ? (
        <div className="mt-5 flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Reading the latest…
        </div>
      ) : (
        stats.length > 0 && (
          <div className={cn('mt-5 grid gap-3', stats.length >= 3 ? 'grid-cols-3' : 'grid-cols-2')}>
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-2xl bg-background/60 px-4 py-3.5 ring-1 ring-foreground/5">
                <p className="text-2xl font-bold tracking-tight tabular-nums text-foreground">{stat.value}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        )
      )}
    </BriefFrame>
  );
}

type CompanyFacts = {
  status: string | null;
  tenant_type: string | null;
  created_at: string | null;
  contact_email: string | null;
  slug: string | null;
  subscription_plan: string | null;
  subscription: string | null;
  vehicles: number | null;
  rentals: number | null;
};

/** A rental company's brief: read live when it is picked, one company at a time. */
function CompanyBrief({ result, onOpen }: { result: Result; onOpen: (newTab: boolean) => void }) {
  const [facts, setFacts] = useState<CompanyFacts | null>(null);
  const tenantId = result.key;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Every read is scoped to this one tenant's id.
      const [tenant, sub, vehicles, rentals] = await Promise.all([
        (supabase as any)
          .from('tenants')
          .select('status, tenant_type, created_at, contact_email, slug, subscription_plan')
          .eq('id', tenantId)
          .maybeSingle(),
        (supabase as any)
          .from('tenant_subscriptions')
          .select('status')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        (supabase as any).from('vehicles').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        (supabase as any).from('rentals').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      ]);
      if (cancelled) return;
      setFacts({
        ...(tenant.data ?? {}),
        subscription: sub.data?.status ?? null,
        vehicles: vehicles.count ?? null,
        rentals: rentals.count ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const rows: [string, string][] = facts
    ? [
        ['Status', cap(facts.status) ?? '—'],
        ['Type', cap(facts.tenant_type) ?? '—'],
        ['Subscription', facts.subscription ? `${cap(facts.subscription)}${facts.subscription_plan ? ` · ${facts.subscription_plan}` : ''}` : 'None yet'],
        ['Fleet', facts.vehicles == null ? '—' : `${facts.vehicles} ${facts.vehicles === 1 ? 'car' : 'cars'}`],
        ['Rentals', facts.rentals == null ? '—' : String(facts.rentals)],
        ['Joined', facts.created_at ? new Date(facts.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'],
        ['Contact', facts.contact_email ?? '—'],
      ]
    : [];

  return (
    <BriefFrame eyebrow="Rental company" title={result.title} subtitle={result.subtitle} onOpen={onOpen}>
      {!facts ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Reading this company…
        </div>
      ) : (
        <dl className="divide-y divide-border/60 rounded-2xl bg-background/60 px-4 ring-1 ring-foreground/5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-[13px] text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate text-right text-[13px] font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </BriefFrame>
  );
}

function cap(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');
}

/** Types out what the search can find, one line at a time, while the field is empty. */
function useTypedPlaceholder(active: boolean, salesOnly: boolean): string {
  const resting = salesOnly ? 'Search pages…' : 'Search the platform…';
  const [text, setText] = useState(resting);

  useEffect(() => {
    if (!active || salesOnly) {
      setText(resting);
      return;
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let line = 0;
    let chars = 0;
    let deleting = false;
    let timer: number;

    const tick = () => {
      const phrase = CAPABILITIES[line];
      if (reduced) {
        setText(`Find ${phrase}…`);
        line = (line + 1) % CAPABILITIES.length;
        timer = window.setTimeout(tick, 2600);
        return;
      }
      chars += deleting ? -1 : 1;
      setText(`Find ${phrase.slice(0, chars)}`);
      if (!deleting && chars === phrase.length) {
        deleting = true;
        timer = window.setTimeout(tick, 1600); // hold the full line
      } else if (deleting && chars === 0) {
        deleting = false;
        line = (line + 1) % CAPABILITIES.length;
        timer = window.setTimeout(tick, 250);
      } else {
        timer = window.setTimeout(tick, deleting ? 22 : 45);
      }
    };
    timer = window.setTimeout(tick, 400);
    return () => window.clearTimeout(timer);
  }, [active, salesOnly, resting]);

  return text;
}
