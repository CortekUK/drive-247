'use client';

/**
 * Quick setup — a rental company and its first admin, drawn as Northwind's
 * stepped "add" dialogs (portal add-vehicle / add-customer): one small idea
 * per screen, a picture, one line, two rows of fields
 * (components/admin/form-grid.tsx). The done screen is the hand-over.
 *
 * SAVES EXACTLY AS BEFORE: the same tenants insert (with the Square
 * invariants), the same admin-create-user call and the same rollback. The
 * payment rules come from payment-provider-picker.tsx, not a copy of them
 * (Ghulam, Oct 17 2026).
 */

import { useState } from 'react';
import {
  DEFAULT_PAYMENT_PROVIDER_SELECTION,
  OTHER_COUNTRY_OPTIONS,
  PROVIDER_OPTIONS,
  SQUARE_COUNTRY_OPTIONS,
  SQUARE_SUPPORTED_COUNTRIES,
  isCountrySupported,
  optionFor,
  paymentProviderTenantColumns,
  selectionWithCountry,
  validatePaymentProviderSelection,
  type PaymentProviderSelection,
} from '@/components/tenants/payment-provider-picker';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Copy, X } from 'lucide-react';
import {
  CONTROL,
  Cell,
  CopyRow,
  DoneScreen,
  FORM_DIALOG,
  FORM_DIALOG_WASH,
  Segmented,
  StepFooter,
  StepScreen,
  ToggleTile,
} from '@/components/admin/form-grid';
import { AddCustomerWhoArt } from '@/components/admin/illustrations/scenes/add-customer';
import { AddVehicleAddedArt, AddVehicleListingArt, AddVehiclePapersArt } from '@/components/admin/illustrations/scenes/add-vehicle';
import { PaymentsEmptyArt } from '@/components/admin/illustrations/scenes/payments';

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
  const [step, setStep] = useState(0);
  const [credentials, setCredentials] = useState<TenantCredentials | null>(null);
  const [formErrors, setFormErrors] = useState<{ companyName?: string; contactEmail?: string; slug?: string }>({});
  /** Set when a country change dropped Square, so the switch is never silent. */
  const [revertedFrom, setRevertedFrom] = useState<string | null>(null);
  /**
   * Payment provider is chosen ONCE, at creation, and is immutable afterwards.
   * The lead was explicit that this is never a toggle: switching a live tenant
   * between processors would strand in-flight payments, refunds and saved cards
   * on a rail the tenant no longer has credentials for.
   */
  const [providerSelection, setProviderSelection] = useState<PaymentProviderSelection>(
    DEFAULT_PAYMENT_PROVIDER_SELECTION,
  );
  const [providerError, setProviderError] = useState<string | null>(null);

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

  const handleCreateTenant = async () => {
    const slug = formData.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const slugError = validateSlug(slug);
    if (slugError) {
      setFormErrors({ slug: slugError });
      setStep(1);
      return;
    }

    // Square is only available in the countries Square actually operates in, and
    // the tenants table carries a CHECK to match. Catching it here turns a raw
    // constraint violation into a sentence the operator can act on.
    const providerProblem = validatePaymentProviderSelection(providerSelection);
    if (providerProblem) {
      setProviderError(providerProblem);
      return;
    }
    setProviderError(null);
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
          ...paymentProviderTenantColumns(providerSelection),
          // Square invariants, forced at creation rather than left to fail later.
          //
          // Square cannot vault a card from a hosted payment link, so every
          // feature that charges a stored credential with nobody present is
          // switched off for these tenants at birth. Doing it here — instead of
          // relying on a guard at money time — is what keeps an operator from
          // enabling installments in settings and discovering at the first
          // charge that Square never had the card.
          //
          // deposit_charge_enabled=true is the counterpart: with holds
          // unavailable, a Square deposit is collected as an ordinary charge.
          ...(providerSelection.paymentProvider === 'square'
            ? {
                deposit_charge_enabled: true,
                installments_enabled: false,
                auto_extend_enabled: false,
                payg_auto_reminders_enabled: false,
              }
            : {}),
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
      // The hand-over is the dialog's last screen, in the same frame.
      setStep(0);
      setRevertedFrom(null);
      setFormData({ companyName: '', adminName: '', slug: '', contactEmail: '', tenantType: 'production' });
      setProviderSelection(DEFAULT_PAYMENT_PROVIDER_SELECTION);
      setProviderError(null);
      onCreated?.();
    } catch (error: any) {
      let errorMessage = error.message;
      if (error.message?.includes('slug_length')) {
        errorMessage = 'Slug must be between 3 and 50 characters';
        setFormErrors({ slug: errorMessage });
        setStep(1);
      } else if (error.message?.includes('tenants_slug_key') || error.message?.includes('duplicate key')) {
        errorMessage = 'This slug is already taken. Please choose a different one.';
        setFormErrors({ slug: errorMessage });
        setStep(1);
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

  const provider = optionFor(providerSelection.paymentProvider);
  // Square adds one screen: what it cannot do, and the client's confirmation.
  const steps = provider.requiresPermanenceAck
    ? (['The company', 'Address', 'Payments', 'Square'] as const)
    : (['The company', 'Address', 'Payments'] as const);
  const last = step === steps.length - 1;

  /** Next: check only the screen being left, so a problem shows where it is. */
  const next = () => {
    if (step === 0) {
      const errs: typeof formErrors = {};
      if (!formData.companyName.trim()) errs.companyName = 'Enter the company name';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(formData.contactEmail.trim())) errs.contactEmail = 'Enter a valid email address';
      if (errs.companyName || errs.contactEmail) {
        setFormErrors(errs);
        return;
      }
    }
    if (step === 1) {
      const slugError = validateSlug(formData.slug);
      if (slugError) {
        setFormErrors({ slug: slugError });
        return;
      }
    }
    if (step === 2 && !providerSelection.country) {
      setProviderError('Select the country this company operates in.');
      return;
    }
    setFormErrors({});
    setProviderError(null);
    setStep(step + 1);
  };

  const close = () => {
    onOpenChange(false);
    setStep(0);
    setFormErrors({});
    setProviderError(null);
    setCredentials(null);
  };

  const field = (key: 'companyName' | 'adminName' | 'slug' | 'contactEmail', placeholder: string, type = 'text') => (
    <input
      type={type}
      value={formData[key]}
      placeholder={placeholder}
      maxLength={key === 'slug' ? 50 : 100}
      aria-invalid={(key !== 'adminName' && !!formErrors[key]) || undefined}
      onChange={(e) => {
        setFormData({ ...formData, [key]: e.target.value });
        if (key !== 'adminName' && formErrors[key]) setFormErrors({ ...formErrors, [key]: undefined });
      }}
      className={CONTROL}
      autoComplete="off"
    />
  );

  const slugPreview = formData.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'slug';
  const countryName = [...SQUARE_COUNTRY_OPTIONS, ...OTHER_COUNTRY_OPTIONS].find(
    (c) => c.code === providerSelection.country,
  )?.name;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent
        className={FORM_DIALOG}
        style={FORM_DIALOG_WASH}
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input:not([type=hidden]):not([type=file])')?.focus();
        }}
      >
        <DialogTitle className="sr-only">Add a rental company</DialogTitle>
        <DialogDescription className="sr-only">
          {credentials ? `${credentials.companyName} is ready` : steps[step]}
        </DialogDescription>

        {credentials ? (
          /* Done: the hand-over. The password only ever shows here. */
          <div className="flex flex-col">
            <DoneScreen
              art={AddVehicleAddedArt}
              title={`${credentials.companyName} is ready.`}
              line="Their portal and booking site are live. Save these now; the password only shows here."
            >
              <div className="rounded-2xl border border-foreground/10 bg-background/80 px-4">
                <CopyRow label="Email" value={credentials.adminEmail} onCopy={() => copyToClipboard(credentials.adminEmail, 'Email')} />
                <CopyRow label="Password" value={credentials.adminPassword} onCopy={() => copyToClipboard(credentials.adminPassword, 'Password')} />
                <CopyRow label="Portal" value={credentials.portalUrl} href={credentials.portalUrl} onCopy={() => copyToClipboard(credentials.portalUrl, 'Portal URL')} />
                <CopyRow label="Booking site" value={credentials.bookingUrl} href={credentials.bookingUrl} onCopy={() => copyToClipboard(credentials.bookingUrl, 'Booking URL')} />
              </div>
            </DoneScreen>
            <div className="flex items-center justify-between gap-2 px-4 py-4 sm:gap-4 sm:px-8">
              <Button type="button" variant="outline" className="h-10 rounded-full px-5" onClick={close}>
                Done
              </Button>
              <Button type="button" className="h-10 rounded-full px-5" onClick={copyAllCredentials}>
                <Copy className="size-4" /> Copy all
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (last) void handleCreateTenant();
              else next();
            }}
            className="flex flex-col"
          >
            {step === 0 && (
              <StepScreen
                stepKey={0}
                art={AddCustomerWhoArt}
                title="Which company is it?"
                line="Its name, and who looks after it. Their first admin login goes to this email."
              >
                <Cell label="Company name" required error={formErrors.companyName}>
                  {field('companyName', 'e.g. Acme Rentals')}
                </Cell>
                <Cell label="Admin name">{field('adminName', 'e.g. John Doe')}</Cell>
                <Cell label="Contact email" required className="col-span-2" error={formErrors.contactEmail}>
                  {field('contactEmail', 'admin@acmerentals.com', 'email')}
                </Cell>
              </StepScreen>
            )}

            {step === 1 && (
              <StepScreen
                stepKey={1}
                art={AddVehicleListingArt}
                title="Their address"
                line="The subdomain both their portal and their booking site live on."
              >
                <Cell
                  label="Subdomain"
                  required
                  className="col-span-2"
                  error={formErrors.slug}
                  hint={`${slugPreview}.portal.drive-247.com · ${slugPreview}.drive-247.com`}
                >
                  {field('slug', 'acme-rentals')}
                </Cell>
                <Cell
                  label="Type"
                  required
                  className="col-span-2"
                  hint={formData.tenantType === 'production' ? 'A real client' : 'For internal testing'}
                >
                  <Segmented
                    value={formData.tenantType}
                    options={[
                      { value: 'production', label: 'Production' },
                      { value: 'test', label: 'Test' },
                    ]}
                    onChange={(v) => setFormData({ ...formData, tenantType: v })}
                  />
                </Cell>
              </StepScreen>
            )}

            {step === 2 && (
              <StepScreen
                stepKey={2}
                art={PaymentsEmptyArt}
                title="How will they take payments?"
                line="This is permanent: it is locked the moment the company is created, and fixing it means starting again."
              >
                <Cell
                  label="Operating country"
                  required
                  className="col-span-2"
                  error={providerError ?? undefined}
                  hint={
                    revertedFrom
                      ? `Switched back to Stripe: ${revertedFrom} can't take payments in ${countryName ?? 'this country'}.`
                      : `Square works in ${SQUARE_SUPPORTED_COUNTRIES.join(', ')}. Everywhere else is Stripe.`
                  }
                >
                  <select
                    value={providerSelection.country ?? ''}
                    disabled={creating}
                    aria-invalid={!!providerError || undefined}
                    onChange={(e) => {
                      const { next: picked, revertedFrom: dropped } = selectionWithCountry(providerSelection, e.target.value);
                      setProviderSelection(picked);
                      setRevertedFrom(dropped);
                      setProviderError(null);
                    }}
                    className={cn(CONTROL, 'cursor-pointer', !providerSelection.country && 'text-muted-foreground/70')}
                  >
                    <option value="" disabled>
                      Where the business is registered for payments
                    </option>
                    <optgroup label="Stripe or Square">
                      {SQUARE_COUNTRY_OPTIONS.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Stripe only">
                      {OTHER_COUNTRY_OPTIONS.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </Cell>
                <Cell label="Processor" required className="col-span-2" hint={provider.tagline}>
                  <div role="radiogroup" aria-label="Payment processor" className="grid h-11 grid-cols-2 gap-1 rounded-xl border border-foreground/15 bg-muted/40 p-1">
                    {PROVIDER_OPTIONS.map((o) => {
                      const ok = isCountrySupported(o, providerSelection.country);
                      const on = o.id === providerSelection.paymentProvider;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={!ok || creating}
                          title={ok ? undefined : 'Not available in this country'}
                          onClick={() => {
                            setRevertedFrom(null);
                            // Switching provider always re-arms the acknowledgement.
                            setProviderSelection({ paymentProvider: o.id, country: providerSelection.country, permanenceAcknowledged: false });
                          }}
                          className={cn(
                            'rounded-lg text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40',
                            on
                              ? 'bg-background font-medium text-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.08)] ring-1 ring-foreground/10'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {o.name}
                          {o.isDefault && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Default</span>}
                        </button>
                      );
                    })}
                  </div>
                </Cell>
              </StepScreen>
            )}

            {step === 3 && provider.requiresPermanenceAck && (
              <StepScreen
                stepKey={3}
                art={AddVehiclePapersArt}
                title={`What ${provider.name} can't do`}
                line="These are product facts, not settings. Don't promise any of them to this client."
              >
                {provider.limitations.map((l) => (
                  <div
                    key={l.headline}
                    title={l.detail}
                    className="mb-2 flex h-11 items-center gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.04] px-3.5 text-sm text-foreground"
                  >
                    <X className="size-4 shrink-0 text-destructive" />
                    <span className="truncate">{l.headline}</span>
                  </div>
                ))}
                <Cell
                  label="Confirmed with the client"
                  required
                  className="col-span-2 mt-1"
                  error={providerError ?? undefined}
                  hint={`They don't need any of these, and ${provider.name} can't be changed later`}
                >
                  <ToggleTile
                    label={`Confirmed ${provider.name} is permanent`}
                    checked={providerSelection.permanenceAcknowledged}
                    on="Confirmed"
                    off="Not confirmed yet"
                    onChange={(v) => {
                      setProviderSelection({ ...providerSelection, permanenceAcknowledged: v });
                      setProviderError(null);
                    }}
                  />
                </Cell>
              </StepScreen>
            )}

            <StepFooter
              steps={steps}
              step={step}
              loading={creating}
              onBack={() => setStep(step - 1)}
              onCancel={close}
              finishLabel="Create company"
              busyLabel="Creating…"
            />
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
