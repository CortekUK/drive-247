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

  if (!user?.is_primary_super_admin) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xl text-red-400">Access denied. Primary super admin only.</div>
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
          <h1 className="text-3xl font-bold text-white">Manage Super Admins</h1>
          <p className="mt-2 text-gray-400">Add and manage super admin accounts</p>
          <p className="mt-1 text-sm text-red-400">Primary super admin access only</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium"
        >
          + Add Super Admin
        </button>
      </div>

      <div className="bg-dark-card rounded-lg shadow overflow-hidden border border-dark-border">
        <table className="min-w-full divide-y divide-dark-border">
          <thead className="bg-dark-bg">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-dark-card divide-y divide-dark-border">
            {admins.map((admin) => (
              <tr key={admin.id} className="hover:bg-dark-hover">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-white">{admin.name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-400">{admin.email}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {admin.is_primary_super_admin ? (
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-900/30 text-yellow-400 border border-yellow-800/50">
                      Primary Admin
                    </span>
                  ) : (
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-900/30 text-blue-400 border border-blue-800/50">
                      Super Admin
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                  {new Date(admin.created_at).toLocaleDateString('en-US')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  {!admin.is_primary_super_admin && (
                    <button className="text-red-400 hover:text-red-300">
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
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-dark-card rounded-lg p-8 max-w-md w-full border border-dark-border">
            <h2 className="text-2xl font-bold text-white mb-4">Add Super Admin</h2>

            <form onSubmit={handleCreateAdmin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="admin@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Password *
                </label>
                <input
                  type="password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Minimum 8 characters"
                  minLength={8}
                />
              </div>

              <div className="bg-yellow-900/20 border border-yellow-700 rounded-md p-3">
                <p className="text-xs text-yellow-400">
                  This will create a super admin with full platform access (except primary admin functions).
                </p>
              </div>

              <div className="flex space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-dark-border rounded-md text-gray-300 hover:bg-dark-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create Admin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
