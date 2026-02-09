'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  Loader2,
  XCircle,
  CheckCircle,
  Users,
  Mail,
  Phone,
  Shield,
  Smartphone,
  Clock,
  Copy,
} from 'lucide-react';

const registrationSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().min(5, 'Phone number is required'),
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
  const [verificationSessionId, setVerificationSessionId] = useState<string | null>(null);
  const [formData, setFormData] = useState<RegistrationFormData | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [aiSessionData, setAiSessionData] = useState<{ sessionId: string; qrUrl: string; expiresAt: Date } | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const form = useForm<RegistrationFormData>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
    },
  });

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

  const handleStartVerification = async () => {
    if (!formData || !tenantInfo) return;
    setCreatingSession(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-ai-verification-session', {
        body: {
          customerDetails: { name: formData.name, email: formData.email, phone: formData.phone },
          tenantId: tenantInfo.tenantId,
          tenantSlug: tenantInfo.tenantSlug,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Failed to create verification session');

      setAiSessionData({
        sessionId: data.sessionId,
        qrUrl: data.qrUrl,
        expiresAt: new Date(data.expiresAt),
      });
      setIsPolling(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to start verification');
    } finally {
      setCreatingSession(false);
    }
  };

  // Timer countdown for QR expiry
  useEffect(() => {
    if (!aiSessionData) return;
    const updateTime = () => {
      const remaining = Math.max(0, Math.floor((aiSessionData.expiresAt.getTime() - Date.now()) / 1000));
      setTimeRemaining(remaining);
      if (remaining === 0) {
        setIsPolling(false);
        setAiSessionData(null);
        toast.error('QR code expired. Please try again.');
      }
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [aiSessionData]);

  // Poll for verification completion
  const checkVerificationStatus = useCallback(async () => {
    if (!isPolling || !aiSessionData) return;
    try {
      const { data, error } = await supabase
        .from('identity_verifications')
        .select('status, review_status, review_result')
        .eq('session_id', aiSessionData.sessionId)
        .single();
      if (error) return;
      if (data.status === 'completed') {
        setIsPolling(false);
        setVerificationSessionId(aiSessionData.sessionId);
        if (data.review_result === 'GREEN') {
          toast.success('Identity verified successfully!');
        } else if (data.review_result === 'RED') {
          toast.error('Identity verification failed');
        } else {
          toast.info('Verification needs manual review');
        }
        // Auto-submit registration
        setTimeout(() => submitRegistration(formData!, aiSessionData.sessionId), 1500);
      }
    } catch {}
  }, [aiSessionData, isPolling, formData]);

  useEffect(() => {
    if (isPolling && aiSessionData) {
      const initialTimeout = setTimeout(checkVerificationStatus, 5000);
      pollIntervalRef.current = setInterval(checkVerificationStatus, 3000);
      return () => {
        clearTimeout(initialTimeout);
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      };
    }
  }, [isPolling, aiSessionData, checkVerificationStatus]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleVerificationSkip = () => {
    setIsPolling(false);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setAiSessionData(null);
    submitRegistration(formData!, null);
  };

  const submitRegistration = async (data: RegistrationFormData, vSessionId: string | null) => {
    setPageStep('submitting');
    try {
      const { data: result, error } = await supabase.functions.invoke('submit-customer-registration', {
        body: {
          token,
          name: data.name,
          email: data.email,
          phone: data.phone,
          verificationSessionId: vSessionId || undefined,
        },
      });

      if (error || !result?.ok) {
        throw new Error(result?.error || error?.message || 'Registration failed');
      }

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
              <CardTitle className="flex items-center gap-2 text-lg">
                <Shield className="h-5 w-5 text-primary" />
                ID Verification
              </CardTitle>
              <CardDescription>Step 2 of 2 — Verify your identity using your phone</CardDescription>
            </CardHeader>
            <CardContent>
              {!aiSessionData ? (
                <div className="text-center space-y-4 py-6">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                    <Smartphone className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold">Scan a QR Code to Verify</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      We'll generate a QR code you can scan with your phone to take photos of your ID and a selfie. This is optional but recommended.
                    </p>
                  </div>
                  <div className="flex gap-3 justify-center">
                    <Button variant="outline" onClick={handleVerificationSkip}>
                      Skip
                    </Button>
                    <Button onClick={handleStartVerification} disabled={creatingSession}>
                      {creatingSession ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Shield className="h-4 w-4 mr-2" />
                          Start Verification
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center space-y-6 py-4">
                  {/* QR Code */}
                  <div
                    className="rounded-xl shadow-lg border-2 border-gray-200"
                    style={{
                      backgroundColor: '#FFFFFF',
                      padding: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <img
                      src={`https://quickchart.io/qr?text=${encodeURIComponent(aiSessionData.qrUrl)}&size=280&margin=3&dark=000000&light=ffffff&ecLevel=M&format=png`}
                      alt="Scan QR code to verify identity"
                      width={280}
                      height={280}
                      style={{ display: 'block', imageRendering: 'pixelated' }}
                    />
                  </div>

                  {/* Timer */}
                  <div className="w-full space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        Time remaining
                      </span>
                      <span className={`font-mono font-medium ${timeRemaining < 60 ? 'text-destructive' : 'text-foreground'}`}>
                        {formatTime(timeRemaining)}
                      </span>
                    </div>
                    <Progress value={(timeRemaining / 900) * 100} className="h-2" />
                  </div>

                  {/* Waiting indicator */}
                  <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm dark:bg-blue-950 dark:text-blue-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Waiting for verification to complete...</span>
                  </div>

                  {/* Manual URL */}
                  <div className="w-full space-y-2">
                    <p className="text-xs text-center text-muted-foreground">
                      Can't scan? Open this link on your phone:
                    </p>
                    <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                      <input
                        type="text"
                        readOnly
                        value={aiSessionData.qrUrl}
                        className="flex-1 bg-transparent text-xs truncate border-none focus:outline-none"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={() => {
                          navigator.clipboard.writeText(aiSessionData.qrUrl);
                          toast.success('Link copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Skip button */}
                  <Button variant="outline" onClick={handleVerificationSkip}>
                    Skip verification
                  </Button>
                </div>
              )}
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
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name">
                  Full Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="Enter your full name"
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
