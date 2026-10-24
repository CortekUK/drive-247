'use client';

/**
 * Contact requests (rebuilt 2026-10-19, Ghulam): a Northwind-style line chart
 * of requests over time, then one table: star, status, details in a dialog,
 * add by hand, edit, delete, and CSV export / import.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Download, MoreVertical, Plus, Star, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { HEADER_ACTIONS, HEADER_PRIMARY, HeaderIconButton, PAGE_HEADER, PAGE_HEADER_TEXT, PAGE_TITLE, PAGE_DESCRIPTION } from '@/components/admin/header-buttons';
import { usePageSearch } from '@/components/admin/page-search-slot';
import { SegmentedControl } from '@/components/announcements/segmented-control';
import { EmptyState } from '@/components/admin/empty-state';
import { EnquiriesEmptyArt } from '@/components/admin/illustrations/scenes/enquiries';
import { ContactChart } from '@/components/admin/contacts/contact-chart';
import { ContactDetailDialog, ContactFormDialog, ImportDialog } from '@/components/admin/contacts/contact-dialogs';
import { LeadSourcesDialog, MetaReturnHandler, useLeadConnections } from '@/components/admin/contacts/lead-sources';
import {
  CONTACT_COLUMNS,
  CONTACT_STATUSES,
  SOURCE_DOT,
  SOURCE_GROUPS,
  STATUS_LABEL,
  STATUS_TEXT,
  companyOf,
  downloadFile,
  rowOf,
  sourceLabel,
  toCsv,
  type ContactDraft,
  type ContactRequest,
  type ContactStatus,
  type ImportPlan,
} from '@/components/admin/contacts/contact-model';

const PAGE_SIZE = 25;
type StatusFilter = 'all' | ContactStatus;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function ContactRequestsPage() {
  const [rows, setRows] = useState<ContactRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContactRequest | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const { connections, reload: reloadConnections } = useLeadConnections();

  usePageSearch({ placeholder: 'Search name, email, phone…', value: query, onChange: setQuery, scopeLabel: 'Contact requests' });

  const load = useCallback(async () => {
    // Paged reads: PostgREST stops at 1,000 rows a request.
    const all: ContactRequest[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('contact_requests')
        .select(CONTACT_COLUMNS)
        .order('created_at', { ascending: false })
        .range(from, from + 999);
      if (error) {
        toast.error(`Could not load requests: ${error.message}`);
        break;
      }
      all.push(...((data as unknown as ContactRequest[]) ?? []));
      if (!data || data.length < 1000) break;
    }
    setRows(all);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => setPage(0), [query, status, favOnly, sourceFilter]);

  const patch = (id: string, next: Partial<ContactRequest>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)));

  const update = async (r: ContactRequest, next: Partial<ContactRequest>, success?: string) => {
    const before = { ...r };
    patch(r.id, next);
    const { error } = await supabase
      .from('contact_requests')
      .update({ ...next, updated_at: new Date().toISOString() })
      .eq('id', r.id);
    if (error) {
      patch(r.id, before);
      toast.error(`Could not save: ${error.message}`);
      return false;
    }
    if (success) toast.success(success);
    return true;
  };

  const setStatusOf = (r: ContactRequest, s: ContactStatus) => {
    if (r.status !== s) void update(r, { status: s });
  };
  const toggleFavorite = (r: ContactRequest) => void update(r, { is_favorite: !r.is_favorite });

  const remove = async (r: ContactRequest) => {
    const ok = await confirmDialog({
      title: `Delete ${r.contact_name}?`,
      description: r.source === 'strategy-call' ? 'Their strategy-call session is deleted with it. This cannot be undone.' : 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('contact_requests').delete().eq('id', r.id);
    if (error) {
      toast.error(`Could not delete: ${error.message}`);
      return;
    }
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    if (openId === r.id) setOpenId(null);
    toast.success('Request deleted');
  };

  const save = async (draft: ContactDraft): Promise<boolean> => {
    const row = rowOf(draft);
    if (editing && editing !== 'new') {
      return update(editing, row as Partial<ContactRequest>, 'Request saved');
    }
    const { data, error } = await supabase
      .from('contact_requests')
      .insert({ ...row, source: 'manual' })
      .select(CONTACT_COLUMNS)
      .single();
    if (error || !data) {
      toast.error(`Could not add: ${error?.message ?? 'no row came back'}`);
      return false;
    }
    setRows((prev) => [data as unknown as ContactRequest, ...prev]);
    toast.success('Request added');
    return true;
  };

  const importRows = async (incoming: ImportPlan['rows']): Promise<boolean> => {
    let added = 0;
    for (let i = 0; i < incoming.length; i += 200) {
      const { data, error } = await supabase.from('contact_requests').insert(incoming.slice(i, i + 200)).select('id');
      if (error) {
        toast.error(`Stopped after ${added}: ${error.message}`);
        void load();
        return false;
      }
      added += data?.length ?? 0;
    }
    toast.success(`Imported ${added} ${added === 1 ? 'request' : 'requests'}`);
    void load();
    return true;
  };

  const existingEmails = useMemo(() => new Set(rows.map((r) => r.email.trim().toLowerCase())), [rows]);
  const dates = useMemo(() => rows.map((r) => new Date(r.created_at).getTime()), [rows]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: rows.length, pending: 0, contacted: 0, converted: 0, rejected: 0 };
    for (const r of rows) if (r.status in c) c[r.status]++;
    return c;
  }, [rows]);
  const favCount = useMemo(() => rows.filter((r) => r.is_favorite).length, [rows]);

  const sourceCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const g of SOURCE_GROUPS) c[g.key] = rows.filter((r) => (g.sources as readonly string[]).includes(r.source ?? '')).length;
    return c;
  }, [rows]);
  const websiteRows = useMemo(() => rows.filter((r) => r.source === 'website' || r.source === 'strategy-call'), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const group = SOURCE_GROUPS.find((g) => g.key === sourceFilter);
    return rows.filter(
      (r) =>
        (status === 'all' || r.status === status) &&
        (!group || (group.sources as readonly string[]).includes(r.source ?? '')) &&
        (!favOnly || r.is_favorite) &&
        (!q ||
          [r.contact_name, r.email, r.phone, companyOf(r), r.fleet_size, r.current_platform, r.message, r.notes]
            .filter(Boolean)
            .some((v) => (v as string).toLowerCase().includes(q))),
    );
  }, [rows, query, status, favOnly, sourceFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const open = rows.find((r) => r.id === openId) ?? null;

  const exportCsv = () => {
    const list = filtered.length ? filtered : rows;
    downloadFile(`contact-requests-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(list));
    toast.success(`Exported ${list.length} ${list.length === 1 ? 'request' : 'requests'}`);
  };

  return (
    <div className="space-y-6">
      <div className={cn('flex flex-wrap items-center justify-between gap-4', PAGE_HEADER)}>
        <div className={cn('min-w-0', PAGE_HEADER_TEXT)}>
          <h1 className={cn('text-2xl font-bold tracking-tight sm:text-3xl', PAGE_TITLE)}>Contact Requests</h1>
          <p className={cn('text-sm text-muted-foreground', PAGE_DESCRIPTION)}>Leads from the website, Meta Ads and Google Ads, and ones you add by hand.</p>
        </div>
        <div className={HEADER_ACTIONS}>
          <button
            type="button"
            onClick={() => setSourcesOpen(true)}
            aria-label="Connect lead sources"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-background pl-3.5 pr-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted max-sm:h-8 max-sm:gap-1 max-sm:pl-2.5 max-sm:pr-1.5"
          >
            <span className="flex -space-x-1" aria-hidden>
              <span className="size-2.5 rounded-full bg-primary ring-2 ring-background" />
              {connections.some((c) => c.provider === 'meta') && <span className="size-2.5 rounded-full bg-[#0866FF] ring-2 ring-background" />}
              {connections.some((c) => c.provider === 'google') && <span className="size-2.5 rounded-full bg-[#34A853] ring-2 ring-background" />}
            </span>
            {/* A phone keeps the source dots and the chevron; the word would
                leave the description line no room. */}
            <span className="max-sm:hidden">Connect</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
          <HeaderIconButton label="Import CSV" onClick={() => setImporting(true)}>
            <Upload className="h-4 w-4" />
          </HeaderIconButton>
          <HeaderIconButton label="Export CSV" onClick={exportCsv}>
            <Download className="h-4 w-4" />
          </HeaderIconButton>
          <Button className={HEADER_PRIMARY} onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            New request
          </Button>
        </div>
      </div>

      {loading ? <div className="h-[262px] animate-pulse rounded-3xl border border-border bg-muted/40" /> : <ContactChart dates={dates} />}

      <div className="flex flex-wrap items-center justify-between gap-3 max-md:flex-col max-md:flex-nowrap max-md:items-stretch">
        {/* Phones: the status chips stay one row and scroll sideways, edge to
            edge, instead of wrapping into a two-line pill. */}
        <div className="max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden">
        <SegmentedControl
          className="max-md:max-w-none max-md:flex-nowrap max-md:[&>button]:shrink-0 max-md:[&>button]:whitespace-nowrap"
          size="sm"
          ariaLabel="Status"
          options={[
            { value: 'all' as StatusFilter, label: `All · ${counts.all}` },
            ...CONTACT_STATUSES.map((s) => ({ value: s as StatusFilter, label: `${STATUS_LABEL[s]} · ${counts[s]}` })),
          ]}
          value={status}
          onChange={setStatus}
        />
        </div>
        <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              sourceFilter === 'all' ? 'border-border text-muted-foreground hover:text-foreground' : 'border-primary/40 bg-primary/5 text-foreground',
            )}
          >
            {sourceFilter !== 'all' && <span className={cn('size-2 rounded-full', SOURCE_DOT[sourceFilter])} />}
            {SOURCE_GROUPS.find((g) => g.key === sourceFilter)?.label ?? 'All sources'}
            <ChevronDown className="size-3.5 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[190px]">
            <DropdownMenuItem onSelect={() => setSourceFilter('all')} className={cn(sourceFilter === 'all' && 'font-medium text-primary')}>
              <span className="flex-1">All sources</span>
              <span className="text-xs text-muted-foreground tabular-nums">{rows.length}</span>
            </DropdownMenuItem>
            {SOURCE_GROUPS.map((g) => (
              <DropdownMenuItem key={g.key} onSelect={() => setSourceFilter(g.key)} className={cn('gap-2', sourceFilter === g.key && 'font-medium text-primary')}>
                <span className={cn('size-2 rounded-full', SOURCE_DOT[g.key])} />
                <span className="flex-1">{g.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{sourceCounts[g.key]}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-pressed={favOnly}
          onClick={() => setFavOnly((v) => !v)}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
            favOnly ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200' : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          <Star className={cn('size-3.5', favOnly && 'fill-amber-400 text-amber-400')} />
          Favourites · {favCount}
        </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="w-12 py-3 pl-4" aria-label="Favourite" />
                <th className="px-3 py-3">Source</th>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Email</th>
                <th className="px-3 py-3">Phone</th>
                <th className="px-3 py-3">Fleet</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Submitted</th>
                <th className="w-12 py-3 pr-4" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading
                ? Array.from({ length: 8 }, (_, i) => (
                    <tr key={i}>
                      <td colSpan={9} className="px-4 py-3">
                        <div className="h-5 animate-pulse rounded-full bg-muted/60" />
                      </td>
                    </tr>
                  ))
                : shown.map((r) => (
                    <tr key={r.id} onClick={() => setOpenId(r.id)} className="group cursor-pointer transition-colors hover:bg-muted/40">
                      <td className="py-3 pl-4" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={r.is_favorite ? 'Remove from favourites' : 'Add to favourites'}
                          onClick={() => toggleFavorite(r)}
                          className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted hover:text-amber-500"
                        >
                          <Star className={cn('size-4', r.is_favorite && 'fill-amber-400 text-amber-400')} />
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-0.5 text-xs font-medium text-foreground" title={r.source_detail ?? undefined}>
                          <span className={cn('size-1.5 rounded-full', SOURCE_DOT[r.source ?? ''] ?? 'bg-muted-foreground/50')} />
                          {sourceLabel(r.source)}
                          {r.is_test && <span className="text-warning">· Test</span>}
                        </span>
                      </td>
                      <td className="max-w-[220px] px-3 py-3">
                        <p className="truncate font-medium text-foreground">{r.contact_name}</p>
                        {companyOf(r) && <p className="truncate text-xs text-muted-foreground">{companyOf(r)}</p>}
                      </td>
                      <td className="max-w-[240px] truncate px-3 py-3 text-muted-foreground">{r.email}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{r.phone || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{r.fleet_size || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger className={cn('inline-flex items-center gap-1 rounded-full font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', STATUS_TEXT[r.status])}>
                            {STATUS_LABEL[r.status] ?? r.status}
                            <ChevronDown className="size-3.5 opacity-60" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="min-w-[150px]">
                            {CONTACT_STATUSES.map((s) => (
                              <DropdownMenuItem key={s} onSelect={() => setStatusOf(r, s)} className={cn(s === r.status && 'font-medium text-primary')}>
                                {STATUS_LABEL[s]}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{fmtDate(r.created_at)}</td>
                      <td className="py-3 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`${r.contact_name} actions`}
                            className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted"
                          >
                            <MoreVertical className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[160px]">
                            <DropdownMenuItem onSelect={() => setOpenId(r.id)}>View details</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setEditing(r)}>Edit</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => toggleFavorite(r)}>{r.is_favorite ? 'Remove favourite' : 'Add to favourites'}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void remove(r)}>
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {!loading && rows.length === 0 && (
          <EmptyState
            illustration={<EnquiriesEmptyArt />}
            headline="No contact requests yet"
            body="When someone fills in the form on drive-247.com, or you add one by hand, it lands here."
          />
        )}
        {!loading && rows.length > 0 && filtered.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted-foreground">Nothing matches.</p>}

        {!loading && filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min(filtered.length, (page + 1) * PAGE_SIZE)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="inline-flex size-8 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="px-1 tabular-nums">
                {page + 1} / {pages}
              </span>
              <button
                type="button"
                aria-label="Next page"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex size-8 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <ContactDetailDialog
        item={open}
        onClose={() => setOpenId(null)}
        onStatus={setStatusOf}
        onFavorite={toggleFavorite}
        onEdit={(r) => setEditing(r)}
        onDelete={(r) => void remove(r)}
        onSaveNotes={(r, notes) => update(r, { notes: notes.trim() || null }, 'Notes saved')}
      />
      <ContactFormDialog open={editing !== null} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={save} />
      <LeadSourcesDialog
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        connections={connections}
        websiteCount={websiteRows.length}
        websiteLast={websiteRows[0]?.created_at ?? null}
        reload={reloadConnections}
      />
      <MetaReturnHandler
        onDone={async () => {
          await reloadConnections();
          setSourcesOpen(true);
        }}
      />
      <ImportDialog open={importing} existingEmails={existingEmails} onClose={() => setImporting(false)} onImport={importRows} />
    </div>
  );
}
