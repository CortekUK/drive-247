'use client';

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
      <div className="mb-8">
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
          <thead className="bg-dark-bg">
            <tr>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Company
              </th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Contact
              </th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Email
              </th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Phone
              </th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Submitted
              </th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-dark-card divide-y divide-dark-border">
            {requests.map((request) => (
              <tr key={request.id} className="hover:bg-dark-hover">
                <td className="px-6 py-4">
                  <div className="text-sm font-medium text-foreground">{request.company_name}</div>
                  {request.message && (
                    <div className="text-xs text-muted-foreground mt-1 max-w-xs truncate">
                      {request.message}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-muted-foreground">{request.contact_name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <a href={`mailto:${request.email}`} className="text-sm text-primary hover:text-primary">
                    {request.email}
                  </a>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-muted-foreground">{request.phone || '-'}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <select
                    value={request.status}
                    onChange={(e) => handleUpdateStatus(request.id, e.target.value)}
                    className={`text-xs rounded-full px-3 py-1 font-semibold bg-dark-bg border ${
                      request.status === 'pending' ? 'border-yellow-700 text-yellow-600' :
                      request.status === 'contacted' ? 'border-blue-700 text-blue-600' :
                      request.status === 'converted' ? 'border-green-700 text-green-600' :
                      'border-red-700 text-red-600'
                    }`}
                  >
                    <option value="pending">Pending</option>
                    <option value="contacted">Contacted</option>
                    <option value="converted">Converted</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                  {new Date(request.created_at).toLocaleDateString('en-US')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button className="text-primary hover:text-primary">View Details</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {requests.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No contact requests found.</p>
          </div>
        )}
      </div>
    </div>
  );
}
