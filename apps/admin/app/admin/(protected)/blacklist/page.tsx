'use client';

import { Fragment, useEffect, useState } from 'react';
import { supabase, supabaseUrl } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';

interface BlockedCustomer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  tenant_id: string;
  tenant_name: string;
  blocked_reason: string | null;
  blocked_at: string | null;
  is_tenant_blocked: boolean;
  is_globally_blacklisted: boolean;
  is_whitelisted: boolean;
  blocked_identities: {
    identity_type: string;
    identity_number: string;
    reason: string | null;
  }[];
}

export default function BlacklistPage() {
  const [customers, setCustomers] = useState<BlockedCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<'whitelist' | 're-blacklist'>('whitelist');
  const [dialogEmail, setDialogEmail] = useState('');
  const [dialogReason, setDialogReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadBlockedCustomers();
  }, []);

  const loadBlockedCustomers = async () => {
    try {
      // Fetch all blocked customers across all tenants (super admin bypasses RLS)
      const { data: blockedCustomers, error: customersError } = await supabase
        .from('customers')
        .select('id, name, email, phone, tenant_id, blocked_reason, blocked_at, is_blocked')
        .eq('is_blocked', true)
        .order('blocked_at', { ascending: false });

      if (customersError) throw customersError;

      // Also fetch ALL global blacklist entries (these persist even after tenant unblock)
      const { data: allBlacklistEntries } = await supabase
        .from('global_blacklist')
        .select('email, is_whitelisted, first_blocked_at, blocked_tenant_count');

      const blacklistMap = new Map(
        allBlacklistEntries?.map((b) => [b.email, b]) || []
      );

      // Find globally blacklisted emails that are NOT in the blocked customers list
      const blockedEmails = new Set(blockedCustomers?.map((c) => c.email).filter(Boolean) || []);
      const blacklistOnlyEmails = (allBlacklistEntries || [])
        .filter((b) => !blockedEmails.has(b.email))
        .map((b) => b.email);

      // Fetch customer records for globally blacklisted emails not currently tenant-blocked
      let blacklistOnlyCustomers: any[] = [];
      if (blacklistOnlyEmails.length > 0) {
        const { data } = await supabase
          .from('customers')
          .select('id, name, email, phone, tenant_id, blocked_reason, blocked_at, is_blocked')
          .in('email', blacklistOnlyEmails);
        // Deduplicate by email (a customer may exist on multiple tenants)
        const seen = new Set<string>();
        blacklistOnlyCustomers = (data || []).filter((c) => {
          if (seen.has(c.email)) return false;
          seen.add(c.email);
          return true;
        });
      }

      const allCustomers = [...(blockedCustomers || []), ...blacklistOnlyCustomers];

      if (allCustomers.length === 0) {
        setCustomers([]);
        setLoading(false);
        return;
      }

      // Get tenant names
      const tenantIds = [...new Set(allCustomers.map((c) => c.tenant_id).filter(Boolean))];
      const { data: tenants } = await supabase
        .from('tenants')
        .select('id, company_name')
        .in('id', tenantIds);

      const tenantMap = new Map(tenants?.map((t) => [t.id, t.company_name]) || []);

      // Get blocked identities matching customer emails
      // (blocked_identities has no customer_id — it stores identity_number which could be email, license, etc.)
      const allEmails = allCustomers.map((c) => c.email).filter(Boolean);
      const { data: identities } = await supabase
        .from('blocked_identities')
        .select('identity_type, identity_number, reason, tenant_id')
        .in('identity_number', allEmails)
        .eq('is_active', true);

      // Map identities by email (identity_number) back to customer
      const identityByEmail = new Map<string, typeof identities>();
      identities?.forEach((i) => {
        const existing = identityByEmail.get(i.identity_number) || [];
        existing.push(i);
        identityByEmail.set(i.identity_number, existing);
      });

      // Combine everything
      const combined: BlockedCustomer[] = allCustomers.map((c) => {
        const blacklistEntry = blacklistMap.get(c.email);
        return {
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          tenant_id: c.tenant_id,
          tenant_name: tenantMap.get(c.tenant_id) || 'Unknown',
          blocked_reason: c.blocked_reason,
          blocked_at: c.blocked_at,
          is_tenant_blocked: !!c.is_blocked,
          is_globally_blacklisted: !!blacklistEntry && !blacklistEntry.is_whitelisted,
          is_whitelisted: blacklistEntry?.is_whitelisted || false,
          blocked_identities: (identityByEmail.get(c.email) || []).map((i) => ({
            identity_type: i.identity_type,
            identity_number: i.identity_number,
            reason: i.reason,
          })),
        };
      });

      setCustomers(combined);
    } catch (error: any) {
      console.error('Error loading blocked customers:', error);
      toast.error(`Failed to load blocked customers: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openDialog = (action: 'whitelist' | 're-blacklist', email: string) => {
    setDialogAction(action);
    setDialogEmail(email);
    setDialogReason('');
    setDialogOpen(true);
  };

  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    };
  };

  const handleConfirmAction = async () => {
    if (!dialogReason.trim()) {
      toast.error('Please provide a reason');
      return;
    }

    setActionLoading(true);
    try {
      const headers = await getAuthHeaders();
      const url = `${supabaseUrl}/functions/v1/manage-global-blacklist`;

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: dialogAction,
          email: dialogEmail,
          reason: dialogReason.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Action failed');
      }

      toast.success(
        dialogAction === 'whitelist'
          ? `${dialogEmail} has been whitelisted`
          : `${dialogEmail} has been re-blacklisted`
      );
      setDialogOpen(false);
      setLoading(true);
      await loadBlockedCustomers();
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.tenant_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Stats
  const totalBlocked = customers.length;
  const globallyBlacklisted = customers.filter((c) => c.is_globally_blacklisted).length;
  const uniqueTenants = new Set(customers.map((c) => c.tenant_id)).size;

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-white mb-2">Blocked Customers</h1>
        <p className="text-gray-400 mb-8">All blocked customers across every tenant</p>
        <div className="text-xl text-gray-400 text-center py-12">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Blocked Customers</h1>
        <p className="mt-2 text-gray-400">
          All blocked customers across every tenant
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-dark-card rounded-lg border border-dark-border p-5">
          <p className="text-sm text-gray-400">Total Blocked</p>
          <p className="text-2xl font-bold text-red-400 mt-1">{totalBlocked}</p>
        </div>
        <div className="bg-dark-card rounded-lg border border-dark-border p-5">
          <p className="text-sm text-gray-400">Globally Blacklisted</p>
          <p className="text-2xl font-bold text-orange-400 mt-1">{globallyBlacklisted}</p>
        </div>
        <div className="bg-dark-card rounded-lg border border-dark-border p-5">
          <p className="text-sm text-gray-400">Tenants Affected</p>
          <p className="text-2xl font-bold text-white mt-1">{uniqueTenants}</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by name, email, or tenant..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full max-w-md px-4 py-2 rounded-lg bg-dark-card border border-dark-border text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
        />
      </div>

      {/* Table */}
      <div className="bg-dark-card rounded-lg shadow overflow-hidden border border-dark-border">
        <table className="min-w-full divide-y divide-dark-border">
          <thead className="bg-dark-bg">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase w-8" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Customer
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Tenant
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Reason
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Blocked At
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-dark-card divide-y divide-dark-border">
            {filteredCustomers.map((customer) => (
              <Fragment key={customer.id}>
                <tr
                  className="hover:bg-dark-hover cursor-pointer"
                  onClick={() => toggleRow(customer.id)}
                >
                  <td className="px-4 py-4 text-gray-400 text-sm">
                    {expandedRows.has(customer.id) ? '▼' : '▶'}
                  </td>
                  <td className="px-4 py-4">
                    <div>
                      <p className="text-sm font-medium text-white">{customer.name}</p>
                      <p className="text-xs text-gray-400">{customer.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-300">
                    {customer.tenant_name}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-400 max-w-[200px] truncate">
                    {customer.blocked_reason || '—'}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-400">
                    {customer.blocked_at
                      ? new Date(customer.blocked_at).toLocaleDateString('en-US')
                      : '—'}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="flex flex-col gap-1">
                      {customer.is_tenant_blocked && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-900/50 text-red-400 border border-red-700 w-fit">
                          Blocked
                        </span>
                      )}
                      {customer.is_globally_blacklisted && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-900/50 text-orange-400 border border-orange-700 w-fit">
                          Global Blacklist
                        </span>
                      )}
                      {customer.is_whitelisted && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-900/50 text-green-400 border border-green-700 w-fit">
                          Whitelisted
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    {customer.is_globally_blacklisted && !customer.is_whitelisted && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDialog('whitelist', customer.email);
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-green-900/30 text-green-400 border border-green-700 hover:bg-green-900/50 transition-colors"
                      >
                        Whitelist
                      </button>
                    )}
                    {customer.is_whitelisted && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDialog('re-blacklist', customer.email);
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-900/30 text-red-400 border border-red-700 hover:bg-red-900/50 transition-colors"
                      >
                        Re-blacklist
                      </button>
                    )}
                  </td>
                </tr>

                {/* Expanded Row — blocked identities */}
                {expandedRows.has(customer.id) && (
                  <tr>
                    <td colSpan={7} className="px-4 py-4 bg-dark-bg/50">
                      <div className="ml-8">
                        {customer.blocked_identities.length > 0 ? (
                          <>
                            <p className="text-xs font-medium text-gray-400 uppercase mb-3">
                              Blocked Identities
                            </p>
                            <div className="space-y-2">
                              {customer.blocked_identities.map((identity, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center gap-6 text-sm bg-dark-card rounded-lg px-4 py-3 border border-dark-border"
                                >
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-dark-bg text-gray-300 border border-dark-border min-w-[80px] justify-center capitalize">
                                    {identity.identity_type}
                                  </span>
                                  <span className="text-white font-mono text-sm">
                                    {identity.identity_number}
                                  </span>
                                  <span className="text-gray-400 flex-1 text-sm">
                                    {identity.reason || 'No reason provided'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">
                            No blocked identities recorded for this customer.
                          </p>
                        )}
                        {customer.phone && (
                          <p className="text-xs text-gray-500 mt-3">
                            Phone: {customer.phone}
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {filteredCustomers.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400">
              {searchQuery
                ? 'No blocked customers match your search.'
                : 'No blocked customers found.'}
            </p>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => !actionLoading && setDialogOpen(false)}
          />
          <div className="relative bg-dark-card border border-dark-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-xl font-bold text-white mb-1">
              {dialogAction === 'whitelist'
                ? 'Whitelist Customer'
                : 'Re-blacklist Customer'}
            </h2>
            <p className="text-sm text-gray-400 mb-4">
              {dialogAction === 'whitelist'
                ? 'This will allow the customer to book across all tenants.'
                : 'This will block the customer across all tenants again.'}
            </p>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-400 uppercase mb-1">
                Email
              </label>
              <p className="text-sm text-white bg-dark-bg rounded-lg px-3 py-2 border border-dark-border">
                {dialogEmail}
              </p>
            </div>

            <div className="mb-6">
              <label className="block text-xs font-medium text-gray-400 uppercase mb-1">
                Reason <span className="text-red-400">*</span>
              </label>
              <textarea
                value={dialogReason}
                onChange={(e) => setDialogReason(e.target.value)}
                placeholder="Provide a reason for this action..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-dark-bg border border-dark-border text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-none text-sm"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDialogOpen(false)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 bg-dark-bg border border-dark-border hover:bg-dark-hover transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                disabled={actionLoading}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  dialogAction === 'whitelist'
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-red-600 text-white hover:bg-red-700'
                }`}
              >
                {actionLoading
                  ? 'Processing...'
                  : dialogAction === 'whitelist'
                  ? 'Confirm Whitelist'
                  : 'Confirm Re-blacklist'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
