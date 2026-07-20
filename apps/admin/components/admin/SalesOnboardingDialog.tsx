'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Copy, CheckCircle, Loader2, PartyPopper } from 'lucide-react';

interface OnboardingResult {
  tenantId: string;
  slug: string;
  companyName: string;
  adminEmail: string;
  adminPassword: string;
  portalUrl: string;
  bookingUrl: string;
  subscriptionAmount: number; // cents
  subscriptionCurrency: string;
  message: string;
}

interface SalesOnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

const EMPTY_FORM = {
  firstName: '',
  companyName: '',
  slug: '',
  contactEmail: '',
  businessPhone: '',
  tenantType: 'production' as 'production' | 'test',
  subscriptionAmount: '',
  location: '',
  vehicleType: '',
  fleetSize: '',
  operatingHours: '',
  businessColours: '',
  logoUrl: '',
  wantsMarketing: false,
  hasMetaAdAccount: false,
  metaDailyBudget: '',
  otherInfo: '',
};

const currencySymbol = (currency: string): string => {
  switch ((currency || 'usd').toLowerCase()) {
    case 'usd':
      return '$';
    case 'gbp':
      return '£';
    case 'eur':
      return '€';
    case 'aed':
      return 'AED ';
    default:
      return currency.toUpperCase() + ' ';
  }
};

export default function SalesOnboardingDialog({ open, onOpenChange, onCreated }: SalesOnboardingDialogProps) {
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [creating, setCreating] = useState(false);
  const [formErrors, setFormErrors] = useState<{ slug?: string; subscriptionAmount?: string }>({});
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [showResult, setShowResult] = useState(false);

  const validateSlug = (slug: string): string | null => {
    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (cleanSlug.length < 3) return 'Slug must be at least 3 characters long';
    if (cleanSlug.length > 50) return 'Slug must be 50 characters or less';
    if (!/^[a-z][a-z0-9-]*$/.test(cleanSlug))
      return 'Slug must start with a letter and contain only letters, numbers, and hyphens';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const slug = formData.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const slugError = validateSlug(slug);
    const amount = parseFloat(formData.subscriptionAmount);
    const amountError = !Number.isFinite(amount) || amount <= 0 ? 'Enter a monthly amount greater than 0' : null;

    if (slugError || amountError) {
      setFormErrors({ slug: slugError || undefined, subscriptionAmount: amountError || undefined });
      return;
    }
    setFormErrors({});
    setCreating(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-sales-onboarding', {
        body: {
          companyName: formData.companyName.trim(),
          firstName: formData.firstName.trim() || undefined,
          slug,
          contactEmail: formData.contactEmail.trim(),
          businessPhone: formData.businessPhone.trim() || undefined,
          vehicleType: formData.vehicleType.trim() || undefined,
          fleetSize: formData.fleetSize.trim() || undefined,
          location: formData.location.trim() || undefined,
          operatingHours: formData.operatingHours.trim() || undefined,
          businessColours: formData.businessColours.trim() || undefined,
          logoUrl: formData.logoUrl.trim() || undefined,
          wantsMarketing: formData.wantsMarketing,
          hasMetaAdAccount: formData.hasMetaAdAccount,
          metaDailyBudget: formData.metaDailyBudget.trim() || undefined,
          otherInfo: formData.otherInfo.trim() || undefined,
          tenantType: formData.tenantType,
          subscriptionAmount: amount,
          subscriptionCurrency: 'usd',
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.success) throw new Error('Onboarding failed — no data returned');

      setResult({
        tenantId: data.tenantId,
        slug: data.slug,
        companyName: data.companyName,
        adminEmail: data.adminEmail,
        adminPassword: data.adminPassword,
        portalUrl: data.portalUrl,
        bookingUrl: data.bookingUrl,
        subscriptionAmount: data.subscriptionAmount,
        subscriptionCurrency: data.subscriptionCurrency,
        message: data.message,
      });
      setShowResult(true);
      onOpenChange(false);
      setFormData({ ...EMPTY_FORM });
      onCreated?.();
    } catch (err: any) {
      toast.error(`Onboarding failed: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard!`);
  };

  return (
    <>
      {/* Onboarding form */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Onboarding</DialogTitle>
            <DialogDescription>
              Provision a new rental company — creates their portal, branding, credits and paywall in one step.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">First Name</Label>
                <Input
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder="George"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Rental Business Name *</Label>
                <Input
                  required
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  placeholder="Acme Rentals"
                />
              </div>
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
                    if (newSlug.length >= 3) setFormErrors({ ...formErrors, slug: undefined });
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Business Email *</Label>
                <Input
                  type="email"
                  required
                  value={formData.contactEmail}
                  onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                  placeholder="admin@acmerentals.com"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Business Phone</Label>
                <Input
                  value={formData.businessPhone}
                  onChange={(e) => setFormData({ ...formData, businessPhone: e.target.value })}
                  placeholder="+1 555 123 4567"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    className={cn(
                      'flex-1',
                      formData.tenantType === 'test' && 'bg-warning hover:bg-warning/90 text-warning-foreground',
                    )}
                  >
                    Test
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Production = live money (real paywall). Test = safe end-to-end.
                </p>
              </div>
              <div>
                <Label className="mb-1.5 block">Subscription Amount ($/month) *</Label>
                <Input
                  type="number"
                  required
                  min="1"
                  step="1"
                  value={formData.subscriptionAmount}
                  onChange={(e) => {
                    setFormData({ ...formData, subscriptionAmount: e.target.value });
                    if (formErrors.subscriptionAmount) setFormErrors({ ...formErrors, subscriptionAmount: undefined });
                  }}
                  className={formErrors.subscriptionAmount ? 'border-destructive' : ''}
                  placeholder="300"
                />
                {formErrors.subscriptionAmount ? (
                  <p className="text-xs text-destructive mt-1">{formErrors.subscriptionAmount}</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Charged monthly through the paywall.</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Location / Territory</Label>
                <Input
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Los Angeles, CA"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Vehicle Type</Label>
                <Input
                  value={formData.vehicleType}
                  onChange={(e) => setFormData({ ...formData, vehicleType: e.target.value })}
                  placeholder="Luxury SUVs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Fleet Size</Label>
                <Input
                  value={formData.fleetSize}
                  onChange={(e) => setFormData({ ...formData, fleetSize: e.target.value })}
                  placeholder="12"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Operating Hours</Label>
                <Input
                  value={formData.operatingHours}
                  onChange={(e) => setFormData({ ...formData, operatingHours: e.target.value })}
                  placeholder="Mon–Sat 9am–6pm"
                />
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Business Colours (for website)</Label>
              <Input
                value={formData.businessColours}
                onChange={(e) => setFormData({ ...formData, businessColours: e.target.value })}
                placeholder="Black and Gold, minimalistic"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Free text — turned into a full brand palette automatically.
              </p>
            </div>

            <div>
              <Label className="mb-1.5 block">Logo URL</Label>
              <Input
                type="url"
                value={formData.logoUrl}
                onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
                placeholder="https://example.com/logo.png"
              />
              <p className="text-xs text-muted-foreground mt-1">Optional — the client can upload their own later.</p>
            </div>

            <div className="space-y-3 rounded-md border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Marketing add-on</Label>
                  <p className="text-xs text-muted-foreground">Client wants the paid marketing package.</p>
                </div>
                <Switch
                  checked={formData.wantsMarketing}
                  onCheckedChange={(v) => setFormData({ ...formData, wantsMarketing: v })}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Has Meta ad account</Label>
                  <p className="text-xs text-muted-foreground">Already has a Facebook / Instagram ad account.</p>
                </div>
                <Switch
                  checked={formData.hasMetaAdAccount}
                  onCheckedChange={(v) => setFormData({ ...formData, hasMetaAdAccount: v })}
                />
              </div>
              {formData.hasMetaAdAccount && (
                <div>
                  <Label className="mb-1.5 block">Meta daily budget</Label>
                  <Input
                    value={formData.metaDailyBudget}
                    onChange={(e) => setFormData({ ...formData, metaDailyBudget: e.target.value })}
                    placeholder="$50/day"
                  />
                </div>
              )}
            </div>

            <div>
              <Label className="mb-1.5 block">Any other info</Label>
              <Textarea
                rows={3}
                value={formData.otherInfo}
                onChange={(e) => setFormData({ ...formData, otherInfo: e.target.value })}
                placeholder="Anything else worth noting for this onboarding..."
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  setFormErrors({});
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                {creating ? 'Provisioning...' : 'Create Onboarding'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Send to client dialog */}
      <Dialog
        open={showResult}
        onOpenChange={(o) => {
          if (!o) {
            setShowResult(false);
            setResult(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PartyPopper className="h-5 w-5 text-success" />
              {result?.companyName} is ready — send to client
            </DialogTitle>
            <DialogDescription>
              Copy this message and send it to the client. Their password only shows here — it is not stored.
            </DialogDescription>
          </DialogHeader>

          {result && (
            <>
              {/* Copy-paste message */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Client message</Label>
                  <Button size="sm" onClick={() => copyToClipboard(result.message, 'Message')}>
                    <Copy className="h-4 w-4" />
                    Copy message
                  </Button>
                </div>
                <Textarea
                  readOnly
                  value={result.message}
                  rows={12}
                  className="font-mono text-xs leading-relaxed"
                  onFocus={(e) => e.currentTarget.select()}
                />
              </div>

              {/* Individual copy chips */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Details</h3>
                  {[
                    ['Email', result.adminEmail],
                    ['Password', result.adminPassword],
                    ['Portal URL', result.portalUrl],
                    ['Booking URL', result.bookingUrl],
                    [
                      'Subscription',
                      `${currencySymbol(result.subscriptionCurrency)}${(result.subscriptionAmount / 100).toFixed(2)}/month`,
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <Label className="text-xs mb-1 block">{label}</Label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-muted/40 px-3 py-2 rounded-md border border-border text-sm font-mono break-all">
                          {value}
                        </code>
                        <Button variant="outline" size="sm" onClick={() => copyToClipboard(value, label)}>
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
            <Button
              onClick={() => {
                setShowResult(false);
                setResult(null);
              }}
            >
              <CheckCircle className="h-4 w-4" />
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
