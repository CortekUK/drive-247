'use client';

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, X, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface InsuranceUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId?: string;
  onUploadComplete: (documentId: string) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['application/pdf'];

export function InsuranceUploadDialog({
  open,
  onOpenChange,
  customerId,
  onUploadComplete
}: InsuranceUploadDialogProps) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `${file.name}: Only PDF files are allowed`;
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
        toast({
          title: "Invalid files",
          description: errors.join('\n'),
          variant: "destructive"
        });
      }

      // Filter out duplicates by file name
      setFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name));
        const uniqueNewFiles = validFiles.filter(f => !existingNames.has(f.name));
        if (uniqueNewFiles.length < validFiles.length) {
          toast({
            title: "Duplicate skipped",
            description: "File with the same name already selected",
          });
        }
        return [...prev, ...uniqueNewFiles];
      });
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
        toast({
          title: "Invalid files",
          description: errors.join('\n'),
          variant: "destructive"
        });
      }

      // Filter out duplicates by file name
      setFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name));
        const uniqueNewFiles = validFiles.filter(f => !existingNames.has(f.name));
        if (uniqueNewFiles.length < validFiles.length) {
          toast({
            title: "Duplicate skipped",
            description: "File with the same name already selected",
          });
        }
        return [...prev, ...uniqueNewFiles];
      });
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      toast({
        title: "No files selected",
        description: "Please select at least one file to upload",
        variant: "destructive"
      });
      return;
    }

    setUploading(true);
    try {
      const uploadedDocIds: string[] = [];

      // Upload each file
      for (const file of files) {
        const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const filePath = `insurance/${tenant?.id || 'unknown'}/${fileName}`;

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

        // Create customer_documents record
        const docInsertData: any = {
          document_type: 'Insurance Certificate',
          document_name: file.name,
          file_url: filePath,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          ai_scan_status: 'pending',
          uploaded_at: new Date().toISOString(),
          tenant_id: tenant?.id
        };

        // Link to customer if provided
        if (customerId) {
          docInsertData.customer_id = customerId;
        }

        // Check if a document with the same filename already exists for this customer
        // If it does, update it instead of inserting (allows re-uploading same document)
        let docData: any = null;
        let docError: any = null;

        if (customerId) {
          // First, check for existing document with same filename for this customer
          const { data: existingDoc } = await supabase
            .from('customer_documents')
            .select('id')
            .eq('tenant_id', tenant?.id)
            .eq('customer_id', customerId)
            .eq('document_type', 'Insurance Certificate')
            .eq('file_name', file.name)
            .is('rental_id', null)
            .maybeSingle();

          if (existingDoc) {
            // Update existing document record
            const { data, error } = await supabase
              .from('customer_documents')
              .update({
                file_url: filePath,
                file_size: file.size,
                mime_type: file.type,
                ai_scan_status: 'pending',
                uploaded_at: new Date().toISOString()
              })
              .eq('id', existingDoc.id)
              .select()
              .single();
            docData = data;
            docError = error;
          } else {
            // Insert new document record
            const { data, error } = await supabase
              .from('customer_documents')
              .insert(docInsertData)
              .select()
              .single();
            docData = data;
            docError = error;
          }
        } else {
          // No customer ID, just insert
          const { data, error } = await supabase
            .from('customer_documents')
            .insert(docInsertData)
            .select()
            .single();
          docData = data;
          docError = error;
        }

        if (docError) {
          console.error('Database error:', docError);
          throw new Error(`Failed to save document record: ${docError.message}`);
        }

        uploadedDocIds.push(docData.id);

        // Trigger AI scan if function exists
        try {
          await supabase.functions.invoke('scan-insurance-document', {
            body: { documentId: docData.id }
          });
        } catch (scanError) {
          console.error('AI scan error (non-critical):', scanError);
          // Don't fail the upload if scan fails
        }
      }

      toast({
        title: "Upload successful",
        description: `${files.length} document(s) uploaded successfully`,
      });

      // Return first document ID
      onUploadComplete(uploadedDocIds[0]);

      // Reset state and close dialog
      setFiles([]);
      onOpenChange(false);

    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload documents",
        variant: "destructive"
      });
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
            Upload the customer's insurance document. We'll verify it using AI.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Type Info */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Accepted format: PDF only • Max size: 10MB per file
            </AlertDescription>
          </Alert>

          {/* Drag & Drop Area */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
            }`}
          >
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm font-medium mb-2">
              Drag and drop your files here, or click to browse
            </p>
            <Input
              id="file-upload"
              type="file"
              accept=".pdf"
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
