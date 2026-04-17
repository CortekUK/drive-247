'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { tenantsApi } from '@/lib/api';
import { toast } from 'sonner';
import type { TenantDetail } from '@drive247/shared-types';
import {
  Button, Input, Label, Card, CardHeader, CardTitle, CardContent,
  Badge, Separator,
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogTrigger,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Alert, AlertDescription,
} from '@drive247/ui';

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAdminName, setEditAdminName] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchTenant = () => {
    setLoading(true);
    tenantsApi
      .getById(id)
      .then(({ data: res }) => {
        if (res.success) {
          setTenant(res.data);
          setEditName(res.data.companyName);
          setEditSlug(res.data.slug);
          setEditEmail(res.data.contactEmail || '');
          setEditAdminName(res.data.adminName || '');
          setEditStatus(res.data.status);
        }
      })
      .catch(() => toast.error('Failed to load tenant'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTenant(); }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      if (editName !== tenant?.companyName) payload.companyName = editName;
      if (editSlug !== tenant?.slug) payload.slug = editSlug;
      if (editEmail !== (tenant?.contactEmail || '')) payload.contactEmail = editEmail;
      if (editAdminName !== (tenant?.adminName || '')) payload.adminName = editAdminName || null;
      if (editStatus !== tenant?.status) payload.status = editStatus;

      if (Object.keys(payload).length === 0) {
        setEditing(false);
        return;
      }

      await tenantsApi.update(id, payload);
      toast.success('Tenant updated');
      setEditing(false);
      fetchTenant();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await tenantsApi.remove(id);
      toast.success('Tenant deleted');
      router.push('/tenants');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><p className="text-sm text-muted-foreground">Loading...</p></div>;
  }

  if (!tenant) {
    return <div className="text-center py-20"><p className="text-muted-foreground">Tenant not found</p></div>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.push('/tenants')} className="mb-2">
            ← Back to list
          </Button>
          <h2 className="text-[30px] font-medium text-[#080812]">{tenant.companyName}</h2>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>
          )}
        </div>
      </div>

      {/* Info Card */}
      <Card>
        <CardHeader><CardTitle>Tenant Information</CardTitle></CardHeader>
        <CardContent>
          {editing ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Company Name</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Slug</Label>
                <Input value={editSlug} onChange={(e) => setEditSlug(e.target.value)} className="font-mono text-sm" />
                {editSlug !== tenant.slug && (
                  <p className="text-xs text-[#d97706]">Changing slug will change portal and booking URLs</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Contact Email</Label>
                <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Admin Name</Label>
                <Input value={editAdminName} onChange={(e) => setEditAdminName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Company Name</p>
                <p className="font-medium">{tenant.companyName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Slug</p>
                <p className="font-mono">{tenant.slug}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Contact Email</p>
                <p className="font-medium">{tenant.contactEmail || '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Admin Name</p>
                <p className="font-medium">{tenant.adminName || '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Type</p>
                <Badge variant={tenant.tenantType === 'production' ? 'default' : 'secondary'}>
                  {tenant.tenantType}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <span className={
                  tenant.status === 'active' ? 'text-[#16a34a] font-medium' :
                  tenant.status === 'suspended' ? 'text-[#dc2626] font-medium' :
                  'text-[#d97706] font-medium'
                }>
                  {tenant.status}
                </span>
              </div>
              <div>
                <p className="text-muted-foreground">Created</p>
                <p>{new Date(tenant.createdAt).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ID</p>
                <p className="font-mono text-xs">{tenant.id}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Staff Users */}
      <Card>
        <CardHeader>
          <CardTitle>Staff Users ({tenant.users.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff]">
                <TableHead className="text-[#6366f1]">Name</TableHead>
                <TableHead className="text-[#6366f1]">Email</TableHead>
                <TableHead className="text-[#6366f1]">Role</TableHead>
                <TableHead className="text-[#6366f1]">Status</TableHead>
                <TableHead className="text-[#6366f1]">Last Login</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenant.users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-sm">
                    No staff users
                  </TableCell>
                </TableRow>
              ) : (
                tenant.users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name || '—'}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell><Badge variant="secondary">{u.role}</Badge></TableCell>
                    <TableCell>
                      <span className={u.isActive ? 'text-[#16a34a] font-medium' : 'text-[#dc2626] font-medium'}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-[#dc2626]/20">
        <CardHeader>
          <CardTitle className="text-[#dc2626]">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Delete this tenant</p>
              <p className="text-sm text-muted-foreground">
                This will permanently delete the tenant, all users, and all associated data.
              </p>
            </div>
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive">Delete Tenant</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete {tenant.companyName}?</DialogTitle>
                  <DialogDescription>
                    This action cannot be undone. Type the tenant slug to confirm.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-3">
                  <p className="text-sm">
                    Type <code className="bg-muted px-2 py-0.5 rounded font-mono">{tenant.slug}</code> to confirm:
                  </p>
                  <Input
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder={tenant.slug}
                    className="font-mono"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteConfirm(''); }}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={deleteConfirm !== tenant.slug}
                    onClick={handleDelete}
                  >
                    Delete Permanently
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
