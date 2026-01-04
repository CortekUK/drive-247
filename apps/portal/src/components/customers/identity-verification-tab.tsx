import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Shield, CheckCircle2, AlertCircle, XCircle, Clock, ExternalLink, RefreshCw, QrCode, Smartphone, Loader2, Camera, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { useTenant } from "@/contexts/TenantContext";
import { QRCodeSVG } from "qrcode.react";

interface IdentityVerification {
  id: string;
  status: string;
  review_status: string | null;
  review_result: string | null;
  document_type: string | null;
  document_number: string | null;
  document_country: string | null;
  document_expiry_date: string | null;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  verification_url: string | null;
  verification_completed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  verification_provider: 'veriff' | 'ai' | null;
  ai_face_match_score: number | null;
}

interface AISessionData {
  sessionId: string;
  qrUrl: string;
  expiresAt: Date;
}

interface IdentityVerificationTabProps {
  customerId: string;
}

export function IdentityVerificationTab({ customerId }: IdentityVerificationTabProps) {
  const [verifications, setVerifications] = useState<IdentityVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [aiSessionData, setAiSessionData] = useState<AISessionData | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const { tenant } = useTenant();

  const fetchVerifications = async () => {
    try {
      const { data, error } = await supabase
        .from('identity_verifications')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setVerifications(data || []);
    } catch (error) {
      console.error('Error fetching verifications:', error);
      toast.error('Failed to load identity verifications');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVerifications();
  }, [customerId]);

  // Determine verification mode based on tenant setting
  const verificationMode = tenant?.integration_veriff !== false ? 'veriff' : 'ai';

  const handleCreateVerification = async () => {
    setCreating(true);
    try {
      if (verificationMode === 'ai') {
        // AI verification flow
        const { data, error } = await supabase.functions.invoke('create-ai-verification-session', {
          body: {
            customerId,
            tenantId: tenant?.id,
            tenantSlug: tenant?.slug
          }
        });

        if (error) throw error;

        if (!data.ok) {
          throw new Error(data.detail || data.error || 'Failed to create AI verification session');
        }

        toast.success('AI verification session created');
        setAiSessionData({
          sessionId: data.sessionId,
          qrUrl: data.qrUrl,
          expiresAt: new Date(data.expiresAt)
        });
        setShowQRModal(true);
        setIsPolling(true);
        await fetchVerifications();
      } else {
        // Veriff flow (existing)
        const { data, error } = await supabase.functions.invoke('create-veriff-session', {
          body: { customerId }
        });

        if (error) throw error;

        if (!data.ok) {
          throw new Error(data.detail || data.error || 'Failed to create verification session');
        }

        toast.success('Verification session created successfully');

        // Open Veriff verification in new window
        if (data.sessionUrl) {
          window.open(data.sessionUrl, '_blank');
        }

        // Refresh the list
        await fetchVerifications();
      }
    } catch (error: any) {
      console.error('Error creating verification:', error);
      toast.error(error.message || 'Failed to create verification session');
    } finally {
      setCreating(false);
    }
  };

  // Timer for QR expiry countdown
  useEffect(() => {
    if (!showQRModal || !aiSessionData) return;

    const updateTime = () => {
      const now = new Date();
      const remaining = Math.max(0, Math.floor((aiSessionData.expiresAt.getTime() - now.getTime()) / 1000));
      setTimeRemaining(remaining);

      if (remaining === 0) {
        setShowQRModal(false);
        setIsPolling(false);
        setAiSessionData(null);
        toast.error('QR code expired. Please try again.');
      }
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [showQRModal, aiSessionData]);

  // Poll for AI verification completion
  const checkAIVerificationStatus = useCallback(async () => {
    if (!isPolling || !aiSessionData) return;

    try {
      const { data, error } = await supabase
        .from('identity_verifications')
        .select('status, review_status, review_result')
        .eq('id', aiSessionData.sessionId)
        .single();

      if (error) {
        console.error('Status check error:', error);
        return;
      }

      if (data.status === 'completed') {
        setIsPolling(false);
        setShowQRModal(false);
        setAiSessionData(null);
        await fetchVerifications();

        if (data.review_result === 'GREEN') {
          toast.success('Identity verified successfully!');
        } else if (data.review_result === 'RED') {
          toast.error('Identity verification failed');
        } else {
          toast.info('Verification needs manual review');
        }
      }
    } catch (err) {
      console.error('Status check error:', err);
    }
  }, [aiSessionData, isPolling]);

  // Set up polling
  useEffect(() => {
    if (isPolling && aiSessionData) {
      const initialTimeout = setTimeout(checkAIVerificationStatus, 5000);
      pollIntervalRef.current = setInterval(checkAIVerificationStatus, 3000);

      return () => {
        clearTimeout(initialTimeout);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    }
  }, [isPolling, aiSessionData, checkAIVerificationStatus]);

  // Format time remaining
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Get provider badge
  const getProviderBadge = (verification: IdentityVerification) => {
    const provider = verification.verification_provider || 'veriff';
    if (provider === 'ai') {
      return (
        <Badge variant="outline" className="border-purple-500 text-purple-600">
          <QrCode className="h-3 w-3 mr-1" />
          AI
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <Shield className="h-3 w-3 mr-1" />
        Veriff
      </Badge>
    );
  };

  const getStatusBadge = (verification: IdentityVerification) => {
    if (verification.review_result === 'GREEN') {
      return (
        <Badge variant="default" className="bg-green-500 hover:bg-green-600">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Verified
        </Badge>
      );
    } else if (verification.review_result === 'RED') {
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Rejected
        </Badge>
      );
    } else if (verification.review_result === 'RETRY') {
      return (
        <Badge variant="outline" className="border-yellow-500 text-yellow-600">
          <AlertCircle className="h-3 w-3 mr-1" />
          Needs Review
        </Badge>
      );
    } else if (verification.review_status === 'pending' || verification.review_status === 'queued') {
      return (
        <Badge variant="secondary">
          <Clock className="h-3 w-3 mr-1" />
          Under Review
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline">
          <Clock className="h-3 w-3 mr-1" />
          Pending
        </Badge>
      );
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Identity Verification
            </CardTitle>
            <CardDescription>
              Verify customer identity using driver's license or ID card
            </CardDescription>
          </div>
          <Button onClick={handleCreateVerification} disabled={creating} size="sm">
            {creating ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Shield className="h-4 w-4 mr-2" />
                Start Verification
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {verifications.length === 0 ? (
          <EmptyState
            icon={Shield}
            title="No verifications yet"
            description="Start a verification session to verify this customer's identity using their driver's license or ID card."
            action={
              <Button onClick={handleCreateVerification} disabled={creating}>
                <Shield className="h-4 w-4 mr-2" />
                Start Verification
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Document Type</TableHead>
                  <TableHead>Document Info</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Date of Birth</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {verifications.map((verification) => (
                  <TableRow key={verification.id}>
                    <TableCell>
                      {getStatusBadge(verification)}
                    </TableCell>
                    <TableCell>
                      {getProviderBadge(verification)}
                    </TableCell>
                    <TableCell>
                      {verification.document_type ? (
                        <span className="capitalize">
                          {verification.document_type.replace('_', ' ').toLowerCase()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {verification.document_number ? (
                        <div className="text-sm">
                          <div className="font-mono">{verification.document_number}</div>
                          {verification.document_country && (
                            <div className="text-muted-foreground text-xs">
                              {verification.document_country}
                            </div>
                          )}
                          {verification.document_expiry_date && (
                            <div className="text-muted-foreground text-xs">
                              Exp: {format(new Date(verification.document_expiry_date), 'MMM d, yyyy')}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {verification.first_name || verification.last_name ? (
                        <span>
                          {verification.first_name} {verification.last_name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {verification.date_of_birth ? (
                        format(new Date(verification.date_of_birth), 'MMM d, yyyy')
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div>{format(new Date(verification.created_at), 'MMM d, yyyy')}</div>
                        <div className="text-muted-foreground text-xs">
                          {format(new Date(verification.created_at), 'h:mm a')}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {verification.verification_url && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(verification.verification_url!, '_blank')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* AI Verification QR Modal */}
      <Dialog open={showQRModal} onOpenChange={(open) => {
        if (!open) {
          setShowQRModal(false);
          setIsPolling(false);
          setAiSessionData(null);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-primary" />
              Identity Verification
            </DialogTitle>
            <DialogDescription>
              Have the customer scan this QR code with their phone camera.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center space-y-6 py-6">
            {/* QR Code Display - Using local SVG generation */}
            {aiSessionData && (
              <div className="bg-white p-4 rounded-xl shadow-lg border">
                <QRCodeSVG
                  value={aiSessionData.qrUrl}
                  size={220}
                  level="H"
                  includeMargin={true}
                  marginSize={2}
                />
              </div>
            )}

            {/* Timer with progress bar */}
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

            {/* Status indicator */}
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Waiting for customer to complete verification...</span>
            </div>

            {/* Manual URL with copy button */}
            {aiSessionData && (
              <div className="w-full space-y-2">
                <p className="text-xs text-center text-muted-foreground">
                  Can't scan? Share this link with the customer:
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
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowQRModal(false);
                setIsPolling(false);
                setAiSessionData(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
