'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Rocket,
  Search,
  ArrowRight,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MessageSquare,
  RotateCcw,
  Loader2,
} from 'lucide-react';

interface GoLiveRequest {
  id: string;
  tenant_id: string;
  requested_by: string;
  integration_type: string;
  status: string;
  note: string | null;
  admin_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  tenant_name?: string;
  tenant_slug?: string;
  requester_name?: string;
  requester_email?: string;
}

const integrationLabels: Record<string, string> = {
  stripe_connect: 'Stripe Connect',
  bonzah: 'Bonzah Insurance',
  boldsign: 'BoldSign E-Sign',
  credits_test: 'Test Credits',
};

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';

function getStatusBadge(status: string): { variant: BadgeVariant; label: string; icon: React.ReactNode } {
  switch (status) {
    case 'approved':
      return { variant: 'success', label: 'Approved', icon: <CheckCircle2 className="h-3 w-3" /> };
    case 'rejected':
      return { variant: 'destructive', label: 'Rejected', icon: <XCircle className="h-3 w-3" /> };
    case 'pending':
    default:
      return { variant: 'warning', label: 'Pending', icon: <Clock className="h-3 w-3" /> };
  }
}

function getIntegrationBadge(type: string): { variant: BadgeVariant; label: string } {
  switch (type) {
    case 'stripe_connect':
      return { variant: 'info', label: 'Stripe Connect' };
    case 'bonzah':
      return { variant: 'default', label: 'Bonzah Insurance' };
    case 'boldsign':
      return { variant: 'secondary', label: 'BoldSign E-Sign' };
    case 'credits_test':
      return { variant: 'warning', label: 'Test Credits' };
    default:
      return { variant: 'outline', label: integrationLabels[type] || type };
  }
}

export default function RequestsPage() {
  const [requests, setRequests] = useState<GoLiveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    requestId: string;
    newStatus: string;
    tenantName: string;
    integration: string;
  }>({
    open: false,
    requestId: '',
    newStatus: '',
    tenantName: '',
    integration: '',
  });

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('go_live_requests')
        .select(`
          *,
          tenants:tenant_id (company_name, slug),
          requester:requested_by (name, email)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mapped = (data || []).map((r: any) => ({
        ...r,
        tenant_name: r.tenants?.company_name || 'Unknown',
        tenant_slug: r.tenants?.slug,
        requester_name: r.requester?.name || 'Unknown',
        requester_email: r.requester?.email,
      }));

      setRequests(mapped);
    } catch (error) {
      console.error('Error loading mode requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    setUpdatingId(id);
    try {
      const { error } = await supabase
        .from('go_live_requests')
        .update({
          status: newStatus,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;
      toast.success(`Request ${newStatus} successfully`);
      loadRequests();
    } catch (error: any) {
      toast.error(`Error updating request: ${error.message}`);
    } finally {
      setUpdatingId(null);
      setConfirmDialog((prev) => ({ ...prev, open: false }));
    }
  };

  const openConfirm = (request: GoLiveRequest, newStatus: string) => {
    setConfirmDialog({
      open: true,
      requestId: request.id,
      newStatus,
      tenantName: request.tenant_name || 'Unknown',
      integration: integrationLabels[request.integration_type] || request.integration_type,
    });
  };

  // Derived
  const filteredRequests = requests.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.tenant_name?.toLowerCase().includes(q) ||
      r.requester_name?.toLowerCase().includes(q) ||
      r.requester_email?.toLowerCase().includes(q) ||
      r.integration_type.toLowerCase().includes(q)
    );
  });

  const pendingCount = requests.filter((r) => r.status === 'pending').length;
  const approvedCount = requests.filter((r) => r.status === 'approved').length;
  const rejectedCount = requests.filter((r) => r.status === 'rejected').length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15 glow-purple-sm">
            <Rocket className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Mode Requests</h1>
            <p className="text-sm text-muted-foreground">
              Manage tenant requests to switch integration modes ·{' '}
              <span className="tabular-nums">{requests.length}</span> total
              {pendingCount > 0 && (
                <span className="text-warning"> · {pendingCount} pending</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card
          className={cn(
            'cursor-pointer transition-all',
            filter === 'pending' && 'border-warning/40 bg-warning/5'
          )}
          onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold tabular-nums">{pendingCount}</p>
              </div>
              <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-warning/15">
                <Clock className="h-5 w-5 text-warning" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={cn(
            'cursor-pointer transition-all',
            filter === 'approved' && 'border-success/40 bg-success/5'
          )}
          onClick={() => setFilter(filter === 'approved' ? 'all' : 'approved')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Approved</p>
                <p className="text-2xl font-bold tabular-nums">{approvedCount}</p>
              </div>
              <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-success/15">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={cn(
            'cursor-pointer transition-all',
            filter === 'rejected' && 'border-destructive/40 bg-destructive/5'
          )}
          onClick={() => setFilter(filter === 'rejected' ? 'all' : 'rejected')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Rejected</p>
                <p className="text-2xl font-bold tabular-nums">{rejectedCount}</p>
              </div>
              <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-destructive/15">
                <XCircle className="h-5 w-5 text-destructive" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by tenant, requester, or integration..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="flex items-center gap-1.5">
              {(['all', 'pending', 'approved', 'rejected'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  className={cn(
                    'px-3 py-2 rounded-md text-xs font-semibold transition-all capitalize border',
                    filter === status
                      ? status === 'pending'
                        ? 'bg-warning/15 text-amber-400 border-warning/30'
                        : status === 'approved'
                        ? 'bg-success/15 text-emerald-400 border-success/30'
                        : status === 'rejected'
                        ? 'bg-destructive/15 text-red-400 border-destructive/30'
                        : 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-secondary text-muted-foreground border-transparent hover:bg-secondary/80'
                  )}
                >
                  {status}
                </button>
              ))}

              {(filter !== 'all' || searchQuery) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setFilter('all'); setSearchQuery(''); }}
                  className="gap-1.5 ml-1"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            {filter === 'all' ? 'All Requests' : `${filter.charAt(0).toUpperCase() + filter.slice(1)} Requests`}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {loading ? (
            <div className="space-y-3 px-6 pb-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-5 w-28 rounded-full" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-28 ml-auto" />
                </div>
              ))}
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Rocket className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                {filter !== 'all'
                  ? `No ${filter} requests found`
                  : searchQuery
                  ? 'No requests match your search'
                  : 'No mode requests yet'}
              </p>
              {(filter !== 'all' || searchQuery) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setFilter('all'); setSearchQuery(''); }}
                  className="mt-2"
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-primary/5 hover:bg-primary/5">
                  <TableHead>Tenant</TableHead>
                  <TableHead className="w-[160px]">Integration</TableHead>
                  <TableHead className="w-[180px]">Requested By</TableHead>
                  <TableHead className="w-[140px]">Status</TableHead>
                  <TableHead className="w-[130px]">Submitted</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRequests.map((request) => {
                  const statusBadge = getStatusBadge(request.status);
                  const integrationBadge = getIntegrationBadge(request.integration_type);

                  return (
                    <TableRow key={request.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div>
                            <span className="font-medium">{request.tenant_name}</span>
                            {request.note && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button className="ml-1.5 inline-flex">
                                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-xs">
                                  <p className="text-xs">{request.note}</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={integrationBadge.variant} className="text-[11px] whitespace-nowrap">
                          {integrationBadge.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div>
                          <span className="text-sm font-medium">{request.requester_name}</span>
                          {request.requester_email && (
                            <p className="text-xs text-muted-foreground">{request.requester_email}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={request.status}
                          onValueChange={(value) => openConfirm(request, value)}
                        >
                          <SelectTrigger className={cn(
                            'h-7 w-[120px] text-xs font-medium border',
                            request.status === 'pending' && 'border-warning/30 text-warning bg-warning/5',
                            request.status === 'approved' && 'border-success/30 text-success bg-success/5',
                            request.status === 'rejected' && 'border-destructive/30 text-destructive bg-destructive/5',
                          )}>
                            <div className="flex items-center gap-1.5">
                              {statusBadge.icon}
                              <SelectValue />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        {new Date(request.created_at).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                          <Link href={`/admin/rentals/${request.tenant_id}`}>
                            View
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Confirm Dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className={cn(
                'h-5 w-5',
                confirmDialog.newStatus === 'approved' ? 'text-success' : confirmDialog.newStatus === 'rejected' ? 'text-destructive' : 'text-warning'
              )} />
              Confirm Status Change
            </DialogTitle>
            <DialogDescription>
              {confirmDialog.newStatus === 'approved'
                ? `Approve ${confirmDialog.tenantName}'s request to go live with ${confirmDialog.integration}?`
                : confirmDialog.newStatus === 'rejected'
                ? `Reject ${confirmDialog.tenantName}'s request for ${confirmDialog.integration}?`
                : `Change ${confirmDialog.tenantName}'s ${confirmDialog.integration} request back to pending?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialog((prev) => ({ ...prev, open: false }))}
              disabled={!!updatingId}
            >
              Cancel
            </Button>
            <Button
              variant={confirmDialog.newStatus === 'rejected' ? 'destructive' : 'default'}
              onClick={() => handleUpdateStatus(confirmDialog.requestId, confirmDialog.newStatus)}
              disabled={!!updatingId}
              className={confirmDialog.newStatus === 'approved' ? 'bg-success hover:bg-success/90' : ''}
            >
              {updatingId ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Updating...
                </>
              ) : (
                `${confirmDialog.newStatus.charAt(0).toUpperCase() + confirmDialog.newStatus.slice(1)} Request`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
