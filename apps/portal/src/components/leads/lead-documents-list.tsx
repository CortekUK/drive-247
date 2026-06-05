/**
 * LeadDocumentsList — Spec Section 6.4 (Documents section in left column).
 */
"use client";

import { useState } from "react";
import { FileText, CheckCircle2, Clock, AlertTriangle, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLeadDocuments, type LeadDocument } from "@/hooks/use-lead-documents";
import { cn } from "@/lib/utils";

const LEAD_DOC_BUCKET = "lead-documents";

/**
 * Extract the bucket-relative object path from any of the URL shapes we've
 * stored historically: public URLs, signed URLs, or the bare object path itself.
 * The bucket is private, so we always have to re-sign at view time.
 */
function extractObjectPath(fileUrl: string): string | null {
  if (!fileUrl) return null;
  // Bare object path (newest uploads might store this)
  if (!fileUrl.startsWith("http")) return fileUrl.replace(/^\/+/, "");
  const marker = `/${LEAD_DOC_BUCKET}/`;
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  // Strip query string (signed URLs carry ?token=...)
  return fileUrl.slice(idx + marker.length).split("?")[0];
}

const DOC_LABELS: Record<LeadDocument["document_type"], string> = {
  licence: "Driver licence",
  selfie: "Selfie",
  rideshare_proof: "Rideshare proof",
  insurance: "Insurance",
  passport: "Passport",
  utility_bill: "Utility bill",
  other: "Other",
};

const STATUS_STYLES: Record<LeadDocument["verification_status"], { Icon: typeof Clock; label: string; color: string }> = {
  pending: { Icon: Clock, label: "Pending", color: "text-amber-600" },
  uploaded: { Icon: Clock, label: "Uploaded", color: "text-blue-600" },
  verifying: { Icon: Clock, label: "Verifying", color: "text-indigo-600" },
  verified: { Icon: CheckCircle2, label: "Verified", color: "text-emerald-600" },
  failed: { Icon: AlertTriangle, label: "Failed", color: "text-red-600" },
  expired: { Icon: AlertTriangle, label: "Expired", color: "text-zinc-500" },
};

export function LeadDocumentsList({ leadId }: { leadId: string }) {
  const { data: docs = [], isLoading } = useLeadDocuments(leadId);
  // Track which doc is currently being signed so we can disable the eye button + show a spinner.
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const openDoc = async (doc: LeadDocument) => {
    const objectPath = extractObjectPath(doc.file_url);
    if (!objectPath) {
      toast.error("Document path missing or malformed");
      return;
    }
    setResolvingId(doc.id);
    try {
      // 5-minute signed URL. The bucket is private — we never expose a permanent
      // link because licence + selfie images are PII.
      const { data, error } = await supabase
        .storage
        .from(LEAD_DOC_BUCKET)
        .createSignedUrl(objectPath, 300);
      if (error || !data?.signedUrl) {
        throw error ?? new Error("No signed URL returned");
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to open document";
      toast.error(msg);
    } finally {
      setResolvingId(null);
    }
  };

  if (isLoading) {
    return <p className="text-xs text-[#737373]">Loading documents…</p>;
  }
  if (docs.length === 0) {
    return (
      <p className="text-xs text-[#737373]">
        No documents uploaded yet.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {docs.map((doc) => {
        const status = STATUS_STYLES[doc.verification_status];
        const Icon = status.Icon;
        const isResolving = resolvingId === doc.id;
        return (
          <li key={doc.id} className="rounded-md border border-[#f1f5f9] bg-white p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 shrink-0 text-[#737373]" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[#080812]">{DOC_LABELS[doc.document_type]}</div>
                  <div className={cn("mt-0.5 flex items-center gap-1 text-xs", status.color)}>
                    <Icon className="h-3 w-3" />
                    {status.label}
                  </div>
                </div>
              </div>
              {doc.file_url && (
                <button
                  type="button"
                  onClick={() => openDoc(doc)}
                  disabled={isResolving}
                  title="Open document"
                  className="rounded p-1 text-indigo-600 hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-50"
                >
                  {isResolving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
