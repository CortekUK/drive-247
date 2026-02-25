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
import { Checkbox } from '@/components/ui/checkbox';
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
  Briefcase,
  ImageIcon,
  Upload,
  X,
} from 'lucide-react';

const registrationSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().min(5, 'Phone number is required'),
});

type RegistrationFormData = z.infer<typeof registrationSchema>;

type PageStep = 'loading' | 'error' | 'form' | 'submitting' | 'success';

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
  const [creatingSession, setCreatingSession] = useState(false);
  const [aiSessionData, setAiSessionData] = useState<{ sessionId: string; qrUrl: string; expiresAt: Date } | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const [verificationDone, setVerificationDone] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isGigDriver, setIsGigDriver] = useState(false);
  const [gigDriverFiles, setGigDriverFiles] = useState<File[]>([]);
  const [gigDriverUploading, setGigDriverUploading] = useState(false);

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

  const handleStartVerification = async () => {
    // Validate form first
    const isValid = await form.trigger();
    if (!isValid) {
      toast.error('Please fill in all required fields first');
      return;
    }

    const formData = form.getValues();
    if (!tenantInfo) return;
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
        setVerificationDone(true);
        if (data.review_result === 'GREEN') {
          toast.success('Identity verified successfully!');
        } else if (data.review_result === 'RED') {
          toast.error('Identity verification failed');
        } else {
          toast.info('Verification needs manual review');
        }
      }
    } catch {}
  }, [aiSessionData, isPolling]);

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

  const handleSubmitRegistration = async (data: RegistrationFormData) => {
    setPageStep('submitting');
    try {
      // Upload gig driver files to storage first
      const gigDriverImagePaths: string[] = [];
      if (isGigDriver && gigDriverFiles.length > 0) {
        for (const file of gigDriverFiles) {
          const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
          const filePath = `pending/${fileName}`;
          const { error: uploadError } = await supabase.storage
            .from('gig-driver-images')
            .upload(filePath, file, { cacheControl: '3600', upsert: false });
          if (uploadError) throw new Error(`Failed to upload ${file.name}`);
          gigDriverImagePaths.push(filePath);
        }
      }

      const { data: result, error } = await supabase.functions.invoke('submit-customer-registration', {
        body: {
          token,
          name: data.name,
          email: data.email,
          phone: data.phone,
          verificationSessionId: verificationSessionId || undefined,
          isGigDriver: isGigDriver || undefined,
          gigDriverImagePaths: gigDriverImagePaths.length > 0 ? gigDriverImagePaths : undefined,
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

  // Single-page form + verification
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
              Fill out the form below and optionally verify your identity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(handleSubmitRegistration)} className="space-y-4">
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

              {/* Gig Driver Section */}
              <div className="flex items-start gap-3 pt-2">
                <Checkbox
                  id="isGigDriver"
                  checked={isGigDriver}
                  onCheckedChange={(checked) => {
                    setIsGigDriver(checked === true);
                    if (!checked) setGigDriverFiles([]);
                  }}
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="isGigDriver" className="text-sm cursor-pointer flex items-center gap-2">
                    <Briefcase className="h-4 w-4" />
                    I am a gig driver
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Tick this if you drive for Uber, Bolt, Lyft, DoorDash, etc.
                  </p>
                </div>
              </div>

              {isGigDriver && (
                <div className="space-y-3 pl-7">
                  <Label className="text-sm">Upload proof images</Label>
                  <div className="border-2 border-dashed rounded-lg p-4 text-center">
                    <Input
                      id="gig-reg-upload"
                      type="file"
                      accept=".jpg,.jpeg,.png"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (!e.target.files) return;
                        const newFiles = Array.from(e.target.files).filter(
                          f => ['image/jpeg', 'image/jpg', 'image/png'].includes(f.type) && f.size <= 10 * 1024 * 1024
                        );
                        setGigDriverFiles(prev => {
                          const names = new Set(prev.map(f => f.name));
                          return [...prev, ...newFiles.filter(f => !names.has(f.name))];
                        });
                        e.target.value = '';
                      }}
                    />
                    <Label htmlFor="gig-reg-upload" className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                      <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      Click to upload JPG/PNG images
                    </Label>
                  </div>
                  {gigDriverFiles.length > 0 && (
                    <div className="space-y-2">
                      {gigDriverFiles.map((file, i) => (
                        <div key={i} className="flex items-center gap-2 p-2 border rounded-lg text-sm">
                          <ImageIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="flex-1 truncate">{file.name}</span>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setGigDriverFiles(prev => prev.filter((_, idx) => idx !== i))}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ID Verification Section */}
              <div className="border-t pt-4 mt-2">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <Shield className="h-4 w-4 text-primary" />
                  ID Verification
                  <span className="text-xs font-normal text-muted-foreground">(Optional)</span>
                </h3>

                {verificationDone ? (
                  /* Verification complete */
                  <div className="flex items-center gap-2 px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-600 dark:text-green-400">
                    <CheckCircle className="h-4 w-4 shrink-0" />
                    <span>Identity verification completed</span>
                  </div>
                ) : !aiSessionData ? (
                  /* Not started */
                  <div className="flex items-center gap-3 p-4 rounded-lg border border-dashed border-muted-foreground/25">
                    <div className="p-2 bg-primary/10 rounded-full shrink-0">
                      <Smartphone className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Verify with your phone</p>
                      <p className="text-xs text-muted-foreground">Scan a QR code to take photos of your ID and a selfie.</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleStartVerification}
                      disabled={creatingSession}
                    >
                      {creatingSession ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Verify'
                      )}
                    </Button>
                  </div>
                ) : (
                  /* QR code active */
                  <div className="space-y-4">
                    <div className="flex flex-col items-center gap-4 p-4 rounded-lg border border-muted-foreground/20">
                      {/* QR Code */}
                      <div
                        className="rounded-xl shadow-lg border-2 border-gray-200"
                        style={{
                          backgroundColor: '#FFFFFF',
                          padding: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <img
                          src={`https://quickchart.io/qr?text=${encodeURIComponent(aiSessionData.qrUrl)}&size=220&margin=3&dark=000000&light=ffffff&ecLevel=M&format=png`}
                          alt="Scan QR code to verify identity"
                          width={220}
                          height={220}
                          style={{ display: 'block', imageRendering: 'pixelated' }}
                        />
                      </div>

                      {/* Timer */}
                      <div className="w-full space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            Time remaining
                          </span>
                          <span className={`font-mono font-medium ${timeRemaining < 60 ? 'text-destructive' : 'text-foreground'}`}>
                            {formatTime(timeRemaining)}
                          </span>
                        </div>
                        <Progress value={(timeRemaining / 900) * 100} className="h-1.5" />
                      </div>

                      {/* Waiting indicator */}
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs dark:bg-blue-950 dark:text-blue-300">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Waiting for verification...</span>
                      </div>

                      {/* Manual URL */}
                      <div className="w-full space-y-1">
                        <p className="text-[10px] text-center text-muted-foreground">
                          Can't scan? Open this link on your phone:
                        </p>
                        <div className="flex items-center gap-2 p-1.5 bg-muted rounded-lg">
                          <input
                            type="text"
                            readOnly
                            value={aiSessionData.qrUrl}
                            className="flex-1 bg-transparent text-xs truncate border-none focus:outline-none"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="shrink-0 h-7 w-7 p-0"
                            onClick={() => {
                              navigator.clipboard.writeText(aiSessionData.qrUrl);
                              toast.success('Link copied to clipboard');
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Submit */}
              <div className="pt-2">
                <Button type="submit" className="w-full" disabled={isPolling}>
                  {isPolling ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Verification in progress...
                    </>
                  ) : (
                    'Complete Registration'
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
