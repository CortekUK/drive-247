'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tile,
  KpiTile,
  TableTile,
  bentoTable,
  StatusPill,
  EmptyState,
  ErrorState,
  TableSkeleton,
  KpiTileSkeletonRow,
} from '@/components/bento';
import { ChevronDown, ChevronUp, ShieldX, Search } from 'lucide-react';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';

interface BlockingTenant {
  tenant_id: string;
  tenant_name: string;
  reason: string;
  blocked_at: string;
}

interface GlobalBlacklistEntry {
  id: string;
  email: string;
  blocked_tenant_count: number;
  first_blocked_at: string;
  last_blocked_at: string;
  created_at: string;
  blocking_tenants: BlockingTenant[];
}

export default function GlobalBlacklistPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Fetch global blacklist with tenant details
  const { data: blacklist, isLoading, error } = useQuery({
    queryKey: ['global-blacklist'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_global_blacklist_details')
        .select('*')
        .order('last_blocked_at', { ascending: false });

      if (error) throw error;
      return data as GlobalBlacklistEntry[];
    },
  });

  // Filter blacklist by search term
  const filteredBlacklist = blacklist?.filter(entry =>
    entry.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.blocking_tenants?.some(t =>
      t.tenant_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.reason?.toLowerCase().includes(searchTerm.toLowerCase())
    )
  ) || [];

  // Stats
  const totalBlacklisted = blacklist?.length || 0;
  const totalBlockingCompanies = blacklist?.reduce((acc, entry) => acc + entry.blocked_tenant_count, 0) || 0;
  const recentBlocks = blacklist?.filter(entry => {
    if (!entry.last_blocked_at) return false;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return new Date(entry.last_blocked_at) > thirtyDaysAgo;
  }).length || 0;

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  return (
    <div className="container mx-auto space-y-4 md:space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/settings?tab=blacklist')}
            >
              ← Back
            </Button>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-2">
            Global Blacklist
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Customers blocked by 3+ rental companies across the platform
          </p>
        </div>
      </div>

      {/* Info Banner */}
      <Tile variant="warn" pad="default">
        <p className="text-sm [color:var(--bento-warn-fg)]">
          <strong>Platform-wide protection:</strong> When a customer is blocked by 3 or more rental companies,
          they are automatically added here and cannot book with <em>any</em> company on the platform.
        </p>
      </Tile>

      {/* Stats Cards */}
      {isLoading ? (
        <KpiTileSkeletonRow count={3} />
      ) : (
        <div className="grid grid-cols-3 gap-3 md:gap-4">
          <KpiTile label="Blacklisted Customers" value={totalBlacklisted} variant="warn" icon={<ShieldX className="h-4 w-4" />} />
          <KpiTile label="Total Blocks" value={totalBlockingCompanies} />
          <KpiTile label="Last 30 Days" value={recentBlocks} />
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by email, company name, or reason..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Blacklist Table */}
      <TableTile
        toolbar={
          <div>
            <h2 className="text-base font-bold tracking-tight">Blacklisted Customers</h2>
            <p className="text-xs text-muted-foreground">Click on a row to view blocking details from each company</p>
          </div>
        }
      >
        <div className="p-4 md:p-5 pt-0 md:pt-0">
          {isLoading ? (
            <TableSkeleton rows={4} cols={5} />
          ) : error ? (
            <ErrorState
              title="Failed to load blacklist"
              description="Please try again later."
            />
          ) : filteredBlacklist.length > 0 ? (
            <>
              {/* Mobile Card View */}
              <div className="md:hidden space-y-3">
                {filteredBlacklist.map((entry) => (
                  <Collapsible
                    key={entry.id}
                    open={expandedRows.has(entry.id)}
                    onOpenChange={() => toggleRow(entry.id)}
                  >
                    <div className="border rounded-lg overflow-hidden">
                      <CollapsibleTrigger asChild>
                        <div className="p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="font-medium text-sm">{entry.email}</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                Last blocked: {entry.last_blocked_at
                                  ? format(new Date(entry.last_blocked_at), 'MMM d, yyyy')
                                  : '-'}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusPill tone="danger">
                                {entry.blocked_tenant_count} blocks
                              </StatusPill>
                              {expandedRows.has(entry.id) ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-4 pb-4 pt-0 border-t bg-muted/30">
                          <div className="pt-3 space-y-3">
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Blocking Companies
                            </div>
                            {entry.blocking_tenants && entry.blocking_tenants.length > 0 ? (
                              <div className="space-y-2">
                                {entry.blocking_tenants.map((tenant, idx) => (
                                  <div
                                    key={idx}
                                    className="p-3 bg-background rounded-md border text-sm"
                                  >
                                    <div className="font-medium">
                                      {tenant.tenant_name || 'Unknown Company'}
                                    </div>
                                    <div className="text-muted-foreground mt-1 text-xs">
                                      Reason: {tenant.reason || 'No reason provided'}
                                    </div>
                                    <div className="text-muted-foreground mt-1 text-xs">
                                      Blocked: {tenant.blocked_at
                                        ? format(new Date(tenant.blocked_at), 'MMM d, yyyy')
                                        : '-'}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">No details available</p>
                            )}
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                ))}
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block rounded-tile-sm border border-border overflow-hidden">
                <Table>
                  <TableHeader className={bentoTable.header}>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>First Blocked</TableHead>
                      <TableHead>Last Blocked</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBlacklist.map((entry) => (
                      <Collapsible
                        key={entry.id}
                        open={expandedRows.has(entry.id)}
                        onOpenChange={() => toggleRow(entry.id)}
                        asChild
                      >
                        <>
                          <CollapsibleTrigger asChild>
                            <TableRow className="cursor-pointer border-border transition-colors hover:bg-[color:var(--bento-tile-2)]">
                              <TableCell className="font-semibold font-mono text-xs">
                                {entry.email}
                              </TableCell>
                              <TableCell>
                                <StatusPill tone="danger" dot>
                                  {entry.blocked_tenant_count} companies
                                </StatusPill>
                              </TableCell>
                              <TableCell className="text-muted-foreground font-mono text-xs tabular-nums">
                                {entry.first_blocked_at
                                  ? format(new Date(entry.first_blocked_at), 'MMM d, yyyy')
                                  : '-'}
                              </TableCell>
                              <TableCell className="text-muted-foreground font-mono text-xs tabular-nums">
                                {entry.last_blocked_at
                                  ? format(new Date(entry.last_blocked_at), 'MMM d, yyyy')
                                  : '-'}
                              </TableCell>
                              <TableCell>
                                <Button variant="ghost" size="sm" className="gap-1">
                                  {expandedRows.has(entry.id) ? (
                                    <>
                                      <ChevronUp className="h-4 w-4" />
                                      Hide
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown className="h-4 w-4" />
                                      Show
                                    </>
                                  )}
                                </Button>
                              </TableCell>
                            </TableRow>
                          </CollapsibleTrigger>
                          <CollapsibleContent asChild>
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableCell colSpan={5} className="p-0">
                                <div className="p-4 space-y-3">
                                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                    Blocking Companies
                                  </div>
                                  {entry.blocking_tenants && entry.blocking_tenants.length > 0 ? (
                                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                                      {entry.blocking_tenants.map((tenant, idx) => (
                                        <div
                                          key={idx}
                                          className="p-3 bg-background rounded-lg border shadow-sm"
                                        >
                                          <div className="font-medium text-sm">
                                            {tenant.tenant_name || 'Unknown Company'}
                                          </div>
                                          <div className="mt-2 text-sm text-muted-foreground">
                                            <span className="font-medium text-foreground">Reason:</span>{' '}
                                            {tenant.reason || 'No reason provided'}
                                          </div>
                                          <div className="mt-1 text-xs text-muted-foreground">
                                            Blocked: {tenant.blocked_at
                                              ? format(new Date(tenant.blocked_at), 'MMM d, yyyy')
                                              : 'Date unknown'}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-sm text-muted-foreground">No details available</p>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          </CollapsibleContent>
                        </>
                      </Collapsible>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<ShieldX className="h-5 w-5" />}
              title="No Blacklisted Customers"
              description={
                searchTerm
                  ? 'No results match your search. Try a different term.'
                  : 'Customers will appear here when blocked by 3 or more rental companies on the platform.'
              }
            />
          )}
        </div>
      </TableTile>
    </div>
  );
}
