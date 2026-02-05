'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { generateMasterPassword, hashMasterPassword } from '@/lib/masterPassword';
import { toast } from '@/components/ui/sonner';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';

interface Tenant {
  id: string;
  slug: string;
  company_name: string;
  admin_name: string | null;
  status: string;
  contact_email: string;
  created_at: string;
  master_password_hash: string | null;
  tenant_type: 'production' | 'test' | null;
}

interface TenantCredentials {
  tenantId: string;
  companyName: string;
  slug: string;
  contactEmail: string;
  masterPassword: string;
  adminEmail: string;
  adminPassword: string;
  portalUrl: string;
  bookingUrl: string;
}

export default function RentalCompaniesPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({
    companyName: '',
    adminName: '',
    slug: '',
    contactEmail: '',
    tenantType: 'production' as 'production' | 'test',
  });
  const [creating, setCreating] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedTenantCreds, setSelectedTenantCreds] = useState<TenantCredentials | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'production' | 'test'>('all');
  const [formErrors, setFormErrors] = useState<{ slug?: string }>({});

  useEffect(() => {
    loadTenants();
  }, [typeFilter]);

  const loadTenants = async () => {
    try {
      let query = supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false });

      if (typeFilter !== 'all') {
        query = query.eq('tenant_type', typeFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setTenants(data || []);
    } catch (error) {
      console.error('Error loading tenants:', error);
    } finally {
      setLoading(false);
    }
  };

  // Generate random password
  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 16; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const validateSlug = (slug: string): string | null => {
    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (cleanSlug.length < 3) {
      return 'Slug must be at least 3 characters long';
    }
    if (cleanSlug.length > 50) {
      return 'Slug must be 50 characters or less';
    }
    if (!/^[a-z][a-z0-9-]*$/.test(cleanSlug)) {
      return 'Slug must start with a letter and contain only letters, numbers, and hyphens';
    }
    return null;
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate slug before submitting
    const slug = formData.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const slugError = validateSlug(slug);
    if (slugError) {
      setFormErrors({ slug: slugError });
      return;
    }
    setFormErrors({});
    setCreating(true);

    try {

      // Step 1: Create tenant
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .insert([
          {
            company_name: formData.companyName,
            admin_name: formData.adminName || null,
            slug: slug,
            contact_email: formData.contactEmail,
            status: 'active',
            tenant_type: formData.tenantType,
          }
        ])
        .select()
        .single();

      if (tenantError) throw tenantError;

      // Step 2: Generate master password
      const masterPassword = generateMasterPassword();
      const masterPasswordHash = await hashMasterPassword(masterPassword);

      const { error: updateError } = await supabase
        .from('tenants')
        .update({ master_password_hash: masterPasswordHash })
        .eq('id', tenant.id);

      if (updateError) throw updateError;

      // Step 3: Generate admin credentials
      const adminEmail = formData.contactEmail;
      const adminPassword = generateRandomPassword();

      // Step 4: Create the admin user via edge function
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        throw new Error('Not authenticated - please log in again');
      }

      const { data: createUserData, error: createUserError } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: adminEmail,
          name: `${formData.companyName} Admin`,
          role: 'head_admin',
          temporaryPassword: adminPassword,
          tenant_id: tenant.id, // Assign user to this specific tenant
        },
      });

      if (createUserError) {
        console.error('Failed to create admin user:', createUserError);
        // Clean up: delete the tenant if user creation failed
        await supabase.from('tenants').delete().eq('id', tenant.id);
        throw new Error(`Failed to create admin user: ${createUserError.message}`);
      }

      if (createUserData?.error) {
        console.error('Admin user creation returned error:', createUserData.error);
        // Clean up: delete the tenant if user creation failed
        await supabase.from('tenants').delete().eq('id', tenant.id);
        throw new Error(`Failed to create admin user: ${createUserData.error}`);
      }

      // Prepare credentials object
      const credentials: TenantCredentials = {
        tenantId: tenant.id,
        companyName: formData.companyName,
        slug: slug,
        contactEmail: formData.contactEmail,
        masterPassword: masterPassword,
        adminEmail: adminEmail,
        adminPassword: adminPassword,
        portalUrl: `https://${slug}.portal.drive-247.com`,
        bookingUrl: `https://${slug}.drive-247.com`,
      };

      // Show details modal
      setSelectedTenantCreds(credentials);
      setShowDetailsModal(true);
      setShowCreateModal(false);
      setFormData({ companyName: '', adminName: '', slug: '', contactEmail: '', tenantType: 'production' });
      loadTenants();

    } catch (error: any) {
      // Parse database constraint errors into user-friendly messages
      let errorMessage = error.message;
      if (error.message?.includes('slug_length')) {
        errorMessage = 'Slug must be between 3 and 50 characters';
        setFormErrors({ slug: errorMessage });
      } else if (error.message?.includes('tenants_slug_key') || error.message?.includes('duplicate key')) {
        errorMessage = 'This slug is already taken. Please choose a different one.';
        setFormErrors({ slug: errorMessage });
      }
      toast.error(`Error creating tenant: ${errorMessage}`);
    } finally {
      setCreating(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard!`);
  };

  const copyAllCredentials = () => {
    if (!selectedTenantCreds) return;

    const text = `
=== ${selectedTenantCreds.companyName} - Rental Company Credentials ===

Company Information:
- Company Name: ${selectedTenantCreds.companyName}
- Slug: ${selectedTenantCreds.slug}
- Contact Email: ${selectedTenantCreds.contactEmail}

Master Password (Super Admin Access):
- Password: ${selectedTenantCreds.masterPassword}

Admin User Credentials:
- Email: ${selectedTenantCreds.adminEmail}
- Password: ${selectedTenantCreds.adminPassword}

Access URLs:
- Rental Portal (Admin Dashboard): ${selectedTenantCreds.portalUrl}
- Booking Site (Customer Facing): ${selectedTenantCreds.bookingUrl}

⚠️ IMPORTANT: Save these credentials securely. They cannot be retrieved later.
    `.trim();

    navigator.clipboard.writeText(text);
    toast.success('All credentials copied to clipboard!');
  };

  if (loading) {
    return (
      <TableSkeleton
        rows={5}
        columns={7}
        title="Rental Companies"
        subtitle="Manage all rental companies on the platform"
      />
    );
  }

  return (
    <div className="p-8 h-full overflow-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Rental Companies</h1>
          <p className="mt-2 text-gray-400">Manage all rental companies on the platform</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium"
        >
          + Add New Rental
        </button>
      </div>

      {/* Type Filter */}
      <div className="mb-4 flex items-center space-x-2">
        <span className="text-sm text-gray-400">Filter:</span>
        <button
          onClick={() => setTypeFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            typeFilter === 'all'
              ? 'bg-primary-600 text-white'
              : 'bg-dark-card text-gray-400 hover:text-white border border-dark-border'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setTypeFilter('production')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            typeFilter === 'production'
              ? 'bg-green-600 text-white'
              : 'bg-dark-card text-gray-400 hover:text-white border border-dark-border'
          }`}
        >
          Production
        </button>
        <button
          onClick={() => setTypeFilter('test')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            typeFilter === 'test'
              ? 'bg-orange-600 text-white'
              : 'bg-dark-card text-gray-400 hover:text-white border border-dark-border'
          }`}
        >
          Test
        </button>
      </div>

      <div className="bg-dark-card rounded-lg shadow overflow-x-auto border border-dark-border">
        <table className="min-w-full divide-y divide-dark-border">
          <thead className="bg-dark-bg">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Company
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-dark-card divide-y divide-dark-border">
            {tenants.map((tenant) => (
              <tr key={tenant.id} className="hover:bg-dark-hover">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-white">{tenant.company_name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {tenant.tenant_type ? (
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      tenant.tenant_type === 'production'
                        ? 'bg-blue-900/30 text-blue-400 border border-blue-800/50'
                        : 'bg-orange-900/30 text-orange-400 border border-orange-800/50'
                    }`}>
                      {tenant.tenant_type}
                    </span>
                  ) : (
                    <span className="text-gray-500 text-xs">—</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    tenant.status === 'active'
                      ? 'bg-green-900/30 text-green-400 border border-green-800/50'
                      : 'bg-red-900/30 text-red-400 border border-red-800/50'
                  }`}>
                    {tenant.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                  {new Date(tenant.created_at).toLocaleDateString('en-US')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <a
                    href={`/admin/rentals/${tenant.id}`}
                    className="text-primary-400 hover:text-primary-300"
                  >
                    View Details →
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {tenants.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400">No rental companies yet. Create one to get started.</p>
          </div>
        )}
      </div>

      {/* Create Tenant Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-dark-card rounded-lg p-8 max-w-md w-full border border-dark-border">
            <h2 className="text-2xl font-bold text-white mb-4">Add New Rental Company</h2>

            <form onSubmit={handleCreateTenant} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Company Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Acme Rentals"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Admin Name
                </label>
                <input
                  type="text"
                  value={formData.adminName}
                  onChange={(e) => setFormData({ ...formData, adminName: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Slug (subdomain) *
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={50}
                  value={formData.slug}
                  onChange={(e) => {
                    setFormData({ ...formData, slug: e.target.value });
                    // Clear error when user starts typing
                    if (formErrors.slug) {
                      const newSlug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
                      if (newSlug.length >= 3) {
                        setFormErrors({});
                      }
                    }
                  }}
                  className={`w-full px-3 py-2 bg-dark-bg border rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                    formErrors.slug ? 'border-red-500' : 'border-dark-border'
                  }`}
                  placeholder="acme-rentals"
                />
                {formErrors.slug ? (
                  <p className="text-xs text-red-400 mt-1">{formErrors.slug}</p>
                ) : (
                  <p className="text-xs text-gray-500 mt-1">
                    Min 3 characters. Portal: {formData.slug || 'slug'}.portal.drive-247.com | Booking: {formData.slug || 'slug'}.drive-247.com
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Contact Email *
                </label>
                <input
                  type="email"
                  required
                  value={formData.contactEmail}
                  onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="admin@acmerentals.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Tenant Type *
                </label>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, tenantType: 'production' })}
                    className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      formData.tenantType === 'production'
                        ? 'bg-green-600 text-white'
                        : 'bg-dark-bg text-gray-400 border border-dark-border hover:text-white'
                    }`}
                  >
                    Production
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, tenantType: 'test' })}
                    className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      formData.tenantType === 'test'
                        ? 'bg-orange-600 text-white'
                        : 'bg-dark-bg text-gray-400 border border-dark-border hover:text-white'
                    }`}
                  >
                    Test
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Production = real customer, Test = internal/testing use
                </p>
              </div>

              <div className="flex space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setFormErrors({});
                  }}
                  className="flex-1 px-4 py-2 border border-dark-border rounded-md text-gray-300 hover:bg-dark-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create Company'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tenant Details Modal with Complete Credentials */}
      {showDetailsModal && selectedTenantCreds && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-card rounded-lg p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-dark-border">
            <h2 className="text-2xl font-bold text-white mb-2">
              {selectedTenantCreds.companyName} - Complete Setup
            </h2>
            <p className="text-sm text-gray-400 mb-6">
              Rental company created successfully! Save these credentials securely.
            </p>

            {/* Warning Banner */}
            <div className="bg-yellow-900/20 border-l-4 border-yellow-500 p-4 mb-6">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-yellow-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-yellow-400">
                    <strong>Important:</strong> These credentials will only be shown once. Please save them securely before closing this window.
                  </p>
                </div>
              </div>
            </div>

            {/* Company Information */}
            <div className="bg-dark-bg rounded-lg p-4 mb-4 border border-dark-border">
              <h3 className="text-lg font-semibold text-white mb-3">Company Information</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Company Name:</span>
                  <span className="text-sm font-medium text-white">{selectedTenantCreds.companyName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Slug:</span>
                  <span className="text-sm font-medium text-white">{selectedTenantCreds.slug}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Portal:</span>
                  <span className="text-sm font-semibold text-primary-400">{selectedTenantCreds.slug}.portal.drive-247.com</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Booking:</span>
                  <span className="text-sm font-semibold text-primary-400">{selectedTenantCreds.slug}.drive-247.com</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Contact Email:</span>
                  <span className="text-sm font-medium text-white">{selectedTenantCreds.contactEmail}</span>
                </div>
              </div>
            </div>

            {/* Master Password */}
            <div className="bg-indigo-900/20 rounded-lg p-4 mb-4 border border-indigo-800/50">
              <h3 className="text-lg font-semibold text-white mb-3">Master Password (Super Admin)</h3>
              <p className="text-xs text-gray-400 mb-2">Use this to access the tenant portal as super admin</p>
              <div className="flex items-center space-x-2">
                <code className="flex-1 bg-indigo-900/30 px-4 py-3 rounded-lg border border-indigo-700 text-sm font-mono break-all text-indigo-300 font-semibold">
                  {selectedTenantCreds.masterPassword}
                </code>
                <button
                  onClick={() => copyToClipboard(selectedTenantCreds.masterPassword, 'Master password')}
                  className="px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm whitespace-nowrap font-medium shadow-sm"
                >
                  Copy
                </button>
              </div>
            </div>

            {/* Admin User Credentials */}
            <div className="bg-green-900/20 rounded-lg p-4 mb-4 border border-green-800/50">
              <h3 className="text-lg font-semibold text-white mb-3">Admin User Credentials</h3>
              <p className="text-xs text-gray-400 mb-3">Initial admin account for the rental company</p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Email</label>
                  <div className="flex items-center space-x-2">
                    <code className="flex-1 bg-green-900/30 px-4 py-3 rounded-lg border border-green-700 text-sm font-mono break-all text-green-300 font-semibold">
                      {selectedTenantCreds.adminEmail}
                    </code>
                    <button
                      onClick={() => copyToClipboard(selectedTenantCreds.adminEmail, 'Admin email')}
                      className="px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm whitespace-nowrap font-medium shadow-sm"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Password</label>
                  <div className="flex items-center space-x-2">
                    <code className="flex-1 bg-green-900/30 px-4 py-3 rounded-lg border border-green-700 text-sm font-mono break-all text-green-300 font-semibold">
                      {selectedTenantCreds.adminPassword}
                    </code>
                    <button
                      onClick={() => copyToClipboard(selectedTenantCreds.adminPassword, 'Admin password')}
                      className="px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm whitespace-nowrap font-medium shadow-sm"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Access URLs */}
            <div className="bg-blue-900/20 rounded-lg p-4 mb-6 border border-blue-800/50">
              <h3 className="text-lg font-semibold text-white mb-3">Access URLs</h3>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Rental Portal (Admin Dashboard)</label>
                  <div className="flex items-center space-x-2">
                    <code className="flex-1 bg-blue-900/30 px-4 py-3 rounded-lg border border-blue-700 text-sm break-all text-blue-300 font-semibold">
                      {selectedTenantCreds.portalUrl}
                    </code>
                    <button
                      onClick={() => copyToClipboard(selectedTenantCreds.portalUrl, 'Portal URL')}
                      className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm whitespace-nowrap font-medium shadow-sm"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">Booking Site (Customer Facing)</label>
                  <div className="flex items-center space-x-2">
                    <code className="flex-1 bg-blue-900/30 px-4 py-3 rounded-lg border border-blue-700 text-sm break-all text-blue-300 font-semibold">
                      {selectedTenantCreds.bookingUrl}
                    </code>
                    <button
                      onClick={() => copyToClipboard(selectedTenantCreds.bookingUrl, 'Booking URL')}
                      className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm whitespace-nowrap font-medium shadow-sm"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-3">
              <button
                onClick={copyAllCredentials}
                className="flex-1 px-6 py-3 bg-dark-hover text-white rounded-lg hover:bg-dark-border font-semibold shadow-md hover:shadow-lg transition-all border border-dark-border"
              >
                Copy All Credentials
              </button>
              <button
                onClick={() => {
                  setShowDetailsModal(false);
                  setSelectedTenantCreds(null);
                }}
                className="flex-1 px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-semibold shadow-md hover:shadow-lg transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
