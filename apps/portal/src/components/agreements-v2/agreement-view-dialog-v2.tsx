"use client";

/**
 * Agreements v2: View (D17). The drawer itself lives in
 * shared/portal-v2/agreements/view-dialog.tsx, which the customer portal's
 * Agreements page opens too; this binds it to the operator's calls: the
 * portal's `/api/esign/view`, the `agreements-v2` document and history
 * actions, the editor's preview for an agreement that only exists as html,
 * and the operator's wording for a rental row with nothing to show.
 */

import { AgreementViewDialog } from "../../../../../shared/portal-v2/agreements/view-dialog";
import {
  downloadSignedAgreement,
  loadAgreementDocument,
  type AgreementDocument,
  type AgreementDocumentSource,
} from "../../../../../shared/portal-v2/agreements/document";
import { AgreementPreviewV2 } from "@/components/agreements-v2/agreement-preview-v2";
import { fetchAgreementDocumentV2, fetchAgreementHistoryV2 } from "@/lib/agreements-v2/api-client";
import type { AgreementRowV2 } from "@/lib/agreements-v2/types";

export type AgreementDocumentV2 = AgreementDocument;

/** Why a rental row has nothing to show, in the operator's words. */
export function unavailableReasonV2(rawStatus: string | null | undefined): string {
  const status = (rawStatus ?? "").toLowerCase();
  if (status === "credit_failed") {
    return "It was never sent: there were no e-sign credits left when it was issued. Resend it (top up first if your plan uses credits).";
  }
  if (status === "send_failed" || status === "failed") {
    return "It was never sent: the signing service turned it down. Resend it to try again.";
  }
  return "No document has been produced for it yet. If it was sent a moment ago, try again shortly.";
}

const OPERATOR_SOURCE: AgreementDocumentSource = {
  fetchIndividualDocument: fetchAgreementDocumentV2,
  unavailableReason: unavailableReasonV2,
};

/** The document for a row, as the dialog and Download both need it. */
export function loadAgreementDocumentV2(row: AgreementRowV2): Promise<AgreementDocumentV2> {
  return loadAgreementDocument(row, OPERATOR_SOURCE);
}

/** Download the SIGNED PDF (the menu offers it only once a row is signed). */
export function downloadSignedAgreementV2(row: AgreementRowV2): Promise<void> {
  return downloadSignedAgreement(row, OPERATOR_SOURCE);
}

export function AgreementViewDialogV2({
  row,
  open,
  onOpenChange,
  downloading = false,
  onResend,
}: {
  row: AgreementRowV2 | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Offered only when the row is signed. */
  onDownload?: (row: AgreementRowV2) => void;
  downloading?: boolean;
  /** Given only when this viewer may resend this row. */
  onResend?: (row: AgreementRowV2) => void;
}) {
  return (
    <AgreementViewDialog
      row={row}
      open={open}
      onOpenChange={onOpenChange}
      loadDocument={(r) => loadAgreementDocument(r, OPERATOR_SOURCE)}
      fetchHistory={(id, kind) => fetchAgreementHistoryV2(id, kind)}
      renderHtml={(html) => <AgreementPreviewV2 html={html} className="mx-auto bg-transparent" />}
      downloading={downloading}
      onResend={onResend as ((r: unknown) => void) | undefined}
    />
  );
}
