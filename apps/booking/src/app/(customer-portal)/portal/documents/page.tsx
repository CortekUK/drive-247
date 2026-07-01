'use client';

import { useState } from 'react';
import {
  useCustomerDocuments,
  useCustomerDocumentStats,
  useDeleteCustomerDocument,
  useDownloadDocument,
  getDocumentStatus,
  CustomerDocument,
} from '@/hooks/use-customer-documents';
import { useCustomerInsurancePolicies, type CustomerBonzahPolicy } from '@/hooks/use-customer-insurance-policies';
import { DocumentUploadDialog } from '@/components/customer-portal/DocumentUploadDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  FileText,
  Upload,
  Download,
  Trash2,
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileCheck,
  Car,
} from 'lucide-react';
import { format } from 'date-fns';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';
import { parseDateOnly } from '@/lib/date-utils';
import { supabase } from '@/integrations/supabase/client';
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
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 sm:p-6 sm:pb-2">
        <CardTitle className="text-xs sm:text-sm font-medium min-w-0 truncate">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      </CardHeader>
      <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
        <div className="text-xl sm:text-2xl font-bold break-words">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function getStatusBadge(status: 'Active' | 'Expired' | 'Expires Soon' | 'Unknown') {
  switch (status) {
    case 'Active':
      return (
        <Badge variant="default" className="bg-green-500">
          <CheckCircle className="h-3 w-3 mr-1" />
          Active
        </Badge>
      );
    case 'Expired':
      return (
        <Badge variant="destructive">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Expired
        </Badge>
      );
    case 'Expires Soon':
      return (
        <Badge variant="secondary" className="bg-yellow-500 text-white">
          <Clock className="h-3 w-3 mr-1" />
          Expires Soon
        </Badge>
      );
    default:
      return (
        <Badge variant="outline">
          <Clock className="h-3 w-3 mr-1" />
          Unknown
        </Badge>
      );
  }
}

function DocumentCard({
  document,
  onDownload,
  onDelete,
  isDeleting,
}: {
  document: CustomerDocument;
  onDownload: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const status = getDocumentStatus(document.end_date);

  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 rounded-lg flex items-center justify-center">
            <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-sm sm:text-base break-all">{document.document_name}</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {document.document_type.replace(/_/g, ' ').replace(/\bid\b/gi, 'ID').replace(/\b\w/g, c => c.toUpperCase())}
                </p>
              </div>
              {document.document_type === 'Insurance Certificate' && (
                <div className="shrink-0">{getStatusBadge(status)}</div>
              )}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-x-3 sm:gap-x-4 gap-y-1 text-xs sm:text-sm">
              {document.insurance_provider && (
                <div className="min-w-0">
                  <span className="text-muted-foreground">Provider:</span>{' '}
                  <span className="break-words">{document.insurance_provider}</span>
                </div>
              )}
              {document.policy_number && (
                <div className="min-w-0">
                  <span className="text-muted-foreground">Policy:</span>{' '}
                  <span className="break-all">{document.policy_number}</span>
                </div>
              )}
              {document.start_date && (
                <div className="min-w-0">
                  <span className="text-muted-foreground">Start:</span>{' '}
                  {format(parseDateOnly(document.start_date), 'MMM d, yyyy')}
                </div>
              )}
              {document.end_date && (
                <div className="min-w-0">
                  <span className="text-muted-foreground">Expires:</span>{' '}
                  {format(parseDateOnly(document.end_date), 'MMM d, yyyy')}
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                {document.verified ? (
                  <Badge variant="outline" className="text-green-600 border-green-600">
                    <FileCheck className="h-3 w-3 mr-1" />
                    Verified
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                    <Clock className="h-3 w-3 mr-1" />
                    Pending Verification
                  </Badge>
                )}
                <span className="hidden sm:inline">•</span>
                <span>
                  Uploaded {format(new Date(document.created_at), 'MMM d, yyyy')}
                </span>
              </div>

              <div className="flex items-center gap-1 self-end sm:self-auto">
                {document.file_url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onDownload}
                    title="Download document"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  title="Delete document"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const COVERAGE_LABELS: Record<string, string> = {
  cdw: 'CDW',
  rcli: 'RCLI',
  sli: 'SLI',
  pai: 'PAI',
};

function getPolicyStatusBadge(status: string) {
  switch (status) {
    case 'active':
      return (
        <Badge variant="default" className="bg-green-500">
          <CheckCircle className="h-3 w-3 mr-1" />
          Active
        </Badge>
      );
    case 'quoted':
    case 'payment_pending':
      return (
        <Badge variant="secondary" className="bg-amber-500 text-white">
          <Clock className="h-3 w-3 mr-1" />
          Pending
        </Badge>
      );
    case 'cancelled':
      return (
        <Badge variant="destructive">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Cancelled
        </Badge>
      );
    default:
      return (
        <Badge variant="outline">
          <Clock className="h-3 w-3 mr-1" />
          {status}
        </Badge>
      );
  }
}

function InsurancePolicyCard({ policy, currencyCode, tenantId }: { policy: CustomerBonzahPolicy; currencyCode: string; tenantId: string | undefined }) {
  const [downloadingPdf, setDownloadingPdf] = useState<string | null>(null);
  const coverageTypes = policy.coverage_types || {};
  const activeCoverages = Object.entries(COVERAGE_LABELS).filter(
    ([key]) => coverageTypes[key]
  );
  const pdfIds = (coverageTypes as any)?.pdf_ids as Record<string, number> | undefined;
  const rental = policy.rentals;
  const vehicle = rental?.vehicles;
  const vehicleName = vehicle
    ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.reg
    : null;
  const isExtension = policy.policy_type === 'extension';

  const handleDownloadPdf = async (type: string, pdfId: number) => {
    if (!tenantId || !policy.policy_id) return;
    setDownloadingPdf(type);
    try {
      const { data, error } = await supabase.functions.invoke('bonzah-download-pdf', {
        body: { tenant_id: tenantId, pdf_id: String(pdfId), policy_id: policy.policy_id },
      });
      if (error || !data?.documentBase64) {
        toast.error('Failed to download PDF');
        return;
      }
      const byteChars = atob(data.documentBase64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${COVERAGE_LABELS[type] || type}-policy-${policy.policy_no || policy.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download PDF');
    } finally {
      setDownloadingPdf(null);
    }
  };

  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 bg-green-50 dark:bg-green-900/20 rounded-lg flex items-center justify-center">
            <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-sm sm:text-base">
                  {isExtension ? 'Extension Insurance' : 'Bonzah Insurance'}
                </h3>
                {vehicleName && (
                  <p className="text-xs sm:text-sm text-muted-foreground flex items-center gap-1">
                    <Car className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {vehicleName}
                      {rental?.rental_number && ` · ${rental.rental_number}`}
                    </span>
                  </p>
                )}
              </div>
              <div className="shrink-0">{getPolicyStatusBadge(policy.status)}</div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-x-3 sm:gap-x-4 gap-y-1 text-xs sm:text-sm">
              <div className="min-w-0">
                <span className="text-muted-foreground">Start:</span>{' '}
                {format(parseDateOnly(policy.trip_start_date), 'MMM d, yyyy')}
              </div>
              <div className="min-w-0">
                <span className="text-muted-foreground">End:</span>{' '}
                {format(parseDateOnly(policy.trip_end_date), 'MMM d, yyyy')}
              </div>
              <div className="min-w-0">
                <span className="text-muted-foreground">Premium:</span>{' '}
                <span className="font-medium">{formatCurrency(policy.premium_amount, currencyCode)}</span>
              </div>
              {policy.policy_no && (
                <div className="min-w-0">
                  <span className="text-muted-foreground">Policy #:</span>{' '}
                  <span className="break-all">{policy.policy_no}</span>
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeCoverages.map(([key, label]) => (
                  <Badge key={key} variant="secondary" className="text-xs">
                    {label}
                  </Badge>
                ))}
                {policy.policy_issued_at && (
                  <span className="text-xs text-muted-foreground ml-1">
                    Issued {format(new Date(policy.policy_issued_at), 'MMM d, yyyy')}
                  </span>
                )}
              </div>

              {/* PDF download buttons */}
              {pdfIds && Object.keys(pdfIds).length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {Object.entries(pdfIds).map(([type, pdfId]) => (
                    <Button
                      key={type}
                      variant="ghost"
                      size="sm"
                      disabled={downloadingPdf === type}
                      onClick={() => handleDownloadPdf(type, pdfId)}
                      title={`Download ${COVERAGE_LABELS[type] || type.toUpperCase()} policy PDF`}
                    >
                      {downloadingPdf === type ? (
                        <Clock className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      <span className="ml-1 text-xs">{COVERAGE_LABELS[type] || type.toUpperCase()} PDF</span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DocumentsPage() {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'USD';
  const { data: documents, isLoading } = useCustomerDocuments();
  const { data: insurancePolicies, isLoading: policiesLoading } = useCustomerInsurancePolicies();
  const { data: stats } = useCustomerDocumentStats();
  const deleteDocument = useDeleteCustomerDocument();
  const downloadDocument = useDownloadDocument();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<CustomerDocument | null>(null);

  const handleDelete = (document: CustomerDocument) => {
    setDocumentToDelete(document);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (documentToDelete) {
      deleteDocument.mutate(documentToDelete.id);
      setDeleteDialogOpen(false);
      setDocumentToDelete(null);
    }
  };

  const handleDownload = (document: CustomerDocument) => {
    downloadDocument.mutate(document);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">My Insurance</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Manage your insurance documents
          </p>
        </div>
        <Button onClick={() => setUploadDialogOpen(true)} className="w-full sm:w-auto">
          <Upload className="h-4 w-4 mr-2" />
          Upload Insurance
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
        <StatCard
          title="Active Policies"
          value={insurancePolicies?.filter(p => p.status === 'active').length || 0}
          icon={Shield}
          description="Bonzah insurance policies"
        />
        <StatCard
          title="Total Policies"
          value={insurancePolicies?.length || 0}
          icon={FileText}
        />
        <div className="col-span-2 md:col-span-1">
          <StatCard
            title="Uploaded Documents"
            value={stats?.totalDocuments || 0}
            icon={FileCheck}
            description="Insurance certificates"
          />
        </div>
      </div>

      {/* Bonzah Insurance Policies */}
      {(policiesLoading || (insurancePolicies && insurancePolicies.length > 0)) && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Insurance Policies</h2>
          {policiesLoading ? (
            <div className="space-y-4">
              {[...Array(2)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <Skeleton className="w-12 h-12 rounded-lg" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-4 w-64" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {insurancePolicies!.map((policy) => (
                <InsurancePolicyCard
                  key={policy.id}
                  policy={policy}
                  currencyCode={currencyCode}
                  tenantId={tenant?.id}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Documents List */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Uploaded Documents</h2>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <Skeleton className="w-12 h-12 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-64" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : documents && documents.length > 0 ? (
          <div className="space-y-4">
            {documents.map((document) => (
              <DocumentCard
                key={document.id}
                document={document}
                onDownload={() => handleDownload(document)}
                onDelete={() => handleDelete(document)}
                isDeleting={deleteDocument.isPending}
              />
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-2">No insurance documents yet</h3>
            <p className="text-muted-foreground mb-4">
              Upload your insurance certificate to get started.
            </p>
            <Button onClick={() => setUploadDialogOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload Insurance
            </Button>
          </Card>
        )}
      </div>

      {/* Upload Dialog */}
      <DocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{documentToDelete?.document_name}"?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
