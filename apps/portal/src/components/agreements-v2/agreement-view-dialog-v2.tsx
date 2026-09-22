"use client";

/**
 * Agreements v2: View (D17). The agreement that was sent, never "No document".
 *
 * Where the document comes from depends on the kind (D4):
 *   - a RENTAL row goes through the existing `POST /api/esign/view`, as the
 *     rental's Agreement stage does: the signed PDF on file once it is signed,
 *     otherwise the current PDF from the signing service (base64). `rentalId`
 *     rides along with `agreementId` so the route can resolve the right signing
 *     mode for a row that predates `rental_agreements.boldsign_mode`.
 *   - an INDIVIDUAL row goes through `fetchAgreementDocumentV2`: the provider's
 *     PDF when there is one, else the exact HTML that was sent (a failed send
 *     still has what was meant to go out), drawn by the same preview the editor
 *     uses.
 *   - a rental row that never reached the signing service has no document at
 *     all. The dialog says why, in words, instead of an empty frame.
 *
 * The details block carries the title, the CC list and the message (D13: the
 * message is kept on the row, so it is never lost however the agreement ends up
 * being signed).
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, ExternalLink, Loader2, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { AgreementPreviewV2 } from "@/components/agreements-v2/agreement-preview-v2";
import {
  AGREEMENT_STATUS_LABEL_V2,
  AGREEMENT_STATUS_TONE_LIST_V2,
  formatAgreementSentAtV2,
} from "@/components/agreements-v2/agreements-table-v2";
import { ListStatusText } from "@/components/shared/list-table-v2";
import { fetchAgreementDocumentV2 } from "@/lib/agreements-v2/api-client";
import type { AgreementRowV2 } from "@/lib/agreements-v2/types";

export type AgreementDocumentV2 =
  /** `revoke`: the URL is a blob this dialog made, and must free. */
  | { kind: "pdf"; url: string; revoke: boolean; signed: boolean }
  | { kind: "html"; html: string }
  | { kind: "unavailable"; reason: string };

/** Why a rental row has nothing to show, in the operator's words. */
export function unavailableReasonV2(rawStatus: string | null | undefined): string {
  const status = (rawStatus ?? "").toLowerCase();
  if (status === "credit_failed") {
    return "It was never sent: there were no e-sign credits left when it was issued. Top up, then resend it.";
  }
  if (status === "send_failed" || status === "failed") {
    return "It was never sent: the signing service turned it down. Resend it to try again.";
  }
  return "No document has been produced for it yet. If it was sent a moment ago, try again shortly.";
}

const pdfBlobUrl = (base64: string) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
};

/** The document for a row, as the dialog and Download both need it. */
export async function loadAgreementDocumentV2(row: AgreementRowV2): Promise<AgreementDocumentV2> {
  if (row.kind === "individual") {
    const doc = await fetchAgreementDocumentV2(row.id);
    if (doc.kind === "pdf") return { kind: "pdf", url: pdfBlobUrl(doc.base64), revoke: true, signed: doc.signed };
    return { kind: "html", html: doc.html };
  }

  if (!row.documentId) return { kind: "unavailable", reason: unavailableReasonV2(row.rawStatus) };

  const response = await fetch("/api/esign/view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rentalId: row.rentalId, agreementId: row.id }),
  });
  const data = await response.json().catch(() => ({}) as Record<string, any>);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "The signing service did not return the document.");
  }
  const signed = row.status === "signed" || data.status === "completed" || data.status === "signed";
  if (data.documentUrl) return { kind: "pdf", url: data.documentUrl, revoke: false, signed };
  if (data.documentBase64) return { kind: "pdf", url: pdfBlobUrl(data.documentBase64), revoke: true, signed };
  throw new Error("No document data came back.");
}

const fileNameFor = (row: AgreementRowV2) =>
  `${[row.title || (row.kind === "rental" ? "Rental agreement" : "Agreement"), row.customerName]
    .filter(Boolean)
    .join(" - ")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .slice(0, 120)}.pdf`;

/**
 * Download the SIGNED PDF (the menu offers it only once a row is signed). A
 * provider that has not finished stamping the signature yet is said so, rather
 * than handing over an unsigned copy under a signed name.
 */
export async function downloadSignedAgreementV2(row: AgreementRowV2): Promise<void> {
  const doc = await loadAgreementDocumentV2(row);
  if (doc.kind !== "pdf") throw new Error("There is no signed PDF for this agreement yet.");
  // A stored signed PDF comes back as a storage URL, which a cross-origin
  // `download` attribute would ignore, so it is fetched into a blob first. A
  // base64 PDF is already a blob this module made.
  let url = doc.url;
  let made = doc.revoke;
  try {
    if (!doc.signed) throw new Error("The signed copy is not ready yet. Try again in a minute.");
    if (!doc.revoke) {
      const response = await fetch(doc.url);
      if (!response.ok) throw new Error("The signed PDF could not be fetched.");
      url = URL.createObjectURL(await response.blob());
      made = true;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = fileNameFor(row);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    if (made) URL.revokeObjectURL(url);
  }
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; doc: AgreementDocumentV2 }
  | { status: "error"; message: string };

export function AgreementViewDialogV2({
  row,
  open,
  onOpenChange,
  onDownload,
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
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const blobRef = useRef<string | null>(null);

  const freeBlob = () => {
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    blobRef.current = null;
  };

  useEffect(() => {
    if (!open || !row) return;
    let cancelled = false;
    setState({ status: "loading" });
    loadAgreementDocumentV2(row)
      .then((doc) => {
        if (cancelled) {
          if (doc.kind === "pdf" && doc.revoke) URL.revokeObjectURL(doc.url);
          return;
        }
        freeBlob();
        if (doc.kind === "pdf" && doc.revoke) blobRef.current = doc.url;
        setState({ status: "ready", doc });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: error instanceof Error && error.message ? error.message : "The document could not be loaded.",
        });
      });
    return () => {
      cancelled = true;
    };
    // `row.id`, not `row`: a background refetch hands a new object for the same
    // agreement, and that must not reload the document under the operator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id, attempt]);

  // Free the PDF once the dialog closes or goes away.
  useEffect(() => {
    if (!open) {
      freeBlob();
      setState({ status: "idle" });
    }
  }, [open]);
  useEffect(() => freeBlob, []);

  const heading = row?.title || (row?.kind === "rental" ? "Rental agreement" : "Agreement");
  const pdfUrl = state.status === "ready" && state.doc.kind === "pdf" ? state.doc.url : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 gap-2 border-b px-6 py-4 pr-14">
          <DialogTitle className="truncate text-lg">{heading}</DialogTitle>
          {row && (
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-foreground">{row.customerName || "—"}</span>
                {row.customerEmail && <span>{row.customerEmail}</span>}
                <span className="tabular-nums">Sent {formatAgreementSentAtV2(row.sentAt)}</span>
                <ListStatusText tone={AGREEMENT_STATUS_TONE_LIST_V2[row.status]}>
                  {AGREEMENT_STATUS_LABEL_V2[row.status]}
                </ListStatusText>
              </div>
            </DialogDescription>
          )}
          {row && (row.cc.length > 0 || row.message || row.rentalRef) && (
            <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-[auto_1fr] sm:gap-x-3">
              {row.rentalRef && (
                <>
                  <dt className="font-medium">Rental</dt>
                  <dd className="text-foreground">{row.rentalRef}</dd>
                </>
              )}
              {row.cc.length > 0 && (
                <>
                  <dt className="font-medium">CC</dt>
                  <dd className="break-all text-foreground">{row.cc.join(", ")}</dd>
                </>
              )}
              {row.message && (
                <>
                  <dt className="font-medium">Message</dt>
                  <dd className="whitespace-pre-wrap text-foreground">{row.message}</dd>
                </>
              )}
            </dl>
          )}
          {row && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {row.status === "signed" && onDownload && (
                <Button variant="outline" size="sm" onClick={() => onDownload(row)} disabled={downloading}>
                  {downloading ? <Loader2 className="animate-spin" /> : <Download />}
                  Download signed PDF
                </Button>
              )}
              {pdfUrl && (
                <Button variant="outline" size="sm" onClick={() => window.open(pdfUrl, "_blank")}>
                  <ExternalLink />
                  Open in new tab
                </Button>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden bg-muted">
          {state.status === "loading" || state.status === "idle" ? (
            <div className="flex h-full items-center justify-center" role="status">
              <div className="text-center">
                <Loader2 className="mx-auto size-7 animate-spin text-primary" />
                <p className="mt-2 text-sm text-muted-foreground">Loading the agreement…</p>
              </div>
            </div>
          ) : state.status === "error" ? (
            <div className="flex h-full items-center justify-center p-6" role="alert">
              <div className="max-w-sm text-center">
                <AlertTriangle className="mx-auto size-6 text-destructive" />
                <p className="mt-2 text-sm font-medium text-foreground">The agreement could not be loaded</p>
                <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
                  <RefreshCw />
                  Try again
                </Button>
              </div>
            </div>
          ) : state.doc.kind === "pdf" ? (
            <iframe src={`${state.doc.url}#toolbar=1&navpanes=0`} className="h-full w-full border-0" title={heading} />
          ) : state.doc.kind === "html" ? (
            <div className="h-full overflow-y-auto p-6">
              <AgreementPreviewV2 html={state.doc.html} className="mx-auto" />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <div className="max-w-sm text-center">
                <AlertTriangle className="mx-auto size-6 text-destructive" />
                <p className="mt-2 text-sm font-medium text-foreground">
                  {row?.status === "failed" ? "This agreement never went out" : "No document yet"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{state.doc.reason}</p>
                {row && onResend && (
                  <Button size="sm" className="mt-4" onClick={() => onResend(row)}>
                    <RotateCw />
                    Resend
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
