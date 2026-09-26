'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { CreditCard, Search, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { loadBillingIndex, loadPickerTenants } from '@/lib/announcements/api';
import {
  DEFAULT_PICKER_FILTERS,
  STATUS_FILTER_OPTIONS,
  SUBSCRIPTION_FILTER_OPTIONS,
  SUB_STATUS_META,
  TYPE_FILTER_OPTIONS,
  clearMatching,
  filterPickerTenants,
  readFavoriteTenantIds,
  selectAllMatching,
  subStatusFor,
  summarizeSelection,
  toggleSelected,
  type BillingIndex,
  type PickerTenant,
  type SubscriptionFilter,
  type TenantPickerFilters,
} from '@/lib/announcements/tenant-filters';
import { cn } from '@/lib/utils';
import { QUIET_BUTTON } from './form-field';

type TenantsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tenants: PickerTenant[] };

type BillingState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; index: BillingIndex };

/** Same pill look as the Rental Companies filters. */
function pillClass(active: boolean, tone: 'primary' | 'sky' | 'amber' | 'emerald' | 'destructive') {
  const on = {
    primary: 'bg-primary/15 text-primary border-primary/30',
    sky: 'bg-sky-500/15 text-sky-600 border-sky-500/30',
    amber: 'bg-warning/15 text-amber-600 border-warning/30',
    emerald: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
    destructive: 'bg-destructive/15 text-destructive border-destructive/30',
  }[tone];
  return cn(
    'cursor-pointer rounded-md border px-3 py-2 text-xs font-semibold transition-colors',
    active ? on : 'border-transparent bg-secondary text-muted-foreground hover:bg-indigo-50 dark:hover:bg-indigo-500/15',
  );
}

/**
 * "Specific tenants": a multi-select over every tenant, with the Rental
 * Companies list's search and filters. Filtering is client-side over one read,
 * so "Select all matching" selects exactly what is on screen and keeps anything
 * already chosen that the filters now hide.
 */
export function TenantPickerDialog({
  open,
  initialSelected,
  returnFocusRef,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  initialSelected: readonly string[];
  /** Opened from code (no DialogTrigger): the control that gets focus back on close. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: (ids: string[], tenants: PickerTenant[]) => void;
}) {
  const [tenantsState, setTenantsState] = useState<TenantsState>({ status: 'loading' });
  const [billing, setBilling] = useState<BillingState>({ status: 'loading' });
  const [filters, setFilters] = useState<TenantPickerFilters>(DEFAULT_PICKER_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setTenantsState({ status: 'loading' });
    setBilling({ status: 'loading' });
    const [tenantsRes, billingRes] = await Promise.all([loadPickerTenants(), loadBillingIndex()]);
    if (mine !== seq.current) return;
    setTenantsState(tenantsRes.ok ? { status: 'ready', tenants: tenantsRes.data } : { status: 'error', message: tenantsRes.message });
    setBilling(billingRes.ok ? { status: 'ready', index: billingRes.data } : { status: 'error' });
    if (!billingRes.ok) console.warn('[announcements] tenant picker billing data unavailable:', billingRes.message);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(initialSelected));
    setFilters(DEFAULT_PICKER_FILTERS);
    setFavorites(readFavoriteTenantIds(typeof window === 'undefined' ? null : safeLocalStorage()));
    void load();
    return () => {
      seq.current += 1;
    };
    // initialSelected is read once per opening on purpose: edits inside the picker are local until "Use".
  }, [open, load]);

  const tenants = tenantsState.status === 'ready' ? tenantsState.tenants : [];
  const billingIndex = billing.status === 'ready' ? billing.index : null;
  const subStatusOf = useMemo(
    () => (billingIndex ? (tenantId: string) => subStatusFor(billingIndex, tenantId) : null),
    [billingIndex],
  );
  const matching = useMemo(
    () => filterPickerTenants(tenants, filters, favorites, subStatusOf),
    [tenants, filters, favorites, subStatusOf],
  );
  const matchingIds = useMemo(() => matching.map((t) => t.id), [matching]);
  const summary = summarizeSelection(selected, matchingIds);

  const patch = (next: Partial<TenantPickerFilters>) => setFilters((f) => ({ ...f, ...next }));

  const confirm = () => {
    const ids = Array.from(selected);
    onConfirm(ids, tenants.filter((t) => selected.has(t.id)));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        className="flex max-h-[92vh] w-[96vw] max-w-[880px] flex-col gap-0 overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const el = returnFocusRef?.current;
          if (el?.isConnected) el.focus();
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 pb-4 pt-5 text-left sm:px-6">
          <DialogTitle>Choose tenants</DialogTitle>
          <DialogDescription>Only the tenants you tick see this announcement.</DialogDescription>
        </DialogHeader>

        {/* Header and footer stay put. Filters, the selection bar and the list share
            this column: the list takes what is left and scrolls, and on a screen too
            short for the list's minimum the whole column scrolls instead, so
            "Use N tenants" is never pushed out of the dialog. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="shrink-0 space-y-3 border-b border-border px-5 py-4 sm:px-6">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
              <Input
                placeholder="Search by name, slug, or email..."
                value={filters.search}
                onChange={(e) => patch({ search: e.target.value })}
                className="border-primary/25 bg-primary/[0.07] pl-9 transition-colors hover:border-primary/40 hover:bg-primary/10 focus-visible:border-primary/50 focus-visible:bg-primary/10"
                aria-label="Search tenants"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={filters.favoritesOnly}
                onClick={() => patch({ favoritesOnly: !filters.favoritesOnly })}
                className={cn(pillClass(filters.favoritesOnly, 'amber'), 'flex items-center gap-1.5')}
              >
                <Star className={cn('h-3.5 w-3.5', filters.favoritesOnly && 'fill-amber-400')} />
                Favorites{favorites.size > 0 && ' (' + favorites.size + ')'}
              </button>
              <div className="hidden h-6 w-px bg-border sm:block" />
              <div className="flex items-center gap-1.5" role="group" aria-label="Type">
                {TYPE_FILTER_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={filters.type === o.value}
                    onClick={() => patch({ type: o.value })}
                    className={pillClass(
                      filters.type === o.value,
                      o.value === 'production' ? 'sky' : o.value === 'test' ? 'amber' : 'primary',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="hidden h-6 w-px bg-border sm:block" />
              <div className="flex items-center gap-1.5" role="group" aria-label="Status">
                {STATUS_FILTER_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={filters.status === o.value}
                    onClick={() => patch({ status: o.value })}
                    className={pillClass(
                      filters.status === o.value,
                      o.value === 'active' ? 'emerald' : o.value === 'suspended' ? 'destructive' : 'primary',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="flex min-w-[220px] flex-1 items-center gap-2 sm:flex-none">
                <Select
                  value={filters.subscription}
                  onValueChange={(v) => patch({ subscription: v as SubscriptionFilter })}
                  disabled={billing.status !== 'ready'}
                >
                  <SelectTrigger aria-label="Subscription" className="h-9 w-full sm:w-[230px]">
                    {/* A div, not a span: the trigger line-clamps its direct span children. */}
                    <div className="flex min-w-0 items-center gap-2">
                      <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <SelectValue />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {SUBSCRIPTION_FILTER_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {billing.status === 'error' && <p className="text-xs text-muted-foreground">Billing data unavailable</p>}
          </div>

          {tenantsState.status === 'ready' && (
            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-2.5 sm:px-6">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={summary.headerState === true}
                  indeterminate={summary.headerState === 'mixed'}
                  disabled={summary.matchingCount === 0}
                  onCheckedChange={(next) =>
                    setSelected((s) => (next ? selectAllMatching(s, matchingIds) : clearMatching(s, matchingIds)))
                  }
                  aria-label={'Select all ' + summary.matchingCount + ' matching'}
                />
                Select all {summary.matchingCount} matching
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn('h-8', QUIET_BUTTON)}
                disabled={summary.matchingSelectedCount === 0}
                onClick={() => setSelected((s) => clearMatching(s, matchingIds))}
              >
                Clear matching
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn('h-8', QUIET_BUTTON)}
                disabled={summary.selectedCount === 0}
                onClick={() => setSelected(new Set())}
              >
                Clear all
              </Button>
              <p className="ml-auto text-sm text-muted-foreground" aria-live="polite">
                <span className="font-semibold text-foreground">{summary.selectedCount} selected</span>
                {summary.hiddenSelectedCount > 0 && ' · ' + summary.hiddenSelectedCount + ' hidden by filters'}
              </p>
            </div>
          )}

          <div className="min-h-[240px] flex-1 overflow-y-auto">
            {tenantsState.status === 'loading' && (
              <div className="space-y-2 p-5 sm:px-6">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-xl" />
                ))}
              </div>
            )}
            {tenantsState.status === 'error' && (
              <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                <p className="text-sm text-destructive">{tenantsState.message}</p>
                <Button type="button" variant="outline" className={QUIET_BUTTON} onClick={() => void load()}>
                  Try again
                </Button>
              </div>
            )}
            {tenantsState.status === 'ready' && matching.length === 0 && (
              <p className="px-6 py-12 text-center text-sm text-muted-foreground">No tenants match these filters</p>
            )}
            {tenantsState.status === 'ready' && matching.length > 0 && (
              <ul className="divide-y divide-border">
                {matching.map((t) => {
                  const checked = selected.has(t.id);
                  const suspended = t.status === 'suspended';
                  const sub = subStatusOf ? SUB_STATUS_META[subStatusOf(t.id)] : null;
                  return (
                    <li key={t.id}>
                      <div
                        className={cn(
                          'flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5 transition-colors hover:bg-primary/5 sm:flex-nowrap sm:px-6',
                          checked && 'bg-primary/5',
                        )}
                        onClick={() => setSelected((s) => toggleSelected(s, t.id))}
                      >
                        {/* No onCheckedChange: the click (mouse, or Space on the focused
                            checkbox) bubbles to the row, which toggles exactly once. */}
                        <Checkbox checked={checked} aria-label={'Select ' + t.company_name} />
                        <div className="min-w-0 flex-1">
                          <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                            {favorites.has(t.id) && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-600" aria-label="Favorite" />}
                            <span className="truncate" title={t.company_name}>
                              {t.company_name}
                            </span>
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {t.slug}
                            {suspended && ' · Not reachable while suspended'}
                          </p>
                        </div>
                        <div className="flex w-full flex-wrap items-center gap-1.5 pl-7 sm:w-auto sm:flex-nowrap sm:justify-end sm:pl-0">
                          {t.tenant_type && (
                            <Badge variant={t.tenant_type === 'production' ? 'info' : 'warning'} className="whitespace-nowrap capitalize">
                              {t.tenant_type}
                            </Badge>
                          )}
                          <Badge
                            variant={t.status === 'active' ? 'success' : suspended ? 'destructive' : 'secondary'}
                            className="whitespace-nowrap capitalize"
                          >
                            {t.status}
                          </Badge>
                          {sub && (
                            <span
                              className={cn(
                                'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
                                sub.className,
                              )}
                            >
                              {sub.label}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border px-5 py-4 sm:space-x-0 sm:px-6">
          <Button type="button" variant="outline" className={QUIET_BUTTON} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={confirm} disabled={summary.selectedCount === 0}>
            Use {summary.selectedCount} {summary.selectedCount === 1 ? 'tenant' : 'tenants'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
