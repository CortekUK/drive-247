'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import {
  Loader2,
  XCircle,
  CheckCircle,
  Users,
  Mail,
  Phone,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Shield,
} from 'lucide-react';
import { InlineIdVerification } from '@/components/registration/inline-id-verification';

const registrationSchema = z.object({
  customer_type: z.enum(['Individual', 'Company']),
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().min(5, 'Phone number is required'),
  license_number: z.string().optional(),
  id_number: z.string().optional(),
  whatsapp_opt_in: z.boolean().default(false),
  nok_full_name: z.string().optional(),
  nok_relationship: z.string().optional(),
  nok_phone: z.string().optional(),
  nok_email: z.string().optional().refine(
    (val) => !val || z.string().email().safeParse(val).success,
    'Must be a valid email'
  ),
  nok_address: z.string().optional(),
});

type RegistrationFormData = z.infer<typeof registrationSchema>;

type PageStep = 'loading' | 'error' | 'form' | 'verification' | 'submitting' | 'success';

interface TenantInfo {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantLogo: string | null;
  tenantPrimaryColor: string | null;
  expiresAt: string;
}

export default function RegisterPage() {
  const params = useParams();
  const token = params?.token as string;

  const [pageStep, setPageStep] = useState<PageStep>('loading');
  const [error, setError] = useState('');
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [showNextOfKin, setShowNextOfKin] = useState(false);
  const [verificationSessionId, setVerificationSessionId] = useState<string | null>(null);
  const [formData, setFormData] = useState<RegistrationFormData | null>(null);

  const form = useForm<RegistrationFormData>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      customer_type: 'Individual',
      name: '',
      email: '',
      phone: '',
      license_number: '',
      id_number: '',
      whatsapp_opt_in: false,
      nok_full_name: '',
      nok_relationship: '',
      nok_phone: '',
      nok_email: '',
      nok_address: '',
    },
  });

  const customerType = form.watch('customer_type');

  // Validate token on mount
  useEffect(() => {
    if (token) validateToken();
  }, [token]);

  const validateToken = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('validate-customer-invite', {
        body: { token },
      });

      if (error || !data?.ok) {
        setError(data?.error || 'Invalid or expired registration link');
        setPageStep('error');
        return;
      }

      setTenantInfo(data);
      setPageStep('form');
    } catch (err) {
      setError('Failed to validate registration link. Please try again.');
      setPageStep('error');
    }
  };

  const onFormSubmit = (data: RegistrationFormData) => {
    setFormData(data);
    setPageStep('verification');
  };

  const handleVerificationComplete = (sessionId: string) => {
    setVerificationSessionId(sessionId);
    // Auto-submit after short delay to let the user see the success state
    setTimeout(() => submitRegistration(formData!, sessionId), 1500);
  };

  const handleVerificationSkip = () => {
    submitRegistration(formData!, null);
  };

  const submitRegistration = async (data: RegistrationFormData, vSessionId: string | null) => {
    setPageStep('submitting');
    try {
      const { data: result, error } = await supabase.functions.invoke('submit-customer-registration', {
        body: {
          token,
          customer_type: data.customer_type,
          name: data.name,
          email: data.email,
          phone: data.phone,
          license_number: data.license_number || undefined,
          id_number: data.id_number || undefined,
          whatsapp_opt_in: data.whatsapp_opt_in,
          nok_full_name: data.nok_full_name || undefined,
          nok_relationship: data.nok_relationship || undefined,
          nok_phone: data.nok_phone || undefined,
          nok_email: data.nok_email || undefined,
          nok_address: data.nok_address || undefined,
          verificationSessionId: vSessionId || undefined,
        },
      });

      if (error) throw error;
      if (!result?.ok) throw new Error(result?.error || 'Registration failed');

      setPageStep('success');
    } catch (err: any) {
      toast.error(err.message || 'Registration failed. Please try again.');
      setPageStep('form');
    }
  };

  // Loading
  if (pageStep === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Validating registration link...</p>
        </div>
      </div>
    );
  }

  // Error
  if (pageStep === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <XCircle className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-xl font-semibold mb-2">Invalid Link</h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  // Submitting
  if (pageStep === 'submitting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin mx-auto mb-4 text-primary" />
          <h2 className="text-lg font-semibold mb-1">Completing Registration</h2>
          <p className="text-muted-foreground">Please wait...</p>
        </div>
      </div>
    );
  }

  // Success
  if (pageStep === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="h-10 w-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Registration Complete!</h1>
          <p className="text-muted-foreground mb-6">
            Thank you for registering{tenantInfo?.tenantName ? ` with ${tenantInfo.tenantName}` : ''}. Your details have been submitted successfully.
          </p>
          {verificationSessionId && (
            <p className="text-sm text-green-600 flex items-center justify-center gap-1">
              <Shield className="h-4 w-4" />
              ID verification submitted
            </p>
          )}
        </div>
      </div>
    );
  }

  // Verification step
  if (pageStep === 'verification' && formData && tenantInfo) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container max-w-lg mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-center gap-3 mb-6">
            {tenantInfo.tenantLogo && (
              <img src={tenantInfo.tenantLogo} alt="" className="h-8 object-contain" />
            )}
            <h1 className="text-lg font-semibold">{tenantInfo.tenantName}</h1>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">ID Verification</CardTitle>
              <CardDescription>Step 2 of 2</CardDescription>
            </CardHeader>
            <CardContent>
              <InlineIdVerification
                tenantId={tenantInfo.tenantId}
                tenantSlug={tenantInfo.tenantSlug}
                customerName={formData.name}
                email={formData.email}
                phone={formData.phone}
                onComplete={handleVerificationComplete}
                onSkip={handleVerificationSkip}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Form step
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-lg mx-auto px-4 py-8">
        {/* Header with tenant branding */}
        <div className="flex items-center justify-center gap-3 mb-6">
          {tenantInfo?.tenantLogo && (
            <img src={tenantInfo.tenantLogo} alt="" className="h-8 object-contain" />
          )}
          <h1 className="text-lg font-semibold">{tenantInfo?.tenantName}</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-primary" />
              Customer Registration
            </CardTitle>
            <CardDescription>
              Fill out the form below to complete your registration. Step 1 of 2.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onFormSubmit)} className="space-y-4">
              {/* Customer Type */}
              <div className="space-y-2">
                <Label>Customer Type <span className="text-destructive">*</span></Label>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="Individual"
                      checked={customerType === 'Individual'}
                      onChange={() => form.setValue('customer_type', 'Individual')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Individual</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="Company"
                      checked={customerType === 'Company'}
                      onChange={() => form.setValue('customer_type', 'Company')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Company</span>
                  </label>
                </div>
              </div>

              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name">
                  {customerType === 'Company' ? 'Company Name' : 'Full Name'} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder={customerType === 'Company' ? 'Enter company name' : 'Enter your full name'}
                  {...form.register('name')}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\d/g, '');
                    form.setValue('name', value, { shouldValidate: true });
                  }}
                />
                {form.formState.errors.name && (
                  <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                )}
              </div>

              {/* Email & Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5" />
                    Email <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="email@example.com"
                    {...form.register('email')}
                  />
                  {form.formState.errors.email && (
                    <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone" className="flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />
                    Phone <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="phone"
                    placeholder="(555) 123-4567"
                    {...form.register('phone')}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9\s\-\(\)\+]/g, '');
                      form.setValue('phone', value, { shouldValidate: true });
                    }}
                  />
                  {form.formState.errors.phone && (
                    <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>
                  )}
                </div>
              </div>

              {/* License & ID */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="license_number" className="flex items-center gap-1">
                    <CreditCard className="h-3.5 w-3.5" />
                    Driver's License
                  </Label>
                  <Input
                    id="license_number"
                    placeholder="Enter license number"
                    {...form.register('license_number')}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="id_number" className="flex items-center gap-1">
                    <CreditCard className="h-3.5 w-3.5" />
                    ID / Passport Number
                  </Label>
                  <Input
                    id="id_number"
                    placeholder="Enter ID or passport number"
                    {...form.register('id_number')}
                  />
                </div>
              </div>

              {/* WhatsApp opt-in */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="whatsapp_opt_in"
                  checked={form.watch('whatsapp_opt_in')}
                  onCheckedChange={(checked) => form.setValue('whatsapp_opt_in', checked === true)}
                />
                <Label htmlFor="whatsapp_opt_in" className="text-sm cursor-pointer">
                  I'd like to receive WhatsApp notifications
                </Label>
              </div>

              {/* Next of Kin */}
              <Collapsible open={showNextOfKin} onOpenChange={setShowNextOfKin}>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" className="w-full">
                    <div className="flex items-center justify-between w-full">
                      <span>Emergency Contact (Optional)</span>
                      {showNextOfKin ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-4">
                  <div className="rounded-lg border p-4 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="nok_full_name">Full Name</Label>
                        <Input
                          id="nok_full_name"
                          placeholder="Enter full name"
                          {...form.register('nok_full_name')}
                          onChange={(e) => {
                            const value = e.target.value.replace(/\d/g, '');
                            form.setValue('nok_full_name', value);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="nok_relationship">Relationship</Label>
                        <Input
                          id="nok_relationship"
                          placeholder="e.g., Spouse, Parent"
                          {...form.register('nok_relationship')}
                          onChange={(e) => {
                            const value = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                            form.setValue('nok_relationship', value);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="nok_phone">Phone</Label>
                        <Input
                          id="nok_phone"
                          placeholder="(555) 123-4567"
                          {...form.register('nok_phone')}
                          onChange={(e) => {
                            const value = e.target.value.replace(/[^0-9\s\-\(\)\+]/g, '');
                            form.setValue('nok_phone', value);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="nok_email">Email</Label>
                        <Input
                          id="nok_email"
                          type="email"
                          placeholder="Enter email"
                          {...form.register('nok_email')}
                        />
                        {form.formState.errors.nok_email && (
                          <p className="text-xs text-destructive">{form.formState.errors.nok_email.message}</p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="nok_address">Address</Label>
                      <Input
                        id="nok_address"
                        placeholder="Enter full address"
                        {...form.register('nok_address')}
                      />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Submit */}
              <div className="pt-2">
                <Button type="submit" className="w-full">
                  Continue to ID Verification
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
