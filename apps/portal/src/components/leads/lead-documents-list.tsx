/**
 * LeadDocumentsList — Spec Section 6.4 (Documents section in left column).
 */
"use client";

import { FileText, CheckCircle2, Clock, AlertTriangle, Eye } from "lucide-react";
import { useLeadDocuments, type LeadDocument } from "@/hooks/use-lead-documents";
import { cn } from "@/lib/utils";

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
                <a
                  href={doc.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-indigo-600 hover:underline"
                >
                  <Eye className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
