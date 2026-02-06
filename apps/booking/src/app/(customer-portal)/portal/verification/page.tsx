'use client';

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCustomerVerification,
  useCustomerVerificationHistory,
  getVerificationStatusLabel,
} from '@/hooks/use-customer-verification';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Shield,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Calendar,
  User,
  RefreshCw,
  AlertCircle,
  Loader2,
  QrCode,
  Pencil,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { format, differenceInYears } from 'date-fns';
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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import AIVerificationQR from '@/components/AIVerificationQR';
import { createVeriffFrame, MESSAGES } from '@veriff/incontext-sdk';

interface AISessionData {
  sessionId: string;
  qrUrl: string;
  expiresAt: Date;
}

function getStatusIcon(result: string | null) {
  switch (result) {
    case 'GREEN':
    case 'approved':
    case 'verified':
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case 'RED':
    case 'rejected':
      return <XCircle className="h-5 w-5 text-destructive" />;
    case 'YELLOW':
    case 'pending':
      return <Clock className="h-5 w-5 text-yellow-500" />;
    default:
      return <AlertCircle className="h-5 w-5 text-muted-foreground" />;
  }
}

export default function VerificationPage() {
  const queryClient = useQueryClient();
  const { data: currentVerification, isLoading, refetch } = useCustomerVerification();
  const { data: verificationHistory } = useCustomerVerificationHistory();
  const { customerUser, refetchCustomerUser } = useCustomerAuthStore();
  const { tenant } = useTenant();

  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [isStartingVerification, setIsStartingVerification] = useState(false);
  const [verificationMode, setVerificationMode] = useState<'idle' | 'ai' | 'veriff'>('idle');
  const [aiSessionData, setAiSessionData] = useState<AISessionData | null>(null);

  // Edit details state
  const [showEditDetailsDialog, setShowEditDetailsDialog] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editDateOfBirth, setEditDateOfBirth] = useState('');
  const [editDocumentNumber, setEditDocumentNumber] = useState('');
  const [editDocumentType, setEditDocumentType] = useState('');
  const [editDocumentExpiry, setEditDocumentExpiry] = useState('');
  const [editDocumentCountry, setEditDocumentCountry] = useState('');
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isValidatingDetails, setIsValidatingDetails] = useState(false);
  const [validationApproved, setValidationApproved] = useState<boolean | null>(null);
  const [validationMessage, setValidationMessage] = useState('');
  const [validationFields, setValidationFields] = useState<Array<{ field: string; matches: boolean; message: string }>>([]);

  const statusInfo = getVerificationStatusLabel(currentVerification);

  // Check if Veriff is enabled for this tenant
  const isVeriffEnabled = tenant?.integration_veriff === true && !!process.env.NEXT_PUBLIC_VERIFF_API_KEY;

  // Start AI verification (QR code flow)
  const handleStartAIVerification = useCallback(async () => {
    if (!customerUser?.customer || !tenant) {
      toast.error('Unable to start verification. Please try again.');
      return;
    }

    setIsStartingVerification(true);
    setAiSessionData(null);

    try {
      const { data, error } = await supabase.functions.invoke('create-ai-verification-session', {
        body: {
          customerDetails: {
            name: customerUser.customer.name,
            email: customerUser.customer.email,
            phone: customerUser.customer.phone || '',
          },
          customerId: customerUser.customer_id,
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
        },
      });

      if (error || !data?.ok) {
        throw new Error(data?.error || error?.message || 'Failed to create verification session');
      }

      setAiSessionData({
        sessionId: data.sessionId,
        qrUrl: data.qrUrl,
        expiresAt: new Date(data.expiresAt),
      });
      setVerificationMode('ai');
      setShowUpdateDialog(false);
      toast.success('Scan the QR code with your phone to verify your identity.');
    } catch (error: any) {
      console.error('AI verification error:', error);
      toast.error(error.message || 'Failed to start verification. Please try again.');
    } finally {
      setIsStartingVerification(false);
    }
  }, [customerUser, tenant]);

  // Start Veriff verification
  const handleStartVeriffVerification = async () => {
    if (!customerUser?.customer || !tenant) {
      toast.error('Unable to start verification. Please try again.');
      return;
    }

    setIsStartingVerification(true);

    try {
      const VERIFF_API_KEY = process.env.NEXT_PUBLIC_VERIFF_API_KEY;
      if (!VERIFF_API_KEY) {
        throw new Error('Veriff API key not configured');
      }

      const nameParts = (customerUser.customer.name || '').split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || firstName;
      const vendorData = `portal_${customerUser.customer.email}_${Date.now()}`;

      // Create Veriff session
      const sessionResponse = await fetch('https://stationapi.veriff.com/v1/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AUTH-CLIENT': VERIFF_API_KEY,
        },
        body: JSON.stringify({
          verification: {
            person: {
              firstName,
              lastName,
            },
            vendorData,
          },
        }),
      });

      if (!sessionResponse.ok) {
        const errorText = await sessionResponse.text();
        throw new Error(`Veriff session creation failed: ${errorText}`);
      }

      const sessionData = await sessionResponse.json();
      const sessionId = sessionData.verification?.id;
      const sessionUrl = sessionData.verification?.url;

      if (!sessionId || !sessionUrl) {
        throw new Error('Invalid Veriff session response');
      }

      // Pre-create database record
      const { error: dbError } = await supabase.from('identity_verifications').insert({
        session_id: sessionId,
        external_user_id: vendorData,
        verification_provider: 'veriff',
        status: 'pending',
        customer_id: customerUser.customer_id,
        tenant_id: tenant.id,
      });

      if (dbError) {
        console.error('Error creating verification record:', dbError);
      }

      setVerificationMode('veriff');
      setShowUpdateDialog(false);

      // Open Veriff InContext frame
      createVeriffFrame({
        url: sessionUrl,
        onEvent: async (msg: string) => {
          switch (msg) {
            case MESSAGES.FINISHED:
              toast.success('Identity verified successfully!');
              setVerificationMode('idle');
              // Update customer status
              await supabase
                .from('customers')
                .update({ identity_verification_status: 'verified' })
                .eq('id', customerUser.customer_id);
              refetch();
              refetchCustomerUser();
              // Update onboarding status to remove sidebar warning badge
              queryClient.invalidateQueries({ queryKey: ['customer-onboarding'] });
              break;

            case MESSAGES.CANCELED:
              toast.info('Verification was canceled. You can try again when ready.');
              setVerificationMode('idle');
              break;
          }
        },
      });

      toast.success('Verification started. Please complete the identity verification.');
    } catch (error: any) {
      console.error('Veriff verification error:', error);
      toast.error(error.message || 'Failed to start verification. Please try again.');
      setVerificationMode('idle');
    } finally {
      setIsStartingVerification(false);
    }
  };

  // Handle AI verification completion
  const handleAIVerificationComplete = useCallback(async (data: any) => {
    console.log('AI verification completed:', data);
    toast.success('Identity verified successfully!');
    setVerificationMode('idle');
    setAiSessionData(null);

    // Update customer status
    if (customerUser?.customer_id) {
      await supabase
        .from('customers')
        .update({ identity_verification_status: 'verified' })
        .eq('id', customerUser.customer_id);
    }

    refetch();
    refetchCustomerUser();
    // Update onboarding status to remove sidebar warning badge
    queryClient.invalidateQueries({ queryKey: ['customer-onboarding'] });
  }, [customerUser, refetch, refetchCustomerUser, queryClient]);

  // Handle AI verification expiry
  const handleAIVerificationExpired = useCallback(() => {
    toast.info('Verification session expired. Please try again.');
    setAiSessionData(null);
    setVerificationMode('idle');
  }, []);

  // Handle retry
  const handleRetry = useCallback(() => {
    setAiSessionData(null);
    handleStartAIVerification();
  }, [handleStartAIVerification]);

  // Unified start verification handler
  const handleStartVerification = () => {
    if (isVeriffEnabled) {
      handleStartVeriffVerification();
    } else {
      handleStartAIVerification();
    }
  };

  // Open edit details dialog
  const handleOpenEditDetails = useCallback(() => {
    if (currentVerification) {
      setEditFirstName(currentVerification.first_name || '');
      setEditLastName(currentVerification.last_name || '');
      setEditDateOfBirth(currentVerification.date_of_birth || '');
      setEditDocumentNumber(currentVerification.document_number || '');
      setEditDocumentType(currentVerification.document_type || '');
      setEditDocumentExpiry(currentVerification.document_expiry_date || '');
      setEditDocumentCountry(currentVerification.document_country || '');
      setValidationApproved(null);
      setValidationMessage('');
      setValidationFields([]);
      setShowEditDetailsDialog(true);
    }
  }, [currentVerification]);

  // Validate edited fields against document using AI
  const handleValidateDetails = useCallback(async () => {
    if (!currentVerification?.document_front_url) {
      toast.error('No document image available for validation');
      return;
    }

    setIsValidatingDetails(true);
    setValidationApproved(null);
    setValidationMessage('');
    setValidationFields([]);

    try {
      const { data, error } = await supabase.functions.invoke('validate-name-against-document', {
        body: {
          documentFrontUrl: currentVerification.document_front_url,
          documentBackUrl: currentVerification.document_back_url || undefined,
          firstName: editFirstName.trim() || undefined,
          lastName: editLastName.trim() || undefined,
          dateOfBirth: editDateOfBirth || undefined,
          documentNumber: editDocumentNumber.trim() || undefined,
          documentType: editDocumentType || undefined,
          documentExpiry: editDocumentExpiry || undefined,
          documentCountry: editDocumentCountry.trim() || undefined,
        },
      });

      if (error) {
        throw new Error(error.message || 'Validation failed');
      }

      setValidationApproved(data.approved);
      setValidationMessage(data.message || '');
      setValidationFields(data.fields || []);

      if (data.approved) {
        toast.success('All fields validated successfully');
      } else {
        toast.warning('Some fields may not match the document');
      }
    } catch (error: any) {
      console.error('Validation error:', error);
      toast.error('Could not validate against document');
    } finally {
      setIsValidatingDetails(false);
    }
  }, [currentVerification, editFirstName, editLastName, editDateOfBirth, editDocumentNumber, editDocumentType, editDocumentExpiry, editDocumentCountry]);

  // Save edited details (only if validated)
  const handleSaveDetails = useCallback(async () => {
    if (!currentVerification?.id) return;

    // Require validation before saving
    if (validationApproved === null) {
      toast.error('Please validate the changes before saving');
      return;
    }

    if (!validationApproved) {
      toast.error('Cannot save - the edited data does not match the document');
      return;
    }

    setIsSavingDetails(true);

    try {
      const updateData: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      // Only include fields that have values
      if (editFirstName.trim()) updateData.first_name = editFirstName.trim();
      if (editLastName.trim()) updateData.last_name = editLastName.trim();
      if (editDateOfBirth) updateData.date_of_birth = editDateOfBirth;
      if (editDocumentNumber.trim()) updateData.document_number = editDocumentNumber.trim();
      if (editDocumentType) updateData.document_type = editDocumentType;
      if (editDocumentExpiry) updateData.document_expiry_date = editDocumentExpiry;
      if (editDocumentCountry.trim()) updateData.document_country = editDocumentCountry.trim();

      const { error } = await supabase
        .from('identity_verifications')
        .update(updateData)
        .eq('id', currentVerification.id);

      if (error) throw error;

      toast.success('Details updated successfully');
      setShowEditDetailsDialog(false);
      refetch();
      refetchCustomerUser();
    } catch (error: any) {
      console.error('Save details error:', error);
      toast.error(error.message || 'Failed to save details');
    } finally {
      setIsSavingDetails(false);
    }
  }, [currentVerification, editFirstName, editLastName, editDateOfBirth, editDocumentNumber, editDocumentType, editDocumentExpiry, editDocumentCountry, validationApproved, refetch, refetchCustomerUser]);

  // Show verification in progress
  if (verificationMode === 'ai' && aiSessionData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">ID Verification</h1>
          <p className="text-muted-foreground">
            Complete your identity verification
          </p>
        </div>

        <div className="flex justify-center">
          <AIVerificationQR
            sessionId={aiSessionData.sessionId}
            qrUrl={aiSessionData.qrUrl}
            expiresAt={aiSessionData.expiresAt}
            onVerified={handleAIVerificationComplete}
            onExpired={handleAIVerificationExpired}
            onRetry={handleRetry}
          />
        </div>

        <div className="text-center">
          <Button
            variant="outline"
            onClick={() => {
              setVerificationMode('idle');
              setAiSessionData(null);
            }}
          >
            Cancel Verification
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">ID Verification</h1>
        <p className="text-muted-foreground">
          View and manage your identity verification status
        </p>
      </div>

      {/* Current Verification Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/10">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle>Verification Status</CardTitle>
                <CardDescription>
                  Your current identity verification
                </CardDescription>
              </div>
            </div>
            <Badge variant={statusInfo.variant} className="text-sm">
              {statusInfo.label}
            </Badge>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : currentVerification ? (
            <div className="space-y-6">
              {/* Status Summary */}
              <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
                {getStatusIcon(currentVerification.review_result || currentVerification.status)}
                <div>
                  <p className="font-medium">
                    {currentVerification.review_result === 'GREEN' || currentVerification.status === 'approved'
                      ? 'Your identity has been verified'
                      : currentVerification.review_result === 'RED' || currentVerification.status === 'rejected'
                      ? 'Your verification was rejected'
                      : 'Your verification is pending review'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Last updated: {format(new Date(currentVerification.updated_at || currentVerification.created_at), 'PPp')}
                  </p>
                </div>
              </div>

              {/* Personal Information */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Personal Information</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenEditDetails}
                    className="h-8 text-xs"
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    Edit Details
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {currentVerification.first_name && (
                    <div className="flex items-center gap-3">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">First Name</p>
                        <p className="font-medium">{currentVerification.first_name}</p>
                      </div>
                    </div>
                  )}

                  {currentVerification.last_name && (
                    <div className="flex items-center gap-3">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Last Name</p>
                        <p className="font-medium">{currentVerification.last_name}</p>
                      </div>
                    </div>
                  )}

                  {currentVerification.date_of_birth && (
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Date of Birth</p>
                        <p className="font-medium">
                          {format(new Date(currentVerification.date_of_birth), 'PPP')} ({differenceInYears(new Date(), new Date(currentVerification.date_of_birth))} years old)
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Document Information */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Document Information</h4>
                <div className="grid gap-4 md:grid-cols-2">
                  {currentVerification.document_type && (
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Document Type</p>
                        <p className="font-medium capitalize">
                          {currentVerification.document_type.replace(/_/g, ' ')}
                        </p>
                      </div>
                    </div>
                  )}

                  {currentVerification.document_number && (
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Document Number</p>
                        <p className="font-medium">{currentVerification.document_number}</p>
                      </div>
                    </div>
                  )}

                  {currentVerification.document_country && (
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Issuing Country</p>
                        <p className="font-medium uppercase">{currentVerification.document_country}</p>
                      </div>
                    </div>
                  )}

                  {currentVerification.document_expiry_date && (
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Document Expiry</p>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">
                            {format(new Date(currentVerification.document_expiry_date), 'PPP')}
                          </p>
                          {new Date(currentVerification.document_expiry_date) < new Date() ? (
                            <span className="text-xs text-destructive font-medium px-2 py-0.5 bg-destructive/10 rounded">Expired</span>
                          ) : new Date(currentVerification.document_expiry_date) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) ? (
                            <span className="text-xs text-amber-600 font-medium px-2 py-0.5 bg-amber-500/10 rounded">Expires Soon</span>
                          ) : (
                            <span className="text-xs text-green-600 font-medium px-2 py-0.5 bg-green-500/10 rounded">Valid</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Verification Details */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Verification Details</h4>
                <div className="grid gap-4 md:grid-cols-2">
                  {currentVerification.verification_provider && (
                    <div className="flex items-center gap-3">
                      <Shield className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Verification Method</p>
                        <p className="font-medium capitalize">
                          {currentVerification.verification_provider === 'ai' ? 'AI Verification' : 'Veriff'}
                        </p>
                      </div>
                    </div>
                  )}

                  {currentVerification.ai_face_match_score != null && (
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Face Match Score</p>
                        <p className="font-medium">
                          {Math.round(currentVerification.ai_face_match_score * 100)}%
                        </p>
                      </div>
                    </div>
                  )}

                  {currentVerification.session_id && (
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Session Reference</p>
                        <p className="font-medium font-mono text-xs">
                          {currentVerification.session_id.slice(0, 8)}...{currentVerification.session_id.slice(-4)}
                        </p>
                      </div>
                    </div>
                  )}

                  {currentVerification.review_status && (
                    <div className="flex items-center gap-3">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Review Status</p>
                        <p className="font-medium capitalize">{currentVerification.review_status}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Submitted On</p>
                      <p className="font-medium">
                        {format(new Date(currentVerification.created_at), 'PPP')}
                      </p>
                    </div>
                  </div>

                  {currentVerification.updated_at && currentVerification.updated_at !== currentVerification.created_at && (
                    <div className="flex items-center gap-3">
                      <RefreshCw className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Last Updated</p>
                        <p className="font-medium">
                          {format(new Date(currentVerification.updated_at), 'PPP')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Document Images */}
              {(currentVerification.document_front_url || currentVerification.document_back_url || currentVerification.selfie_image_url || currentVerification.face_image_url) && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Submitted Documents</h4>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {currentVerification.document_front_url && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">Document Front</p>
                        <div className="aspect-[3/2] rounded-lg overflow-hidden border bg-muted">
                          <img
                            src={currentVerification.document_front_url}
                            alt="Document Front"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </div>
                    )}
                    {currentVerification.document_back_url && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">Document Back</p>
                        <div className="aspect-[3/2] rounded-lg overflow-hidden border bg-muted">
                          <img
                            src={currentVerification.document_back_url}
                            alt="Document Back"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </div>
                    )}
                    {currentVerification.selfie_image_url && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">Selfie</p>
                        <div className="aspect-[3/4] rounded-lg overflow-hidden border bg-muted">
                          <img
                            src={currentVerification.selfie_image_url}
                            alt="Selfie"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Update Verification Button */}
              <div className="pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setShowUpdateDialog(true)}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Update Verification
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  You can update your verification if your document has expired or you need to change your details.
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-semibold text-lg mb-2">No verification on file</h3>
              <p className="text-muted-foreground mb-4">
                Verify your identity to speed up future bookings and unlock all features.
              </p>
              <Button onClick={handleStartVerification} disabled={isStartingVerification}>
                {isStartingVerification ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <QrCode className="h-4 w-4 mr-2" />
                    Start ID Verification
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Verification History */}
      {verificationHistory && verificationHistory.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Verification History</CardTitle>
            <CardDescription>
              Previous verification attempts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {verificationHistory.map((v) => {
                  const status = getVerificationStatusLabel(v);
                  return (
                    <TableRow key={v.id}>
                      <TableCell>
                        {format(new Date(v.created_at), 'PP')}
                      </TableCell>
                      <TableCell className="capitalize">
                        {v.verification_provider === 'ai' ? 'AI Verification' : v.verification_provider || 'Unknown'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Update Verification Dialog */}
      <Dialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Verification</DialogTitle>
            <DialogDescription>
              Start a new identity verification to update your records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The verification process will guide you through submitting a new ID document and taking a selfie for verification.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setShowUpdateDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleStartVerification} disabled={isStartingVerification}>
                {isStartingVerification ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <QrCode className="h-4 w-4 mr-2" />
                    Start Verification
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Details Dialog */}
      <Dialog open={showEditDetailsDialog} onOpenChange={setShowEditDetailsDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Verification Details</DialogTitle>
            <DialogDescription>
              Correct any fields if the AI scanning was incorrect.
              Click "Validate" to verify your edits match the document before saving.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Document preview */}
            {currentVerification?.document_front_url && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Reference document:</p>
                <div className="aspect-[3/2] max-h-40 rounded-lg overflow-hidden border bg-muted">
                  <img
                    src={currentVerification.document_front_url}
                    alt="Document"
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            )}

            {/* Personal Information */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground">Personal Information</h4>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-first-name">First Name</Label>
                  <Input
                    id="edit-first-name"
                    value={editFirstName}
                    onChange={(e) => {
                      setEditFirstName(e.target.value);
                      setValidationApproved(null);
                    }}
                    placeholder="Enter first name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-last-name">Last Name</Label>
                  <Input
                    id="edit-last-name"
                    value={editLastName}
                    onChange={(e) => {
                      setEditLastName(e.target.value);
                      setValidationApproved(null);
                    }}
                    placeholder="Enter last name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-dob">Date of Birth</Label>
                  <Input
                    id="edit-dob"
                    type="date"
                    value={editDateOfBirth}
                    onChange={(e) => {
                      setEditDateOfBirth(e.target.value);
                      setValidationApproved(null);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Document Information */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground">Document Information</h4>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-doc-type">Document Type</Label>
                  <select
                    id="edit-doc-type"
                    value={editDocumentType}
                    onChange={(e) => {
                      setEditDocumentType(e.target.value);
                      setValidationApproved(null);
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Select type</option>
                    <option value="drivers_license">Driver's License</option>
                    <option value="passport">Passport</option>
                    <option value="id_card">ID Card</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-doc-number">Document Number</Label>
                  <Input
                    id="edit-doc-number"
                    value={editDocumentNumber}
                    onChange={(e) => {
                      setEditDocumentNumber(e.target.value);
                      setValidationApproved(null);
                    }}
                    placeholder="Enter document number"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-doc-country">Issuing Country</Label>
                  <Input
                    id="edit-doc-country"
                    value={editDocumentCountry}
                    onChange={(e) => {
                      setEditDocumentCountry(e.target.value.toUpperCase());
                      setValidationApproved(null);
                    }}
                    placeholder="e.g., US, GB, PK"
                    maxLength={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-doc-expiry">Document Expiry</Label>
                  <Input
                    id="edit-doc-expiry"
                    type="date"
                    value={editDocumentExpiry}
                    onChange={(e) => {
                      setEditDocumentExpiry(e.target.value);
                      setValidationApproved(null);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Validation Result */}
            {validationApproved !== null && (
              <div
                className={`p-4 rounded-lg ${
                  validationApproved
                    ? 'bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800'
                    : 'bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {validationApproved ? (
                    <Check className="h-5 w-5 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600" />
                  )}
                  <span className={`font-medium ${validationApproved ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                    {validationApproved ? 'Validation Passed' : 'Validation Failed'}
                  </span>
                </div>
                <p className={`text-sm ${validationApproved ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {validationMessage}
                </p>
                {validationFields.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {validationFields.map((field, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        {field.matches ? (
                          <Check className="h-3 w-3 text-green-600" />
                        ) : (
                          <XCircle className="h-3 w-3 text-red-600" />
                        )}
                        <span className="capitalize">{field.field.replace(/([A-Z])/g, ' $1').trim()}:</span>
                        <span className="text-muted-foreground">{field.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {validationApproved === false && (
              <p className="text-xs text-muted-foreground">
                Please correct the fields that don't match and validate again before saving.
              </p>
            )}
          </div>

          <div className="flex gap-3 justify-end pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setShowEditDetailsDialog(false)}
              disabled={isSavingDetails || isValidatingDetails}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={handleValidateDetails}
              disabled={isValidatingDetails || isSavingDetails}
            >
              {isValidatingDetails ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Validate
                </>
              )}
            </Button>
            <Button
              onClick={handleSaveDetails}
              disabled={!validationApproved || isSavingDetails || isValidatingDetails}
            >
              {isSavingDetails ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
