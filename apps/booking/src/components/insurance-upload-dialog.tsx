'use client';

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import { Upload, FileText, X, Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: (documentId: string, fileUrl: string) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];

export default function InsuranceUploadDialog({ open, onOpenChange, onUploadComplete }: Props) {
  const { tenant } = useTenant();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `${file.name}: Only PDF, JPG, and PNG files are allowed`;
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

      newFiles.forEach(file => {
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

      setFiles(prev => [...prev, ...validFiles]);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
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

      newFiles.forEach(file => {
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

      setFiles(prev => [...prev, ...validFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      toast.error("Please select at least one file to upload");
      return;
    }

    setUploading(true);
    try {
      // Get booking context from localStorage
      const bookingContext = typeof window !== 'undefined'
        ? JSON.parse(localStorage.getItem('booking_context') || '{}')
        : {};

      const uploadedDocIds: string[] = [];
      const uploadedFilePaths: string[] = [];

      // Upload each file
      for (const file of files) {
        const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const filePath = `insurance/${fileName}`;

        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('customer-documents')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('customer-documents')
          .getPublicUrl(filePath);

        // Create a temporary customer record for the insurance document
        // This will be linked to the actual customer when booking is created
        // Use unique email to avoid duplicate constraint violations
        const uniqueEmail = `pending-${Date.now()}-${Math.random().toString(36).substring(7)}@temp.booking`;
        const customerData: any = {
          name: 'Pending Booking',
          email: uniqueEmail,
          phone: '0000000000',
          type: 'Individual'
        };

        if (tenant?.id) {
          customerData.tenant_id = tenant.id;
        }

        const { data: tempCustomer, error: customerError } = await supabase
          .from('customers')
          .insert(customerData)
          .select()
          .single();

        if (customerError) {
          console.error('Error creating temp customer:', customerError);
          throw new Error(`Failed to create temporary record: ${customerError.message}`);
        }

        // Create customer_documents record with temp customer
        const docInsertData: any = {
          customer_id: tempCustomer.id,
          document_type: 'Insurance Certificate',
          document_name: file.name,
          file_url: filePath,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          ai_scan_status: 'pending',
          uploaded_at: new Date().toISOString()
        };

        if (tenant?.id) {
          docInsertData.tenant_id = tenant.id;
        }

        const { data: docData, error: docError } = await supabase
          .from('customer_documents')
          .insert(docInsertData)
          .select()
          .single();

        if (docError) {
          console.error('Database error:', docError);
          throw new Error(`Failed to save document record: ${docError.message}`);
        }

        // Store the temp customer ID and document ID in localStorage
        // so we can link them to the real customer later
        const tempDocInfo = {
          temp_customer_id: tempCustomer.id,
          document_id: docData.id,
          file_url: filePath
        };
        const existingDocs = JSON.parse(localStorage.getItem('pending_insurance_docs') || '[]');
        existingDocs.push(tempDocInfo);
        localStorage.setItem('pending_insurance_docs', JSON.stringify(existingDocs));

        uploadedDocIds.push(docData.id);
        uploadedFilePaths.push(filePath);

        // Trigger AI verification for this document
        console.log('[INSURANCE-UPLOAD] Triggering AI verification for document:', docData.id);
        try {
          const verifyResponse = await fetch('/api/verify-insurance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              documentId: docData.id,
              fileUrl: filePath,
              fileName: file.name,
              mimeType: file.type
            })
          });

          const verifyResult = await verifyResponse.json();
          console.log('[INSURANCE-UPLOAD] AI Verification Result:', verifyResult);

          if (verifyResult.status === 'rejected') {
            console.log('[INSURANCE-UPLOAD] Document REJECTED:', verifyResult.rejectionReason);
            // Show warning but don't block - let user proceed with manual review
            toast.warning('Document requires review', {
              duration: 6000,
              description: 'Our team will verify your insurance document shortly.'
            });
            // Don't return - allow user to proceed, manual review will happen
          } else if (verifyResult.status === 'approved') {
            console.log('[INSURANCE-UPLOAD] Document APPROVED');
            const extractedData = verifyResult.extractedData;
            if (extractedData?.provider || extractedData?.policyNumber) {
              toast.success('✓ Insurance Verified', {
                duration: 5000,
                description: `${extractedData.provider || 'Insurance'} • Policy: ${extractedData.policyNumber || 'Confirmed'}`
              });
            } else {
              toast.success('✓ Insurance document verified!', { duration: 4000 });
            }
          } else {
            console.log('[INSURANCE-UPLOAD] Document pending review');
            toast.info('Document uploaded', {
              duration: 4000,
              description: 'Verification in progress...'
            });
          }
        } catch (verifyError: unknown) {
          console.error('[INSURANCE-UPLOAD] Verification API error:', verifyError);
          // Continue anyway - manual review will be needed
          toast.info('Document uploaded for review', { duration: 3000 });
        }
      }

      // Only show this if multiple files, otherwise the verification toast is enough
      if (files.length > 1) {
        toast.success(`${files.length} documents uploaded!`);
      }

      // Return first document ID and file path for AI scanning
      onUploadComplete(uploadedDocIds[0], uploadedFilePaths[0]);

      // Reset state
      setFiles([]);

    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.message || "Failed to upload documents");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Upload Insurance Certificate</DialogTitle>
          <DialogDescription>
            Upload your insurance document (PDF, JPG, or PNG). We'll verify it using AI.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Type Info */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Accepted formats: PDF, JPG, PNG • Max size: 10MB per file
            </AlertDescription>
          </Alert>

          {/* Drag & Drop Area */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
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
                  Upload & Verify
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
