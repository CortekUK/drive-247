'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { generateMasterPassword, hashMasterPassword } from '@/lib/masterPassword';

interface Tenant {
  id: string;
  slug: string;
  company_name: string;
  status: string;
  contact_email: string;
  created_at: string;
  master_password_hash: string | null;
}

export default function RentalCompaniesPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({
    companyName: '',
    slug: '',
    contactEmail: '',
  });
  const [creating, setCreating] = useState(false);
  const [showMasterPassword, setShowMasterPassword] = useState<string | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState<string>('');

  useEffect(() => {
    loadTenants();
  }, []);

  const loadTenants = async () => {
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTenants(data || []);
    } catch (error) {
      console.error('Error loading tenants:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      const { error } = await supabase
        .from('tenants')
        .insert([
          {
            company_name: formData.companyName,
            slug: formData.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
            contact_email: formData.contactEmail,
            status: 'active',
          }
        ]);

      if (error) throw error;

      setShowCreateModal(false);
      setFormData({ companyName: '', slug: '', contactEmail: '' });
      loadTenants();
    } catch (error: any) {
      alert(`Error creating tenant: ${error.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ status: newStatus })
        .eq('id', id);

      if (error) throw error;
      loadTenants();
    } catch (error: any) {
      alert(`Error updating status: ${error.message}`);
    }
  };

  const handleGenerateMasterPassword = async (tenantId: string) => {
    try {
      const password = generateMasterPassword();
      const hash = await hashMasterPassword(password);

      const { error } = await supabase
        .from('tenants')
        .update({ master_password_hash: hash })
        .eq('id', tenantId);

      if (error) throw error;

      setGeneratedPassword(password);
      setShowMasterPassword(tenantId);
      loadTenants();
    } catch (error: any) {
      alert(`Error generating master password: ${error.message}`);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Master password copied to clipboard!');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xl text-gray-600">Loading rental companies...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Rental Companies</h1>
          <p className="mt-2 text-gray-600">Manage all rental companies on the platform</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
        >
          + Add New Company
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Company
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Slug
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Contact Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Master Password
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {tenants.map((tenant) => (
              <tr key={tenant.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{tenant.company_name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{tenant.slug}</div>
                  <div className="text-xs text-gray-500">{tenant.slug}.yourdomain.com</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-500">{tenant.contact_email}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    tenant.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {tenant.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {tenant.master_password_hash ? (
                    <div className="flex items-center space-x-2">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                        Configured
                      </span>
                      <button
                        onClick={() => handleGenerateMasterPassword(tenant.id)}
                        className="text-xs text-indigo-600 hover:text-indigo-900"
                      >
                        Regenerate
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleGenerateMasterPassword(tenant.id)}
                      className="text-xs text-indigo-600 hover:text-indigo-900 font-medium"
                    >
                      Generate
                    </button>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(tenant.created_at).toLocaleDateString('en-US')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                  {tenant.status === 'active' ? (
                    <button
                      onClick={() => handleUpdateStatus(tenant.id, 'suspended')}
                      className="text-red-600 hover:text-red-900"
                    >
                      Suspend
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpdateStatus(tenant.id, 'active')}
                      className="text-green-600 hover:text-green-900"
                    >
                      Activate
                    </button>
                  )}
                  <button className="text-indigo-600 hover:text-indigo-900">
                    View Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {tenants.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No rental companies yet. Create one to get started.</p>
          </div>
        )}
      </div>

      {/* Create Tenant Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Add New Rental Company</h2>

            <form onSubmit={handleCreateTenant} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Company Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Acme Rentals"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Slug (subdomain) *
                </label>
                <input
                  type="text"
                  required
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="acme-rentals"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Will be: {formData.slug || 'slug'}.yourdomain.com
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact Email *
                </label>
                <input
                  type="email"
                  required
                  value={formData.contactEmail}
                  onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="admin@acmerentals.com"
                />
              </div>

              <div className="flex space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create Company'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Master Password Modal */}
      {showMasterPassword && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Master Password Generated</h2>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-yellow-800 mb-2">
                ⚠️ <strong>Important:</strong> Save this password securely. It will only be shown once.
              </p>
            </div>

            <div className="bg-gray-100 rounded-lg p-4 mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Master Password
              </label>
              <div className="flex items-center space-x-2">
                <code className="flex-1 bg-white px-3 py-2 rounded border border-gray-300 text-sm font-mono break-all">
                  {generatedPassword}
                </code>
                <button
                  onClick={() => copyToClipboard(generatedPassword)}
                  className="px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm whitespace-nowrap"
                >
                  Copy
                </button>
              </div>
            </div>

            <p className="text-sm text-gray-600 mb-6">
              Use this password to log into the tenant's portal without knowing their actual password.
              Access the portal at: <strong>{tenants.find(t => t.id === showMasterPassword)?.slug}.yourdomain.com</strong>
            </p>

            <button
              onClick={() => {
                setShowMasterPassword(null);
                setGeneratedPassword('');
              }}
              className="w-full px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
