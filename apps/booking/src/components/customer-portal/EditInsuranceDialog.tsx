'use client';

import { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Upload, FileText, X, AlertCircle, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import type { CustomerRental } from '@/hooks/use-customer-rentals';

interface EditInsuranceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: CustomerRental;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];

export function EditInsuranceDialog({ open, onOpenChange, rental }: EditInsuranceDialogProps) {
  const { tenant } = useTenant();
  const { customerUser } = useCustomerAuthStore();
  const queryClient = useQueryClient();

  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const isUploadingRef = useRef(false);

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

      setFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name));
        const uniqueNewFiles = validFiles.filter(f => !existingNames.has(f.name));
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

      setFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name));
        const uniqueNewFiles = validFiles.filter(f => !existingNames.has(f.name));
        return [...prev, ...uniqueNewFiles];
      });
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (isUploadingRef.current) return;
    if (files.length === 0) {
      toast.error('Please select at least one file to upload');
      return;
    }
    if (!tenant || !customerUser?.customer_id) {
      toast.error('Unable to upload. Please try again.');
      return;
    }

    isUploadingRef.current = true;
    setUploading(true);

    try {
      for (const file of files) {
        // Use same file path pattern as admin portal: {customer_id}/{timestamp}_{filename}
        const fileName = `${customerUser.customer_id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('customer-documents')
          .upload(fileName, file);

        if (uploadError) {
          throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
        }

        // Create document record linked to the rental
        // Match exact field names and values used by admin portal
        const { data: docData, error: docError } = await supabase
          .from('customer_documents')
          .insert({
            customer_id: customerUser.customer_id,
            tenant_id: tenant.id,
            rental_id: rental.id,
            document_type: 'Insurance Certificate',
            document_name: file.name,
            file_url: fileName,
            file_name: file.name,
            status: 'Pending',
            ai_scan_status: 'pending',
          })
          .select()
          .single();

        if (docError) {
          console.error('Error creating document record:', docError);
          throw new Error(`Failed to save document record: ${docError.message}`);
        }

        // Trigger AI scan for the document
        if (docData) {
          supabase.functions.invoke('scan-insurance-document', {
            body: { documentId: docData.id, fileUrl: fileName }
          }).catch(err => console.error('AI scan trigger failed:', err));
        }
      }

      toast.success('Insurance document uploaded successfully');

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['customer-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['customer-documents'] });

      setFiles([]);
      onOpenChange(false);
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.message || 'Failed to upload document');
    } finally {
      isUploadingRef.current = false;
      setUploading(false);
    }
  };

  const handleCancel = () => {
    setFiles([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update Insurance Document</DialogTitle>
          <DialogDescription>
            Upload your insurance certificate for this booking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2 overflow-hidden">
          {/* File Type Info */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>PDF, JPG, PNG • Max 10MB</span>
          </div>

          {/* Drag & Drop Area */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-5 text-center transition-colors ${
              dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
            }`}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm mb-2">
              Drop files here or click to browse
            </p>
            <Input
              id="insurance-file-upload"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <Label
              htmlFor="insurance-file-upload"
              className="cursor-pointer inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3"
            >
              Choose Files
            </Label>
          </div>

          {/* Selected Files List */}
          {files.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">Selected Files ({files.length})</Label>
              <div className="space-y-1.5 max-h-24 overflow-y-auto">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 border rounded-md bg-muted/50"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <p className="text-xs font-medium truncate">{file.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0"
                      onClick={() => removeFile(index)}
                      disabled={uploading}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={uploading}
              className="flex-1 h-9"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={files.length === 0 || uploading}
              className="flex-1 h-9"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
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
