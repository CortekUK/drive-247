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
import { AgreementActivityV2 } from "@/components/agreements-v2/agreement-activity-v2";
import { AGREEMENT_PAGE_BACKDROP_V2, AgreementPdfPagesV2 } from "@/components/agreements-v2/agreement-pdf-pages-v2";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui-v2/tabs";
import { AgreementPreviewV2 } from "@/components/agreements-v2/agreement-preview-v2";
import {
  AGREEMENT_LINK_LABEL_V2,
  AGREEMENT_STATUS_LABEL_V2,
  AGREEMENT_STATUS_TONE_LIST_V2,
  agreementReferenceV2,
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
    return "It was never sent: there were no e-sign credits left when it was issued. Resend it (top up first if your plan uses credits).";
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

/** Save the PDF the dialog has open, signed or not, under the agreement's name. */
async function savePdf(url: string, fromBlob: boolean, row: AgreementRowV2): Promise<void> {
  let href = url;
  let made = false;
  try {
    if (!fromBlob) {
      const response = await fetch(url);
      if (!response.ok) throw new Error("The PDF could not be fetched.");
      href = URL.createObjectURL(await response.blob());
      made = true;
    }
    const a = document.createElement("a");
    a.href = href;
    a.download = fileNameFor(row);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    if (made) URL.revokeObjectURL(href);
  }
}

/**
 * The Details / Activity switch: a rounded rectangle, and the chosen tab a
 * white tile with a hairline and a little weight, so which one is open reads
 * at a glance. Overrides the ui-v2 pill (and its focus ring, which drew a
 * second outline on the active tab). In dark mode the chosen tile is a lighter
 * white wash with a brighter edge, since ui-v2's dark active fill is barely
 * lighter than the track.
 */
const VIEW_TABS_LIST = "!h-11 w-full !rounded-xl bg-muted p-1 dark:bg-white/[0.04] dark:ring-1 dark:ring-white/10";
const VIEW_TABS_TRIGGER =
  "!h-full flex-1 !rounded-lg text-sm font-medium text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground focus-visible:!ring-0 focus-visible:!outline-none focus-visible:!border-primary/50 data-[state=active]:!border-border data-[state=active]:bg-background data-[state=active]:font-semibold data-[state=active]:text-foreground dark:text-white/55 dark:hover:text-white/80 dark:data-[state=active]:!border-white/25 dark:data-[state=active]:!bg-white/[0.14] dark:data-[state=active]:!text-white motion-reduce:transition-none";

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
  const pdfDoc = state.status === "ready" && state.doc.kind === "pdf" ? state.doc : null;
  const pdfUrl = pdfDoc?.url ?? null;
  const reference = row ? agreementReferenceV2(row) : null;
  const canResendRow = !!row && !!onResend && row.status !== "signed" && !!row.customerEmail && !!row.customerName;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => setSaveError(null), [row?.id, open]);

  const download = async () => {
    if (!row || !pdfDoc) return;
    setSaving(true);
    setSaveError(null);
    try {
      await savePdf(pdfDoc.url, pdfDoc.revoke, row);
    } catch (e) {
      setSaveError(e instanceof Error && e.message ? e.message : "The PDF could not be downloaded.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The document takes the whole left of the window; everything about it
          (details, Download, Resend, the activity) sits in the column on the right. */}
      <DialogContent className="grid h-[92dvh] grid-rows-[minmax(0,1fr)_minmax(0,45%)] gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1400px)] md:grid-cols-[minmax(0,1fr)_340px] md:grid-rows-1">
        <div className={`min-h-0 overflow-hidden ${AGREEMENT_PAGE_BACKDROP_V2}`}>
          {state.status === "loading" || state.status === "idle" ? (
            <div className="flex h-full items-center justify-center" role="status">
              <div className="text-center">
                <Loader2 className="mx-auto size-7 animate-spin text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />
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
            // The pages themselves, drawn straight in: no browser PDF viewer.
            <AgreementPdfPagesV2 url={state.doc.url} title={heading} />
          ) : state.doc.kind === "html" ? (
            <div className="h-full overflow-y-auto p-6">
              <AgreementPreviewV2 html={state.doc.html} className="mx-auto bg-transparent" />
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

        <Tabs defaultValue="details" className="flex min-h-0 flex-col gap-0 border-t md:border-t-0 md:border-l">
          <DialogHeader className="shrink-0 gap-3 border-b px-5 pt-4 pb-3 pr-14 text-left">
            <DialogTitle className="text-lg leading-snug break-words">{heading}</DialogTitle>
            <TabsList className={VIEW_TABS_LIST}>
              <TabsTrigger value="details" className={VIEW_TABS_TRIGGER}>Details</TabsTrigger>
              <TabsTrigger value="activity" className={VIEW_TABS_TRIGGER}>Activity</TabsTrigger>
            </TabsList>
          </DialogHeader>

          <TabsContent value="details" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {row && (
              <DialogDescription asChild>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                  <dt className="font-medium">Customer</dt>
                  <dd className="min-w-0 truncate font-medium text-foreground">{row.customerName || "—"}</dd>
                  {row.customerEmail && (
                    <>
                      <dt className="font-medium">Email</dt>
                      <dd className="min-w-0 truncate text-foreground" title={row.customerEmail}>{row.customerEmail}</dd>
                    </>
                  )}
                  <dt className="font-medium">Sent</dt>
                  <dd className="text-foreground tabular-nums">{formatAgreementSentAtV2(row.sentAt)}</dd>
                  <dt className="font-medium">Status</dt>
                  <dd>
                    <ListStatusText tone={AGREEMENT_STATUS_TONE_LIST_V2[row.status]}>
                      {AGREEMENT_STATUS_LABEL_V2[row.status]}
                    </ListStatusText>
                  </dd>
                  <dt className="font-medium">Linked to</dt>
                  <dd className="text-foreground">
                    {AGREEMENT_LINK_LABEL_V2[row.kind]}
                    {reference ? ` · ${reference}` : ""}
                  </dd>
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
              </DialogDescription>
            )}
            </div>
            {/* The actions sit at the foot of the column, below everything they act on. */}
            {row && (
              <div className="flex shrink-0 flex-col gap-2 border-t px-5 py-4">
                <Button onClick={() => void download()} disabled={!pdfDoc || saving || downloading} className="w-full">
                  {saving || downloading ? <Loader2 className="animate-spin" /> : <Download />}
                  {row.status === "signed" ? "Download signed PDF" : "Download PDF"}
                </Button>
                <div className="flex gap-2">
                  {canResendRow && (
                    <Button variant="outline" onClick={() => onResend!(row)} className="flex-1">
                      <RotateCw />
                      Resend
                    </Button>
                  )}
                  {pdfUrl && (
                    <Button variant="outline" onClick={() => window.open(pdfUrl, "_blank")} className="flex-1">
                      <ExternalLink />
                      New tab
                    </Button>
                  )}
                </div>
                {state.status === "ready" && state.doc.kind === "html" && (
                  <p className="text-xs text-muted-foreground">No PDF was produced: it never reached the signing service.</p>
                )}
                {saveError && <p className="text-xs text-destructive">{saveError}</p>}
              </div>
            )}
          </TabsContent>

          <TabsContent value="activity" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
            {row && open && <AgreementActivityV2 row={row} className="h-full bg-transparent" />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
