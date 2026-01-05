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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronUp } from 'lucide-react';
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
    <div className="space-y-4 md:space-y-6 p-4 md:p-6">
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
          <h1 className="text-2xl md:text-3xl font-bold mt-2">
            Global Blacklist
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Customers blocked by 3+ rental companies across the platform
          </p>
        </div>
      </div>

      {/* Info Banner */}
      <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900">
        <AlertDescription className="text-amber-800 dark:text-amber-200">
          <strong>Platform-wide protection:</strong> When a customer is blocked by 3 or more rental companies,
          they are automatically added here and cannot book with <em>any</em> company on the platform.
        </AlertDescription>
      </Alert>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        <Card className="p-4 md:p-6">
          <div className="text-2xl md:text-3xl font-bold text-destructive">
            {isLoading ? <Skeleton className="h-8 w-12" /> : totalBlacklisted}
          </div>
          <div className="text-xs md:text-sm text-muted-foreground mt-1">
            Blacklisted Customers
          </div>
        </Card>
        <Card className="p-4 md:p-6">
          <div className="text-2xl md:text-3xl font-bold text-orange-600">
            {isLoading ? <Skeleton className="h-8 w-12" /> : totalBlockingCompanies}
          </div>
          <div className="text-xs md:text-sm text-muted-foreground mt-1">
            Total Blocks
          </div>
        </Card>
        <Card className="p-4 md:p-6">
          <div className="text-2xl md:text-3xl font-bold text-blue-600">
            {isLoading ? <Skeleton className="h-8 w-12" /> : recentBlocks}
          </div>
          <div className="text-xs md:text-sm text-muted-foreground mt-1">
            Last 30 Days
          </div>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <Input
          placeholder="Search by email, company name, or reason..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1"
        />
      </div>

      {/* Blacklist Table */}
      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-lg md:text-xl">
            Blacklisted Customers
          </CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Click on a row to view blocking details from each company
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6 pt-0">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center space-x-4 p-4 border rounded-lg">
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-[200px]" />
                    <Skeleton className="h-3 w-[150px]" />
                  </div>
                  <Skeleton className="h-6 w-20" />
                </div>
              ))}
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription>
                Failed to load blacklist. Please try again later.
              </AlertDescription>
            </Alert>
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
                              <Badge variant="destructive" className="text-xs">
                                {entry.blocked_tenant_count} blocks
                              </Badge>
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
              <div className="hidden md:block rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Email</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">First Blocked</TableHead>
                      <TableHead className="font-semibold">Last Blocked</TableHead>
                      <TableHead className="font-semibold">Details</TableHead>
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
                            <TableRow className="cursor-pointer hover:bg-muted/50 transition-colors">
                              <TableCell className="font-medium">
                                {entry.email}
                              </TableCell>
                              <TableCell>
                                <Badge variant="destructive">
                                  {entry.blocked_tenant_count} companies
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {entry.first_blocked_at
                                  ? format(new Date(entry.first_blocked_at), 'MMM d, yyyy')
                                  : '-'}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
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
            <div className="text-center py-12">
              <h3 className="text-lg font-medium">No Blacklisted Customers</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                {searchTerm
                  ? 'No results match your search. Try a different term.'
                  : 'Customers will appear here when blocked by 3 or more rental companies on the platform.'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
