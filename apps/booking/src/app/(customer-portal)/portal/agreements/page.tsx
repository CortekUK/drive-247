'use client';

import { useState } from 'react';
import {
  useCustomerAgreements,
  useCustomerAgreementStats,
  useDownloadAgreement,
  useViewAgreement,
  useSignAgreement,
  getAgreementStatusInfo,
  CustomerAgreement,
} from '@/hooks/use-customer-agreements';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FileText,
  Download,
  ExternalLink,
  FileCheck,
  Clock,
  CheckCircle,
  Car,
  Eye,
  Loader2,
  RefreshCw,
  PenLine,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

function StatCard({
  title,
  value,
  icon: Icon,
  description,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function AgreementCard({
  agreement,
  onDownload,
  onView,
  onSign,
  isDownloading,
  isViewing,
  isSigning,
}: {
  agreement: CustomerAgreement;
  onDownload: () => void;
  onView: () => void;
  onSign: () => void;
  isDownloading: boolean;
  isViewing: boolean;
  isSigning: boolean;
}) {
  const statusInfo = getAgreementStatusInfo(agreement.document_status);
  const hasSignedDocument = !!agreement.signed_document?.file_url;
  const hasEnvelope = !!agreement.docusign_envelope_id;
  const canViewDocument = hasSignedDocument || hasEnvelope;
  const needsSignature = hasEnvelope && !hasSignedDocument &&
    agreement.document_status !== 'completed' &&
    agreement.document_status !== 'signed';
  const vehicleInfo = agreement.vehicles
    ? `${agreement.vehicles.make || ''} ${agreement.vehicles.model || ''} - ${agreement.vehicles.reg}`.trim()
    : 'Vehicle';

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold truncate">
                  Rental Agreement {agreement.rental_number ? `#${agreement.rental_number}` : ''}
                </h3>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Car className="h-3 w-3" />
                  {vehicleInfo}
                </p>
              </div>
              <Badge variant={statusInfo.variant}>
                {statusInfo.label === 'Completed' && <CheckCircle className="h-3 w-3 mr-1" />}
                {statusInfo.label === 'Awaiting Signature' && <Clock className="h-3 w-3 mr-1" />}
                {statusInfo.label}
              </Badge>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Start Date:</span>{' '}
                {format(new Date(agreement.start_date), 'MMM d, yyyy')}
              </div>
              {agreement.end_date && (
                <div>
                  <span className="text-muted-foreground">End Date:</span>{' '}
                  {format(new Date(agreement.end_date), 'MMM d, yyyy')}
                </div>
              )}
              {agreement.envelope_sent_at && (
                <div>
                  <span className="text-muted-foreground">Sent:</span>{' '}
                  {format(new Date(agreement.envelope_sent_at), 'MMM d, yyyy')}
                </div>
              )}
              {agreement.envelope_completed_at && (
                <div>
                  <span className="text-muted-foreground">Signed:</span>{' '}
                  {format(new Date(agreement.envelope_completed_at), 'MMM d, yyyy')}
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {hasSignedDocument ? (
                  <Badge variant="outline" className="text-green-600 border-green-600">
                    <FileCheck className="h-3 w-3 mr-1" />
                    Signed Document
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                    <Clock className="h-3 w-3 mr-1" />
                    Awaiting Signature
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-1">
                {needsSignature && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={onSign}
                    disabled={isSigning}
                    title="Sign agreement"
                    className="gap-1"
                  >
                    {isSigning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <PenLine className="h-4 w-4" />
                    )}
                    Sign
                  </Button>
                )}
                {canViewDocument && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onView}
                      disabled={isViewing}
                      title="View agreement"
                    >
                      {isViewing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onDownload}
                      disabled={isDownloading}
                      title="Download agreement"
                    >
                      {isDownloading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AgreementViewerDialog({
  agreement,
  documentUrl,
  open,
  onOpenChange,
  onDownload,
  isLoading,
}: {
  agreement: CustomerAgreement | null;
  documentUrl: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload: () => void;
  isLoading: boolean;
}) {
  if (!agreement) return null;

  const vehicleInfo = agreement.vehicles
    ? `${agreement.vehicles.make || ''} ${agreement.vehicles.model || ''} - ${agreement.vehicles.reg}`.trim()
    : 'Vehicle';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>
                Rental Agreement {agreement.rental_number ? `#${agreement.rental_number}` : ''}
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {vehicleInfo}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onDownload}
              >
                <Download className="h-4 w-4 mr-1" />
                Download
              </Button>
              {documentUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(documentUrl, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-1" />
                  Open in New Tab
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-hidden bg-muted">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                <p className="text-muted-foreground mt-2">Loading document...</p>
              </div>
            </div>
          ) : documentUrl ? (
            <iframe
              src={`${documentUrl}#toolbar=1&navpanes=0`}
              className="w-full h-full border-0"
              title="Agreement Document"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Document not available</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AgreementsPage() {
  const { data: agreements, isLoading, refetch, isFetching } = useCustomerAgreements();
  const { data: stats, refetch: refetchStats } = useCustomerAgreementStats();
  const downloadAgreement = useDownloadAgreement();
  const viewAgreement = useViewAgreement();
  const signAgreement = useSignAgreement();
  const [viewingAgreement, setViewingAgreement] = useState<CustomerAgreement | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [signingUrl, setSigningUrl] = useState<string | null>(null);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [signingAgreement, setSigningAgreement] = useState<CustomerAgreement | null>(null);

  const handleDownload = (agreement: CustomerAgreement) => {
    downloadAgreement.mutate(agreement);
  };

  const handleView = async (agreement: CustomerAgreement) => {
    setViewingAgreement(agreement);
    setViewDialogOpen(true);
    setDocumentUrl(null);

    viewAgreement.mutate(agreement, {
      onSuccess: (url) => {
        setDocumentUrl(url);
      },
    });
  };

  const handleSign = (agreement: CustomerAgreement) => {
    setSigningAgreement(agreement);
    signAgreement.mutate(agreement, {
      onSuccess: (result) => {
        if (result.signingUrl) {
          setSigningUrl(result.signingUrl);
          setSignDialogOpen(true);
        } else if (result.emailSent) {
          toast.info('Check your email for the signing link');
        }
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to get signing link');
      },
    });
  };

  const handleCloseSignDialog = () => {
    setSignDialogOpen(false);
    setSigningUrl(null);
    setSigningAgreement(null);
    // Refresh agreements to pick up any status changes
    refetch();
    refetchStats();
  };

  const handleCloseDialog = () => {
    setViewDialogOpen(false);
    // Clean up blob URL if it was created
    if (documentUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(documentUrl);
    }
    setDocumentUrl(null);
    setViewingAgreement(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Agreements</h1>
          <p className="text-muted-foreground">
            View and download your rental agreements
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refetch();
            refetchStats();
          }}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Total Agreements"
          value={stats?.total || 0}
          icon={FileText}
        />
        <StatCard
          title="Signed"
          value={stats?.signed || 0}
          icon={CheckCircle}
          description="Completed agreements"
        />
        <StatCard
          title="Pending"
          value={stats?.pending || 0}
          icon={Clock}
          description="Awaiting your signature"
        />
      </div>

      {/* Agreements List */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Rental Agreements</h2>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <Skeleton className="w-12 h-12 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-4 w-64" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : agreements && agreements.length > 0 ? (
          <div className="space-y-4">
            {agreements.map((agreement) => (
              <AgreementCard
                key={agreement.id}
                agreement={agreement}
                onDownload={() => handleDownload(agreement)}
                onView={() => handleView(agreement)}
                onSign={() => handleSign(agreement)}
                isDownloading={downloadAgreement.isPending && downloadAgreement.variables?.id === agreement.id}
                isViewing={viewAgreement.isPending && viewAgreement.variables?.id === agreement.id}
                isSigning={signAgreement.isPending && signAgreement.variables?.id === agreement.id}
              />
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-2">No agreements yet</h3>
            <p className="text-muted-foreground">
              Your rental agreements will appear here once you make a booking.
            </p>
          </Card>
        )}
      </div>

      {/* Document Viewer Dialog */}
      <AgreementViewerDialog
        agreement={viewingAgreement}
        documentUrl={documentUrl}
        open={viewDialogOpen}
        onOpenChange={(open) => !open && handleCloseDialog()}
        onDownload={() => viewingAgreement && handleDownload(viewingAgreement)}
        isLoading={viewAgreement.isPending}
      />

      {/* Embedded Signing Dialog */}
      <Dialog open={signDialogOpen} onOpenChange={(open) => !open && handleCloseSignDialog()}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>
                  Sign Agreement {signingAgreement?.rental_number ? `#${signingAgreement.rental_number}` : ''}
                </DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Review and sign your rental agreement below
                </p>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {signAgreement.isPending ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                  <p className="text-muted-foreground mt-2">Loading signing page...</p>
                </div>
              </div>
            ) : signingUrl ? (
              <iframe
                src={signingUrl}
                className="w-full h-full border-0"
                title="Sign Agreement"
                allow="camera; microphone"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">Signing page not available</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
