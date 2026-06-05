/**
 * use-lead-document-upload — Spec Section 6.2.
 *
 * Uploads an applicant's document (licence/selfie/rideshare proof) to the
 * `lead-documents` storage bucket via a presigned URL obtained from the
 * `lead-document-presign` edge function. Returns the public URL of the uploaded
 * object so it can be embedded in the Apply form payload.
 *
 * Used by step-6-documents.tsx in the apply wizard.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export type LeadDocumentType =
  | "licence"
  | "selfie"
  | "rideshare_proof"
  | "insurance"
  | "passport"
  | "utility_bill"
  | "other";

interface PresignResponse {
  uploadUrl: string;
  token: string;
  objectPath: string;
  bucket: string;
  publicUrl: string;
  expiresInSeconds: number;
}

export interface UploadedDoc {
  documentType: LeadDocumentType;
  publicUrl: string;
  objectPath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];

export function useLeadDocumentUpload() {
  const { tenantSlug } = useTenant();
  const [uploading, setUploading] = useState<LeadDocumentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File, documentType: LeadDocumentType): Promise<UploadedDoc | null> => {
    setError(null);
    if (!tenantSlug) {
      setError("Tenant not detected. Please refresh.");
      return null;
    }
    if (file.size > MAX_BYTES) {
      setError("File is larger than 10MB. Please pick a smaller file.");
      return null;
    }
    if (!ACCEPT.includes(file.type)) {
      setError("Only JPG, PNG, and PDF files are allowed.");
      return null;
    }

    setUploading(documentType);
    try {
      const { data, error: presignErr } = await supabase.functions.invoke<PresignResponse>(
        "lead-document-presign",
        {
          body: {
            tenantSlug,
            documentType,
            fileName: file.name,
            mimeType: file.type,
          },
        },
      );

      if (presignErr || !data) {
        throw new Error(presignErr?.message ?? "Failed to get upload URL");
      }

      const { error: uploadErr } = await supabase.storage
        .from(data.bucket)
        .uploadToSignedUrl(data.objectPath, data.token, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadErr) throw uploadErr;

      return {
        documentType,
        publicUrl: data.publicUrl,
        objectPath: data.objectPath,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed. Please try again.";
      setError(msg);
      console.error("use-lead-document-upload error:", err);
      return null;
    } finally {
      setUploading(null);
    }
  };

  return { upload, uploading, error };
}
