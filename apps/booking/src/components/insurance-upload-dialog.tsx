'use client';

import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
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
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Ref for synchronous double-click prevention (state updates are async)
  const isUploadingRef = useRef(false);

  // Clear localStorage when dialog opens to prevent duplicates
  // Use useEffect to ensure it runs reliably
  useEffect(() => {
    if (open) {
      console.log('[INSURANCE-UPLOAD] Dialog opened - clearing old pending files from localStorage');
      localStorage.removeItem('pending_insurance_files');
    }
  }, [open]);

  /**
   * Handle cancel - just close the dialog, no cleanup needed
   * since we only store files in storage (not DB) until checkout
   */
  const handleCancel = () => {
    setFiles([]);
    onOpenChange(false);
  };

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

      // Filter out duplicates by file name
      setFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name));
        const uniqueNewFiles = validFiles.filter(f => !existingNames.has(f.name));
        if (uniqueNewFiles.length < validFiles.length) {
          toast.warning('Duplicate file(s) skipped');
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
        toast.error(errors.join('\n'));
      }

      // Filter out duplicates by file name
      setFiles(prev => {
        const existingNames = new Set(prev.map(f => f.name));
        const uniqueNewFiles = validFiles.filter(f => !existingNames.has(f.name));
        if (uniqueNewFiles.length < validFiles.length) {
          toast.warning('Duplicate file(s) skipped');
        }
        return [...prev, ...uniqueNewFiles];
      });
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    // GUARD: Prevent double-click using ref (synchronous check)
    // State updates are async, so checking `uploading` state alone isn't enough
    if (isUploadingRef.current) {
      console.log('[INSURANCE-UPLOAD] Upload already in progress, ignoring duplicate click');
      return;
    }

    if (files.length === 0) {
      toast.error("Please select at least one file to upload");
      return;
    }

    // Set ref immediately (synchronous) to block any subsequent clicks
    isUploadingRef.current = true;
    setUploading(true);

    try {
      const uploadedFilePaths: string[] = [];

      // Upload each file to storage only - NO database writes
      // Customer and document records will be created at checkout
      for (const file of files) {
        const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const filePath = `insurance/${fileName}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('customer-documents')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
        }

        // Store file metadata in localStorage for later use at checkout
        // No temp customer or document records are created in the database
        const pendingFileInfo = {
          file_path: filePath,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          uploaded_at: new Date().toISOString()
        };
        const existingFiles = JSON.parse(localStorage.getItem('pending_insurance_files') || '[]');
        existingFiles.push(pendingFileInfo);
        localStorage.setItem('pending_insurance_files', JSON.stringify(existingFiles));

        uploadedFilePaths.push(filePath);

        console.log('[INSURANCE-UPLOAD] File uploaded to storage:', filePath);
      }

      // Show upload success message
      toast.success('Document uploaded', {
        duration: 4000,
        description: 'Document will be linked to your booking at checkout.'
      });

      // Return file path (no document ID since we haven't created the record yet)
      // The parent component can use this for preview or AI scanning
      onUploadComplete('pending', uploadedFilePaths[0]);

      // Reset state
      setFiles([]);

    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.message || "Failed to upload documents");
    } finally {
      // Reset both ref and state
      isUploadingRef.current = false;
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
              onClick={handleCancel}
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
