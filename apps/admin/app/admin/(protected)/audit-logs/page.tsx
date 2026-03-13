'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ScrollText,
  Search,
  ChevronLeft,
  ChevronRight,
  Info,
  RotateCcw,
  Building2,
  ChevronsUpDown,
  Check,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/ui/date-picker';
import { format } from 'date-fns';
import { Download, Loader2 } from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatActionName(action: string): string {
  // Short, single-line labels — no badge should ever wrap
  const actionMap: Record<string, string> = {
    update_settings: 'Settings Edit',
    settings_updated: 'Settings Edit',
    create_user: 'User Add',
    update_user: 'User Edit',
    delete_user: 'User Delete',
    user_created: 'User Add',
    user_updated: 'User Edit',
    user_deleted: 'User Delete',
    blocked_customer: 'Blocked',
    unblocked_customer: 'Unblocked',
    customer_created: 'Customer Add',
    customer_updated: 'Customer Edit',
    customer_deleted: 'Customer Delete',
    customer_blocked: 'Blocked',
    customer_unblocked: 'Unblocked',
    customer_approved: 'Approved',
    customer_rejected: 'Rejected',
    identity_blocked: 'ID Blocked',
    identity_unblocked: 'ID Unblocked',
    vehicle_created: 'Vehicle Add',
    vehicle_updated: 'Vehicle Edit',
    vehicle_deleted: 'Vehicle Delete',
    vehicle_status_changed: 'Status Change',
    rental_created: 'Rental Add',
    rental_updated: 'Rental Edit',
    rental_cancelled: 'Cancelled',
    rental_closed: 'Closed',
    rental_extended: 'Extended',
    rental_deleted: 'Rental Delete',
    payment_created: 'Payment Add',
    payment_captured: 'Captured',
    payment_refunded: 'Refunded',
    payment_failed: 'Pay Failed',
    fine_created: 'Fine Add',
    fine_updated: 'Fine Edit',
    fine_deleted: 'Fine Delete',
    fine_charged: 'Fine Charged',
    fine_waived: 'Fine Waived',
    fine_paid: 'Fine Paid',
    fine_appeal_successful: 'Appeal Won',
    invoice_created: 'Invoice Add',
    invoice_updated: 'Invoice Edit',
    invoice_deleted: 'Invoice Delete',
    invoice_sent: 'Invoice Sent',
    document_uploaded: 'Doc Upload',
    document_updated: 'Doc Edit',
    document_deleted: 'Doc Delete',
    plate_created: 'Plate Add',
    plate_updated: 'Plate Edit',
    plate_deleted: 'Plate Delete',
    plate_assigned: 'Plate Assign',
    plate_unassigned: 'Plate Remove',
    promotion_created: 'Promo Add',
    promotion_updated: 'Promo Edit',
    promotion_deleted: 'Promo Delete',
    testimonial_created: 'Review Add',
    testimonial_updated: 'Review Edit',
    testimonial_deleted: 'Review Delete',
    faq_created: 'FAQ Add',
    faq_updated: 'FAQ Edit',
    faq_deleted: 'FAQ Delete',
    location_created: 'Location Add',
    location_updated: 'Location Edit',
    location_deleted: 'Location Delete',
    holiday_created: 'Holiday Add',
    holiday_updated: 'Holiday Edit',
    holiday_deleted: 'Holiday Delete',
    login_success: 'Login',
    login_failed: 'Login Fail',
    logout: 'Logout',
  };

  if (actionMap[action]) return actionMap[action];

  // Dialog/warning shown → shorten to "Viewed"
  if (action.includes('_dialog_shown')) {
    const entity = action.replace('_dialog_shown', '').replace(/_/g, ' ');
    const words = entity.split(' ');
    // Take first 2 words max, capitalize
    return words.slice(0, 2).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') + ' View';
  }
  if (action.includes('_warning_shown')) {
    const entity = action.replace('_warning_shown', '').replace(/_/g, ' ');
    const words = entity.split(' ');
    return words.slice(0, 2).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') + ' Warn';
  }

  // Default: capitalize, max 2 words
  const words = action
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  if (words.length > 3) return words.slice(0, 2).join(' ');
  return words.join(' ');
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';

function getActionBadgeVariant(action: string): BadgeVariant {
  if (action.includes('warning_shown') || action.includes('dialog_shown')) return 'warning';
  if (
    action.includes('rejected') ||
    action.includes('deleted') ||
    action.includes('blocked') ||
    action.includes('cancelled') ||
    action.includes('failed') ||
    action.includes('waived')
  )
    return 'destructive';
  if (
    action.includes('approved') ||
    action.includes('created') ||
    action.includes('unblocked') ||
    action.includes('captured') ||
    action.includes('paid') ||
    action.includes('uploaded') ||
    action.includes('assigned')
  )
    return 'success';
  if (
    action.includes('updated') ||
    action.includes('changed') ||
    action.includes('extended') ||
    action.includes('closed')
  )
    return 'info';
  if (action.includes('refunded') || action.includes('charged')) return 'warning';
  return 'secondary';
}

// ── Types ────────────────────────────────────────────────────────────────────

interface AuditLog {
  id: string;
  action: string;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  tenant_id: string | null;
  target_user_id: string | null;
  actor?: { name: string | null; email: string } | null;
  tenant?: { name: string } | null;
}

interface Tenant {
  id: string;
  name: string;
}

const PAGE_SIZE = 25;

// ── Searchable Tenant Picker ─────────────────────────────────────────────────

function TenantPicker({
  tenants,
  value,
  onChange,
}: {
  tenants: Tenant[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = search
    ? tenants.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : tenants;

  const selectedTenant = tenants.find((t) => t.id === value);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          !selectedTenant && value === 'all' && 'text-muted-foreground'
        )}
      >
        <div className="flex items-center gap-2 truncate">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="truncate">
            {value === 'all' ? 'All Tenants' : selectedTenant?.name || 'Select tenant...'}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {value !== 'all' && (
            <span
              role="button"
              className="rounded-sm p-0.5 hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                onChange('all');
                setSearch('');
              }}
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </button>

      {open && (
        <div className="absolute z-[200] mt-1 w-full rounded-md border bg-popover shadow-md animate-in fade-in-0 zoom-in-95">
          <div className="p-2 border-b border-border/40">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tenants..."
                className="w-full rounded-md bg-background border border-input px-8 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
          <div className="max-h-[240px] overflow-y-auto p-1">
            <button
              onClick={() => {
                onChange('all');
                setOpen(false);
                setSearch('');
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-default hover:bg-accent',
                value === 'all' && 'bg-accent'
              )}
            >
              <Check className={cn('h-3.5 w-3.5 flex-shrink-0', value === 'all' ? 'opacity-100 text-primary' : 'opacity-0')} />
              <span>All Tenants</span>
            </button>
            {filtered.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                No tenants found
              </div>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    onChange(t.id);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-default hover:bg-accent',
                    value === t.id && 'bg-accent'
                  )}
                >
                  <Check className={cn('h-3.5 w-3.5 flex-shrink-0', value === t.id ? 'opacity-100 text-primary' : 'opacity-0')} />
                  <span className="truncate">{t.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AuditLogsPage() {
  // Data
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [tenantFilter, setTenantFilter] = useState('all');
  const [entityTypeFilter, setEntityTypeFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

  // State
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtersLoading, setFiltersLoading] = useState(true);

  // ── Fetch filter options ──────────────────────────────────────────────────

  useEffect(() => {
    async function fetchFilters() {
      setFiltersLoading(true);

      // Fetch entity types and actions from audit_logs (RLS works for super admin)
      const [entityTypesRes, actionsRes, tenantIdsRes] = await Promise.all([
        supabase.from('audit_logs').select('entity_type').limit(1000),
        supabase.from('audit_logs').select('action').limit(1000),
        supabase.from('audit_logs').select('tenant_id').limit(2000),
      ]);

      if (entityTypesRes.data) {
        const unique = [...new Set(entityTypesRes.data.map((d) => d.entity_type).filter(Boolean))] as string[];
        setEntityTypes(unique.sort());
      }

      if (actionsRes.data) {
        const unique = [...new Set(actionsRes.data.map((d) => d.action).filter(Boolean))] as string[];
        setActions(unique.sort());
      }

      // Fetch all tenants — column is company_name, not name
      const { data: tenantData, error: tenantError } = await supabase
        .from('tenants')
        .select('id, company_name')
        .order('company_name');

      if (tenantError) console.error('Tenants query error:', tenantError);

      if (tenantData && tenantData.length > 0) {
        setTenants(tenantData.map((t: { id: string; company_name: string }) => ({
          id: t.id,
          name: t.company_name || t.id.slice(0, 8) + '...',
        })));
      }

      setFiltersLoading(false);
    }
    fetchFilters();
  }, []);

  // ── Fetch logs ────────────────────────────────────────────────────────────

  // Build a tenant lookup map for resolving names without FK joins
  const tenantMap = new Map(tenants.map((t) => [t.id, t.name]));

  const fetchLogs = useCallback(async () => {
    setLoading(true);

    // Avoid FK joins — audit_logs has duplicate FK constraints on tenant_id
    // which makes PostgREST ambiguous. Fetch flat columns only.
    let query = supabase
      .from('audit_logs')
      .select(
        `
        id,
        action,
        actor_id,
        entity_type,
        entity_id,
        details,
        created_at,
        tenant_id,
        target_user_id
      `,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (tenantFilter !== 'all') query = query.eq('tenant_id', tenantFilter);
    if (entityTypeFilter !== 'all') query = query.eq('entity_type', entityTypeFilter);
    if (actionFilter !== 'all') query = query.eq('action', actionFilter);
    if (dateFrom) query = query.gte('created_at', format(dateFrom, 'yyyy-MM-dd'));
    if (dateTo) query = query.lte('created_at', format(dateTo, 'yyyy-MM-dd') + 'T23:59:59');

    const { data, count, error } = await query;

    if (error) {
      console.error('Error fetching audit logs:', error);
    } else {
      // Collect unique actor_ids to batch-fetch actor details
      const actorIds = [...new Set((data || []).map((d: AuditLog) => d.actor_id).filter(Boolean))] as string[];
      let actorMap = new Map<string, { name: string | null; email: string }>();

      if (actorIds.length > 0) {
        const { data: actors } = await supabase
          .from('app_users')
          .select('id, name, email')
          .in('id', actorIds);

        if (actors) {
          actorMap = new Map(actors.map((a) => [a.id, { name: a.name, email: a.email }]));
        }
      }

      // If tenantMap is empty (tenants not loaded yet), fetch tenant names for these logs
      const logTenantIds = [...new Set((data || []).map((d: AuditLog) => d.tenant_id).filter(Boolean))] as string[];
      let localTenantMap = tenantMap;

      if (localTenantMap.size === 0 && logTenantIds.length > 0) {
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('id, company_name')
          .in('id', logTenantIds);
        if (tenantData) {
          localTenantMap = new Map(tenantData.map((t: { id: string; company_name: string }) => [t.id, t.company_name]));
        }
      }

      const enriched = (data || []).map((log: AuditLog) => ({
        ...log,
        actor: log.actor_id ? actorMap.get(log.actor_id) || null : null,
        tenant: log.tenant_id ? { name: localTenantMap.get(log.tenant_id) || log.tenant_id.slice(0, 8) } : null,
      }));

      setLogs(enriched as AuditLog[]);
      setTotalCount(count || 0);
    }

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, tenantFilter, entityTypeFilter, actionFilter, dateFrom, dateTo, tenants]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset to page 0 when filters change
  useEffect(() => {
    setPage(0);
  }, [tenantFilter, entityTypeFilter, actionFilter, dateFrom, dateTo]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasActiveFilters =
    tenantFilter !== 'all' ||
    entityTypeFilter !== 'all' ||
    actionFilter !== 'all' ||
    !!dateFrom ||
    !!dateTo ||
    searchQuery !== '';

  const filteredLogs = searchQuery
    ? logs.filter(
        (log) =>
          log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
          log.entity_type?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          log.actor?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          log.actor?.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          log.tenant?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          JSON.stringify(log.details || {})
            .toLowerCase()
            .includes(searchQuery.toLowerCase())
      )
    : logs;

  const [exporting, setExporting] = useState(false);

  function resetFilters() {
    setTenantFilter('all');
    setEntityTypeFilter('all');
    setActionFilter('all');
    setSearchQuery('');
    setDateFrom(undefined);
    setDateTo(undefined);
    setPage(0);
  }

  async function exportCSV() {
    setExporting(true);
    try {
      // Fetch ALL matching rows (no pagination) with current filters
      const batchSize = 1000;
      let allData: AuditLog[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        let query = supabase
          .from('audit_logs')
          .select('id, action, actor_id, entity_type, entity_id, details, created_at, tenant_id, target_user_id')
          .order('created_at', { ascending: false })
          .range(offset, offset + batchSize - 1);

        if (tenantFilter !== 'all') query = query.eq('tenant_id', tenantFilter);
        if (entityTypeFilter !== 'all') query = query.eq('entity_type', entityTypeFilter);
        if (actionFilter !== 'all') query = query.eq('action', actionFilter);
        if (dateFrom) query = query.gte('created_at', format(dateFrom, 'yyyy-MM-dd'));
        if (dateTo) query = query.lte('created_at', format(dateTo, 'yyyy-MM-dd') + 'T23:59:59');

        const { data, error } = await query;
        if (error) { console.error('Export error:', error); break; }
        if (!data || data.length === 0) { hasMore = false; break; }

        allData = allData.concat(data as AuditLog[]);
        if (data.length < batchSize) { hasMore = false; }
        offset += batchSize;
      }

      if (allData.length === 0) { setExporting(false); return; }

      // Batch-fetch actor names
      const actorIds = [...new Set(allData.map((d) => d.actor_id).filter(Boolean))] as string[];
      const actorLookup = new Map<string, string>();
      if (actorIds.length > 0) {
        // Fetch in chunks of 50 to avoid URL length limits
        for (let i = 0; i < actorIds.length; i += 50) {
          const chunk = actorIds.slice(i, i + 50);
          const { data: actors } = await supabase.from('app_users').select('id, name, email').in('id', chunk);
          if (actors) actors.forEach((a) => actorLookup.set(a.id, a.name || a.email));
        }
      }

      // Build CSV
      const escapeCSV = (val: string) => {
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      };

      const headers = ['Date & Time', 'Action', 'Entity Type', 'Entity ID', 'Tenant', 'Performed By', 'Details'];
      const rows = allData.map((log) => [
        new Date(log.created_at).toISOString(),
        formatActionName(log.action),
        log.entity_type || '',
        log.entity_id || '',
        log.tenant_id ? (tenantMap.get(log.tenant_id) || log.tenant_id) : 'System',
        log.actor_id ? (actorLookup.get(log.actor_id) || log.actor_id) : 'System',
        log.details ? JSON.stringify(log.details) : '',
      ]);

      const csv = [headers, ...rows].map((row) => row.map(escapeCSV).join(',')).join('\n');

      // Download
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const parts = ['audit-logs'];
      if (tenantFilter !== 'all') {
        const tName = tenantMap.get(tenantFilter);
        if (tName) parts.push(tName.replace(/\s+/g, '-').toLowerCase());
      }
      if (dateFrom) parts.push('from-' + format(dateFrom, 'yyyy-MM-dd'));
      if (dateTo) parts.push('to-' + format(dateTo, 'yyyy-MM-dd'));
      a.download = parts.join('_') + '.csv';

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
    setExporting(false);
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function renderDetailsTooltip(details: Record<string, unknown> | null) {
    if (!details || Object.keys(details).length === 0) return <span className="text-muted-foreground">—</span>;

    const entries = Object.entries(details).slice(0, 6);

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Info className="h-3.5 w-3.5" />
            {Object.keys(details).length} field{Object.keys(details).length !== 1 ? 's' : ''}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-sm">
          <div className="space-y-1">
            {entries.map(([key, val]) => (
              <div key={key} className="text-xs">
                <span className="text-primary font-medium">{key}:</span>{' '}
                <span className="text-muted-foreground">{String(val).slice(0, 80)}</span>
              </div>
            ))}
            {Object.keys(details).length > 6 && (
              <div className="text-xs text-muted-foreground/60">
                +{Object.keys(details).length - 6} more...
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15 glow-purple-sm">
            <ScrollText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
            <p className="text-sm text-muted-foreground">
              Global activity log across all tenants · <span className="tabular-nums">{totalCount.toLocaleString()}</span> entries
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={exportCSV}
            disabled={exporting || totalCount === 0}
            className="gap-1.5"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {exporting ? 'Exporting...' : 'Export CSV'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {/* Search */}
            <div className="relative xl:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Tenant filter — searchable */}
            <TenantPicker
              tenants={tenants}
              value={tenantFilter}
              onChange={setTenantFilter}
            />

            {/* Entity type filter */}
            <Select value={entityTypeFilter} onValueChange={setEntityTypeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Entities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                {entityTypes.map((et) => (
                  <SelectItem key={et} value={et}>
                    {et.charAt(0).toUpperCase() + et.slice(1).replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Date range */}
            <DatePicker
              value={dateFrom}
              onChange={setDateFrom}
              placeholder="From date"
            />
            <DatePicker
              value={dateTo}
              onChange={setDateTo}
              placeholder="To date"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Activity Log</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {loading ? (
            <div className="space-y-3 px-6 pb-6">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ScrollText className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No audit logs found</p>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={resetFilters} className="mt-2">
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary/5 hover:bg-primary/5">
                    <TableHead className="w-[160px]">Date & Time</TableHead>
                    <TableHead className="w-[180px]">Action</TableHead>
                    <TableHead className="w-[120px]">Entity</TableHead>
                    <TableHead className="w-[160px]">Tenant</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead className="w-[180px]">Performed By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {formatDate(log.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getActionBadgeVariant(log.action)} className="text-[11px] whitespace-nowrap">
                          {formatActionName(log.action)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {log.entity_type ? (
                          <span className="text-xs font-medium capitalize">
                            {log.entity_type.replace(/_/g, ' ')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {log.tenant?.name ? (
                          <span className="text-xs font-medium">
                            {log.tenant.name}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">System</span>
                        )}
                      </TableCell>
                      <TableCell>{renderDetailsTooltip(log.details)}</TableCell>
                      <TableCell>
                        {log.actor ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs font-medium cursor-default">
                                {log.actor.name || log.actor.email}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">{log.actor.email}</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-xs text-muted-foreground">System</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-border/40">
                <p className="text-xs text-muted-foreground">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of{' '}
                  {totalCount.toLocaleString()}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground px-2 tabular-nums">
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
