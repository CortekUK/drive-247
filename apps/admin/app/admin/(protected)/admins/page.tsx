'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/sonner';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';

interface Admin {
  id: string;
  email: string;
  name: string;
  is_primary_super_admin: boolean;
  created_at: string;
}

export default function ManageAdminsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [creating, setCreating] = useState(false);
  const [showSalesModal, setShowSalesModal] = useState(false);
  const [salesFormData, setSalesFormData] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [creatingSales, setCreatingSales] = useState(false);

  useEffect(() => {
    // Only primary super admin can access this page
    if (user && !user.is_primary_super_admin) {
      router.push('/admin/dashboard');
    }
  }, [user, router]);

  useEffect(() => {
    if (user?.is_primary_super_admin) {
      loadAdmins();
    }
  }, [user]);

  const loadAdmins = async () => {
    try {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, email, name, is_primary_super_admin, created_at')
        .eq('is_super_admin', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAdmins(data || []);
    } catch (error) {
      console.error('Error loading admins:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      // Create Supabase auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
      });

      if (authError) throw authError;

      // Create app_users record
      const { error: userError } = await supabase
        .from('app_users')
        .insert([
          {
            auth_user_id: authData.user?.id,
            email: formData.email,
            name: formData.name,
            is_super_admin: true,
            is_primary_super_admin: false,
            tenant_id: null,
          }
        ]);

      if (userError) throw userError;

      setShowCreateModal(false);
      setFormData({ name: '', email: '', password: '' });
      loadAdmins();
      toast.success('Super admin created successfully!');
    } catch (error: any) {
      toast.error(`Error creating admin: ${error.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleCreateSalesAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingSales(true);

    try {
      const { data, error } = await supabase.functions.invoke('admin-create-sales-agent', {
        body: {
          email: salesFormData.email,
          name: salesFormData.name,
          password: salesFormData.password,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      setShowSalesModal(false);
      setSalesFormData({ name: '', email: '', password: '' });
      loadAdmins();
      toast.success('Sales agent created successfully!');
    } catch (error: any) {
      toast.error(`Error creating sales agent: ${error.message}`);
    } finally {
      setCreatingSales(false);
    }
  };

  if (!user?.is_primary_super_admin) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xl text-red-600">Access denied. Primary super admin only.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <TableSkeleton
        rows={3}
        columns={5}
        title="Manage Super Admins"
        subtitle="Add and manage super admin accounts"
      />
    );
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Manage Super Admins</h1>
          <p className="mt-2 text-muted-foreground">Add and manage super admin accounts</p>
          <p className="mt-1 text-sm text-red-600">Primary super admin access only</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSalesModal(true)}
            className="px-6 py-3 bg-dark-card border border-dark-border text-foreground rounded-lg hover:bg-dark-hover font-medium"
          >
            + Add Sales Agent
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/80 font-medium"
          >
            + Add Super Admin
          </button>
        </div>
      </div>

      <div className="bg-dark-card rounded-lg shadow overflow-hidden border border-dark-border">
        <table className="min-w-full divide-y divide-dark-border">
          <thead className="bg-dark-bg">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-dark-card divide-y divide-dark-border">
            {admins.map((admin) => (
              <tr key={admin.id} className="hover:bg-dark-hover">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-foreground">{admin.name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-muted-foreground">{admin.email}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {admin.is_primary_super_admin ? (
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-500/10 text-yellow-600 border border-yellow-500/25">
                      Primary Admin
                    </span>
                  ) : (
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/25">
                      Super Admin
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                  {new Date(admin.created_at).toLocaleDateString('en-US')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  {!admin.is_primary_super_admin && (
                    <button className="text-red-600 hover:text-red-600">
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Admin Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/30 supports-[backdrop-filter]:backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-dark-card rounded-lg p-8 max-w-md w-full border border-dark-border">
            <h2 className="text-2xl font-bold text-foreground mb-4">Add Super Admin</h2>

            <form onSubmit={handleCreateAdmin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="admin@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Password *
                </label>
                <input
                  type="password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="Minimum 8 characters"
                  minLength={8}
                />
              </div>

              <div className="bg-yellow-500/10 border border-yellow-700 rounded-md p-3">
                <p className="text-xs text-yellow-600">
                  This will create a super admin with full platform access (except primary admin functions).
                </p>
              </div>

              <div className="flex space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-dark-border rounded-md text-muted-foreground hover:bg-dark-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/80 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create Admin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Sales Agent Modal */}
      {showSalesModal && (
        <div className="fixed inset-0 bg-black/30 supports-[backdrop-filter]:backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-dark-card rounded-lg p-8 max-w-md w-full border border-dark-border">
            <h2 className="text-2xl font-bold text-foreground mb-4">Add Sales Agent</h2>

            <form onSubmit={handleCreateSalesAgent} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={salesFormData.name}
                  onChange={(e) => setSalesFormData({ ...salesFormData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="George Sales"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={salesFormData.email}
                  onChange={(e) => setSalesFormData({ ...salesFormData, email: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="george@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Password *
                </label>
                <input
                  type="password"
                  required
                  value={salesFormData.password}
                  onChange={(e) => setSalesFormData({ ...salesFormData, password: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="Minimum 8 characters"
                  minLength={8}
                />
              </div>

              <div className="bg-blue-500/10 border border-blue-700 rounded-md p-3">
                <p className="text-xs text-blue-600">
                  Sales agents can only access the Sales onboarding tab — no platform or tenant data.
                </p>
              </div>

              <div className="flex space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowSalesModal(false)}
                  className="flex-1 px-4 py-2 border border-dark-border rounded-md text-muted-foreground hover:bg-dark-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingSales}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/80 disabled:opacity-50"
                >
                  {creatingSales ? 'Creating...' : 'Create Sales Agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
