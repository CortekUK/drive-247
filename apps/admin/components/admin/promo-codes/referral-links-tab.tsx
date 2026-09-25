'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, Link2, Loader2, Pencil, Power, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/sonner';
import { FilterChip, FilterSearch, FilterSection, FilterShell } from '@/components/admin/filter-primitives';
import { FilterReveal } from '@/components/admin/overview-flip';
import { promoApi, type PromoCode } from './api';
import { CopyValue } from './shared';
import { CodeTermsDialog } from './codes-tab';
import { OperatorReferralView } from './operator-view';
import { AttachReferralDialog } from './referral-dialogs';

type Status = 'all' | 'active' | 'inactive' | 'superseded';

/**
 * Every operator's referral link, in one list.
 *
 * View opens that operator's referral set-up — their terms, tiers and who they
 * referred — which is where a referral is attached or voided by hand.
 */
export function ReferralLinksTab({
  canEdit, viewing, onView,
}: {
  canEdit: boolean;
  /** Tenant whose set-up is open, or null for the list. Held by the page so the leaderboard can open one. */
  viewing: string | null;
  onView: (tenantId: string | null) => void;
}) {
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>('active');
  const [search, setSearch] = useState('');
  /* Whether the filter panel is showing. Filters start hidden. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  /* 'active' is the default view, so it is not counted as a narrowing. */
  const activeFilterCount = (status !== 'active' ? 1 : 0) + (search.trim() ? 1 : 0);
  const [editing, setEditing] = useState<PromoCode | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await promoApi<{ codes: PromoCode[] }>('list', {
        kind: 'referral',
        ...(status !== 'all' ? { status } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      });
      setCodes(res.codes);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    if (viewing) return; // the set-up loads its own data
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search, viewing]);

  const toggle = async (c: PromoCode) => {
    setBusyId(c.id);
    try {
      await promoApi('set_status', { id: c.id, status: c.status === 'active' ? 'inactive' : 'active' });
      toast.success(c.status === 'active' ? `${c.code} switched off` : `${c.code} switched on`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (viewing) {
    return <OperatorReferralView tenantId={viewing} canEdit={canEdit} onBack={() => onView(null)} />;
  }

  return (
    <div className="space-y-4">
      {/* Same surface as the Codes tab beside it, and as every list page. */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterSearch
          value={search}
          onChange={setSearch}
          placeholder="NORTHWIND, KEYWAY…"
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          activeCount={activeFilterCount}
          className="min-w-[200px] flex-1"
        />
        <Button variant="outline" size="icon" onClick={load} aria-label="Reload"><RefreshCw className="h-4 w-4" /></Button>
        {canEdit && (
          <Button className="gap-1.5" onClick={() => setAttaching(true)}><Link2 className="h-4 w-4" /> Attach referral</Button>
        )}
      </div>

      <FilterReveal open={filtersOpen}>
        <FilterShell
          activeCount={activeFilterCount}
          onClear={() => { setStatus('active'); setSearch(''); }}
          onClose={() => setFiltersOpen(false)}
        >
          <FilterSection
            icon={<Power className="size-3 text-primary" />}
            tint="bg-primary/10"
            title="Status"
          >
            <div className="flex flex-wrap gap-1.5">
              {([
                ['active', 'Active'],
                ['inactive', 'Switched off'],
                ['superseded', 'Old versions'],
                ['all', 'All'],
              ] as const).map(([value, label]) => (
                <FilterChip key={value} active={status === value} onClick={() => setStatus(value)}>
                  {label}
                </FilterChip>
              ))}
            </div>
          </FilterSection>
        </FilterShell>
      </FilterReveal>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>New operator gets</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
              ) : codes.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No referral links match.</TableCell></TableRow>
              ) : codes.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="min-w-[220px]">
                    <div className="space-y-1.5">
                      <span className="font-mono text-sm font-semibold">{c.code}</span>
                      {c.link && c.status === 'active' && <CopyValue value={c.link} label="Link" className="py-1" />}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{c.ownerName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-sm">
                    {c.discountText} <span className="text-muted-foreground">{c.durationText}</span>
                  </TableCell>
                  <TableCell className="text-sm">{c.redemptions ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === 'active' ? 'success' : c.status === 'inactive' ? 'warning' : 'outline'}>
                      {c.status === 'active' ? 'Active' : c.status === 'inactive' ? 'Off' : 'Old version'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canEdit && c.status === 'active' && (
                        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(c)}>
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                      )}
                      {canEdit && c.status !== 'superseded' && (
                        <Button variant="ghost" size="sm" className="gap-1.5" disabled={busyId === c.id} onClick={() => toggle(c)}>
                          {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                          {c.status === 'active' ? 'Switch off' : 'Switch on'}
                        </Button>
                      )}
                      {c.owner_tenant_id && (
                        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onView(c.owner_tenant_id)}>
                          <Eye className="h-3.5 w-3.5" /> View
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && (
        <CodeTermsDialog code={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />
      )}
      {attaching && (
        <AttachReferralDialog onClose={() => setAttaching(false)} onDone={async () => { setAttaching(false); await load(); }} />
      )}
    </div>
  );
}
