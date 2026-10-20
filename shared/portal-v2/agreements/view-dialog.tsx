"use client";

/**
 * The agreement drawer (D17), shared by both portals: the operator's
 * Agreements tab (agreement-view-dialog-v2.tsx binds it to its own calls) and
 * the customer portal's Agreements page. The agreement that was sent, never
 * "No document".
 *
 * The document takes the whole left of the window, drawn page by page; the
 * column on the right carries the title, the Details / Activity switch, and
 * at its foot Download and New tab. The close control is the dialog's own, in
 * the top right corner.
 *
 * Details are the same rows on both sides, except the first two, which name
 * the other party: the customer and their email for the operator, the
 * company and its main email for the customer (`party`).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Download, ExternalLink, Loader2, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "../timeline/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../tabs";
import { cn } from "../cn";
import { V2_LIST_TONES } from "../list-styles";
import { AgreementActivity, type FetchAgreementHistory } from "./activity";
import { saveAgreementPdf, type AgreementDocument } from "./document";
import {
  AGREEMENT_LINK_LABEL,
  AGREEMENT_STATUS_LABEL,
  AGREEMENT_STATUS_TONE,
  agreementReference,
  formatAgreementSentAt,
  type AgreementListRow,
} from "./list";
import { AGREEMENT_PAGE_BACKDROP, AgreementPdfPages } from "./pdf-pages";

/**
 * The Details / Activity switch: a rounded rectangle, and the chosen tab a
 * white tile with a hairline and a little weight, so which one is open reads
 * at a glance. Overrides the ui-v2 pill (and its focus ring, which drew a
 * second outline on the active tab).
 */
export const VIEW_TABS_LIST = "!h-11 w-full !rounded-[var(--v2-radius-xl,0.75rem)] bg-v2-muted p-1 dark:bg-white/[0.04] dark:ring-1 dark:ring-white/10";
export const VIEW_TABS_TRIGGER =
  "!h-full flex-1 !rounded-[var(--v2-radius,var(--radius))] text-sm font-medium text-v2-muted-fg transition-colors duration-200 ease-out hover:text-v2-fg focus-visible:!ring-0 focus-visible:!outline-none focus-visible:!border-v2-primary/50 data-[state=active]:!border-v2-border data-[state=active]:bg-v2-bg data-[state=active]:font-semibold data-[state=active]:text-v2-fg dark:text-white/55 dark:hover:text-white/80 dark:data-[state=active]:!border-white/25 dark:data-[state=active]:!bg-white/[0.14] dark:data-[state=active]:!text-white motion-reduce:transition-none";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; doc: AgreementDocument }
  | { status: "error"; message: string };

/** The first two Details rows: who is on the other side of the agreement. */
export interface AgreementParty {
  /** "Customer" (operator) or "Company" (customer). */
  label: string;
  name: string;
  email: string | null;
}

export interface AgreementViewDialogProps {
  row: AgreementListRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadDocument: (row: AgreementListRow) => Promise<AgreementDocument>;
  fetchHistory: FetchAgreementHistory;
  /** The first two Details rows. Omitted: the row's customer and email (the operator's view). */
  party?: AgreementParty;
  /** Draws an agreement that only exists as the html that was sent (individual rows). */
  renderHtml?: (html: string) => ReactNode;
  downloading?: boolean;
  /** Given only when this viewer may resend this row. */
  onResend?: (row: AgreementListRow) => void;
}

export function AgreementViewDialog({
  row,
  open,
  onOpenChange,
  loadDocument,
  fetchHistory,
  party,
  renderHtml,
  downloading = false,
  onResend,
}: AgreementViewDialogProps) {
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
    loadDocument(row)
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
    // agreement, and that must not reload the document under the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id, attempt]);

  // Free the PDF once the drawer closes or goes away.
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
  const reference = row ? agreementReference(row) : null;
  const canResendRow = !!row && !!onResend && row.status !== "signed" && !!row.customerEmail && !!row.customerName;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => setSaveError(null), [row?.id, open]);

  const who: AgreementParty | null = row ? party ?? { label: "Customer", name: row.customerName, email: row.customerEmail || null } : null;

  const download = async () => {
    if (!row || !pdfDoc) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveAgreementPdf(pdfDoc.url, pdfDoc.revoke, row);
    } catch (e) {
      setSaveError(e instanceof Error && e.message ? e.message : "The PDF could not be downloaded.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The document takes the whole left of the window; everything about it
          (details, Download, the activity) sits in the column on the right. */}
      <DialogContent className="grid h-[92dvh] grid-rows-[minmax(0,1fr)_minmax(0,45%)] gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1400px)] md:grid-cols-[minmax(0,1fr)_340px] md:grid-rows-1">
        <div className={`min-h-0 overflow-hidden ${AGREEMENT_PAGE_BACKDROP}`}>
          {state.status === "loading" || state.status === "idle" ? (
            <div className="flex h-full items-center justify-center" role="status">
              <div className="text-center">
                <Loader2 className="mx-auto size-7 animate-spin text-v2-primary dark:text-v2-link" />
                <p className="mt-2 text-sm text-v2-muted-fg">Loading the agreement…</p>
              </div>
            </div>
          ) : state.status === "error" ? (
            <div className="flex h-full items-center justify-center p-6" role="alert">
              <div className="max-w-sm text-center">
                <AlertTriangle className="mx-auto size-6 text-v2-destructive" />
                <p className="mt-2 text-sm font-medium text-v2-fg">The agreement could not be loaded</p>
                <p className="mt-1 text-sm text-v2-muted-fg">{state.message}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
                  <RefreshCw />
                  Try again
                </Button>
              </div>
            </div>
          ) : state.doc.kind === "pdf" ? (
            // The pages themselves, drawn straight in: no browser PDF viewer.
            <AgreementPdfPages url={state.doc.url} title={heading} />
          ) : state.doc.kind === "html" ? (
            <div className="h-full overflow-y-auto p-6">{renderHtml ? renderHtml(state.doc.html) : null}</div>
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <div className="max-w-sm text-center">
                <AlertTriangle className="mx-auto size-6 text-v2-destructive" />
                <p className="mt-2 text-sm font-medium text-v2-fg">
                  {row?.status === "failed" ? "This agreement never went out" : "No document yet"}
                </p>
                <p className="mt-1 text-sm text-v2-muted-fg">{state.doc.reason}</p>
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

        <Tabs defaultValue="details" className="flex min-h-0 flex-col gap-0 border-t border-v2-border md:border-t-0 md:border-l">
          <DialogHeader className="shrink-0 gap-3 border-b border-v2-border px-5 pt-4 pb-3 pr-14 text-left">
            <DialogTitle className="text-lg leading-snug break-words">{heading}</DialogTitle>
            <TabsList className={VIEW_TABS_LIST}>
              <TabsTrigger value="details" className={VIEW_TABS_TRIGGER}>Details</TabsTrigger>
              <TabsTrigger value="activity" className={VIEW_TABS_TRIGGER}>Activity</TabsTrigger>
            </TabsList>
          </DialogHeader>

          <TabsContent value="details" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {row && who && (
                <DialogDescription asChild>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs text-v2-muted-fg">
                    <dt className="font-medium">{who.label}</dt>
                    <dd className="min-w-0 truncate font-medium text-v2-fg">{who.name || "—"}</dd>
                    {who.email && (
                      <>
                        <dt className="font-medium">Email</dt>
                        <dd className="min-w-0 truncate text-v2-fg" title={who.email}>{who.email}</dd>
                      </>
                    )}
                    <dt className="font-medium">Sent</dt>
                    <dd className="text-v2-fg tabular-nums">{formatAgreementSentAt(row.sentAt)}</dd>
                    <dt className="font-medium">Status</dt>
                    <dd>
                      <span className={cn("text-sm font-medium", V2_LIST_TONES[AGREEMENT_STATUS_TONE[row.status]])}>
                        {AGREEMENT_STATUS_LABEL[row.status]}
                      </span>
                    </dd>
                    <dt className="font-medium">Linked to</dt>
                    <dd className="text-v2-fg">
                      {AGREEMENT_LINK_LABEL[row.kind]}
                      {reference ? ` · ${reference}` : ""}
                    </dd>
                    {row.cc.length > 0 && (
                      <>
                        <dt className="font-medium">CC</dt>
                        <dd className="break-all text-v2-fg">{row.cc.join(", ")}</dd>
                      </>
                    )}
                    {row.message && (
                      <>
                        <dt className="font-medium">Message</dt>
                        <dd className="whitespace-pre-wrap text-v2-fg">{row.message}</dd>
                      </>
                    )}
                  </dl>
                </DialogDescription>
              )}
            </div>
            {/* The actions sit at the foot of the column, below everything they act on. */}
            {row && (
              <div className="flex shrink-0 flex-col gap-2 border-t border-v2-border px-5 py-4">
                <Button size="default" onClick={() => void download()} disabled={!pdfDoc || saving || downloading} className="w-full">
                  {saving || downloading ? <Loader2 className="animate-spin" /> : <Download />}
                  {row.status === "signed" ? "Download signed PDF" : "Download PDF"}
                </Button>
                <div className="flex gap-2">
                  {canResendRow && (
                    <Button variant="outline" size="default" onClick={() => onResend!(row)} className="flex-1">
                      <RotateCw />
                      Resend
                    </Button>
                  )}
                  {pdfUrl && (
                    <Button variant="outline" size="default" onClick={() => window.open(pdfUrl, "_blank")} className="flex-1">
                      <ExternalLink />
                      New tab
                    </Button>
                  )}
                </div>
                {state.status === "ready" && state.doc.kind === "html" && (
                  <p className="text-xs text-v2-muted-fg">No PDF was produced: it never reached the signing service.</p>
                )}
                {saveError && <p className="text-xs text-v2-destructive">{saveError}</p>}
              </div>
            )}
          </TabsContent>

          <TabsContent value="activity" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
            {row && open && <AgreementActivity row={row} fetchHistory={fetchHistory} className="h-full bg-transparent" />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
