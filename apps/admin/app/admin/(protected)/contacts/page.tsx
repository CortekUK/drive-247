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
        <h1 className="text-3xl font-bold text-white">Contact Requests</h1>
        <p className="mt-2 text-gray-400">Manage inquiries from potential rental companies</p>
      </div>

      <div className="mb-6 flex space-x-2">
        {['all', 'pending', 'contacted', 'converted', 'rejected'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-lg font-medium capitalize ${
              filter === status
                ? 'bg-primary-600 text-white'
                : 'bg-dark-card text-gray-300 hover:bg-dark-hover border border-dark-border'
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
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Company
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Contact
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Phone
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Submitted
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-dark-card divide-y divide-dark-border">
            {requests.map((request) => (
              <tr key={request.id} className="hover:bg-dark-hover">
                <td className="px-6 py-4">
                  <div className="text-sm font-medium text-white">{request.company_name}</div>
                  {request.message && (
                    <div className="text-xs text-gray-500 mt-1 max-w-xs truncate">
                      {request.message}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-300">{request.contact_name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <a href={`mailto:${request.email}`} className="text-sm text-primary-400 hover:text-primary-300">
                    {request.email}
                  </a>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-400">{request.phone || '-'}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <select
                    value={request.status}
                    onChange={(e) => handleUpdateStatus(request.id, e.target.value)}
                    className={`text-xs rounded-full px-3 py-1 font-semibold bg-dark-bg border ${
                      request.status === 'pending' ? 'border-yellow-700 text-yellow-400' :
                      request.status === 'contacted' ? 'border-blue-700 text-blue-400' :
                      request.status === 'converted' ? 'border-green-700 text-green-400' :
                      'border-red-700 text-red-400'
                    }`}
                  >
                    <option value="pending">Pending</option>
                    <option value="contacted">Contacted</option>
                    <option value="converted">Converted</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                  {new Date(request.created_at).toLocaleDateString('en-US')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button className="text-primary-400 hover:text-primary-300">View Details</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {requests.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400">No contact requests found.</p>
          </div>
        )}
      </div>
    </div>
  );
}
