"use client";

/**
 * Documents, before the first file is uploaded (illustration guide §4a).
 *
 * NOT RENDERED ANYWHERE YET: `/documents` is a server redirect to
 * `/insurances` and has no list of its own. This is ready for the day a
 * documents list exists; its host must gate it the same way as the others —
 * lean tenant AND an unfiltered count of zero (or `useForcedEmptyState("documents")`).
 */
import { FileText, Upload } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { DocumentsEmptyArt } from "@/components/illustrations-v2/scenes/documents";

export function DocumentsEmptyState({
  onUploadDocument,
}: {
  /** Omitted with view-only access. */
  onUploadDocument?: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={FileText}
      illustration={<DocumentsEmptyArt />}
      headline="Every document, filed where it belongs"
      body="Licences, insurance and signed agreements, kept against the customer and rental they belong to."
      primaryAction={
        onUploadDocument
          ? {
              label: "Upload a document",
              hint: "Add a file and choose the customer it belongs to.",
              onClick: onUploadDocument,
              icon: Upload,
            }
          : undefined
      }
    />
  );
}
