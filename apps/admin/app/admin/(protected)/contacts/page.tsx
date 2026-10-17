'use client';

import { Badge } from '@/components/ui/badge';
import { Check, ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState, NoMatchState } from '@/components/admin/empty-state';
import { EnquiriesEmptyArt } from '@/components/admin/illustrations/scenes/enquiries';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import { FilterChip, FilterSection, FilterShell, FilterToggle } from '@/components/admin/filter-primitives';
import { FilterReveal } from '@/components/admin/overview-flip';
import { Inbox } from 'lucide-react';

interface ContactRequest {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  message: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

const CONTACT_STATUSES = ['pending', 'contacted', 'converted', 'rejected'] as const;
const CONTACT_STATUS_TONE: Record<string, 'warning' | 'info' | 'success' | 'destructive'> = {
  pending: 'warning',
  contacted: 'info',
  converted: 'success',
  rejected: 'destructive',
};

export default function ContactRequestsPage() {
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  /* Whether the filter panel is showing. Filters start hidden. */
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    loadRequests();
  }, [filter]);

  const loadRequests = async () => {
    try {
      let query = supabase
        .from('contact_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setRequests(data || []);
    } catch (error) {
      console.error('Error loading contact requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('contact_requests')
        .update({ status: newStatus })
        .eq('id', id);

      if (error) throw error;
      loadRequests();
    } catch (error: any) {
      toast.error(`Error updating status: ${error.message}`);
    }
  };

  if (loading) {
    return (
      <TableSkeleton
        rows={5}
        columns={7}
        title="Contact Requests"
        subtitle="Manage inquiries from potential rental companies"
        showButton={false}
      />
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Contact Requests</h1>
        <p className="mt-2 text-muted-foreground">Manage inquiries from potential rental companies</p>
      </div>

      {/* Five status buttons used to sit here permanently. This page has
          nothing to search, so the toggle stands on its own row rather than
          inside a field — the panel it opens is the same one every other list
          in this app uses. */}
      <div className="mb-6 space-y-3">
        <FilterToggle
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          activeCount={filter !== 'all' ? 1 : 0}
          standalone
        />

        <FilterReveal open={filtersOpen}>
          <FilterShell
            activeCount={filter !== 'all' ? 1 : 0}
            onClear={() => setFilter('all')}
            onClose={() => setFiltersOpen(false)}
          >
            <FilterSection
              icon={<Inbox className="size-3 text-primary" />}
              tint="bg-primary/10"
              title="Status"
            >
              <div className="flex flex-wrap gap-1.5">
                {['all', 'pending', 'contacted', 'converted', 'rejected'].map((status) => (
                  <FilterChip
                    key={status}
                    active={filter === status}
                    onClick={() => setFilter(status)}
                  >
                    <span className="capitalize">{status === 'all' ? 'Any status' : status}</span>
                  </FilterChip>
                ))}
              </div>
            </FilterSection>
          </FilterShell>
        </FilterReveal>
      </div>

      {/* `overflow-x-auto`, not `overflow-hidden`: this table is wider than a
          phone and the card was CLIPPING the columns past the fold with no way
          to reach them. Any non-visible overflow still rounds the corners. */}
      <div className="overflow-x-auto rounded-4xl bg-card shadow-sm ring-1 ring-foreground/10">
        <table className="min-w-full divide-y divide-dark-border">
          <thead className="bg-card/95">
            <tr>
              <th className="h-10 whitespace-nowrap px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Company
              </th>
              <th className="h-10 whitespace-nowrap px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Contact
              </th>
              <th className="h-10 whitespace-nowrap px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Email
              </th>
              <th className="h-10 whitespace-nowrap px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Phone
              </th>
              <th className="h-10 whitespace-nowrap px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </th>
              <th className="h-10 whitespace-nowrap px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Submitted
              </th>
              <th className="h-10 whitespace-nowrap px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-dark-card divide-y divide-dark-border">
            {requests.map((request) => (
              <tr key={request.id} className="hover:bg-[hsl(var(--v2-row-hover,var(--muted)_/_0.5))]">
                <td className="px-3 py-3">
                  <div className="text-sm font-medium text-foreground">{request.company_name}</div>
                  {request.message && (
                    <div className="text-xs text-muted-foreground mt-1 max-w-xs truncate">
                      {request.message}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="text-sm text-muted-foreground">{request.contact_name}</div>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <a href={`mailto:${request.email}`} className="text-sm text-primary hover:text-primary">
                    {request.email}
                  </a>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="text-sm text-muted-foreground">{request.phone || '-'}</div>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
{/* Coloured text, not a boxed select — the status reads like every
                      other status in a table; it opens its own menu. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="group/pill inline-flex items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
                        <Badge variant={CONTACT_STATUS_TONE[request.status] ?? 'destructive'} className="cursor-pointer gap-1 capitalize">
                          {request.status}
                          <ChevronDown className="h-3 w-3 opacity-60 transition-opacity group-hover/pill:opacity-100" />
                        </Badge>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-40">
                      {CONTACT_STATUSES.map((status) => (
                        <DropdownMenuItem
                          key={status}
                          onClick={() => handleUpdateStatus(request.id, status)}
                          className="cursor-pointer capitalize"
                        >
                          <span className="flex-1">{status}</span>
                          {request.status === status && <Check className="h-4 w-4 text-primary" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-sm text-muted-foreground">
                  {new Date(request.created_at).toLocaleDateString('en-US')}
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-sm">
                  <button className="text-primary hover:text-primary">View Details</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {requests.length === 0 && (
          <EmptyState
            illustration={<EnquiriesEmptyArt />}
            headline="No contact requests yet"
            body="When someone fills in the contact form on drive-247.com, their message lands here."
          />
        )}
      </div>
    </div>
  );
}
