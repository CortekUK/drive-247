'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { tenantsApi } from '@/lib/api';
import { toast } from 'sonner';
import type { TenantListItem } from '@drive247/shared-types';
import {
  Button, Input, Card, CardContent, Badge,
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogTrigger,
  Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Alert, AlertDescription,
} from '@drive247/ui';

export default function TenantsPage() {
  const [tenants, setTenants] = useState<TenantListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);

  const fetchTenants = () => {
    setLoading(true);
    tenantsApi
      .list({
        search: search || undefined,
        type: typeFilter !== 'all' ? typeFilter : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
      })
      .then(({ data: res }) => {
        if (res.success) setTenants(res.data);
      })
      .catch((err: any) => toast.error(err.response?.data?.message || 'Failed to load tenants'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTenants();
  }, [typeFilter, statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTenants();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[30px] font-medium text-[#080812]">Rental Companies</h2>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>Create Tenant</Button>
          </DialogTrigger>
          <CreateTenantDialog
            onClose={() => setCreateOpen(false)}
            onCreated={() => { setCreateOpen(false); fetchTenants(); }}
          />
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-end">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1">
          <Input
            placeholder="Search company, slug, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="production">Production</SelectItem>
            <SelectItem value="test">Test</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff]">
                <TableHead className="text-[#6366f1]">Company</TableHead>
                <TableHead className="text-[#6366f1]">Slug</TableHead>
                <TableHead className="text-[#6366f1]">Email</TableHead>
                <TableHead className="text-[#6366f1]">Type</TableHead>
                <TableHead className="text-[#6366f1]">Status</TableHead>
                <TableHead className="text-[#6366f1]">Staff</TableHead>
                <TableHead className="text-[#6366f1]">Created</TableHead>
                <TableHead className="text-[#6366f1] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <span className="text-muted-foreground text-sm">Loading...</span>
                  </TableCell>
                </TableRow>
              ) : tenants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <span className="text-muted-foreground text-sm">No tenants found</span>
                  </TableCell>
                </TableRow>
              ) : (
                tenants.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.companyName}</TableCell>
                    <TableCell className="font-mono text-xs">{t.slug}</TableCell>
                    <TableCell>{t.contactEmail || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={t.tenantType === 'production' ? 'default' : 'secondary'}>
                        {t.tenantType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className={
                        t.status === 'active' ? 'text-[#16a34a] font-medium' :
                        t.status === 'suspended' ? 'text-[#dc2626] font-medium' :
                        'text-[#d97706] font-medium'
                      }>
                        {t.status}
                      </span>
                    </TableCell>
                    <TableCell>{t.staffCount}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/tenants/${t.id}`}>
                        <Button variant="ghost" size="sm">View</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CreateTenantDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [companyName, setCompanyName] = useState('');
  const [slug, setSlug] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [tenantType, setTenantType] = useState<'production' | 'test'>('production');
  const [submitting, setSubmitting] = useState(false);
  const [credentials, setCredentials] = useState<{ email: string; password: string; portalUrl: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data: res } = await tenantsApi.create({
        companyName,
        slug,
        contactEmail,
        adminEmail,
        adminName: adminName || undefined,
        tenantType,
      });
      if (res.success) {
        setCredentials({
          email: res.data.admin.email,
          password: res.data.admin.password,
          portalUrl: res.data.portalUrl,
        });
        toast.success('Tenant created successfully');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create tenant');
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-generate slug from company name
  const handleCompanyNameChange = (value: string) => {
    setCompanyName(value);
    if (!slug || slug === companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) {
      setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    }
  };

  if (credentials) {
    return (
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Tenant Created</DialogTitle>
          <DialogDescription>Save these credentials — the password won't be shown again.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          <Alert>
            <AlertDescription className="space-y-2">
              <p><span className="font-medium">Admin Email:</span> {credentials.email}</p>
              <p><span className="font-medium">Password:</span> <code className="bg-muted px-2 py-0.5 rounded">{credentials.password}</code></p>
              <p><span className="font-medium">Portal URL:</span> {credentials.portalUrl}</p>
            </AlertDescription>
          </Alert>
          <p className="text-xs text-muted-foreground">
            The admin will be asked to change their password on first login.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(
                `Email: ${credentials.email}\nPassword: ${credentials.password}\nPortal: ${credentials.portalUrl}`
              );
              toast.success('Copied to clipboard');
            }}
          >
            Copy All
          </Button>
          <Button onClick={onCreated}>Done</Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="sm:max-w-[500px]">
      <DialogHeader>
        <DialogTitle>Create Rental Company</DialogTitle>
        <DialogDescription>
          Set up a new tenant. An admin user will be provisioned automatically.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit}>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input value={companyName} onChange={(e) => handleCompanyNameChange(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} required placeholder="my-company" className="font-mono text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Contact Email</Label>
              <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={tenantType} onValueChange={(v) => setTenantType(v as 'production' | 'test')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Production</SelectItem>
                  <SelectItem value="test">Test</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Admin Email</Label>
              <Input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Admin Name (optional)</Label>
              <Input value={adminName} onChange={(e) => setAdminName(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A secure password will be auto-generated for the admin account.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Tenant'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
