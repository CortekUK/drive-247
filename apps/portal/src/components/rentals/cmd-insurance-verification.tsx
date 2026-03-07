'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Shield,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Copy,
  RefreshCw,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { useAuth } from '@/stores/auth-store';
import {
  useCmdVerifications,
  useCreateCmdVerification,
  useRefreshCmdVerification,
} from '@/hooks/use-cmd-verification';

interface CmdInsuranceVerificationProps {
  rentalId: string;
  rental: any;
}

export function CmdInsuranceVerification({ rentalId, rental }: CmdInsuranceVerificationProps) {
  const { toast } = useToast();
  const { canEdit } = useManagerPermissions();
  const { appUser } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [missingFields, setMissingFields] = useState<string[] | null>(null);

  const { data: verifications = [], isLoading } = useCmdVerifications(rentalId);
  const createMutation = useCreateCmdVerification();
  const refreshMutation = useRefreshCmdVerification();

  const insuranceVerifications = verifications.filter(
    (v) => v.verification_type === 'insurance'
  );
  const latestVerification = insuranceVerifications[0] || null;

  const handleCreate = async () => {
    const customer = rental?.customers || rental?.customer;
    if (!customer) {
      toast({ title: 'Error', description: 'No customer data found for this rental', variant: 'destructive' });
      return;
    }

    setIsCreating(true);
    try {
      // Customer table uses single 'name' field — split into first/last
      const nameParts = (customer.name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      await createMutation.mutateAsync({
        rentalId,
        customerId: rental.customer_id,
        verificationType: 'insurance',
        firstName,
        lastName,
        email: customer.email || '',
        phone: customer.phone || '',
        initiatedBy: appUser?.id,
      });
      setMissingFields(null);
      toast({ title: 'Success', description: 'Insurance verification created. Copy the magic link and send it to the customer.' });
    } catch (error: any) {
      if (error.missingFields) {
        setMissingFields(error.missingFields);
      } else {
        toast({ title: 'Error', description: error.message || 'Failed to create verification', variant: 'destructive' });
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: 'Copied', description: 'Magic link copied to clipboard' });
  };

  const handleRefresh = (verificationId: string) => {
    refreshMutation.mutate(
      { cmdVerificationId: verificationId, rentalId },
      {
        onSuccess: () => {
          toast({ title: 'Refreshed', description: 'Verification status updated' });
        },
        onError: (error: any) => {
          toast({ title: 'Error', description: error.message || 'Failed to refresh', variant: 'destructive' });
        },
      }
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'verified':
        return <Badge className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Verified</Badge>;
      case 'unverified':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Unverified</Badge>;
      case 'link_generated':
        return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Awaiting Customer</Badge>;
      case 'link_sent':
        return <Badge variant="outline" className="border-blue-500 text-blue-600"><ExternalLink className="h-3 w-3 mr-1" />Link Sent</Badge>;
      case 'verifying':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Verifying...</Badge>;
      case 'error':
        return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Error</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Loader2 className="h-6 w-6 mx-auto animate-spin mb-2" />
        <p className="text-sm">Loading CheckMyDriver verifications...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      {/* Create new verification button */}
      {canEdit('rentals') && (!latestVerification || ['verified', 'unverified', 'error'].includes(latestVerification.status)) && (
        <Button
          onClick={handleCreate}
          disabled={isCreating || createMutation.isPending}
          className="w-full"
          variant="outline"
        >
          {isCreating || createMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Shield className="h-4 w-4 mr-2" />
          )}
          Verify Insurance via CheckMyDriver
        </Button>
      )}

      {/* Missing customer fields warning */}
      {missingFields && (
        <Alert className="border-amber-500/50 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-sm">
            <p className="font-medium">Customer profile is incomplete</p>
            <p className="mt-1">
              Please update the following fields on the customer profile before running CheckMyDriver verification:
            </p>
            <ul className="list-disc list-inside mt-1 text-muted-foreground">
              {missingFields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Current / Latest verification */}
      {latestVerification && (
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Latest Verification</span>
              {getStatusBadge(latestVerification.status)}
            </div>
            <div className="flex items-center gap-2">
              {!['verified', 'error'].includes(latestVerification.status) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRefresh(latestVerification.id)}
                  disabled={refreshMutation.isPending}
                >
                  <RefreshCw className={`h-3 w-3 mr-1 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
                  Check Status
                </Button>
              )}
            </div>
          </div>

          {/* Magic link section */}
          {latestVerification.magic_link_url && ['link_generated', 'link_sent'].includes(latestVerification.status) && (
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Magic Link (send to customer):</label>
              <div className="flex gap-2">
                <Input
                  value={latestVerification.magic_link_url}
                  readOnly
                  className="text-xs font-mono"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyLink(latestVerification.magic_link_url!)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Verified results */}
          {latestVerification.status === 'verified' && (
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {latestVerification.carrier && (
                  <div>
                    <span className="text-muted-foreground">Carrier:</span>
                    <p className="font-medium">{latestVerification.carrier}</p>
                  </div>
                )}
                {latestVerification.policy_status && (
                  <div>
                    <span className="text-muted-foreground">Policy Status:</span>
                    <p className="font-medium">{latestVerification.policy_status}</p>
                  </div>
                )}
                {latestVerification.active_status && (
                  <div>
                    <span className="text-muted-foreground">Active Status:</span>
                    <p className="font-medium">{latestVerification.active_status}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Unverified results */}
          {latestVerification.status === 'unverified' && (
            <Alert className="border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-sm">
                Insurance could not be verified.
                {latestVerification.policy_status && (
                  <span className="block mt-1">Policy Status: <strong>{latestVerification.policy_status}</strong></span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Error */}
          {latestVerification.status === 'error' && latestVerification.error_message && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">{latestVerification.error_message}</AlertDescription>
            </Alert>
          )}

          <p className="text-xs text-muted-foreground">
            Created: {new Date(latestVerification.created_at).toLocaleString()}
            {latestVerification.consumer_email && ` · ${latestVerification.consumer_email}`}
          </p>
        </div>
      )}

      {/* History of past verifications */}
      {insuranceVerifications.length > 1 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Previous Verifications</h4>
          {insuranceVerifications.slice(1).map((v) => (
            <div key={v.id} className="flex items-center justify-between border rounded p-2 text-sm">
              <div className="flex items-center gap-2">
                {getStatusBadge(v.status)}
                {v.carrier && <span className="text-muted-foreground">{v.carrier}</span>}
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(v.created_at).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!latestVerification && !isCreating && (
        <div className="text-center py-4 text-muted-foreground">
          <Shield className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No CheckMyDriver insurance verifications yet</p>
          <p className="text-xs mt-1">Click the button above to start a new verification</p>
        </div>
      )}
    </div>
  );
}
