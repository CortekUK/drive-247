import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Upload, File, Download, Trash2 } from "lucide-react";
import { INSURANCE_DOCUMENT_TYPES } from "@/lib/insurance-utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface InsuranceDocument {
  id: string;
  doc_type: string;
  file_url: string;
  file_name?: string;
  uploaded_at: string;
}

interface InsuranceDocumentUploadProps {
  policyId: string;
  documents: InsuranceDocument[];
}

export function InsuranceDocumentUpload({ policyId, documents }: InsuranceDocumentUploadProps) {
  const [selectedDocType, setSelectedDocType] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { tenant } = useTenant();

  const uploadMutation = useMutation({
    mutationFn: async ({ file, docType }: { file: File; docType: string }) => {
      // Upload file to Supabase Storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${policyId}/${Date.now()}.${fileExt}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('insurance-docs')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('insurance-docs')
        .getPublicUrl(fileName);

      // Save document record
      const { data, error } = await supabase
        .from('insurance_documents')
        .insert({
          policy_id: policyId,
          doc_type: docType,
          file_url: publicUrl,
          file_name: file.name,
          tenant_id: tenant?.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policy-documents", policyId] });
      toast.success("Document uploaded successfully");
      setSelectedDocType("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    onError: (error) => {
      console.error("Upload error:", error);
      toast.error("Failed to upload document");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (documentId: string) => {
      let query = supabase
        .from('insurance_documents')
        .delete()
        .eq('id', documentId);

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      const { error } = await query;

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policy-documents", policyId] });
      toast.success("Document deleted successfully");
    },
    onError: (error) => {
      console.error("Delete error:", error);
      toast.error("Failed to delete document");
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedDocType) return;

    if (file.size > 20 * 1024 * 1024) { // 20MB limit
      toast.error("File size must be less than 20MB");
      return;
    }

    uploadMutation.mutate({ file, docType: selectedDocType });
  };

  const handleDownload = async (doc: InsuranceDocument) => {
    try {
      // Extract file path from the public URL
      const urlParts = doc.file_url.split('/');
      const filePath = urlParts.slice(-2).join('/'); // Get the last two parts (policyId/filename)
      
      const { data, error } = await supabase.storage
        .from('insurance-docs')
        .download(filePath);

      if (error) throw error;

      // Create download link
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name || 'document';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Failed to download document");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <Label htmlFor="doc-type">Document Type</Label>
          <Select value={selectedDocType} onValueChange={setSelectedDocType}>
            <SelectTrigger id="doc-type">
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
        <div>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            accept=".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx"
            className="hidden"
            disabled={!selectedDocType}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={!selectedDocType || uploadMutation.isPending}
            className="whitespace-nowrap"
          >
            <Upload className="w-4 h-4 mr-2" />
            {uploadMutation.isPending ? "Uploading..." : "Upload Document"}
          </Button>
        </div>
      </div>

      {documents.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium">Uploaded Documents</h4>
          <div className="border rounded-lg divide-y">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <File className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">{doc.doc_type}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.file_name} • 
                      {new Date(doc.uploaded_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownload(doc)}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Document</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this document? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMutation.mutate(doc.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}