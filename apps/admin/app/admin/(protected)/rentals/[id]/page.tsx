'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { generateMasterPassword, hashMasterPassword } from '@/lib/masterPassword';
import { toast } from '@/components/ui/sonner';
import { ArrowLeft, Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';

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
  integration_canopy: boolean;
  integration_veriff: boolean;
  integration_bonzah: boolean;
}

export default function TenantDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  // Master password state
  const [generatedPassword, setGeneratedPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState(false);
  const [generatingPassword, setGeneratingPassword] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    company_name: '',
    admin_name: '',
    slug: '',
    contact_email: '',
  });
  const [saving, setSaving] = useState(false);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (params.id) {
      loadTenant(params.id as string);
    }
  }, [params.id]);

  const loadTenant = async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      setTenant(data);
      setEditForm({
        company_name: data.company_name,
        admin_name: data.admin_name || '',
        slug: data.slug,
        contact_email: data.contact_email,
      });
    } catch (error) {
      console.error('Error loading tenant:', error);
      toast.error('Failed to load tenant details');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard!`);
  };

  const handleGenerateMasterPassword = async () => {
    if (!tenant) return;
    setGeneratingPassword(true);

    try {
      const password = generateMasterPassword();
      const hash = await hashMasterPassword(password);

      const { error } = await supabase
        .from('tenants')
        .update({ master_password_hash: hash })
        .eq('id', tenant.id);

      if (error) throw error;

      setGeneratedPassword(password);
      setShowPassword(true);
      setTenant({ ...tenant, master_password_hash: hash });
      toast.success('Master password generated successfully!');
    } catch (error: any) {
      toast.error(`Error generating master password: ${error.message}`);
    } finally {
      setGeneratingPassword(false);
    }
  };

  const handleUpdateStatus = async (newStatus: string) => {
    if (!tenant) return;

    try {
      const { error } = await supabase
        .from('tenants')
        .update({ status: newStatus })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({ ...tenant, status: newStatus });
      toast.success(`Tenant ${newStatus === 'active' ? 'activated' : 'suspended'} successfully!`);
    } catch (error: any) {
      toast.error(`Error updating status: ${error.message}`);
    }
  };

  const handleUpdateType = async (newType: 'production' | 'test') => {
    if (!tenant) return;

    try {
      const { error } = await supabase
        .from('tenants')
        .update({ tenant_type: newType })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({ ...tenant, tenant_type: newType });
      toast.success(`Tenant marked as ${newType}!`);
    } catch (error: any) {
      toast.error(`Error updating tenant type: ${error.message}`);
    }
  };

  const handleToggleIntegration = async (integration: 'canopy' | 'veriff' | 'bonzah', enabled: boolean) => {
    if (!tenant) return;

    const fieldName = `integration_${integration}` as keyof Tenant;

    try {
      const { error } = await supabase
        .from('tenants')
        .update({ [fieldName]: enabled })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({ ...tenant, [fieldName]: enabled });
      toast.success(`${integration.charAt(0).toUpperCase() + integration.slice(1)} ${enabled ? 'enabled' : 'disabled'}!`);
    } catch (error: any) {
      toast.error(`Error updating integration: ${error.message}`);
    }
  };

  const handleSaveEdit = async () => {
    if (!tenant) return;
    setSaving(true);

    // Sanitize slug
    const sanitizedSlug = editForm.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          company_name: editForm.company_name,
          admin_name: editForm.admin_name || null,
          slug: sanitizedSlug,
          contact_email: editForm.contact_email,
        })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({
        ...tenant,
        company_name: editForm.company_name,
        admin_name: editForm.admin_name || null,
        slug: sanitizedSlug,
        contact_email: editForm.contact_email,
      });
      setEditForm({ ...editForm, slug: sanitizedSlug });
      setIsEditing(false);
      toast.success('Tenant updated successfully!');
    } catch (error: any) {
      toast.error(`Error updating tenant: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!tenant || deleteConfirmName !== tenant.company_name) {
      toast.error('Company name does not match');
      return;
    }

    setDeleting(true);

    try {
      const { error } = await supabase
        .from('tenants')
        .delete()
        .eq('id', tenant.id);

      if (error) throw error;

      toast.success('Tenant deleted successfully!');
      router.push('/admin/rentals');
    } catch (error: any) {
      toast.error(`Error deleting tenant: ${error.message}`);
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-dark-card rounded w-48 mb-4"></div>
          <div className="h-4 bg-dark-card rounded w-96 mb-8"></div>
          <div className="h-64 bg-dark-card rounded"></div>
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-8">
        <div className="text-center py-12">
          <p className="text-gray-400 text-lg">Tenant not found</p>
          <button
            onClick={() => router.push('/admin/rentals')}
            className="mt-4 text-primary-400 hover:text-primary-300"
          >
            Back to Rental Companies
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 h-full overflow-auto">
      <button
        onClick={() => router.push('/admin/rentals')}
        className="flex items-center text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Rental Companies
      </button>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-white">{tenant.company_name}</h1>
            <span className={`px-4 py-1.5 text-sm font-bold rounded-full uppercase tracking-wide ${
              tenant.tenant_type === 'production'
                ? 'bg-green-600 text-white'
                : tenant.tenant_type === 'test'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-600 text-white'
            }`}>
              {tenant.tenant_type || 'Not Set'}
            </span>
            <span className={`px-3 py-1 text-sm font-semibold rounded-full ${
              tenant.status === 'active'
                ? 'bg-green-900/30 text-green-400 border border-green-800/50'
                : 'bg-red-900/30 text-red-400 border border-red-800/50'
            }`}>
              {tenant.status}
            </span>
          </div>
        </div>
        <p className="text-gray-400 mb-4">Tenant Details</p>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-dark-card rounded-lg p-1 border border-dark-border">
            <button
              onClick={() => handleUpdateType('production')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tenant.tenant_type === 'production'
                  ? 'bg-green-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Production
            </button>
            <button
              onClick={() => handleUpdateType('test')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tenant.tenant_type === 'test'
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Test
            </button>
          </div>

          <button
            onClick={() => handleUpdateStatus(tenant.status === 'active' ? 'suspended' : 'active')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              tenant.status === 'active'
                ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {tenant.status === 'active' ? 'Suspend' : 'Activate'}
          </button>

          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium flex items-center gap-1"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Company Information */}
        <div className="bg-dark-card rounded-lg p-6 border border-dark-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">Company Information</h2>
            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center text-primary-400 hover:text-primary-300 text-sm"
              >
                <Pencil className="w-4 h-4 mr-1" />
                Edit
              </button>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Company Name</label>
                <input
                  type="text"
                  value={editForm.company_name}
                  onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Admin Name</label>
                <input
                  type="text"
                  value={editForm.admin_name}
                  onChange={(e) => setEditForm({ ...editForm, admin_name: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Slug (subdomain)</label>
                <input
                  type="text"
                  value={editForm.slug}
                  onChange={(e) => setEditForm({ ...editForm, slug: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-yellow-500 mt-1">
                  Warning: Changing the slug will change the portal and booking URLs
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Contact Email</label>
                <input
                  type="email"
                  value={editForm.contact_email}
                  onChange={(e) => setEditForm({ ...editForm, contact_email: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div className="flex space-x-3 pt-2">
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditForm({
                      company_name: tenant.company_name,
                      admin_name: tenant.admin_name || '',
                      slug: tenant.slug,
                      contact_email: tenant.contact_email,
                    });
                  }}
                  className="px-4 py-2 border border-dark-border rounded-md text-gray-300 hover:bg-dark-hover"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Company Name</label>
                <p className="text-white">{tenant.company_name}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Admin Name</label>
                <p className="text-white">{tenant.admin_name || <span className="text-gray-500">Not set</span>}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Slug</label>
                <p className="text-white">{tenant.slug}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Contact Email</label>
                <p className="text-white">{tenant.contact_email}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Created</label>
                <p className="text-white">
                  {new Date(tenant.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Access URLs */}
        <div className="bg-dark-card rounded-lg p-6 border border-dark-border">
          <h2 className="text-xl font-semibold text-white mb-4">Access URLs</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Portal URL (Admin Dashboard)</label>
              <div className="flex items-center space-x-2">
                <code className="flex-1 bg-dark-bg px-3 py-2 rounded border border-dark-border text-sm text-primary-400 break-all">
                  https://{tenant.slug}.portal.drive-247.com
                </code>
                <button
                  onClick={() => copyToClipboard(`https://${tenant.slug}.portal.drive-247.com`, 'Portal URL')}
                  className="px-3 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 text-sm whitespace-nowrap"
                >
                  Copy
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Booking URL (Customer Facing)</label>
              <div className="flex items-center space-x-2">
                <code className="flex-1 bg-dark-bg px-3 py-2 rounded border border-dark-border text-sm text-primary-400 break-all">
                  https://{tenant.slug}.drive-247.com
                </code>
                <button
                  onClick={() => copyToClipboard(`https://${tenant.slug}.drive-247.com`, 'Booking URL')}
                  className="px-3 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 text-sm whitespace-nowrap"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Integrations */}
        <div className="bg-dark-card rounded-lg p-6 border border-dark-border">
          <h2 className="text-xl font-semibold text-white mb-4">Integrations</h2>
          <p className="text-sm text-gray-400 mb-6">Enable or disable third-party integrations for this tenant</p>

          <div className="space-y-4">
            {/* Canopy */}
            <div className="flex items-center justify-between py-3 border-b border-dark-border">
              <div>
                <h3 className="text-white font-medium">Canopy</h3>
                <p className="text-sm text-gray-400">Insurance verification service</p>
              </div>
              <button
                onClick={() => handleToggleIntegration('canopy', !tenant.integration_canopy)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  tenant.integration_canopy ? 'bg-green-600' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    tenant.integration_canopy ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Veriff */}
            <div className="flex items-center justify-between py-3 border-b border-dark-border">
              <div>
                <h3 className="text-white font-medium">Veriff</h3>
                <p className="text-sm text-gray-400">Identity verification service</p>
              </div>
              <button
                onClick={() => handleToggleIntegration('veriff', !tenant.integration_veriff)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  tenant.integration_veriff ? 'bg-green-600' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    tenant.integration_veriff ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Bonzah */}
            <div className="flex items-center justify-between py-3">
              <div>
                <h3 className="text-white font-medium">Bonzah</h3>
                <p className="text-sm text-gray-400">Insurance integration</p>
              </div>
              <button
                onClick={() => handleToggleIntegration('bonzah', !tenant.integration_bonzah)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  tenant.integration_bonzah ? 'bg-green-600' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    tenant.integration_bonzah ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Master Password */}
        <div className="bg-indigo-900/20 rounded-lg p-6 border border-indigo-800/50">
          <h2 className="text-xl font-semibold text-white mb-2">Master Password</h2>
          <p className="text-sm text-gray-400 mb-4">
            Use this to access the tenant's portal as super admin
          </p>

          {generatedPassword ? (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <code className="flex-1 bg-indigo-900/30 px-3 py-2 rounded border border-indigo-700 text-sm font-mono text-indigo-300">
                  {showPassword ? generatedPassword : '••••••••••••••••'}
                </code>
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  className="px-3 py-2 bg-indigo-600/50 text-white rounded hover:bg-indigo-600 text-sm"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => copyToClipboard(generatedPassword, 'Master password')}
                  className="px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm whitespace-nowrap"
                >
                  Copy
                </button>
              </div>
              <div className="bg-yellow-900/20 border border-yellow-700 rounded p-3">
                <p className="text-xs text-yellow-400">
                  Save this password securely. Once you leave this page, it cannot be retrieved.
                </p>
              </div>
              <button
                onClick={handleGenerateMasterPassword}
                disabled={generatingPassword}
                className="text-sm text-indigo-400 hover:text-indigo-300"
              >
                {generatingPassword ? 'Generating...' : 'Generate New Password'}
              </button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-400 mb-3">
                {tenant.master_password_hash
                  ? 'A master password has been set. Generate a new one to view it.'
                  : 'No master password configured yet.'}
              </p>
              <button
                onClick={handleGenerateMasterPassword}
                disabled={generatingPassword}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
              >
                {generatingPassword ? 'Generating...' : (tenant.master_password_hash ? 'Regenerate Password' : 'Generate Password')}
              </button>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-dark-card rounded-lg p-6 border border-dark-border lg:col-span-2">
          <h2 className="text-xl font-semibold text-white mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            <a
              href={`https://${tenant.slug}.portal.drive-247.com`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
            >
              Open Portal
            </a>
            <a
              href={`https://${tenant.slug}.drive-247.com`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-dark-hover text-white rounded-lg hover:bg-dark-border border border-dark-border text-sm font-medium"
            >
              Open Booking Site
            </a>
            <a
              href={`mailto:${tenant.contact_email}`}
              className="px-4 py-2 bg-dark-hover text-white rounded-lg hover:bg-dark-border border border-dark-border text-sm font-medium"
            >
              Email Contact
            </a>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-card rounded-lg p-6 max-w-md w-full border border-dark-border">
            <h2 className="text-xl font-bold text-white mb-2">Delete Tenant</h2>
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 mb-4">
              <p className="text-sm text-red-400">
                This will permanently delete <strong>{tenant.company_name}</strong> and ALL associated data including vehicles, customers, rentals, payments, and users.
              </p>
              <p className="text-sm text-red-400 mt-2 font-semibold">
                This action cannot be undone!
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Type <strong className="text-white">{tenant.company_name}</strong> to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Enter company name"
              />
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmName('');
                }}
                className="flex-1 px-4 py-2 border border-dark-border rounded-md text-gray-300 hover:bg-dark-hover"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || deleteConfirmName !== tenant.company_name}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
