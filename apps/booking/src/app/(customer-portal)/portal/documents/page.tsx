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
} from 'lucide-react';
import { format } from 'date-fns';

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
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold truncate">{document.document_name}</h3>
                <p className="text-sm text-muted-foreground capitalize">
                  {document.document_type.replace(/_/g, ' ')}
                </p>
              </div>
              {document.document_type === 'Insurance Certificate' && getStatusBadge(status)}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {document.insurance_provider && (
                <div>
                  <span className="text-muted-foreground">Provider:</span>{' '}
                  {document.insurance_provider}
                </div>
              )}
              {document.policy_number && (
                <div>
                  <span className="text-muted-foreground">Policy:</span>{' '}
                  {document.policy_number}
                </div>
              )}
              {document.start_date && (
                <div>
                  <span className="text-muted-foreground">Start:</span>{' '}
                  {format(new Date(document.start_date), 'MMM d, yyyy')}
                </div>
              )}
              {document.end_date && (
                <div>
                  <span className="text-muted-foreground">Expires:</span>{' '}
                  {format(new Date(document.end_date), 'MMM d, yyyy')}
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
                <span>•</span>
                <span>
                  Uploaded {format(new Date(document.created_at), 'MMM d, yyyy')}
                </span>
              </div>

              <div className="flex items-center gap-1">
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

export default function DocumentsPage() {
  const { data: documents, isLoading } = useCustomerDocuments();
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Insurance</h1>
          <p className="text-muted-foreground">
            Manage your insurance documents
          </p>
        </div>
        <Button onClick={() => setUploadDialogOpen(true)}>
          <Upload className="h-4 w-4 mr-2" />
          Upload Insurance
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Total Documents"
          value={stats?.totalDocuments || 0}
          icon={FileText}
        />
        <StatCard
          title="Active Insurance"
          value={stats?.activeInsurance || 0}
          icon={Shield}
          description="Valid insurance policies"
        />
        <StatCard
          title="Expiring Soon"
          value={stats?.expiringSoon || 0}
          icon={AlertTriangle}
          description="Expiring within 30 days"
        />
      </div>

      {/* Documents List */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Insurance Documents</h2>

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
