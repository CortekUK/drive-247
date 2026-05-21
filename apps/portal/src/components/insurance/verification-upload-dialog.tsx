"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileImage, X, Loader2, FileText } from "lucide-react";
import { useUploadAndVerifyInsurance } from "@/hooks/use-insurance-verifications";
import { pdfToImage } from "@/lib/pdf-to-image";

const ACCEPTED = "image/jpeg,image/png,image/webp,image/heic,application/pdf";

export function VerificationUploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadAndVerifyInsurance();

  const reset = () => {
    setFiles([]);
    setIsDragging(false);
  };

  const handleFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter((f) =>
      ACCEPTED.split(",").includes(f.type),
    );
    if (!arr.length) {
      toast.error("Only PDF / JPG / PNG / WebP / HEIC files are accepted.");
      return;
    }
    setFiles((prev) => [...prev, ...arr]);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  const submit = async () => {
    if (!files.length) {
      toast.error("Pick at least one file");
      return;
    }
    try {
      for (const file of files) {
        let toUpload = file;
        if (file.type === "application/pdf") {
          const { blob } = await pdfToImage(file, 2);
          const newName = file.name.replace(/\.pdf$/i, "") + ".png";
          toUpload = new File([blob], newName, { type: "image/png" });
        }
        await upload.mutateAsync({ file: toUpload });
      }
      toast.success(
        `Uploaded ${files.length} document${files.length === 1 ? "" : "s"} — AI is analyzing now`,
      );
      reset();
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Upload failed");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Verify an insurance document</DialogTitle>
          <DialogDescription>
            Upload an image of the insurance certificate. Our AI will check
            legitimacy and extract policy details.
          </DialogDescription>
        </DialogHeader>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors ${
            isDragging
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
          }`}
        >
          <Upload className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">
            Drop files here or click to browse
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            PDF, JPG, PNG, WebP, or HEIC — up to 20MB each
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>

        {files.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-auto">
            {files.map((f, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {f.type === "application/pdf" ? (
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <FileImage className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="truncate">{f.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {(f.size / 1024).toFixed(0)} KB
                  </span>
                  {f.type === "application/pdf" && (
                    <span className="text-[10px] text-indigo-600 shrink-0 uppercase font-semibold">
                      pdf
                    </span>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFiles((prev) => prev.filter((_, i) => i !== idx));
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            disabled={upload.isPending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={upload.isPending || !files.length}>
            {upload.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload & Verify
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
