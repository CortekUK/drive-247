"use client";

import { useRef } from "react";
import { useFormContext } from "react-hook-form";
import { Loader2, CheckCircle2, Upload, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useLeadDocumentUpload, LeadDocumentType } from "@/hooks/use-lead-document-upload";
import type { ApplyFormValues } from "@/client-schemas/apply";

interface DocSlotProps {
  documentType: LeadDocumentType;
  field: "licencePhotoUrl" | "selfieUrl" | "rideshareProofUrl";
  title: string;
  hint?: string;
}

function DocSlot({ documentType, field, title, hint }: DocSlotProps) {
  const { watch, setValue } = useFormContext<ApplyFormValues>();
  const url = watch(field);
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading, error } = useLeadDocumentUpload();

  const handleFile = async (file: File) => {
    const doc = await upload(file, documentType);
    if (doc) {
      setValue(field, doc.publicUrl, { shouldValidate: true });
    }
  };

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-sm font-medium">{title}</Label>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {url && <CheckCircle2 className="h-4 w-4 text-green-600" aria-label="Uploaded" />}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <Button
          type="button"
          variant={url ? "outline" : "secondary"}
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading !== null}
        >
          {uploading === documentType ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</>
          ) : (
            <><Upload className="mr-2 h-4 w-4" /> {url ? "Replace" : "Upload"}</>
          )}
        </Button>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary underline-offset-2 hover:underline">
            View
          </a>
        )}
      </div>
      {error && (
        <p className="mt-2 flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" /> {error}
        </p>
      )}
    </div>
  );
}

export function Step6Documents() {
  const { watch } = useFormContext<ApplyFormValues>();
  const purpose = watch("purpose");
  const isGig = ["uber", "lyft", "doordash", "instacart", "delivery"].includes(purpose);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Uploading documents now speeds up review. You can also share them later if needed.
      </p>
      <DocSlot
        documentType="licence"
        field="licencePhotoUrl"
        title="Driver licence (front)"
        hint="Clear photo or scan, JPG / PNG / PDF, max 10MB."
      />
      <DocSlot
        documentType="selfie"
        field="selfieUrl"
        title="Selfie"
        hint="Helps us verify your identity."
      />
      {isGig && (
        <DocSlot
          documentType="rideshare_proof"
          field="rideshareProofUrl"
          title="Rideshare / delivery account proof"
          hint="Screenshot of your driver dashboard or rating."
        />
      )}
    </div>
  );
}
