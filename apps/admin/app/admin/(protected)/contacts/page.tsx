'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';

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
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Contact Requests</h1>
        <p className="mt-2 text-muted-foreground">Manage inquiries from potential rental companies</p>
      </div>

      <div className="mb-6 flex space-x-2">
        {['all', 'pending', 'contacted', 'converted', 'rejected'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-lg font-medium capitalize ${
              filter === status
                ? 'bg-primary text-primary-foreground'
                : 'bg-dark-card text-muted-foreground hover:bg-dark-hover border border-dark-border'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      <div className="bg-dark-card rounded-lg shadow overflow-hidden border border-dark-border">
        <table className="min-w-full divide-y divide-dark-border">
          <thead className="bg-dark-bg">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Company
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Contact
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Phone
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Submitted
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
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
