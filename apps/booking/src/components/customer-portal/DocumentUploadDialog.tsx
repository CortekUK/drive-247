'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { toast } from 'sonner';
import { Upload, FileText, X, Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useQueryClient } from '@tanstack/react-query';

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export function DocumentUploadDialog({
  open,
  onOpenChange,
}: DocumentUploadDialogProps) {
  const { customerUser } = useCustomerAuthStore();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [insuranceProvider, setInsuranceProvider] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `${file.name}: Only PDF, JPEG, and PNG files are allowed`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `${file.name}: File size must be less than 10MB`;
    }
    return null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      const validFiles: File[] = [];
      const errors: string[] = [];

      newFiles.forEach((file) => {
        const error = validateFile(file);
        if (error) {
          errors.push(error);
        } else {
          validFiles.push(file);
        }
      });

      if (errors.length > 0) {
        toast.error(errors.join('\n'));
      }

      setFiles((prev) => {
        const existingNames = new Set(prev.map((f) => f.name));
        const uniqueNewFiles = validFiles.filter(
          (f) => !existingNames.has(f.name)
        );
        return [...prev, ...uniqueNewFiles];
      });
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files) {
      const newFiles = Array.from(e.dataTransfer.files);
      const validFiles: File[] = [];
      const errors: string[] = [];

      newFiles.forEach((file) => {
        const error = validateFile(file);
        if (error) {
          errors.push(error);
        } else {
          validFiles.push(file);
        }
      });

      if (errors.length > 0) {
        toast.error(errors.join('\n'));
      }

      setFiles((prev) => {
        const existingNames = new Set(prev.map((f) => f.name));
        const uniqueNewFiles = validFiles.filter(
          (f) => !existingNames.has(f.name)
        );
        return [...prev, ...uniqueNewFiles];
      });
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setFiles([]);
    setInsuranceProvider('');
    setPolicyNumber('');
    setStartDate('');
    setEndDate('');
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      toast.error('Please select at least one file to upload');
      return;
    }

    if (!customerUser?.customer_id || !customerUser?.tenant_id) {
      toast.error('You must be logged in to upload documents');
      return;
    }

    setUploading(true);
    try {
      for (const file of files) {
        const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const filePath = `insurance/${customerUser.tenant_id}/${customerUser.customer_id}/${fileName}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('customer-documents')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
        }

        // Create customer_documents record
        const docData: Record<string, unknown> = {
          customer_id: customerUser.customer_id,
          tenant_id: customerUser.tenant_id,
          document_type: 'Insurance Certificate',
          document_name: 'Insurance Certificate',
          file_url: filePath,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          verified: false,
        };

        // Add insurance-specific fields
        if (insuranceProvider) docData.insurance_provider = insuranceProvider;
        if (policyNumber) docData.policy_number = policyNumber;
        if (startDate) docData.start_date = startDate;
        if (endDate) docData.end_date = endDate;

        const { data: insertedDoc, error: docError } = await supabase
          .from('customer_documents')
          .insert(docData)
          .select()
          .single();

        if (docError) {
          console.error('Database error:', docError);
          throw new Error(`Failed to save document record: ${docError.message}`);
        }

        // Trigger AI scan for insurance documents
        if (insertedDoc) {
          try {
            await supabase.functions.invoke('scan-insurance-document', {
              body: { documentId: insertedDoc.id },
            });
          } catch (scanError) {
            console.error('AI scan error (non-critical):', scanError);
          }
        }
      }

      toast.success(`Insurance document${files.length > 1 ? 's' : ''} uploaded successfully`);

      // Invalidate queries to refresh the list and update onboarding status
      queryClient.invalidateQueries({ queryKey: ['customer-documents'] });
      queryClient.invalidateQueries({ queryKey: ['customer-document-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customer-onboarding'] });

      // Reset form and close dialog
      resetForm();
      onOpenChange(false);
    } catch (error: unknown) {
      console.error('Upload error:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to upload documents'
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Upload Insurance Document</DialogTitle>
          <DialogDescription>
            Upload your insurance certificate. It will be verified automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Type Info */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Accepted formats: PDF, JPEG, PNG • Max size: 10MB per file
            </AlertDescription>
          </Alert>

          {/* Insurance fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="insurance-provider">Insurance Provider</Label>
              <Input
                id="insurance-provider"
                placeholder="e.g., GEICO"
                value={insuranceProvider}
                onChange={(e) => setInsuranceProvider(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy-number">Policy Number</Label>
              <Input
                id="policy-number"
                placeholder="e.g., POL123456"
                value={policyNumber}
                onChange={(e) => setPolicyNumber(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">Expiry Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* Drag & Drop Area */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25'
            }`}
          >
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm font-medium mb-2">
              Drag and drop your files here, or click to browse
            </p>
            <Input
              id="file-upload"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <Label
              htmlFor="file-upload"
              className="cursor-pointer inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
            >
              Choose Files
            </Label>
          </div>

          {/* Selected Files List */}
          {files.length > 0 && (
            <div className="space-y-2">
              <Label>Selected Files ({files.length})</Label>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-3 border rounded-lg bg-muted/50"
                  >
                    <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(index)}
                      disabled={uploading}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={uploading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={files.length === 0 || uploading}
              className="flex-1"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
