'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/sonner';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import { Copy, Eye, EyeOff, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HEADER_ACTIONS, HEADER_PRIMARY } from '@/components/admin/header-buttons';

type TeamRole = 'super_admin' | 'manager' | 'sales' | 'support';

interface Admin {
  id: string;
  email: string;
  name: string;
  is_primary_super_admin: boolean;
  created_at: string;
  is_active: boolean;
  platform_role: TeamRole | null;
  /** The password a super admin set for this member (Vault, decrypted server-side). */
  password: string | null;
}

const ROLES: { value: TeamRole; label: string }[] = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'sales', label: 'Sales' },
  { value: 'support', label: 'Support' },
];
const ROLE_LABEL: Record<TeamRole, string> = { super_admin: 'Super Admin', manager: 'Manager', sales: 'Sales', support: 'Support' };

/**
 * The `admin-team` endpoint (supabase/functions/admin-team): the dev server's own
 * route on localhost, the edge function everywhere else. It refuses anyone who is
 * not a super admin, so the passwords never reach anyone else's browser.
 */
async function callTeam(body: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'development') {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin-team', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'Request failed');
    return data;
  }
  const { data, error } = await supabase.functions.invoke('admin-team', { body });
  if (error) {
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function EyeButton({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={shown ? 'Hide password' : 'Show password'} title={shown ? 'Hide password' : 'Show password'}
      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground motion-reduce:transition-none">
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <button type="button" aria-label="Copy password" title="Copy password"
      onClick={() => { void navigator.clipboard.writeText(value).then(() => toast.success('Password copied')); }}
      className="rounded-md p-1 text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground motion-reduce:transition-none">
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}

function roleOf(admin: Admin): TeamRole {
  return admin.platform_role ?? (admin.is_primary_super_admin ? 'super_admin' : 'manager');
}

const FIELD = 'w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';
const EMPTY_FORM = { name: '', email: '', role: 'manager' as TeamRole, password: '', confirm: '' };

export default function ManageAdminsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [creating, setCreating] = useState(false);
  /** Set while editing: the member being changed (the form is shared with Add). */
  const [editing, setEditing] = useState<Admin | null>(null);
  const [deleting, setDeleting] = useState<Admin | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    // Only a super admin can access this page
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
      const data = await callTeam({ action: 'list' });
      setAdmins(data.members || []);
    } catch (error: any) {
      console.error('Error loading admins:', error);
      toast.error(`Could not load the team: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const mismatch = formData.password !== formData.confirm && (!!formData.confirm || (!!editing && !!formData.password));
  const tooShort = !!formData.password && formData.password.length < 8;

  const openEdit = (admin: Admin) => {
    setEditing(admin);
    setFormData({ name: admin.name ?? '', email: admin.email ?? '', role: roleOf(admin), password: '', confirm: '' });
    setShowCreateModal(true);
  };

  /** Deactivate / reactivate / delete: one request, then the list from the server. */
  const runAction = async (admin: Admin, action: 'deactivate' | 'reactivate' | 'delete', done: string) => {
    setBusyId(admin.id);
    try {
      await callTeam({ action, id: admin.id });
      toast.success(done);
      setDeleting(null);
      await loadAdmins();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const closeModal = () => {
    setEditing(null);
    setShowCreateModal(false);
    setFormData(EMPTY_FORM);
    setShowPassword(false);
    setShowConfirm(false);
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password !== formData.confirm) {
      toast.error('The passwords do not match.');
      return;
    }
    setCreating(true);

    try {
      if (editing) {
        await callTeam({
          action: 'update',
          id: editing.id,
          name: formData.name,
          email: formData.email,
          role: formData.role,
          ...(formData.password ? { password: formData.password } : {}),
        });
        closeModal();
        loadAdmins();
        toast.success('Changes saved');
        return;
      }
      await callTeam({
        action: 'create',
        name: formData.name,
        email: formData.email,
        password: formData.password,
        role: formData.role,
      });
      closeModal();
      loadAdmins();
      toast.success(`${ROLE_LABEL[formData.role]} added`);
    } catch (error: any) {
      toast.error(`${editing ? 'Could not save' : 'Error creating account'}: ${error.message}`);
    } finally {
      setCreating(false);
    }
  };

  if (!user?.is_primary_super_admin) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xl text-red-600">Access denied. Super admins only.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <TableSkeleton
        rows={3}
        columns={5}
        title="Manage Admins"
        subtitle="Your team on the Drive247 dashboard"
      />
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-between sm:items-start sm:gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Manage Admins</h1>
          <p className="text-sm text-muted-foreground">
            Your team on the Drive247 dashboard · <span className="text-red-600">Super admins only</span>
          </p>
        </div>
        <div className={HEADER_ACTIONS}>
          <Button className={HEADER_PRIMARY} onClick={() => setShowCreateModal(true)}>
            <Plus />
            Add Team Member
          </Button>
        </div>
      </div>

      {/* `overflow-x-auto`, not `overflow-hidden`: this table is wider than a
          phone and the card was CLIPPING the columns past the fold with no way
          to reach them. Any non-visible overflow still rounds the corners. */}
      <div className="overflow-x-auto rounded-4xl bg-card shadow-sm ring-1 ring-foreground/10">
        <table className="min-w-full divide-y divide-dark-border">
          <thead className="bg-card/95">
            <tr>
              {['Name', 'Email', 'Role', 'Password', 'Created', 'Actions'].map((h) => (
                <th key={h} className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-dark-card divide-y divide-dark-border">
            {admins.map((admin) => {
              const role = roleOf(admin);
              const self = admin.id === user?.id;
              const busy = busyId === admin.id;
              return (
                <tr key={admin.id} className={`hover:bg-[hsl(var(--v2-row-hover,var(--muted)_/_0.5))] ${admin.is_active ? '' : 'opacity-60'}`}>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {admin.name}
                      {self && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                      {!admin.is_active && (
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full border border-red-500/25 bg-red-500/10 text-red-600">Inactive</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="text-sm text-muted-foreground">{admin.email}</div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full border ${role === 'super_admin'
                      ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/25'
                      : 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))] border-blue-500/25'}`}>
                      {ROLE_LABEL[role]}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {admin.password ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm text-foreground">{admin.password}</span>
                        <CopyButton value={admin.password} />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Not stored</span>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-muted-foreground">
                    {new Date(admin.created_at).toLocaleDateString('en-US')}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <RowAction label="Edit" onClick={() => openEdit(admin)} disabled={busy}>
                        <Pencil className="h-4 w-4" />
                      </RowAction>
                      {/* Never yourself: you would lock yourself out. */}
                      {!self && (
                        <RowAction label={admin.is_active ? 'Deactivate' : 'Reactivate'} disabled={busy}
                          tone={admin.is_active ? 'warn' : 'ok'}
                          onClick={() => void runAction(admin, admin.is_active ? 'deactivate' : 'reactivate', admin.is_active ? `${admin.name} deactivated` : `${admin.name} reactivated`)}>
                          <Power className="h-4 w-4" />
                        </RowAction>
                      )}
                      {!self && (
                        <RowAction label="Delete" tone="danger" disabled={busy} onClick={() => setDeleting(admin)}>
                          <Trash2 className="h-4 w-4" />
                        </RowAction>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Team Member Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/30 supports-[backdrop-filter]:backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none">
          <div className="w-full max-w-md max-h-full overflow-y-auto rounded-4xl bg-card p-5 sm:p-8 shadow-sm ring-1 ring-foreground/10 animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-4">{editing ? 'Edit Team Member' : 'Add Team Member'}</h2>

            <form onSubmit={handleCreateAdmin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Full Name *</label>
                <input type="text" required value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={FIELD} placeholder="John Doe" />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Email *</label>
                <input type="email" required value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className={FIELD} placeholder="name@example.com" />
              </div>

              <div>
                <span className="block text-sm font-medium text-muted-foreground mb-1">Role *</span>
                <div role="radiogroup" aria-label="Role" className="grid grid-cols-2 gap-2">
                  {ROLES.map((r) => (
                    <button key={r.value} type="button" role="radio" aria-checked={formData.role === r.value}
                      onClick={() => setFormData({ ...formData, role: r.value })}
                      className={`rounded-md border px-3 py-2 text-sm transition-colors duration-200 ease-out motion-reduce:transition-none ${formData.role === r.value
                        ? 'border-primary bg-primary/10 font-medium text-primary'
                        : 'border-dark-border text-foreground hover:bg-[hsl(var(--v2-row-hover,var(--muted)_/_0.5))]'}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">{editing ? 'New Password' : 'Password *'}</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} required={!editing} minLength={8} maxLength={72} value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className={`${FIELD} pr-10`} placeholder={editing ? 'Leave blank to keep the current one' : 'Minimum 8 characters'} autoComplete="new-password" />
                  <EyeButton shown={showPassword} onClick={() => setShowPassword((v) => !v)} />
                </div>
                {tooShort && <p className="mt-1 text-xs text-red-600">At least 8 characters.</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">{editing ? 'Confirm New Password' : 'Confirm Password *'}</label>
                <div className="relative">
                  <input type={showConfirm ? 'text' : 'password'} required={!editing || !!formData.password} value={formData.confirm}
                    onChange={(e) => setFormData({ ...formData, confirm: e.target.value })}
                    className={`${FIELD} pr-10 ${mismatch ? 'border-red-500' : ''}`} placeholder="Type it again" autoComplete="new-password" />
                  <EyeButton shown={showConfirm} onClick={() => setShowConfirm((v) => !v)} />
                </div>
                {mismatch && <p className="mt-1 text-xs text-red-600">The passwords do not match.</p>}
              </div>

              <div className="bg-yellow-500/10 border border-yellow-700 rounded-md p-3">
                <p className="text-xs text-yellow-600">
                  {formData.role === 'super_admin'
                    ? 'Super admins have full access and can add other team members.'
                    : 'Full dashboard access. Only super admins can add team members.'}
                </p>
              </div>

              <div className="flex space-x-3 mt-6">
                <button type="button" onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-dark-border rounded-md text-muted-foreground hover:bg-[hsl(var(--v2-row-hover,var(--muted)_/_0.5))]">
                  Cancel
                </button>
                <button type="submit" disabled={creating || mismatch || tooShort}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/80 disabled:opacity-50">
                  {creating ? (editing ? 'Saving...' : 'Creating...') : (editing ? 'Save Changes' : 'Create Account')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleting && (
        <div className="fixed inset-0 bg-black/30 supports-[backdrop-filter]:backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none">
          <div className="w-full max-w-md max-h-full overflow-y-auto rounded-4xl bg-card p-5 sm:p-8 shadow-sm ring-1 ring-foreground/10 animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-2 [overflow-wrap:anywhere]">Delete {deleting.name}?</h2>
            <p className="text-sm text-muted-foreground">
              <span className="[overflow-wrap:anywhere]">{deleting.email}</span> loses access straight away and is removed from the team. This cannot be undone. To keep the account for later, deactivate it instead.
            </p>
            <div className="flex space-x-3 mt-6">
              <button type="button" onClick={() => setDeleting(null)} disabled={busyId === deleting.id}
                className="flex-1 px-4 py-2 border border-dark-border rounded-md text-muted-foreground hover:bg-[hsl(var(--v2-row-hover,var(--muted)_/_0.5))]">
                Cancel
              </button>
              <button type="button" disabled={busyId === deleting.id}
                onClick={() => void runAction(deleting, 'delete', `${deleting.name} deleted`)}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-600/85 disabled:opacity-50">
                {busyId === deleting.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RowAction({ label, onClick, disabled, tone, children }: {
  label: string; onClick: () => void; disabled?: boolean; tone?: 'warn' | 'ok' | 'danger'; children: React.ReactNode;
}) {
  const color = tone === 'danger' ? 'hover:text-red-600 hover:bg-red-500/10'
    : tone === 'warn' ? 'hover:text-yellow-600 hover:bg-yellow-500/10'
    : tone === 'ok' ? 'text-green-600 hover:bg-green-500/10'
    : 'hover:text-primary hover:bg-primary/10';
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`rounded-md p-1.5 max-md:p-2.5 text-muted-foreground transition-colors duration-200 ease-out motion-reduce:transition-none disabled:opacity-40 ${color}`}>
      {children}
    </button>
  );
}
