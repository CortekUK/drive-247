'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Copy, AlertTriangle, CheckCircle } from 'lucide-react';

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

interface CreateTenantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export default function CreateTenantDialog({ open, onOpenChange, onCreated }: CreateTenantDialogProps) {
  const [formData, setFormData] = useState({
    companyName: '',
    adminName: '',
    slug: '',
    contactEmail: '',
    tenantType: 'production' as 'production' | 'test',
  });
  const [creating, setCreating] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [credentials, setCredentials] = useState<TenantCredentials | null>(null);
  const [formErrors, setFormErrors] = useState<{ slug?: string }>({});

  // New clients get a simple, predictable first-login password derived from their
  // rental name: "<rentalname>123!" (e.g. slug "drive-hustle" -> "drivehustle123!").
  // admin-create-user sets must_change_password=true, so the client is prompted to
  // set their own password on first login.
  const buildDefaultPassword = (slug: string) => {
    const name = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${name || 'rental'}123!`;
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
      const adminPassword = buildDefaultPassword(slug);

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

      setCredentials({
        tenantId: tenant.id,
        companyName: formData.companyName,
        slug: slug,
        contactEmail: formData.contactEmail,
        adminEmail: adminEmail,
        adminPassword: adminPassword,
        portalUrl: `https://${slug}.portal.drive-247.com`,
        bookingUrl: `https://${slug}.drive-247.com`,
      });
      setShowDetailsModal(true);
      onOpenChange(false);
      setFormData({ companyName: '', adminName: '', slug: '', contactEmail: '', tenantType: 'production' });
      onCreated?.();
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
    if (!credentials) return;

    const text = `
=== ${credentials.companyName} - Rental Company Credentials ===

Company Information:
- Company Name: ${credentials.companyName}
- Slug: ${credentials.slug}
- Contact Email: ${credentials.contactEmail}

Admin User Credentials:
- Email: ${credentials.adminEmail}
- Password: ${credentials.adminPassword}

Access URLs:
- Rental Portal (Admin Dashboard): ${credentials.portalUrl}
- Booking Site (Customer Facing): ${credentials.bookingUrl}
    `.trim();

    navigator.clipboard.writeText(text);
    toast.success('All credentials copied to clipboard!');
  };

  return (
    <>
      {/* Create Tenant Dialog */}
      <Dialog open={open} onOpenChange={onOpenChange}>
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
                onClick={() => { onOpenChange(false); setFormErrors({}); }}
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
      <Dialog open={showDetailsModal} onOpenChange={(o) => {
        if (!o) { setShowDetailsModal(false); setCredentials(null); }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-success" />
              {credentials?.companyName} - Complete Setup
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

          {credentials && (
            <>
              {/* Company Information */}
              <Card>
                <CardContent className="p-4 space-y-2">
                  <h3 className="text-sm font-semibold mb-3">Company Information</h3>
                  {[
                    ['Company Name', credentials.companyName],
                    ['Slug', credentials.slug],
                    ['Portal', `${credentials.slug}.portal.drive-247.com`],
                    ['Booking', `${credentials.slug}.drive-247.com`],
                    ['Contact', credentials.contactEmail],
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
                    ['Email', credentials.adminEmail],
                    ['Password', credentials.adminPassword],
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
                    ['Rental Portal', credentials.portalUrl],
                    ['Booking Site', credentials.bookingUrl],
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
            <Button onClick={() => { setShowDetailsModal(false); setCredentials(null); }}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
