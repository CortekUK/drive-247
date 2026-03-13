'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Plus,
  ArrowRight,
  Copy,
  AlertTriangle,
  CheckCircle,
  Search,
  Star,
  Building2,
} from 'lucide-react';

interface Tenant {
  id: string;
  slug: string;
  company_name: string;
  admin_name: string | null;
  status: string;
  contact_email: string;
  created_at: string;
  tenant_type: 'production' | 'test' | null;
}

interface TenantCredentials {
  tenantId: string;
  companyName: string;
  slug: string;
  contactEmail: string;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('admin_favorite_tenants');
        return saved ? new Set(JSON.parse(saved)) : new Set();
      } catch { return new Set(); }
    }
    return new Set();
  });
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
    if (cleanSlug.length < 3) return 'Slug must be at least 3 characters long';
    if (cleanSlug.length > 50) return 'Slug must be 50 characters or less';
    if (!/^[a-z][a-z0-9-]*$/.test(cleanSlug)) return 'Slug must start with a letter and contain only letters, numbers, and hyphens';
    return null;
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();

    const slug = formData.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const slugError = validateSlug(slug);
    if (slugError) {
      setFormErrors({ slug: slugError });
      return;
    }
    setFormErrors({});
    setCreating(true);

    try {
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .insert([{
          company_name: formData.companyName,
          admin_name: formData.adminName || null,
          slug: slug,
          contact_email: formData.contactEmail,
          status: 'active',
          tenant_type: formData.tenantType,
        }])
        .select()
        .single();

      if (tenantError) throw tenantError;

      const adminEmail = formData.contactEmail;
      const adminPassword = generateRandomPassword();

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
          tenant_id: tenant.id,
        },
      });

      if (createUserError) {
        await supabase.from('tenants').delete().eq('id', tenant.id);
        throw new Error(`Failed to create admin user: ${createUserError.message}`);
      }

      if (createUserData?.error) {
        await supabase.from('tenants').delete().eq('id', tenant.id);
        throw new Error(`Failed to create admin user: ${createUserData.error}`);
      }

      const credentials: TenantCredentials = {
        tenantId: tenant.id,
        companyName: formData.companyName,
        slug: slug,
        contactEmail: formData.contactEmail,
        adminEmail: adminEmail,
        adminPassword: adminPassword,
        portalUrl: `https://${slug}.portal.drive-247.com`,
        bookingUrl: `https://${slug}.drive-247.com`,
      };

      setSelectedTenantCreds(credentials);
      setShowDetailsModal(true);
      setShowCreateModal(false);
      setFormData({ companyName: '', adminName: '', slug: '', contactEmail: '', tenantType: 'production' });
      loadTenants();
    } catch (error: any) {
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

Admin User Credentials:
- Email: ${selectedTenantCreds.adminEmail}
- Password: ${selectedTenantCreds.adminPassword}

Access URLs:
- Rental Portal (Admin Dashboard): ${selectedTenantCreds.portalUrl}
- Booking Site (Customer Facing): ${selectedTenantCreds.bookingUrl}
    `.trim();

    navigator.clipboard.writeText(text);
    toast.success('All credentials copied to clipboard!');
  };

  const toggleFavorite = (tenantId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(tenantId)) next.delete(tenantId);
      else next.add(tenantId);
      localStorage.setItem('admin_favorite_tenants', JSON.stringify([...next]));
      return next;
    });
  };

  const filteredTenants = tenants
    .filter((t) => {
      if (showFavoritesOnly && !favorites.has(t.id)) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        t.company_name?.toLowerCase().includes(q) ||
        t.slug?.toLowerCase().includes(q) ||
        t.contact_email?.toLowerCase().includes(q) ||
        t.admin_name?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      // Favorites first
      const aFav = favorites.has(a.id) ? 0 : 1;
      const bFav = favorites.has(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return 0; // preserve original order otherwise
    });

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-80 mt-2" />
          </div>
          <Skeleton className="h-10 w-44" />
        </div>
        <Skeleton className="h-10 w-60" />
        <Card>
          <CardContent className="p-0">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b last:border-0">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-24 ml-auto" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15 glow-purple-sm">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Rental Companies</h1>
            <p className="text-sm text-muted-foreground">
              Manage all rental companies · {tenants.length} total
            </p>
          </div>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4" />
          Add New Rental
        </Button>
      </div>

      {/* Search & Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, slug, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Favorites toggle */}
            <button
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all border',
                showFavoritesOnly
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 glow-amber'
                  : 'bg-secondary text-muted-foreground border-transparent hover:bg-secondary/80'
              )}
            >
              <Star className={cn('h-4 w-4', showFavoritesOnly && 'fill-amber-400')} />
              Favorites{favorites.size > 0 && ` (${favorites.size})`}
            </button>

            {/* Type pills */}
            <div className="flex items-center gap-1.5">
              {(['all', 'production', 'test'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(type)}
                  className={cn(
                    'px-3 py-2 rounded-md text-xs font-semibold transition-all capitalize border',
                    typeFilter === type
                      ? type === 'production'
                        ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                        : type === 'test'
                        ? 'bg-warning/15 text-amber-400 border-warning/30'
                        : 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-secondary text-muted-foreground border-transparent hover:bg-secondary/80'
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-primary/5 hover:bg-primary/5">
              <TableHead className="w-10"></TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTenants.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell className="pr-0">
                  <button
                    onClick={() => toggleFavorite(tenant.id)}
                    className="p-1 rounded hover:bg-accent transition-colors"
                    title={favorites.has(tenant.id) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star
                      className={cn(
                        'h-4 w-4 transition-colors',
                        favorites.has(tenant.id)
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-muted-foreground/40 hover:text-muted-foreground'
                      )}
                    />
                  </button>
                </TableCell>
                <TableCell className="font-medium">{tenant.company_name}</TableCell>
                <TableCell>
                  {tenant.tenant_type ? (
                    <Badge variant={tenant.tenant_type === 'production' ? 'info' : 'warning'} className="capitalize whitespace-nowrap">
                      {tenant.tenant_type}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={tenant.status === 'active' ? 'success' : 'destructive'} className="capitalize whitespace-nowrap">
                    {tenant.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {new Date(tenant.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/admin/rentals/${tenant.id}`}>
                      View Details
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredTenants.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              {showFavoritesOnly
                ? 'No favorite companies yet. Star a company to add it here.'
                : searchQuery
                ? 'No companies match your search.'
                : 'No rental companies yet. Create one to get started.'}
            </p>
          </div>
        )}
      </Card>

      {/* Create Tenant Dialog */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Rental Company</DialogTitle>
            <DialogDescription>
              Create a new rental company with an initial admin user.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateTenant} className="space-y-4">
            <div>
              <Label className="mb-1.5 block">Company Name *</Label>
              <Input
                required
                value={formData.companyName}
                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                placeholder="Acme Rentals"
              />
            </div>

            <div>
              <Label className="mb-1.5 block">Admin Name</Label>
              <Input
                value={formData.adminName}
                onChange={(e) => setFormData({ ...formData, adminName: e.target.value })}
                placeholder="John Doe"
              />
            </div>

            <div>
              <Label className="mb-1.5 block">Slug (subdomain) *</Label>
              <Input
                required
                minLength={3}
                maxLength={50}
                value={formData.slug}
                onChange={(e) => {
                  setFormData({ ...formData, slug: e.target.value });
                  if (formErrors.slug) {
                    const newSlug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
                    if (newSlug.length >= 3) setFormErrors({});
                  }
                }}
                className={formErrors.slug ? 'border-destructive' : ''}
                placeholder="acme-rentals"
              />
              {formErrors.slug ? (
                <p className="text-xs text-destructive mt-1">{formErrors.slug}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  Portal: {formData.slug || 'slug'}.portal.drive-247.com | Booking: {formData.slug || 'slug'}.drive-247.com
                </p>
              )}
            </div>

            <div>
              <Label className="mb-1.5 block">Contact Email *</Label>
              <Input
                type="email"
                required
                value={formData.contactEmail}
                onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                placeholder="admin@acmerentals.com"
              />
            </div>

            <div>
              <Label className="mb-1.5 block">Tenant Type *</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={formData.tenantType === 'production' ? 'default' : 'outline'}
                  onClick={() => setFormData({ ...formData, tenantType: 'production' })}
                  className={cn('flex-1', formData.tenantType === 'production' && 'bg-success hover:bg-success/90')}
                >
                  Production
                </Button>
                <Button
                  type="button"
                  variant={formData.tenantType === 'test' ? 'default' : 'outline'}
                  onClick={() => setFormData({ ...formData, tenantType: 'test' })}
                  className={cn('flex-1', formData.tenantType === 'test' && 'bg-warning hover:bg-warning/90 text-warning-foreground')}
                >
                  Test
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Production = real customer, Test = internal/testing use
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setShowCreateModal(false); setFormErrors({}); }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? 'Creating...' : 'Create Company'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Credentials Dialog */}
      <Dialog open={showDetailsModal} onOpenChange={(open) => {
        if (!open) { setShowDetailsModal(false); setSelectedTenantCreds(null); }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-success" />
              {selectedTenantCreds?.companyName} - Complete Setup
            </DialogTitle>
            <DialogDescription>
              Rental company created successfully! Save these credentials securely.
            </DialogDescription>
          </DialogHeader>

          {/* Warning */}
          <div className="rounded-md bg-warning/10 border border-warning/30 p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
            <p className="text-sm text-warning">
              <strong>Important:</strong> These credentials will only be shown once. Please save them securely before closing this window.
            </p>
          </div>

          {selectedTenantCreds && (
            <>
              {/* Company Information */}
              <Card>
                <CardContent className="p-4 space-y-2">
                  <h3 className="text-sm font-semibold mb-3">Company Information</h3>
                  {[
                    ['Company Name', selectedTenantCreds.companyName],
                    ['Slug', selectedTenantCreds.slug],
                    ['Portal', `${selectedTenantCreds.slug}.portal.drive-247.com`],
                    ['Booking', `${selectedTenantCreds.slug}.drive-247.com`],
                    ['Contact', selectedTenantCreds.contactEmail],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">{label}:</span>
                      <span className="font-medium">{value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Admin Credentials */}
              <Card className="border-success/30">
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Admin User Credentials</h3>
                  <p className="text-xs text-muted-foreground">Initial admin account for the rental company</p>

                  {[
                    ['Email', selectedTenantCreds.adminEmail],
                    ['Password', selectedTenantCreds.adminPassword],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <Label className="text-xs mb-1 block">{label}</Label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-success/10 px-3 py-2 rounded-md border border-success/30 text-sm font-mono break-all">
                          {value}
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(value, label)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Access URLs */}
              <Card className="border-primary/30">
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Access URLs</h3>

                  {[
                    ['Rental Portal', selectedTenantCreds.portalUrl],
                    ['Booking Site', selectedTenantCreds.bookingUrl],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <Label className="text-xs mb-1 block">{label}</Label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-primary/10 px-3 py-2 rounded-md border border-primary/30 text-sm break-all">
                          {value}
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(value, label)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={copyAllCredentials}>
              <Copy className="h-4 w-4" />
              Copy All Credentials
            </Button>
            <Button onClick={() => { setShowDetailsModal(false); setSelectedTenantCreds(null); }}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
