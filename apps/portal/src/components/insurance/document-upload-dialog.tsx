import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileText, X } from "lucide-react";
import { INSURANCE_DOCUMENT_TYPES } from "@/lib/insurance-utils";

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: string;
}

export function DocumentUploadDialog({
  open,
  onOpenChange,
  policyId
}: DocumentUploadDialogProps) {
  const { tenant } = useTenant();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [documentType, setDocumentType] = useState<string>("");
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFiles.length || !documentType) {
        throw new Error("Please select files and document type");
      }

      const uploadPromises = selectedFiles.map(async (file) => {
        // Upload file to Supabase Storage
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
        const filePath = `insurance-documents/${policyId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        // Get the public URL
        const { data: urlData } = supabase.storage
          .from('documents')
          .getPublicUrl(filePath);

        // Save document record to database
        const { error: dbError } = await supabase
          .from('insurance_documents')
          .insert({
            policy_id: policyId,
            doc_type: documentType,
            file_url: urlData.publicUrl,
            file_name: file.name,
            tenant_id: tenant?.id,
          });

        if (dbError) throw dbError;
      });

      await Promise.all(uploadPromises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policy-documents", policyId] });
      queryClient.invalidateQueries({ queryKey: ["insurance-policy-detail", policyId] });
      queryClient.invalidateQueries({ queryKey: ["insurance-policies"] });
      toast.success(`${selectedFiles.length} document(s) uploaded successfully`);
      handleClose();
    },
    onError: (error) => {
      toast.error(`Upload failed: ${error.message}`);
    },
  });

  const handleClose = () => {
    setSelectedFiles([]);
    setDocumentType("");
    onOpenChange(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    // Filter out duplicates by file name within the batch
    const seen = new Set<string>();
    const uniqueFiles = files.filter(f => {
      if (seen.has(f.name)) {
        return false;
      }
      seen.add(f.name);
      return true;
    });
    if (uniqueFiles.length < files.length) {
      toast.warning('Duplicate file(s) skipped');
    }
    setSelectedFiles(uniqueFiles);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Insurance Documents
          </DialogTitle>
          <DialogDescription>
            Upload supporting documents for this insurance policy
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Document Type Selection */}
          <div className="space-y-2">
            <Label htmlFor="document-type">Document Type</Label>
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger>
                <SelectValue placeholder="Select document type" />
              </SelectTrigger>
              <SelectContent>
                {INSURANCE_DOCUMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* File Selection */}
          <div className="space-y-2">
            <Label htmlFor="files">Select Files</Label>
            <Input
              id="files"
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
              onChange={handleFileSelect}
              className="cursor-pointer"
            />
            <p className="text-xs text-muted-foreground">
              Supported formats: PDF, JPG, PNG, WEBP, DOC, DOCX (max 10MB each)
            </p>
          </div>

          {/* Selected Files Preview */}
          {selectedFiles.length > 0 && (
            <div className="space-y-2">
              <Label>Selected Files ({selectedFiles.length})</Label>
              <div className="max-h-32 overflow-y-auto space-y-1 border rounded p-2">
                {selectedFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span>{file.name}</span>
                      <span className="text-muted-foreground">
                        ({(file.size / 1024 / 1024).toFixed(1)}MB)
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(index)}
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => uploadMutation.mutate()}
            disabled={!selectedFiles.length || !documentType || uploadMutation.isPending}
          >
            {uploadMutation.isPending ? "Uploading..." : `Upload ${selectedFiles.length} File(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}